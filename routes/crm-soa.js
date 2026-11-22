// Attestazioni SOA (ALM2-49, canvas CRM v13 · V13-SOA, via di Dante 21/11/2026).
//   GET  /api/crm/business/:id/mercato/qualificate  «Chi è qualificato in zona» per un'iniziativa di Nuovi business
//   GET  /api/crm/soa/impresa?cf=…&cats=…          il riquadro «Attestazione SOA» nella scheda impresa
//   GET  /api/crm/soa/stato                          ultimo caricamento
//   POST /api/crm/soa/aggiorna                       «Carica adesso» (solo direzione)
// Il caricamento si fa da solo il lunedì alle 04:30 e la prima volta dopo l'avvio se non c'è niente.
const { HttpError } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { normCat } = require('../lib/crm-anac');
const { scopeOf } = require('../lib/crm-business-mercato');
const S = require('../lib/crm-soa');

const FILTERS = ['tutte', 'mai', 'classe', 'crm'];

function registerCrmSoa(app, { db, anacFetch }) {
  const sync = () => S.syncSoa(db, anacFetch ? { fetchImpl: anacFetch } : {});

  app.get('/api/crm/business/:id/mercato/qualificate', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Iniziativa non valida');
    const { rows: [i] } = await db.query('SELECT id, profile FROM crm_initiatives WHERE id = $1', [id]);
    if (!i) throw new HttpError(404, 'Iniziativa non trovata');
    const settings = await loadSettings(db);
    const months = [12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
    const cats = req.query.cats ? String(req.query.cats).split(',').map(normCat).filter(Boolean) : null;
    const scope = scopeOf(settings, i, { months, cats });
    const out = await S.qualified(db, scope, {
      filter: FILTERS.includes(req.query.filter) ? req.query.filter : 'tutte',
      classMin: S.normClass(req.query.classe), province: String(req.query.province || '').slice(0, 60), limit: Number(req.query.limit) || 8,
    });
    res.json({ ...out, source: { ...(await S.lastImport(db)), running: S.isRunning() }, admin: req.crm.admin });
  });

  app.get('/api/crm/soa/impresa', async (req, res) => {
    const cf = String(req.query.cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    if (!cf) throw new HttpError(400, 'Manca il codice fiscale');
    const cats = String(req.query.cats || '').split(',').map(normCat).filter(Boolean);
    res.json({ soa: await S.company(db, cf, cats), source: await S.lastImport(db) });
  });

  app.get('/api/crm/soa/stato', async (req, res) => {
    res.json({ ...(await S.lastImport(db)), running: S.isRunning() });
  });

  app.post('/api/crm/soa/aggiorna', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione');
    if (!S.isRunning()) sync().catch(() => {});
    res.json({ running: true });
  });

  // ogni lunedì alle 04:30 (ora di Roma); la prima volta pochi minuti dopo l'avvio se la tabella è vuota
  if (!process.env.NODE_TEST_CONTEXT) {
    const first = setTimeout(async () => {
      try { const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM crm_soa'); if (!r.n) await sync(); } catch { /* riprova lunedì */ }
    }, 10 * 60000);
    first.unref?.();
    let lastDay = '';
    const tick = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
      const key = now.toISOString().slice(0, 10);
      if (now.getDay() === 1 && now.getHours() === 4 && now.getMinutes() >= 30 && lastDay !== key) { lastDay = key; sync().catch(() => {}); }
    }, 5 * 60000);
    tick.unref?.();
  }
}

module.exports = { registerCrmSoa };
