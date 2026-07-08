// cabo service worker — caches the app shell so the installed app opens
// without internet (offline practice mode runs entirely in the page).
// Multiplayer traffic (/socket.io) is never touched.
const CACHE = 'cabo-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io')) return; // realtime stays live

  // pages: network-first, falling back to the cached shell offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // hashed static assets, fonts, icons: cache-first
  const cacheable = url.pathname.startsWith('/_next/static')
    || url.pathname.endsWith('.png')
    || url.pathname.endsWith('.svg')
    || url.pathname.endsWith('.webmanifest')
    || url.pathname.endsWith('.woff2');
  if (!cacheable) return;
  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit || fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
    )
  );
});
