const CACHE = 'cave-shell-v2';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
    );
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'Cave', {
    body: data.body || 'Você tem um lembrete.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'cave-reminder',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.focus() : clients.openWindow(event.notification.data?.url || '/');
  }));
});
