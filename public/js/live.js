// Aggiornamenti in tempo reale dal server (notifiche, nuovi post e storie).
const handlers = new Map();
const EVENTS = ['notification', 'post', 'story', 'badges'];

export function startLive() {
  const es = new EventSource('/api/stream');
  for (const ev of EVENTS) {
    es.addEventListener(ev, e => {
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* evento senza dati */ }
      for (const fn of handlers.get(ev) || []) fn(data);
    });
  }
}

// Restituisce la funzione che smette di ascoltare.
export function onLive(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => handlers.get(event).delete(fn);
}
