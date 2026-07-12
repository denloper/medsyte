/**
 * AI Medical Assistant v1.0
 * Гибридный RAG (database.js) + Gemini (через Supabase Edge Function)
 * С fallback на локальные ответы если Edge Function недоступна
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  const STORAGE_KEY = 'ai_chat_history_v1';
  const MAX_HISTORY = 20;

  let chatHistory = [];

  // ═══════════════════════════════════════
  //  СИСТЕМНЫЙ ПРОМПТ (медицинский контекст)
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
  //  RAG: Формирование контекста из базы database.js
  // ═══════════════════════════════════════
  function buildContextFromDatabase(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();

    // 1. Контекст профиля пользователя
    if (userProfile) {
      context.push(`👤 ПРОФИЛЬ ПАЦИЕНТА:
- Имя: ${userProfile.name || userProfile.full_name || 'не указано'}
- Пол: ${userProfile.sex === 'male' ? 'мужской' : userProfile.sex === 'female' ? 'женский' : 'не указан'}
- Возраст: ${userProfile.age || 'не указан'} лет
- Дата рождения: ${userProfile.birth_date || 'не указана'}`);
    }

    // 2. Поиск релевантных тестов из window.labTests
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

    // 3. Поиск диагностических правил
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
${relevantRules.map(r => `- ${r.name.trim()} (уровень опасности: ${r.danger}) — врачи: ${r.doctors.map(d => d.trim()).join(', ')}`).join('\n')}`);
      }
    }

    // 4. Поиск рекомендаций из supplementMap
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      const relevantSupplements = [];
      for (const testName in window.supplementMap) {
        if (lowerMsg.includes(testName.toLowerCase().trim())) {
          const data = window.supplementMap[testName];
          const rec = data.low || data.high || Object.values(data)[0];
          if (rec && relevantSupplements.length < 3) {
            relevantSupplements.push({
              test: testName.trim(),
              rec: rec
            });
          }
        }
      }

      if (relevantSupplements.length > 0) {
        context.push(`💊 РЕКОМЕНДАЦИИ ИЗ БАЗЫ:
${relevantSupplements.map(s => `- При отклонении "${s.test}": ${s.rec.supplement || 'консультация врача'}. Длительность: ${s.rec.duration || 'не указана'}. Врачи: ${(s.rec.doctors || []).map(d => d.trim()).join(', ')}`).join('\n')}`);
      }
    }

    // 5. Последние анализы из localStorage
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
            context.push(`📊 ПОСЛЕДНИЕ ОТКЛОНЕНИЯ В АНАЛИЗАХ ПАЦИЕНТА:
${abnormalTests.map(([name, r]) => `- ${name}: ${r.value} ${r.unit || ''} (${r.status === 'high' ? '↑ повышено' : '↓ понижено'})`).join('\n')}`);
          }
        }
      }
    } catch(e) {
      console.warn('Failed to load analysis history:', e);
    }

    return context.length > 0 
      ? `\n\nКОНТЕКСТ ИЗ БАЗЫ ДАННЫХ (используй для ответа):\n${context.join('\n\n')}\n\nИспользуй этот контекст для персонализированного ответа.`
      : '';
  }

  // ═══════════════════════════════════════
  //  Вызов Supabase Edge Function (Gemini)
  // ═══════════════════════════════════════
  async function callEdgeFunction(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 сек таймаут

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
  //  FALLBACK: Локальный ответ на основе базы
  // ═══════════════════════════════════════
  function generateFallbackResponse(userMessage, userProfile) {
    const lowerMsg = userMessage.toLowerCase();
    const responses = [];

    // 1. Экстренные симптомы
    const emergencyKeywords = ['боль в груди', 'одышка', 'потеря сознания', 'судороги', 'кровь', 'слабость в руке', 'скорая', 'задыхаюсь'];
    if (emergencyKeywords.some(k => lowerMsg.includes(k))) {
      return `🚨 **ВНИМАНИЕ! Это может быть экстренная ситуация.**

Немедленно звоните **112** или обратитесь в скорую помощь!

${userProfile ? `Пациент: ${userProfile.name || userProfile.full_name || ''}, ${userProfile.age || ''} лет.` : ''}

**Что делать:**
• Не паникуйте
• Вызовите скорую (112)
• До приезда — покой, не ешьте, не пейте
• Если есть назначенные препараты — примите их

⚠️ **Это не медицинская консультация** — требуется срочная помощь врача.`;
    }

    // 2. Анализ конкретных симптомов
    if (lowerMsg.includes('голов') || lowerMsg.includes('мигрен') || lowerMsg.includes('болит голова')) {
      responses.push('Головная боль может быть вызвана множеством причин: стресс, обезвоживание, недосып, проблемы с давлением, мигрень или более серьёзные состояния.');
      responses.push('**Что делать:**\n• Измерьте артериальное давление\n• Выпейте воды (стакан)\n• Отдохните в тёмной тихой комнате\n• Исключите яркие экраны');
      responses.push('**Рекомендуемые анализы:**\n• Общий анализ крови\n• ТТГ (щитовидная железа)\n• Ферритин (исключение анемии)');
      responses.push('**К какому врачу:** терапевт → невролог');
    } else if (lowerMsg.includes('температур') || lowerMsg.includes('лихорадк') || lowerMsg.includes('жар')) {
      responses.push('Повышенная температура — признак воспалительного процесса или инфекции.');
      responses.push('**Что делать:**\n• Измерьте температуру точно\n• Пейте больше жидкости\n• При t > 38.5 — жаропонижающее (парацетамол)');
      responses.push('**Рекомендуемые анализы:**\n• Общий анализ крови\n• С-реактивный белок (СРБ)\n• Лейкоцитарная формула');
      responses.push('**К какому врачу:** терапевт');
    } else if (lowerMsg.includes('устал') || lowerMsg.includes('слабост') || lowerMsg.includes('утомл') || lowerMsg.includes('нет сил')) {
      responses.push('Хроническая усталость может быть признаком дефицита витаминов, анемии, проблем с щитовидной железой или стресса.');
      responses.push('**Рекомендуемые анализы:**\n• Ферритин (скрытый железодефицит)\n• Витамин D (25-OH)\n• Витамин B12\n• ТТГ (щитовидная железа)\n• Общий анализ крови');
      responses.push('**Что делать:**\n• Нормализуйте сон (7-9 часов)\n• Физическая активность 30 мин/день\n• Исключите стресс');
      responses.push('**К какому врачу:** терапевт → эндокринолог');
    } else if (lowerMsg.includes('желуд') || lowerMsg.includes('живот') || lowerMsg.includes('тошнот') || lowerMsg.includes('изжог')) {
      responses.push('Проблемы с ЖКТ требуют дифференциальной диагностики.');
      responses.push('**Рекомендуемые анализы:**\n• АЛТ, АСТ (печень)\n• Амилаза, Липаза (поджелудочная)\n• H. pylori антиген в кале\n• Кальпротектин в кале (воспаление)');
      responses.push('**К какому врачу:** терапевт → гастроэнтеролог');
    } else if (lowerMsg.includes('кашл') || lowerMsg.includes('горл') || lowerMsg.includes('насморк') || lowerMsg.includes('простуд')) {
      responses.push('Симптомы ОРВИ обычно проходят за 7-10 дней. При ухудшении — обратитесь к врачу.');
      responses.push('**Рекомендуемые анализы:**\n• Общий анализ крови\n• С-реактивный белок (СРБ)');
      responses.push('**Что делать:**\n• Обильное питьё\n• Покой\n• Промывание носа солевым раствором');
      responses.push('**К какому врачу:** терапевт');
    } else if (lowerMsg.includes('давлен') || lowerMsg.includes('сердц') || lowerMsg.includes('гипертон')) {
      responses.push('Проблемы с давлением требуют регулярного контроля и обследования.');
      responses.push('**Рекомендуемые анализы:**\n• Липидограмма (холестерин, ЛПНП, ЛПВП, триглицериды)\n• Глюкоза натощак\n• Креатинин (почки)');
      responses.push('**Что делать:**\n• Ведите дневник давления\n• Ограничьте соль (< 5 г/сут)\n• Физическая активность');
      responses.push('**К какому врачу:** терапевт → кардиолог');
    }

    // 3. Поиск по базе database.js
    if (responses.length === 0 && window.labTests) {
      const matchedTests = window.labTests.filter(test => {
        if (!test.aliases) return false;
        return test.aliases.some(alias => lowerMsg.includes(alias.toLowerCase().trim()));
      }).slice(0, 3);

      if (matchedTests.length > 0) {
        responses.push(`**По вашему вопросу релевантны следующие анализы:**\n`);
        responses.push(matchedTests.map(t => {
          const ref = t.references && t.references[0];
          const refStr = ref ? `Норма: ${ref.min}-${ref.max} ${ref.unit}` : '';
          return `• **${t.canonicalName.trim()}** (${t.shortName})\n  ${refStr}`;
        }).join('\n\n'));
        responses.push('Рекомендую сдать эти анализы и проконсультироваться с врачом для интерпретации результатов.');
      }
    }

    // 4. Общий ответ если ничего не нашли
    if (responses.length === 0) {
      responses.push('Я могу помочь вам с медицинскими вопросами:');
      responses.push('• 🔬 **Расшифровка анализов** — объясню значения показателей\n• 🩺 **Анализ симптомов** — подскажу возможные причины и обследования\n• 💊 **Интерпретация отклонений** — что значит повышенный/пониженный показатель\n• 👨‍⚕️ **Подбор специалистов** — к какому врачу обратиться\n• 📋 **Рекомендации** — какие анализы сдать в вашей ситуации');
      responses.push('\n**Попробуйте спросить:**\n• "Болит голова третий день"\n• "Расшифруй повышенный холестерин"\n• "Какие анализы сдать при усталости?"\n• "Что значит низкий ферритин?"');
    }

    responses.push('\n⚠️ **Это не медицинская консультация.** Для точного диагноза и лечения обратитесь к врачу.');
    
    return responses.join('\n\n');
  }

  // ═══════════════════════════════════════
  //  Главная функция отправки сообщения
  // ═══════════════════════════════════════
  async function sendMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new Error('Пустое сообщение');
    }

    // Загружаем профиль
    let userProfile = null;
    try {
      if (window.PatientProfile && window.PatientProfile.get) {
        userProfile = window.PatientProfile.get();
      }
    } catch(e) {}

    // Добавляем в историю
    chatHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    });

    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }

    // Формируем контекст
    const dbContext = buildContextFromDatabase(userMessage, userProfile);

    // Формируем сообщения для LLM
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + dbContext },
      ...chatHistory.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }))
    ];

    let reply;
    let source;

    try {
      // Пробуем Edge Function
      const result = await callEdgeFunction(messages);
      reply = result.reply;
      source = 'gemini';
    } catch (e) {
      console.warn('Edge Function failed, using fallback:', e.message);
      // Fallback на локальные ответы
      reply = generateFallbackResponse(userMessage, userProfile);
      source = 'local';
    }

    // Добавляем ответ в историю
    chatHistory.push({
      role: 'assistant',
      content: reply,
      source: source,
      timestamp: Date.now()
    });

    saveHistory();

    return { reply, source };
  }

  // ═══════════════════════════════════════
  //  Сохранение и загрузка истории
  // ═══════════════════════════════════════
  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory));
    } catch(e) {
      console.warn('Failed to save chat history:', e);
    }
  }

  function loadHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        chatHistory = JSON.parse(saved);
      }
    } catch(e) {
      chatHistory = [];
    }
  }

  function clearHistory() {
    chatHistory = [];
    localStorage.removeItem(STORAGE_KEY);
  }

  // ═══════════════════════════════════════
  //  Инициализация
  // ═══════════════════════════════════════
  loadHistory();

  // ═══════════════════════════════════════
  //  Экспорт API
  // ═══════════════════════════════════════
  window.AIAssistant = {
    sendMessage,
    getHistory: () => [...chatHistory],
    clearHistory,
    version: '1.0.0'
  };

  console.log('🤖 AI Assistant v1.0 initialized (RAG + Edge Function + Fallback)');
})();