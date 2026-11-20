// «Cerca su internet» nell'anagrafica (canvas v9, Dante 19/11/2026):
// - POST /api/crm/subjects/:id/cerca-web { scelta? }: alternative se Alma è indecisa, altrimenti i dati trovati con la fonte;
// - POST /api/crm/subjects/:id/da-web { fields: { campo: valore }, sources: { campo: url } }: salva solo quelli spuntati,
//   segnati «da internet» finché qualcuno non li conferma;
// - POST /api/crm/subjects/:id/da-web/conferma { key }: il dato è confermato (via il bollino).
const { HttpError, v } = require('../lib/http');
const { searchCompany, WEB_FIELDS } = require('../lib/crm-web');
const { loadSettings } = require('../lib/crm-commerciale');
const { relationsFor, pathsOf } = require('../lib/crm-relazioni');

function registerCrmWeb(app, { db, subjectById, subjectFields, allAsa, radarFetch, seeSql }) {
  const apiKey = () => process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '');

  // quanto conosciamo le aziende che si vedono in una lista (pagina Lead): forza e chi ci porta, solo per le schede visibili
  app.post('/api/crm/rapporti', async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 300);
    if (!ids.length) return res.json({});
    const params = [ids];
    const { rows } = await db.query(`SELECT s.id FROM crm_subjects s WHERE s.id = ANY($1::int[]) AND ${seeSql(req, 's', params)}`, params);
    const settings = await loadSettings(db);
    const rel = await relationsFor(db, rows.map(r => r.id), settings.relazioni);
    const out = {};
    for (const r of rows) {
      const x = rel[r.id];
      if (!x || !x.level) continue;
      const p = pathsOf(x)[0];
      out[r.id] = { level: x.level, points: x.points, why: p ? `${p.us ? p.us.name.split(' ')[0] : ''}${p.us ? ' → ' : ''}${p.contact}` : (x.projects ? `${x.projects} ${x.projects === 1 ? 'progetto' : 'progetti'} insieme` : '') };
    }
    res.json(out);
  });

  app.post('/api/crm/subjects/:id/cerca-web', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id, { forWrite: true });
    if (!apiKey()) throw new HttpError(503, 'La ricerca su internet non è attiva: manca la chiave di OpenAI');
    const { rows: [dom] } = await db.query(
      `SELECT split_part(lower(c.email), '@', 2) AS d FROM crm_contacts c JOIN crm_contact_links l ON l.contact_id = c.id
        WHERE l.subject_id = $1 AND c.email LIKE '%@%' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [id]).catch(() => ({ rows: [] }));
    const generic = /^(gmail|libero|hotmail|outlook|yahoo|virgilio|alice|tiscali|live|icloud|pec|legalmail)\./;
    const b = req.body || {};
    const choice = b.scelta && typeof b.scelta === 'object' ? {
      name: String(b.scelta.name || '').slice(0, 200), city: String(b.scelta.city || '').slice(0, 100), vat: String(b.scelta.vat || '').slice(0, 20),
      website: String(b.scelta.website || '').slice(0, 200), note: String(b.scelta.note || '').slice(0, 300),
    } : null;
    if (choice && !choice.name && !choice.note) throw new HttpError(400, 'Dimmi di quale azienda si tratta');
    let out;
    try {
      out = await searchCompany({ apiKey: apiKey(), fetchImpl: radarFetch || fetch, choice,
        subject: { name: s.name, city: s.city, province: s.province, vat: s.vat, website: s.website, email: s.email, domain: dom?.d && !generic.test(dom.d) ? dom.d : '' } });
    } catch (err) {
      throw new HttpError(502, `La ricerca su internet non ha risposto: ${String(err.message || err).slice(0, 160)}`);
    }
    // per ogni dato trovato: cosa c'è già nella scheda (si spunta da solo solo se il campo è vuoto)
    const fields = out.fields.map(f => ({ ...f, current: s[f.key] || '', same: String(s[f.key] || '').toLowerCase() === f.value.toLowerCase() }))
      .filter(f => !f.same);
    res.json({ ambiguous: out.ambiguous, candidates: out.candidates, company: out.company, fields, cost_eur: out.costEur });
  });

  app.post('/api/crm/subjects/:id/da-web', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    const raw = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    const sources = req.body?.sources && typeof req.body.sources === 'object' ? req.body.sources : {};
    const keys = Object.keys(raw).filter(k => WEB_FIELDS[k]);
    if (!keys.length) throw new HttpError(400, 'Spunta almeno un dato');
    // ogni dato passa dagli stessi controlli della scheda; quelli non validi (es. una provincia scritta male) si saltano
    const asaKeys = (await allAsa()).map(a => a.key);
    const f = {};
    const skipped = [];
    for (const k of keys) {
      try { Object.assign(f, subjectFields({ [k]: raw[k] }, { partial: true, asaKeys })); } catch { skipped.push(WEB_FIELDS[k]); }
    }
    if (!Object.keys(f).length) throw new HttpError(400, `Dati non validi: ${skipped.join(', ')}`);
    const wf = { ...(cur.web_fields || {}) };
    const at = new Date().toISOString();
    for (const k of Object.keys(f)) wf[k] = { source: /^https?:\/\//i.test(String(sources[k] || '')) ? String(sources[k]).slice(0, 500) : '', at, by: req.user.id };
    const cols = Object.keys(f);
    try {
      const { rows: [s] } = await db.query(
        `UPDATE crm_subjects SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, web_fields = $${cols.length + 2}, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, ...cols.map(c => f[c]), JSON.stringify(wf)]);
      res.json({ saved: cols, skipped, subject: s });
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'C\'è già un\'anagrafica con questa P.IVA o questo codice fiscale');
      throw err;
    }
  });

  app.post('/api/crm/subjects/:id/da-web/conferma', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    const wf = { ...(cur.web_fields || {}) };
    const keys = req.body?.key === '*' ? Object.keys(wf) : [String(req.body?.key || '')];
    keys.forEach(k => delete wf[k]);
    await db.query('UPDATE crm_subjects SET web_fields = $2 WHERE id = $1', [id, JSON.stringify(wf)]);
    res.json({ web_fields: wf });
  });
}

module.exports = { registerCrmWeb };
