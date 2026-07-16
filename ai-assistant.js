/**
 * AI Medical Assistant v5.0
 * =========================
 * Полная передача database.js в ИИ + AI-парсинг PDF + Supabase синхронизация
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ SUPABASE КЛИЕНТА
  // ═══════════════════════════════════════
  let sb = null;

  function getSupabaseClient() {
    if (sb) return sb;
    if (window.supabaseClient) {
      sb = window.supabaseClient;
      console.log('✅ AI Assistant: подключён к общему Supabase клиенту');
      return sb;
    }
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      console.log('✅ AI Assistant: создан собственный Supabase клиент');
      return sb;
    }
    console.warn('⚠️ Supabase client not available');
    return null;
  }

  const initialClient = getSupabaseClient();

  const LOCAL_STORAGE_KEY = 'ai_chat_history_v1';
  const IMPORTED_PDFS_KEY = 'imported_medical_pdfs';
  const MAX_HISTORY = 50;
  const MAX_CONTEXT_MESSAGES = 5;

  const ALLOWED_SOURCES = ['gemini', 'groq', 'openrouter', 'local', 'deepseek', 'llama', 'gemma', 'medical-search'];

  let chatHistory = [];
  let isUserAuthenticated = false;
  let currentUserId = null;

  // ═══════════════════════════════════════
  //  СИСТЕМНЫЙ ПРОМПТ
  // ═══════════════════════════════════════
  const SYSTEM_PROMPT = `📌 БАЗА ЗНАНИЙ: Ты — медицинский AI-ассистент в приложении "Семейный доктор".

Тебе предоставлена **ПОЛНАЯ БАЗА ДАННЫХ** database.js в следующем сообщении. Она содержит:
- 🧪 Все лабораторные тесты с синонимами (aliases), единицами измерения и референсными диапазонами
- 🏥 Все диагностические правила (комбинации отклонений → диагнозы)
- 💊 Полная карта рекомендаций при отклонениях (supplementMap) с описаниями, опасностями и назначениями
- 🛡 Профилактические рекомендации

**КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА РАБОТЫ С БАЗОЙ:**
1. ✅ Используй ТОЧНЫЕ данные из предоставленной базы — НЕ ВЫДУМЫВАЙ нормы, дозировки или диагнозы
2. ✅ При упоминании теста используй его ТОЧНОЕ canonicalName из базы
3. ✅ Учитывай пол и возраст пациента при выборе референсного диапазона
4. ✅ Синонимы (aliases) помогают понять, о каком тесте говорит пользователь
5. ✅ Если теста нет в базе — честно скажи об этом
6. ✅ Для интерпретации используй interpretationBands если они есть (например, преддиабет, диабет)

**СТРОГИЕ МЕДИЦИНСКИЕ ПРАВИЛА:**
1. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
2. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
3. Для тревожных симптомов (боль в груди, одышка, потеря сознания, кровь) — немедленно советуй вызвать 112
4. НЕ назначай лечение и лекарства без консультации врача — только общие рекомендации
5. Отвечай ТОЛЬКО на русском языке
6. Используй markdown: **жирный** для важного, • для списков

**ФОРМАТ ОТВЕТА:**
- 📊 Краткий анализ ситуации (2-3 предложения)
- 🔍 Возможные причины (список через •)
- 🧪 Рекомендуемые анализы (с указанием норм из базы и единиц измерения)
- 💊 Рекомендации (с указанием источника: supplementMap)
- 👨‍⚕️ К какому врачу обратиться
- ⚕️ Дисклеймер в конце`;

  // ═══════════════════════════════════════
  //  ПОЛНЫЙ ДАМП БАЗЫ ДАННЫХ (database.js)
  //  Передаёт ВСЕ данные из файла в ИИ
  // ═══════════════════════════════════════
  function buildFullDatabaseDump() {
    const sections = [];
    
    // ═══════ 1. ВСЕ ЛАБОРАТОРНЫЕ ТЕСТЫ ═══════
    if (window.labTests && Array.isArray(window.labTests)) {
      sections.push(`🧪 ПОЛНАЯ БАЗА ЛАБОРАТОРНЫХ ТЕСТОВ (${window.labTests.length} тестов):`);
      
      window.labTests.forEach(test => {
        let testStr = `\n### ${test.canonicalName.trim()}`;
        if (test.shortName) testStr += ` [${test.shortName.trim()}]`;
        testStr += ` (категория: ${test.category.trim()})`;
        
        if (test.aliases && test.aliases.length > 0) {
          const cleanAliases = test.aliases.map(a => a.trim()).filter(a => a);
          testStr += `\n  Синонимы: ${cleanAliases.join(', ')}`;
        }
        
        if (test.units && test.units.length > 0) {
          const cleanUnits = test.units.map(u => u.trim()).filter(u => u);
          testStr += `\n  Единицы: ${cleanUnits.join(', ') || 'безразмерный'}`;
        }
        
        if (test.references && test.references.length > 0) {
          testStr += `\n  Референсы:`;
          test.references.forEach(ref => {
            const sexRu = ref.sex === 'male' ? 'муж' : 
                         ref.sex === 'female' ? 'жен' : 'любой';
            const ageRange = `${ref.ageMin}-${ref.ageMax} лет`;
            const minStr = ref.min !== null && ref.min !== undefined ? ref.min : '—';
            const maxStr = ref.max !== null && ref.max !== undefined ? ref.max : '∞';
            testStr += `\n    • ${sexRu}, ${ageRange}: ${minStr} — ${maxStr} ${ref.unit?.trim() || ''}`;
          });
        }
        
        if (test.interpretationBands && test.interpretationBands.length > 0) {
          testStr += `\n  Клинические интерпретации:`;
          test.interpretationBands.forEach(band => {
            let range = '';
            if (band.min !== undefined && band.max !== undefined) {
              range = `${band.min} — ${band.max} ${band.unit?.trim() || ''}`;
            } else if (band.max !== undefined) {
              range = `до ${band.max} ${band.unit?.trim() || ''}`;
            } else if (band.min !== undefined) {
              range = `от ${band.min} ${band.unit?.trim() || ''}`;
            }
            testStr += `\n    • ${band.label.trim()}: ${range}`;
          });
        }
        
        sections.push(testStr);
      });
    }
    
    // ═══════ 2. ВСЕ ДИАГНОСТИЧЕСКИЕ ПРАВИЛА ═══════
    if (window.diagnosticRules && Array.isArray(window.diagnosticRules)) {
      sections.push(`\n\n🏥 ДИАГНОСТИЧЕСКИЕ ПРАВИЛА (${window.diagnosticRules.length} правил):`);
      
      window.diagnosticRules.forEach(rule => {
        const testsStr = Object.entries(rule.results || {}).map(([testName, status]) => {
          const statusRu = status === 'high' ? '↑ повышен' : 
                           status === 'low' ? '↓ понижен' : status;
          return `${testName.trim()} ${statusRu}`;
        }).join(', ');
        
        const dangerRu = rule.danger === 'high' ? 'высокая' : 
                         rule.danger === 'medium' ? 'средняя' : 'низкая';
        
        const doctorsRu = (rule.doctors || []).map(d => d.trim()).join(', ');
        
        sections.push(`\n• ${rule.name.trim()} (опасность: ${dangerRu})`);
        sections.push(`  Условия: ${testsStr}`);
        sections.push(`  Врачи: ${doctorsRu || 'не указаны'}`);
      });
    }
    
    // ═══════ 3. ВСЕ РЕКОМЕНДАЦИИ ПО ДОБАВКАМ ═══════
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      const keys = Object.keys(window.supplementMap);
      sections.push(`\n\n💊 РЕКОМЕНДАЦИИ ПРИ ОТКЛОНЕНИЯХ (${keys.length} тестов):`);
      
      keys.forEach(testName => {
        const testMap = window.supplementMap[testName];
        sections.push(`\n### ${testName.trim()}:`);
        
        Object.entries(testMap).forEach(([status, rec]) => {
          const statusRu = status === 'high' ? 'ПОВЫШЕН ↑' : 
                           status === 'low' ? 'ПОНИЖЕН ↓' : status;
          const dangerRu = rec.danger === 'high' ? 'высокая' : 
                           rec.danger === 'medium' ? 'средняя' : 'низкая';
          const doctorsRu = (rec.doctors || []).map(d => d.trim()).join(', ');
          
          sections.push(`\n  **${statusRu}** (опасность: ${dangerRu})`);
          if (rec.supplement) sections.push(`    💊 Рекомендация: ${rec.supplement.trim()}`);
          if (rec.description) sections.push(`    📖 Описание: ${rec.description.trim()}`);
          if (rec.dangerDesc) sections.push(`    ⚠️ Опасность: ${rec.dangerDesc.trim()}`);
          if (rec.duration) sections.push(`    ⏱ Длительность: ${rec.duration.trim()}`);
          if (rec.note) sections.push(`    📝 Примечание: ${rec.note.trim()}`);
          if (doctorsRu) sections.push(`    👨‍⚕️ Врачи: ${doctorsRu}`);
        });
      });
    }
    
    // ═══════ 4. ПРОФИЛАКТИЧЕСКИЕ РЕКОМЕНДАЦИИ ═══════
    if (window.preventiveRecommendations && Array.isArray(window.preventiveRecommendations)) {
      sections.push(`\n\n🛡 ПРОФИЛАКТИЧЕСКИЕ РЕКОМЕНДАЦИИ (${window.preventiveRecommendations.length}):`);
      
      window.preventiveRecommendations.forEach(rec => {
        const doctorsRu = (rec.doctors || []).map(d => d.trim()).join(', ');
        sections.push(`\n• ${rec.supplement.trim()}`);
        if (rec.duration) sections.push(`  ⏱ Длительность: ${rec.duration.trim()}`);
        if (rec.note) sections.push(`  📝 ${rec.note.trim()}`);
        if (doctorsRu) sections.push(`  👨‍⚕️ Врачи: ${doctorsRu}`);
      });
    }
    
    return sections.join('\n');
  }

  // ═══════════════════════════════════════
  //  ПРОВЕРКА: есть ли информация в базе
  // ═══════════════════════════════════════
  function hasKnowledgeInDatabase(query) {
    if (!query) return false;
    const lowerQuery = query.toLowerCase();
    
    if (window.labTests && Array.isArray(window.labTests)) {
      const testMatch = window.labTests.some(test => {
        const name = (test.canonicalName || '').toLowerCase();
        const short = (test.shortName || '').toLowerCase();
        const aliases = (test.aliases || []).map(a => a.toLowerCase());
        return name.includes(lowerQuery) || short.includes(lowerQuery) || 
               aliases.some(alias => alias.includes(lowerQuery));
      });
      if (testMatch) return true;
    }
    
    if (window.diagnosticRules && Array.isArray(window.diagnosticRules)) {
      const ruleMatch = window.diagnosticRules.some(rule => {
        const name = (rule.name || '').toLowerCase();
        const tests = Object.keys(rule.results || {}).map(k => k.toLowerCase());
        return name.includes(lowerQuery) || tests.some(t => t.includes(lowerQuery));
      });
      if (ruleMatch) return true;
    }
    
    if (window.supplementMap && typeof window.supplementMap === 'object') {
      const supplementMatch = Object.keys(window.supplementMap).some(key => 
        key.toLowerCase().includes(lowerQuery)
      );
      if (supplementMatch) return true;
    }
    
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
  //  ПОСТРОЕНИЕ РЕЛЕВАНТНОГО КОНТЕКСТА
  // ═══════════════════════════════════════
  function buildRelevantContext(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();
    
    if (userProfile) {
      context.push(`👤 ПАЦИЕНТ: ${userProfile.name || userProfile.full_name || 'не указано'}, ${userProfile.sex === 'male' ? 'мужчина' : userProfile.sex === 'female' ? 'женщина' : 'пол не указан'}, ${userProfile.age || '?'} лет`);
    }
    
    // Импортированные PDF
    try {
      const importedData = localStorage.getItem(IMPORTED_PDFS_KEY);
      if (importedData) {
        const imported = JSON.parse(importedData);
        if (imported.documents && imported.documents.length > 0) {
          context.push(`\n📚 ИСТОЧНИКИ БАЗЫ ЗНАНИЙ (импортированные PDF):`);
          imported.documents.slice(0, 5).forEach(src => {
            context.push(`• ${src.fileName || src.title || 'Документ'}`);
          });
        }
        
        // Ищем релевантные тесты из PDF
        if (imported.tests) {
          const relevantTests = imported.tests.filter(test => {
            const name = (test.name || test.canonicalName || '').toLowerCase();
            return name.includes(lowerMsg);
          }).slice(0, 5);
          
          if (relevantTests.length > 0) {
            context.push(`\n🧪 РЕЛЕВАНТНЫЕ ТЕСТЫ ИЗ PDF:`);
            relevantTests.forEach(t => {
              context.push(`• ${t.name || t.canonicalName} (${t.shortName || ''}): ${t.description || ''} 📄 [PDF]`);
            });
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to load imported PDFs:', e);
    }
    
    // Последние анализы из localStorage
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
    const client = getSupabaseClient();
    if (!client) {
      isUserAuthenticated = false;
      currentUserId = null;
      return;
    }
    try {
      const { data: { user }, error } = await client.auth.getUser();
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
    const client = getSupabaseClient();
    if (!isUserAuthenticated || !client || !currentUserId) return false;
    try {
      const { data: { user } } = await client.auth.getUser();
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
      const { data, error } = await client
        .from('chat_messages')
        .select('role, content, source, created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY);

      if (error) {
        if (error.status === 401 || error.code === 'PGRST301') {
          const { error: refreshError } = await client.auth.refreshSession();
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
    const client = getSupabaseClient();
    if (!isUserAuthenticated || !client || !currentUserId) return false;

    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user || user.id !== currentUserId) {
        isUserAuthenticated = false;
        return false;
      }

      const safeSource = (source && ALLOWED_SOURCES.includes(source)) ? source : null;

      const { error } = await client.from('chat_messages').insert({
        user_id: currentUserId,
        role: role,
        content: content,
        source: safeSource,
        metadata: {}
      });

      if (error) {
        if (error.message && error.message.includes('check constraint') && retryCount === 0) {
          console.log('🔄 Retrying with source = null...');
          const { error: retryError } = await client.from('chat_messages').insert({
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
        
        if ((error.status === 401 || error.code === 'PGRST301') && retryCount < 1) {
          const { error: refreshError } = await client.auth.refreshSession();
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
  //  МИГРАЦИЯ ЛОКАЛЬНОЙ ИСТОРИИ
  // ═══════════════════════════════════════
  async function migrateLocalHistoryToSupabase() {
    const client = getSupabaseClient();
    if (!isUserAuthenticated || !client || !currentUserId) return;
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
        const { error } = await client.from('chat_messages').insert(batch);
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
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      console.log(`🤖 Calling Edge Function (payload: ${JSON.stringify(messages).length} chars)...`);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ action: 'chat', messages }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.success && data.reply) {
        return { reply: data.reply, source: 'openrouter', model: data.model || 'unknown' };
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

    const isMedicalQuery = hasKnowledgeInDatabase(userMessage);

    // ПОЛНЫЙ дамп базы
    const databaseDump = buildFullDatabaseDump();
    const relevantContext = buildRelevantContext(userMessage, userProfile);

    let finalSystemPrompt = SYSTEM_PROMPT;
    
    finalSystemPrompt += `\n\n═══════════════════════════════════\nПОЛНАЯ БАЗА ДАННЫХ:\n═══════════════════════════════════\n${databaseDump}`;
    
    if (relevantContext) {
      finalSystemPrompt += `\n\n═══════════════════════════════════\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ:\n═══════════════════════════════════\n${relevantContext}`;
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
    const client = getSupabaseClient();
    if (isUserAuthenticated && client && currentUserId) {
      try {
        await client.rpc('clear_chat_history');
      } catch (e) {
        try {
          await client.from('chat_messages').delete().eq('user_id', currentUserId);
        } catch (e2) {}
      }
    }
  }

  // ═══════════════════════════════════════
  //  СЛУШАТЕЛЬ АВТОРИЗАЦИИ
  // ═══════════════════════════════════════
  function setupAuthListener() {
    const client = getSupabaseClient();
    if (!client || !client.auth) {
      console.warn('⚠️ Auth listener not available');
      return;
    }

    client.auth.onAuthStateChange(async (event, session) => {
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
    
    const kb = {
      tests: window.labTests?.length || 0,
      rules: window.diagnosticRules?.length || 0,
      supplements: Object.keys(window.supplementMap || {}).length,
      preventive: window.preventiveRecommendations?.length || 0
    };
    
    console.log('🤖 AI Assistant v5.0 initialized (Full DB + OpenRouter + Supabase)');
    console.log(`📚 Database: ${kb.tests} tests, ${kb.rules} rules, ${kb.supplements} supplements`);
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
    getFullDatabaseDump: buildFullDatabaseDump,
    getDatabaseStats: () => ({
      tests: window.labTests?.length || 0,
      rules: window.diagnosticRules?.length || 0,
      supplements: Object.keys(window.supplementMap || {}).length,
      preventive: window.preventiveRecommendations?.length || 0
    }),
    isSupabaseConnected: () => !!getSupabaseClient(),
    version: '5.0.0'
  };

  window.hasKnowledgeInDatabase = hasKnowledgeInDatabase;

  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();