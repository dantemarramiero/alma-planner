// «Da dove vengono i dati» (ALM2-49, canvas v13 · V13-Fonti): GET /api/crm/fonti
// Perimetro delle gare, a scelta:
//   ?iniziativa=ID[&months=12|24][&province=…][&cats=OG10,OS30]  → come la tab Mercato di Nuovi business
//   ?cats=OG10,OS30[&regions=Abruzzo,Marche][&months=…]           → come Concorrenza e gare
//   &cf=…                                                          → solo le gare vinte da quell'impresa (scheda impresa)
// Senza perimetro: tutte le gare caricate nel periodo.
const { HttpError } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { normCat } = require('../lib/crm-anac');
const { scopeOf } = require('../lib/crm-business-mercato');
const F = require('../lib/crm-fonti');
const T = require('../lib/crm-ted');

const list = x => String(x || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 60);

function registerCrmFonti(app, { db }) {
  app.get('/api/crm/fonti', async (req, res) => {
    const settings = await loadSettings(db);
    const months = [12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : Number(settings.concorrenza?.months) || 12;
    let scope;
    if (req.query.iniziativa) {
      const id = Number(req.query.iniziativa);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Iniziativa non valida');
      const { rows: [i] } = await db.query('SELECT id, profile FROM crm_initiatives WHERE id = $1', [id]);
      if (!i) throw new HttpError(404, 'Iniziativa non trovata');
      const cats = req.query.cats ? list(req.query.cats).map(normCat) : null;
      scope = scopeOf(settings, i, { months, cats, province: String(req.query.province || '').slice(0, 60) });
    } else {
      scope = scopeOf(settings, { profile: { soa: list(req.query.cats).map(normCat), regions: list(req.query.regions) } }, { months });
      if (!scope.cats.length) { // senza categorie: tutte le gare del periodo
        const min = Number(settings.concorrenza?.min_amount) || 0;
        scope = { sql: `a.awarded_on >= CURRENT_DATE - ($1 || ' months')::interval${min ? ' AND COALESCE(a.amount, a.base_amount) >= $2' : ''}`, params: min ? [String(months), min] : [String(months)], cats: [], regions: [] };
      }
    }
    const cf = String(req.query.cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    let { sql, params } = scope;
    if (cf) { params = [...params, cf]; sql += ` AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.winners) w WHERE upper(w->>'cf') = $${params.length})`; }
    const [sources, quality, ted] = await Promise.all([F.sources(db), F.quality(db, sql, params),
      scope.cats.length && !cf ? T.quality(db, T.codesFor(scope.cats, settings)).catch(() => null) : null]);
    res.json({ scope: { categories: scope.cats, regions: scope.regions, months, cf: cf || null }, sources, quality, ted_quality: ted && ted.n ? ted : null, limits: F.limits(settings), next_update: '05:00' });
  });
}

module.exports = { registerCrmFonti };
