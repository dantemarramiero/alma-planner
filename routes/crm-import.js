// CRM: primo caricamento delle aziende da Zoho (decisione D6: dopo il caricamento Zoho si spegne).
// Accetta l'export «Aziende» di Zoho così com'è (le classifica lib/crm-zoho.js) oppure l'Excel di controllo
// «aziende-classificate.xlsx» corretto a mano (foglio Aziende: Ruolo proposto, ASA proposte, Da caricare…).
// Solo la direzione. Prima l'anteprima, poi il caricamento; le aziende già presenti (stesso codice Zoho o stesso
// nome) non si toccano. Owner = collega con lo stesso nome dell'owner di Zoho; se non ha ancora fatto accesso ma è
// nell'organigramma Microsoft lo si aggiunge ai colleghi (come «aggiungi dalla rubrica»); sennò chi carica.
// Funzione = il suo reparto nell'organigramma.
// Anche i contatti (export «Contatti» di Zoho): ognuno si collega alla sua azienda con il codice Zoho dell'azienda
// («Azienda.id», lo stesso salvato su ogni scheda) o, se quella era un doppione unito, con il nome. I colleghi
// Almacis (email @almacis.it o azienda del gruppo) non diventano contatti: stanno in Persone.
const express = require('express');
const { HttpError } = require('../lib/http');
const { readXlsx } = require('../lib/xlsx');
const { classify, norm } = require('../lib/crm-zoho');
const { vatOk, taxCodeOk } = require('../lib/crm');

// nome di una persona senza badare all'ordine: Microsoft scrive «Marramiero Dante», Zoho «Dante Marramiero»
const personKey = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
const ROLE_OF = { lead: 'lead', cliente: 'cliente', fornitore: 'fornitore', partner: 'partner', concorrente: 'concorrente' };
const KIND_OF = { impresa: 'impresa', 'ente pubblico': 'ente_pubblico', 'societa partecipata': 'partecipata', professionista: 'professionista', condominio: 'condominio', altro: 'altro' };
const CATEGORIES = ['materiali', 'subappalti', 'noli', 'servizi_cantiere', 'professionisti', 'mezzi', 'servizi_generali'];

// righe dell'Excel → aziende da caricare
function readCompanies(buf) {
  const rows = sheetRows(buf);
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

// CSV di Zoho (virgole, virgolette doppie)
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0]);
}
const isCommesseFile = rows => rows?.[0]?.some(h => norm(h) === norm('Committente (Nome Azienda).id'));
const ASA_OF = { edilizia: 'edilizia', impianti: 'impianti', facility: 'facility', 'facility management': 'facility', 'reti mp bp': 'reti_mp_bp', 'reti bp mp': 'reti_mp_bp',
  'reti ap': 'reti_ap', 'metano ap': 'reti_ap', restauro: 'restauro', progettazione: 'progettazione', 'altri servizi': 'altri_servizi', esco: 'esco' };
const isContactsFile = rows => rows?.[0]?.some(h => norm(h) === 'contact name');
function readContacts(rows) {
  const head = rows[0].map(h => norm(h));
  const col = (...names) => head.findIndex(h => names.map(norm).includes(h));
  const I = { id: col('ID record'), name: col('Contact Name'), job: col('Ruolo in azienda'), cid: col('Azienda.id'), cname: col('Azienda'), email: col('E-mail', 'Email'), owner: col('Owner Contatto') };
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  return rows.slice(1).map(r => {
    const name = cell(r, I.name).replace(/\s+/g, ' ');
    const parts = name.split(' ');
    return { zoho_id: cell(r, I.id), name, first_name: parts.length > 1 ? parts.slice(0, -1).join(' ') : '', last_name: parts.length > 1 ? parts[parts.length - 1] : name,
      job: cell(r, I.job), company_zoho_id: cell(r, I.cid), company_name: cell(r, I.cname), email: cell(r, I.email).toLowerCase(), owner_name: cell(r, I.owner) };
  });
}
const sheetRows = buf => {
  if (buf.length > 1 && !(buf[0] === 0x50 && buf[1] === 0x4b)) return parseCsv(buf.toString('utf8').replace(/^\uFEFF/, '')); // non è uno zip: CSV
  let sheets;
  try { sheets = readXlsx(buf); } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); }
  return sheets.Aziende || Object.values(sheets)[0];
};

