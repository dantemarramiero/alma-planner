// Riepilogo del mattino: preferenze di ognuno (acceso/spento, ora), anteprima e invio di prova a sé stessi.
const { HttpError, v } = require('../lib/http');
const { romeNow } = require('../lib/workdays');

function registerDigest(app, { db, digest }) {
  const prefs = async userId => (await db.query('SELECT digest_enabled AS enabled, digest_minute AS minute FROM users WHERE id = $1', [userId])).rows[0];

  app.get('/api/me/digest', async (req, res) => {
    const { day } = romeNow();
    const [p, last] = await Promise.all([
      prefs(req.user.id),
      db.query('SELECT day::text AS day, status, items, at FROM digest_log WHERE user_id = $1 ORDER BY day DESC LIMIT 5', [req.user.id]),
    ]);
    const preview = await digest.build(req.user.id, day);
    res.json({ ...p, last: last.rows, preview: { total: preview.total, counts: Object.fromEntries(Object.entries(preview.sections).map(([k, s]) => [k, s.length])) } });
  });

  app.patch('/api/me/digest', async (req, res) => {
    const b = req.body || {};
    const minute = v.int(b.minute, 'ora', { min: 360, max: 720 });
    if (minute !== undefined && minute % 15) throw new HttpError(400, 'L\'ora va scelta a quarti d\'ora');
    if (b.enabled !== undefined) await db.query('UPDATE users SET digest_enabled = $2 WHERE id = $1', [req.user.id, Boolean(b.enabled)]);
    if (minute !== undefined) await db.query('UPDATE users SET digest_minute = $2 WHERE id = $1', [req.user.id, minute]);
    res.json(await prefs(req.user.id));
  });

  // «Mandami una prova»: il riepilogo di oggi, subito, anche se vuoto; non conta come quello del giorno.
  app.post('/api/me/digest/test', async (req, res) => {
    const { day } = romeNow();
    const d = await digest.build(req.user.id, day, { since: new Date(Date.now() - 24 * 3600 * 1000) });
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.user.id]);
    await digest.send(rows[0], d);
    res.json({ sent: true, items: d.total });
  });

  // Anteprima HTML dell'email (per vederla prima di riceverla).
  app.get('/api/me/digest/preview', async (req, res) => {
    const { day } = romeNow();
    const d = await digest.build(req.user.id, day, { since: new Date(Date.now() - 24 * 3600 * 1000) });
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.user.id]);
    const { subject, html } = digest.render(rows[0], d);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${subject.replace(/</g, '&lt;')}</title><body style="margin:0;padding:20px;background:#f7f5f2">${html}</body>`);
  });
}

module.exports = { registerDigest };
