// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Bump VERSION whenever you deploy changes.
const VERSION = 'kopor-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/util.js',
  'js/views/home.js', 'js/views/credit.js', 'js/views/cash.js', 'js/views/stock.js', 'js/views/groups.js',
  'js/views/invoices.js', 'js/views/health.js', 'js/views/more.js', 'js/views/ai.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached || cache.match('index.html'));
    return cached || fresh;
  }));
});
