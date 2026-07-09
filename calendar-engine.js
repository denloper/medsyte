/**
 * Calendar Engine v1.0
 * Умный календарь здоровья с рекомендациями по возрасту/полу/анамнезу
 */
;(function() {
  'use strict';

  var STORAGE_KEY = 'health_calendar_v1';
  var NOTIF_PERMISSION_KEY = 'notif_permission_v1';

  // ═══════════════════════════════════════════════════════════
  //  БАЗА РЕКОМЕНДАЦИЙ (по медицинским протоколам)
  // ═══════════════════════════════════════════════════════════
  var recommendations = [
    // Профилактические осмотры
    {
      id: 'checkup_annual',
      title: 'Ежегодный профилактический осмотр',
      description: 'Базовое обследование у терапевта: осмотр, измерения, базовые анализы',
      category: 'Осмотр',
      icon: '🩺',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      urgency: 'plan',
      priority: 2
    },
    {
      id: 'dental',
      title: 'Осмотр стоматолога',
      description: 'Профилактический осмотр, профессиональная чистка',
      category: 'Осмотр',
      icon: '🦷',
      intervalMonths: 6,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      urgency: 'plan',
      priority: 3
    },
    {
      id: 'ophthalmologist',
      title: 'Осмотр офтальмолога',
      description: 'Проверка зрения, осмотр глазного дна',
      category: 'Осмотр',
      icon: '👁',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 40, ageMax: 120 },
      urgency: 'plan',
      priority: 3
    },

    // Онкоскрининг
    {
      id: 'mammography',
      title: 'Маммография',
      description: 'Скрининг рака молочной железы',
      category: 'Онкоскрининг',
      icon: '🎀',
      intervalMonths: 24,
      appliesTo: { sex: 'female', ageMin: 40, ageMax: 75 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'pap_test',
      title: 'ПАП-тест (цитология шейки матки)',
      description: 'Скрининг рака шейки матки',
      category: 'Онкоскрининг',
      icon: '🌸',
      intervalMonths: 36,
      appliesTo: { sex: 'female', ageMin: 21, ageMax: 65 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'colonoscopy',
      title: 'Колоноскопия',
      description: 'Скрининг колоректального рака',
      category: 'Онкоскрининг',
      icon: '🔬',
      intervalMonths: 120,
      appliesTo: { sex: 'any', ageMin: 45, ageMax: 75 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'psa_screening',
      title: 'ПСА (простатспецифический антиген)',
      description: 'Скрининг рака предстательной железы',
      category: 'Онкоскрининг',
      icon: '🎗',
      intervalMonths: 12,
      appliesTo: { sex: 'male', ageMin: 50, ageMax: 75 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'dermatoscopy',
      title: 'Дерматоскопия родинок',
      description: 'Осмотр родинок для исключения меланомы',
      category: 'Онкоскрининг',
      icon: '🔍',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      urgency: 'plan',
      priority: 2
    },
    {
      id: 'low_dose_ct',
      title: 'Низкодозовая КТ лёгких',
      description: 'Скрининг рака лёгких (для курильщиков со стажем)',
      category: 'Онкоскрининг',
      icon: '🫁',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 50, ageMax: 80, riskFactors: ['smoking'] },
      urgency: 'important',
      priority: 1
    },

    // Анализы
    {
      id: 'vitamin_d',
      title: 'Витамин D (25-OH)',
      description: 'Контроль уровня витамина D',
      category: 'Анализы',
      icon: '☀',
      intervalMonths: 6,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      linkedTest: '25-гидроксивитамин D',
      urgency: 'plan',
      priority: 2
    },
    {
      id: 'ferritin',
      title: 'Ферритин',
      description: 'Контроль запасов железа (особенно женщинам)',
      category: 'Анализы',
      icon: '🩸',
      intervalMonths: 12,
      appliesTo: { sex: 'female', ageMin: 18, ageMax: 55 },
      linkedTest: 'Ферритин',
      urgency: 'plan',
      priority: 2
    },
    {
      id: 'lipid_panel',
      title: 'Липидограмма',
      description: 'Холестерин, ЛПНП, ЛПВП, триглицериды',
      category: 'Анализы',
      icon: '❤',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 35, ageMax: 120 },
      linkedTest: 'Холестерин общий',
      urgency: 'important',
      priority: 1
    },
    {
      id: 'glucose_hba1c',
      title: 'Глюкоза + HbA1c',
      description: 'Скрининг сахарного диабета',
      category: 'Анализы',
      icon: '🍬',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 40, ageMax: 120 },
      linkedTest: 'Глюкоза натощак',
      urgency: 'important',
      priority: 1
    },
    {
      id: 'tsh',
      title: 'ТТГ (щитовидная железа)',
      description: 'Контроль функции щитовидной железы',
      category: 'Анализы',
      icon: '🦋',
      intervalMonths: 24,
      appliesTo: { sex: 'female', ageMin: 30, ageMax: 120 },
      linkedTest: 'Тиреотропный гормон',
      urgency: 'plan',
      priority: 2
    },
    {
      id: 'cbc',
      title: 'Общий анализ крови',
      description: 'Гемоглобин, эритроциты, лейкоциты, тромбоциты',
      category: 'Анализы',
      icon: '🔴',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      linkedTest: 'Гемоглобин',
      urgency: 'plan',
      priority: 3
    },

    // Диагностика
    {
      id: 'ecg',
      title: 'ЭКГ',
      description: 'Электрокардиограмма',
      category: 'Диагностика',
      icon: '💓',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 40, ageMax: 120 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'flu_shot',
      title: 'Вакцинация от гриппа',
      description: 'Ежегодная прививка (сентябрь-ноябрь)',
      category: 'Вакцинация',
      icon: '💉',
      intervalMonths: 12,
      appliesTo: { sex: 'any', ageMin: 18, ageMax: 120 },
      urgency: 'plan',
      priority: 3,
      seasonal: 'autumn'
    },
    {
      id: 'blood_pressure',
      title: 'Измерение давления',
      description: 'Контроль артериального давления',
      category: 'Мониторинг',
      icon: '📈',
      intervalMonths: 1,
      appliesTo: { sex: 'any', ageMin: 40, ageMax: 120 },
      urgency: 'plan',
      priority: 3
    },

    // Для пожилых
    {
      id: 'bone_density',
      title: 'Денситометрия (плотность костей)',
      description: 'Скрининг остеопороза',
      category: 'Диагностика',
      icon: '🦴',
      intervalMonths: 24,
      appliesTo: { sex: 'female', ageMin: 65, ageMax: 120 },
      urgency: 'important',
      priority: 1
    },
    {
      id: 'hearing_test',
      title: 'Проверка слуха',
      description: 'Аудиометрия',
      category: 'Осмотр',
      icon: '👂',
      intervalMonths: 24,
      appliesTo: { sex: 'any', ageMin: 60, ageMax: 120 },
      urgency: 'plan',
      priority: 3
    }
  ];

  // ═══════════════════════════════════════════════════════════
  //  ХРАНЕНИЕ ДАННЫХ
  // ═══════════════════════════════════════════════════════════
  function loadEvents() {
    try {
      var data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : { events: [], completed: [], planned: [] };
    } catch (e) {
      return { events: [], completed: [], planned: [] };
    }
  }

  function saveEvents(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Не удалось сохранить:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  АНАЛИЗ ИСТОРИИ (интеграция с FamilyApp)
  // ═══════════════════════════════════════════════════════════
  function getLastTestDate(testName) {
    try {
      var history = JSON.parse(localStorage.getItem('analysis_history_v4') || '{}');
      var activeId = localStorage.getItem('active_profile_v4') || 'self';
      var items = history[activeId] || [];
      
      // Ищем анализы, в названии которых есть искомый тест
      var testLower = testName.toLowerCase();
      var foundDates = items
        .filter(function(item) {
          return item.label && item.label.toLowerCase().indexOf(testLower) !== -1;
        })
        .map(function(item) { return item.date; })
        .sort(function(a, b) { return b - a; });
      
      return foundDates.length > 0 ? foundDates[0] : null;
    } catch (e) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ГЕНЕРАЦИЯ ПЕРСОНАЛЬНОГО ПЛАНА
  // ═══════════════════════════════════════════════════════════
  function generatePlan(patientInfo) {
    var sex = patientInfo.sex || 'any';
    var age = patientInfo.age || 30;
    var data = loadEvents();
    var now = Date.now();
    var results = [];

    recommendations.forEach(function(rec) {
      // Проверка применимости
      var applies = rec.appliesTo;
      if (applies.sex !== 'any' && applies.sex !== sex) return;
      if (age < applies.ageMin || age > applies.ageMax) return;

      // Проверяем, когда выполнялось в последний раз
      var lastCompleted = null;
      var completedList = data.completed.filter(function(c) {
        return c.id === rec.id;
      }).sort(function(a, b) { return b.date - a.date; });
      
      if (completedList.length > 0) {
        lastCompleted = completedList[0].date;
      }

      // Ищем в истории анализов (для связанных тестов)
      if (!lastCompleted && rec.linkedTest) {
        lastCompleted = getLastTestDate(rec.linkedTest);
      }

      // Расчёт даты следующего
      var nextDueDate;
      if (lastCompleted) {
        nextDueDate = lastCompleted + rec.intervalMonths * 30 * 24 * 60 * 60 * 1000;
      } else {
        // Если никогда не делали — предлагаем в ближайший месяц
        nextDueDate = now + 30 * 24 * 60 * 60 * 1000;
      }

      // Проверяем, запланировано ли уже
      var planned = data.planned.find(function(p) { return p.id === rec.id; });

      // Определяем статус
      var daysUntil = Math.floor((nextDueDate - now) / (24 * 60 * 60 * 1000));
      var status;
      if (daysUntil < 0) status = 'overdue';
      else if (daysUntil <= 7) status = 'urgent';
      else if (daysUntil <= 30) status = 'soon';
      else if (daysUntil <= 90) status = 'upcoming';
      else status = 'planned';

      results.push({
        id: rec.id,
        title: rec.title,
        description: rec.description,
        category: rec.category,
        icon: rec.icon,
        urgency: rec.urgency,
        priority: rec.priority,
        nextDueDate: nextDueDate,
        lastCompleted: lastCompleted,
        daysUntil: daysUntil,
        status: status,
        isPlanned: !!planned,
        plannedDate: planned ? planned.date : null
      });
    });

    // Сортировка: сначала срочные, потом по приоритету, потом по дате
    results.sort(function(a, b) {
      var statusOrder = { overdue: 0, urgent: 1, soon: 2, upcoming: 3, planned: 4 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.nextDueDate - b.nextDueDate;
    });

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  ДЕЙСТВИЯ
  // ═══════════════════════════════════════════════════════════
  function markCompleted(id) {
    var data = loadEvents();
    data.completed.push({
      id: id,
      date: Date.now()
    });
    // Удаляем из запланированных
    data.planned = data.planned.filter(function(p) { return p.id !== id; });
    saveEvents(data);
    
    // Отменяем уведомление
    cancelNotification(id);
  }

  function scheduleEvent(id, date) {
    var data = loadEvents();
    data.planned = data.planned.filter(function(p) { return p.id !== id; });
    data.planned.push({
      id: id,
      date: date,
      createdAt: Date.now()
    });
    saveEvents(data);
    
    // Планируем уведомление
    scheduleNotification(id, date);
  }

  function postpone(id, days) {
    var newDate = Date.now() + days * 24 * 60 * 60 * 1000;
    scheduleEvent(id, newDate);
  }

  // ═══════════════════════════════════════════════════════════
  //  УВЕДОМЛЕНИЯ
  // ═══════════════════════════════════════════════════════════
  function requestPermission() {
    if (!('Notification' in window)) {
      return Promise.resolve('unsupported');
    }
    if (Notification.permission === 'granted') {
      return Promise.resolve('granted');
    }
    if (Notification.permission === 'denied') {
      return Promise.resolve('denied');
    }
    return Notification.requestPermission();
  }

  function scheduleNotification(eventId, date) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    
    var rec = recommendations.find(function(r) { return r.id === eventId; });
    if (!rec) return;

    var delay = date - Date.now();
    if (delay < 0) return;

    // Сохраняем расписание для SW
    var schedule = JSON.parse(localStorage.getItem('notif_schedule_v1') || '[]');
    schedule.push({
      id: eventId,
      title: rec.icon + ' ' + rec.title,
      body: rec.description,
      date: date,
      url: './calendar.html'
    });
    localStorage.setItem('notif_schedule_v1', JSON.stringify(schedule));

    // Отправляем в SW
    navigator.serviceWorker.controller.postMessage({
      type: 'SCHEDULE_NOTIFICATION',
      payload: {
        id: eventId,
        title: rec.icon + ' ' + rec.title,
        body: rec.description,
        delay: delay,
        url: './calendar.html'
      }
    });
  }

  function cancelNotification(eventId) {
    var schedule = JSON.parse(localStorage.getItem('notif_schedule_v1') || '[]');
    schedule = schedule.filter(function(s) { return s.id !== eventId; });
    localStorage.setItem('notif_schedule_v1', JSON.stringify(schedule));

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CANCEL_NOTIFICATION',
        payload: { id: eventId }
      });
    }
  }

  function sendImmediateNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        payload: { title: title, body: body, url: './calendar.html' }
      });
    } else if ('Notification' in window) {
      new Notification(title, { body: body, icon: './manifest.json' });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════
  function getStats(plan) {
    var stats = {
      overdue: 0,
      urgent: 0,
      soon: 0,
      upcoming: 0,
      planned: 0,
      total: plan.length,
      completedThisYear: 0
    };

    plan.forEach(function(item) {
      if (stats[item.status] !== undefined) stats[item.status]++;
    });

    // Считаем выполненные за последний год
    var data = loadEvents();
    var yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    stats.completedThisYear = data.completed.filter(function(c) {
      return c.date > yearAgo;
    }).length;

    return stats;
  }

  // ═══════════════════════════════════════════════════════════
  //  ЭКСПОРТ
  // ═══════════════════════════════════════════════════════════
  window.HealthCalendar = {
    generatePlan: generatePlan,
    markCompleted: markCompleted,
    scheduleEvent: scheduleEvent,
    postpone: postpone,
    loadEvents: loadEvents,
    getStats: getStats,
    requestPermission: requestPermission,
    sendImmediateNotification: sendImmediateNotification,
    recommendations: recommendations,
    version: '1.0.0'
  };
})();