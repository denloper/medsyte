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
      console.log('🔍 PDF units map:', pdfUnitsMap || 'not provided');
      
      // Полный список известных тестов из database.js
      const knownTests = [
        // ОАК
        { name: "Гемоглобин", shortName: "HGB", units: ["г/л", "g/L", "г/дл", "g/dL"], male: "130-170 г/л", female: "120-150 г/л" },
        { name: "Эритроциты", shortName: "RBC", units: ["×10^12/л", "10^12/L", "млн/мкл"], male: "4.3-5.7", female: "3.8-5.1" },
        { name: "Гематокрит", shortName: "HCT", units: ["%", "л/л", "L/L"], male: "40-50", female: "36-46" },
        { name: "Средний объём эритроцита", shortName: "MCV", units: ["фл", "fL"], range: "80-100" },
        { name: "Среднее содержание гемоглобина в эритроците", shortName: "MCH", units: ["пг", "pg"], range: "27-34" },
        { name: "Средняя концентрация гемоглобина в эритроците", shortName: "MCHC", units: ["г/л", "g/L", "г/дл", "g/dL"], range: "320-360" },
        { name: "Ширина распределения эритроцитов по объёму", shortName: "RDW-CV", units: ["%"], range: "11.5-14.5" },
        { name: "Ширина распределения эритроцитов RDW-SD", shortName: "RDW-SD", units: ["фл", "fL"], range: "35-56" },
        { name: "Тромбоциты", shortName: "PLT", units: ["×10^9/л", "10^9/L"], range: "150-400" },
        { name: "Лейкоциты", shortName: "WBC", units: ["×10^9/л", "10^9/L"], range: "4.0-9.0" },
        { name: "Нейтрофилы, %", shortName: "NEUT%", units: ["%"], range: "40-75" },
        { name: "Нейтрофилы, абсолютное количество", shortName: "NEUT#", units: ["×10^9/л", "10^9/L"], range: "1.8-7.5" },
        { name: "Лимфоциты, %", shortName: "LYMPH%", units: ["%"], range: "20-45" },
        { name: "Лимфоциты, абсолютное количество", shortName: "LYMPH#", units: ["×10^9/л", "10^9/L"], range: "1.0-4.0" },
        { name: "Моноциты, %", shortName: "MONO%", units: ["%"], range: "2-10" },
        { name: "Эозинофилы, %", shortName: "EO%", units: ["%"], range: "0-5" },
        { name: "Базофилы, %", shortName: "BASO%", units: ["%"], range: "0-1" },
        { name: "СОЭ", shortName: "ESR", units: ["мм/ч", "mm/h"], male: "0-15", female: "0-20" },
        
        // Биохимия
        { name: "Глюкоза натощак", shortName: "GLU", units: ["ммоль/л", "mg/dL", "мг/дл"], range: "3.9-5.5 ммоль/л" },
        { name: "Гликированный гемоглобин", shortName: "HbA1c", units: ["%", "ммоль/моль"], range: "4.0-5.6%" },
        { name: "Инсулин натощак", shortName: "Insulin", units: ["мкЕд/мл", "мЕд/л"], range: "2.6-24.9" },
        { name: "Холестерин общий", shortName: "TC", units: ["ммоль/л", "mg/dL", "мг/дл"], range: "0-5.2 ммоль/л" },
        { name: "Холестерин ЛПНП", shortName: "LDL-C", units: ["ммоль/л", "mg/dL", "мг/дл"], range: "0-3.0 ммоль/л" },
        { name: "Холестерин ЛПВП", shortName: "HDL-C", units: ["ммоль/л", "mg/dL", "мг/дл"], male: ">1.0", female: ">1.2" },
        { name: "Триглицериды", shortName: "TG", units: ["ммоль/л", "mg/dL", "мг/дл"], range: "0-1.7 ммоль/л" },
        { name: "Аланинаминотрансфераза", shortName: "АЛТ", units: ["Ед/л", "U/L"], male: "0-41", female: "0-33" },
        { name: "Аспартатаминотрансфераза", shortName: "АСТ", units: ["Ед/л", "U/L"], male: "0-40", female: "0-32" },
        { name: "Гамма-глутамилтрансфераза", shortName: "ГГТ", units: ["Ед/л", "U/L"], male: "0-60", female: "0-40" },
        { name: "Щелочная фосфатаза", shortName: "ЩФ", units: ["Ед/л", "U/L"], range: "40-150" },
        { name: "Билирубин общий", shortName: "TBIL", units: ["мкмоль/л", "µmol/L", "mg/dL"], range: "3.4-20.5 мкмоль/л" },
        { name: "Билирубин прямой", shortName: "DBIL", units: ["мкмоль/л", "µmol/L", "mg/dL"], range: "0-5.1 мкмоль/л" },
        { name: "Общий белок", shortName: "TP", units: ["г/л", "g/L"], range: "65-85" },
        { name: "Альбумин", shortName: "ALB", units: ["г/л", "g/L"], range: "35-50" },
        { name: "Креатинин", shortName: "CREA", units: ["мкмоль/л", "µmol/L", "mg/dL"], male: "62-106", female: "44-80" },
        { name: "Мочевина", shortName: "UREA", units: ["ммоль/л", "mg/dL", "мг/дл"], range: "2.5-8.3 ммоль/л" },
        { name: "Мочевая кислота", shortName: "UA", units: ["мкмоль/л", "mg/dL", "мг/дл"], male: "202-416", female: "150-350" },
        { name: "С-реактивный белок", shortName: "CRP", units: ["мг/л", "mg/L"], range: "0-5" },
        { name: "Амилаза", shortName: "AMY", units: ["Ед/л", "U/L"], range: "28-100" },
        { name: "Липаза", shortName: "LPS", units: ["Ед/л", "U/L"], range: "0-60" },
        
        // Электролиты
        { name: "Калий", shortName: "K", units: ["ммоль/л", "mEq/L"], range: "3.5-5.1" },
        { name: "Натрий", shortName: "Na", units: ["ммоль/л", "mEq/L"], range: "136-145" },
        { name: "Хлор", shortName: "Cl", units: ["ммоль/л", "mEq/L"], range: "98-107" },
        { name: "Магний", shortName: "Mg", units: ["ммоль/л", "мг/дл", "mg/dL"], range: "0.75-1.25 ммоль/л" },
        { name: "Кальций общий", shortName: "Ca", units: ["ммоль/л", "мг/дл", "mg/dL"], range: "2.15-2.55 ммоль/л" },
        { name: "Фосфор", shortName: "P", units: ["ммоль/л", "мг/дл", "mg/dL"], range: "0.81-1.45 ммоль/л" },
        
        // Железо
        { name: "Ферритин", shortName: "Ferritin", units: ["нг/мл", "µg/L", "мкг/л"], male: "30-400 нг/мл", female: "15-150 нг/мл" },
        { name: "Железо сывороточное", shortName: "Fe", units: ["мкмоль/л", "µmol/L"], male: "11.6-31.3", female: "9.0-30.4" },
        { name: "ОЖСС", shortName: "TIBC", units: ["мкмоль/л", "µmol/L"], range: "45-76" },
        
        // Щитовидная железа
        { name: "Тиреотропный гормон", shortName: "ТТГ", units: ["мМЕ/л", "mIU/L", "мкМЕ/мл"], range: "0.4-4.0 мМЕ/л" },
        { name: "Тироксин свободный", shortName: "св. Т4", units: ["пмоль/л", "ng/dL", "нг/дл"], range: "10-22 пмоль/л" },
        { name: "Трийодтиронин свободный", shortName: "св. Т3", units: ["пмоль/л", "pg/mL", "пг/мл"], range: "3.5-6.5 пмоль/л" },
        
        // Витамины
        { name: "25-гидроксивитамин D", shortName: "25(OH)D", units: ["нг/мл", "нмоль/л"], range: "30-100 нг/мл" },
        { name: "Витамин B12", shortName: "B12", units: ["пг/мл", "пмоль/л"], range: "200-900 пг/мл" },
        { name: "Фолиевая кислота", shortName: "Folate", units: ["нг/мл", "нмоль/л"], range: "3-17 нг/мл" },
        
        // Микроэлементы
        { name: "Цинк", shortName: "Zn", units: ["мкмоль/л", "мкг/мл"], range: "10-18 мкмоль/л" },
        
        // Коагулограмма
        { name: "Международное нормализованное отношение", shortName: "МНО", units: [""], range: "0.8-1.2" },
        { name: "D-димер", shortName: "D-dimer", units: ["мкг/мл FEU", "нг/мл FEU", "мг/л FEU"], range: "0-0.5 мкг/мл FEU" },
        
        // Гормоны
        { name: "Тестостерон общий", shortName: "Testosterone", units: ["нмоль/л", "нг/мл", "пг/мл"], male: "8-35 нмоль/л или 2800-10000 пг/мл", female: "0.5-2.5 нмоль/л или 150-700 пг/мл" },
        { name: "ГСПГ", shortName: "SHBG", units: ["нмоль/л"], male: "13-71", female: "18-114" },
        { name: "Пролактин", shortName: "PRL", units: ["мЕд/л", "мкМЕ/мл"], male: "50-400 мЕд/л", female: "50-500 мЕд/л" },
        { name: "Лютеинизирующий гормон", shortName: "ЛГ", units: ["МЕ/л", "мМЕ/мл"], male: "1.5-9.3", female: "1.7-15.0" },
        { name: "Фолликулостимулирующий гормон", shortName: "ФСГ", units: ["МЕ/л", "мМЕ/мл"], male: "1.4-15.4", female: "1.4-20.0" },
        { name: "Эстрадиол", shortName: "E2", units: ["пмоль/л", "пг/мл"], male: "40-160 пмоль/л или 10-50 пг/мл", female: "70-1200 пмоль/л или 15-350 пг/мл" },
        { name: "ДГЭА-С", shortName: "DHEA-S", units: ["мкмоль/л", "мкг/дл"], male: "2.5-14.5", female: "1.8-11.0" },
        { name: "Андростендион", shortName: "A4", units: ["нг/мл", "нмоль/л", "пг/мл"], male: "2.0-8.5 нг/мл", female: "1.5-7.0 нг/мл" },
        { name: "Дегидроэпиандростерон", shortName: "DHEA", units: ["пг/мл", "нг/мл"], male: "1000-8000 пг/мл", female: "800-6000 пг/мл" },
        { name: "Кортизол", shortName: "Cortisol", units: ["пг/мл", "нмоль/л", "мкг/дл"], range: "140-690 нмоль/л" },
        { name: "Кортизон", shortName: "Cortisone", units: ["пг/мл"], range: "5000-35000" },
        { name: "Прегненолон", shortName: "Pregnenolone", units: ["пг/мл"], range: "200-1000" },
        { name: "Прогестерон", shortName: "Progesterone", units: ["пг/мл", "нмоль/л"], male: "100-500 пг/мл", female: "100-20000 пг/мл" },
        
        // Онкомаркеры
        { name: "ПСА общий", shortName: "tPSA", units: ["нг/мл"], range: "0-4.0" },
        
        // Моча
        { name: "Удельный вес мочи", shortName: "SG", units: [""], range: "1.010-1.025" },
        { name: "pH мочи", shortName: "pH", units: [""], range: "5.0-7.5" },
        { name: "Микроальбумин", shortName: "mALB", units: ["мг/л", "мг/сут"], range: "0-20" },
        
        // Кал
        { name: "Кальпротектин в кале", shortName: "Calprotectin", units: ["мкг/г"], range: "0-50" },
        { name: "Скрытая кровь в кале", shortName: "OB", units: ["нг/мл"], range: "0-50" },
        { name: "H. pylori антиген в кале", shortName: "HP", units: [""] },
        
        // Иммунология
        { name: "Иммуноглобулин A", shortName: "IgA", units: ["г/л", "g/L"], range: "0.7-4.0" },
        { name: "Иммуноглобулин M", shortName: "IgM", units: ["г/л", "g/L"], range: "0.4-2.3" },
        { name: "Иммуноглобулин G", shortName: "IgG", units: ["г/л", "g/L"], range: "7.0-16.0" },
        { name: "Антитела к тканевой трансглутаминазе IgA", shortName: "tTG-IgA", units: ["Ед/мл", "U/mL"], range: "0-20" },
        
        // Кардиомаркеры
        { name: "Тропонин", shortName: "Tn", units: ["нг/л", "нг/мл"], range: "0-14 нг/л" }
      ];

      const knownTestsList = knownTests.map(t => {
        const range = t.male ? `муж: ${t.male}, жен: ${t.female}` : `норма: ${t.range}`;
        return `- ${t.name} (${t.shortName}) → единицы: [${t.units.join(', ')}] | ${range}`;
      }).join('\n');

      // Формируем список единиц из PDF (если передан pdfUnitsMap)
      const pdfUnitsList = pdfUnitsMap && Object.keys(pdfUnitsMap).length > 0
        ? Object.entries(pdfUnitsMap).map(([name, unit]) => 
            `- ${name} → ${unit}`
          ).join('\n')
        : 'Единицы не определены заранее';

      const parsePrompt = `Ты — медицинский ассистент для извлечения лабораторных показателей из текста PDF.

ЗАДАЧА: Извлеки ВСЕ лабораторные показатели из предоставленного текста и верни СТРОГО в JSON формате.

ФОРМАТ ОТВЕТА (только JSON, без markdown, без комментариев):
{
  "tests": [
    {
      "name": "Тестостерон общий",
      "shortName": "Testosterone",
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

⚠️ КРИТИЧЕСКИ ВАЖНО — ЕДИНИЦЫ ИЗМЕРЕНИЯ:

📏 ЕДИНИЦЫ, КОТОРЫЕ МЫ УЖЕ НАШЛИ В PDF (ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ ИХ!):
${pdfUnitsList}

ПРАВИЛА:
1. **ВСЕГДА используй ТОЛЬКО те единицы, которые указаны в списке выше** для соответствующих тестов
2. Если в PDF написано "440.64 пг/мл" — верни unit: "пг/мл", НЕ "нмоль/л"
3. Если единицы из списка отсутствуют — бери единицу из самого текста PDF
4. Референсные значения (referenceMin, referenceMax) должны быть В ТЕХ ЖЕ единицах, что и value
5. **НЕ ПРИДУМЫВАЙ единицы** — только те, что реально есть в документе
6. ВНИМАТЕЛЬНО смотри на единицы в самом тексте PDF рядом с числом
7. Если рядом с значением написано "нг/мл" — это единица, даже если в другом месте указан "нмоль/л"

СПИСОК ИЗВЕСТНЫХ ТЕСТОВ С ДОПУСТИМЫМИ ЕДИНИЦАМИ:
${knownTestsList}

ПРАВИЛА ОПРЕДЕЛЕНИЯ STATUS:
- "normal" — value в пределах [referenceMin, referenceMax]
- "high" — value > referenceMax
- "low" — value < referenceMin
- "unknown" — если нет референсного диапазона

ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА:
1. Извлекай ВСЕ числовые лабораторные показатели
2. Определяй референсные диапазоны из PDF, сверяй со списком выше
3. Если в PDF нет референса — используй из списка выше (с учётом единиц!)
4. Игнорируй нечисловые данные (имена, адреса, комментарии врачей)
5. Возвращай ТОЛЬКО валидный JSON без markdown обёрток
6. Для тестов с альтернативными названиями используй каноническое имя из списка выше

ТЕКСТ PDF ДЛЯ АНАЛИЗА:
"""
${pdfText}
"""

ПАЦИЕНТ: ${patientSex || 'unknown'}, ${patientAge || '?'} лет

НАПОМИНАНИЕ: Проверяй единицы измерения ВНИМАТЕЛЬНО. Они должны точно совпадать с теми, что указаны в PDF!`;

      const messages = [{ role: 'user', content: parsePrompt }];
      return await callOpenRouter(messages, OPENROUTER_API_KEY, 'parse_pdf');
    }

    // ═══════════════════════════════════════
    //  ДЕЙСТВИЕ 2: ЧАТ С МЕДИЦИНСКИМ АССИСТЕНТОМ
    // ═══════════════════════════════════════
    if (action === 'chat' || messages) {
      console.log('💬 Chat mode activated');
      
      const systemPrompt = {
        role: 'system',
        content: `📌 БАЗА ЗНАНИЙ: Ты — медицинский AI-ассистент в приложении "Семейный доктор". Работаешь в чате (chat.html).

Ты имеешь доступ к двум источникам медицинских данных:
1. 📊 **Встроенная база** — 71 лабораторный тест, 17 диагностических правил, 27 рекомендаций по добавкам
2. 📄 **Импортированные PDF** — медицинские учебники, клинические рекомендации, протоколы лечения

**ПРИОРИТЕТ ИСТОЧНИКОВ:**
- 🥇 **ПЕРВЫМ ДЕЛОМ** используй данные из импортированных PDF (помечены 📄 [из PDF])
- 🥈 **ВТОРЫМ ДЕЛОМ** используй встроенную базу (помечены 📊 [база])
- 🥉 Если информации нет в обоих источниках — честно скажи: "В моей базе знаний нет данных по этому вопросу. Я могу найти актуальную информацию в медицинских источниках (UpToDate, ВОЗ, PubMed) — хотите?"

**ТВОИ ВОЗМОЖНОСТИ:**
- Анализ результатов лабораторных анализов
- Интерпретация отклонений от нормы
- Рекомендации по дополнительным обследованиям
- Объяснение медицинских терминов простым языком
- Рекомендации по питанию и образу жизни
- Направление к нужным специалистам

**СТРОГИЕ ПРАВИЛА:**
1. НИКОГДА не выдумывай нормы, дозировки или диагнозы
2. ВСЕГДА указывай источник информации (📄 [из PDF] или 📊 [база])
3. НИКОГДА не ставь окончательных диагнозов — только предполагаемые состояния
4. ВСЕГДА добавляй дисклеймер: "Это не медицинская консультация. Обратитесь к врачу."
5. Для тревожных симптомов (боль в груди, одышка, потеря сознания, кровь) — немедленно советуй вызвать 112
6. НЕ назначай лечение и лекарства без консультации врача — только общие рекомендации
7. Отвечай ТОЛЬКО на русском языке
8. Используй markdown: **жирный** для важного, • для списков
9. Будь дружелюбным и поддерживающим

**ФОРМАТ ОТВЕТА:**
- 📊 Краткий анализ ситуации (2-3 предложения)
- 🔍 Возможные причины (список через •)
- 🧪 Рекомендуемые анализы (с указанием источника: 📄 или 📊)
- 💊 Рекомендации по лечению (с указанием источника)
- 👨‍⚕️ К какому врачу обратиться
- ⚕️ Дисклеймер в конце

**ВАЖНО:** Если вопрос касается конкретного лекарства, протокола лечения или клинической рекомендации — ищи в первую очередь в импортированных PDF документах.

Если вопрос НЕ медицинский — вежливо предложи задать медицинский вопрос.

**ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:**
- "Повышенный ферритин 📊 [база] может указывать на воспаление или избыток железа. Рекомендую сдать..."
- "Низкий витамин D 📊 [база] — частая проблема. Обычно назначают витамин D3 2000-4000 МЕ/сут..."
- "Согласно клиническим рекомендациям 📄 [из PDF] при таких симптомах стоит проверить..."`
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
//  ОБЩАЯ ФУНКЦИЯ ВЫЗОВА OPENROUTER
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
          temperature: actionType === 'parse_pdf' ? 0.1 : 0.7,
          max_tokens: actionType === 'parse_pdf' ? 4096 : 2048,
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
      
      console.log(`✅ SUCCESS with ${model}`);
      break;
    } catch (modelError) {
      console.error(`❌ ${model} error:`, modelError.message);
      lastError = modelError.message;
      continue;
    }
  }

  if (!reply) {
    console.error('❌ All models failed. Last error:', lastError);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: `Все модели недоступны: ${lastError}`,
        models_tried: MODELS
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Для парсинга PDF — пытаемся извлечь JSON из ответа
  if (actionType === 'parse_pdf') {
    try {
      let jsonStr = reply.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const parsed = JSON.parse(jsonStr);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          data: parsed,
          model: usedModel,
          rawResponse: reply
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (parseError) {
      console.error('❌ Failed to parse JSON from AI response:', parseError.message);
      console.error('Raw response:', reply);
      
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `AI вернул невалидный JSON: ${parseError.message}`,
          rawResponse: reply,
          model: usedModel
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
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