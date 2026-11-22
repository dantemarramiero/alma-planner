// Gare europee da TED (ALM2-49, canvas CRM v14 · V14-TED, via di Dante 22/11/2026).
//   GET  /api/crm/business/:id/mercato/ted?vista=bandi|esiti&zona=1|0&limit=  sezione «Gare europee» del Mercato
//   POST /api/crm/ted/:pub/segnale { signal_id }   ricorda il segnale creato con «Porta avanti» da un bando
//   GET  /api/crm/ted/cpv                          tabella categorie SOA → codici CPV (Impostazioni)
//   GET  /api/crm/ted/stato · POST /api/crm/ted/aggiorna (solo direzione)
// Il caricamento si fa da solo ogni notte alle 05:40 e la prima volta pochi minuti dopo l'avvio se non c'è niente.
const { HttpError } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { normCat } = require('../lib/crm-anac');
const { scopeOf } = require('../lib/crm-business-mercato');
const T = require('../lib/crm-ted');

function registerCrmTed(app, { db, tedFetch }) {
  // dopo ogni caricamento: gli avvisi di preinformazione diventano segnali «Gara in arrivo» nel Radar (v17)
  const sync = async () => {
    const out = await T.syncTed(db, tedFetch ? { fetchImpl: tedFetch } : {});
    try { await T.tedSignals(db, { settings: await loadSettings(db), radar: app.locals.crmRadar, log: m => console.log(`[ted] ${m}`) }); }
    catch (err) { console.error('[ted] segnali:', err.message); }
    return out;
  };

  app.get('/api/crm/business/:id/mercato/ted', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Iniziativa non valida');
    const { rows: [i] } = await db.query('SELECT id, profile FROM crm_initiatives WHERE id = $1', [id]);
    if (!i) throw new HttpError(404, 'Iniziativa non trovata');
    const settings = await loadSettings(db);
    const cats = req.query.cats ? String(req.query.cats).split(',').map(normCat).filter(Boolean) : null;
    const scope = scopeOf(settings, i, { months: 12, cats });
    const codes = T.codesFor(scope.cats, settings);
    const zona = req.query.zona === '1' ? true : req.query.zona === '0' ? false : null;
    const out = await T.notices(db, { codes, regions: scope.regions, view: req.query.vista === 'esiti' ? 'esiti' : 'bandi', zone: zona, limit: Number(req.query.limit) || 10 });
    const missing = scope.cats.filter(c => !T.codesFor([c], settings).length);
    res.json({ ...out, categories: scope.cats, regions: scope.regions, missing, source: { ...(await T.lastImport(db)), running: T.isRunning() }, admin: req.crm.admin });
  });

  app.post('/api/crm/ted/:pub/segnale', async (req, res) => {
    const pub = String(req.params.pub || '').slice(0, 30);
    const sid = Number(req.body?.signal_id);
    if (!Number.isInteger(sid) || sid < 1) throw new HttpError(400, 'Segnale non valido');
    const { rows: [s] } = await db.query('SELECT id FROM crm_signals WHERE id = $1', [sid]);
    if (!s) throw new HttpError(404, 'Segnale non trovato');
    const r = await db.query('UPDATE crm_ted_notices SET signal_id = $2 WHERE pub = $1', [pub, sid]);
    if (!r.rowCount) throw new HttpError(404, 'Bando non trovato');
    res.json({ ok: true });
  });

  app.get('/api/crm/ted/cpv', async (req, res) => {
    const settings = await loadSettings(db);
    res.json({ map: T.cpvMap(settings), base: T.CPV, extra: settings.concorrenza?.ted_cpv || {}, labels: T.CPV_LABEL });
  });

  app.get('/api/crm/ted/stato', async (req, res) => { res.json({ ...(await T.lastImport(db)), running: T.isRunning() }); });

  app.post('/api/crm/ted/aggiorna', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    if (!T.isRunning()) sync().catch(() => {});
    res.json({ running: true });
  });

  if (!process.env.NODE_TEST_CONTEXT) {
    const first = setTimeout(async () => {
      try { const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM crm_ted_imports WHERE error = \'\''); if (!r.n) await sync(); } catch { /* riprova stanotte */ }
    }, 12 * 60000);
    first.unref?.();
    let lastDay = '';
    const tick = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
      const key = now.toISOString().slice(0, 10);
      if (now.getHours() === 5 && now.getMinutes() >= 40 && lastDay !== key) { lastDay = key; sync().catch(() => {}); }
    }, 5 * 60000);
    tick.unref?.();
  }
}

module.exports = { registerCrmTed };
