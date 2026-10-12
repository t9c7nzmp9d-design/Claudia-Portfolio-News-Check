// Service Worker: App offline verfügbar machen und Klicks auf Benachrichtigungen behandeln.
// Bei Änderungen an App-Dateien die Versionsnummer erhöhen.
const CACHE = 'depot-news-v2.1.1';
const SHELL = [
  './', 'index.html', 'datenschutz.html', 'README.md', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/util.js', 'js/assets.js', 'js/parser.js', 'js/news.js', 'js/sources.js', 'js/store.js', 'js/lookup.js', 'js/prompt.js',
  'vendor/xlsx.full.min.js',
  'sample/Musterdepot.xlsx', 'sample/Musterdepot.csv', 'sample/Musterdepot_Bank-Export.csv',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nur eigene Dateien cachen; Nachrichtendienste immer live abrufen.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // am Browser-Cache vorbei beim Server nachfragen (GitHub Pages cacht sonst 10 Minuten)
    fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || './';
  e.waitUntil((async () => {
    if (/^https?:/.test(target) && !target.startsWith(self.location.origin)) {
      return self.clients.openWindow(target);
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  })());
});
