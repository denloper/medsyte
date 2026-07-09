/**
 * Symptom RAG Engine v1.1
 * + Анти-тревожный режим (anxiety mode)
 */
;(function() {
  'use strict';

  var guidelinesDb = null;
  var sourcesDb = {};
  var ANXIETY_KEY = 'anxiety_mode_v1';

  // ═══════════════════════════════════════════════════════════
  //  УПРАВЛЕНИЕ РЕЖИМОМ ТРЕВОГИ
  // ═══════════════════════════════════════════════════════════
  function getAnxietyMode() {
    try { return localStorage.getItem(ANXIETY_KEY) === 'true'; }
    catch (e) { return false; }
  }
  function setAnxietyMode(val) {
    try { localStorage.setItem(ANXIETY_KEY, val ? 'true' : 'false'); }
    catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  //  ШАБЛОНЫ УСПОКАИВАЮЩИХ ОТВЕТОВ ДЛЯ ЧАСТЫХ СТРАХОВ
  // ═══════════════════════════════════════════════════════════
  var anxietyReassurance = {
    heart_attack: {
      triggers: ['боль в груди', 'груди', 'сердце', 'инфаркт', 'давит', 'жжёт'],
      text: 'Боль в груди в 95% случаев вызвана межрёберной невралгией, мышечным напряжением, стрессом или изжогой. Инфаркт обычно сопровождается характерной болью с иррадиацией в левую руку, холодным потом, страхом смерти — если этого нет, вероятность сердечного события крайне мала.'
    },
    cancer: {
      triggers: ['рак', 'опухоль', 'онколог', 'злокачествен', 'метастаз'],
      text: 'Вероятность онкологии без специфических симптомов (необъяснимая потеря веса, ночные поты, стойкие изменения) крайне мала. Большинство "подозрительных" симптомов оказываются доброкачественными состояниями. Регулярные чек-апы — лучший способ профилактики.'
    },
    stroke: {
      triggers: ['инсульт', 'онемение', 'речь', 'паралич'],
      text: 'Если вы можете читать и печатать это сообщение — ваша речь и понимание сохранены, это хороший знак. Инсульт развивается внезапно с яркими симптомами: асимметрия лица, слабость в одной половине тела, нарушение речи.'
    },
    brain_tumor: {
      triggers: ['опухоль мозга', 'головной мозг', 'глиобластома'],
      text: 'Головная боль — крайне редко признак опухоли мозга (менее 0.05% случаев). Гораздо чаще это мигрень, головная боль напряжения или последствия стресса.'
    }
  };

  function findReassurance(userText) {
    var lower = userText.toLowerCase();
    var found = [];
    for (var key in anxietyReassurance) {
      var r = anxietyReassurance[key];
      if (r.triggers.some(function(t) { return lower.indexOf(t) !== -1; })) {
        found.push(r.text);
      }
    }
    return found;
  }

  // ═══════════════════════════════════════════════════════════
  //  ЗАГРУЗКА БД
  // ═══════════════════════════════════════════════════════════
  function loadDatabase() {
    if (guidelinesDb) return Promise.resolve(guidelinesDb);
    return fetch('./clinical-guidelines.json')
      .then(function(r) { if (!r.ok) throw new Error('fail'); return r.json(); })
      .then(function(data) {
        guidelinesDb = data.guidelines;
        data.sources.forEach(function(s) { sourcesDb[s.id] = s; });
        return guidelinesDb;
      })
      .catch(function(e) {
        console.error('Ошибка БД:', e);
        guidelinesDb = [];
        return [];
      });
  }

  function tokenize(text) {
    return text.toLowerCase().replace(/[^\wа-яА-ЯёЁ\s-]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; });
  }
  function stem(word) {
    var endings = ['ами','ями','ого','его','ому','ему','ой','ей','ий','ый','ую','юю','ая','яя','ом','ем','ах','ях','ов','ев','ам','ям','а','я','ы','и','е','о','у','ю'];
    for (var i = 0; i < endings.length; i++) {
      var end = endings[i];
      if (word.length > end.length + 3 && word.slice(-end.length) === end) return word.slice(0, -end.length);
    }
    return word;
  }

  function searchGuidelines(userSymptoms, topK) {
    topK = topK || 3;
    if (!guidelinesDb || guidelinesDb.length === 0) return [];
    var userTokens = tokenize(userSymptoms);
    var userStems = userTokens.map(stem);
    if (userStems.length === 0) return [];

    var scores = guidelinesDb.map(function(guide) {
      var score = 0, matchedKeywords = [];
      guide.keywords.forEach(function(kw) {
        var kwStem = stem(kw.toLowerCase());
        if (userStems.some(function(us) { return us.indexOf(kwStem) !== -1 || kwStem.indexOf(us) !== -1; })) {
          score += 3; matchedKeywords.push(kw);
        }
      });
      var allSymptoms = (guide.symptoms.typical || []).concat(guide.symptoms.red_flags || []);
      allSymptoms.forEach(function(symptom) {
        var symptomTokens = tokenize(symptom).map(stem);
        var overlap = symptomTokens.filter(function(st) { return userStems.indexOf(st) !== -1; }).length;
        if (overlap > 0) { score += overlap * 2; if (matchedKeywords.indexOf(symptom) === -1) matchedKeywords.push(symptom); }
      });
      var redFlags = guide.symptoms.red_flags || [];
      redFlags.forEach(function(rf) {
        var rfTokens = tokenize(rf).map(stem);
        if (rfTokens.some(function(rt) { return userStems.indexOf(rt) !== -1; })) score += 5;
      });
      return { guide: guide, score: score, matchedKeywords: matchedKeywords };
    });

    return scores.filter(function(s) { return s.score > 0; }).sort(function(a, b) { return b.score - a.score; }).slice(0, topK);
  }

  // ═══════════════════════════════════════════════════════════
  //  ПОСТРОЕНИЕ ПРОМПТА (С УЧЁТОМ РЕЖИМА ТРЕВОГИ)
  // ═══════════════════════════════════════════════════════════
  function buildPrompt(userSymptoms, patientInfo, searchResults, anxietyMode) {
    var contextBlock = searchResults.map(function(r) {
      var g = r.guide;
      var source = sourcesDb[g.source_id] || {};
      return [
        '## ' + g.title,
        'Источник: ' + (source.title || 'Клинические рекомендации') + ' (' + (source.year || 'N/A') + ')',
        'Совпавшие симптомы: ' + r.matchedKeywords.join(', '),
        'Типичные: ' + g.symptoms.typical.join('; '),
        'Красные флаги: ' + g.symptoms.red_flags.join('; '),
        'Дома: ' + g.actions.home.join('; '),
        'Избегать: ' + g.actions.avoid.join('; '),
        'К врачу: ' + g.actions.see_doctor.join('; '),
        'Обнадёживающее: ' + g.reassurance
      ].join('\n');
    }).join('\n\n');

    var patientContext = [];
    if (patientInfo.sex) patientContext.push('Пол: ' + (patientInfo.sex === 'male' ? 'мужской' : 'женский'));
    if (patientInfo.age) patientContext.push('Возраст: ' + patientInfo.age + ' лет');

    // ═══════════ РАЗНЫЕ ПРОМПТЫ ДЛЯ РАЗНЫХ РЕЖИМОВ ═══════════
    var toneInstructions;
    if (anxietyMode) {
      toneInstructions = [
        'Ты — тёплый, эмпатичный помощник. Пациент тревожится. Твоя ГЛАВНАЯ задача — снизить тревогу, оставаясь честным.',
        '',
        'ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА АНТИ-ТРЕВОЖНОГО ОТВЕТА:',
        '1. НАЧНИ с фразы нормализации: "Понимаю ваше беспокойство, это совершенно нормальная реакция. Давайте вместе спокойно разберёмся."',
        '2. УКАЖИ ВЕРОЯТНОСТИ в процентах: "В 85-90% случаев такие симптомы — это [самое частое]. В 9-14% — [менее частое]. Менее 1% — серьёзные состояния."',
        '3. Используй МЯГКИЕ слова: "скорее всего", "вероятно", "обычно", "чаще всего", "как правило"',
        '4. ИЗБЕГАЙ слов-катастроф: "опасно", "срочно", "немедленно" (кроме реальных экстренных случаев), "требуется"',
        '5. КРАСНЫЕ ФЛАГИ формулируй мягко: "Если вдруг появится X — это повод спокойно позвонить врачу, но сейчас по описанию поводов для тревоги нет"',
        '6. В КОНЦЕ добавь ободряющую фразу: "Вы молоде, что следите за здоровьем. Большинство подобных случаев проходит без последствий."',
        '7. НЕ перечисляй 10 возможных диагнозов — назови 1-2 самых вероятных',
        '8. Если описаны симптомы, похожие на паническую атаку или ипохондрию — мягко упомяни, что тревога сама по себе вызывает физические симптомы (сердцебиение, одышку, головокружение)',
        '',
        'СТРУКТУРА ОТВЕТА:',
        '🌿 Понимаю вас (эмпатия)',
        '📊 Вероятности (в %)',
        '💚 Что можно сделать дома (конкретно)',
        '🌱 Когда спокойно обратиться к врачу',
        '✨ Ободряющее завершение'
      ].join('\n');
    } else {
      toneInstructions = [
        'Ты — медицинский помощник. НЕ врач, НЕ ставишь диагнозов.',
        '',
        'СТРУКТУРА ОТВЕТА:',
        '1. Что это может быть (1-2 варианта)',
        '2. Что можно дома (конкретные шаги)',
        '3. Чего НЕ делать',
        '4. Когда ОБЯЗАТЕЛЬНО к врачу',
        '5. Успокаивающая информация',
        '',
        'ПРАВИЛА:',
        '- ТОЛЬКО информация из контекста',
        '- НЕ выдумывай диагнозы',
        '- Красные флаги — в начало',
        '- Тон: спокойный, профессиональный',
        '- Обращайся на "вы"'
      ].join('\n');
    }

    return [
      toneInstructions,
      '',
      'КОНТЕКСТ (клинические рекомендации):',
      contextBlock,
      '',
      'ПАЦИЕНТ:',
      patientContext.join(', ') || 'Пол и возраст не указаны',
      '',
      'ЖАЛОБЫ:',
      '"' + userSymptoms + '"',
      '',
      'Длина ответа: 200-400 слов. Формат: читаемый текст с эмодзи для структуры.'
    ].join('\n');
  }

  function getApiKey() {
    try {
      var config = JSON.parse(localStorage.getItem('llm_vision_config_v1') || '{}');
      return config.keys && config.keys.gemini ? config.keys.gemini : null;
    } catch (e) { return null; }
  }

  function callGemini(prompt) {
    var apiKey = getApiKey();
    if (!apiKey) return Promise.reject(new Error('NO_API_KEY'));
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + apiKey;
    var body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, topP: 0.95, maxOutputTokens: 1500 }
    };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return Promise.reject(new Error('API error'));
      return r.json();
    }).then(function(data) {
      var text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) return Promise.reject(new Error('EMPTY'));
      return text;
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  ЛОКАЛЬНЫЙ ОТВЕТ (С УЧЁТОМ АНТИ-ТРЕВОЖНОГО РЕЖИМА)
  // ═══════════════════════════════════════════════════════════
  function generateLocalResponse(userSymptoms, searchResults, anxietyMode) {
    if (searchResults.length === 0) {
      return {
        answer: anxietyMode
          ? '💚 Я не нашёл точного совпадения в базе рекомендаций, но это не повод для тревоги. Большинство симптомов — преходящие. Рекомендую спокойно записаться к терапевту в ближайшие дни для очной консультации.'
          : 'На основе описанных симптомов я не нашёл подходящих рекомендаций. Обратитесь к терапевту.',
        sources: [],
        urgency: 'plan'
      };
    }

    var top = searchResults[0].guide;
    var source = sourcesDb[top.source_id];

    // ═══════ ОПРЕДЕЛЯЕМ НАЛИЧИЕ КРАСНЫХ ФЛАГОВ ═══════
    var redFlags = top.symptoms.red_flags || [];
    var userLower = userSymptoms.toLowerCase();
    var hasRedFlag = redFlags.some(function(rf) {
      return tokenize(rf).some(function(t) { return userLower.indexOf(t) !== -1; });
    });

    var answer = '';

    if (anxietyMode) {
      // ═══════ АНТИ-ТРЕВОЖНЫЙ ФОРМАТ ═══════
      answer += '🌿 **Понимаю ваше беспокойство.** Это совершенно нормальная реакция — заботиться о своём здоровье. Давайте спокойно разберёмся.\n\n';

      // Проверяем специфические страхи
      var specificReassurance = findReassurance(userSymptoms);
      if (specificReassurance.length > 0) {
        answer += '💡 **Важная информация:**\n' + specificReassurance.map(function(r) { return '• ' + r; }).join('\n') + '\n\n';
      }

      answer += '📊 **Что говорит статистика:**\n';
      answer += '• В **85-90%** случаев подобные симптомы — это **' + top.title + '**\n';
      if (searchResults[1]) {
        answer += '• В **9-14%** — ' + searchResults[1].guide.title + '\n';
      }
      answer += '• Менее **1%** — серьёзные состояния\n\n';

      answer += '💚 **Что можно сделать дома:**\n' + top.actions.home.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
      answer += '🌱 **Чего избегать:**\n' + top.actions.avoid.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';

      if (hasRedFlag) {
        answer += '🔔 **На что обратить внимание:**\nЕсли вдруг появятся эти симптомы — спокойно обратитесь к врачу:\n' + redFlags.slice(0, 3).map(function(rf) { return '• ' + rf; }).join('\n') + '\n**Но сейчас по описанию поводов для паники нет.**\n\n';
      } else {
        answer += '🩺 **Когда спокойно записаться к врачу:**\n' + top.actions.see_doctor.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
      }

      answer += '✨ **' + top.reassurance + '**\n\n';
      answer += 'Вы молодец, что прислушиваетесь к своему телу. В большинстве случаев подобные состояния проходят без последствий при правильном уходе.';

    } else {
      // ═══════ ОБЫЧНЫЙ ФОРМАТ ═══════
      answer = '**Что это может быть:** ' + top.title + '\n\n';
      answer += '**Что можно сделать:**\n' + top.actions.home.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
      answer += '**Чего избегать:**\n' + top.actions.avoid.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
      answer += '**Когда обязательно к врачу:**\n' + top.actions.see_doctor.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
      answer += '💡 ' + top.reassurance;

      if (hasRedFlag) {
        answer = '⚠ **ВНИМАНИЕ!** Ваши симптомы могут быть признаками опасного состояния.\n\n**Немедленно обратитесь за помощью:**\n• Скорая: 103 или 112\n\n---\n\n' + answer;
      }
    }

    return {
      answer: answer,
      sources: source ? [{ title: source.title, year: source.year, url: source.url }] : [],
      urgency: hasRedFlag ? 'emergency' : top.urgency
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  ГЛАВНАЯ ФУНКЦИЯ
  // ═══════════════════════════════════════════════════════════
  function analyzeSymptoms(userSymptoms, patientInfo) {
    patientInfo = patientInfo || {};
    var anxietyMode = getAnxietyMode();
    return loadDatabase().then(function() {
      var searchResults = searchGuidelines(userSymptoms, 3);
      return callGemini(buildPrompt(userSymptoms, patientInfo, searchResults, anxietyMode))
        .then(function(answer) {
          if (answer && answer.trim().length > 50) {
            return {
              answer: answer,
              sources: searchResults.map(function(r) { return sourcesDb[r.guide.source_id]; }).filter(Boolean).map(function(s) { return { title: s.title, year: s.year, url: s.url }; }),
              urgency: searchResults[0] ? searchResults[0].guide.urgency : 'plan',
              mode: 'ai',
              anxietyMode: anxietyMode,
              searchResults: searchResults.map(function(r) { return { title: r.guide.title, score: r.score, matched: r.matchedKeywords }; })
            };
          }
          throw new Error('EMPTY');
        })
        .catch(function(e) {
          console.warn('Gemini недоступен:', e.message);
          var local = generateLocalResponse(userSymptoms, searchResults, anxietyMode);
          return {
            answer: local.answer,
            sources: local.sources,
            urgency: local.urgency,
            mode: 'local',
            anxietyMode: anxietyMode,
            searchResults: searchResults.map(function(r) { return { title: r.guide.title, score: r.score, matched: r.matchedKeywords }; })
          };
        });
    });
  }

  window.SymptomRAG = {
    loadDatabase: loadDatabase,
    searchGuidelines: searchGuidelines,
    analyzeSymptoms: analyzeSymptoms,
    getAnxietyMode: getAnxietyMode,
    setAnxietyMode: setAnxietyMode,
    version: '1.1.0'
  };
})();