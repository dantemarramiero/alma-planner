// Manuali d'uso (ALM2-72): Impostazioni › Manuali d'uso e «Come si usa» sulle pagine del CRM. Li leggono tutti quelli
// che sono entrati in Alma Space; i testi stanno in lib/manuali-crm.js (gli stessi che legge Alma).
const manuali = require('../lib/manuali-crm');

function registerManuali(app) {
  app.get('/api/manuali', (req, res) => {
    res.set('Cache-Control', 'private, max-age=300');
    res.json(manuali.catalog());
  });
  app.get('/api/manuali/cerca', (req, res) => {
    const q = String(req.query.q || '').slice(0, 200);
    res.json({ q, results: manuali.search(q, { limit: 20 }).map(({ text, ...r }) => ({ ...r, text: text.slice(0, 400) })) });
  });
}

module.exports = { registerManuali };
