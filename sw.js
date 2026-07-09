const CACHE_VERSION = 'sem-dok-v12';
const CACHE_NAME = 'sem-dok-v12';
const OFFLINE_URL = './index.html';

// ═══════════════════════════════════════
//  СПИСОК СТАТИЧЕСКИХ ФАЙЛОВ ДЛЯ КЕШИРОВАНИЯ
// ═══════════════════════════════════════
const STATIC_ASSETS = [
  // HTML страницы
  './',
  './index.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  
  // CSS
  './styles.css',
  
  // JavaScript
  './database.js',
  './symptom-rag.js',
  './calendar-engine.js',
  './diary-engine.js',
  
  // Данные
  './clinical-guidelines.json',
  './manifest.json'
];

// Внешние CDN ресурсы
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// ═══════════════════════════════════════
//  УСТАНОВКА SERVICE WORKER
// ═══════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Установка...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Кеширование статических файлов...');
        
        // Кешируем локальные файлы (с обработкой ошибок для каждого)
        const localPromises = STATIC_ASSETS.map(url => {
          return cache.add(url).catch(err => {
            console.warn('[SW] Не удалось закешировать:', url, err.message);
          });
        });
        
        // Кешируем CDN ресурсы (fetch + put, так как add может не работать с CORS)
        const cdnPromises = CDN_ASSETS.map(url => {
          return fetch(url)
            .then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
            })
            .catch(err => {
              console.warn('[SW] Не удалось закешировать CDN:', url, err.message);
            });
        });
        
        return Promise.all([...localPromises, ...cdnPromises]);
      })
      .then(() => {
        console.log('[SW] Все файлы закешированы');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Ошибка установки:', err);
      })
  );
});

// ═══════════════════════════════════════
//  АКТИВАЦИЯ (ОЧИСТКА СТАРЫХ КЕШЕЙ)
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация...');
  
  event.waitUntil(
    Promise.all([
      // Удаляем все старые версии кеша
      caches.keys().then(keys => {
        return Promise.all(
          keys.map(key => {
            if (key !== CACHE_NAME) {
              console.log('[SW] Удаление старого кеша:', key);
              return caches.delete(key);
            }
          })
        );
      }),
      // Берём контроль над всеми открытыми вкладками
      self.clients.claim()
    ])
  );
});

// ═══════════════════════════════════════
//  ОБРАБОТКА FETCH ЗАПРОСОВ
// ═══════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Пропускаем не-GET запросы
  if (request.method !== 'GET') return;
  
  // Пропускаем запросы с другими схемами (chrome-extension, data: и т.д.)
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // ═══════ ВНЕШНИЕ РЕСУРСЫ (CDN) — Cache-first ═══════
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        
        return fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
      })
    );
    return;
  }

  // ═══════ JSON ФАЙЛЫ — Stale-while-revalidate ═══════
  if (request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(request).then(cached => {
        // Сразу возвращаем кеш (если есть)
        const fetchPromise = fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ═══════ HTML СТРАНИЦЫ — Network-first с fallback ═══════
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Пробуем отдать из кеша
          return caches.match(request)
            .then(cached => cached || caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // ═══════ ОСТАЛЬНЫЕ РЕСУРСЫ (JS, CSS, изображения) — Cache-first ═══════
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      
      return fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Fallback для HTML файлов
          if (request.url.endsWith('.html')) {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline - Семейный доктор ИИ', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});

// ═══════════════════════════════════════
//  PUSH УВЕДОМЛЕНИЯ (от сервера)
// ═══════════════════════════════════════
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {
    title: 'Семейный доктор',
    body: 'Время проверить здоровье!',
    url: './calendar.html'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './manifest.json',
      badge: './manifest.json',
      vibrate: [200, 100, 200],
      data: { url: data.url || './calendar.html' },
      actions: [
        { action: 'open', title: 'Открыть' },
        { action: 'dismiss', title: 'Позже' }
      ]
    })
  );
});

// ═══════════════════════════════════════
//  КЛИК ПО УВЕДОМЛЕНИЮ
// ═══════════════════════════════════════
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Если пользователь нажал "Позже" — ничего не делаем
  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || './calendar.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Ищем уже открытую вкладку с нужным URL
        for (const client of clientList) {
          if (client.url.includes(urlToOpen.replace('./', '')) && 'focus' in client) {
            return client.focus();
          }
        }
        // Если не нашли — открываем новую
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ═══════════════════════════════════════
//  СООБЩЕНИЯ ОТ КЛИЕНТА (для планирования уведомлений)
// ═══════════════════════════════════════
const scheduledTimers = new Map();

self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  switch (event.data.type) {
    case 'SCHEDULE_NOTIFICATION':
      scheduleNotification(event.data.payload);
      break;
    case 'CANCEL_NOTIFICATION':
      cancelNotification(event.data.payload.id);
      break;
    case 'SHOW_NOTIFICATION':
      showNotification(event.data.payload);
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

function scheduleNotification(payload) {
  const { id, title, body, delay, url } = payload;
  
  // Отменяем предыдущий таймер
  cancelNotification(id);

  if (delay <= 0) {
    showNotification({ title, body, url, tag: id });
    return;
  }

  const timerId = setTimeout(() => {
    showNotification({ title, body, url, tag: id });
    scheduledTimers.delete(id);
  }, delay);

  scheduledTimers.set(id, timerId);
  console.log('[SW] Запланировано уведомление:', id, 'через', Math.round(delay / 60000), 'мин');
}

function cancelNotification(id) {
  if (scheduledTimers.has(id)) {
    clearTimeout(scheduledTimers.get(id));
    scheduledTimers.delete(id);
    console.log('[SW] Отменено уведомление:', id);
  }
}

function showNotification(payload) {
  const { title, body, url, tag } = payload;
  self.registration.showNotification(title, {
    body: body || '',
    icon: './manifest.json',
    badge: './manifest.json',
    tag: tag || 'default',
    data: { url: url || './index.html' },
    vibrate: [200, 100, 200]
  });
}