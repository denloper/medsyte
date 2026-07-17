// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'meta-llama/llama-4-maverick:free',
  'tencent/hy3:free'
];

// ═══════════════════════════════════════
//  УЛУЧШЕННАЯ ПОЧИНКА ОБРЕЗАННОГО JSON
// ═══════════════════════════════════════
function repairTruncatedJSON(str) {
  if (!str) return null;

  let s = str.trim();

  // Убираем markdown обёртки
  if (s.startsWith('```json')) {
    s = s.replace(/^```json\s*/, '');
  } else if (s.startsWith('```')) {
    s = s.replace(/^```\s*/, '');
  }
  if (s.endsWith('```')) {
    s = s.replace(/\s*```$/, '');
  }
  s = s.trim();

  // Попытка 1: парсим как есть
  try {
    return JSON.parse(s);
  } catch (e) {
    console.log('⚠️ JSON.parse failed:', e.message);
  }

  // Попытка 2: если начинается с { — пробуем починить
  if (s.startsWith('{')) {
    // Ищем все завершённые объекты тестов
    const lastTestMatch = s.match(/,\s*\{\s*"name"[^{}]*\}\s*(?=,|\s*\]|\s*\})/g);

    if (lastTestMatch && lastTestMatch.length > 0) {
      const lastTest = lastTestMatch[lastTestMatch.length - 1];
      const lastTestEnd = s.lastIndexOf(lastTest) + lastTest.length;
      const truncated = s.substring(0, lastTestEnd) + '], "patientInfo": {}, "labName": null, "analysisDate": null, "confidence": 0.5, "_truncated": true}';

      try {
        const parsed = JSON.parse(truncated);
        if (parsed.tests && Array.isArray(parsed.tests) && parsed.tests.length > 0) {
          parsed._truncated = true;
          return parsed;
        }
      } catch (e) {
        console.log('⚠️ Repair attempt 1 failed:', e.message);
      }
    }

    // Попытка 3: ищем последний } перед обрезом
    const lastBraceIdx = s.lastIndexOf('}');
    if (lastBraceIdx > 0) {
      const truncated = s.substring(0, lastBraceIdx + 1) + '], "_truncated": true}';
      try {
        const parsed = JSON.parse(truncated);
        if (parsed.tests && Array.isArray(parsed.tests)) {
          parsed._truncated = true;
          return parsed;
        }
      } catch (e) {
        console.log('⚠️ Repair attempt 2 failed:', e.message);
      }
    }
  }

  // Попытка 4: если начинается с [ (массив тестов)
  if (s.startsWith('[')) {
    const lastBraceIdx = s.lastIndexOf('}');
    if (lastBraceIdx > 0) {
      const truncated = s.substring(0, lastBraceIdx + 1) + ']';
      try {
        const arr = JSON.parse(truncated);
        if (Array.isArray(arr)) {
          return { tests: arr, _truncated: true, patientInfo: {}, labName: null, analysisDate: null };
        }
      } catch (e) {
        console.log('⚠️ Repair attempt 3 failed:', e.message);
      }
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, messages, pdfText, patientSex, patientAge, pdfUnitsMap } = await req.json();

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY не настроен');
    }

    // ═══════════════════════════════════════
    //  ДЕЙСТВИЕ 1: ПАРСИНГ PDF
    // ═══════════════════════════════════════
    if (action === 'parse_pdf') {
      console.log('📄 Parsing PDF...');
      console.log('📏 PDF text length:', pdfText?.length || 0, 'chars');
      console.log('🔍 PDF units map keys:', Object.keys(pdfUnitsMap || {}).length);

      // Обрезаем PDF если слишком большой (лимит ~60000 символов = ~15000 токенов)
      let truncatedPdfText = pdfText || '';
      if (truncatedPdfText.length > 60000) {
        console.warn(`⚠️ PDF text too long (${truncatedPdfText.length}), truncating to 60000`);
        truncatedPdfText = truncatedPdfText.substring(0, 60000);
      }

      const knownTests = [
        // ОАК
        { name: "Гемоглобин", shortName: "HGB", units: ["г/л", "g/L"], range: "муж 130-170, жен 120-150 г/л" },
        { name: "Эритроциты", shortName: "RBC", units: ["×10^12/л"], range: "муж 4.3-5.7, жен 3.8-5.1" },
        { name: "Гематокрит", shortName: "HCT", units: ["%"], range: "муж 40-50, жен 36-46" },
        { name: "MCV", shortName: "MCV", units: ["фл", "fL"], range: "80-100" },
        { name: "MCH", shortName: "MCH", units: ["пг", "pg"], range: "27-34" },
        { name: "MCHC", shortName: "MCHC", units: ["г/л"], range: "320-360" },
        { name: "Тромбоциты", shortName: "PLT", units: ["×10^9/л"], range: "150-400" },
        { name: "Лейкоциты", shortName: "WBC", units: ["×10^9/л"], range: "4.0-9.0" },
        { name: "Нейтрофилы, %", shortName: "NEUT%", units: ["%"], range: "40-75" },
        { name: "Нейтрофилы, абс.", shortName: "NEUT#", units: ["×10^9/л"], range: "1.8-7.5" },
        { name: "Лимфоциты, %", shortName: "LYMPH%", units: ["%"], range: "20-45" },
        { name: "Лимфоциты, абс.", shortName: "LYMPH#", units: ["×10^9/л"], range: "1.0-4.0" },
        { name: "Моноциты, %", shortName: "MONO%", units: ["%"], range: "2-10" },
        { name: "Эозинофилы, %", shortName: "EO%", units: ["%"], range: "0-5" },
        { name: "Базофилы, %", shortName: "BASO%", units: ["%"], range: "0-1" },
        { name: "СОЭ", shortName: "ESR", units: ["мм/ч"], range: "муж 0-15, жен 0-20" },
        // Биохимия
        { name: "Глюкоза натощак", shortName: "GLU", units: ["ммоль/л", "mg/dL"], range: "3.9-5.5 ммоль/л" },
        { name: "Гликированный гемоглобин", shortName: "HbA1c", units: ["%"], range: "4.0-5.6" },
        { name: "Инсулин натощак", shortName: "Insulin", units: ["мкЕд/мл"], range: "2.6-24.9" },
        { name: "Холестерин общий", shortName: "TC", units: ["ммоль/л", "mg/dL"], range: "0-5.2 ммоль/л" },
        { name: "Холестерин ЛПНП", shortName: "LDL-C", units: ["ммоль/л"], range: "0-3.0" },
        { name: "Холестерин ЛПВП", shortName: "HDL-C", units: ["ммоль/л"], range: "муж >1.0, жен >1.2" },
        { name: "Триглицериды", shortName: "TG", units: ["ммоль/л"], range: "0-1.7" },
        { name: "АЛТ", shortName: "АЛТ", units: ["Ед/л", "U/L"], range: "муж 0-41, жен 0-33" },
        { name: "АСТ", shortName: "АСТ", units: ["Ед/л", "U/L"], range: "муж 0-40, жен 0-32" },
        { name: "ГГТ", shortName: "ГГТ", units: ["Ед/л", "U/L"], range: "муж 0-60, жен 0-40" },
        { name: "Щелочная фосфатаза", shortName: "ЩФ", units: ["Ед/л"], range: "40-150" },
        { name: "Билирубин общий", shortName: "TBIL", units: ["мкмоль/л"], range: "3.4-20.5" },
        { name: "Билирубин прямой", shortName: "DBIL", units: ["мкмоль/л"], range: "0-5.1" },
        { name: "Общий белок", shortName: "TP", units: ["г/л"], range: "65-85" },
        { name: "Альбумин", shortName: "ALB", units: ["г/л"], range: "35-50" },
        { name: "Креатинин", shortName: "CREA", units: ["мкмоль/л", "mg/dL"], range: "муж 62-106, жен 44-80 мкмоль/л" },
        { name: "Мочевина", shortName: "UREA", units: ["ммоль/л"], range: "2.5-8.3" },
        { name: "Мочевая кислота", shortName: "UA", units: ["мкмоль/л"], range: "муж 202-416, жен 150-350" },
        { name: "С-реактивный белок", shortName: "CRP", units: ["мг/л"], range: "0-5" },
        { name: "Амилаза", shortName: "AMY", units: ["Ед/л"], range: "28-100" },
        { name: "Липаза", shortName: "LPS", units: ["Ед/л"], range: "0-60" },
        { name: "Фруктозамин", shortName: "Fru", units: ["мкмоль/л"], range: "205-285" },
        // Электролиты
        { name: "Калий", shortName: "K", units: ["ммоль/л", "mEq/L"], range: "3.5-5.1" },
        { name: "Натрий", shortName: "Na", units: ["ммоль/л", "mEq/L"], range: "136-145" },
        { name: "Хлор", shortName: "Cl", units: ["ммоль/л", "mEq/L"], range: "98-107" },
        { name: "Магний", shortName: "Mg", units: ["ммоль/л"], range: "0.75-1.25" },
        { name: "Кальций общий", shortName: "Ca", units: ["ммоль/л"], range: "2.15-2.55" },
        { name: "Фосфор", shortName: "P", units: ["ммоль/л"], range: "0.81-1.45" },
        // Железо
        { name: "Ферритин", shortName: "Ferritin", units: ["нг/мл", "мкг/л"], range: "муж 30-400, жен 15-150 нг/мл" },
        { name: "Железо сывороточное", shortName: "Fe", units: ["мкмоль/л"], range: "муж 11.6-31.3, жен 9.0-30.4" },
        { name: "ОЖСС", shortName: "TIBC", units: ["мкмоль/л"], range: "45-76" },
        { name: "Трансферрин", shortName: "Transferrin", units: ["г/л"], range: "2.15-3.65" },
        // Щитовидка
        { name: "ТТГ", shortName: "ТТГ", units: ["мМЕ/л", "mIU/L"], range: "0.4-4.0" },
        { name: "Тироксин свободный", shortName: "св. Т4", units: ["пмоль/л", "ng/dL"], range: "10-22 пмоль/л" },
        { name: "Трийодтиронин свободный", shortName: "св. Т3", units: ["пмоль/л", "pg/mL"], range: "3.5-6.5 пмоль/л" },
        { name: "Паратиреоидный гормон", shortName: "PTH", units: ["пмоль/л"], range: "1.7-6.4" },
        // Витамины
        { name: "25-гидроксивитамин D", shortName: "25(OH)D", units: ["нг/мл", "нмоль/л"], range: "30-100 нг/мл" },
        { name: "Витамин B12", shortName: "B12", units: ["пг/мл", "пмоль/л"], range: "200-900 пг/мл" },
        { name: "Фолиевая кислота", shortName: "Folate", units: ["нг/мл"], range: "3-17" },
        // Гормоны
        { name: "Тестостерон общий", shortName: "Testo", units: ["нмоль/л", "нг/мл", "пг/мл"], range: "муж 8-35 нмоль/л или 2800-10000 пг/мл" },
        { name: "ГСПГ", shortName: "SHBG", units: ["нмоль/л"], range: "муж 13-71, жен 18-114" },
        { name: "Эстрадиол", shortName: "E2", units: ["пмоль/л", "пг/мл"], range: "муж 40-160 пмоль/л или 10-50 пг/мл" },
        { name: "Пролактин", shortName: "PRL", units: ["мЕд/л"], range: "муж 50-400, жен 50-500" },
        { name: "Кортизол", shortName: "Cortisol", units: ["нмоль/л", "мкг/дл", "пг/мл"], range: "140-690 нмоль/л" },
        { name: "Прогестерон", shortName: "Progesterone", units: ["пг/мл", "нмоль/л"], range: "муж 100-500 пг/мл" },
        { name: "ДГЭА-С", shortName: "DHEA-S", units: ["мкмоль/л"], range: "муж 2.5-14.5, жен 1.8-11.0" },
        { name: "Андростендион", shortName: "A4", units: ["нг/мл"], range: "муж 2.0-8.5, жен 1.5-7.0" },
        { name: "ЛГ", shortName: "ЛГ", units: ["МЕ/л"], range: "муж 1.5-9.3, жен 1.7-15.0" },
        { name: "ФСГ", shortName: "ФСГ", units: ["МЕ/л"], range: "муж 1.4-15.4, жен 1.4-20.0" },
        // Кардио
        { name: "Тропонин", shortName: "Tn", units: ["нг/л"], range: "0-14" },
        { name: "D-димер", shortName: "D-dimer", units: ["мкг/мл FEU"], range: "0-0.5" },
        { name: "ПСА общий", shortName: "PSA", units: ["нг/мл"], range: "0-4.0" }
      ];

      const knownTestsList = knownTests.map(t =>
        `- ${t.name} (${t.shortName}) → единицы: [${t.units.join(', ')}] | ${t.range}`
      ).join('\n');

      // Список единиц из PDF
      const pdfUnitsList = pdfUnitsMap && Object.keys(pdfUnitsMap).length > 0
        ? Object.entries(pdfUnitsMap).map(([name, unit]) => `- ${name} → ${unit}`).join('\n')
        : 'Единицы не определены заранее — смотри внимательно в самом PDF';

      const parsePrompt = `Ты — эксперт-парсер медицинских лабораторных PDF. Твоя задача — идеально точно извлечь ВСЕ лабораторные показатели из документа.

## СТРОГИЕ ПРАВИЛА

1. **Читай внимательно** — в PDF данные часто идут колонками:
   \`Название теста | Результат | Единицы | Референс\`

2. **Извлекай ТОЛЬКО реальные данные из документа**. НЕ выдумывай значения.

3. **Единицы измерения** — копируй ИМЕННО те, что в PDF (не меняй их!).
   - Если в PDF "10⁹/л" — пиши "10⁹/л" (с надстрочной 9)
   - Если в PDF "×10^9/л" — пиши "×10^9/л"
   - Если в PDF "г/л" — пиши "г/л"

4. **Референсные значения** — бери из PDF если есть. Если нет — ставь null.

5. **status** определяй так:
   - "normal" если значение в пределах [referenceMin, referenceMax]
   - "high" если значение > referenceMax
   - "low" если значение < referenceMin
   - "unknown" если нет референсных значений

6. **Если не уверен** в значении или единице — **НЕ добавляй этот тест в JSON**. Лучше вернуть меньше тестов, но точно.

## ФОРМАТ ОТВЕТА

ТОЛЬКО валидный JSON без markdown обёрток (\`\`\`json ... \`\`\`). Без комментариев.

{
  "tests": [
    {
      "name": "Лейкоциты",
      "shortName": "WBC",
      "value": 4.97,
      "unit": "×10^9/л",
      "referenceMin": 4.5,
      "referenceMax": 11.0,
      "status": "normal"
    },
    {
      "name": "Гемоглобин",
      "shortName": "HGB",
      "value": 150,
      "unit": "г/л",
      "referenceMin": 131,
      "referenceMax": 172,
      "status": "normal"
    }
  ],
  "patientInfo": { "sex": "male", "age": 35 },
  "labName": "Название лаборатории или null",
  "analysisDate": "YYYY-MM-DD или null"
}

## ВАЖНО

- Возвращай ВСЕ тесты, которые есть в документе
- Значения должны быть **числами** (не строками): 4.97, не "4.97"
- null для отсутствующих значений (не "null", а null без кавычек)
- Убедись что JSON корректно закрыт: все скобки и кавычки закрыты

📏 ЕДИНИЦЫ ИЗ PDF (используй их если найдены):
${pdfUnitsList}

📋 ИЗВЕСТНЫЕ ТЕСТЫ (для нормализации имён):
${knownTestsList}

## ТЕКСТ PDF ДЛЯ АНАЛИЗА

"""
${truncatedPdfText}
"""

## ПАЦИЕНТ

Пол: ${patientSex || 'unknown'}
Возраст: ${patientAge || '?'} лет

Возвращай ТОЛЬКО JSON.`;

      const promptMessages = [{ role: 'user', content: parsePrompt }];

      // Пробуем несколько раз если ответ невалидный
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔄 Parse attempt ${attempt}/3`);

        const result = await callOpenRouter(promptMessages, OPENROUTER_API_KEY, 'parse_pdf');

        if (result.success && result.data) {
          console.log(`✅ Parse successful on attempt ${attempt}`);
          return new Response(
            JSON.stringify({
              success: true,
              data: result.data,
              model: result.model,
              attempt: attempt
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.warn(`⚠️ Attempt ${attempt} failed:`, result.error);

        if (attempt < 3) {
          // Делаем промпт более строгим
          promptMessages[0].content = parsePrompt + '\n\n⚠️ КРИТИЧЕСКИ ВАЖНО: Возвращай ТОЛЬКО валидный JSON без markdown! Проверь что все скобки закрыты!';
        }
      }

      // Все попытки провалились
      return new Response(
        JSON.stringify({
          success: false,
          error: 'AI не смог вернуть валидный JSON после 3 попыток',
          data: { tests: [], patientInfo: {}, labName: null, analysisDate: null, confidence: 0 }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ═══════════════════════════════════════
    //  ДЕЙСТВИЕ 2: ЧАТ
    // ═══════════════════════════════════════
    if (action === 'chat' || messages) {
      console.log('💬 Chat mode activated');

      const systemPrompt = {
        role: 'system',
        content: `Ты — медицинский AI-ассистент в приложении "Семейный доктор". Работаешь в чате (chat.html).

СТРОГИЕ ПРАВИЛА:
1. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
2. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
3. Для тревожных симптомов (боль в груди, одышка, потеря сознания, кровь) — немедленно советуй вызвать 112
4. НЕ назначай лечение без консультации врача
5. Отвечай ТОЛЬКО на русском языке
6. Используй markdown: **жирный** для важного, • для списков

ФОРМАТ ОТВЕТА:
- 📊 Краткий анализ (2-3 предложения)
- 🔍 Возможные причины (список через •)
- 🧪 Рекомендуемые анализы
- 💊 Рекомендации
- 👨‍⚕️ К какому врачу
- ⚕️ Дисклеймер в конце`
      };

      const fullMessages = [systemPrompt, ...messages];
      return await callOpenRouter(fullMessages, OPENROUTER_API_KEY, 'chat');
    }

    throw new Error('Unknown action: ' + action);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ═══════════════════════════════════════
//  ВЫЗОВ OPENROUTER
// ═══════════════════════════════════════
async function callOpenRouter(messages, apiKey, actionType) {
  let lastError = null;
  let usedModel = null;
  let reply = null;

  for (const model of MODELS) {
    try {
      console.log(`🤖 Trying: ${model} (action: ${actionType})`);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://denloper.github.io',
          'X-Title': 'Medical AI Assistant'
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: actionType === 'parse_pdf' ? 0 : 0.7,  // 0 для детерминированности
          max_tokens: actionType === 'parse_pdf' ? 32768 : 4096,  // ← 32768 вместо 8192
          top_p: 0.95
        })
      });

      if (!response.ok) {
        let errorMsg = response.statusText;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorMsg;
        } catch {}

        console.warn(`⚠️ ${model} failed (${response.status}): ${errorMsg}`);
        lastError = errorMsg;
        continue;
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        console.warn(`⚠️ ${model} returned empty choices`);
        lastError = 'Empty response';
        continue;
      }

      reply = data.choices[0]?.message?.content;
      usedModel = model;

      if (!reply || reply.trim() === '') {
        console.warn(`⚠️ ${model} returned empty content`);
        lastError = 'Empty content';
        continue;
      }

      console.log(`✅ SUCCESS with ${model}, reply length: ${reply.length}`);
      break;
    } catch (modelError) {
      console.error(`❌ ${model} error:`, modelError.message);
      lastError = modelError.message;
      continue;
    }
  }

  if (!reply) {
    console.error('❌ All models failed. Last error:', lastError);
    return { success: false, error: `Все модели недоступны: ${lastError}` };
  }

  // Для парсинга PDF — пытаемся извлечь JSON
  if (actionType === 'parse_pdf') {
    console.log('🔍 Parsing JSON from AI response...');
    console.log('📏 Raw reply length:', reply.length, 'chars');

    const parsed = repairTruncatedJSON(reply);

    if (parsed && parsed.tests && Array.isArray(parsed.tests) && parsed.tests.length > 0) {
      console.log(`✅ Parsed ${parsed.tests.length} tests`);
      if (parsed._truncated) {
        console.warn('⚠️ JSON was truncated, but we recovered partial data');
        delete parsed._truncated;
      }
      return { success: true, data: parsed, model: usedModel };
    }

    console.error('❌ Failed to parse JSON');
    console.error('Raw reply (first 500 chars):', reply.substring(0, 500));
    console.error('Raw reply (last 200 chars):', reply.substring(reply.length - 200));

    return {
      success: false,
      error: `AI вернул невалидный JSON. Длина ответа: ${reply.length}`,
      rawReply: reply.substring(0, 10000)
    };
  }

  // Для обычного чата
  return new Response(
    JSON.stringify({
      reply,
      success: true,
      source: 'openrouter',
      model: usedModel
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}