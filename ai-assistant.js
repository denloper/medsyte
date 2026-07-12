/**
 * AI Medical Assistant v2.0
 * С синхронизацией истории чата через Supabase
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

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

ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
2. ВСЕГДА добавляй: "Это не медицинская консультация. Обратитесь к врачу."
3. Используй предоставленные данные из базы (анализы, симптомы)
4. Отвечай на русском языке, кратко и понятно
5. Для тревожных симптомов немедленно советуй вызвать скорую (112)
6. Рекомендуй конкретных специалистов из базы данных
7. Объясняй значения анализов простым языком
8. НЕ назначай лечение и лекарства — только общие рекомендации

ФОРМАТ ОТВЕТА:
- Краткий анализ ситуации (2-3 предложения)
- Возможные причины (список через •)
- Что делать (конкретные шаги)
- К какому врачу обратиться
- Дисклеймер в конце

Если вопрос НЕ медицинский — вежливо предложи задать медицинский вопрос.
Используй markdown: **жирный**, *курсив*, списки через •.`;

  // ═══════════════════════════════════════
  //  RAG: Формирование контекста из базы
  // ═══════════════════════════════════════
  function buildContextFromDatabase(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();

    // 1. Профиль пользователя
    if (userProfile) {
      context.push(`👤 ПРОФИЛЬ ПАЦИЕНТА:
- Имя: ${userProfile.name || userProfile.full_name || 'не указано'}
- Пол: ${userProfile.sex === 'male' ? 'мужской' : userProfile.sex === 'female' ? 'женский' : 'не указан'}
- Возраст: ${userProfile.age || 'не указан'} лет
- Дата рождения: ${userProfile.birth_date || 'не указана'}`);
    }

    // 2. Поиск релевантных тестов
    if (window.labTests && Array.isArray(window.labTests)) {
      const relevantTests = [];
      for (const test of window.labTests) {
        if (!test.aliases) continue;
        const matched = test.aliases.some(alias => 
          lowerMsg.includes(alias.toLowerCase().trim())
        );
        if (matched && relevantTests.length < 5) {
          const ref = test.references && test.references[0];
          relevantTests.push({
            name: test.canonicalName,
            short: test.shortName,
            ref: ref ? `${ref.min}-${ref.max} ${ref.unit}` : 'нет данных'
          });
        }
      }

      if (relevantTests.length > 0) {
        context.push(`🧪 РЕЛЕВАНТНЫЕ АНАЛИЗЫ ИЗ БАЗЫ:
${relevantTests.map(t => `- ${t.name} (${t.short}): норма ${t.ref}`).join('\n')}`);
      }
    }

    // 3. Диагностические правила
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
        context.push(`🏥 ВОЗМОЖНЫЕ СОСТОЯНИЯ ИЗ БАЗЫ:
${relevantRules.map(r => `- ${r.name.trim()} (опасность: ${r.danger}) — врачи: ${r.doctors.map(d => d.trim()).join(', ')}`).join('\n')}`);
      }
    }

    // 4. Рекомендации из supplementMap
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      const relevantSupplements = [];
      for (const testName in window.supplementMap) {
        if (lowerMsg.includes(testName.toLowerCase().trim())) {
          const data = window.supplementMap[testName];
          const rec = data.low || data.high || Object.values(data)[0];
          if (rec && relevantSupplements.length < 3) {
            relevantSupplements.push({ test: testName.trim(), rec });
          }
        }
      }

      if (relevantSupplements.length > 0) {
        context.push(`💊 РЕКОМЕНДАЦИИ ИЗ БАЗЫ:
${relevantSupplements.map(s => `- При отклонении "${s.test}": ${s.rec.supplement || 'консультация врача'}. Врачи: ${(s.rec.doctors || []).map(d => d.trim()).join(', ')}`).join('\n')}`);
      }
    }

    // 5. Последние анализы пользователя
    try {
      const history = JSON.parse(localStorage.getItem('analysis_history_v1') || '[]');
      if (history.length > 0) {
        const lastAnalysis = history[history.length - 1];
        const results = lastAnalysis.results || (lastAnalysis.value && lastAnalysis.value.results);
        if (results && typeof results === 'object') {
          const abnormalTests = Object.entries(results)
            .filter(([_, r]) => r && (r.status === 'high' || r.status === 'low'))
            .slice(0, 5);
          
          if (abnormalTests.length > 0) {
            context.push(`📊 ПОСЛЕДНИЕ ОТКЛОНЕНИЯ В АНАЛИЗАХ:
${abnormalTests.map(([name, r]) => `- ${name}: ${r.value} ${r.unit || ''} (${r.status === 'high' ? '↑ повышено' : '↓ понижено'})`).join('\n')}`);
          }
        }
      }
    } catch(e) {}

    return context.length > 0 
      ? `\n\nКОНТЕКСТ ИЗ БАЗЫ ДАННЫХ:\n${context.join('\n\n')}\n\nИспользуй этот контекст для персонализированного ответа.`
      : '';
  }

  // ═══════════════════════════════════════
  //  Проверка авторизации
  // ═══════════════════════════════════════
  async function checkAuth() {
    if (!window.SupabaseDB) {
      isUserAuthenticated = false;
      currentUserId = null;
      return;
    }

    try {
      const user = await window.SupabaseDB.getCurrentUser();
      if (user && user.id) {
        isUserAuthenticated = true;
        currentUserId = user.id;
      } else {
        isUserAuthenticated = false;
        currentUserId = null;
      }
    } catch (e) {
      console.warn('Auth check failed:', e);
      isUserAuthenticated = false;
      currentUserId = null;
    }
  }

  // ═══════════════════════════════════════
  //  Загрузка истории из Supabase
  // ═══════════════════════════════════════
  async function loadHistoryFromSupabase() {
    if (!isUserAuthenticated || !window.supabase) {
      return false;
    }

    try {
      const { data, error } = await window.supabase
        .from('chat_messages')
        .select('role, content, source, created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY);

      if (error) throw error;

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
      console.warn('Failed to load chat history from Supabase:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  Загрузка истории из localStorage
  // ═══════════════════════════════════════
  function loadHistoryFromLocalStorage() {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        chatHistory = JSON.parse(saved);
        return true;
      }
    } catch(e) {
      chatHistory = [];
    }
    return false;
  }

  // ═══════════════════════════════════════
  //  Сохранение в localStorage (как резерв)
  // ═══════════════════════════════════════
  function saveToLocalStorage() {
    try {
      // Сохраняем только последние MAX_HISTORY сообщений
      const toSave = chatHistory.slice(-MAX_HISTORY);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    } catch(e) {
      console.warn('Failed to save to localStorage:', e);
    }
  }

  // ═══════════════════════════════════════
  //  Сохранение сообщения в Supabase
  // ═══════════════════════════════════════
  async function saveMessageToSupabase(role, content, source = null) {
    if (!isUserAuthenticated || !window.supabase || !currentUserId) {
      return false;
    }

    try {
      const { error } = await window.supabase
        .from('chat_messages')
        .insert({
          user_id: currentUserId,
          role: role,
          content: content,
          source: source,
          metadata: {}
        });

      if (error) {
        console.warn('Failed to save message to Supabase:', error);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('Supabase save error:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  Миграция локальной истории в Supabase
  // ═══════════════════════════════════════
  async function migrateLocalHistoryToSupabase() {
    if (!isUserAuthenticated || !window.supabase) return;

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

      // Вставляем батчами по 20 сообщений
      for (let i = 0; i < messagesToInsert.length; i += 20) {
        const batch = messagesToInsert.slice(i, i + 20);
        const { error } = await window.supabase
          .from('chat_messages')
          .insert(batch);

        if (error) {
          console.warn('Migration batch failed:', error);
          break;
        }
      }

      // Помечаем сообщения как синхронизированные
      chatHistory.forEach(msg => { msg.synced = true; });
      saveToLocalStorage();
      
      console.log(`✅ Migrated ${localHistory.length} messages to Supabase`);
    } catch (e) {
      console.warn('Migration failed:', e);
    }
  }

  // ═══════════════════════════════════════
  //  Главная функция загрузки истории
  // ═══════════════════════════════════════
  async function loadHistory() {
    await checkAuth();

    if (isUserAuthenticated) {
      // Пробуем загрузить из Supabase
      const loaded = await loadHistoryFromSupabase();
      
      if (!loaded) {
        // Если в Supabase пусто — загружаем из localStorage и мигрируем
        loadHistoryFromLocalStorage();
        await migrateLocalHistoryToSupabase();
      }
    } else {
      // Для неавторизованных — только localStorage
      loadHistoryFromLocalStorage();
    }

    // Ограничиваем историю
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }

    console.log(`📜 Chat history loaded: ${chatHistory.length} messages (auth: ${isUserAuthenticated})`);
  }

  // ═══════════════════════════════════════
  //  Вызов Supabase Edge Function (Gemini)
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.reply) {
        return { reply: data.reply, source: 'gemini' };
      }
      throw new Error(data.error || 'Empty response');
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  // ═══════════════════════════════════════
  //  Fallback: локальный ответ
  // ═══════════════════════════════════════
  function generateFallbackResponse(userMessage, userProfile) {
    const lowerMsg = userMessage.toLowerCase();
    const responses = [];

    // Экстренные симптомы
    const emergencyKeywords = ['боль в груди', 'одышка', 'потеря сознания', 'судороги', 'кровь', 'слабость в руке'];
    if (emergencyKeywords.some(k => lowerMsg.includes(k))) {
      return `🚨 **ВНИМАНИЕ! Это может быть экстренная ситуация.**

Немедленно звоните **112** или обратитесь в скорую помощь!

${userProfile ? `Пациент: ${userProfile.name || ''}, ${userProfile.age || ''} лет.` : ''}

⚠️ **Это не медицинская консультация** — требуется срочная помощь врача.`;
    }

    if (lowerMsg.includes('голов') || lowerMsg.includes('мигрен')) {
      responses.push('Головная боль может быть вызвана: стресс, обезвоживание, недосып, проблемы с давлением.');
      responses.push('**Что делать:**\n• Измерьте давление\n• Выпейте воды\n• Отдохните в тёмной комнате');
      responses.push('**Анализы:** Общий анализ крови, ТТГ, Ферритин');
      responses.push('**Врач:** терапевт → невролог');
    } else if (lowerMsg.includes('температур')) {
      responses.push('Повышенная температура — признак воспаления или инфекции.');
      responses.push('**Анализы:** Общий анализ крови, СРБ');
      responses.push('**Врач:** терапевт');
    } else if (lowerMsg.includes('устал') || lowerMsg.includes('слабост')) {
      responses.push('Хроническая усталость может быть признаком дефицита витаминов или анемии.');
      responses.push('**Анализы:** Ферритин, Витамин D, B12, ТТГ');
      responses.push('**Врач:** терапевт → эндокринолог');
    }

    if (responses.length === 0) {
      responses.push('Я могу помочь с:');
      responses.push('• 🔬 Расшифровкой анализов\n• 🩺 Анализом симптомов\n• 💊 Интерпретацией отклонений\n• 👨‍⚕️ Подбором специалистов');
      responses.push('\n**Примеры вопросов:**\n• "Болит голова третий день"\n• "Что значит повышенный холестерин?"\n• "Какие анализы сдать при усталости?"');
    }

    responses.push('\n⚠️ **Это не медицинская консультация.** Обратитесь к врачу.');
    return responses.join('\n\n');
  }

  // ═══════════════════════════════════════
  //  Главная функция отправки сообщения
  // ═══════════════════════════════════════
  async function sendMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new Error('Пустое сообщение');
    }

    // Проверяем авторизацию перед каждым запросом
    await checkAuth();

    // Загружаем профиль
    let userProfile = null;
    try {
      if (window.PatientProfile && window.PatientProfile.get) {
        userProfile = window.PatientProfile.get();
      }
    } catch(e) {}

    // Добавляем сообщение пользователя в историю
    const userMsg = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      synced: false
    };
    chatHistory.push(userMsg);

    // Сохраняем сообщение пользователя
    saveToLocalStorage();
    saveMessageToSupabase('user', userMessage, null);

    // Формируем контекст
    const dbContext = buildContextFromDatabase(userMessage, userProfile);

    // Формируем сообщения для LLM (ограничиваем контекст)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + dbContext },
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
      source = 'gemini';
    } catch (e) {
      console.warn('Edge Function failed, using fallback:', e.message);
      reply = generateFallbackResponse(userMessage, userProfile);
      source = 'local';
    }

    // Добавляем ответ ассистента в историю
    const assistantMsg = {
      role: 'assistant',
      content: reply,
      source: source,
      timestamp: Date.now(),
      synced: false
    };
    chatHistory.push(assistantMsg);

    // Ограничиваем историю
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }

    // Сохраняем ответ
    saveToLocalStorage();
    saveMessageToSupabase('assistant', reply, source);

    return { reply, source };
  }

  // ═══════════════════════════════════════
  //  Очистка истории
  // ═══════════════════════════════════════
  async function clearHistory() {
    chatHistory = [];
    localStorage.removeItem(LOCAL_STORAGE_KEY);

    if (isUserAuthenticated && window.supabase && currentUserId) {
      try {
        // Вызываем серверную функцию очистки
        await window.supabase.rpc('clear_chat_history');
        console.log('✅ Chat history cleared from Supabase');
      } catch (e) {
        console.warn('Failed to clear Supabase history:', e);
        // Fallback: удаляем напрямую
        try {
          await window.supabase
            .from('chat_messages')
            .delete()
            .eq('user_id', currentUserId);
        } catch (e2) {
          console.warn('Direct delete also failed:', e2);
        }
      }
    }
  }

  // ═══════════════════════════════════════
  //  Слушатель изменений авторизации
  // ═══════════════════════════════════════
  function setupAuthListener() {
    if (!window.supabase) return;

    window.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔐 Auth state changed:', event);
      
      if (event === 'SIGNED_IN') {
        // При входе — загружаем историю из Supabase
        await loadHistory();
        
        // Уведомляем UI о смене
        window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
          detail: { history: chatHistory, authenticated: true }
        }));
      } else if (event === 'SIGNED_OUT') {
        // При выходе — очищаем и переключаемся на localStorage
        chatHistory = [];
        await loadHistory();
        
        window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
          detail: { history: chatHistory, authenticated: false }
        }));
      }
    });
  }

  // ═══════════════════════════════════════
  //  Инициализация
  // ═══════════════════════════════════════
  async function init() {
    await loadHistory();
    setupAuthListener();
    
    console.log('🤖 AI Assistant v2.0 initialized (with Supabase sync)');
  }

  init();

  // ═══════════════════════════════════════
  //  Экспорт API
  // ═══════════════════════════════════════
  window.AIAssistant = {
    sendMessage,
    getHistory: () => [...chatHistory],
    clearHistory,
    isAuthenticated: () => isUserAuthenticated,
    reloadHistory: loadHistory,
    version: '2.0.0'
  };

  // Публичное событие для UI
  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();