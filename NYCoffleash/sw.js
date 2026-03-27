// NYCoffleash Service Worker — caches static assets and API responses
const CACHE_NAME = 'nycoffleash-v1';

// Static assets to pre-cache on install
const PRECACHE = [
  '/',
  '/index.html',
  '/styles/style.css',
  '/scripts/app.js',
  '/data/boroughs.geojson',
  '/data/dogruns.geojson',
];

// Install: pre-cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // NYC Open Data API: network-first with cache fallback
  if (url.hostname === 'data.cityofnewyork.us') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CDN resources (MapLibre, tiles): cache-first
  if (url.hostname === 'cdn.jsdelivr.net' ||
      url.hostname === 'tiles.openfreemap.org') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Local static files: cache-first with network fallback
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});
