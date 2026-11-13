// CRM: primo caricamento delle aziende da Zoho (decisione D6: dopo il caricamento Zoho si spegne).
// Accetta l'export «Aziende» di Zoho così com'è (le classifica lib/crm-zoho.js) oppure l'Excel di controllo
// «aziende-classificate.xlsx» corretto a mano (foglio Aziende: Ruolo proposto, ASA proposte, Da caricare…).
// Solo la direzione. Prima l'anteprima, poi il caricamento; le aziende già presenti (stesso codice Zoho o stesso
// nome) non si toccano. Owner = collega con lo stesso nome dell'owner di Zoho; se non ha ancora fatto accesso ma è
// nell'organigramma Microsoft lo si aggiunge ai colleghi (come «aggiungi dalla rubrica»); sennò chi carica.
// Funzione = il suo reparto nell'organigramma.
const express = require('express');
const { HttpError } = require('../lib/http');
const { readXlsx } = require('../lib/xlsx');
const { classify, norm } = require('../lib/crm-zoho');

const ROLE_OF = { lead: 'lead', cliente: 'cliente', fornitore: 'fornitore', partner: 'partner', concorrente: 'concorrente' };
const KIND_OF = { impresa: 'impresa', 'ente pubblico': 'ente_pubblico', 'societa partecipata': 'partecipata', professionista: 'professionista', condominio: 'condominio', altro: 'altro' };
const CATEGORIES = ['materiali', 'subappalti', 'noli', 'servizi_cantiere', 'professionisti', 'mezzi', 'servizi_generali'];

// righe dell'Excel → aziende da caricare
function readCompanies(buf) {
  let sheets;
  try { sheets = readXlsx(buf); } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
  const rows = sheets.Aziende || Object.values(sheets)[0];
  if (!rows?.length) throw new HttpError(400, 'Il file è vuoto');
  const head = rows[0].map(h => norm(h));
  const col = (...names) => head.findIndex(h => names.map(norm).includes(h));
  const reviewed = col('Ruolo proposto') >= 0;
  const I = {
    id: col('ID Zoho', 'ID record'), name: col('Nome', 'Nome Azienda'), web: col('Sito', 'Sito Web'), owner: col('Owner in Zoho', 'Owner Azienda'),
    tip: col('Tipologia in Zoho', 'Tipologia'), kind: col('Tipo di soggetto'), roles: col('Ruolo proposto'), asa: col('ASA proposte'), cat: col('Categoria fornitore'), load: col('Da caricare'),
  };
  if (I.name < 0) throw new HttpError(400, 'Nel file manca la colonna «Nome Azienda»');
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const out = [];
  for (const r of rows.slice(1)) {
    const name = cell(r, I.name);
    const base = { zoho_id: cell(r, I.id), name, website: cell(r, I.web), owner_name: cell(r, I.owner) };
    if (reviewed) {
      if (!name || /^no\b/i.test(cell(r, I.load))) { out.push({ ...base, skip: cell(r, I.load) || 'senza nome' }); continue; }
      const roles = cell(r, I.roles).split(/[,;]/).map(x => ROLE_OF[norm(x)]).filter(Boolean);
      out.push({ ...base, kind: KIND_OF[norm(cell(r, I.kind))] || 'impresa', roles: roles.length ? roles : ['lead'],
        asa: cell(r, I.asa).split(/[,;]/).map(x => x.trim()).filter(Boolean), categories: cell(r, I.cat).split(/[,;]/).map(x => x.trim()).filter(x => CATEGORIES.includes(x)) });
    } else {
      const c = classify({ name, owner: base.owner_name, tipologia: cell(r, I.tip) });
      if (c.skip) { out.push({ ...base, skip: c.skip }); continue; }
      out.push({ ...base, kind: c.kind, roles: c.roles, asa: c.asa, categories: c.categories || [], why: c.why.join('; '), conf: c.conf });
    }
  }
  return out;
}

