const CACHE_VERSION = 'sem-dok-v14';
const APP_VERSION = '5.1.0'; // ← синхронизируйте с meta в HTML

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

// ═══════════════════════════════════════
//  ACTIVATE — удаляем старые кеши, НО НЕ перезагружаем страницу
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

// ═══════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // CDN — cache-first
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

  // ═══════ HTML — NETWORK-FIRST + детект новой версии ═══════
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            // Обновляем кеш свежей версией
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
            
            // Возвращаем КЕШИРОВАННУЮ версию (чтобы не было автообновления)
            // Но параллельно проверяем, есть ли новая версия
            return caches.match(event.request).then(cached => {
              // Сравниваем версии через текст
              return Promise.all([networkResponse.clone().text(), cached.text()])
                .then(([networkText, cachedText]) => {
                  const networkVersion = extractVersion(networkText);
                  const cachedVersion = extractVersion(cachedText);
                  
                  if (networkVersion && cachedVersion && networkVersion !== cachedVersion) {
                    // Уведомляем клиента о новой версии
                    self.clients.matchAll().then(clients => {
                      clients.forEach(client => {
                        client.postMessage({
                          type: 'NEW_VERSION_AVAILABLE',
                          version: networkVersion,
                          currentVersion: cachedVersion
                        });
                      });
                    });
                  }
                  
                  // Возвращаем КЕШ (без автообновления!)
                  return cached;
                });
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // CSS/JS/JSON — cache-first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(r => {
        if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
        return r;
      }).catch(() => new Response('Offline', { status: 503 }))
    )
  );
});

// ═══════════════════════════════════════
//  Извлечение версии из HTML
// ═══════════════════════════════════════
function extractVersion(html) {
  const match = html.match(/<meta\s+name="app-version"\s+content="([^"]+)"/i);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════
//  MESSAGES от клиента
// ═══════════════════════════════════════
self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  if (event.data.type === 'FORCE_UPDATE') {
    // Принудительное обновление по кнопке
    caches.keys().then(keys => 
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      self.skipWaiting();
      event.source.postMessage({ type: 'UPDATE_COMPLETE' });
    });
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push-уведомления
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