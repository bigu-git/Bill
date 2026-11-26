/* NOW OR NEVER — sw.js
   Offline cache for the app shell. Change CACHE_VERSION whenever you
   upload new files, so phones drop the old copy. */
const CACHE_VERSION = 'now-or-never-v4';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/responsive.css',
  './js/storage.js',
  './js/i18n.js',
  './js/lang-mn.js',
  './js/questions-mn.js',
  './js/questions.js',
  './js/cards.js',
  './js/game.js',
  './js/app.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) {
        // One file at a time: a missing file is skipped instead of failing the whole install.
        return Promise.all(SHELL.map(function (url) {
          return cache.add(url).catch(function () { /* skip */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Cached copy first (fast, works offline); the network refreshes it in the background.
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        const network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return null; });

        if (cached) return cached;
        return network.then(function (res) {
          if (res) return res;
          return req.mode === 'navigate' ? cache.match('./index.html') : Response.error();
        });
      });
    })
  );
});
