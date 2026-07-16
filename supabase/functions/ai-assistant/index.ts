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
//  ПОЧИНКА ОБРЕЗАННОГО JSON
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
  
  // Пытаемся распарсить как есть
  try {
    return JSON.parse(s);
  } catch (e) {
    // Не получилось — пробуем починить
  }
  
  // Если JSON начинается с { но не заканчивается на }
  if (s.startsWith('{') && !s.endsWith('}')) {
    // Обрезаем до последнего валидного элемента массива tests
    const lastTestIdx = s.lastIndexOf('},');
    if (lastTestIdx > 0) {
      const truncated = s.substring(0, lastTestIdx + 1) + '], "patientInfo": {}, "labName": null, "analysisDate": null, "confidence": 0.5}';
      try {
        const parsed = JSON.parse(truncated);
        parsed._truncated = true;
        return parsed;
      } catch (e) {
        // Не получилось
      }
    }
    
    // Пробуем обрезать до последнего завершённого объекта
    const lastObjIdx = s.lastIndexOf('}');
    if (lastObjIdx > 0) {
      const truncated = s.substring(0, lastObjIdx + 1) + ']}';
      try {
        const parsed = JSON.parse(truncated);
        parsed._truncated = true;
        return parsed;
      } catch (e) {}
    }
  }
  
  // Если JSON начинается с [ (массив тестов)
  if (s.startsWith('[') && !s.endsWith(']')) {
    const lastTestIdx = s.lastIndexOf('},');
    if (lastTestIdx > 0) {
      const truncated = s.substring(0, lastTestIdx + 1) + ']';
      try {
        return { tests: JSON.parse(truncated), _truncated: true };
      } catch (e) {}
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
      
      // Обрезаем PDF текст если слишком большой (лимит ~30000 символов)
      let truncatedPdfText = pdfText || '';
      if (truncatedPdfText.length > 30000) {
        console.warn(`⚠️ PDF text too long (${truncatedPdfText.length}), truncating to 30000`);
        truncatedPdfText = truncatedPdfText.substring(0, 30000);
      }
      
      const knownTests = [
        // ОАК
        { name: "Гемоглобин", shortName: "HGB", units: ["г/л", "g/L"], range: "муж 130-170, жен 120-150 г/л" },
        { name: "Эритроциты", shortName: "RBC", units: ["×10^12/л"], range: "муж 4.3-5.7, жен 3.8-5.1" },
        { name: "Гематокрит", shortName: "HCT", units: ["%"], range: "муж 40-50, жен 36-46" },
        { name: "Тромбоциты", shortName: "PLT", units: ["×10^9/л"], range: "150-400" },
        { name: "Лейкоциты", shortName: "WBC", units: ["×10^9/л"], range: "4.0-9.0" },
        { name: "Нейтрофилы", shortName: "NEUT%", units: ["%"], range: "40-75" },
        { name: "Лимфоциты", shortName: "LYMPH%", units: ["%"], range: "20-45" },
        { name: "СОЭ", shortName: "ESR", units: ["мм/ч"], range: "муж 0-15, жен 0-20" },
        // Биохимия
        { name: "Глюкоза натощак", shortName: "GLU", units: ["ммоль/л", "mg/dL"], range: "3.9-5.5 ммоль/л" },
        { name: "Холестерин общий", shortName: "TC", units: ["ммоль/л", "mg/dL"], range: "0-5.2 ммоль/л" },
        { name: "Холестерин ЛПНП", shortName: "LDL-C", units: ["ммоль/л"], range: "0-3.0" },
        { name: "Холестерин ЛПВП", shortName: "HDL-C", units: ["ммоль/л"], range: "муж >1.0, жен >1.2" },
        { name: "Триглицериды", shortName: "TG", units: ["ммоль/л"], range: "0-1.7" },
        { name: "Аланинаминотрансфераза", shortName: "АЛТ", units: ["Ед/л"], range: "муж 0-41, жен 0-33" },
        { name: "Аспартатаминотрансфераза", shortName: "АСТ", units: ["Ед/л"], range: "муж 0-40, жен 0-32" },
        { name: "Гамма-глутамилтрансфераза", shortName: "ГГТ", units: ["Ед/л"], range: "муж 0-60, жен 0-40" },
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
        // Щитовидка
        { name: "Тиреотропный гормон", shortName: "ТТГ", units: ["мМЕ/л", "mIU/L"], range: "0.4-4.0" },
        { name: "Тироксин свободный", shortName: "св. Т4", units: ["пмоль/л", "ng/dL"], range: "10-22 пмоль/л" },
        { name: "Трийодтиронин свободный", shortName: "св. Т3", units: ["пмоль/л", "pg/mL"], range: "3.5-6.5 пмоль/л" },
        // Витамины
        { name: "25-гидроксивитамин D", shortName: "25(OH)D", units: ["нг/мл", "нмоль/л"], range: "30-100 нг/мл" },
        { name: "Витамин B12", shortName: "B12", units: ["пг/мл", "пмоль/л"], range: "200-900 пг/мл" },
        { name: "Фолиевая кислота", shortName: "Folate", units: ["нг/мл"], range: "3-17" },
        // Гормоны
        { name: "Тестостерон общий", shortName: "Testo", units: ["нмоль/л", "нг/мл", "пг/мл"], range: "муж 8-35 нмоль/л или 2800-10000 пг/мл" },
        { name: "Эстрадиол", shortName: "E2", units: ["пмоль/л", "пг/мл"], range: "муж 40-160 пмоль/л или 10-50 пг/мл" },
        { name: "Пролактин", shortName: "PRL", units: ["мЕд/л"], range: "муж 50-400, жен 50-500" },
        { name: "Кортизол", shortName: "Cortisol", units: ["нмоль/л", "мкг/дл", "пг/мл"], range: "140-690 нмоль/л" },
        { name: "Прогестерон", shortName: "Progesterone", units: ["пг/мл", "нмоль/л"], range: "муж 100-500 пг/мл" },
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

      const parsePrompt = `Ты — медицинский ассистент. Извлеки лабораторные показатели из PDF и верни СТРОГО в JSON формате.

⚠️ ВАЖНО:
1. Возвращай ТОЛЬКО валидный JSON без markdown обёрток (\`\`\`json ... \`\`\`)
2. НЕ добавляй комментарии, пояснения, текст до или после JSON
3. Единицы измерения бери ИМЕННО ТЕ, что указаны в PDF (пг/мл, нг/мл, нмоль/л и т.д.)
4. Референсы должны быть в тех же единицах, что и value
5. Если не можешь определить референс — ставь referenceMin: null, referenceMax: null

ФОРМАТ ОТВЕТА (пример):
{
  "tests": [
    {
      "name": "Тестостерон общий",
      "shortName": "Testo",
      "value": 440.64,
      "unit": "пг/мл",
      "referenceMin": 2800,
      "referenceMax": 10000,
      "status": "low"
    }
  ],
  "patientInfo": { "sex": "male", "age": 35 },
  "labName": "Название лаборатории или null",
  "analysisDate": "YYYY-MM-DD или null",
  "confidence": 0.95
}

📏 ЕДИНИЦЫ ИЗ PDF (используй их!):
${pdfUnitsList}

📋 ИЗВЕСТНЫЕ ТЕСТЫ:
${knownTestsList}

STATUS:
- "normal" — value в [referenceMin, referenceMax]
- "high" — value > referenceMax
- "low" — value < referenceMin
- "unknown" — если нет референса

ТЕКСТ PDF:
"""
${truncatedPdfText}
"""

ПАЦИЕНТ: ${patientSex || 'unknown'}, ${patientAge || '?'} лет

ВОЗВРАЩАЙ ТОЛЬКО JSON. БЕЗ MARKDOWN. БЕЗ ПОЯСНЕНИЙ.`;

      const messages = [{ role: 'user', content: parsePrompt }];
      
      // Пробуем несколько раз если ответ невалидный
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔄 Parse attempt ${attempt}/3`);
        
        const result = await callOpenRouter(messages, OPENROUTER_API_KEY, 'parse_pdf');
        
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
          // Делаем промпт более строгим для следующей попытки
          messages[0].content = parsePrompt + '\n\n⚠️ КРИТИЧЕСКИ ВАЖНО: Возвращай ТОЛЬКО валидный JSON без markdown!';
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
          temperature: actionType === 'parse_pdf' ? 0.05 : 0.7, // Очень низкая для парсинга
          max_tokens: actionType === 'parse_pdf' ? 8192 : 4096, // ← УВЕЛИЧИЛИ до 8192
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
    
    // Пробуем распарсить как есть
    const parsed = repairTruncatedJSON(reply);
    
    if (parsed && parsed.tests && Array.isArray(parsed.tests)) {
      console.log(`✅ Parsed ${parsed.tests.length} tests`);
      if (parsed._truncated) {
        console.warn('⚠️ JSON was truncated, but we recovered partial data');
        delete parsed._truncated;
      }
      return { success: true, data: parsed, model: usedModel };
    }
    
    console.error('❌ Failed to parse JSON');
    console.error('Raw reply (first 500 chars):', reply.substring(0, 500));
    
    return { 
      success: false, 
      error: `AI вернул невалидный JSON. Длина ответа: ${reply.length}`,
      rawReply: reply.substring(0, 1000)
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