function registerCrmImport(app, { db }) {
  const raw = express.raw({ type: () => true, limit: '20mb' });
  const adminOnly = req => { if (!req.crm?.admin) throw new HttpError(403, 'Il caricamento lo fa la direzione'); };

  async function plan(req) {
    adminOnly(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Carica il file Excel');
    const firstRows = sheetRows(req.body);
    const contactsFile = isContactsFile(firstRows);
    if (isCommesseFile(firstRows)) return planCommesse(req, firstRows);
    const items = contactsFile ? [] : readCompanies(req.body);
    const [{ rows: users }, { rows: existing }, { rows: asa }, { rows: org }] = await Promise.all([
      db.query(`SELECT u.id, u.name, lower(u.email) AS email, (SELECT o.department FROM org_people o WHERE lower(o.email) = lower(u.email) LIMIT 1) AS department FROM users u`),
      db.query('SELECT id, name, zoho_id FROM crm_subjects WHERE merged_into IS NULL'),
      db.query('SELECT key FROM crm_asa'),
      db.query("SELECT oid, name, lower(email) AS email, job_title, department FROM org_people WHERE email IS NOT NULL AND email <> ''"),
    ]);
    const byOrg = new Map(org.map(p => [personKey(p.name), p]));
    if (contactsFile) return planContacts(req, { users, org, byOrg });
    const byEmail = new Map(users.map(u => [u.email, u]));
    const asaKeys = new Set(asa.map(a => a.key));
    const byName = new Map(users.map(u => [personKey(u.name), u]));
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
      let owner = byName.get(personKey(it.owner_name));
      if (!owner && it.owner_name) {
        const p = byOrg.get(personKey(it.owner_name));
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

  async function planContacts(req, { users, byOrg }) {
    const items = readContacts(sheetRows(req.body));
    const [{ rows: subjects }, { rows: existing }] = await Promise.all([
      db.query('SELECT id, name, zoho_id FROM crm_subjects WHERE merged_into IS NULL'),
      db.query("SELECT id, zoho_id, lower(email) AS email FROM crm_contacts"),
    ]);
    const byZoho = new Map(subjects.filter(x => x.zoho_id).map(x => [x.zoho_id, x]));
    const byCompanyName = new Map(subjects.map(x => [norm(x.name), x]));
    const exZoho = new Set(existing.map(x => x.zoho_id).filter(Boolean));
    const exEmail = new Set(existing.map(x => x.email).filter(Boolean));
    const byName = new Map(users.map(u => [personKey(u.name), u]));
    const byEmail = new Map(users.map(u => [u.email, u]));
    const me = users.find(u => u.id === req.user.id);
    const stats = { contacts: true, total: items.length, toLoad: 0, linked: 0, unlinked: 0, colleagues: 0, existing: 0, skipped: 0, owners: {}, ownersMissing: {}, ownersFromOrg: {} };
    const newUsers = new Map();
    const load = [];
    for (const it of items) {
      if (!it.name) { stats.skipped++; continue; }
      if (/@almacis\.it$/.test(it.email) || /\b(almacis|alma c i s)\b/.test(norm(it.company_name))) { stats.colleagues++; continue; }
      if ((it.zoho_id && exZoho.has(it.zoho_id)) || (it.email && exEmail.has(it.email))) { stats.existing++; continue; }
      const subject = byZoho.get(it.company_zoho_id) || (it.company_name ? byCompanyName.get(norm(it.company_name)) : null);
      let owner = byName.get(personKey(it.owner_name));
      if (!owner && it.owner_name) {
        const p = byOrg.get(personKey(it.owner_name));
        if (p) { owner = byEmail.get(p.email) || { id: null, name: p.name, email: p.email }; if (!owner.id) newUsers.set(p.email, p); stats.ownersFromOrg[p.name] = (stats.ownersFromOrg[p.name] || 0) + 1; }
        else stats.ownersMissing[it.owner_name] = (stats.ownersMissing[it.owner_name] || 0) + 1;
      }
      const o = owner || me;
      stats.owners[o.name] = (stats.owners[o.name] || 0) + 1;
      if (subject) stats.linked++; else stats.unlinked++;
      load.push({ ...it, subject_id: subject?.id || null, subject_name: subject?.name || '', owner_id: o.id, owner_email: o.email, owner_label: o.name });
      stats.toLoad++;
    }
    return { stats, load, newUsers: [...newUsers.values()] };
  }
  async function planCommesse(req, rows) {
    const head = rows[0].map(h => norm(h));
    const col = (...names) => head.findIndex(h => names.map(norm).includes(h));
    const I = { cid: col('Committente (Nome Azienda).id'), cname: col('Committente (Nome Azienda)'), rs: col('Ragione Sociale'), code: col('Codice Commessa'), name: col('Nome Commessa'),
      piva: col('Partita Iva'), cf: col('Codice Fiscale'), sdi: col('Codice univoco di fatturazione'), pec: col('E-mail/PEC'), asa: col('ASA'),
      dates: ['Data Contratto', 'Data inizio lavori (effettiva)', 'Data Inizio Lavori Prevista', 'Data di aggiudicazione'].map(n => col(n)).filter(i => i >= 0) };
    const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const { rows: subjects } = await db.query('SELECT id, name, zoho_id, roles, vat, tax_code, sdi_code, pec, asa, client_since, lead_stage FROM crm_subjects WHERE merged_into IS NULL');
    const byZoho = new Map(subjects.filter(x => x.zoho_id).map(x => [x.zoho_id, x]));
    const byName = new Map(subjects.map(x => [norm(x.name), x]));
    const usedVat = new Map(subjects.filter(x => x.vat).map(x => [x.vat, x.id]));
    const usedTax = new Map(subjects.filter(x => x.tax_code).map(x => [x.tax_code, x.id]));
    const per = new Map(); // azienda → dati raccolti dalle sue commesse
    const stats = { commesse: true, total: rows.length - 1, withClient: 0, found: 0, notFound: [], newClients: 0, alreadyClients: 0, vatAdded: 0, taxAdded: 0 };
    for (const r of rows.slice(1)) {
      const cid = cell(r, I.cid), cname = cell(r, I.cname) || cell(r, I.rs);
      if (!cid && !cname) continue;
      stats.withClient++;
      const subj = byZoho.get(cid) || (cname ? byName.get(norm(cname)) : null);
      if (!subj) { if (!stats.notFound.includes(cname)) stats.notFound.push(cname); continue; }
      stats.found++;
      const p = per.get(subj.id) || { subj, codes: [], first: null, vat: '', tax: '', sdi: '', pec: '', asa: new Set() };
      p.codes.push(cell(r, I.code) || cell(r, I.name));
      for (const i of I.dates) { const d = cell(r, i).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!p.first || d < p.first)) p.first = d; }
      const vat = cell(r, I.piva).replace(/\D/g, ''); if (!p.vat && vat.length === 11 && vatOk(vat)) p.vat = vat;
      const tax = cell(r, I.cf).replace(/\s/g, '').toUpperCase(); if (!p.tax && tax && taxCodeOk(tax)) p.tax = tax;
      const sdi = cell(r, I.sdi).toUpperCase(); if (!p.sdi && /^[A-Z0-9]{6,7}$/.test(sdi) && sdi !== '0000000') p.sdi = sdi;
      const pec = cell(r, I.pec).toLowerCase(); if (!p.pec && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) p.pec = pec;
      for (const a of cell(r, I.asa).split(';')) { const k = ASA_OF[norm(a)]; if (k) p.asa.add(k); }
      per.set(subj.id, p);
    }
    const load = [];
    for (const p of per.values()) {
      const s0 = p.subj;
      const change = { id: s0.id, name: s0.name, wasLead: s0.roles.includes('lead'), becomesClient: !s0.roles.includes('cliente'), codes: p.codes, first: p.first };
      if (change.becomesClient) stats.newClients++; else stats.alreadyClients++;
      if (!s0.vat && p.vat && !usedVat.has(p.vat)) { change.vat = p.vat; usedVat.set(p.vat, s0.id); stats.vatAdded++; }
      if (!s0.tax_code && p.tax && !usedTax.has(p.tax)) { change.tax_code = p.tax; usedTax.set(p.tax, s0.id); stats.taxAdded++; }
      if (!s0.sdi_code && p.sdi) change.sdi_code = p.sdi;
      if (!s0.pec && p.pec) change.pec = p.pec;
      const asa = [...new Set([...s0.asa.filter(a => a !== 'altri_servizi' || !p.asa.size), ...p.asa])];
      if (asa.join() !== s0.asa.join()) change.asa = asa;
      load.push(change);
    }
    return { stats, load };
  }
  const contactSample = load => load.slice(0, 30).map(x => ({ name: x.name, job: x.job, company: x.subject_name || (x.company_name ? `${x.company_name} (non trovata)` : '—'), owner: x.owner_label }));

  app.post('/api/crm/import/anteprima', raw, async (req, res) => {
    const { stats, load } = await plan(req);
    if (stats.commesse) return res.json({ stats, sample: load.slice(0, 30).map(x => ({ name: x.name, becomesClient: x.becomesClient, vat: x.vat || '', commesse: x.codes.length, first: x.first })) });
    if (stats.contacts) return res.json({ stats, sample: contactSample(load) });
    res.json({ stats, sample: load.slice(0, 30).map(x => ({ name: x.name, kind: x.kind, roles: x.roles, asa: x.asa, owner: x.owner_label, function_name: x.function_name, why: x.why || '' })) });
  });

  app.post('/api/crm/import', raw, async (req, res) => {
    const { stats, load, newUsers } = await plan(req);
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;
    if (stats.commesse) {
      await db.tx(async q => {
        for (const x of load) {
          const { rows: [cur] } = await q.query('SELECT roles, lead_stage, client_since FROM crm_subjects WHERE id = $1', [x.id]);
          const roles = [...new Set([...cur.roles.filter(r => r !== 'lead'), 'cliente'])];
          const since = [cur.client_since, x.first].filter(Boolean).sort()[0] || today;
          const sets = ['roles = $2', 'client_since = $3', 'updated_at = now()'];
          const vals = [x.id, roles, since];
          for (const k of ['vat', 'tax_code', 'sdi_code', 'pec', 'asa']) if (x[k] !== undefined) { vals.push(x[k]); sets.push(`${k} = $${vals.length}`); }
          await q.query(`UPDATE crm_subjects SET ${sets.join(', ')} WHERE id = $1`, vals);
          if (x.becomesClient) {
            await q.query('INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
              [x.id, x.wasLead ? cur.lead_stage : null, 'cliente', `prima commessa ${x.codes[0] || ''} (da Zoho)`.trim(), req.user.id]);
          }
          created++;
        }
      });
      return res.status(201).json({ created, stats });
    }
    if (stats.contacts) {
      await db.tx(async q => {
        const ids = new Map();
        for (const p of newUsers) {
          const { rows: [u] } = await q.query(`INSERT INTO users (oid, email, name, job_title) VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO UPDATE SET oid = COALESCE(users.oid, EXCLUDED.oid) RETURNING id`, [p.oid, p.email, p.name, p.job_title || null]);
          ids.set(p.email, u.id);
        }
        for (const x of load) {
          const { rows: [c] } = await q.query(
            `INSERT INTO crm_contacts (first_name, last_name, email, owner_id, zoho_id, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [x.first_name.slice(0, 120), x.last_name.slice(0, 120) || x.name.slice(0, 120), x.email.slice(0, 200), x.owner_id || ids.get(x.owner_email) || req.user.id,
              x.zoho_id.slice(0, 40), `Caricato da Zoho il ${today}${!x.subject_id && x.company_name ? ` (azienda in Zoho: ${x.company_name})` : ''}`, req.user.id]);
          if (x.subject_id) await q.query('INSERT INTO crm_contact_links (contact_id, subject_id, job, is_primary) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING', [c.id, x.subject_id, x.job.slice(0, 120)]);
          created++;
        }
      });
      return res.status(201).json({ created, stats });
    }
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
