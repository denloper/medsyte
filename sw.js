const CACHE_VERSION = 'sem-dok-v19';
const APP_VERSION = '5.5.0';

const STATIC_ASSETS = [
  './',
  './index.html',
  './about.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './family.html',              // ← новая страница
  './styles.css?v=' + APP_VERSION,
  './animations.css?v=' + APP_VERSION,
  './database.js?v=' + APP_VERSION,
  './animations.js?v=' + APP_VERSION,
  './local-db.js?v=' + APP_VERSION,   // ← новый файл
  './calendar-engine.js?v=' + APP_VERSION,
  './diary-engine.js?v=' + APP_VERSION,
  './clinical-guidelines.json',
  './manifest.json'
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js'  // ← Dexie.js для IndexedDB
];

self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Установка');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        const localPromises = STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Не удалось:', url))
        );
        const cdnPromises = CDN_ASSETS.map(url =>
          fetch(url).then(r => r.ok && cache.put(url, r)).catch(() => {})
        );
        return Promise.all([...localPromises, ...cdnPromises]);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ]).then(() => {
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'NEW_VERSION_ACTIVE', version: APP_VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(r => {
          if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
          return r;
        }).catch(() => cached)
      )
    );
    return;
  }

  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(r => {
          if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  if (event.request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const responseToSend = cached ? cached.clone() : null;
        const fetchPromise = fetch(event.request)
          .then(r => {
            if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
            return r;
          })
          .catch(() => cached);
        return responseToSend || fetchPromise;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached.clone();
      return fetch(event.request).then(r => {
        if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
        return r;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION') {
    event.source.postMessage({
      type: 'VERSION_INFO',
      version: APP_VERSION,
      cache: CACHE_VERSION
    });
  }
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Семейный доктор', body: 'Время проверить здоровье!' };
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