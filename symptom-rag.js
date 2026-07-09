/**
 * Symptom RAG Engine v1.0
 * Retrieval-Augmented Generation для медицинских симптомов
 */
;(function() {
  'use strict';

  var guidelinesDb = null;
  var sourcesDb = {};

  function loadDatabase() {
    if (guidelinesDb) return Promise.resolve(guidelinesDb);
    return fetch('./clinical-guidelines.json')
      .then(function(r) {
        if (!r.ok) throw new Error('Не удалось загрузить базу');
        return r.json();
      })
      .then(function(data) {
        guidelinesDb = data.guidelines;
        data.sources.forEach(function(s) { sourcesDb[s.id] = s; });
        return guidelinesDb;
      })
      .catch(function(e) {
        console.error('Ошибка загрузки БД:', e);
        guidelinesDb = [];
        return [];
      });
  }

  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\wа-яА-ЯёЁ\s-]/g, ' ')
      .split(/\s+/)
      .filter(function(w) { return w.length > 2; });
  }

  function stem(word) {
    var endings = ['ами','ями','ого','его','ому','ему','ой','ей','ий','ый','ую','юю','ая','яя','ом','ем','ах','ях','ов','ев','ам','ям','а','я','ы','и','е','о','у','ю'];
    for (var i = 0; i < endings.length; i++) {
      var end = endings[i];
      if (word.length > end.length + 3 && word.slice(-end.length) === end) {
        return word.slice(0, -end.length);
      }
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
      var score = 0;
      var matchedKeywords = [];

      guide.keywords.forEach(function(kw) {
        var kwStem = stem(kw.toLowerCase());
        if (userStems.some(function(us) { return us.indexOf(kwStem) !== -1 || kwStem.indexOf(us) !== -1; })) {
          score += 3;
          matchedKeywords.push(kw);
        }
      });

      var allSymptoms = (guide.symptoms.typical || []).concat(guide.symptoms.red_flags || []);
      allSymptoms.forEach(function(symptom) {
        var symptomTokens = tokenize(symptom).map(stem);
        var overlap = symptomTokens.filter(function(st) { return userStems.indexOf(st) !== -1; }).length;
        if (overlap > 0) {
          score += overlap * 2;
          if (matchedKeywords.indexOf(symptom) === -1) matchedKeywords.push(symptom);
        }
      });

      var redFlags = guide.symptoms.red_flags || [];
      redFlags.forEach(function(rf) {
        var rfTokens = tokenize(rf).map(stem);
        if (rfTokens.some(function(rt) { return userStems.indexOf(rt) !== -1; })) {
          score += 5;
        }
      });

      return { guide: guide, score: score, matchedKeywords: matchedKeywords };
    });

    return scores
      .filter(function(s) { return s.score > 0; })
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, topK);
  }

  function buildPrompt(userSymptoms, patientInfo, searchResults) {
    var contextBlock = searchResults.map(function(r) {
      var g = r.guide;
      var source = sourcesDb[g.source_id] || {};
      return [
        '## ' + g.title,
        'Источник: ' + (source.title || 'Клинические рекомендации') + ' (' + (source.year || 'N/A') + ')',
        'Совпавшие симптомы: ' + r.matchedKeywords.join(', '),
        'Типичные симптомы: ' + g.symptoms.typical.join('; '),
        'Красные флаги: ' + g.symptoms.red_flags.join('; '),
        'Что можно дома: ' + g.actions.home.join('; '),
        'Чего избегать: ' + g.actions.avoid.join('; '),
        'Когда к врачу: ' + g.actions.see_doctor.join('; '),
        'Обнадёживающая информация: ' + g.reassurance
      ].join('\n');
    }).join('\n\n');

    var patientContext = [];
    if (patientInfo.sex) patientContext.push('Пол: ' + (patientInfo.sex === 'male' ? 'мужской' : 'женский'));
    if (patientInfo.age) patientContext.push('Возраст: ' + patientInfo.age + ' лет');

    return [
      'Ты — медицинский помощник. НЕ врач, НЕ ставишь диагнозов. Помогаешь пациенту понять, что делать, основываясь ТОЛЬКО на приведённых клинических рекомендациях.',
      '',
      'КОНТЕКСТ (официальные рекомендации):',
      contextBlock,
      '',
      'ПАЦИЕНТ:',
      patientContext.join(', ') || 'Пол и возраст не указаны',
      '',
      'ЖАЛОБЫ:',
      '"' + userSymptoms + '"',
      '',
      'ЗАДАЧА:',
      '1. Определи, какой протокол наиболее соответствует симптомам',
      '2. Дай спокойный, поддерживающий ответ:',
      '   - Что это может быть (1-2 варианта)',
      '   - Что можно дома (конкретные шаги)',
      '   - Чего НЕ делать',
      '   - Когда ОБЯЗАТЕЛЬНО к врачу',
      '   - Успокаивающая информация',
      '',
      'ПРАВИЛА:',
      '- ТОЛЬКО информация из контекста',
      '- Если симптомы не подходят — честно скажи "не могу точно определить"',
      '- НЕ выдумывай диагнозы и препараты',
      '- Красные флаги — в начало',
      '- Тон: спокойный, эмпатичный, без паники',
      '- Обращайся на "вы"',
      '- Длина: 150-300 слов'
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
      if (!r.ok) {
        if (r.status === 429) return Promise.reject(new Error('RATE_LIMIT'));
        return Promise.reject(new Error('API error: ' + r.status));
      }
      return r.json();
    }).then(function(data) {
      var text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) return Promise.reject(new Error('Пустой ответ'));
      return text;
    });
  }

  function generateLocalResponse(userSymptoms, searchResults) {
    if (searchResults.length === 0) {
      return {
        answer: 'На основе описанных симптомов я не нашёл подходящих клинических рекомендаций. Рекомендую обратиться к терапевту для очной консультации.',
        sources: [],
        urgency: 'plan'
      };
    }

    var top = searchResults[0].guide;
    var source = sourcesDb[top.source_id];

    var answer = '**Что это может быть:** ' + top.title + '\n\n';
    answer += '**Что можно сделать:**\n' + top.actions.home.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
    answer += '**Чего избегать:**\n' + top.actions.avoid.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
    answer += '**Когда обязательно к врачу:**\n' + top.actions.see_doctor.map(function(a) { return '• ' + a; }).join('\n') + '\n\n';
    answer += '💡 ' + top.reassurance;

    var redFlags = top.symptoms.red_flags || [];
    var userLower = userSymptoms.toLowerCase();
    var hasRedFlag = redFlags.some(function(rf) {
      return tokenize(rf).some(function(t) { return userLower.indexOf(t) !== -1; });
    });

    if (hasRedFlag) {
      answer = '⚠ **ВНИМАНИЕ!** Ваши симптомы могут быть признаками опасного состояния.\n\n**Немедленно обратитесь за помощью:**\n• Скорая: 103 или 112\n\n---\n\n' + answer;
    }

    return {
      answer: answer,
      sources: source ? [{ title: source.title, year: source.year, url: source.url }] : [],
      urgency: hasRedFlag ? 'emergency' : top.urgency
    };
  }

  function analyzeSymptoms(userSymptoms, patientInfo) {
    patientInfo = patientInfo || {};
    return loadDatabase().then(function() {
      var searchResults = searchGuidelines(userSymptoms, 3);
      return callGemini(buildPrompt(userSymptoms, patientInfo, searchResults))
        .then(function(answer) {
          if (answer && answer.trim().length > 50) {
            return {
              answer: answer,
              sources: searchResults.map(function(r) { return sourcesDb[r.guide.source_id]; }).filter(Boolean).map(function(s) { return { title: s.title, year: s.year, url: s.url }; }),
              urgency: searchResults[0] ? searchResults[0].guide.urgency : 'plan',
              mode: 'ai',
              searchResults: searchResults.map(function(r) { return { title: r.guide.title, score: r.score, matched: r.matchedKeywords }; })
            };
          }
          throw new Error('EMPTY');
        })
        .catch(function(e) {
          console.warn('Gemini недоступен, fallback:', e.message);
          var local = generateLocalResponse(userSymptoms, searchResults);
          return {
            answer: local.answer,
            sources: local.sources,
            urgency: local.urgency,
            mode: 'local',
            searchResults: searchResults.map(function(r) { return { title: r.guide.title, score: r.score, matched: r.matchedKeywords }; })
          };
        });
    });
  }

  window.SymptomRAG = {
    loadDatabase: loadDatabase,
    searchGuidelines: searchGuidelines,
    analyzeSymptoms: analyzeSymptoms,
    version: '1.0.0'
  };
})();