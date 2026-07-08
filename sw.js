// ВАЖНО: меняйте версию при каждом обновлении, чтобы сбросить кеш
const CACHE_VERSION = 'sem-dok-v5';

// Базовый путь для GitHub Pages (авто-определение)
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, '');

const STATIC_ASSETS = [
  './',
  './index.html',
  './upload.html',
  './results.html',
  './compare.html',
  './database.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

// Установка
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// Активация: удаляем старые кеши
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      const deletions = keys
        .filter(key => key !== CACHE_VERSION)
        .map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        });
      return Promise.all(deletions);
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first для HTML, cache-first для остального
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Пропускаем не-GET запросы
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  
  // Для внешних ресурсов (CDN) — cache-first
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
      })
    );
    return;
  }
  
  // Для HTML — network-first с fallback на cache
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => 
          caches.match(request).then(cached => 
            cached || caches.match('./index.html')
          )
        )
    );
    return;
  }
  
  // Для остальных ресурсов (JS, CSS, изображения) — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        });
    })
  );
});