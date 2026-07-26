/* ponytail: hand-rolled SW — installability + push only. No offline cache
   of the SPA shell; Vite hashed assets and the Nest static server already
   cover reload. Add Workbox precache when offline-first actually matters. */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    // Focused tab can toast itself; hidden/background still needs the push.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((client) => 'focused' in client && client.focused)) return;

    let data = { title: 'livecoder', body: 'Agent finished', url: '/agent' };
    try {
      if (event.data) data = { ...data, ...event.data.json() };
    } catch {
      // keep defaults
    }
    await self.registration.showNotification(data.title || 'livecoder', {
      body: data.body || 'Agent finished',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'agent-finished',
      data: { url: data.url || '/agent' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/agent';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(target);
          return undefined;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
