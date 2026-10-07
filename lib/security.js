// Limiti di frequenza e registro delle azioni.
// Un'istanza sola su Railway, quindi i contatori stanno in memoria.
const { HttpError } = require('./http');

// Finestra fissa: al massimo `max` richieste ogni `windowMs` per chiave (IP o utente).
function rateLimit({ windowMs, max, key, message = 'Troppe richieste, riprova tra poco' }) {
  const hits = new Map(); // chiave → { count, reset }
  setInterval(() => {
    const now = Date.now();
    for (const [k, h] of hits) if (h.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    if (k == null) return next();
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) hits.set(k, h = { count: 0, reset: now + windowMs });
    if (++h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return next(new HttpError(429, message, 'rate_limited'));
    }
    next();
  };
}

// Il percorso senza numeri e id lunghi, così il registro resta leggibile e non contiene dati (es. nomi di file).
const routeOf = req => req.originalUrl.split('?')[0].replace(/\/[^/]{40,}/g, '/…');

function createAudit(db) {
  function log(userId, action, { status = null, ip = null } = {}) {
    db.query('INSERT INTO audit_log (user_id, action, status, ip) VALUES ($1, $2, $3, $4)', [userId, action, status, ip])
      .catch(err => console.warn('[audit] scrittura non riuscita', err.message));
  }

  // Ogni modifica fatta dalle API finisce nel registro a risposta inviata, con l'esito.
  function middleware(req, res, next) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.on('finish', () => log(req.user?.id ?? null, `${req.method} ${routeOf(req)}`, { status: res.statusCode, ip: req.ip }));
    }
    next();
  }

  async function purge(days = 365) {
    await db.query(`DELETE FROM audit_log WHERE created_at < now() - make_interval(days => $1)`, [days]);
  }

  return { log, middleware, purge };
}

module.exports = { rateLimit, createAudit, routeOf };
