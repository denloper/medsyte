const CACHE_VERSION = 'sem-dok-v14';

const STATIC_ASSETS = [
  './',
  './index.html',
  './about.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './styles.css',
  './database.js',
  './symptom-rag.js',
  './calendar-engine.js',
  './diary-engine.js',
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
//  УСТАНОВКА
// ═══════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Установка');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        const promises = STATIC_ASSETS.map(url => 
          cache.add(url).catch(err => console.warn('[SW] Пропущен:', url))
        );
        const cdnPromises = CDN_ASSETS.map(url =>
          fetch(url).then(r => r.ok && cache.put(url, r)).catch(() => {})
        );
        return Promise.all([...promises, ...cdnPromises]);
      })
      .then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════
//  АКТИВАЦИЯ + уведомление клиентов об обновлении
// ═══════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW v' + CACHE_VERSION + '] Активация');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ]).then(() => {
      // Уведомляем все открытые вкладки об обновлении
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ═══════════════════════════════════════
//  СООБЩЕНИЯ ОТ КЛИЕНТА
// ═══════════════════════════════════════
self.addEventListener('message', (event) => {
  if (!event.data) return;
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => 
        Promise.all(keys.map(k => caches.delete(k)))
      ).then(() => {
        event.source.postMessage({ type: 'CACHE_CLEARED' });
      })
    );
  }
});

// ═══════════════════════════════════════
//  FETCH — УМНАЯ СТРАТЕГИЯ
// ═══════════════════════════════════════
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);
  
  // Проверяем, есть ли force-reload параметр
  const isForceReload = url.searchParams.has('_forceReload') || 
                        url.searchParams.has('_v');

  // CDN — cache-first (если не force reload)
  if (url.origin !== self.location.origin) {
    if (isForceReload) {
      event.respondWith(
        fetch(event.request, { cache: 'no-store' })
          .then(r => {
            if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
            return r;
          })
      );
    } else {
      event.respondWith(
        caches.match(event.request).then(cached =>
          cached || fetch(event.request).then(r => {
            if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
            return r;
          }).catch(() => cached)
        )
      );
    }
    return;
  }

  // HTML — ВСЕГДА network-first с cache-busting
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request, { 
        cache: isForceReload ? 'no-store' : 'default',
        headers: isForceReload ? { 
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        } : {}
      })
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — отдаём из кеша
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // CSS/JS/JSON — cache-first, но с проверкой версий
  if (event.request.url.match(/\.(css|js|json)$/)) {
    if (isForceReload) {
      event.respondWith(
        fetch(event.request, { cache: 'no-store' })
          .then(r => {
            if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
            return r;
          })
          .catch(() => caches.match(event.request))
      );
    } else {
      event.respondWith(
        caches.match(event.request).then(cached =>
          cached || fetch(event.request).then(r => {
            if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
            return r;
          }).catch(() => new Response('Offline', { status: 503 }))
        )
      );
    }
    return;
  }

  // Остальное — cache-first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(r => {
        if (r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
        return r;
      })
    )
  );
});

// Push-уведомления
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