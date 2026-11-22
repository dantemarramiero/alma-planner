// Programmi triennali dei lavori pubblici (canvas v17 · Le fonti del Radar, via di Dante 22/11/2026).
//   GET  /api/crm/triennali/stato      ultimo caricamento
//   POST /api/crm/triennali/aggiorna   «Carica adesso» (solo direzione)
// Il caricamento si fa da solo ogni lunedì alle 05:15 e la prima volta dopo l'avvio se non c'è niente; subito dopo gli
// interventi nel perimetro delle BU diventano segnali «Programmata» nel Radar (Impostazioni → Prima del bando).
const { HttpError } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const P = require('../lib/crm-triennali');

function registerCrmTriennali(app, { db, triennaliFetch }) {
  const sync = async () => {
    const out = await P.syncTriennali(db, triennaliFetch ? { fetchImpl: triennaliFetch, pause: 0 } : {});
    try { await P.progSignals(db, { settings: await loadSettings(db), radar: app.locals.crmRadar, log: m => console.log(`[triennali] ${m}`) }); }
    catch (err) { console.error('[triennali] segnali:', err.message); }
    return out;
  };

  app.get('/api/crm/triennali/stato', async (req, res) => { res.json({ ...(await P.lastImport(db)), running: P.isRunning() }); });

  app.post('/api/crm/triennali/aggiorna', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    if (!P.isRunning()) sync().catch(err => console.error('[triennali]', err.message));
    res.json({ running: true });
  });

  if (!process.env.NODE_TEST_CONTEXT) {
    const first = setTimeout(async () => {
      try { const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM crm_prog_imports WHERE cardinality(regions) > 0'); if (!r.n) await sync(); } catch { /* riprova lunedì */ }
    }, 20 * 60000);
    first.unref?.();
    let lastDay = '';
    const tick = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
      const key = now.toISOString().slice(0, 10);
      if (now.getDay() === 1 && now.getHours() === 5 && now.getMinutes() >= 15 && lastDay !== key) { lastDay = key; sync().catch(() => {}); }
    }, 5 * 60000);
    tick.unref?.();
  }
  return { sync };
}

module.exports = { registerCrmTriennali };