function registerCrmImport(app, { db }) {
  const raw = express.raw({ type: () => true, limit: '20mb' });
  const adminOnly = req => { if (!req.crm?.admin) throw new HttpError(403, 'Il caricamento lo fa la direzione'); };

  async function plan(req) {
    adminOnly(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Carica il file Excel');
    const items = readCompanies(req.body);
    const [{ rows: users }, { rows: existing }, { rows: asa }, { rows: org }] = await Promise.all([
      db.query(`SELECT u.id, u.name, lower(u.email) AS email, (SELECT o.department FROM org_people o WHERE lower(o.email) = lower(u.email) LIMIT 1) AS department FROM users u`),
      db.query('SELECT id, name, zoho_id FROM crm_subjects WHERE merged_into IS NULL'),
      db.query('SELECT key FROM crm_asa'),
      db.query("SELECT oid, name, lower(email) AS email, job_title, department FROM org_people WHERE email IS NOT NULL AND email <> ''"),
    ]);
    const byOrg = new Map(org.map(p => [norm(p.name), p]));
    const byEmail = new Map(users.map(u => [u.email, u]));
    const asaKeys = new Set(asa.map(a => a.key));
    const byName = new Map(users.map(u => [norm(u.name), u]));
    const me = users.find(u => u.id === req.user.id);
    const exZoho = new Set(existing.map(e => e.zoho_id).filter(Boolean));
    const exName = new Set(existing.map(e => norm(e.name)));
    const seen = new Set();
    const stats = { total: items.length, toLoad: 0, skipped: 0, existing: 0, duplicates: 0, roles: {}, owners: {}, ownersMissing: {}, ownersFromOrg: {} };
    const newUsers = new Map(); // email → persona dell'organigramma da aggiungere ai colleghi
    const load = [];
    for (const it of items) {
      if (it.skip) { stats.skipped++; continue; }
      const key = norm(it.name);
      if ((it.zoho_id && exZoho.has(it.zoho_id)) || exName.has(key)) { stats.existing++; continue; }
      if (seen.has(key)) { stats.duplicates++; continue; }
      seen.add(key);
      let roles = [...new Set(it.roles)];
      if (roles.includes('cliente')) roles = roles.filter(r => r !== 'lead');
      let owner = byName.get(norm(it.owner_name));
      if (!owner && it.owner_name) {
        const p = byOrg.get(norm(it.owner_name));
        if (p) {
          owner = byEmail.get(p.email) || { id: null, name: p.name, email: p.email, department: p.department };
          if (!owner.id) newUsers.set(p.email, p);
          stats.ownersFromOrg[p.name] = (stats.ownersFromOrg[p.name] || 0) + 1;
        } else stats.ownersMissing[it.owner_name] = (stats.ownersMissing[it.owner_name] || 0) + 1;
      }
      const o = owner || me;
      stats.owners[o.name] = (stats.owners[o.name] || 0) + 1;
      for (const r of roles) stats.roles[r] = (stats.roles[r] || 0) + 1;
      const asaList = it.asa.filter(a => asaKeys.has(a));
      load.push({ ...it, roles, asa: asaList.length ? asaList : ['altri_servizi'], owner_id: o.id, owner_email: o.email, function_name: o.department || '', owner_label: o.name });
      stats.toLoad++;
    }
    return { stats, load, newUsers: [...newUsers.values()] };
  }

  app.post('/api/crm/import/anteprima', raw, async (req, res) => {
    const { stats, load } = await plan(req);
    res.json({ stats, sample: load.slice(0, 30).map(x => ({ name: x.name, kind: x.kind, roles: x.roles, asa: x.asa, owner: x.owner_label, function_name: x.function_name, why: x.why || '' })) });
  });

  app.post('/api/crm/import', raw, async (req, res) => {
    const { stats, load, newUsers } = await plan(req);
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;
    await db.tx(async q => {
      // colleghi dell'organigramma che non hanno ancora fatto accesso: entrano come «aggiunti dalla rubrica»
      const ids = new Map();
      for (const p of newUsers) {
        const { rows: [u] } = await q.query(`INSERT INTO users (oid, email, name, job_title) VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO UPDATE SET oid = COALESCE(users.oid, EXCLUDED.oid) RETURNING id`, [p.oid, p.email, p.name, p.job_title || null]);
        ids.set(p.email, u.id);
      }
      for (const x of load) {
        if (!x.owner_id) x.owner_id = ids.get(x.owner_email) || req.user.id;
        const { rows: [s] } = await q.query(
          `INSERT INTO crm_subjects (name, kind, roles, asa, supplier_categories, website, zoho_id, owner_id, function_name, notes, created_by, client_since)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, lead_stage, roles`,
          [x.name.slice(0, 200), x.kind, x.roles, x.asa, x.categories, x.website.slice(0, 200), x.zoho_id.slice(0, 40), x.owner_id, x.function_name,
            `Caricata da Zoho il ${today}${x.why ? ` (${x.why})` : ''}`, req.user.id, x.roles.includes('cliente') ? today : null]);
        if (s.roles.includes('lead')) await q.query("INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, 'da Zoho', $3)", [s.id, s.lead_stage, req.user.id]);
        created++;
      }
    });
    res.status(201).json({ created, stats });
  });
}

module.exports = { registerCrmImport, readCompanies };
