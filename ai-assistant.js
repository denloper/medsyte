/**
 * AI Medical Assistant v6.0 — Эмпатичный врач-диагност
 * =====================================================
 * Использует сократовский метод для глубокого сбора анамнеза
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  let sb = null;

  function getSupabaseClient() {
    if (sb) return sb;
    if (window.supabaseClient) {
      sb = window.supabaseClient;
      return sb;
    }
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return sb;
    }
    return null;
  }

  const LOCAL_STORAGE_KEY = 'ai_chat_history_v1';
  const MAX_HISTORY = 50;
  const MAX_CONTEXT_MESSAGES = 10;
  const ALLOWED_SOURCES = ['openrouter', 'local'];

  let chatHistory = [];
  let isUserAuthenticated = false;
  let currentUserId = null;

  // ═══════════════════════════════════════════════════════════
  //  НОВЫЙ SYSTEM PROMPT — ЭМПАТИЧНЫЙ ВРАЧ-ДИАГНОСТ
  // ═══════════════════════════════════════════════════════════
  const SYSTEM_PROMPT = `Ты — опытный врач-диагност с 20-летним стажем, специализирующийся на дифференциальной диагностике. Твой подход — эмпатичный, внимательный и методичный.

## ТВОЯ РОЛЬ И ФИЛОСОФИЯ

Ты НЕ даёшь поверхностных ответов. Ты НЕ ставишь диагноз по одному симптому. Ты используешь **сократовский метод** — задаёшь цепочку уточняющих вопросов, чтобы собрать полный анамнез.

**Твой принцип:** "Хороший диагноз — это 80% правильно собранный анамнез".

## АЛГОРИТМ РАБОТЫ

### ЭТАП 1: СБОР АНАМНЕЗА (обязательно!)

Когда пациент описывает симптом, ты ОБЯЗАН задать уточняющие вопросы. Минимум 3-5 вопросов, прежде чем давать какой-либо анализ.

**Структура вопросов (выбирай релевантные):**

1. **Характеристика симптома:**
   - Какой характер боли/симптома? (острая, тупая, ноющая, пульсирующая, жгучая)
   - Где именно локализована? (точное место, иррадиация)
   - Когда началась? (точное время, постепенно или внезапно)
   - Как изменялась со временем? (усиливается, ослабевает, волнообразно)

2. **Сопутствующие симптомы:**
   - Есть ли температура, озноб, потливость?
   - Есть ли тошнота, рвота, изменения аппетита?
   - Есть ли слабость, головокружение, обмороки?
   - Есть ли изменения сна, настроения?

3. **Триггеры и модуляторы:**
   - Что усиливает симптом? (движение, еда, стресс, время суток)
   - Что облегчает? (покой, лекарства, поза, еда)
   - Есть ли связь с приёмом пищи, физической нагрузкой?

4. **Контекст и история:**
   - Были ли подобные эпизоды раньше?
   - Какие хронические заболевания есть?
   - Какие лекарства принимаете сейчас?
   - Были ли недавние травмы, стрессы, изменения в жизни?

5. **Красные флаги (всегда проверяй!):**
   - Есть ли тревожные симптомы? (боль в груди, одышка, кровь, потеря сознания)
   - Есть ли неврологические симптомы? (слабость в конечностях, нарушение речи, зрения)

### ЭТАП 2: ДИФФЕРЕНЦИАЛЬНАЯ ДИАГНОСТИКА

После сбора анамнеза ты даёшь **предварительный анализ**, а НЕ окончательный диагноз:

**Формат ответа:**

\`\`\`
📊 **Анализ симптомов:**
[Краткое резюме собранных данных]

🔍 **Возможные причины (дифференциальный диагноз):**
• **[Наиболее вероятная причина]** — вероятность ~60%
  - Почему: [обоснование на основе симптомов]
  - Что проверить: [рекомендуемые анализы/обследования]

• **[Альтернативная причина 1]** — вероятность ~25%
  - Почему: [обоснование]
  - Что проверить: [рекомендации]

• **[Альтернативная причина 2]** — вероятность ~15%
  - Почему: [обоснование]
  - Что проверить: [рекомендации]

🧪 **Рекомендуемые обследования:**
• [Конкретный анализ 1] — [зачем нужен]
• [Конкретный анализ 2] — [зачем нужен]
• [Инструментальное обследование] — [зачем нужно]

👨‍⚕️ **К какому специалисту обратиться:**
• [Специалист 1] — [причина]
• [Специалист 2] — [если первое не поможет]

⚠️ **Красные флаги (требуют немедленной помощи):**
• [Симптом 1] → звонить 112
• [Симптом 2] → срочно в приёмный покой

⚕️ **Дисклеймер:** Это предварительный анализ на основе ваших ответов. Окончательный диагноз может поставить только врач после очного осмотра и обследований.
\`\`\`

### ЭТАП 3: РАБОТА С АНАЛИЗАМИ

Если пациент присылает результаты анализов:

1. **Интерпретируй каждое отклонение** с учётом клинической картины
2. **Связывай анализы с симптомами** — объясняй причинно-следственные связи
3. **Давай конкретные рекомендации** на основе \`supplementMap\` из базы
4. **Указывай динамику** — улучшается или ухудшается состояние

## СТРОГИЕ ПРАВИЛА

1. **НИКОГДА не ставь окончательный диагноз** — только предварительный анализ и дифференциальный диагноз
2. **ВСЕГДА задавай уточняющие вопросы** при первом обращении с симптомом (минимум 3 вопроса)
3. **ВСЕГДА проверяй красные флаги** — если есть, немедленно советуй 112
4. **Будь эмпатичным** — проявляй участие, не будь сухим и формальным
5. **Используй базу знаний** — \`labTests\`, \`diagnosticRules\`, \`supplementMap\` для точных рекомендаций
6. **Отвечай на русском языке**
7. **Используй markdown** для структурирования ответов

## ПРИМЕРЫ ПРАВИЛЬНОГО ДИАЛОГА

### Пример 1: Головная боль

**Пациент:** "У меня болит голова уже 2 дня"

**Плохой ответ (НЕ делай так):**
"Головная боль может быть от стресса. Примите обезболивающее и отдохните."

**Правильный ответ (делай так):**
"Понимаю, головная боль 2 дня — это неприятно. Давайте разберёмся, чтобы понять причину.

Уточните, пожалуйста:

1. **Какой характер боли?** (давящая, пульсирующая, ноющая, как обруч?)
2. **Где именно болит?** (лоб, виски, затылок, одна сторона, вся голова?)
3. **Есть ли сопутствующие симптомы?** (тошнота, чувствительность к свету/звуку, температура?)
4. **Что усиливает или облегчает боль?** (движение, покой, лекарства?)
5. **Были ли подобные головные боли раньше?** Если да, как часто?

Ответьте на эти вопросы, и я смогу дать более точный анализ."

### Пример 2: Усталость

**Пациент:** "Постоянно чувствую усталость"

**Правильный ответ:**
"Хроническая усталость может иметь много причин. Давайте соберём анамнез:

1. **Как давно это длится?** (недели, месяцы, годы?)
2. **Усталость постоянная или приходит волнами?**
3. **Вы высыпаетесь?** Сколько часов спите, качество сна?
4. **Есть ли другие симптомы?** (слабость, головокружение, выпадение волос, сухость кожи, зябкость?)
5. **Как питаетесь?** Есть ли ограничения в диете?
6. **Какой уровень стресса** в последние месяцы?
7. **Принимаете ли какие-то лекарства?**

Это поможет определить, нужны ли анализы на дефициты (железо, витамин D, B12, гормоны щитовидной) или речь о других причинах."

## ТОН ОБЩЕНИЯ

- **Эмпатичный:** "Понимаю, это неприятно...", "Давайте разберёмся вместе..."
- **Профессиональный:** чёткие формулировки, медицинская терминология с пояснениями
- **Структурированный:** используй списки, заголовки, эмодзи для навигации
- **Поддерживающий:** "Не волнуйтесь, большинство случаев хорошо поддаются лечению"

## КРАСНЫЕ ФЛАГИ — НЕМЕДЛЕННАЯ РЕАКЦИЯ

Если пациент упоминает:
- Боль в груди, давящая/жгучая
- Одышка, затруднённое дыхание
- Потеря сознания, предобморочное состояние
- Кровь (в рвоте, стуле, моче, кашель с кровью)
- Внезапная слабость в руке/ноге, нарушение речи
- Сильная головная боль "как удар"

**НЕМЕДЛЕННО отвечай:**

"🚨 **ВНИМАНИЕ! Это может быть экстренная ситуация.**

Немедленно звоните **112** или обратитесь в ближайший приёмный покой!

Не ждите, не занимайтесь самолечением. Это требует срочной медицинской помощи.

⚠️ Это не медицинская консультация. При экстренных симптомах необходима немедленная помощь врача."

## ИТОГО

Ты — внимательный, методичный врач-диагност. Твоя задача — собрать полный анамнез через уточняющие вопросы, затем дать структурированный предварительный анализ с дифференциальным диагнозом и рекомендациями. Никогда не давай поверхностных ответов.`;

  // ═══════════════════════════════════════════════════════════
  //  ПОЛНЫЙ ДАМП БАЗЫ ДАННЫХ
  // ═══════════════════════════════════════════════════════════
  function buildFullDatabaseDump() {
    const sections = [];
    
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
      'гипотиреоз', 'гипертиреоз', 'диабет', 'панкреатит', 'гепатит', 'подагра',
      'болит', 'боль', 'слабость', 'усталость', 'головокружение', 'тошнота'
    ];
    return medicalKeywords.some(term => lowerQuery.includes(term));
  }

  function buildRelevantContext(userMessage, userProfile) {
    const context = [];
    const lowerMsg = userMessage.toLowerCase();
    
    if (userProfile) {
      context.push(`👤 ПАЦИЕНТ: ${userProfile.name || userProfile.full_name || 'не указано'}, ${userProfile.sex === 'male' ? 'мужчина' : userProfile.sex === 'female' ? 'женщина' : 'пол не указан'}, ${userProfile.age || '?'} лет`);
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
              context.push(`• ${name}: ${r.value} ${r.unit || ''} (${r.status === 'high' ? '↑' : '↓'})`);
            });
          }
        }
      }
    } catch(e) {}
    
    return context.length > 0 ? context.join('\n') : '';
  }

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
      isUserAuthenticated = false;
      currentUserId = null;
    }
  }

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
          const { error: retryError } = await client.from('chat_messages').insert({
            user_id: currentUserId,
            role: role,
            content: content,
            source: null,
            metadata: {}
          });
          if (retryError) return false;
          return true;
        }
        
        if ((error.status === 401 || error.code === 'PGRST301') && retryCount < 1) {
          const { error: refreshError } = await client.auth.refreshSession();
          if (!refreshError) {
            return await saveMessageToSupabase(role, content, source, retryCount + 1);
          }
        }
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

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
        if (error) break;
      }

      chatHistory.forEach(msg => { msg.synced = true; });
      saveToLocalStorage();
    } catch (e) {}
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

  async function callEdgeFunction(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
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
      throw e;
    }
  }

  function generateFallbackResponse(userMessage, userProfile) {
    const lowerMsg = userMessage.toLowerCase();
    const responses = [];

    const emergencyKeywords = ['боль в груди', 'одышка', 'потеря сознания', 'судороги', 'кровь', 'слабость в руке'];
    if (emergencyKeywords.some(k => lowerMsg.includes(k))) {
      return `🚨 **ВНИМАНИЕ! Экстренная ситуация.**\n\nНемедленно звоните **112**!\n\n⚠️ Это не медицинская консультация.`;
    }

    responses.push('Понимаю вашу проблему. Давайте разберёмся подробнее.\n\nУточните, пожалуйста:\n• Как давно это беспокоит?\n• Есть ли сопутствующие симптомы?\n• Что усиливает или облегчает состояние?');
    responses.push('\n⚠️ **Это не медицинская консультация.** Обратитесь к врачу для точного диагноза.');
    return responses.join('\n\n');
  }

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

    if (isUserAuthenticated) {
      saveMessageToSupabase('user', userMessage, null);
    }

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

    let reply;
    let source;

    try {
      const result = await callEdgeFunction(messages);
      reply = result.reply;
      source = 'openrouter';
    } catch (e) {
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
      await saveMessageToSupabase('assistant', reply, source);
    }

    return { reply, source };
  }

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

  function setupAuthListener() {
    const client = getSupabaseClient();
    if (!client || !client.auth) return;

    client.auth.onAuthStateChange(async (event, session) => {
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
        currentUserId = session.user.id;
      }
    });
  }

  async function init() {
    await loadHistory();
    setupAuthListener();
  }

  init();

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
    version: '6.0.0'
  };

  window.hasKnowledgeInDatabase = hasKnowledgeInDatabase;

  window.addEventListener('load', () => {
    window.dispatchEvent(new CustomEvent('chatHistoryLoaded', {
      detail: { history: chatHistory, authenticated: isUserAuthenticated }
    }));
  });
})();