// Service worker dell'app Alma Space: riceve le notifiche push e, al tocco, apre la pagina giusta.
// Niente cache delle pagine: l'app resta sempre aggiornata come il sito.
// Unica eccezione: le foto mandate con «Condividi» da Android (ALM2-48) restano in una cache solo finché la pagina le prende.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Alma Space', {
    body: data.body || '',
    icon: '/brand/almacis/app-icon-192.png?v=2',
    badge: '/brand/almacis/app-icon-192.png?v=2',
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

// «Condividi» da Android (manifest share_target, ALM2-48): Galleria, Fotocamera o Google Lens mandano qui le foto
// con un POST. Le teniamo in «alma-condivisi» e apriamo Contatti → Biglietti da visita, che le passa ad Alma e le cancella.
const SHARE_CACHE = 'alma-condivisi';
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/condividi') return;
  event.respondWith((async () => {
    let n = 0;
    try {
      const form = await event.request.formData();
      await caches.delete(SHARE_CACHE);
      const cache = await caches.open(SHARE_CACHE);
      const files = form.getAll('foto').filter(f => f && typeof f === 'object' && String(f.type).startsWith('image/')).slice(0, 5);
      for (const f of files) {
        await cache.put(`/condivisi/foto/${n}`, new Response(f, { headers: { 'Content-Type': f.type, 'X-Nome': encodeURIComponent(f.name || `foto-${n + 1}.jpg`) } }));
        n += 1;
      }
      const testo = ['title', 'text', 'url'].map(k => String(form.get(k) || '').trim()).filter(Boolean)
        .filter((t, i, a) => a.indexOf(t) === i).join(' · ').slice(0, 2000);
      await cache.put('/condivisi/info', new Response(JSON.stringify({ foto: n, testo, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
    } catch { /* se non si riesce a leggere si apre comunque la pagina */ }
    return Response.redirect(`/app#/crm/contatti/biglietti?condivisi=${n}`, 303);
  })());
});
