const CACHE_PREFIX = 'harmonogram-mow-shell-';
const APP_VERSION = '12.3.0';
const CACHE = `${CACHE_PREFIX}${APP_VERSION}`;
const ASSETS = ['./', './index.html', './assets/styles.css?v=12.3.0', './assets/app.js?v=12.3.0', './assets/icon.svg', './assets/icon-maskable.svg', './manifest.webmanifest', './data/sample-weeks.json'];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.cache === 'no-store') {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put('./index.html', response.clone())));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (!ASSET_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, response.clone())));
      return response;
    }))
  );
});
