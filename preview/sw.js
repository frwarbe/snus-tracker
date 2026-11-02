// Offline support. Always tries the network first so new versions show up straight away,
// and falls back to the saved copy when there's no connection.
const CACHE = 'snus-tracker-v5';
const FILES = ['./', 'index.html', 'style.css', 'logic.js', 'app.js',
  'fonts/dm-sans-latin-400-normal.woff2', 'fonts/dm-sans-latin-500-normal.woff2',
  'fonts/dm-sans-latin-600-normal.woff2', 'fonts/dm-sans-latin-700-normal.woff2', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // 'no-cache' asks the server whether the file changed instead of trusting the browser's copy.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
