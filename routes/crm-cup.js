// Opere finanziate da OpenCUP (ALM2-49, canvas CRM v14 · V14-OpenCUP, via di Dante 22/11/2026).
//   GET  /api/crm/business/:id/mercato/opere?vista=senza|con|tutte&dal=2023&province=PE&limit=  sezione del Mercato
//   POST /api/crm/cup/:cup/segnale { signal_id }   ricorda il segnale del radar creato con «Segnala al radar»
//   GET  /api/crm/cup/tipi                         tabella categorie SOA → tipi di lavoro CUP (Impostazioni)
//   GET  /api/crm/cup/stato · POST /api/crm/cup/aggiorna (solo direzione)
//   GET  /api/crm/concorrenza/opere?bu=&vista=&tutta=1&dal=&province=&limit=   Concorrenza e gare → Opere finanziate (v16)
//   GET  /api/crm/concorrenza/opere/bu?dal=                                     una scheda per BU (v16)
// Il caricamento si fa da solo il 3 di ogni mese alle 03:30 e la prima volta dopo l'avvio se non c'è niente; subito dopo
// le opere nuove diventano segnali «Finanziata» nel radar di ogni BU (v16, Impostazioni → Prima del bando).
const { HttpError } = require('../lib/http');
const { loadSettings, managerOf } = require('../lib/crm-commerciale');
const { normCat } = require('../lib/crm-anac');
const { scopeOf } = require('../lib/crm-business-mercato');
const C = require('../lib/crm-cup');

function registerCrmCup(app, { db, cupFetch }) {
  const sync = async () => {
    const out = await C.syncCup(db, cupFetch ? { fetchImpl: cupFetch } : {});
    try { await C.cupSignals(db, { settings: await loadSettings(db), radar: app.locals.crmRadar, log: m => console.log(`[opencup] ${m}`) }); }
    catch (err) { console.error('[opencup] segnali:', err.message); }
    return out;
  };

  // BU che si vedono: la direzione tutte; un responsabile le sue (se non ne ha, tutte)
  async function busFor(req, settings) {
    const all = Object.keys(settings.profiles || {}).filter(k => C.buScope(settings, k).types.length);
    if (req.crm.admin) return all;
    const { rows: users } = await db.query('SELECT id, name, email FROM users');
    const mine = all.filter(k => managerOf(settings.profiles[k], users)?.id === req.user.id);
    return mine.length ? mine : all;
  }
  const yearsBack = () => { const y = new Date().getFullYear(); return Array.from({ length: C.YEARS + 1 }, (_, k) => y - C.YEARS + k); };
  const sinceOf = q => { const y = new Date().getFullYear(); const n = Number(q); return n >= y - C.YEARS && n <= y ? n : y - 2; };

  app.get('/api/crm/concorrenza/opere/bu', async (req, res) => {
    const settings = await loadSettings(db);
    const bus = await busFor(req, settings);
    res.json({ cards: await C.buCards(db, settings, bus, { since: sinceOf(req.query.dal) }), source: { ...(await C.lastImport(db)), running: C.isRunning() } });
  });

  app.get('/api/crm/concorrenza/opere', async (req, res) => {
    const settings = await loadSettings(db);
    const bus = await busFor(req, settings);
    const bu = req.query.bu && bus.includes(String(req.query.bu)) ? String(req.query.bu) : bus[0] || '';
    if (req.query.bu && !bus.includes(String(req.query.bu))) throw new HttpError(Object.keys(settings.profiles || {}).includes(String(req.query.bu)) ? 403 : 404, 'BU non disponibile');
    const s = C.buScope(settings, bu, { allItaly: req.query.tutta === '1' });
    const since = sinceOf(req.query.dal);
    const out = bu ? await C.works(db, { types: s.types, regions: s.regions, amountMin: s.amountMin, amountMax: s.amountMax, since,
      view: ['senza', 'con', 'tutte'].includes(req.query.vista) ? req.query.vista : 'senza', province: String(req.query.province || '').replace(/[^A-Za-z]/g, '').slice(0, 4),
      limit: Number(req.query.limit) || 25 }) : { types: [], kpi: { without: 0, with: 0, cost: 0, owners_in_crm: 0 }, rows: [], shown: 0, provinces: [] };
    res.json({ ...out, bu, bus, since, years: yearsBack(), scope: { categories: s.cats, regions: s.regions, profile_regions: settings.profiles?.[bu]?.regions || [], all_italy: req.query.tutta === '1', amount_min: s.amountMin, amount_max: s.amountMax },
      type_labels: s.types.map(t => C.labelOf(t)).filter(Boolean), source: { ...(await C.lastImport(db)), running: C.isRunning() }, admin: req.crm.admin });
  });

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
      try {
        const { rows: [r] } = await db.query(`SELECT count(*) FILTER (WHERE error = '')::int AS n,
            (SELECT signals IS NULL FROM crm_cup_imports WHERE error = '' OR cardinality(areas) > 0 ORDER BY id DESC LIMIT 1) AS no_signals FROM crm_cup_imports`);
        if (!r.n) await sync();
        // opere caricate prima che esistessero i segnali «Finanziata» (o giro dei segnali saltato): li crea senza riscaricare
        else if (r.no_signals) await C.cupSignals(db, { settings: await loadSettings(db), radar: app.locals.crmRadar, log: m => console.log(`[opencup] ${m}`) });
      } catch (err) { console.error('[opencup] avvio:', err.message); }
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
