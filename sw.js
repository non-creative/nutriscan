// NutriScan service worker — offline app-shell caching.
//
// Must be hosted as a real file in the same folder as index.html (never
// loaded via a blob: URL). Blob URLs are tied to the document session
// that created them and don't survive an app restart — registering a
// service worker that way caused a corrupted-render bug on iOS PWA in
// an earlier version of this app. A normal, network-fetchable script
// URL is the standard, well-supported approach and doesn't have that
// failure mode.
//
// Strategy:
//  - Navigation requests (loading the app itself): network first, so
//    you always get the latest version when online. Falls back to the
//    cached shell when offline. The cache is refreshed after every
//    successful online load.
//  - Fonts / the ZXing barcode library: cache first, with a background
//    refetch to keep the cache from ever going too stale.
//  - Everything else (Supabase, OpenFoodFacts, Gemini) is left alone —
//    those need a live network response and shouldn't be cached.

var CACHE_NAME = 'nutriscan-shell-v2';
var SHELL_URL  = './index.html';

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.add(SHELL_URL).catch(function() {});
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  // App shell — network first, cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function(res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(SHELL_URL, copy); });
        return res;
      }).catch(function() {
        return caches.match(SHELL_URL).then(function(cached) {
          return cached || caches.match(req);
        });
      })
    );
    return;
  }

  // Fonts + ZXing library — cache first, refresh in the background
  var url = req.url;
  var isStaticAsset =
    url.indexOf('fonts.googleapis.com') !== -1 ||
    url.indexOf('fonts.gstatic.com')    !== -1 ||
    url.indexOf('jsdelivr.net')         !== -1;

  if (isStaticAsset) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        var fetchPromise = fetch(req).then(function(res) {
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, res.clone()); });
          return res;
        }).catch(function() { return cached; });
        return cached || fetchPromise;
      })
    );
  }
});
