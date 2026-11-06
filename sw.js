const CACHE = 'navra-offline-v9-organizzazione-vendite';
const ASSETS = ['./', './index.html', './app.js', './firebase-adapter.js',
  './navra-articoli.js', './navra-upgrade.js', './navra-lotti.js',
  './navra-report-articoli.js', './navra-organizzazione-vendite.js', './manifest.webmanifest', './icon.svg',
  './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('navra-offline-') && key !== CACHE).map(key => caches.delete(key))))
])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) ||
    (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
