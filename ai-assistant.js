/**
 * AI Medical Assistant v3.2
 * Полная база database.js + RAG + Groq + Supabase чат + Auth listener
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  // ✅ Создаём свой Supabase клиент
  const sb = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  if (!sb) {
    console.warn('⚠️ Supabase client not available. Chat sync disabled.');
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
  const SYSTEM_PROMPT = `Ты — медицинский AI-ассистент в приложении "Семейный доктор".

СТРОГИЕ ПРАВИЛА:
1. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
2. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
3. Для тревожных симптомов (боль в груди, одышка, потеря сознания) — немедленно советуй вызвать 112
4. НЕ назначай лечение и лекарства — только общие рекомендации и направления к специалистам
5. Отвечай на русском языке, кратко и понятно
6. Используй markdown: **жирный** для важного, • для списков

ФОРМАТ ОТВЕТА:
- Краткий анализ ситуации (2-3 предложения)
- Возможные причины (список через •)
- Рекомендуемые анализы из базы (конкретные названия)
- К какому врачу обратиться
- Дисклеймер в конце

Если вопрос НЕ медицинский — вежливо предложи задать медицинский вопрос.`;

  // ═══════════════════════════════════════
  //  КОМПАКТНАЯ СВОДКА ВСЕЙ БАЗЫ
  // ═══════════════════════════════════════
  function buildCompactDatabaseSummary() {
    const sections = [];

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

    if (window.supplementMap && typeof window.supplementMap === 'object') {
      let supplementsList = '\n\n💊 РЕКОМЕНДАЦИИ ПРИ ОТКЛОНЕНИЯХ:\n';
      Object.entries(window.supplementMap).forEach(([test, data]) => {
        Object.entries(data).forEach(([status, rec]) => {
          const statusRu = status === 'high' ? '↑ повышен' : '↓ понижен';
          supplementsList += `• ${test.trim()} (${statusRu}): ${rec.supplement || 'консультация врача'} → ${rec.doctors ? rec.doctors.map(d => d.trim()).join(', ') : 'терапевт'}\n`;
        });
      });
      sections.push(supplementsList);
    }

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
  //  ДЕТАЛЬНЫЙ RAG
  // ═══════════════════════════════════════
  function buildRelevantContext(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();

    if (userProfile) {
      context.push(`👤 ПАЦИЕНТ: ${userProfile.name || userProfile.full_name || 'не указано'}, ${userProfile.sex === 'male' ? 'мужчина' : userProfile.sex === 'female' ? 'женщина' : 'пол не указан'}, ${userProfile.age || '?'} лет`);
    }

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
  //  ПРОВЕРКА АВТОРИЗАЦИИ (с детальным логом)
  // ═══════════════════════════════════════
  async function checkAuth() {
    if (!sb) {
      console.warn('⚠️ Supabase client not available');
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
        console.log(`✅ User authenticated: ${user.id}`);
      } else {
        console.warn('⚠️ No user in session');
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
  //  СОХРАНЕНИЕ СООБЩЕНИЯ В SUPABASE (с детальным логом)
  // ═══════════════════════════════════════
  async function saveMessageToSupabase(role, content, source = null) {
    if (!isUserAuthenticated || !sb || !currentUserId) {
      console.log('⏭ Skipping Supabase save (not authenticated)');
      return false;
    }

    try {
      // Проверяем сессию перед INSERT
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        console.warn('⚠️ No active session, skipping save');
        return false;
      }

      console.log(`💾 Saving message to Supabase:`, {
        user_id: currentUserId,
        role,
        content_preview: content.slice(0, 50),
        source
      });

      const { data, error } = await sb.from('chat_messages').insert({
        user_id: currentUserId,
        role: role,
        content: content,
        source: source,
        metadata: {}
      }).select();

      if (error) {
        console.error('❌ Supabase INSERT error:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        
        // Если 401 — пробуем refresh
        if (error.code === 'PGRST301' || error.message.includes('JWT')) {
          console.log('🔄 Refreshing session...');
          const { error: refreshError } = await sb.auth.refreshSession();
          if (!refreshError) {
            console.log('✅ Session refreshed, retrying...');
            return await saveMessageToSupabase(role, content, source);
          }
        }
        return false;
      }

      console.log('✅ Message saved to Supabase:', data);
      return true;
    } catch (e) {
      console.error('❌ Exception saving message:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА ИСТОРИИ ИЗ SUPABASE
  // ═══════════════════════════════════════
  async function loadHistoryFromSupabase() {
    if (!isUserAuthenticated || !sb || !currentUserId) {
      console.log('⏭ Skipping Supabase load (not authenticated)');
      return false;
    }

    try {
      console.log(`📥 Loading chat history for user: ${currentUserId}`);
      
      const { data, error } = await sb
        .from('chat_messages')
        .select('role, content, source, created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY);

      if (error) {
        console.error('❌ Supabase SELECT error:', error);
        return false;
      }

      if (data && data.length > 0) {
        chatHistory = data.map(msg => ({
          role: msg.role,
          content: msg.content,
          source: msg.source,
          timestamp: new Date(msg.created_at).getTime(),
          synced: true
        }));
        console.log(`✅ Loaded ${data.length} messages from Supabase`);
        return true;
      }
      
      console.log('📭 No messages in Supabase');
      return false;
    } catch (e) {
      console.error('❌ Exception loading history:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  МИГРАЦИЯ ЛОКАЛЬНОЙ ИСТОРИИ
  // ═══════════════════════════════════════
  async function migrateLocalHistoryToSupabase() {
    if (!isUserAuthenticated || !sb || !currentUserId) return;
    
    const localHistory = chatHistory.filter(msg => !msg.synced);
    if (localHistory.length === 0) {
      console.log('⏭ No local messages to migrate');
      return;
    }

    console.log(`🔄 Migrating ${localHistory.length} local messages to Supabase...`);

    try {
      const messagesToInsert = localHistory.map(msg => ({
        user_id: currentUserId,
        role: msg.role,
        content: msg.content,
        source: msg.source || null,
        metadata: { migrated: true, original_timestamp: msg.timestamp }
      }));

      // Batch insert по 5 сообщений для отладки
      for (let i = 0; i < messagesToInsert.length; i += 5) {
        const batch = messagesToInsert.slice(i, i + 5);
        const { error } = await sb.from('chat_messages').insert(batch);
        
        if (error) {
          console.error(`❌ Batch ${i/5 + 1} failed:`, error);
          break;
        }
        console.log(`✅ Batch ${i/5 + 1} migrated (${batch.length} messages)`);
      }

      chatHistory.forEach(msg => { msg.synced = true; });
      saveToLocalStorage();
      console.log(`✅ Migration complete`);
    } catch (e) {
      console.error('❌ Migration failed:', e);
    }
  }

  // ═══════════════════════════════════════
  //  ВЫЗОВ EDGE FUNCTION (GROQ)
  // ═══════════════════════════════════════
  async function callEdgeFunction(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
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
        return { reply: data.reply, source: 'groq' };
      }
      throw new Error(data.error || 'Empty response');
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  // ═══════════════════════════════════════
  //  FALLBACK
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
      responses.push('**Рекомендуемые анализы:**\n• Общий анализ крови\n• ТТГ\n• Ферритин');
      responses.push('**Врач:** терапевт → невролог');
    } else if (lowerMsg.includes('температур')) {
      responses.push('Повышенная температура — признак воспаления или инфекции.');
      responses.push('**Рекомендуемые анализы:**\n• Общий анализ крови\n• С-реактивный белок (СРБ)\n• Лейкоциты');
      responses.push('**Врач:** терапевт');
    } else if (lowerMsg.includes('устал') || lowerMsg.includes('слабост')) {
      responses.push('Хроническая усталость — частый признак дефицитов.');
      responses.push('**Рекомендуемые анализы:**\n• Ферритин\n• Витамин D (25-OH)\n• Витамин B12\n• ТТГ\n• Гемоглобин');
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

    await checkAuth();

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
    saveMessageToSupabase('user', userMessage, null);

    const databaseSummary = buildCompactDatabaseSummary();
    const relevantContext = buildRelevantContext(userMessage, userProfile);

    const fullSystemPrompt = [
      SYSTEM_PROMPT,
      '\n\n═══════════════════════════════════',
      'БАЗА МЕДИЦИНСКИХ ЗНАНИЙ (используй для ответов):',
      '═══════════════════════════════════',
      databaseSummary,
      relevantContext ? '\n\n═══════════════════════════════════\nКОНТЕКСТ ПО ТЕКУЩЕМУ ЗАПРОСУ:\n═══════════════════════════════════\n' + relevantContext : '',
      '\n\nВАЖНО: Отвечай ТОЛЬКО на основе базы выше. Используй точные названия тестов из базы.'
    ].join('\n');

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
      const result = await callEdgeFunction(messages);
      reply = result.reply;
      source = 'groq';
    } catch (e) {
      console.warn('Edge Function failed, using fallback:', e.message);
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
    saveMessageToSupabase('assistant', reply, source);

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
  //  СЛУШАТЕЛЬ АВТОРИЗАЦИИ (ШАГ 4)
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
    console.log('🤖 AI Assistant v3.2 initialized');
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
    version: '3.2.0'
  };

  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();