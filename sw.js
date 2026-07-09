const CACHE_VERSION = 'sem-dok-v15';
const APP_VERSION = '5.2.0';

const STATIC_ASSETS = [
  './',
  './index.html',
  './about.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './styles.css?v=' + APP_VERSION,
  './database.js?v=' + APP_VERSION,
  './symptom-rag.js?v=' + APP_VERSION,
  './calendar-engine.js?v=' + APP_VERSION,
  './diary-engine.js?v=' + APP_VERSION,
  './clinical-guidelines.json',
  './manifest.json'
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

// ═══════════════════════════════════════
//  INSTALL
// ═══════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Установка');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        const localPromises = STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Не удалось закешировать:', url, err.message))
        );
        const cdnPromises = CDN_ASSETS.map(url =>
          fetch(url)
            .then(r => r.ok && cache.put(url, r))
            .catch(() => {})
        );
        return Promise.all([...localPromises, ...cdnPromises]);
      })
      .then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════
//  ACTIVATE — удаляем старые кеши + уведомляем клиентов о новой версии
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация');
  event.waitUntil(
    Promise.all([
      // Удаляем старые кеши
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_VERSION).map(k => {
            console.log('[SW] Удаление старого кеша:', k);
            return caches.delete(k);
          })
        )
      ),
      // Берём контроль над клиентами
      self.clients.claim()
    ]).then(() => {
      // Уведомляем все открытые вкладки о новой версии
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'NEW_VERSION_ACTIVE',
            version: APP_VERSION
          });
        });
      });
    })
  );
});

// ═══════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // ═══════ CDN — cache-first ═══════
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached)
      )
    );
    return;
  }

  // ═══════ HTML — Network-first с fallback ═══════
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            // Клонируем ПЕРЕД использованием
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_VERSION).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          // Возвращаем оригинальный networkResponse (не клон, не кеш!)
          return networkResponse;
        })
        .catch(() => {
          // Оффлайн: отдаём из кеша
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // ═══════ JSON — Stale-while-revalidate ═══════
  if (event.request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        // Возвращаем КЛОН кеша (чтобы не блокировать оригинал)
        const responseToSend = cached ? cached.clone() : null;
        
        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached);
        
        return responseToSend || fetchPromise;
      })
    );
    return;
  }

  // ═══════ CSS/JS/изображения — Cache-first ═══════
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Возвращаем КЛОН, чтобы не блокировать
        return cached.clone();
      }
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

// ═══════════════════════════════════════
//  MESSAGES от клиента
// ═══════════════════════════════════════
self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'GET_VERSION') {
    event.source.postMessage({
      type: 'VERSION_INFO',
      version: APP_VERSION,
      cache: CACHE_VERSION
    });
  }
});

// ═══════════════════════════════════════
//  PUSH уведомления
// ═══════════════════════════════════════
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {
    title: 'Семейный доктор',
    body: 'Время проверить здоровье!'
  };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './manifest.json',
      data: { url: data.url || './calendar.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './calendar.html';
  event.waitUntil(clients.openWindow(url));
});