var CACHE = 'oliva-v4';
var STATIC = ['/cabinet', '/manifest.json', '/assets/img/logo.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(STATIC); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request);
    })
  );
});

/* ── Push notification ── */
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(_) {}
  var title   = data.title  || 'Oliva CRM';
  var options = {
    body:    data.body   || 'Новий запис!',
    icon:    data.icon   || '/assets/img/logo.png',
    badge:   data.badge  || '/assets/img/logo.png',
    tag:     data.tag    || 'oliva-notif',
    vibrate: [200, 100, 200],
    data:    { url: '/cabinet' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

/* Клік по сповіщенню → відкрити /cabinet */
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/cabinet';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes('/cabinet')) { list[i].focus(); return; }
      }
      clients.openWindow(url);
    })
  );
});
