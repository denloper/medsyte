/**
 * AI Medical Assistant v4.0
 * Гибридная архитектура:
 * - Приоритет 1: Внутренняя база знаний (database.js)
 * - Приоритет 2: Импортированные PDF документы
 * - Приоритет 3: Поиск в интернете (только медицинские запросы)
 * - OpenRouter с приоритетом google/gemma-4-26b-a4b-it:free
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  // ✅ Используем единый Supabase клиент из supabase-client.js
  const sb = window.supabaseClient || null;

  if (!sb) {
    console.warn('⚠️ Supabase client not available. Chat sync disabled.');
  } else {
    console.log('✅ AI Assistant: using shared Supabase client');
  }

  const LOCAL_STORAGE_KEY = 'ai_chat_history_v1';
  const IMPORTED_PDFS_KEY = 'imported_medical_pdfs';
  const MAX_HISTORY = 50;
  const MAX_CONTEXT_MESSAGES = 10;

  // Допустимые значения для constraint `source`
  const ALLOWED_SOURCES = ['gemini', 'groq', 'openrouter', 'local', 'deepseek', 'llama', 'gemma', 'medical-search'];

  let chatHistory = [];
  let isUserAuthenticated = false;
  let currentUserId = null;

  // ═══════════════════════════════════════
  //  СИСТЕМНЫЙ ПРОМПТ (с приоритетом базы знаний)
  // ═══════════════════════════════════════
  const SYSTEM_PROMPT = `📌 БАЗА ЗНАНИЙ: Ты имеешь доступ к двум источникам медицинских данных:
1. 📊 **Встроенная база** (database.js) — 71 лабораторный тест, 17 диагностических правил, 27 рекомендаций по добавкам
2. 📄 **Импортированные PDF** — медицинские учебники, клинические рекомендации, протоколы лечения

**ПРИОРИТЕТ ИСТОЧНИКОВ:**
- 🥇 **ПЕРВЫМ ДЕЛОМ** используй данные из импортированных PDF (помечены 📄 [из PDF])
- 🥈 **ВТОРЫМ ДЕЛОМ** используй встроенную базу (помечены 📊 [база])
- 🥉 Если информации нет в обоих источниках — честно скажи: "В моей базе знаний нет данных по этому вопросу. Я могу найти актуальную информацию в медицинских источниках (UpToDate, ВОЗ, PubMed) — хотите?"

**СТРОГИЕ ПРАВИЛА:**
1. НИКОГДА не выдумывай нормы, дозировки или диагнозы
2. ВСЕГДА указывай источник информации (📄 [из PDF] или 📊 [база])
3. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
4. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
5. Для тревожных симптомов (боль в груди, одышка, потеря сознания, кровь) — немедленно советуй вызвать 112
6. НЕ назначай лечение и лекарства без консультации врача — только общие рекомендации
7. Отвечай ТОЛЬКО на русском языке
8. Используй markdown: **жирный** для важного, • для списков

**ФОРМАТ ОТВЕТА:**
- 📊 Краткий анализ ситуации (2-3 предложения)
- 🔍 Возможные причины (список через •)
- 🧪 Рекомендуемые анализы (с указанием источника: 📄 или 📊)
- 💊 Рекомендации по лечению (с указанием источника)
- 👨‍⚕️ К какому врачу обратиться
- ⚕️ Дисклеймер в конце

**ВАЖНО:** Если вопрос касается конкретного лекарства, протокола лечения или клинической рекомендации — ищи в первую очередь в импортированных PDF документах.`;

  // ═══════════════════════════════════════
  //  ОБЪЕДИНЁННАЯ БАЗА ЗНАНИЙ (database.js + импортированные PDF)
  // ═══════════════════════════════════════
  function getCombinedKnowledgeBase() {
    const combined = {
      tests: [],
      diagnoses: [],
      treatments: [],
      drugs: [],
      guidelines: [],
      sources: []
    };

    // 1. Встроенная база (database.js)
    if (window.labTests && Array.isArray(window.labTests)) {
      combined.tests = window.labTests.map(t => ({ ...t, source: 'database.js' }));
    }
    if (window.diagnosticRules && Array.isArray(window.diagnosticRules)) {
      combined.diagnoses = window.diagnosticRules.map(r => ({ ...r, source: 'database.js' }));
    }
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      combined.treatments = Object.entries(window.supplementMap).map(([test, data]) => ({
        test, recommendations: data, source: 'database.js'
      }));
    }

    // 2. Импортированные PDF из localStorage
    try {
      const importedData = localStorage.getItem(IMPORTED_PDFS_KEY);
      if (importedData) {
        const imported = JSON.parse(importedData);
        if (imported.tests) combined.tests = combined.tests.concat(imported.tests.map(t => ({ ...t, source: 'imported_pdf' })));
        if (imported.diagnoses) combined.diagnoses = combined.diagnoses.concat(imported.diagnoses.map(d => ({ ...d, source: 'imported_pdf' })));
        if (imported.treatments) combined.treatments = combined.treatments.concat(imported.treatments.map(t => ({ ...t, source: 'imported_pdf' })));
        if (imported.drugs) combined.drugs = imported.drugs.map(d => ({ ...d, source: 'imported_pdf' }));
        if (imported.guidelines) combined.guidelines = imported.guidelines.map(g => ({ ...g, source: 'imported_pdf' }));
        if (imported.documents) combined.sources = imported.documents;
      }
    } catch (e) {
      console.warn('⚠️ Failed to load imported PDFs:', e);
    }

    return combined;
  }

  // ═══════════════════════════════════════
  //  ПРОВЕРКА: есть ли информация в базе знаний
  // ═══════════════════════════════════════
  function hasKnowledgeInDatabase(query) {
    if (!query) return false;
    const lowerQuery = query.toLowerCase();
    const kb = getCombinedKnowledgeBase();

    // Поиск по тестам (database.js + PDF)
    const testMatch = kb.tests.some(test => {
      const name = (test.canonicalName || test.name || '').toLowerCase();
      const short = (test.shortName || '').toLowerCase();
      const aliases = (test.aliases || []).map(a => a.toLowerCase());
      return name.includes(lowerQuery) || short.includes(lowerQuery) || 
             aliases.some(alias => alias.includes(lowerQuery));
    });
    if (testMatch) return true;

    // Поиск по диагностическим правилам
    const ruleMatch = kb.diagnoses.some(rule => {
      const name = (rule.name || '').toLowerCase();
      const tests = Object.keys(rule.results || {}).map(k => k.toLowerCase());
      return name.includes(lowerQuery) || tests.some(t => t.includes(lowerQuery));
    });
    if (ruleMatch) return true;

    // Поиск по supplementMap
    const supplementMatch = kb.treatments.some(t => 
      (t.test || '').toLowerCase().includes(lowerQuery)
    );
    if (supplementMatch) return true;

    // Поиск по лекарствам (из PDF)
    const drugMatch = kb.drugs.some(d => 
      (d.name || '').toLowerCase().includes(lowerQuery)
    );
    if (drugMatch) return true;

    // Медицинские ключевые слова
    const medicalKeywords = [
      'анемия', 'гемоглобин', 'холестерин', 'сахар', 'ттг', 'витамин d',
      'железо', 'липидограмма', 'почки', 'печень', 'щитовидка', 'тропонин',
      'соэ', 'лейкоциты', 'эозинофилы', 'алт', 'аст', 'креатинин', 'мочевина',
      'ферритин', 'билирубин', 'глюкоза', 'инсулин', 'кортизол', 'тестостерон',
      'гипотиреоз', 'гипертиреоз', 'диабет', 'панкреатит', 'гепатит', 'подагра'
    ];
    return medicalKeywords.some(term => lowerQuery.includes(term));
  }

  // ═══════════════════════════════════════
  //  ПОСТРОЕНИЕ КОНТЕКСТА ИЗ ОБЪЕДИНЁННОЙ БАЗЫ
  // ═══════════════════════════════════════
  function buildRelevantContext(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();
    const kb = getCombinedKnowledgeBase();

    // 1. Профиль пациента
    if (userProfile) {
      context.push(`👤 ПАЦИЕНТ: ${userProfile.name || userProfile.full_name || 'не указано'}, ${userProfile.sex === 'male' ? 'мужчина' : userProfile.sex === 'female' ? 'женщина' : 'пол не указан'}, ${userProfile.age || '?'} лет`);
    }

    // 2. Источники базы знаний
    if (kb.sources.length > 0) {
      context.push(`\n📚 ИСТОЧНИКИ БАЗЫ ЗНАНИЙ (импортированные PDF):`);
      kb.sources.slice(0, 5).forEach(src => {
        context.push(`• ${src.fileName || src.title || 'Документ'}`);
      });
    }

    // 3. Релевантные тесты (до 10)
    const relevantTests = [];
    kb.tests.forEach(test => {
      const name = (test.canonicalName || test.name || '').toLowerCase();
      const short = (test.shortName || '').toLowerCase();
      const aliases = (test.aliases || []).map(a => a.toLowerCase());
      const matched = name.includes(lowerMsg) || short.includes(lowerMsg) ||
                      aliases.some(alias => lowerMsg.includes(alias));
      if (matched && relevantTests.length < 10) {
        relevantTests.push(test);
      }
    });
    if (relevantTests.length > 0) {
      context.push(`\n🧪 РЕЛЕВАНТНЫЕ ТЕСТЫ:`);
      relevantTests.forEach(t => {
        const ref = t.references && t.references[0];
        const tag = t.source === 'imported_pdf' ? '📄 [PDF]' : '📊 [база]';
        const normStr = ref ? `${ref.min}-${ref.max} ${ref.unit || ''}`.trim() : '—';
        context.push(`• ${t.canonicalName || t.name} (${t.shortName || ''}): норма ${normStr} ${tag}`);
      });
    }

    // 4. Диагностические правила
    const relevantDiagnoses = [];
    kb.diagnoses.forEach(rule => {
      const name = (rule.name || '').toLowerCase();
      const testsMatch = rule.results && Object.keys(rule.results).some(test => 
        lowerMsg.includes(test.toLowerCase())
      );
      if ((name.includes(lowerMsg) || testsMatch) && relevantDiagnoses.length < 5) {
        relevantDiagnoses.push(rule);
      }
    });
    if (relevantDiagnoses.length > 0) {
      context.push(`\n🏥 ВОЗМОЖНЫЕ СОСТОЯНИЯ:`);
      relevantDiagnoses.forEach(r => {
        const tag = r.source === 'imported_pdf' ? '📄 [PDF]' : '📊 [база]';
        context.push(`• ${r.name} (уровень: ${r.danger}) → ${(r.doctors || []).join(', ')} ${tag}`);
      });
    }

    // 5. Рекомендации по добавкам
    const relevantTreatments = [];
    kb.treatments.forEach(t => {
      if ((t.test || '').toLowerCase().includes(lowerMsg) && relevantTreatments.length < 5) {
        relevantTreatments.push(t);
      }
    });
    if (relevantTreatments.length > 0) {
      context.push(`\n💊 РЕКОМЕНДАЦИИ:`);
      relevantTreatments.forEach(t => {
        const tag = t.source === 'imported_pdf' ? '📄 [PDF]' : '📊 [база]';
        Object.entries(t.recommendations || {}).forEach(([status, rec]) => {
          const statusRu = status === 'high' ? '↑ повышен' : '↓ понижен';
          context.push(`• ${t.test} (${statusRu}): ${rec.supplement || 'консультация'} → ${(rec.doctors || []).join(', ')} ${tag}`);
        });
      });
    }

    // 6. Лекарства (из PDF)
    if (kb.drugs.length > 0) {
      const relevantDrugs = kb.drugs.filter(d => 
        (d.name || '').toLowerCase().includes(lowerMsg)
      ).slice(0, 5);
      if (relevantDrugs.length > 0) {
        context.push(`\n💊 ЛЕКАРСТВА:`);
        relevantDrugs.forEach(d => {
          context.push(`• ${d.name}: ${d.description || ''} ${d.dosage ? `(доза: ${d.dosage})` : ''} 📄 [PDF]`);
        });
      }
    }

    // 7. Клинические рекомендации (из PDF)
    if (kb.guidelines.length > 0) {
      const relevantGuidelines = kb.guidelines.filter(g => {
        const title = (g.title || '').toLowerCase();
        const content = (g.content || '').toLowerCase();
        return title.includes(lowerMsg) || content.includes(lowerMsg);
      }).slice(0, 3);
      if (relevantGuidelines.length > 0) {
        context.push(`\n📋 КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ:`);
        relevantGuidelines.forEach(g => {
          context.push(`• ${g.title}: ${(g.content || '').slice(0, 300)}... 📄 [PDF]`);
        });
      }
    }

    // 8. Последние анализы пользователя из localStorage
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
              context.push(`• ${name}: ${r.value} ${r.unit || ''} (${r.status === 'high' ? '↑' : '↓'})`);
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
  //  СОХРАНЕНИЕ СООБЩЕНИЯ В SUPABASE (с retry)
  // ═══════════════════════════════════════
  async function saveMessageToSupabase(role, content, source = null, retryCount = 0) {
    if (!isUserAuthenticated || !sb || !currentUserId) return false;

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || user.id !== currentUserId) {
        isUserAuthenticated = false;
        return false;
      }

      // Валидация source под constraint
      const safeSource = (source && ALLOWED_SOURCES.includes(source)) ? source : null;

      const { error } = await sb.from('chat_messages').insert({
        user_id: currentUserId,
        role: role,
        content: content,
        source: safeSource,
        metadata: {}
      });

      if (error) {
        // Retry с source = null при constraint error
        if (error.message && error.message.includes('check constraint') && retryCount === 0) {
          console.log('🔄 Retrying with source = null...');
          const { error: retryError } = await sb.from('chat_messages').insert({
            user_id: currentUserId,
            role: role,
            content: content,
            source: null,
            metadata: {}
          });
          if (retryError) {
            console.error('❌ Retry failed:', retryError.message);
            return false;
          }
          return true;
        }
        
        // Refresh token при 401
        if ((error.status === 401 || error.code === 'PGRST301') && retryCount < 1) {
          const { error: refreshError } = await sb.auth.refreshSession();
          if (!refreshError) {
            return await saveMessageToSupabase(role, content, source, retryCount + 1);
          }
        }
        console.warn(`⚠️ Failed to save ${role}:`, error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`⚠️ Exception saving ${role}:`, e.message);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  МИГРАЦИЯ ЛОКАЛЬНОЙ ИСТОРИИ В SUPABASE
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
        source: (msg.source && ALLOWED_SOURCES.includes(msg.source)) ? msg.source : null,
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
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      console.log(`🤖 Calling Edge Function (payload: ${JSON.stringify(messages).length} chars)...`);

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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.success && data.reply) {
        return {
          reply: data.reply,
          source: 'openrouter',
          model: data.model || 'unknown'
        };
      }

      throw new Error(data.error || 'Пустой ответ от AI');
    } catch (e) {
      clearTimeout(timeout);
      console.error('❌ Edge Function error:', e.message);
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
      responses.push('**Рекомендуемые анализы 📊 [база]:**\n• Гемоглобин (HGB): 130-170 г/л (муж) / 120-150 г/л (жен)\n• ТТГ: 0.4-4.0 мМЕ/л\n• Ферритин: 30-400 нг/мл (муж) / 15-150 нг/мл (жен)');
      responses.push('**Врач:** терапевт → невролог');
    } else if (lowerMsg.includes('температур')) {
      responses.push('Повышенная температура — признак воспаления или инфекции.');
      responses.push('**Рекомендуемые анализы 📊 [база]:**\n• Лейкоциты (WBC): 4.0-9.0 ×10⁹/л\n• С-реактивный белок (CRP): 0-5 мг/л\n• СОЭ: до 15 мм/ч (муж) / до 20 мм/ч (жен)');
      responses.push('**Врач:** терапевт');
    } else if (lowerMsg.includes('устал') || lowerMsg.includes('слабост')) {
      responses.push('Хроническая усталость — частый признак дефицитов.');
      responses.push('**Рекомендуемые анализы 📊 [база]:**\n• Ферритин: 30-400 нг/мл (муж) / 15-150 нг/мл (жен)\n• 25(OH)D: 30-100 нг/мл\n• B12: 200-900 пг/мл\n• ТТГ: 0.4-4.0 мМЕ/л');
      responses.push('**Врач:** терапевт → эндокринолог');
    } else if (lowerMsg.includes('анализ') || lowerMsg.includes('какие')) {
      responses.push('В моей базе есть следующие категории анализов 📊 [база]:\n• ОАК (гемоглобин, эритроциты, лейкоциты)\n• Биохимия (глюкоза, АЛТ, АСТ, креатинин)\n• Липидограмма (холестерин, ЛПНП, ЛПВП)\n• Щитовидная железа (ТТГ, Т4, Т3)\n• Витамины (D, B12, фолаты)\n• Электролиты (K, Na, Ca, Mg)');
      responses.push('Опишите симптомы — я подскажу конкретные анализы.');
    }

    if (responses.length === 0) {
      responses.push('Я могу помочь с:\n• 🔬 Расшифровкой анализов\n• 🩺 Анализом симптомов\n• 💊 Рекомендациями при отклонениях\n• 👨‍⚕️ Подбором специалистов');
      responses.push('\n**Примеры:**\n• "Болит голова"\n• "Что значит повышенный ферритин?"\n• "Какие анализы сдать при усталости?"');
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

    await checkAuth();

    if (!isUserAuthenticated) {
      console.log('ℹ️ Пользователь не авторизован — история сохраняется только локально');
    }

    let userProfile = null;
    try {
      if (window.PatientProfile && window.PatientProfile.get) {
        userProfile = window.PatientProfile.get();
      }
    } catch(e) {}

    // Добавляем сообщение пользователя
    const userMsg = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      synced: false
    };
    chatHistory.push(userMsg);
    saveToLocalStorage();

    if (isUserAuthenticated) {
      saveMessageToSupabase('user', userMessage, null);
    }

    // Определяем тип запроса
    const isMedicalQuery = hasKnowledgeInDatabase(userMessage);

    // Строим контекст из объединённой базы
    const relevantContext = buildRelevantContext(userMessage, userProfile);

    // Формируем финальный system prompt
    let finalSystemPrompt = SYSTEM_PROMPT;
    
    if (isMedicalQuery) {
      finalSystemPrompt += `\n\n📌 ВАЖНО: Это медицинский запрос. Вы должны использовать ТОЛЬКО данные из предоставленной базы знаний. Не выдумывайте нормы или интерпретации. Если информации нет в контексте — честно скажите: "В моей базе знаний нет данных по этому вопросу. Я могу найти актуальную информацию в медицинских источниках — хотите?"`;
    } else {
      finalSystemPrompt += `\n\n🔍 Это общий вопрос. Если он не относится к медицине — вежливо предложите задать медицинский вопрос. Если вопрос медицинский, но в базе нет данных — используйте актуальные медицинские источники (UpToDate, ВОЗ, NIH, Cochrane, PubMed), но всегда указывайте источник и год публикации.`;
    }

    if (relevantContext) {
      finalSystemPrompt += `\n\n═══════════════════════════════════\nКОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ:\n═══════════════════════════════════\n${relevantContext}`;
    }

    const messages = [
      { role: 'system', content: finalSystemPrompt },
      ...chatHistory.slice(-MAX_CONTEXT_MESSAGES).map(m => ({
        role: m.role,
        content: m.content
      }))
    ];

    console.log('📊 System prompt size:', finalSystemPrompt.length, 'chars (~' + Math.ceil(finalSystemPrompt.length / 4) + ' tokens)');

    let reply;
    let source;

    try {
      console.log('🤖 Calling Edge Function (OpenRouter)...');
      const result = await callEdgeFunction(messages);
      reply = result.reply;
      source = 'openrouter';
      console.log('✅ OpenRouter response received:', reply.slice(0, 100));
    } catch (e) {
      console.warn('⚠️ Edge Function failed, using fallback:', e.message);
      reply = generateFallbackResponse(userMessage, userProfile);
      source = 'local';
    }

    // Добавляем ответ ассистента
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

    if (isUserAuthenticated) {
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
    
    const kb = getCombinedKnowledgeBase();
    console.log('🤖 AI Assistant v4.0 initialized (Hybrid: DB + PDF + Internet)');
    console.log(`📚 Database: ${window.labTests?.length || 0} tests, ${window.diagnosticRules?.length || 0} rules, ${Object.keys(window.supplementMap || {}).length} supplements`);
    console.log(`📄 Imported PDFs: ${kb.sources.length} docs, ${kb.drugs.length} drugs, ${kb.guidelines.length} guidelines`);
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
    hasKnowledgeInDatabase,
    getCombinedKnowledgeBase,
    getDatabaseStats: () => {
      const kb = getCombinedKnowledgeBase();
      return {
        builtin_tests: window.labTests?.length || 0,
        builtin_rules: window.diagnosticRules?.length || 0,
        builtin_supplements: Object.keys(window.supplementMap || {}).length,
        imported_documents: kb.sources.length,
        imported_drugs: kb.drugs.length,
        imported_guidelines: kb.guidelines.length
      };
    },
    isSupabaseConnected: () => !!sb,
    version: '4.0.0'
  };

  // Глобальный доступ к функции проверки базы
  window.hasKnowledgeInDatabase = hasKnowledgeInDatabase;

  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();