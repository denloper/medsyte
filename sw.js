// Service Worker v23 — с защитой от file:// протокола
const CACHE_NAME = 'vsem-dok-v23';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './about.html',
  './upload.html',
  './results.html',
  './compare.html',
  './calendar.html',
  './diary.html',
  './family.html',
  './nutrition.html',
  './history.html',
  './pharmacy.html',
  './recommendations.html',
  './chat.html',
  './styles.css?v=5.8.0',
  './animations.css?v=5.8.0',
  './database.js?v=5.8.0',
  './animations.js?v=5.8.0',
  './supabase-client.js?v=5.8.0',
  './ai-assistant.js?v=5.8.0',
  './calendar-engine.js?v=5.8.0',
  './diary-engine.js?v=5.8.0',
  './patient-profile.js?v=5.8.0',
  './clinical-guidelines.json',
  './manifest.json'
];

// ═══════════════════════════════════════════════════════════
//  ПРОВЕРКА: работаем только с http/https
// ═══════════════════════════════════════════════════════════
const isHttpProtocol = self.location.protocol === 'http:' || self.location.protocol === 'https:';

if (!isHttpProtocol) {
  console.warn('[SW] Пропускаем установку: протокол', self.location.protocol, 'не поддерживается. Используйте http-сервер для разработки.');
  // Прерываем установку — SW не будет активен
  // Но не выбрасываем ошибку чтобы не спамить в консоль
}

// ═══════════════════════════════════════════════════════════
//  INSTALL — кешируем ресурсы
// ═══════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  if (!isHttpProtocol) return; // пропускаем для file://
  
  console.log(`[SW ${CACHE_NAME}] Установка`);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кешируем ресурсы...');
        
        // Кешируем по одному — чтобы одна ошибка не валила всё
        const cachePromises = ASSETS_TO_CACHE.map(async (url) => {
          try {
            await cache.add(url);
            console.log(`[SW] ✓ ${url}`);
          } catch (err) {
            console.warn(`[SW] ✗ ${url}:`, err.message);
          }
        });
        
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log(`[SW ${CACHE_NAME}] Установка завершена`);
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Ошибка установки:', err);
      })
  );
});

// ═══════════════════════════════════════════════════════════
//  ACTIVATE — удаляем старые кеши
// ═══════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  if (!isHttpProtocol) return;
  
  console.log(`[SW ${CACHE_NAME}] Активация`);
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log(`[SW] Удаляем старый кеш: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log(`[SW ${CACHE_NAME}] Активация завершена`);
        return self.clients.claim();
      })
  );
});

// ═══════════════════════════════════════════════════════════
//  FETCH — стратегия Network First, fallback на Cache
// ═══════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  if (!isHttpProtocol) return; // не вмешиваемся в file://
  
  // Игнорируем внешние запросы (Supabase, OpenRouter, CDN)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return; // пропускаем — пусть браузер сам обрабатывает
  }
  
  // Игнорируем не-GET запросы
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кешируем только успешные ответы
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Если нет сети — берём из кеша
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Для навигационных запросов — отдаём index.html (offline fallback)
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});

// ═══════════════════════════════════════════════════════════
//  MESSAGE — обработка команд от клиента
// ═══════════════════════════════════════════════════════════
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      console.log(`[SW] Кеш ${CACHE_NAME} очищен`);
    });
  }
});