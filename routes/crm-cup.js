// Opere finanziate da OpenCUP (ALM2-49, canvas CRM v14 · V14-OpenCUP, via di Dante 22/11/2026).
//   GET  /api/crm/business/:id/mercato/opere?vista=senza|con|tutte&dal=2023&province=PE&limit=  sezione del Mercato
//   POST /api/crm/cup/:cup/segnale { signal_id }   ricorda il segnale del radar creato con «Segnala al radar»
//   GET  /api/crm/cup/tipi                         tabella categorie SOA → tipi di lavoro CUP (Impostazioni)
//   GET  /api/crm/cup/stato · POST /api/crm/cup/aggiorna (solo direzione)
// Il caricamento si fa da solo il 3 di ogni mese alle 03:30 e la prima volta dopo l'avvio se non c'è niente.
const { HttpError } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { normCat } = require('../lib/crm-anac');
const { scopeOf } = require('../lib/crm-business-mercato');
const C = require('../lib/crm-cup');

function registerCrmCup(app, { db, cupFetch }) {
  const sync = () => C.syncCup(db, cupFetch ? { fetchImpl: cupFetch } : {});

  app.get('/api/crm/business/:id/mercato/opere', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Iniziativa non valida');
    const { rows: [i] } = await db.query('SELECT id, profile FROM crm_initiatives WHERE id = $1', [id]);
    if (!i) throw new HttpError(404, 'Iniziativa non trovata');
    const settings = await loadSettings(db);
    const cats = req.query.cats ? String(req.query.cats).split(',').map(normCat).filter(Boolean) : null;
    const scope = scopeOf(settings, i, { months: 12, cats });
    const types = C.typesFor(scope.cats, settings);
    const year = new Date().getFullYear();
    const since = Number(req.query.dal) >= year - C.YEARS && Number(req.query.dal) <= year ? Number(req.query.dal) : year - 3;
    const out = await C.works(db, { types, regions: scope.regions, view: ['senza', 'con', 'tutte'].includes(req.query.vista) ? req.query.vista : 'senza', since,
      province: String(req.query.province || '').replace(/[^A-Za-z]/g, '').slice(0, 4), limit: Number(req.query.limit) || 10 });
    const missing = scope.cats.filter(c => !C.typesFor([c], settings).length);
    res.json({ ...out, since, years: Array.from({ length: C.YEARS + 1 }, (_, k) => year - C.YEARS + k), categories: scope.cats, regions: scope.regions, missing,
      type_labels: types.map(t => C.labelOf(t)).filter(Boolean), source: { ...(await C.lastImport(db)), running: C.isRunning() }, admin: req.crm.admin });
  });

  app.post('/api/crm/cup/:cup/segnale', async (req, res) => {
    const cup = String(req.params.cup || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const sid = Number(req.body?.signal_id);
    if (!Number.isInteger(sid) || sid < 1) throw new HttpError(400, 'Segnale non valido');
    const { rows: [s] } = await db.query('SELECT id FROM crm_signals WHERE id = $1', [sid]);
    if (!s) throw new HttpError(404, 'Segnale non trovato');
    const r = await db.query('UPDATE crm_cup_works SET signal_id = $2 WHERE cup = $1', [cup, sid]);
    if (!r.rowCount) throw new HttpError(404, 'Opera non trovata');
    res.json({ ok: true });
  });

  app.get('/api/crm/cup/tipi', async (req, res) => {
    const settings = await loadSettings(db);
    const map = C.typesMap(settings);
    const labels = Object.fromEntries([...new Set(Object.values(map).flat())].map(t => [t, C.labelOf(t)]));
    res.json({ map, base: C.TYPES, extra: settings.concorrenza?.cup_types || {}, labels });
  });

  app.get('/api/crm/cup/stato', async (req, res) => { res.json({ ...(await C.lastImport(db)), running: C.isRunning() }); });

  app.post('/api/crm/cup/aggiorna', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    if (!C.isRunning()) sync().catch(() => {});
    res.json({ running: true });
  });

  if (!process.env.NODE_TEST_CONTEXT) {
    const first = setTimeout(async () => {
      try { const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM crm_cup_imports WHERE error = \'\''); if (!r.n) await sync(); } catch { /* riprova il mese prossimo */ }
    }, 15 * 60000);
    first.unref?.();
    let lastMonth = '';
    const tick = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
      const key = now.toISOString().slice(0, 7);
      if (now.getDate() === 3 && now.getHours() === 3 && now.getMinutes() >= 30 && lastMonth !== key) { lastMonth = key; sync().catch(() => {}); }
    }, 5 * 60000);
    tick.unref?.();
  }
}

module.exports = { registerCrmCup };
