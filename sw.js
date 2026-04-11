const CACHE_NAME = 'ariabo-cfo-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Cache fonts and Firebase SDK
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'www.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(resp =>
          resp || fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          })
        )
      )
    );
    return;
  }
  // Network first for API calls
  if (url.hostname.includes('firestore') || url.hostname.includes('firebase') || url.hostname.includes('googleapis')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  // Cache first for app shell
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
