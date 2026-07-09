const CACHE_VERSION = 'sem-dok-v11';
const CACHE_NAME = 'sem-dok-v11';

// Полный список существующих файлов
const STATIC_ASSETS = [
  './',
  './index.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './database.js',
  './symptom-rag.js',
  './calendar-engine.js',
  './diary-engine.js',
  './clinical-guidelines.json',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// ═══════════════════════════════════════
//  УСТАНОВКА
// ═══════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Installing');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching assets...');
        // Кешируем только существующие файлы
        const promises = STATIC_ASSETS.map(url => {
          return cache.add(url).catch(err => {
            console.warn('[SW] Не удалось закешировать:', url, err.message);
          });
        });
        return Promise.all(promises);
      })
      .then(() => {
        console.log('[SW] All assets cached');
        return self.skipWaiting();
      })
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// ═══════════════════════════════════════
//  АКТИВАЦИЯ (агрессивная очистка)
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Activating');
  event.waitUntil(
    Promise.all([
      // Удаляем все старые кеши
      caches.keys().then(keys => {
        return Promise.all(
          keys.map(key => {
            if (key !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            }
          })
        );
      }),
      // Берём контроль над всеми клиентами
      self.clients.claim()
    ])
  );
});

// ═══════════════════════════════════════
//  FETCH — Network-first для HTML, Cache-first для остального
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
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => cached)
      )
    );
    return;
  }

  // JSON файлы — stale-while-revalidate
  if (request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(c => c.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // HTML — network-first с fallback на index.html
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // Остальные ресурсы — cache-first с fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Если файл не найден — возвращаем index.html
          if (request.url.endsWith('.html')) {
            return caches.match('./index.html');
          }
          return new Response('Not found', { status: 404 });
        });
    })
  );
});

// ═══════════════════════════════════════
//  PUSH УВЕДОМЛЕНИЯ
// ═══════════════════════════════════════
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './index.html';
  event.waitUntil(clients.openWindow(url));
});