// Aggiornamenti in tempo reale con Server-Sent Events: ogni scheda aperta tiene un canale con il server.
// Un'istanza sola su Railway, quindi basta tenere i canali in memoria.
function createLive() {
  const clients = new Map(); // userId → Set(res)

  function register(app) {
    app.get('/api/stream', (req, res) => {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write('retry: 5000\n\n');
      const uid = req.user.id;
      if (!clients.has(uid)) clients.set(uid, new Set());
      clients.get(uid).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        const set = clients.get(uid);
        set?.delete(res);
        if (set && !set.size) clients.delete(uid);
      });
    });
  }

  function send(userIds, event, data = {}) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const uid of new Set(userIds)) for (const res of clients.get(uid) || []) res.write(msg);
  }

  const broadcast = (event, data, { except } = {}) => send([...clients.keys()].filter(u => u !== except), event, data);
  const isOnline = userId => clients.has(userId);

  return { register, send, broadcast, isOnline };
}

module.exports = { createLive };
