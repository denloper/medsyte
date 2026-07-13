/**
 * AI Medical Assistant v3.3
 * OpenRouter (tencent/hy3:free) + RAG + Supabase чат
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  // ✅ Используем ОБЩИЙ клиент из supabase-client.js
  const sb = window.supabaseClient || null;

  if (!sb) {
    console.warn('⚠️ Supabase client not available. Waiting for initialization...');
  } else {
    console.log('✅ AI Assistant: using shared Supabase client');
  }

  const LOCAL_STORAGE_KEY = 'ai_chat_history_v1';
  const MAX_HISTORY = 50;
  const MAX_CONTEXT_MESSAGES = 10;

  let chatHistory = [];
  let isUserAuthenticated = false;
  let currentUserId = null;

  // ═══════════════════════════════════════
  //  СИСТЕМНЫЙ ПРОМПТ
  // ═══════════════════════════════════════
  const SYSTEM_PROMPT = `Ты — медицинский AI-ассистент в приложении "Семейный доктор". Отвечай ТОЛЬКО на русском языке.

СТРОГИЕ ПРАВИЛА:
1. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
2. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
3. Для тревожных симптомов (боль в груди, одышка, потеря сознания, кровь) — немедленно советуй вызвать 112
4. НЕ назначай лечение и лекарства без консультации врача — только общие рекомендации
5. Используй markdown: **жирный** для важного, • для списков
6. Ссылайся на конкретные тесты из базы знаний по их точным названиям

ФОРМАТ ОТВЕТА:
- Краткий анализ ситуации (2-3 предложения)
- Возможные причины (список через •)
- Рекомендуемые анализы из базы (конкретные названия с нормами)
- К какому врачу обратиться
- Дисклеймер в конце

Если вопрос НЕ медицинский — вежливо предложи задать медицинский вопрос.`;

  // ═══════════════════════════════════════
  //  КОМПАКТНАЯ СВОДКА ВСЕЙ БАЗЫ
  // ═══════════════════════════════════════
  function buildCompactDatabaseSummary() {
    const sections = [];

    // 1. Лабораторные тесты (по категориям)
    if (window.labTests && Array.isArray(window.labTests)) {
      const testsByCategory = {};
      window.labTests.forEach(test => {
        const cat = test.category || 'Другое';
        if (!testsByCategory[cat]) testsByCategory[cat] = [];
        const ref = test.references && test.references[0];
        const normStr = ref 
          ? `${ref.min}-${ref.max} ${ref.unit || ''}`.trim()
          : '—';
        testsByCategory[cat].push(`${test.canonicalName.trim()} [${test.shortName.trim()}]: ${normStr}`);
      });

      let testsList = '🧪 ПОЛНАЯ БАЗА ЛАБОРАТОРНЫХ ТЕСТОВ:\n';
      Object.keys(testsByCategory).sort().forEach(cat => {
        testsList += `\n【${cat}】\n`;
        testsList += testsByCategory[cat].map(t => `• ${t}`).join('\n');
      });
      sections.push(testsList);
    }

    // 2. Диагностические правила
    if (window.diagnosticRules && Array.isArray(window.diagnosticRules)) {
      let rulesList = '\n\n🏥 ДИАГНОСТИЧЕСКИЕ ПРАВИЛА:\n';
      window.diagnosticRules.forEach(rule => {
        const testsStr = Object.entries(rule.results)
          .map(([test, status]) => `${test.trim()} ${status === 'high' ? '↑' : '↓'}`)
          .join(', ');
        rulesList += `• ${rule.name.trim()} [${rule.danger}] → ${testsStr} → врачи: ${rule.doctors.map(d => d.trim()).join(', ')}\n`;
      });
      sections.push(rulesList);
    }

    // 3. Рекомендации по добавкам
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      let supplementsList = '\n\n💊 РЕКОМЕНДАЦИИ ПРИ ОТКЛОНЕНИЯХ:\n';
      Object.entries(window.supplementMap).forEach(([test, data]) => {
        Object.entries(data).forEach(([status, rec]) => {
          const statusRu = status === 'high' ? '↑ повышен' : '↓ понижен';
          const docs = rec.doctors ? rec.doctors.map(d => d.trim()).join(', ') : 'терапевт';
          supplementsList += `• ${test.trim()} (${statusRu}): ${rec.supplement || 'консультация врача'} → ${docs}\n`;
        });
      });
      sections.push(supplementsList);
    }

    // 4. Профилактические рекомендации
    if (window.preventiveRecommendations && Array.isArray(window.preventiveRecommendations)) {
      let preventive = '\n\n🛡 ПРОФИЛАКТИЧЕСКИЕ РЕКОМЕНДАЦИИ:\n';
      window.preventiveRecommendations.forEach(rec => {
        preventive += `• ${rec.supplement} (${rec.duration}) — ${rec.note}\n`;
      });
      sections.push(preventive);
    }

    return sections.join('\n');
  }

  // ═══════════════════════════════════════
  //  ДЕТАЛЬНЫЙ RAG по запросу
  // ═══════════════════════════════════════
  function buildRelevantContext(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();

    // Профиль пациента
    if (userProfile) {
      context.push(`👤 ПАЦИЕНТ: ${userProfile.name || userProfile.full_name || 'не указано'}, ${userProfile.sex === 'male' ? 'мужчина' : userProfile.sex === 'female' ? 'женщина' : 'пол не указан'}, ${userProfile.age || '?'} лет`);
    }

    // Релевантные тесты
    if (window.labTests && Array.isArray(window.labTests)) {
      const relevant = [];
      for (const test of window.labTests) {
        if (!test.aliases) continue;
        const matched = test.aliases.some(alias => 
          lowerMsg.includes(alias.toLowerCase().trim())
        );
        if (matched && relevant.length < 5) {
          relevant.push(test);
        }
      }
      if (relevant.length > 0) {
        context.push(`\n🎯 РЕЛЕВАНТНЫЕ ТЕСТЫ ПО ЗАПРОСУ:`);
        relevant.forEach(t => {
          const ref = t.references && t.references[0];
          context.push(`• ${t.canonicalName.trim()} (${t.shortName.trim()}): норма ${ref ? `${ref.min}-${ref.max} ${ref.unit}` : '—'}`);
        });
      }
    }

    // Релевантные диагностические правила
    if (window.diagnosticRules && Array.isArray(window.diagnosticRules)) {
      const relevantRules = [];
      for (const rule of window.diagnosticRules) {
        const nameMatch = lowerMsg.includes(rule.name.toLowerCase().trim());
        const testsMatch = rule.results && Object.keys(rule.results).some(test => 
          lowerMsg.includes(test.toLowerCase().trim())
        );
        if ((nameMatch || testsMatch) && relevantRules.length < 3) {
          relevantRules.push(rule);
        }
      }
      if (relevantRules.length > 0) {
        context.push(`\n🔍 ВОЗМОЖНЫЕ СОСТОЯНИЯ:`);
        relevantRules.forEach(r => {
          context.push(`• ${r.name.trim()} (уровень: ${r.danger}) → ${r.doctors.map(d => d.trim()).join(', ')}`);
        });
      }
    }

    // Последние анализы пользователя
    try {
      const history = JSON.parse(localStorage.getItem('analysis_history_v1') || '[]');
      if (history.length > 0) {
        const lastAnalysis = history[history.length - 1];
        const results = lastAnalysis.results || (lastAnalysis.value && lastAnalysis.value.results);
        if (results && typeof results === 'object') {
          const abnormal = Object.entries(results)
            .filter(([_, r]) => r && (r.status === 'high' || r.status === 'low'))
            .slice(0, 5);
          
          if (abnormal.length > 0) {
            context.push(`\n📊 ПОСЛЕДНИЕ ОТКЛОНЕНИЯ У ПАЦИЕНТА:`);
            abnormal.forEach(([name, r]) => {
              context.push(`• ${name}: ${r.value} ${r.unit || ''} (${r.status === 'high' ? '↑ повышено' : '↓ понижено'})`);
            });
          }
        }
      }
    } catch(e) {}

    return context.length > 0 ? context.join('\n') : '';
  }

  // ═══════════════════════════════════════
  //  ПРОВЕРКА АВТОРИЗАЦИИ
  // ═══════════════════════════════════════
  async function checkAuth() {
    if (!sb) {
      isUserAuthenticated = false;
      currentUserId = null;
      return;
    }
    try {
      const { data: { user }, error } = await sb.auth.getUser();
      if (error) {
        console.warn('⚠️ Auth error:', error.message);
        isUserAuthenticated = false;
        currentUserId = null;
        return;
      }
      if (user && user.id) {
        isUserAuthenticated = true;
        currentUserId = user.id;
      } else {
        isUserAuthenticated = false;
        currentUserId = null;
      }
    } catch (e) {
      console.warn('⚠️ checkAuth failed:', e.message);
      isUserAuthenticated = false;
      currentUserId = null;
    }
  }

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА ИСТОРИИ ИЗ SUPABASE
  // ═══════════════════════════════════════
  async function loadHistoryFromSupabase() {
    if (!isUserAuthenticated || !sb || !currentUserId) return false;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || !user.id) {
        isUserAuthenticated = false;
        return false;
      }
      currentUserId = user.id;
    } catch (e) {
      isUserAuthenticated = false;
      return false;
    }

    try {
      const { data, error } = await sb
        .from('chat_messages')
        .select('role, content, source, created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY);

      if (error) {
        if (error.status === 401 || error.code === 'PGRST301') {
          const { error: refreshError } = await sb.auth.refreshSession();
          if (refreshError) {
            isUserAuthenticated = false;
            return false;
          }
          return await loadHistoryFromSupabase();
        }
        throw error;
      }

      if (data && data.length > 0) {
        chatHistory = data.map(msg => ({
          role: msg.role,
          content: msg.content,
          source: msg.source,
          timestamp: new Date(msg.created_at).getTime(),
          synced: true
        }));
        return true;
      }
      return false;
    } catch (e) {
      console.warn('⚠️ Supabase history load failed:', e.message);
      return false;
    }
  }

  function loadHistoryFromLocalStorage() {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        chatHistory = JSON.parse(saved);
        return true;
      }
    } catch(e) { chatHistory = []; }
    return false;
  }

  function saveToLocalStorage() {
    try {
      const toSave = chatHistory.slice(-MAX_HISTORY);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    } catch(e) {}
  }

  // ═══════════════════════════════════════
  //  СОХРАНЕНИЕ СООБЩЕНИЯ В SUPABASE
  // ═══════════════════════════════════════
  async function saveMessageToSupabase(role, content, source = null, retryCount = 0) {
    if (!isUserAuthenticated || !sb || !currentUserId) return false;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || user.id !== currentUserId) {
        isUserAuthenticated = false;
        return false;
      }

      const { error } = await sb.from('chat_messages').insert({
        user_id: currentUserId,
        role: role,
        content: content,
        source: source,
        metadata: {}
      });

      if (error) {
        if ((error.status === 401 || error.code === 'PGRST301') && retryCount < 1) {
          const { error: refreshError } = await sb.auth.refreshSession();
          if (!refreshError) {
            return await saveMessageToSupabase(role, content, source, retryCount + 1);
          }
        }
        console.warn(`⚠️ Failed to save to Supabase: ${error.message}`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`⚠️ Exception saving to Supabase: ${e.message}`);
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg) {
        lastMsg.synced = false;
        saveToLocalStorage();
      }
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  МИГРАЦИЯ ЛОКАЛЬНОЙ ИСТОРИИ
  // ═══════════════════════════════════════
  async function migrateLocalHistoryToSupabase() {
    if (!isUserAuthenticated || !sb || !currentUserId) return;
    const localHistory = chatHistory.filter(msg => !msg.synced);
    if (localHistory.length === 0) return;

    try {
      const messagesToInsert = localHistory.map(msg => ({
        user_id: currentUserId,
        role: msg.role,
        content: msg.content,
        source: msg.source || null,
        metadata: { migrated: true, original_timestamp: msg.timestamp }
      }));

      for (let i = 0; i < messagesToInsert.length; i += 10) {
        const batch = messagesToInsert.slice(i, i + 10);
        const { error } = await sb.from('chat_messages').insert(batch);
        if (error) {
          console.warn(`⚠️ Batch ${i/10 + 1} failed:`, error.message);
          break;
        }
      }

      chatHistory.forEach(msg => { msg.synced = true; });
      saveToLocalStorage();
      console.log(`✅ Migrated ${localHistory.length} messages to Supabase`);
    } catch (e) {
      console.warn('⚠️ Migration failed:', e.message);
    }
  }

  async function loadHistory() {
    await checkAuth();
    if (isUserAuthenticated) {
      const loaded = await loadHistoryFromSupabase();
      if (!loaded) {
        loadHistoryFromLocalStorage();
        await migrateLocalHistoryToSupabase();
      }
    } else {
      loadHistoryFromLocalStorage();
    }
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }
  }

  // ═══════════════════════════════════════
  //  ВЫЗОВ EDGE FUNCTION (OpenRouter)
  // ═══════════════════════════════════════
  async function callEdgeFunction(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && data.reply) {
        return { reply: data.reply, source: 'openrouter', model: data.model || 'tencent/hy3' };
      }
      throw new Error(data.error || 'Empty response');
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  // ═══════════════════════════════════════
  //  FALLBACK: локальный ответ
  // ═══════════════════════════════════════
  function generateFallbackResponse(userMessage, userProfile) {
    const lowerMsg = userMessage.toLowerCase();
    const responses = [];

    const emergencyKeywords = ['боль в груди', 'одышка', 'потеря сознания', 'судороги', 'кровь', 'слабость в руке'];
    if (emergencyKeywords.some(k => lowerMsg.includes(k))) {
      return `🚨 **ВНИМАНИЕ! Экстренная ситуация.**\n\nНемедленно звоните **112**!\n\n⚠️ Это не медицинская консультация.`;
    }

    if (lowerMsg.includes('голов') || lowerMsg.includes('мигрен')) {
      responses.push('Головная боль может быть вызвана: стресс, обезвоживание, недосып, проблемы с давлением.');
      responses.push('**Рекомендуемые анализы:**\n• Гемоглобин (HGB): 130-170 г/л (муж) / 120-150 г/л (жен)\n• Тиреотропный гормон (ТТГ): 0.4-4.0 мМЕ/л\n• Ферритин: 30-400 нг/мл (муж) / 15-150 нг/мл (жен)');
      responses.push('**Врач:** терапевт → невролог');
    } else if (lowerMsg.includes('температур')) {
      responses.push('Повышенная температура — признак воспаления или инфекции.');
      responses.push('**Рекомендуемые анализы:**\n• Лейкоциты (WBC): 4.0-9.0 ×10⁹/л\n• С-реактивный белок (CRP): 0-5 мг/л\n• СОЭ (ESR): до 15 мм/ч (муж) / до 20 мм/ч (жен)');
      responses.push('**Врач:** терапевт');
    } else if (lowerMsg.includes('устал') || lowerMsg.includes('слабост')) {
      responses.push('Хроническая усталость — частый признак дефицитов.');
      responses.push('**Рекомендуемые анализы:**\n• Ферритин: 30-400 нг/мл (муж) / 15-150 нг/мл (жен)\n• 25-гидроксивитамин D: 30-100 нг/мл\n• Витамин B12: 200-900 пг/мл\n• ТТГ: 0.4-4.0 мМЕ/л\n• Гемоглобин (HGB)');
      responses.push('**Врач:** терапевт → эндокринолог');
    } else if (lowerMsg.includes('анализ') || lowerMsg.includes('какие')) {
      responses.push('В моей базе есть следующие категории анализов:\n• ОАК (общий анализ крови)\n• Биохимия\n• Липидограмма\n• Печёночные ферменты\n• Гормоны щитовидной железы\n• Витамины\n• Электролиты\n• Онкомаркеры\n• Иммунология');
      responses.push('Опишите симптомы — я подскажу конкретные анализы.');
    }

    if (responses.length === 0) {
      responses.push('Я могу помочь с:\n• 🔬 Расшифровкой анализов\n• 🩺 Анализом симптомов\n• 💊 Рекомендациями при отклонениях\n• 👨‍⚕️ Подбором специалистов');
      responses.push('\n**Примеры:**\n• "Болит голова"\n• "Какие анализы сдать при усталости?"\n• "Что значит повышенный холестерин?"');
    }

    responses.push('\n⚠️ **Это не медицинская консультация.** Обратитесь к врачу.');
    return responses.join('\n\n');
  }

  // ═══════════════════════════════════════
  //  ГЛАВНАЯ ФУНКЦИЯ: ОТПРАВКА СООБЩЕНИЯ
  // ═══════════════════════════════════════
  async function sendMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new Error('Пустое сообщение');
    }

    console.log('═══════════════════════════════════════');
    console.log('📨 sendMessage called:', userMessage.slice(0, 50));
    console.log('═══════════════════════════════════════');

    // Проверяем авторизацию ПЕРЕД каждым запросом
    console.log('🔐 Before checkAuth:');
    console.log('   - sb exists:', !!sb);
    console.log('   - sb.auth exists:', !!(sb && sb.auth));
    
    await checkAuth();
    
    console.log('🔐 After checkAuth:');
    console.log('   - isUserAuthenticated:', isUserAuthenticated);
    console.log('   - currentUserId:', currentUserId);

    // Дополнительная проверка сессии
    if (sb && sb.auth) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        console.log('🔐 Session check:');
        console.log('   - session exists:', !!session);
        console.log('   - session.user:', session?.user?.email || 'none');
        console.log('   - session.access_token:', session?.access_token ? '✓ present' : '✗ missing');
      } catch (e) {
        console.error('❌ Session check failed:', e);
      }
    }

    let userProfile = null;
    try {
      if (window.PatientProfile && window.PatientProfile.get) {
        userProfile = window.PatientProfile.get();
      }
    } catch(e) {}

    const userMsg = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      synced: false
    };
    chatHistory.push(userMsg);
    saveToLocalStorage();
    
    console.log('💾 Save decision:');
    console.log('   - isUserAuthenticated:', isUserAuthenticated);
    console.log('   - sb exists:', !!sb);
    console.log('   - currentUserId:', currentUserId);
    console.log('   - Will save to Supabase:', isUserAuthenticated && sb && currentUserId);
    
    // Сохраняем в Supabase только если авторизован
    if (isUserAuthenticated && sb && currentUserId) {
      console.log('💾 Attempting to save USER message to Supabase...');
      const saved = await saveMessageToSupabase('user', userMessage, null);
      console.log('💾 Save result:', saved ? '✓ SUCCESS' : '✗ FAILED');
    } else {
      console.warn('⚠️ Skipping Supabase save - user not authenticated');
      console.warn('   Reasons:');
      if (!isUserAuthenticated) console.warn('   - isUserAuthenticated = false');
      if (!sb) console.warn('   - sb (Supabase client) = null');
      if (!currentUserId) console.warn('   - currentUserId = null');
    }

    const databaseSummary = buildCompactDatabaseSummary();
    const relevantContext = buildRelevantContext(userMessage, userProfile);

    const fullSystemPrompt = [
      SYSTEM_PROMPT,
      '\n\n═══════════════════════════════════',
      'БАЗА МЕДИЦИНСКИХ ЗНАНИЙ:',
      '═══════════════════════════════════',
      databaseSummary,
      relevantContext ? '\n\nКОНТЕКСТ ПО ЗАПРОСУ:\n' + relevantContext : '',
      '\n\nВАЖНО: Отвечай ТОЛЬКО на основе базы. Используй точные названия тестов.'
    ].join('\n');

    console.log('📊 System prompt size:', fullSystemPrompt.length, 'chars (~' + Math.ceil(fullSystemPrompt.length / 4) + ' tokens)');

    const messages = [
      { role: 'system', content: fullSystemPrompt },
      ...chatHistory.slice(-MAX_CONTEXT_MESSAGES).map(m => ({
        role: m.role,
        content: m.content
      }))
    ];

    let reply;
    let source;

    try {
      console.log('🤖 Calling Edge Function (OpenRouter)...');
      const result = await callEdgeFunction(messages);
      reply = result.reply;
      source = 'openrouter';
      console.log('✅ OpenRouter response received:', reply.slice(0, 100));
    } catch (e) {
      console.warn('⚠️ Edge Function failed:', e.message);
      reply = generateFallbackResponse(userMessage, userProfile);
      source = 'local';
    }

    const assistantMsg = {
      role: 'assistant',
      content: reply,
      source: source,
      timestamp: Date.now(),
      synced: false
    };
    chatHistory.push(assistantMsg);

    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }

    saveToLocalStorage();
    
    if (isUserAuthenticated && sb && currentUserId) {
      console.log('💾 Attempting to save ASSISTANT message to Supabase...');
      const saved = await saveMessageToSupabase('assistant', reply, source);
      console.log('💾 Save result:', saved ? '✓ SUCCESS' : '✗ FAILED');
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ sendMessage completed');
    console.log('═══════════════════════════════════════');

    return { reply, source };
  }

  // ═══════════════════════════════════════
  //  ОЧИСТКА ИСТОРИИ
  // ═══════════════════════════════════════
  async function clearHistory() {
    chatHistory = [];
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    if (isUserAuthenticated && sb && currentUserId) {
      try {
        await sb.rpc('clear_chat_history');
      } catch (e) {
        try {
          await sb.from('chat_messages').delete().eq('user_id', currentUserId);
        } catch (e2) {}
      }
    }
  }

  // ═══════════════════════════════════════
  //  СЛУШАТЕЛЬ АВТОРИЗАЦИИ
  // ═══════════════════════════════════════
  function setupAuthListener() {
    if (!sb || !sb.auth) {
      console.warn('⚠️ Auth listener not available');
      return;
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      console.log(`🔐 Auth state changed: ${event}`);

      if (event === 'SIGNED_IN' && session?.user) {
        isUserAuthenticated = true;
        currentUserId = session.user.id;
        await loadHistory();
        window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
          detail: { history: chatHistory, authenticated: true }
        }));
      } else if (event === 'SIGNED_OUT') {
        isUserAuthenticated = false;
        currentUserId = null;
        chatHistory = [];
        loadHistoryFromLocalStorage();
        window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
          detail: { history: chatHistory, authenticated: false }
        }));
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        console.log('🔄 Token refreshed');
        currentUserId = session.user.id;
      }
    });
  }

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════
  async function init() {
    await loadHistory();
    setupAuthListener();
    console.log('🤖 AI Assistant v3.3 initialized (OpenRouter: tencent/hy3:free)');
    console.log(`📚 Database: ${window.labTests?.length || 0} tests, ${window.diagnosticRules?.length || 0} rules, ${Object.keys(window.supplementMap || {}).length} supplements`);
    console.log(`☁️ Supabase client: ${sb ? '✓ connected' : '✗ disabled'}`);
  }

  init();

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.AIAssistant = {
    sendMessage,
    getHistory: () => [...chatHistory],
    clearHistory,
    isAuthenticated: () => isUserAuthenticated,
    reloadHistory: loadHistory,
    getDatabaseStats: () => ({
      tests: window.labTests?.length || 0,
      rules: window.diagnosticRules?.length || 0,
      supplements: Object.keys(window.supplementMap || {}).length,
      preventive: window.preventiveRecommendations?.length || 0
    }),
    isSupabaseConnected: () => !!sb,
    version: '3.3.0'
  };

  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();