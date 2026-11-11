// Service worker dell'app Alma Planet: riceve le notifiche push e, al tocco, apre la pagina giusta.
// Niente cache delle pagine: l'app resta sempre aggiornata come il sito.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Alma Planet', {
    body: data.body || '',
    icon: '/brand/almacis/app-icon-192.png',
    badge: '/brand/almacis/app-icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/app#/benvenuto' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/app#/benvenuto', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) {
        await c.focus();
        c.navigate ? await c.navigate(url) : c.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
