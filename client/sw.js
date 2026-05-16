// Service Worker — сеть в приоритете, кэш как запасной вариант
const CACHE = 'dobropost-v1';
const PRECACHE = ['/', '/tabs/images.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // API-запросы — только сеть, без кэша
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push-уведомления ──────────────────────────────────────────────
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(_) { data = { title: 'DobroPost AI', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'DobroPost AI', {
      body:    data.body  || '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     data.tag   || 'dobropost',
      data:    { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === url && 'focus' in list[i]) return list[i].focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
