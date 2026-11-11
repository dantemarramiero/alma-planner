// Profilo → Notifiche: per ognuno dei tre avvisi, campanella / telefono / email; e i telefoni (o computer) iscritti
// alle notifiche push dell'app.
const { HttpError, v } = require('../lib/http');
const { KINDS, DEFAULTS, LABELS, prefsFor } = require('../lib/alerts');

function registerAlerts(app, { db, push }) {
  app.get('/api/notifiche/preferenze', async (req, res) => {
    const prefs = new Map();
    for (const kind of KINDS) prefs.set(kind, (await prefsFor(db, [req.user.id], kind))[0]);
    res.json({
      kinds: KINDS.map(kind => ({ kind, label: LABELS[kind][0], hint: LABELS[kind][1], ...pick(prefs.get(kind)), defaults: DEFAULTS[kind] })),
      devices: await push.devices(req.user.id),
    });
  });

  app.put('/api/notifiche/preferenze', async (req, res) => {
    const list = Array.isArray(req.body?.kinds) ? req.body.kinds : null;
    if (!list) throw new HttpError(400, 'Preferenze mancanti');
    await db.tx(async q => {
      for (const p of list) {
        const kind = v.oneOf(p.kind, 'avviso', KINDS);
        await q.query(
          `INSERT INTO notification_prefs (user_id, kind, bell, push, email) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, kind) DO UPDATE SET bell = EXCLUDED.bell, push = EXCLUDED.push, email = EXCLUDED.email`,
          [req.user.id, kind, Boolean(p.bell), Boolean(p.push), Boolean(p.email)]);
      }
    });
    res.json({ ok: true });
  });

  // chiave pubblica per iscrivere il dispositivo alle notifiche push
  app.get('/api/push/key', async (_req, res) => {
    res.json({ key: await push.publicKey() });
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      await push.subscribe(req.user.id, req.body?.subscription, req.body?.device || req.get('user-agent') || '');
    } catch (err) {
      throw new HttpError(400, 'Questo dispositivo non può ricevere notifiche');
    }
    res.status(201).json({ ok: true });
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    const endpoint = v.text(req.body?.endpoint, 'dispositivo', { max: 1000 });
    if (endpoint) await push.unsubscribe(req.user.id, endpoint);
    res.json({ ok: true });
  });

  app.post('/api/push/test', async (req, res) => {
    const sent = await push.send([req.user.id], { title: 'Alma Planet', body: 'Le notifiche sul telefono funzionano.', url: '/app#/notifiche/impostazioni', tag: 'prova' });
    if (!sent) throw new HttpError(400, 'Nessun dispositivo ha ricevuto la prova: attiva prima le notifiche su questo dispositivo');
    res.json({ sent });
  });
}

const pick = p => ({ bell: Boolean(p.bell), push: Boolean(p.push), email: Boolean(p.email) });

module.exports = { registerAlerts };
