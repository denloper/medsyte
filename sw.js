const CACHE_VERSION = 'sem-dok-v20';
const APP_VERSION = '5.5.1';

const STATIC_ASSETS = [
  // HTML страницы
  './',
  './index.html',
  './about.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './family.html',
  
  // CSS
  './styles.css?v=' + APP_VERSION,
  './animations.css?v=' + APP_VERSION,
  
  // JavaScript
  './database.js?v=' + APP_VERSION,
  './animations.js?v=' + APP_VERSION,
  './supabase-client.js?v=' + APP_VERSION,
  './calendar-engine.js?v=' + APP_VERSION,
  './diary-engine.js?v=' + APP_VERSION,
  
  // Данные
  './clinical-guidelines.json',
  './manifest.json'
];

const CDN_ASSETS = [
  // Supabase SDK
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  // PDF парсинг
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  // OCR
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  // Графики
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
          cache.add(url).catch(err => console.warn('[SW] Не удалось:', url, err.message))
        );
        const cdnPromises = CDN_ASSETS.map(url =>
          fetch(url)
            .then(r => {
              if (r.ok) return cache.put(url, r);
              console.warn('[SW] CDN не OK:', url, r.status);
            })
            .catch(err => console.warn('[SW] CDN ошибка:', url, err.message))
        );
        return Promise.all([...localPromises, ...cdnPromises]);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// ═══════════════════════════════════════
//  ACTIVATE — удаляем старые кеши + уведомляем клиентов
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_VERSION).map(k => {
            console.log('[SW] Удаление старого кеша:', k);
            return caches.delete(k);
          })
        )
      ),
      self.clients.claim()
    ]).then(() => {
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'NEW_VERSION_ACTIVE',
            version: APP_VERSION,
            cache: CACHE_VERSION
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
        cached || fetch(event.request).then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return r;
        }).catch(() => cached)
      )
    );
    return;
  }

  // ═══════ HTML — network-first с fallback ═══════
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return r;
        })
        .catch(() => 
          caches.match(event.request).then(c => c || caches.match('./index.html'))
        )
    );
    return;
  }

  // ═══════ JSON — stale-while-revalidate ═══════
  if (event.request.url.endsWith('.json')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const responseToSend = cached ? cached.clone() : null;
        const fetchPromise = fetch(event.request)
          .then(r => {
            if (r.ok) {
              const clone = r.clone();
              caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
            }
            return r;
          })
          .catch(() => cached);
        return responseToSend || fetchPromise;
      })
    );
    return;
  }

  // ═══════ CSS/JS/images — cache-first ═══════
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached.clone();
      return fetch(event.request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return r;
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
  
  if (event.data.type === 'FORCE_UPDATE') {
    caches.keys().then(keys => 
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      self.skipWaiting();
      if (event.source) {
        event.source.postMessage({ type: 'UPDATE_COMPLETE' });
      }
    });
  }
});

// ═══════════════════════════════════════
//  PUSH NOTIFICATIONS
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
      badge: './manifest.json',
      data: { url: data.url || './calendar.html' },
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './calendar.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(url.replace('./', '')) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});