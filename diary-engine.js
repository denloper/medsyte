/**
 * Diary Engine v1.1
 * Дневники состояния: давление, сахар, вес, сон, температура, вода, настроение, активность, цикл
 * Хранение в localStorage, расчёты, интерпретация, экспорт
 */
;(function() {
  'use strict';

  var STORAGE_KEY = 'health_diary_v1';
  var PROFILE_KEY = 'diary_profile_v1';

  // ═══════════════════════════════════════════════════════════
  //  КОНФИГУРАЦИЯ МЕТРИК
  // ═══════════════════════════════════════════════════════════
  var metrics = {
    blood_pressure: {
      id: 'blood_pressure',
      title: 'Давление',
      icon: '🩸',
      category: 'Сердце',
      fields: [
        { id: 'systolic', label: 'Систолическое (верхнее)', unit: 'мм рт.ст.', type: 'number', min: 60, max: 260, required: true, placeholder: '120' },
        { id: 'diastolic', label: 'Диастолическое (нижнее)', unit: 'мм рт.ст.', type: 'number', min: 30, max: 160, required: true, placeholder: '80' },
        { id: 'pulse', label: 'Пульс', unit: 'уд/мин', type: 'number', min: 30, max: 220, required: false, placeholder: '70' },
        { id: 'note', label: 'Заметка', type: 'select', options: ['Утро', 'День', 'Вечер', 'После нагрузки', 'В покое'], required: false }
      ],
      primaryValue: 'systolic',
      interpret: function(entry) {
        var s = entry.systolic, d = entry.diastolic;
        if (s < 90 || d < 60) return { label: 'Гипотония', status: 'low', color: '#D97706', advice: 'Низкое давление. Пейте больше воды, избегайте резких движений.' };
        if (s < 120 && d < 80) return { label: 'Оптимальное', status: 'normal', color: '#059669' };
        if (s < 130 && d < 85) return { label: 'Нормальное', status: 'normal', color: '#059669' };
        if (s < 140 && d < 90) return { label: 'Предгипертония', status: 'warn', color: '#D97706', advice: 'Повышенное. Ограничьте соль, добавьте активность.' };
        if (s < 160 || d < 100) return { label: 'Гипертония I', status: 'danger', color: '#B91C1C', advice: 'Артериальная гипертензия. Обратитесь к кардиологу.' };
        return { label: 'Гипертония II', status: 'danger', color: '#B91C1C', advice: 'Значительная гипертензия. Требуется лечение.' };
      }
    },
    glucose: {
      id: 'glucose',
      title: 'Сахар',
      icon: '🍬',
      category: 'Обмен',
      fields: [
        { id: 'value', label: 'Уровень глюкозы', unit: 'ммоль/л', type: 'number', min: 1, max: 35, required: true, placeholder: '5.5', step: 0.1 },
        { id: 'timing', label: 'Когда измеряли', type: 'select', options: ['Натощак', 'Через 2 часа после еды', 'Перед сном', 'Случайно'], required: true }
      ],
      primaryValue: 'value',
      interpret: function(entry) {
        var v = entry.value, t = entry.timing;
        if (t === 'Натощак') {
          if (v < 3.3) return { label: 'Гипогликемия', status: 'danger', color: '#B91C1C', advice: 'Опасно низкий сахар. Срочно примите углеводы.' };
          if (v < 5.6) return { label: 'Норма', status: 'normal', color: '#059669' };
          if (v < 7.0) return { label: 'Преддиабет', status: 'warn', color: '#D97706', advice: 'Нарушенная гликемия натощак. Проверьте HbA1c.' };
          return { label: 'Диабет', status: 'danger', color: '#B91C1C', advice: 'Диабетический диапазон. Консультация эндокринолога.' };
        }
        if (v < 3.9) return { label: 'Гипогликемия', status: 'danger', color: '#B91C1C', advice: 'Низкий сахар.' };
        if (v < 7.8) return { label: 'Норма', status: 'normal', color: '#059669' };
        if (v < 11.1) return { label: 'Преддиабет', status: 'warn', color: '#D97706', advice: 'Нарушенная толерантность к глюкозе.' };
        return { label: 'Диабет', status: 'danger', color: '#B91C1C' };
      }
    },
    weight: {
      id: 'weight',
      title: 'Вес',
      icon: '⚖️',
      category: 'Тело',
      fields: [
        { id: 'value', label: 'Вес', unit: 'кг', type: 'number', min: 20, max: 300, required: true, placeholder: '70', step: 0.1 },
        { id: 'height', label: 'Рост (для ИМТ)', unit: 'см', type: 'number', min: 100, max: 250, required: false, placeholder: '175' }
      ],
      primaryValue: 'value',
      interpret: function(entry, profile) {
        var v = entry.value;
        var h = entry.height || (profile && profile.height) || 0;
        var bmi = null;
        if (h > 0) {
          bmi = v / Math.pow(h / 100, 2);
        }
        var result = { label: 'Записано', status: 'normal', color: '#059669', bmi: bmi };
        if (bmi !== null) {
          if (bmi < 18.5) { result.label = 'Недостаток веса'; result.status = 'warn'; result.color = '#D97706'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Недостаточная масса тела.'; }
          else if (bmi < 25) { result.label = 'Нормальный вес'; result.status = 'normal'; result.color = '#059669'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Здоровый вес.'; }
          else if (bmi < 30) { result.label = 'Избыточный вес'; result.status = 'warn'; result.color = '#D97706'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Предожирение.'; }
          else if (bmi < 35) { result.label = 'Ожирение I'; result.status = 'danger'; result.color = '#B91C1C'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Ожирение I степени.'; }
          else if (bmi < 40) { result.label = 'Ожирение II'; result.status = 'danger'; result.color = '#B91C1C'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Ожирение II степени.'; }
          else { result.label = 'Ожирение III'; result.status = 'danger'; result.color = '#B91C1C'; result.advice = 'ИМТ: ' + bmi.toFixed(1) + '. Морбидное ожирение.'; }
        }
        return result;
      }
    },
    sleep: {
      id: 'sleep',
      title: 'Сон',
      icon: '😴',
      category: 'Восстановление',
      fields: [
        { id: 'hours', label: 'Часов сна', unit: 'ч', type: 'number', min: 0, max: 16, required: true, placeholder: '7.5', step: 0.5 },
        { id: 'quality', label: 'Качество', type: 'rating', min: 1, max: 5, required: true },
        { id: 'note', label: 'Заметка', type: 'select', options: ['Выспался', 'Проснулся разбитым', 'Бессонница', 'Кошмары', 'Храп'], required: false }
      ],
      primaryValue: 'hours',
      interpret: function(entry) {
        var h = entry.hours, q = entry.quality;
        if (h < 5) return { label: 'Недосып', status: 'danger', color: '#B91C1C', advice: 'Критически мало сна. Вредит иммунитету и мозгу.' };
        if (h < 7) return { label: 'Недостаточно', status: 'warn', color: '#D97706', advice: 'Рекомендуется 7-9 часов для взрослых.' };
        if (h <= 9 && q >= 3) return { label: 'Хороший сон', status: 'normal', color: '#059669' };
        if (h > 9) return { label: 'Пересып', status: 'warn', color: '#D97706', advice: 'Избыток сна тоже вреден. Проверьте качество.' };
        if (q <= 2) return { label: 'Плохое качество', status: 'warn', color: '#D97706', advice: 'Сон не восстановил. Проверьте гигиену сна.' };
        return { label: 'Нормальный сон', status: 'normal', color: '#059669' };
      }
    },
    temperature: {
      id: 'temperature',
      title: 'Температура',
      icon: '🌡',
      category: 'Общее',
      fields: [
        { id: 'value', label: 'Температура', unit: '°C', type: 'number', min: 34, max: 42, required: true, placeholder: '36.6', step: 0.1 },
        { id: 'timing', label: 'Когда', type: 'select', options: ['Утро', 'День', 'Вечер', 'При плохом самочувствии'], required: false }
      ],
      primaryValue: 'value',
      interpret: function(entry) {
        var v = entry.value;
        if (v < 35) return { label: 'Гипотермия', status: 'danger', color: '#B91C1C', advice: 'Опасно низкая температура.' };
        if (v < 36.0) return { label: 'Пониженная', status: 'warn', color: '#D97706' };
        if (v < 37.0) return { label: 'Норма', status: 'normal', color: '#059669' };
        if (v < 37.5) return { label: 'Субфебрильная', status: 'warn', color: '#D97706', advice: 'Возможно воспаление или стресс.' };
        if (v < 38.0) return { label: 'Умеренная лихорадка', status: 'warn', color: '#D97706', advice: 'Наблюдайте. При ухудшении — к врачу.' };
        if (v < 39.0) return { label: 'Высокая лихорадка', status: 'danger', color: '#B91C1C', advice: 'Примите жаропонижающее, пейте больше воды.' };
        if (v < 40.0) return { label: 'Очень высокая', status: 'danger', color: '#B91C1C', advice: 'Требуется медицинская помощь.' };
        return { label: 'Критическая', status: 'danger', color: '#B91C1C', advice: 'Срочно вызывайте скорую!' };
      }
    },

    // ═══════════════════════════════════════════════════════════
    //  💧 НОВЫЕ МЕТРИКИ
    // ═══════════════════════════════════════════════════════════

    // 💧 ВОДА
    water: {
      id: 'water',
      title: 'Вода',
      icon: '💧',
      category: 'Питание',
      fields: [
        { id: 'value', label: 'Объём', unit: 'мл', type: 'number', min: 50, max: 5000, required: true, placeholder: '250', step: 50 },
        { id: 'timing', label: 'Когда', type: 'select', options: ['Утро', 'День', 'Вечер', 'После тренировки', 'Перед едой'], required: false }
      ],
      primaryValue: 'value',
      interpret: function(entry, profile) {
        var v = entry.value;
        var weight = profile && profile.weight ? profile.weight : 70;
        var dailyNorm = Math.round(weight * 30); // 30 мл/кг
        
        if (v >= 500) {
          return { 
            label: 'Большая порция', 
            status: 'normal', 
            color: '#059669',
            advice: 'Ваша дневная норма: ~' + dailyNorm + ' мл'
          };
        }
        if (v >= 200) {
          return { 
            label: 'Нормальная порция', 
            status: 'normal', 
            color: '#059669',
            advice: 'Дневная норма: ~' + dailyNorm + ' мл'
          };
        }
        return { 
          label: 'Маленькая порция', 
          status: 'warn', 
          color: '#D97706', 
          advice: 'Ваша дневная норма: ~' + dailyNorm + ' мл. Пейте больше!' 
        };
      }
    },

    // 😊 НАСТРОЕНИЕ
    mood: {
      id: 'mood',
      title: 'Настроение',
      icon: '😊',
      category: 'Ментальное',
      fields: [
        { id: 'value', label: 'Оценка', type: 'rating', min: 1, max: 5, required: true },
        { id: 'note', label: 'Заметка', type: 'select', options: [
          'Отличный день', 'Хорошо', 'Нормально', 'Плохо', 'Очень плохо',
          'Стресс', 'Тревога', 'Радость', 'Грусть', 'Усталость',
          'Энергия', 'Спокойствие'
        ], required: false }
      ],
      primaryValue: 'value',
      interpret: function(entry) {
        var v = entry.value;
        if (v >= 4) return { 
          label: 'Отличное настроение', 
          status: 'normal', 
          color: '#059669',
          advice: 'Продолжайте в том же духе! 💚'
        };
        if (v >= 3) return { 
          label: 'Нормальное', 
          status: 'normal', 
          color: '#059669'
        };
        if (v >= 2) return { 
          label: 'Пониженное', 
          status: 'warn', 
          color: '#D97706', 
          advice: 'Попробуйте прогулку, общение с близкими, любимое дело.'
        };
        return { 
          label: 'Плохое настроение', 
          status: 'danger', 
          color: '#B91C1C', 
          advice: 'Если сохраняется > 2 недель — обратитесь к психотерапевту.'
        };
      }
    },

    // 🏃 ФИЗИЧЕСКАЯ АКТИВНОСТЬ
    activity: {
      id: 'activity',
      title: 'Активность',
      icon: '🏃',
      category: 'Фитнес',
      fields: [
        { id: 'type', label: 'Тип активности', type: 'select', options: [
          'Ходьба', 'Бег', 'Велосипед', 'Плавание', 
          'Силовая тренировка', 'Йога', 'Танцы', 'Футбол/баскетбол',
          'Лыжи/коньки', 'Другое'
        ], required: true },
        { id: 'duration', label: 'Длительность', unit: 'мин', type: 'number', min: 1, max: 600, required: true, placeholder: '30' },
        { id: 'intensity', label: 'Интенсивность', type: 'select', options: ['Лёгкая', 'Средняя', 'Высокая'], required: false }
      ],
      primaryValue: 'duration',
      interpret: function(entry) {
        var d = entry.duration;
        if (d >= 60) return { 
          label: 'Отличная тренировка (' + d + ' мин)', 
          status: 'normal', 
          color: '#059669',
          advice: 'Превышает дневную норму WHO (30 мин)! 💪'
        };
        if (d >= 30) return { 
          label: 'Хорошая активность', 
          status: 'normal', 
          color: '#059669',
          advice: 'Достигли дневной нормы WHO (30 мин)'
        };
        if (d >= 15) return { 
          label: 'Лёгкая активность', 
          status: 'normal', 
          color: '#059669'
        };
        return { 
          label: 'Короткая активность', 
          status: 'warn', 
          color: '#D97706', 
          advice: 'Рекомендуется минимум 30 минут в день.'
        };
      }
    },

    // 🌸 МЕНСТРУАЛЬНЫЙ ЦИКЛ
    menstrual_cycle: {
      id: 'menstrual_cycle',
      title: 'Цикл',
      icon: '🌸',
      category: 'Женское здоровье',
      fields: [
        { id: 'phase', label: 'Фаза цикла', type: 'select', options: [
          'Менструация', 'Фолликулярная', 'Овуляция', 'Лютеиновая', 'ПМС'
        ], required: true },
        { id: 'day', label: 'День цикла', type: 'number', min: 1, max: 45, required: true, placeholder: '1' },
        { id: 'symptoms', label: 'Симптомы', type: 'select', options: [
          'Без симптомов', 'Боли внизу живота', 'Слабость', 
          'Раздражительность', 'Вздутие живота', 'Головная боль',
          'Боли в пояснице', 'Перепады настроения', 'Акне'
        ], required: false }
      ],
      primaryValue: 'day',
      interpret: function(entry) {
        var day = entry.day;
        var phase = entry.phase;
        
        if (phase === 'Менструация') {
          return { 
            label: 'Менструация, день ' + day, 
            status: 'normal', 
            color: '#D97706', 
            advice: 'Отдых, тепло, продукты богатые железом (говядина, гречка).'
          };
        }
        if (phase === 'Фолликулярная') {
          return { 
            label: 'Фолликулярная фаза (день ' + day + ')', 
            status: 'normal', 
            color: '#059669',
            advice: 'Пик энергии, хорошее время для тренировок.'
          };
        }
        if (phase === 'Овуляция') {
          return { 
            label: 'Овуляция (день ' + day + ')', 
            status: 'normal', 
            color: '#059669', 
            advice: 'Пик фертильности и энергии.'
          };
        }
        if (phase === 'Лютеиновая') {
          return { 
            label: 'Лютеиновая фаза (день ' + day + ')', 
            status: 'normal', 
            color: '#059669'
          };
        }
        if (phase === 'ПМС') {
          return { 
            label: 'ПМС (день ' + day + ')', 
            status: 'warn', 
            color: '#D97706', 
            advice: 'Магний, витамин B6, меньше кофеина и соли.'
          };
        }
        return { 
          label: 'День ' + day + ' цикла', 
          status: 'normal', 
          color: '#059669' 
        };
      }
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  ХРАНЕНИЕ ДАННЫХ
  // ═══════════════════════════════════════════════════════════
  function loadAll() {
    try {
      var data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  function saveAll(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Не удалось сохранить:', e);
    }
  }

  function getProfile() {
    try {
      var data = localStorage.getItem(PROFILE_KEY);
      return data ? JSON.parse(data) : { height: 175, weight: 70 };
    } catch (e) {
      return { height: 175, weight: 70 };
    }
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('Не удалось сохранить профиль:', e);
    }
  }

  function getEntries(metricId) {
    var data = loadAll();
    return data[metricId] || [];
  }

  function addEntry(metricId, entry) {
    var data = loadAll();
    if (!data[metricId]) data[metricId] = [];
    entry.id = 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    entry.date = entry.date || Date.now();
    data[metricId].push(entry);
    saveAll(data);

    // Обновляем вес в профиле если это запись о весе
    if (metricId === 'weight' && entry.value) {
      var profile = getProfile();
      profile.weight = entry.value;
      if (entry.height) profile.height = entry.height;
      saveProfile(profile);
    }

    return entry;
  }

  function deleteEntry(metricId, entryId) {
    var data = loadAll();
    if (!data[metricId]) return;
    data[metricId] = data[metricId].filter(function(e) { return e.id !== entryId; });
    saveAll(data);
  }

  function updateEntry(metricId, entryId, updates) {
    var data = loadAll();
    if (!data[metricId]) return;
    var idx = data[metricId].findIndex(function(e) { return e.id === entryId; });
    if (idx === -1) return;
    Object.assign(data[metricId][idx], updates);
    saveAll(data);
  }

  // ═══════════════════════════════════════════════════════════
  //  СТАТИСТИКА И АНАЛИЗ
  // ═══════════════════════════════════════════════════════════
  function getStats(metricId, daysBack) {
    daysBack = daysBack || 30;
    var entries = getEntries(metricId);
    var now = Date.now();
    var cutoff = now - daysBack * 24 * 60 * 60 * 1000;
    var filtered = entries.filter(function(e) { return e.date >= cutoff; });

    if (filtered.length === 0) {
      return { count: 0, avg: null, min: null, max: null, trend: 'none', change: 0, latest: null };
    }

    var metric = metrics[metricId];
    var field = metric.primaryValue;
    var values = filtered.map(function(e) { return e[field]; }).filter(function(v) { return typeof v === 'number'; });

    if (values.length === 0) {
      return { count: filtered.length, avg: null, min: null, max: null, trend: 'none', change: 0, latest: filtered[filtered.length - 1] };
    }

    var sum = values.reduce(function(a, b) { return a + b; }, 0);
    var avg = sum / values.length;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);

    var trend = 'none', change = 0;
    if (values.length >= 4) {
      var half = Math.floor(values.length / 2);
      var first = values.slice(0, half);
      var second = values.slice(half);
      var avgFirst = first.reduce(function(a, b) { return a + b; }, 0) / first.length;
      var avgSecond = second.reduce(function(a, b) { return a + b; }, 0) / second.length;
      change = avgSecond - avgFirst;
      var changePercent = (change / avgFirst) * 100;
      if (changePercent > 5) trend = 'up';
      else if (changePercent < -5) trend = 'down';
    }

    return {
      count: filtered.length,
      avg: avg,
      min: min,
      max: max,
      trend: trend,
      change: change,
      latest: filtered[filtered.length - 1],
      allEntries: filtered
    };
  }

  function getChartData(metricId, daysBack) {
    daysBack = daysBack || 30;
    var entries = getEntries(metricId);
    var now = Date.now();
    var cutoff = now - daysBack * 24 * 60 * 60 * 1000;
    var filtered = entries.filter(function(e) { return e.date >= cutoff; });

    filtered.sort(function(a, b) { return a.date - b.date; });

    var metric = metrics[metricId];
    var field = metric.primaryValue;

    var labels = filtered.map(function(e) {
      var d = new Date(e.date);
      return d.getDate() + '.' + (d.getMonth() + 1);
    });

    var data = filtered.map(function(e) { return e[field]; });
    var colors = filtered.map(function(e) {
      var interp = metric.interpret(e, getProfile());
      return interp.color;
    });

    return {
      labels: labels,
      data: data,
      colors: colors,
      entries: filtered
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  ЭКСПОРТ ДАННЫХ
  // ═══════════════════════════════════════════════════════════
  function exportToCSV(metricId) {
    var entries = getEntries(metricId);
    if (entries.length === 0) return null;

    var metric = metrics[metricId];
    var headers = ['Дата', 'Время'];
    metric.fields.forEach(function(f) {
      headers.push(f.label + (f.unit ? ' (' + f.unit + ')' : ''));
    });
    headers.push('Интерпретация');

    var rows = entries.map(function(e) {
      var d = new Date(e.date);
      var row = [
        d.toLocaleDateString('ru-RU'),
        d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      ];
      metric.fields.forEach(function(f) {
        row.push(e[f.id] !== undefined ? e[f.id] : '');
      });
      var interp = metric.interpret(e, getProfile());
      row.push(interp.label);
      return row;
    });

    var csv = [headers, ...rows].map(function(r) {
      return r.map(function(v) {
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    return '\uFEFF' + csv;
  }

  function exportAllForDoctor() {
    var all = loadAll();
    var lines = [];
    lines.push('═'.repeat(60));
    lines.push('ДНЕВНИК САМОЧУВСТВИЯ — ДЛЯ ВРАЧА');
    lines.push('═'.repeat(60));
    lines.push('');
    lines.push('Дата экспорта: ' + new Date().toLocaleString('ru-RU'));
    lines.push('');

    Object.keys(all).forEach(function(metricId) {
      var metric = metrics[metricId];
      if (!metric) return;
      var entries = all[metricId];
      if (entries.length === 0) return;

      lines.push('━━━ ' + metric.icon + ' ' + metric.title.toUpperCase() + ' (' + entries.length + ' записей) ━━━');
      lines.push('');

      entries.slice(-20).forEach(function(e) {
        var d = new Date(e.date);
        var dateStr = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        var values = metric.fields.map(function(f) {
          if (e[f.id] === undefined) return null;
          return f.label + ': ' + e[f.id] + (f.unit ? ' ' + f.unit : '');
        }).filter(Boolean).join(' | ');
        var interp = metric.interpret(e, getProfile());
        lines.push(dateStr + ' — ' + values + ' [' + interp.label + ']');
      });
      lines.push('');
    });

    lines.push('═'.repeat(60));
    lines.push('Экспортировано из "Семейный доктор ИИ"');
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  ОБЩАЯ СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════
  function getOverallStats() {
    var all = loadAll();
    var stats = {
      totalEntries: 0,
      activeMetrics: 0,
      lastEntryDate: 0,
      streak: 0
    };

    var allDates = [];

    Object.keys(all).forEach(function(metricId) {
      var entries = all[metricId] || [];
      if (entries.length > 0) {
        stats.activeMetrics++;
        stats.totalEntries += entries.length;
        entries.forEach(function(e) {
          allDates.push(e.date);
          if (e.date > stats.lastEntryDate) stats.lastEntryDate = e.date;
        });
      }
    });

    if (allDates.length > 0) {
      var uniqueDays = new Set(allDates.map(function(d) {
        var dt = new Date(d);
        return dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
      }));

      var streak = 0;
      var current = new Date();
      current.setHours(0, 0, 0, 0);

      for (var i = 0; i < 365; i++) {
        var key = current.getFullYear() + '-' + current.getMonth() + '-' + current.getDate();
        if (uniqueDays.has(key)) {
          streak++;
          current.setDate(current.getDate() - 1);
        } else {
          break;
        }
      }
      stats.streak = streak;
    }

    return stats;
  }

  // ═══════════════════════════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════════════════════════
  window.DiaryEngine = {
    metrics: metrics,
    getEntries: getEntries,
    addEntry: addEntry,
    deleteEntry: deleteEntry,
    updateEntry: updateEntry,
    getStats: getStats,
    getChartData: getChartData,
    getProfile: getProfile,
    saveProfile: saveProfile,
    exportToCSV: exportToCSV,
    exportAllForDoctor: exportAllForDoctor,
    getOverallStats: getOverallStats,
    version: '1.1.0'
  };
})();