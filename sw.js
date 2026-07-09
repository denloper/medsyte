const CACHE_VERSION = 'sem-dok-v10';

const STATIC_ASSETS = [
  './',
  './index.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './database.js',
  './symptom-rag.js',
  './calendar-engine.js',
  './clinical-guidelines.json',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// Хранилище запланированных уведомлений (setTimeout id)
const scheduledTimers = new Map();

self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Installing');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Activating');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════
//  СООБЩЕНИЯ ОТ КЛИЕНТА
// ═══════════════════════════════════════
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
  }
});

function scheduleNotification(payload) {
  const { id, title, body, delay, url } = payload;
  
  // Отменяем предыдущий таймер для этого события
  cancelNotification(id);

  if (delay <= 0) {
    showNotification({ title, body, url });
    return;
  }

  // setTimeout работает пока SW активен
  // Для надёжности в проде нужно использовать Background Sync API
  const timerId = setTimeout(() => {
    showNotification({ title, body, url, tag: id });
    scheduledTimers.delete(id);
  }, delay);

  scheduledTimers.set(id, timerId);
  console.log('[SW] Запланировано уведомление:', id, 'через', Math.round(delay / 1000 / 60), 'мин');
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
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' }
    ]
  });
}

// ═══════════════════════════════════════
//  КЛИК ПО УВЕДОМЛЕНИЮ
// ═══════════════════════════════════════
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || './index.html';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Если вкладка уже открыта — фокусируем её
        for (const client of clientList) {
          if (client.url.includes(urlToOpen.replace('./', '')) && 'focus' in client) {
            return client.focus();
          }
        }
        // Иначе открываем новую
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ═══════════════════════════════════════
//  STRATEGIES
// ═══════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Внешние ресурсы (CDN) — cache-first
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => cached)
      )
    );
    return;
  }

  // JSON — stale-while-revalidate
  if (request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // HTML — network-first
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Остальное — cache-first
  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, clone));
        }
        return response;
      })
    )
  );
});

// Push API (для серверных push-уведомлений в будущем)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'СемДок', body: 'Время проверить здоровье!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './manifest.json',
      data: { url: data.url || './index.html' }
    })
  );
});