/**
 * LLM Vision Parser v1.0
 * Интеграция с мультимодальными нейросетями для распознавания медицинских бланков
 * 
 * Поддерживаемые провайдеры:
 * - Google Gemini (бесплатно)
 * - OpenAI GPT-4o (платно)
 * 
 * ⚠ API-ключи хранятся в localStorage на устройстве пользователя.
 * Для продакшена рекомендуется backend-прокси.
 */
;(function() {
  'use strict';

  const STORAGE_KEY = 'llm_vision_config_v1';

  // ═══════════════════════════════════════════════════════════
  //  ПРОМПТ ДЛЯ LLM (единый для всех провайдеров)
  // ═══════════════════════════════════════════════════════════
  const SYSTEM_PROMPT = `Ты — профессиональный парсер медицинских лабораторных бланков.
Извлеки из изображения ВСЕ лабораторные показатели и верни СТРОГО JSON без markdown и пояснений.

Формат ответа:
{
  "tests": [
    {
      "name": "Каноническое название показателя на русском языке",
      "value": 123.45,
      "unit": "единица измерения (как в бланке)",
      "ref_min": 10.0,
      "ref_max": 50.0
    }
  ],
  "patient": {
    "name": "ФИО пациента (если есть)",
    "sex": "male или female (если определено)",
    "age": 45,
    "date": "YYYY-MM-DD (дата анализа, если есть)"
  },
  "lab_name": "Название лаборатории (если видно)"
}

Правила:
1. name — пиши полное русское название: "Гемоглобин" (не HGB), "Тиреотропный гормон" (не ТТГ)
2. value — всегда число с точкой (не запятой). Если значение "4,5" → пиши 4.5
3. ref_min и ref_max — извлечены из колонки "Референсные значения". Если диапазон "3.5 - 5.1" → min=3.5, max=5.1
4. Если референс односторонний "> 114.80" → ref_min=114.8, ref_max=null
5. Если референс односторонний "< 5.0" → ref_min=null, ref_max=5.0
6. Если референс не указан → ref_min=null, ref_max=null
7. Не выдумывай значения — только то, что реально есть в бланке
8. Игнорируй служебную информацию: ФИО врача, дату выполнения, подписи, штрих-коды
9. Если бланк не медицинский или не читаемый — верни {"tests": [], "error": "описание проблемы"}

Верни ТОЛЬКО JSON, без \`\`\`json и без пояснений.`;

  // ═══════════════════════════════════════════════════════════
  //  УПРАВЛЕНИЕ КОНФИГУРАЦИЕЙ
  // ═══════════════════════════════════════════════════════════
  function getConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : { provider: 'gemini', keys: {}, consent: false };
    } catch (e) {
      return { provider: 'gemini', keys: {}, consent: false };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function getApiKey(provider) {
    const config = getConfig();
    return config.keys?.[provider] || null;
  }

  function setApiKey(provider, key) {
    const config = getConfig();
    if (!config.keys) config.keys = {};
    config.keys[provider] = key;
    saveConfig(config);
  }

  function getProvider() {
    return getConfig().provider || 'gemini';
  }

  function setProvider(provider) {
    const config = getConfig();
    config.provider = provider;
    saveConfig(config);
  }

  function hasConsent() {
    return getConfig().consent === true;
  }

  function setConsent(value) {
    const config = getConfig();
    config.consent = !!value;
    saveConfig(config);
  }

  // ═══════════════════════════════════════════════════════════
  //  КОНВЕРТАЦИЯ ФАЙЛОВ В BASE64
  // ═══════════════════════════════════════════════════════════
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Убираем префикс data:image/xxx;base64,
        const base64 = result.split(',')[1];
        resolve({ base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Рендер PDF страниц в base64 PNG через pdf.js
  async function pdfToImages(pdfFile, options = {}) {
    const { maxPages = 5, scale = 2.0 } = options;
    const images = [];
    
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = Math.min(pdf.numPages, maxPages);

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      
      await page.render({ canvasContext: ctx, viewport }).promise;
      
      // Конвертируем canvas в base64 PNG
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      
      images.push({ base64, mimeType: 'image/png', pageNum: i });
    }

    return images;
  }

  // ═══════════════════════════════════════════════════════════
  //  ПРОВАЙДЕРЫ LLM
  // ═══════════════════════════════════════════════════════════

  /**
   * Google Gemini 2.0 Flash
   * Бесплатный tier: 15 запросов в минуту
   * Получить ключ: https://aistudio.google.com/app/apikey
   */
  async function callGemini(images) {
    const apiKey = getApiKey('gemini');
    if (!apiKey) throw new Error('API-ключ Google Gemini не установлен');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

    // Формируем parts: системный промпт + все изображения
    const parts = [
      { text: SYSTEM_PROMPT }
    ];

    images.forEach((img, idx) => {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64
        }
      });
      if (images.length > 1) {
        parts.push({ text: `[Страница ${img.pageNum || idx + 1}]` });
      }
    });

    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      if (response.status === 400) throw new Error('Неверный API-ключ или запрос');
      if (response.status === 429) throw new Error('Превышен лимит (15 запросов/мин). Подождите.');
      throw new Error(`Gemini API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Пустой ответ от Gemini');
    
    return parseJsonResponse(text);
  }

  /**
   * OpenAI GPT-4o
   * Платный: ~$0.01 за страницу
   * Получить ключ: https://platform.openai.com/api-keys
   */
  async function callOpenAI(images) {
    const apiKey = getApiKey('openai');
    if (!apiKey) throw new Error('API-ключ OpenAI не установлен');

    const url = 'https://api.openai.com/v1/chat/completions';

    const content = [
      { type: 'text', text: SYSTEM_PROMPT }
    ];

    images.forEach((img, idx) => {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail: 'high'
        }
      });
      if (images.length > 1) {
        content.push({ type: 'text', text: `[Страница ${img.pageNum || idx + 1}]` });
      }
    });

    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Ты — парсер медицинских бланков. Возвращай только JSON.' },
        { role: 'user', content }
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      if (response.status === 401) throw new Error('Неверный API-ключ OpenAI');
      if (response.status === 429) throw new Error('Превышен лимит или нет средств на счету');
      throw new Error(`OpenAI API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Пустой ответ от OpenAI');
    
    return parseJsonResponse(text);
  }

  // ═══════════════════════════════════════════════════════════
  //  ПАРСИНГ JSON ОТВЕТА LLM
  // ═══════════════════════════════════════════════════════════
  function parseJsonResponse(text) {
    // Убираем markdown-обёртки, если LLM их добавил
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);
      
      // Валидация структуры
      if (!parsed.tests || !Array.isArray(parsed.tests)) {
        if (parsed.error) throw new Error(parsed.error);
        throw new Error('Неверный формат ответа: нет поля "tests"');
      }

      // Нормализация: убеждаемся, что все поля на месте
      parsed.tests = parsed.tests.map(t => ({
        name: String(t.name || '').trim(),
        value: typeof t.value === 'number' ? t.value : parseFloat(String(t.value).replace(',', '.')),
        unit: String(t.unit || '').trim(),
        ref_min: (t.ref_min !== null && t.ref_min !== undefined) ? parseFloat(t.ref_min) : null,
        ref_max: (t.ref_max !== null && t.ref_max !== undefined) ? parseFloat(t.ref_max) : null
      })).filter(t => t.name && !isNaN(t.value));

      return parsed;
    } catch (e) {
      throw new Error(`Не удалось распарсить JSON от LLM: ${e.message}\nОтвет: ${text.substring(0, 200)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ГЛАВНАЯ ФУНКЦИЯ ПАРСИНГА
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Парсит файл (PDF или изображение) через LLM Vision
   * @param {File} file — загруженный файл
   * @param {Function} onProgress — callback прогресса (0-100)
   * @returns {Promise<Object>} — { tests: [...], patient: {...}, lab_name: "..." }
   */
  async function parseFile(file, onProgress = () => {}) {
    const provider = getProvider();
    
    if (!hasConsent()) {
      throw new Error('Не получено согласие на отправку данных в облако');
    }

    onProgress(5);

    // Конвертируем файл в изображения
    let images;
    if (file.type === 'application/pdf') {
      onProgress(10);
      images = await pdfToImages(file, { maxPages: 5, scale: 2.0 });
      onProgress(40);
    } else if (file.type.startsWith('image/')) {
      const { base64, mimeType } = await fileToBase64(file);
      images = [{ base64, mimeType, pageNum: 1 }];
      onProgress(30);
    } else {
      throw new Error('Неподдерживаемый тип файла');
    }

    onProgress(50);

    // Вызываем нужный провайдер
    let result;
    try {
      if (provider === 'gemini') {
        result = await callGemini(images);
      } else if (provider === 'openai') {
        result = await callOpenAI(images);
      } else {
        throw new Error(`Неизвестный провайдер: ${provider}`);
      }
    } catch (e) {
      throw new Error(`Ошибка ${provider}: ${e.message}`);
    }

    onProgress(95);
    return result;
  }

  /**
   * Конвертирует результат LLM в формат, совместимый с MedDB.parseAnalysisText
   * Возвращает объект вида: { "Гемоглобин": { value, unit, status, refMin, refMax } }
   */
  function toMedDBFormat(llmResult, patientSex, patientAge) {
    const results = {};
    
    if (!llmResult?.tests) return results;

    for (const t of llmResult.tests) {
      // Ищем тест в базе по имени
      const test = window.findTestByAlias(t.name);
      const canonicalName = test?.canonicalName || t.name;
      
      let status = 'normal';
      let refMin = t.ref_min;
      let refMax = t.ref_max;

      // Если в ответе LLM нет референсов — берём из базы
      if (refMin === null && refMax === null && test) {
        const ref = window.getReference(test, patientSex || 'any', patientAge || 30);
        if (ref) {
          refMin = ref.min;
          refMax = ref.max;
        }
      }

      // Определяем статус
      if (refMin !== null && refMin !== undefined && t.value < refMin) {
        status = 'low';
      }
      if (refMax !== null && refMax !== undefined && t.value > refMax) {
        status = 'high';
      }

      results[canonicalName] = {
        value: t.value,
        unit: t.unit || (test?.units[0] || ''),
        status,
        refMin,
        refMax,
        source: 'llm' // маркер, что значение от LLM
      };
    }

    return results;
  }

  /**
   * Мержит результаты локального парсера и LLM.
   * LLM имеет приоритет для показателей, которые локальный парсер не нашел.
   */
  function mergeResults(localResults, llmResults) {
    const merged = { ...localResults };
    
    for (const [name, llmValue] of Object.entries(llmResults)) {
      if (!merged[name]) {
        // Локальный не нашел — берём из LLM
        merged[name] = llmValue;
      } else {
        // Локальный нашел — помечаем, что LLM подтвердил
        merged[name].llmConfirmed = true;
      }
    }

    return merged;
  }

  // ═══════════════════════════════════════════════════════════
  //  ЭКСПОРТ
  // ═══════════════════════════════════════════════════════════
  window.LLMVision = {
    // Конфигурация
    getApiKey, setApiKey,
    getProvider, setProvider,
    hasConsent, setConsent,
    getConfig,
    
    // Парсинг
    parseFile,
    toMedDBFormat,
    mergeResults,
    
    // Провайдеры
    providers: [
      { id: 'gemini', name: 'Google Gemini', free: true, url: 'https://aistudio.google.com/app/apikey' },
      { id: 'openai', name: 'OpenAI GPT-4o', free: false, url: 'https://platform.openai.com/api-keys' }
    ],

    version: '1.0.0'
  };

})();