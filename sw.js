// Offline support. Bump CACHE when you change any file.
const CACHE = 'client-vault-v11';
const ASSETS = ['./', './index.html', './config.js', './manifest.json',
  './js/core.js', './js/backend.js', './js/data.js', './js/ui.js', './js/vault.js', './js/auth.js', './js/clients.js', './js/settings.js', './js/compliance.js', './js/practice.js', './js/invoice.js', './js/csv.js', './js/onboarding.js', './js/dashboard.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin files only: try the network first so updates arrive straight away,
// and fall back to the cached copy when offline. API calls (other origins) are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 'no-cache' revalidates with the server, so the browser's 10-minute HTTP cache can't serve an old version.
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
