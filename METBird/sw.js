// METBird Service Worker — cache-first for static assets, network-first for API
const CACHE_NAME = 'metbird-v1';

const STATIC_ASSETS = [
  './',
  'index.html',
  'styles/style.css',
  'scripts/app.js',
  'scripts/api.js',
  'scripts/search.js',
  'scripts/taxonomy.js',
  'scripts/ui.js',
  'scripts/bird-object-ids.js',
  'scripts/bird-taxonomy.js',
];

const API_CACHE = 'metbird-api-v1';
const API_ORIGIN = 'https://collectionapi.metmuseum.org';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API requests: network-first, fall back to cache
  if (url.origin === API_ORIGIN) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(cache => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
