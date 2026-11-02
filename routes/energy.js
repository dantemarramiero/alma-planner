// Alma Energy: modulo della BU Energy (business IPP). Membri del modulo, CRM (aziende e persone), opportunità delle
// tre pipeline con lo storico degli stadi, collegamenti con un ruolo e simulatore dei rendimenti.
// Tutto riservato ai membri del modulo (per ora Dante e Tullio): gli altri ricevono 403.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const {
  planScreening, importScreening, planConventions, importConventions, ownersToPipeline, refreshRevamping, SIGNALS, OWNER_KEY_SQL, PRIORITY_ORDER,
} = require('../lib/energy-import');
const {
  STAGES, KINDS, COMPANY_TYPES, LINK_ROLES, RELATIONS, COMPANY_STATUS, INFLUENCE, CHANNELS, stageKeys, CLOSED_STAGES, openStages, FORWARD_ACTIONS, TARGET_STEPS, TARGET_OUTCOMES, checklistFor, STAGE_PROBABILITY,
} = require('../lib/energy');
const { cashflows, buyRevampSell, portfolioYear, sensitivity, DEFAULTS, PRICE_CURVE } = require('../lib/energy-sim');
const { runScenario, summaryOf, FV_DEFAULTS, REVAMPING_DEFAULTS, PPA_DEFAULTS } = require('../lib/energy-scenarios');
const { writeXlsx } = require('../lib/xlsx');
const tiers = require('../lib/energy-tiers');
const { addWorkdays, romeNow } = require('../lib/workdays');

const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));
const duplicate = err => err?.code === '23505';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Numero con la virgola o il punto; vuoto = non noto.
function num(value, field, { min = -1e15, max = 1e15 } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s|€/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return n;
}
const textList = (value, field, allowed) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `Il campo «${field}» non è valido`);
  const list = [...new Set(value.map(x => v.text(x, field, { max: 60 })).filter(Boolean))];
  if (allowed) for (const x of list) if (!allowed.includes(x)) throw new HttpError(400, `Il valore «${x}» di «${field}» non è valido`);
  return list;
};
const email = (value, field) => {
  const s = v.text(value, field, { max: 200 });
  if (s && !EMAIL_RE.test(s)) throw new HttpError(400, `L'email «${field}» non è valida`);
  return s === undefined ? undefined : s.toLowerCase();
};
const vatClean = value => {
  const s = v.text(value, 'P.IVA', { max: 20 });
  return s === undefined ? undefined : s.replace(/\s/g, '').replace(/^IT/i, '').toUpperCase();
};

// Campi in più dei tipi di azienda: tiene solo quelli dei tipi scelti, ognuno col suo formato.
function cleanExtra(extra, types) {
  if (extra === undefined) return undefined;
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw new HttpError(400, 'I dati del tipo di azienda non sono validi');
  const out = {};
  for (const t of types) {
    for (const [key, label, kind, choices] of COMPANY_TYPES[t]?.fields || []) {
      if (!(key in extra)) continue;
      const raw = extra[key];
      if (raw === null || raw === '') continue;
      if (kind === 'number') out[key] = num(raw, label);
      else if (kind === 'date') out[key] = v.date(raw, label);
      else if (kind === 'bool') out[key] = Boolean(raw);
      else if (kind === 'choice') out[key] = v.oneOf(raw, label, choices);
      else out[key] = v.text(raw, label, { max: 300 });
    }
  }
  return out;
}

function companyFields(b, { partial }) {
  const types = textList(b.types, 'Tipo', Object.keys(COMPANY_TYPES));
  return pick({
    name: v.text(b.name, 'Ragione sociale', { max: 200, required: !partial }),
    vat: vatClean(b.vat),
    tax_code: v.text(b.tax_code, 'Codice fiscale', { max: 20 }),
    legal_form: v.text(b.legal_form, 'Forma giuridica', { max: 60 }),
    ateco: v.text(b.ateco, 'ATECO', { max: 20 }),
    status: v.oneOf(b.status, 'Stato', Object.keys(COMPANY_STATUS)),
    address: v.text(b.address, 'Indirizzo', { max: 200 }),
    city: v.text(b.city, 'Comune', { max: 100 }),
    province: v.text(b.province, 'Provincia', { max: 60 }),
    region: v.text(b.region, 'Regione', { max: 60 }),
    pec: email(b.pec, 'PEC'),
    phone: v.text(b.phone, 'Telefono', { max: 40 }),
    website: v.text(b.website, 'Sito web', { max: 200 }),
    group_id: v.int(b.group_id, 'Gruppo', { min: 1, nullable: true }),
    revenue: num(b.revenue, 'Fatturato', { min: 0 }),
    employees: v.int(b.employees, 'Dipendenti', { min: 0, max: 1e6, nullable: true }),
    balance_year: v.int(b.balance_year, 'Anno di bilancio', { min: 1900, max: 2100, nullable: true }),
    types,
    owner_id: v.int(b.owner_id, 'Responsabile', { min: 1, nullable: true }),
    source: v.text(b.source, 'Fonte', { max: 100 }),
    relation: v.oneOf(b.relation, 'Stato della relazione', Object.keys(RELATIONS)),
    last_contact: v.date(b.last_contact, 'Ultimo contatto'),
    next_action: v.text(b.next_action, 'Prossima azione', { max: 300 }),
    next_action_date: v.date(b.next_action_date, 'Data della prossima azione'),
    tags: textList(b.tags, 'Tag'),
    notes: v.text(b.notes, 'Note', { max: 5000 }),
  });
}

function personFields(b, { partial }) {
  return pick({
    first_name: v.text(b.first_name, 'Nome', { max: 120 }),
    last_name: v.text(b.last_name, 'Cognome', { max: 120, required: !partial }),
    title: v.text(b.title, 'Titolo', { max: 20 }),
    influence: b.influence === '' ? '' : v.oneOf(b.influence, 'Peso nella decisione', Object.keys(INFLUENCE)),
    email: email(b.email, 'Email'),
    phone: v.text(b.phone, 'Telefono', { max: 40 }),
    mobile: v.text(b.mobile, 'Cellulare', { max: 40 }),
    linkedin: v.text(b.linkedin, 'LinkedIn', { max: 200 }),
    channel: b.channel === '' ? '' : v.oneOf(b.channel, 'Canale preferito', Object.keys(CHANNELS)),
    owner_id: v.int(b.owner_id, 'Responsabile', { min: 1, nullable: true }),
    source: v.text(b.source, 'Fonte', { max: 100 }),
    last_contact: v.date(b.last_contact, 'Ultimo contatto'),
    next_action: v.text(b.next_action, 'Prossima azione', { max: 300 }),
    next_action_date: v.date(b.next_action_date, 'Data della prossima azione'),
    notes: v.text(b.notes, 'Note', { max: 5000 }),
    legal_basis: v.oneOf(b.legal_basis, 'Base giuridica', ['legittimo_interesse', 'consenso']),
    data_source: v.text(b.data_source, 'Fonte del dato', { max: 200 }),
    data_date: v.date(b.data_date, 'Data del dato'),
    opt_out: b.opt_out === undefined ? undefined : Boolean(b.opt_out),
  });
}

function opportunityFields(b, { partial, kind }) {
  return pick({
    title: v.text(b.title, 'Nome', { max: 200, required: !partial }),
    priority: v.text(b.priority, 'Priorità', { max: 30 }),
    mw: num(b.mw, 'MW', { min: 0, max: 100000 }),
    capex: num(b.capex, 'Capex', { min: 0 }),
    probability: v.int(b.probability, 'Probabilità', { min: 0, max: 100, nullable: true }),
    city: v.text(b.city, 'Comune', { max: 100 }),
    province: v.text(b.province, 'Provincia', { max: 60 }),
    region: v.text(b.region, 'Regione', { max: 60 }),
    lat: num(b.lat, 'Latitudine', { min: -90, max: 90 }),
    lon: num(b.lon, 'Longitudine', { min: -180, max: 180 }),
    company_id: v.int(b.company_id, 'Azienda', { min: 1, nullable: true }),
    owner_id: v.int(b.owner_id, 'Responsabile', { min: 1, nullable: true }),
    notes: v.text(b.notes, 'Note', { max: 5000 }),
    data: b.data === undefined ? undefined : (b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : (() => { throw new HttpError(400, 'I dati dell\'opportunità non sono validi'); })()),
    kind,
  });
}

// INSERT/UPDATE da un oggetto di campi già validati.
const cols = f => Object.keys(f);
const insertSql = (table, f) => `INSERT INTO ${table} (${cols(f).join(', ')}) VALUES (${cols(f).map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
const updateSql = (table, f) => `UPDATE ${table} SET ${cols(f).map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`;
const jsonCols = new Set(['extra', 'data']);
const vals = f => Object.entries(f).map(([k, val]) => (jsonCols.has(k) ? JSON.stringify(val) : val));

function registerEnergy(app, { db, energyAccess, isAdmin }) {
  app.use('/api/energy', (req, _res, next) => {
    energyAccess.canUse(req).then(ok => next(ok ? undefined : new HttpError(403, 'Alma Energy è riservato alla BU Energy')), next);
  });

  // ── modulo: elenchi per la pagina, membri e numeri delle pipeline ─────────────────────────────
  app.get('/api/energy', async (req, res) => {
    const [{ rows: members }, { rows: counts }, { rows: [crm] }] = await Promise.all([
      db.query(`SELECT m.email, m.created_at, u.id AS user_id, u.name FROM energy_members m
                 LEFT JOIN users u ON lower(u.email) = m.email ORDER BY m.created_at`),
      db.query('SELECT kind, stage, COUNT(*)::int AS n, COALESCE(SUM(mw), 0)::float AS mw FROM energy_opportunities GROUP BY kind, stage'),
      db.query('SELECT (SELECT COUNT(*)::int FROM energy_companies) AS companies, (SELECT COUNT(*)::int FROM energy_people) AS people'),
    ]);
    res.json({
      meta: { stages: STAGES, kinds: KINDS, companyTypes: COMPANY_TYPES, linkRoles: LINK_ROLES, relations: RELATIONS,
        companyStatus: COMPANY_STATUS, influence: INFLUENCE, channels: CHANNELS,
        targetSteps: TARGET_STEPS.map(st => ({ key: st.key, label: st.label })), targetOutcomes: TARGET_OUTCOMES,
        closedStages: CLOSED_STAGES, forwardActions: FORWARD_ACTIONS },
      members, counts, crm, can_manage_members: true, is_admin: Boolean(isAdmin(req)),
    });
  });

  app.post('/api/energy/members', async (req, res) => {
    const e = email(req.body.email, 'Email');
    if (!e) throw new HttpError(400, 'Scrivi l\'email dell\'account di Alma Planet');
    await db.query('INSERT INTO energy_members (email, added_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [e, req.user.id]);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/energy/members/:email', async (req, res) => {
    const e = String(req.params.email).toLowerCase();
    if (e === String(req.user.email).toLowerCase()) throw new HttpError(400, 'Non puoi toglierti da solo: chiedi a un altro membro');
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM energy_members');
    if (n <= 1) throw new HttpError(400, 'Nel modulo deve restare almeno una persona');
    await db.query('DELETE FROM energy_members WHERE email = $1', [e]);
    res.json({ ok: true });
  });

  // ── aziende ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/energy/companies', async (req, res) => {
    const where = ['TRUE'];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.type) add('? = ANY(c.types)', String(req.query.type));
    if (req.query.region) add('lower(c.region) = lower(?)', String(req.query.region));
    if (req.query.relation) add('c.relation = ?', String(req.query.relation));
    if (req.query.owner) add('c.owner_id = ?', Number(req.query.owner) || 0);
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const n = params.length;
      where.push(`(c.name ILIKE $${n} OR c.vat ILIKE $${n} OR c.city ILIKE $${n})`);
    }
    const sql = where.join(' AND ');
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.vat, c.city, c.province, c.region, c.types, c.relation, c.status, c.owner_id, c.next_action, c.next_action_date,
              c.last_contact, u.name AS owner_name, g.name AS group_name,
              (SELECT COUNT(*)::int FROM energy_person_companies pc WHERE pc.company_id = c.id) AS people,
              (SELECT COUNT(DISTINCT l.opportunity_id)::int FROM energy_links l WHERE l.company_id = c.id) AS opportunities
         FROM energy_companies c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN energy_companies g ON g.id = c.group_id
        WHERE ${sql} ORDER BY lower(c.name) LIMIT 500`, params);
    const { rows: byType } = await db.query('SELECT t AS type, COUNT(*)::int AS n FROM energy_companies, unnest(types) t GROUP BY t');
    res.json({ companies: rows, byType: Object.fromEntries(byType.map(r => [r.type, r.n])) });
  });

  // Doppioni prima di salvare: stessa P.IVA o nome uguale (maiuscole a parte).
  app.get('/api/energy/companies/check', async (req, res) => {
    const vat = vatClean(String(req.query.vat || '')) || '';
    const name = String(req.query.name || '').trim();
    const { rows } = await db.query(
      `SELECT id, name, vat FROM energy_companies WHERE ($1 <> '' AND vat = $1) OR ($2 <> '' AND lower(name) = lower($2)) LIMIT 5`, [vat, name]);
    res.json({ matches: rows });
  });

  async function companyById(id) {
    const { rows: [c] } = await db.query(
      `SELECT c.*, u.name AS owner_name, g.name AS group_name FROM energy_companies c
         LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN energy_companies g ON g.id = c.group_id WHERE c.id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Azienda non trovata');
    return c;
  }

  app.post('/api/energy/companies', async (req, res) => {
    const f = companyFields(req.body, { partial: false });
    f.extra = cleanExtra(req.body.extra, f.types || []) || {};
    f.created_by = req.user.id;
    try {
      const { rows: [c] } = await db.query(insertSql('energy_companies', f), vals(f));
      res.status(201).json(c);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'C\'è già un\'azienda con questa P.IVA');
      throw err;
    }
  });

  app.get('/api/energy/companies/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const c = await companyById(id);
    const [{ rows: people }, { rows: opportunities }, { rows: controlled }] = await Promise.all([
      db.query(`SELECT p.id, p.first_name, p.last_name, p.title, p.email, p.phone, p.mobile, p.influence, p.opt_out, pc.role
                  FROM energy_person_companies pc JOIN energy_people p ON p.id = pc.person_id
                 WHERE pc.company_id = $1 ORDER BY lower(p.last_name), lower(p.first_name)`, [id]),
      db.query(`SELECT o.id, o.kind, o.title, o.stage, o.mw, o.project_id, array_agg(DISTINCT l.role) AS roles
                  FROM energy_opportunities o JOIN energy_links l ON l.opportunity_id = o.id
                 WHERE l.company_id = $1 GROUP BY o.id ORDER BY o.updated_at DESC`, [id]),
      db.query('SELECT id, name FROM energy_companies WHERE group_id = $1 ORDER BY lower(name)', [id]),
    ]);
    res.json({ ...c, people, opportunities, controlled });
  });

  app.patch('/api/energy/companies/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await companyById(id);
    const f = companyFields(req.body, { partial: true });
    if (f.group_id === id) throw new HttpError(400, 'Un\'azienda non può essere il gruppo di sé stessa');
    const types = f.types || cur.types;
    // i campi in più seguono i tipi: togliendo un tipo spariscono i suoi
    const extra = cleanExtra(req.body.extra !== undefined ? req.body.extra : cur.extra, types);
    f.extra = extra;
    try {
      const { rows: [c] } = await db.query(updateSql('energy_companies', f), [id, ...vals(f)]);
      res.json(c);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'C\'è già un\'azienda con questa P.IVA');
      throw err;
    }
  });

  app.delete('/api/energy/companies/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await companyById(id);
    await db.query('DELETE FROM energy_companies WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── persone ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/energy/people', async (req, res) => {
    const where = ['TRUE'];
    const params = [];
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const n = params.length;
      where.push(`(p.last_name ILIKE $${n} OR p.first_name ILIKE $${n} OR p.email ILIKE $${n}
                   OR (p.first_name || ' ' || p.last_name) ILIKE $${n})`);
    }
    if (req.query.company) {
      params.push(Number(req.query.company) || 0);
      where.push(`EXISTS (SELECT 1 FROM energy_person_companies x WHERE x.person_id = p.id AND x.company_id = $${params.length})`);
    }
    if (req.query.type) {
      params.push(String(req.query.type));
      where.push(`EXISTS (SELECT 1 FROM energy_person_companies x JOIN energy_companies c ON c.id = x.company_id
                          WHERE x.person_id = p.id AND $${params.length} = ANY(c.types))`);
    }
    if (req.query.owner) { params.push(Number(req.query.owner) || 0); where.push(`p.owner_id = $${params.length}`); }
    // chi si è opposto al contatto non compare negli elenchi da contattare
    if (req.query.contactable === '1') where.push('NOT p.opt_out');
    const { rows } = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.title, p.email, p.phone, p.mobile, p.influence, p.opt_out, p.owner_id,
              p.next_action, p.next_action_date, p.last_contact, u.name AS owner_name,
              COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'role', pc.role) ORDER BY lower(c.name))
                          FROM energy_person_companies pc JOIN energy_companies c ON c.id = pc.company_id WHERE pc.person_id = p.id), '[]') AS companies
         FROM energy_people p LEFT JOIN users u ON u.id = p.owner_id
        WHERE ${where.join(' AND ')} ORDER BY lower(p.last_name), lower(p.first_name) LIMIT 500`, params);
    res.json({ people: rows });
  });

  async function personById(id) {
    const { rows: [p] } = await db.query(
      'SELECT p.*, u.name AS owner_name FROM energy_people p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = $1', [id]);
    if (!p) throw new HttpError(404, 'Persona non trovata');
    return p;
  }

  // Aziende di una persona: [{ company_id, role }]. Sostituisce l'elenco.
  async function setPersonCompanies(q, personId, list) {
    if (!Array.isArray(list)) throw new HttpError(400, 'Le aziende della persona non sono valide');
    const clean = list.map(x => ({ company_id: v.int(x.company_id, 'Azienda', { min: 1 }), role: v.text(x.role ?? '', 'Qualifica', { max: 120 }) }));
    await q.query('DELETE FROM energy_person_companies WHERE person_id = $1', [personId]);
    for (const x of clean) {
      await q.query(
        `INSERT INTO energy_person_companies (person_id, company_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (person_id, company_id) DO UPDATE SET role = EXCLUDED.role`, [personId, x.company_id, x.role]);
    }
  }

  app.post('/api/energy/people', async (req, res) => {
    const f = personFields(req.body, { partial: false });
    f.created_by = req.user.id;
    const person = await db.tx(async q => {
      const { rows: [p] } = await q.query(insertSql('energy_people', f), vals(f));
      if (req.body.companies) await setPersonCompanies(q, p.id, req.body.companies);
      return p;
    });
    res.status(201).json(person);
  });

  app.get('/api/energy/people/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const p = await personById(id);
    const [{ rows: companies }, { rows: opportunities }] = await Promise.all([
      db.query(`SELECT c.id, c.name, c.types, pc.role FROM energy_person_companies pc JOIN energy_companies c ON c.id = pc.company_id
                 WHERE pc.person_id = $1 ORDER BY lower(c.name)`, [id]),
      db.query(`SELECT o.id, o.kind, o.title, o.stage, o.project_id, array_agg(DISTINCT l.role) AS roles
                  FROM energy_opportunities o JOIN energy_links l ON l.opportunity_id = o.id
                 WHERE l.person_id = $1 GROUP BY o.id ORDER BY o.updated_at DESC`, [id]),
    ]);
    res.json({ ...p, companies, opportunities });
  });

  app.patch('/api/energy/people/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await personById(id);
    const f = personFields(req.body, { partial: true });
    const person = await db.tx(async q => {
      const { rows: [p] } = Object.keys(f).length
        ? await q.query(updateSql('energy_people', f), [id, ...vals(f)])
        : await q.query('SELECT * FROM energy_people WHERE id = $1', [id]);
      if (req.body.companies) await setPersonCompanies(q, id, req.body.companies);
      return p;
    });
    res.json(person);
  });

  app.delete('/api/energy/people/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await personById(id);
    await db.query('DELETE FROM energy_people WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── opportunità ───────────────────────────────────────────────────────────────────────────
  const kindOf = value => v.oneOf(value, 'Tipo', Object.keys(KINDS));

  app.get('/api/energy/opportunities', async (req, res) => {
    const where = ['TRUE'];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.kind) add('o.kind = ?', kindOf(String(req.query.kind)));
    if (req.query.stage) add('o.stage = ?', String(req.query.stage));
    if (req.query.priority) add('o.priority = ?', String(req.query.priority));
    if (req.query.region) add('lower(o.region) = lower(?)', String(req.query.region));
    if (req.query.company) {
      params.push(Number(req.query.company) || 0);
      const n = params.length;
      where.push(`(o.company_id = $${n} OR EXISTS (SELECT 1 FROM energy_links l WHERE l.opportunity_id = o.id AND l.company_id = $${n}))`);
    }
    if (req.query.q) add('o.title ILIKE ?', `%${String(req.query.q).trim()}%`);
    const limit = Math.min(Number(req.query.limit) || 2000, 5000);
    const { rows } = await db.query(
      `SELECT o.id, o.kind, o.title, o.stage, o.priority, o.mw, o.capex, o.probability, o.city, o.province, o.region, o.lat, o.lon,
              o.company_id, c.name AS company_name, o.owner_id, u.name AS owner_name, o.project_id, o.stage_changed_at, o.updated_at
         FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id
        WHERE ${where.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ${limit}`, params);
    res.json({ opportunities: rows });
  });

  async function opportunityById(id) {
    const { rows: [o] } = await db.query(
      `SELECT o.*, c.name AS company_name, u.name AS owner_name FROM energy_opportunities o
         LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id WHERE o.id = $1`, [id]);
    if (!o) throw new HttpError(404, 'Opportunità non trovata');
    return o;
  }

  app.post('/api/energy/opportunities', async (req, res) => {
    const kind = kindOf(req.body.kind);
    if (!kind) throw new HttpError(400, 'Scegli il tipo di opportunità');
    const f = opportunityFields(req.body, { partial: false, kind });
    const stage = req.body.stage === undefined ? stageKeys(kind)[0] : v.oneOf(req.body.stage, 'Stadio', stageKeys(kind));
    if (stage === 'target') throw new HttpError(400, 'Un\'opportunità diventa Impianto target con «Seleziona come target»');
    Object.assign(f, { stage, created_by: req.user.id, owner_id: f.owner_id ?? req.user.id });
    const opp = await db.tx(async q => {
      const { rows: [o] } = await q.query(insertSql('energy_opportunities', f), vals(f));
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, user_id) VALUES ($1, NULL, $2, $3)', [o.id, stage, req.user.id]);
      // l'azienda principale è anche collegata, con il ruolo tipico del tipo di opportunità
      if (o.company_id) {
        const role = kind === 'ppa_onsite' ? 'cliente' : kind === 'revamping' ? 'proprietario' : 'sviluppatore';
        await q.query('INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.id, o.company_id, role]);
      }
      return o;
    });
    res.status(201).json(opp);
  });

  app.get('/api/energy/opportunities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await opportunityById(id);
    const [{ rows: links }, { rows: history }] = await Promise.all([
      db.query(`SELECT l.id, l.role, l.company_id, c.name AS company_name, c.types AS company_types,
                       l.person_id, p.first_name, p.last_name, p.email, p.phone, p.opt_out
                  FROM energy_links l LEFT JOIN energy_companies c ON c.id = l.company_id LEFT JOIN energy_people p ON p.id = l.person_id
                 WHERE l.opportunity_id = $1 ORDER BY l.person_id NULLS FIRST, l.created_at`, [id]),
      db.query(`SELECT h.from_stage, h.to_stage, h.note, h.at, u.name AS user_name FROM energy_stage_history h
                  LEFT JOIN users u ON u.id = h.user_id WHERE h.opportunity_id = $1 ORDER BY h.at DESC, h.id DESC`, [id]),
    ]);
    // revamping: le convenzioni GSE del proprietario, con gli incassi anno per anno
    const conventions = o.kind === 'revamping'
      ? (await db.query('SELECT * FROM energy_conventions WHERE opportunity_id = $1 ORDER BY rank NULLS LAST', [id])).rows : undefined;
    res.json({ ...o, links, history, conventions });
  });

  app.patch('/api/energy/opportunities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    const f = opportunityFields(req.body, { partial: true });
    delete f.kind;
    if (f.data) f.data = { ...cur.data, ...f.data };
    if (!Object.keys(f).length) return res.json(cur);
    const { rows: [o] } = await db.query(updateSql('energy_opportunities', f), [id, ...vals(f)]);
    // il progetto dell'opportunità porta il suo nome e il suo responsabile
    if (o.project_id && (f.title || f.owner_id)) {
      await db.query('UPDATE projects SET name = $2, owner_id = COALESCE($3, owner_id), updated_at = now() WHERE id = $1', [o.project_id, o.title.slice(0, 200), o.owner_id]);
      // chi era responsabile resta nel progetto come membro
      if (cur.owner_id && cur.owner_id !== o.owner_id) {
        await db.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.project_id, cur.owner_id, req.user.id]);
      }
      if (o.owner_id) await db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [o.project_id, o.owner_id]);
    }
    // profilo di consumo cambiato sulla scheda di un tetto: punteggio e priorità con i parametri in uso
    if (o.kind === 'ppa_onsite' && f.data && f.data.profilo !== (cur.data || {}).profilo) {
      await tiers.rescoreRoof(db, id);
      return res.json(await opportunityById(id));
    }
    res.json(o);
  });

  // Cosa serve per andare in uno stadio (ALM2-24, come i campi richiesti dal blueprint di BOSS): la finestra del
  // passaggio li mostra, il server li controlla. PPA on-site: dall'analisi dei consumi la persona di riferimento,
  // dalla proposta uno scenario del simulatore salvato sull'opportunità.
  async function stageRequirements(o, stage) {
    const out = [];
    const keys = stageKeys(o.kind);
    if (CLOSED_STAGES.includes(stage)) return out;
    if (o.kind === 'ppa_onsite' && keys.indexOf(stage) >= keys.indexOf('analisi_consumi')) {
      const { rows: [p] } = await db.query('SELECT 1 FROM energy_links WHERE opportunity_id = $1 AND person_id IS NOT NULL LIMIT 1', [o.id]);
      out.push({ key: 'persona', label: 'Persona di riferimento del cliente collegata', ok: Boolean(p),
        hint: 'Collegala nel tab «Opportunità», riquadro «Aziende e persone collegate».' });
    }
    if (o.kind === 'ppa_onsite' && keys.indexOf(stage) >= keys.indexOf('proposta')) {
      const { rows: [sc] } = await db.query('SELECT 1 FROM energy_scenarios WHERE opportunity_id = $1 LIMIT 1', [o.id]);
      out.push({ key: 'scenario', label: 'Scenario del simulatore salvato sull\'opportunità', ok: Boolean(sc), hint: 'La proposta parte da lì: «Apri nel simulatore».' });
    }
    return out;
  }
  app.get('/api/energy/opportunities/:id/stage/:stage', async (req, res) => {
    const o = await opportunityById(v.int(req.params.id, 'id', { min: 1 }));
    const stage = v.oneOf(req.params.stage, 'Stadio', stageKeys(o.kind));
    res.json({ requirements: await stageRequirements(o, stage), creates_project: !o.project_id && openStages(o.kind).indexOf(stage) > 0 });
  });

  // Cambio di stadio: resta nello storico. «perso» e «scartato» chiedono il motivo, riaprire da uno stadio chiuso
  // (persa, scartata, standby) la motivazione; «target» passa da «Seleziona come target». Oltre il primo stadio
  // l'opportunità ha il suo progetto di Alma Planet (deciso da Dante il 02/11).
  app.post('/api/energy/opportunities/:id/stage', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    const stage = v.oneOf(req.body.stage, 'Stadio', stageKeys(cur.kind));
    if (!stage) throw new HttpError(400, 'Scegli lo stadio');
    if (stage === 'target') throw new HttpError(400, 'Un\'opportunità diventa Impianto target con «Seleziona come target»');
    if (cur.target_step) throw new HttpError(400, 'L\'opportunità è un Impianto target: si segue dall\'iter commerciale');
    const note = v.text(req.body.note, 'Nota', { max: 1000 }) || '';
    const closing = stage === 'perso' || stage === 'scartato';
    const lostReason = closing ? v.text(req.body.lost_reason, 'Motivo', { max: 300, required: true }) : '';
    if (stage === cur.stage) return res.json(cur);
    if (CLOSED_STAGES.includes(cur.stage) && !CLOSED_STAGES.includes(stage) && !note) {
      throw new HttpError(400, 'Scrivi perché la riapri');
    }
    const missing = (await stageRequirements(cur, stage)).filter(r => !r.ok);
    if (missing.length) throw new HttpError(400, `Prima: ${missing.map(r => r.label.toLowerCase()).join('; ')}`);
    const opp = await db.tx(async q => {
      const { rows: [o] } = await q.query(
        `UPDATE energy_opportunities SET stage = $2, lost_reason = $3, stage_changed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, stage, lostReason]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
        [id, cur.stage, stage, closing ? [lostReason, note].filter(Boolean).join(' · ') : note, req.user.id]);
      if (openStages(o.kind).indexOf(stage) > 0) o.project_id = await ensureProject(q, o, req.user.id);
      return o;
    });
    res.json(opp);
  });

  // Il progetto di Alma Planet dell'opportunità (Gantt, ticket, documenti, email, incontri, note, membri): nasce la prima
  // volta che serve, riservato alla BU Energy, con i membri del modulo. Restituisce l'id.
  async function ensureProject(q, o, userId) {
    if (o.project_id) return o.project_id;
    const owner = o.owner_id || userId;
    const { rows: [p] } = await q.query(
      `INSERT INTO projects (name, description, color, status, start_date, owner_id, energy)
       VALUES ($1, $2, '#F2A900', 'active', $3, $4, true) RETURNING id`,
      [o.title.slice(0, 200), `Opportunità di Alma Energy (${KINDS[o.kind]}).`, romeNow().day, owner]);
    for (const uid of await energyMemberIds(q)) {
      if (uid !== owner) await q.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [p.id, uid, userId]);
    }
    await q.query('UPDATE energy_opportunities SET project_id = $2 WHERE id = $1', [o.id, p.id]);
    return p.id;
  }

  // Dal progetto all'opportunità (link dei ticket e delle notifiche che portano a #/projects/…).
  app.get('/api/energy/projects/:projectId/opportunity', async (req, res) => {
    const pid = v.int(req.params.projectId, 'projectId', { min: 1 });
    const { rows: [r] } = await db.query('SELECT id FROM energy_opportunities WHERE project_id = $1', [pid]);
    if (!r) throw new HttpError(404, 'Il progetto non è di un\'opportunità');
    res.json(r);
  });

  app.delete('/api/energy/opportunities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    if (cur.project_id) throw new HttpError(400, 'L\'opportunità ha il suo progetto: segnala persa o scartata invece di cancellarla');
    await db.query('DELETE FROM energy_opportunities WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── collegamenti azienda/persona ↔ opportunità ───────────────────────────────────────────
  app.post('/api/energy/opportunities/:id/links', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await opportunityById(id);
    const role = v.oneOf(req.body.role, 'Ruolo', Object.keys(LINK_ROLES));
    if (!role) throw new HttpError(400, 'Scegli il ruolo');
    const companyId = v.int(req.body.company_id, 'Azienda', { min: 1, nullable: true }) ?? null;
    const personId = v.int(req.body.person_id, 'Persona', { min: 1, nullable: true }) ?? null;
    if (Boolean(companyId) === Boolean(personId)) throw new HttpError(400, 'Collega un\'azienda oppure una persona');
    if (companyId) await companyById(companyId);
    if (personId) await personById(personId);
    try {
      const { rows: [l] } = await db.query(
        'INSERT INTO energy_links (opportunity_id, company_id, person_id, role) VALUES ($1, $2, $3, $4) RETURNING *', [id, companyId, personId, role]);
      await db.query('UPDATE energy_opportunities SET updated_at = now() WHERE id = $1', [id]);
      res.status(201).json(l);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'È già collegato con questo ruolo');
      throw err;
    }
  });

  app.delete('/api/energy/links/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query('DELETE FROM energy_links WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Collegamento non trovato');
    res.json({ ok: true });
  });

  // ── pipeline a kanban: per ogni stadio quante sono, i MW e le prime schede ────────────────────
  // Le schede sono ordinate per priorità (A prima) e poi per valore: punteggio dello screening, incassi persi, MW.
  const CARDS_PER_STAGE = 60;
  // Filtri comuni a kanban e mappa (la query ha o = opportunità, c = azienda principale).
  function pipelineFilter(kind, query) {
    const where = ['o.kind = $1'];
    const params = [kind];
    const add = (sql, val) => { params.push(val); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (query.priority) add('o.priority = ?', String(query.priority));
    if (query.region) add('lower(o.region) = lower(?)', String(query.region));
    if (query.province) add('lower(o.province) = lower(?)', String(query.province));
    if (query.owner) add('o.owner_id = ?', Number(query.owner) || 0);
    if (query.q) add('(o.title ILIKE ? OR o.city ILIKE ? OR c.name ILIKE ?)', `%${String(query.q).trim()}%`);
    if (query.signal) add("(o.data->'segnali') @> jsonb_build_array(?::text)", String(query.signal));
    if (query.strategia) add("o.data->>'strategia' = ?", String(query.strategia));
    return { filter: where.join(' AND '), params };
  }

  // Mappa (ALM2-11): tutte le opportunità del tipo con i filtri del kanban. Con le coordinate diventano punti;
  // senza (il Database CE ha solo la sede del proprietario) si contano per regione.
  app.get('/api/energy/map/:kind', async (req, res) => {
    let filter, params;
    if (req.params.kind === 'target') { // gli Impianti target dei tre tipi
      params = req.query.q ? [`%${String(req.query.q).trim()}%`] : [];
      filter = `o.target_step IS NOT NULL${params.length ? ' AND (o.title ILIKE $1 OR c.name ILIKE $1)' : ''}`;
    } else {
      const kind = Object.keys(KINDS).includes(req.params.kind) ? req.params.kind : null;
      if (!kind) throw new HttpError(400, 'Tipo non valido');
      ({ filter, params } = pipelineFilter(kind, req.query));
    }
    const { rows } = await db.query(
      `SELECT o.id, o.kind, o.title, o.stage, o.priority, o.mw, o.lat, o.lon, o.region, o.province, o.city, o.project_id, o.target_step,
              o.target_step, o.target_outcome, c.name AS company_name, (o.data->>'incassi_persi')::float AS incassi_persi
         FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id
        WHERE ${filter} AND o.stage NOT IN ('perso', 'scartato')`, params);
    const points = rows.filter(r => r.lat !== null && r.lon !== null);
    const regions = {};
    for (const r of rows.filter(x => x.lat === null || x.lon === null)) {
      const k = r.region || 'Senza regione';
      regions[k] ??= { region: k, count: 0, mw: 0, lost: 0 };
      regions[k].count++;
      regions[k].mw += Number(r.mw) || 0;
      regions[k].lost += Math.max(0, Number(r.incassi_persi) || 0);
    }
    res.json({ points, regions: Object.values(regions).sort((a, b) => b.count - a.count) });
  });

  app.get('/api/energy/pipeline/:kind', async (req, res) => {
    const kind = kindOf(req.params.kind);
    const { filter, params } = pipelineFilter(kind, req.query);
    const order = `array_position(ARRAY['A','B','C','D','Dati insufficienti']::text[], o.priority) NULLS LAST,
      COALESCE((o.data->>'punteggio')::float, 0) DESC, COALESCE((o.data->>'incassi_persi')::float, 0) DESC, o.mw DESC NULLS LAST, o.id`;
    const [{ rows: totals }, { rows: cards }, { rows: provinces }] = await Promise.all([
      db.query(`SELECT o.stage, COUNT(*)::int AS n, COALESCE(SUM(o.mw), 0)::float AS mw, COALESCE(SUM(o.capex), 0)::float AS capex,
                       COALESCE(SUM((o.data->>'incassi_persi')::float), 0)::float AS lost
                  FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id WHERE ${filter} GROUP BY o.stage`, params),
      db.query(`SELECT * FROM (
                  SELECT o.id, o.title, o.stage, o.priority, o.mw, o.capex, o.city, o.province, o.region, o.project_id, o.stage_changed_at,
                         c.name AS company_name, u.name AS owner_name,
                         o.data->>'profilo' AS profilo, (o.data->>'punteggio')::float AS punteggio,
                         (o.data->>'convenzioni')::int AS convenzioni, (o.data->>'incassi_persi')::float AS incassi_persi,
                         o.data->'segnali' AS segnali, o.data->>'regime' AS regime, o.data->>'strategia' AS strategia,
                         row_number() OVER (PARTITION BY o.stage ORDER BY ${order}) AS pos
                    FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id
                   WHERE ${filter}) x WHERE pos <= ${CARDS_PER_STAGE}`, params),
      db.query("SELECT DISTINCT province FROM energy_opportunities WHERE kind = $1 AND province <> '' ORDER BY province", [kind]),
    ]);
    res.json({
      stages: STAGES[kind].map(([key, label]) => {
        const t = totals.find(x => x.stage === key) || { n: 0, mw: 0, capex: 0, lost: 0 };
        return { key, label, count: t.n, mw: t.mw, capex: t.capex, lost: t.lost, cards: cards.filter(c => c.stage === key).sort((a, b) => a.pos - b.pos) };
      }),
      provinces: provinces.map(r => r.province),
      perStage: CARDS_PER_STAGE,
    });
  });

  // ── import dai file Excel (screening dei tetti, Database Conto Energia) ───────────────────────
  // Il file arriva così com'è (corpo binario) con il nome nell'header X-File-Name; prima l'anteprima, poi la conferma.
  const fileBody = express.raw({ type: () => true, limit: '25mb' });
  const fileName = req => { try { return decodeURIComponent(String(req.get('X-File-Name') || '')).slice(0, 200); } catch { return ''; } };
  app.post('/api/energy/import/screening/anteprima', fileBody, async (req, res) => {
    res.json((await planScreening(db, req.body)).summary);
  });
  app.post('/api/energy/import/screening', fileBody, async (req, res) => {
    res.json(await importScreening(db, req.body, { userId: req.user.id, fileName: fileName(req) }));
  });
  app.post('/api/energy/import/database-ce/anteprima', fileBody, async (req, res) => {
    res.json((await planConventions(db, req.body)).summary);
  });
  app.post('/api/energy/import/database-ce', fileBody, async (req, res) => {
    res.json(await importConventions(db, req.body, { userId: req.user.id, fileName: fileName(req) }));
  });
  app.get('/api/energy/imports', async (_req, res) => {
    const { rows } = await db.query(
      'SELECT i.id, i.kind, i.file_name, i.summary, i.at, u.name AS user_name FROM energy_imports i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.at DESC LIMIT 20');
    res.json(rows);
  });

  // ── parametri dei tier (ALM2-22): anteprima e applicazione ───────────────────────────────────
  const TIER_KEYS = ['screening', 'database_ce'];
  const tierKey = value => {
    if (!TIER_KEYS.includes(value)) throw new HttpError(404, 'Parametri non trovati');
    return value;
  };
  app.get('/api/energy/parametri', async (_req, res) => {
    const [params, { rows: log }] = await Promise.all([
      tiers.getParams(db),
      db.query(`SELECT l.id, l.key, l.summary, l.at, u.name AS user_name FROM energy_settings_log l LEFT JOIN users u ON u.id = l.user_id
                 ORDER BY l.at DESC, l.id DESC LIMIT 20`),
    ]);
    res.json({
      ...params, log,
      defaults: { screening: tiers.SCREENING_DEFAULTS, database_ce: tiers.CE_DEFAULTS },
      profiles: tiers.PROFILES, signals: SIGNALS,
    });
  });
  app.post('/api/energy/parametri/:key/anteprima', async (req, res) => {
    const key = tierKey(req.params.key);
    res.json(key === 'screening' ? await tiers.previewScreening(db, req.body.params) : await tiers.previewCe(db, req.body.params));
  });
  app.post('/api/energy/parametri/:key', async (req, res) => {
    const key = tierKey(req.params.key);
    res.json(key === 'screening'
      ? await tiers.applyScreening(db, req.body.params, req.user.id)
      : await tiers.applyCe(db, req.body.params, req.user.id, { toPipeline: req.body.to_pipeline === true }));
  });

  // ── Database impianti in Conto Energia: consultazione e «Porta in pipeline» ──────────────────
  const SORTS = { incassi_persi: 'lost_per_year DESC NULLS LAST', variazione: 'variation ASC NULLS LAST', rank: 'rank ASC NULLS LAST', proprietario: 'lower(owner_name)' };
  app.get('/api/energy/conventions', async (req, res) => {
    const where = ['TRUE'];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (req.query.priority) add('priority = ?', String(req.query.priority));
    if (req.query.owner_type) add('owner_type = ?', String(req.query.owner_type));
    if (req.query.trend) add("trend ILIKE ? || '%'", String(req.query.trend));
    if (req.query.region) add('region = ?', String(req.query.region));
    if (req.query.signal) add('? = ANY(signals)', String(req.query.signal));
    if (req.query.q) add('(owner_name ILIKE ? OR owner_vat ILIKE ? OR convention ILIKE ?)', `%${String(req.query.q).trim()}%`);
    if (req.query.min_lost) add('lost_per_year >= ?', Number(req.query.min_lost) || 0);
    if (req.query.in_pipeline === '1') where.push('opportunity_id IS NOT NULL');
    if (req.query.in_pipeline === '0') where.push('opportunity_id IS NULL');
    const sort = SORTS[req.query.sort] || SORTS.rank;
    const page = Math.max(0, Number(req.query.page) || 0);
    const size = 100;
    const filter = where.join(' AND ');
    const [{ rows }, { rows: [tot] }, { rows: facets }] = await Promise.all([
      db.query(`SELECT *, ${OWNER_KEY_SQL} AS owner_key FROM energy_conventions WHERE ${filter} ORDER BY ${sort}, convention LIMIT ${size} OFFSET ${page * size}`, params),
      db.query(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT ${OWNER_KEY_SQL})::int AS owners, COALESCE(SUM(GREATEST(lost_per_year, 0)), 0)::float AS lost,
                       COUNT(*) FILTER (WHERE opportunity_id IS NOT NULL)::int AS in_pipeline FROM energy_conventions WHERE ${filter}`, params),
      db.query(`SELECT 'owner_type' AS f, owner_type AS v, COUNT(*)::int AS n FROM energy_conventions WHERE owner_type <> '' GROUP BY owner_type
                UNION ALL SELECT 'region', region, COUNT(*)::int FROM energy_conventions WHERE region <> '' GROUP BY region
                UNION ALL SELECT 'priority', priority, COUNT(*)::int FROM energy_conventions GROUP BY priority`),
    ]);
    const facet = f => facets.filter(x => x.f === f).sort((a, b) => b.n - a.n).map(x => [x.v, x.n]);
    res.json({
      conventions: rows, total: tot.n, owners: tot.owners, lost: tot.lost, inPipeline: tot.in_pipeline, page, pageSize: size,
      facets: { owner_type: facet('owner_type'), region: facet('region').sort((a, b) => a[0].localeCompare(b[0])),
        priority: facet('priority').sort((a, b) => PRIORITY_ORDER.indexOf(a[0]) - PRIORITY_ORDER.indexOf(b[0])) },
      signals: SIGNALS,
    });
  });

  // Stacca una convenzione dall'opportunità del proprietario in un'opportunità sua (es. un impianto da trattare a parte).
  // La nuova parte dallo stesso stadio, con le stesse aziende e persone collegate.
  app.post('/api/energy/conventions/:convention/stacca', async (req, res) => {
    const conv = String(req.params.convention).slice(0, 40);
    const out = await db.tx(async q => {
      const { rows: [c] } = await q.query('SELECT * FROM energy_conventions WHERE convention = $1', [conv]);
      if (!c) throw new HttpError(404, 'Convenzione non trovata');
      if (!c.opportunity_id) throw new HttpError(400, 'La convenzione non è in pipeline: portala prima in pipeline');
      const { rows: [parent] } = await q.query('SELECT * FROM energy_opportunities WHERE id = $1', [c.opportunity_id]);
      const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM energy_conventions WHERE opportunity_id = $1', [parent.id]);
      if (n < 2) throw new HttpError(400, 'È l\'unica convenzione dell\'opportunità: non c\'è niente da staccare');
      const stage = parent.stage === 'target' ? 'da_analizzare' : parent.stage;
      const { rows: [o] } = await q.query(
        `INSERT INTO energy_opportunities (kind, title, stage, province, region, company_id, source_key, owner_id, created_by, data)
         VALUES ('revamping', $1, $2, $3, $4, $5, $6, $7, $8, jsonb_build_object('staccata_da', $9::int)) RETURNING id`,
        [`${c.owner_name} – convenzione ${c.convention}`, stage, parent.province, parent.region, parent.company_id, `convenzione:${c.convention}`,
          parent.owner_id, req.user.id, parent.id]);
      await q.query('UPDATE energy_conventions SET opportunity_id = $1 WHERE convention = $2', [o.id, conv]);
      await q.query(
        `INSERT INTO energy_links (opportunity_id, company_id, person_id, role)
         SELECT $1, company_id, person_id, role FROM energy_links WHERE opportunity_id = $2 ON CONFLICT DO NOTHING`, [o.id, parent.id]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)',
        [o.id, stage, `Staccata da «${parent.title}»`, req.user.id]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $2, $3, $4)',
        [parent.id, parent.stage, `Staccata la convenzione ${conv}`, req.user.id]);
      // il titolo «(N convenzioni)» del proprietario segue il numero vero
      if (/\(\d+ convenzioni\)$/.test(parent.title)) {
        const title = n - 1 > 1 ? parent.title.replace(/\(\d+ convenzioni\)$/, `(${n - 1} convenzioni)`) : parent.title.replace(/ \(\d+ convenzioni\)$/, '');
        await q.query('UPDATE energy_opportunities SET title = $2 WHERE id = $1', [parent.id, title]);
      }
      await refreshRevamping(q, [parent.id, o.id]);
      return { id: o.id };
    });
    res.status(201).json(out);
  });

  // Porta in pipeline i proprietari scelti (owner_key delle righe del database).
  app.post('/api/energy/conventions/pipeline', async (req, res) => {
    const keys = req.body.owners;
    if (!Array.isArray(keys) || !keys.length || keys.length > 500) throw new HttpError(400, 'Scegli da 1 a 500 proprietari');
    const clean = [...new Set(keys.map(k => v.text(k, 'Proprietario', { max: 300 })).filter(Boolean))];
    const out = await db.tx(q => ownersToPipeline(q, clean, req.user.id));
    res.json(out);
  });

  // ── scadenze del FV classico (opzione sul terreno, STMG, integrazioni, validità del titolo) ───
  app.get('/api/energy/scadenze', async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);
    const { rows } = await db.query(
      `SELECT o.id, o.title, o.kind, o.stage, s->>'label' AS label, (s->>'date')::date AS date
         FROM energy_opportunities o, jsonb_array_elements(COALESCE(o.data->'scadenze', '[]'::jsonb)) s
        WHERE o.stage NOT IN ('perso', 'scartato', 'target') AND s->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$' AND NOT COALESCE((s->>'done')::boolean, false)
          AND (s->>'date')::date <= CURRENT_DATE + $1::int
        ORDER BY (s->>'date')::date`, [days]);
    res.json(rows);
  });

  // ── cruscotto (ALM2-18) ─────────────────────────────────────────────────────────────────────
  // Per tipo e per stadio: quante, MW, capex e valore pesato con la probabilità dello stadio (o quella scritta
  // sull'opportunità). Più IRR medio degli scenari scelti, opportunità ferme, step dei target in scadenza e ultimi cambi.
  const probabilityOf = o => {
    if (o.probability !== null && o.probability !== undefined) return o.probability;
    if (o.target_step) return STAGE_PROBABILITY.target[o.target_outcome || o.target_step] ?? 50;
    return STAGE_PROBABILITY[o.kind]?.[o.stage] ?? 0;
  };
  // fase dell'opportunità nel cruscotto: stadio della pipeline, step del target o esito
  const phaseOf = o => (o.target_step ? `target:${o.target_outcome || o.target_step}` : o.stage);

  async function dashboardData(days) {
    const { rows } = await db.query(
      `SELECT o.id, o.kind, o.title, o.stage, o.priority, o.mw, o.capex, o.probability, o.project_id, o.target_step, o.target_outcome,
              o.stage_changed_at, o.target_step_changed_at, o.city, o.province, o.region, c.name AS company_name, u.name AS owner_name,
              COALESCE((o.data->'scenario'->>'irr')::float, (o.data->'scenario'->>'irrC25')::float) AS irr
         FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id`);
    const closed = o => CLOSED_STAGES.includes(o.stage) || o.target_outcome === 'perso';
    const blank = () => ({ count: 0, mw: 0, capex: 0, mwWeighted: 0, capexWeighted: 0 });
    const addTo = (acc, o) => {
      const p = probabilityOf(o) / 100;
      acc.count++;
      acc.mw += Number(o.mw) || 0;
      acc.capex += Number(o.capex) || 0;
      acc.mwWeighted += (Number(o.mw) || 0) * p;
      acc.capexWeighted += (Number(o.capex) || 0) * p;
    };
    const kinds = Object.fromEntries(Object.keys(KINDS).map(k => [k, { ...blank(), phases: {} }]));
    const totals = blank();
    const irrs = [];
    for (const o of rows) {
      const k = kinds[o.kind];
      const ph = phaseOf(o);
      k.phases[ph] ??= blank();
      addTo(k.phases[ph], o);
      if (closed(o) || o.target_outcome === 'acquisito') continue; // aperte: niente perse né già acquisite
      addTo(k, o);
      addTo(totals, o);
      if (o.irr !== null && Number.isFinite(o.irr)) irrs.push(o.irr);
    }
    const targets = rows.filter(o => o.target_step);
    // ferme: oltre il primo stadio (gli import partono tutti dal primo) e senza cambi da più di `days` giorni
    const limit = Date.now() - days * 86400000;
    const stale = rows.filter(o => !o.target_step && !closed(o) && o.stage !== 'target' && stageKeys(o.kind).indexOf(o.stage) > 0
      && Date.parse(o.stage_changed_at) < limit)
      .sort((a, b) => Date.parse(a.stage_changed_at) - Date.parse(b.stage_changed_at));
    const [{ rows: dueSteps }, { rows: recent }] = await Promise.all([
      db.query(
        `SELECT t.id AS ticket_id, t.title, t.due_date::text AS due_date, t.status, o.id, o.title AS target_title, o.kind
           FROM tickets t JOIN projects p ON p.id = t.project_id AND p.energy JOIN energy_opportunities o ON o.project_id = p.id
          WHERE t.status <> 'done' AND t.title LIKE 'Step %' AND t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE + 14
            AND o.target_outcome IS NULL
          ORDER BY t.due_date LIMIT 20`),
      db.query(
        `SELECT h.opportunity_id AS id, o.title, o.kind, h.from_stage, h.to_stage, h.note, h.at, u.name AS user_name
           FROM energy_stage_history h JOIN energy_opportunities o ON o.id = h.opportunity_id LEFT JOIN users u ON u.id = h.user_id
          WHERE h.from_stage IS NOT NULL ORDER BY h.at DESC, h.id DESC LIMIT 15`),
    ]);
    return {
      totals,
      kinds,
      irr: { avg: irrs.length ? irrs.reduce((s, x) => s + x, 0) / irrs.length : null, count: irrs.length },
      targets: {
        active: targets.filter(o => !o.target_outcome).length,
        acquired: targets.filter(o => o.target_outcome === 'acquisito').length,
        lost: targets.filter(o => o.target_outcome === 'perso').length,
        mwActive: targets.filter(o => !o.target_outcome).reduce((s, o) => s + (Number(o.mw) || 0), 0),
      },
      stale: { days, count: stale.length, list: stale.slice(0, 15) },
      dueSteps,
      recent,
      probability: STAGE_PROBABILITY,
      rows,
    };
  }

  app.get('/api/energy/cruscotto', async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const { rows, ...data } = await dashboardData(days);
    res.json(data);
  });

  // Export in Excel: riepilogo per tipo e stadio, tutte le opportunità delle pipeline, gli Impianti target.
  app.get('/api/energy/cruscotto/excel', async (_req, res) => {
    const d = await dashboardData(30);
    const label = o => (o.target_step ? (o.target_outcome ? TARGET_OUTCOMES[o.target_outcome] : TARGET_STEPS.find(s => s.key === o.target_step)?.label)
      : STAGES[o.kind].find(([k]) => k === o.stage)?.[1] || o.stage);
    const r2 = x => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100);
    const summary = [['Tipo', 'Fase', 'Opportunità', 'MW', 'Capex (€)', 'MW pesati', 'Capex pesato (€)', 'Probabilità (%)']];
    for (const [kind, k] of Object.entries(d.kinds)) {
      const phases = [...STAGES[kind].filter(([s]) => s !== 'target').map(([s, l]) => [s, l]),
        ...TARGET_STEPS.map(s => [`target:${s.key}`, `Target · ${s.label}`]), ...Object.entries(TARGET_OUTCOMES).map(([s, l]) => [`target:${s}`, `Target · ${l}`])];
      for (const [key, l] of phases) {
        const p = k.phases[key];
        if (!p) continue;
        const prob = key.startsWith('target:') ? STAGE_PROBABILITY.target[key.slice(7)] : STAGE_PROBABILITY[kind][key] ?? 0;
        summary.push([KINDS[kind], l, p.count, r2(p.mw), r2(p.capex), r2(p.mwWeighted), r2(p.capexWeighted), prob]);
      }
    }
    const oppCols = ['Tipo', 'Opportunità', 'Fase', 'Priorità', 'Azienda', 'MW', 'Capex (€)', 'Probabilità (%)', 'IRR scenario scelto', 'Comune', 'Provincia', 'Regione', 'Responsabile', 'Ultimo cambio'];
    const oppRow = o => [KINDS[o.kind], o.title, label(o), o.priority, o.company_name || '', r2(o.mw), r2(o.capex), probabilityOf(o), r2(o.irr), o.city, o.province, o.region,
      o.owner_name || '', String(o.target_step_changed_at || o.stage_changed_at || '').slice(0, 10)];
    const file = writeXlsx({
      Riepilogo: summary,
      Pipeline: [oppCols, ...d.rows.filter(o => !o.target_step).map(oppRow)],
      'Impianti target': [oppCols, ...d.rows.filter(o => o.target_step).map(oppRow)],
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Alma Energy ${romeNow().day}.xlsx"`,
    }).send(file);
  });

  // ── Impianti target (ALM2-15 … ALM2-17) ─────────────────────────────────────────────────────
  // «Seleziona come target»: l'opportunità diventa un progetto di Alma Planet riservato alla BU Energy (tutti i membri del
  // modulo ne sono membri), con una riga del Gantt per ogni step dell'iter commerciale. L'opportunità resta la scheda
  // dell'impianto: aziende, persone, scenari e dati non si copiano, si ritrovano dal progetto.
  const STEP_KEYS = TARGET_STEPS.map(st => st.key);
  const stepTicketTitle = (i, st) => `Step ${i + 1} · ${st.label}`;

  async function energyMemberIds(q) {
    const { rows } = await q.query('SELECT u.id FROM energy_members m JOIN users u ON lower(u.email) = m.email');
    return rows.map(r => r.id);
  }

  app.post('/api/energy/opportunities/:id/target', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await opportunityById(id);
    if (o.target_step) throw new HttpError(400, 'È già un Impianto target');
    if (CLOSED_STAGES.includes(o.stage)) throw new HttpError(400, 'L\'opportunità è chiusa o in standby: riaprila prima di farne un target');
    if (o.kind === 'fv_classico' && o.stage !== 'rtb') throw new HttpError(400, 'Un progetto FV classico diventa target solo quando è RTB');
    const owner = o.owner_id || req.user.id;
    const projectId = await db.tx(async q => {
      const today = romeNow().day;
      // lo stesso progetto dell'opportunità (o nuovo, se era ancora al primo stadio)
      const pid = await ensureProject(q, o, req.user.id);
      await q.query("UPDATE projects SET description = CASE WHEN description LIKE 'Opportunità di Alma Energy%' THEN $2 ELSE description END, updated_at = now() WHERE id = $1",
        [pid, `Impianto target di Alma Energy (${KINDS[o.kind]}).`]);
      // una riga del Gantt per step, una dopo l'altra, al responsabile dell'impianto
      let start = today;
      const { rows: [{ pos }] } = await q.query('SELECT COALESCE(MAX(position), 0) AS pos FROM tickets');
      for (const [i, st] of TARGET_STEPS.entries()) {
        const due = addWorkdays(start, st.days - 1);
        const { rows: [t] } = await q.query(
          `INSERT INTO tickets (project_id, title, description, status, start_date, due_date, position, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [pid, stepTicketTitle(i, st), `Checklist nella scheda dell'impianto (Alma Energy).`, i === 0 ? 'doing' : 'todo', start, due, pos + i + 1, req.user.id]);
        await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, owner]);
        start = addWorkdays(due, 1);
      }
      await q.query(
        `UPDATE energy_opportunities SET project_id = $2, stage = 'target', target_step = $3, target_outcome = NULL, target_checklist = '{}',
                target_step_changed_at = now(), stage_changed_at = now(), updated_at = now() WHERE id = $1`, [id, pid, STEP_KEYS[0]]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
        [id, o.stage, 'target', 'Selezionata come Impianto target', req.user.id]);
      return pid;
    });
    res.status(201).json({ project_id: projectId });
  });

  async function targetById(id) {
    const o = await opportunityById(id);
    if (!o.target_step) throw new HttpError(400, 'Non è un Impianto target');
    return o;
  }
  // il ticket del Gantt di uno step: «Step N · …» nel progetto del target
  const stepTicket = (q, projectId, i) => q.query(
    'SELECT id FROM tickets WHERE project_id = $1 AND title = $2', [projectId, stepTicketTitle(i, TARGET_STEPS[i])]).then(r => r.rows[0]);

  // Spunta o toglie una voce della checklist di uno step.
  app.patch('/api/energy/opportunities/:id/target/checklist', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await targetById(id);
    const st = TARGET_STEPS.find(x => x.key === req.body.step);
    if (!st) throw new HttpError(400, 'Step non valido');
    const item = String(req.body.item || '');
    if (!checklistFor(st, o.kind).some(([k]) => k === item)) throw new HttpError(400, 'Voce della checklist non valida');
    const done = Boolean(req.body.done);
    const { rows: [u] } = await db.query(
      `UPDATE energy_opportunities SET target_checklist = jsonb_set(target_checklist, ARRAY[$2::text], COALESCE(target_checklist->$2, '{}'::jsonb) || jsonb_build_object($3::text, $4::boolean)),
              updated_at = now() WHERE id = $1 RETURNING target_checklist`, [id, st.key, item, done]);
    res.json(u.target_checklist);
  });

  // Passa allo step dopo (o a uno qualsiasi): serve la checklist dello step attuale completa, oppure un motivo per forzare.
  app.post('/api/energy/opportunities/:id/target/step', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await targetById(id);
    if (o.target_outcome) throw new HttpError(400, 'L\'iter è chiuso: riaprilo per cambiare step');
    const to = v.oneOf(req.body.step, 'Step', STEP_KEYS);
    if (!to) throw new HttpError(400, 'Scegli lo step');
    if (to === o.target_step) return res.json(o);
    const curIdx = STEP_KEYS.indexOf(o.target_step);
    const toIdx = STEP_KEYS.indexOf(to);
    const reason = v.text(req.body.reason, 'Motivo', { max: 500 }) || '';
    if (toIdx > curIdx) {
      const missing = checklistFor(TARGET_STEPS[curIdx], o.kind).filter(([k]) => !o.target_checklist?.[o.target_step]?.[k]);
      if (missing.length && !reason) throw new HttpError(400, `Checklist incompleta: ${missing.map(([, l]) => l).join(', ')}. Completala o scrivi il motivo per andare avanti.`, 'checklist');
    }
    await db.tx(async q => {
      await q.query('UPDATE energy_opportunities SET target_step = $2, target_step_changed_at = now(), updated_at = now() WHERE id = $1', [id, to]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
        [id, `step:${o.target_step}`, `step:${to}`, reason ? `Forzato: ${reason}` : '', req.user.id]);
      // Gantt: gli step passati sono fatti, quello attuale in corso, i successivi da fare
      for (let i = 0; i < STEP_KEYS.length; i++) {
        const t = await stepTicket(q, o.project_id, i);
        if (t) await q.query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [t.id, i < toIdx ? 'done' : i === toIdx ? 'doing' : 'todo']);
      }
    });
    res.json(await opportunityById(id));
  });

  // Esito dell'iter: acquisito (closing) o perso; «riapri» lo toglie.
  app.post('/api/energy/opportunities/:id/target/esito', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = await targetById(id);
    const outcome = req.body.outcome === null || req.body.outcome === '' ? null : v.oneOf(req.body.outcome, 'Esito', Object.keys(TARGET_OUTCOMES));
    const note = v.text(req.body.note, 'Nota', { max: 500 }) || '';
    if (outcome === 'perso' && !note) throw new HttpError(400, 'Scrivi il motivo');
    await db.tx(async q => {
      await q.query('UPDATE energy_opportunities SET target_outcome = $2, updated_at = now() WHERE id = $1', [id, outcome]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
        [id, `step:${o.target_step}`, outcome ? `esito:${outcome}` : 'esito:riaperto', note, req.user.id]);
      // acquisito: tutti gli step fatti e progetto concluso; perso: progetto concluso; riaperto: progetto di nuovo attivo
      if (outcome === 'acquisito') await q.query("UPDATE tickets SET status = 'done', updated_at = now() WHERE project_id = $1 AND title LIKE 'Step %'", [o.project_id]);
      await q.query('UPDATE projects SET status = $2, updated_at = now() WHERE id = $1', [o.project_id, outcome ? 'done' : 'active']);
    });
    res.json(await opportunityById(id));
  });

  // Kanban degli Impianti target: colonne per step, più le colonne degli esiti.
  app.get('/api/energy/targets', async (req, res) => {
    const params = [];
    const where = ['o.target_step IS NOT NULL'];
    if (req.query.kind) { params.push(kindOf(String(req.query.kind))); where.push(`o.kind = $${params.length}`); }
    if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where.push(`(o.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
    const { rows } = await db.query(
      `SELECT o.id, o.kind, o.title, o.priority, o.mw, o.capex, o.city, o.province, o.project_id, o.target_step, o.target_outcome,
              o.target_checklist, o.target_step_changed_at, c.name AS company_name, u.name AS owner_name,
              (o.data->'scenario'->>'irr')::float AS irr
         FROM energy_opportunities o LEFT JOIN energy_companies c ON c.id = o.company_id LEFT JOIN users u ON u.id = o.owner_id
        WHERE ${where.join(' AND ')} ORDER BY o.target_step_changed_at DESC NULLS LAST`, params);
    const withProgress = rows.map(r => {
      const st = TARGET_STEPS.find(x => x.key === r.target_step);
      const items = st ? checklistFor(st, r.kind) : [];
      return { ...r, checklist_done: items.filter(([k]) => r.target_checklist?.[r.target_step]?.[k]).length, checklist_total: items.length, target_checklist: undefined };
    });
    const col = (key, label, list) => ({ key, label, count: list.length, mw: list.reduce((s, x) => s + (Number(x.mw) || 0), 0), cards: list });
    res.json({
      columns: [
        ...TARGET_STEPS.map(st => col(st.key, st.label, withProgress.filter(x => !x.target_outcome && x.target_step === st.key))),
        ...Object.entries(TARGET_OUTCOMES).map(([k, label]) => col(k, label, withProgress.filter(x => x.target_outcome === k))),
      ],
    });
  });

  // Target di un progetto, per il tab «Impianto» della scheda progetto.
  app.get('/api/energy/projects/:projectId/target', async (req, res) => {
    const pid = v.int(req.params.projectId, 'id', { min: 1 });
    const { rows: [r] } = await db.query('SELECT id FROM energy_opportunities WHERE project_id = $1', [pid]);
    if (!r) throw new HttpError(404, 'Il progetto non è un Impianto target');
    res.json(await targetDetail(r.id));
  });
  app.get('/api/energy/opportunities/:id/target', async (req, res) => {
    res.json(await targetDetail(v.int(req.params.id, 'id', { min: 1 })));
  });

  // Iter del target: step con checklist, stato e storico degli step.
  async function targetDetail(id) {
    const o = await targetById(id);
    const { rows: history } = await db.query(
      `SELECT h.from_stage, h.to_stage, h.note, h.at, u.name AS user_name FROM energy_stage_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.opportunity_id = $1 AND (h.to_stage LIKE 'step:%' OR h.to_stage LIKE 'esito:%' OR h.to_stage = 'target') ORDER BY h.at DESC, h.id DESC`, [id]);
    const curIdx = STEP_KEYS.indexOf(o.target_step);
    return {
      id: o.id, title: o.title, kind: o.kind, project_id: o.project_id, target_step: o.target_step, target_outcome: o.target_outcome,
      company_name: o.company_name, owner_name: o.owner_name, mw: o.mw, capex: o.capex, scenario: o.data?.scenario || null,
      steps: TARGET_STEPS.map((st, i) => ({
        key: st.key, label: st.label,
        state: o.target_outcome === 'acquisito' || i < curIdx ? 'fatto' : i === curIdx ? (o.target_outcome ? 'chiuso' : 'attuale') : 'dopo',
        checklist: checklistFor(st, o.kind).map(([k, label]) => ({ key: k, label, done: Boolean(o.target_checklist?.[st.key]?.[k]) })),
      })),
      history,
    };
  }

  // ── simulatore: calcolo senza salvare ─────────────────────────────────────────────────────────
  app.get('/api/energy/simulate/defaults', (_req, res) => res.json({
    defaults: DEFAULTS, priceCurve: PRICE_CURVE, fv: FV_DEFAULTS, revamping: REVAMPING_DEFAULTS, ppa: PPA_DEFAULTS,
  }));

  app.post('/api/energy/simulate', (req, res) => {
    const model = v.oneOf(req.body.model, 'Modello', ['cashflows', 'brs', 'portfolio']);
    const clean = cleanInput(req.body.input);
    if (model === 'brs') return res.json(buyRevampSell(clean));
    if (model === 'portfolio') return res.json(portfolioYear(clean));
    if (!(clean.sizeMw > 0)) throw new HttpError(400, 'Indica la taglia dell\'impianto in MW');
    const out = cashflows(clean);
    res.json({ ...out, sensitivity: req.body.sensitivity ? sensitivity(clean) : undefined });
  });

  // ── scenari: FV classico, revamping, PPA on-site (ALM2-6 … ALM2-9) ───────────────────────────
  const MODELS = ['fv_classico', 'revamping', 'ppa_onsite'];
  const calc = (model, input) => runScenario(v.oneOf(model, 'Scenario', MODELS) || (() => { throw new HttpError(400, 'Scegli lo scenario'); })(), cleanInput(input));

  // calcolo senza salvare (la pagina del simulatore ricalcola a ogni modifica)
  app.post('/api/energy/scenarios/calcola', (req, res) => {
    res.json(calc(req.body.model, req.body.input));
  });

  app.get('/api/energy/scenarios', async (req, res) => {
    const params = [];
    let where = 'TRUE';
    if (req.query.opportunity === 'bozze') where = 's.opportunity_id IS NULL';
    else if (req.query.opportunity) { params.push(Number(req.query.opportunity) || 0); where = 's.opportunity_id = $1'; }
    const { rows } = await db.query(
      `SELECT s.id, s.opportunity_id, o.title AS opportunity_title, s.name, s.model, s.summary, s.chosen, s.updated_at, u.name AS created_by_name
         FROM energy_scenarios s LEFT JOIN energy_opportunities o ON o.id = s.opportunity_id LEFT JOIN users u ON u.id = s.created_by
        WHERE ${where} ORDER BY s.chosen DESC, s.updated_at DESC LIMIT 200`, params);
    res.json(rows);
  });

  async function scenarioById(id) {
    const { rows: [s] } = await db.query('SELECT * FROM energy_scenarios WHERE id = $1', [id]);
    if (!s) throw new HttpError(404, 'Scenario non trovato');
    return s;
  }

  app.post('/api/energy/scenarios', async (req, res) => {
    const name = v.text(req.body.name, 'Nome', { max: 120, required: true });
    const oppId = v.int(req.body.opportunity_id, 'Opportunità', { min: 1, nullable: true }) ?? null;
    if (oppId) await opportunityById(oppId);
    const input = cleanInput(req.body.input);
    const result = calc(req.body.model, input);
    const { rows: [s] } = await db.query(
      `INSERT INTO energy_scenarios (opportunity_id, name, model, input, summary, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [oppId, name, req.body.model, JSON.stringify(input), JSON.stringify(summaryOf(result)), req.user.id]);
    res.status(201).json(s);
  });

  app.get('/api/energy/scenarios/:id', async (req, res) => {
    const s = await scenarioById(v.int(req.params.id, 'id', { min: 1 }));
    res.json({ ...s, result: runScenario(s.model, s.input) });
  });

  app.patch('/api/energy/scenarios/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await scenarioById(id);
    const name = v.text(req.body.name, 'Nome', { max: 120 }) || cur.name;
    const input = req.body.input === undefined ? cur.input : cleanInput(req.body.input);
    const summary = summaryOf(runScenario(cur.model, input));
    const { rows: [s] } = await db.query(
      'UPDATE energy_scenarios SET name = $2, input = $3, summary = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [id, name, JSON.stringify(input), JSON.stringify(summary)]);
    if (s.chosen && s.opportunity_id) await applyChosen(db, s);
    res.json(s);
  });

  // Lo scenario scelto porta i suoi numeri sull'opportunità (MW, capex, rendimento).
  async function applyChosen(q, s) {
    const sum = s.summary || {};
    await q.query(
      `UPDATE energy_opportunities SET mw = COALESCE($2, mw), capex = COALESCE($3, capex), data = data || $4::jsonb, updated_at = now() WHERE id = $1`,
      [s.opportunity_id, sum.mw ?? null, sum.capex === undefined || sum.capex === null ? null : Math.round(sum.capex),
        JSON.stringify({ scenario: { id: s.id, name: s.name, model: s.model, ...sum } })]);
  }

  app.post('/api/energy/scenarios/:id/scegli', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await scenarioById(id);
    if (!s.opportunity_id) throw new HttpError(400, 'Collega prima lo scenario a un\'opportunità');
    await db.tx(async q => {
      await q.query('UPDATE energy_scenarios SET chosen = false WHERE opportunity_id = $1 AND chosen', [s.opportunity_id]);
      await q.query('UPDATE energy_scenarios SET chosen = true WHERE id = $1', [id]);
      await applyChosen(q, s);
    });
    res.json({ ok: true });
  });

  app.delete('/api/energy/scenarios/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await scenarioById(id);
    await db.tx(async q => {
      await q.query('DELETE FROM energy_scenarios WHERE id = $1', [id]);
      if (s.chosen && s.opportunity_id) await q.query("UPDATE energy_opportunities SET data = data - 'scenario' WHERE id = $1", [s.opportunity_id]);
    });
    res.json({ ok: true });
  });

  // Export in Excel: dello scenario salvato, o di quello sullo schermo (POST con modello e ipotesi).
  const sendXlsx = (res, name, model, input) => {
    const file = writeXlsx(scenarioSheets(name, runScenario(model, input)));
    const safe = name.replace(/[^\w\- àèéìòù]/gi, '').trim().slice(0, 60) || 'scenario';
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safe}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${safe}.xlsx`)}`,
    }).send(file);
  };
  app.get('/api/energy/scenarios/:id/excel', async (req, res) => {
    const s = await scenarioById(v.int(req.params.id, 'id', { min: 1 }));
    sendXlsx(res, s.name, s.model, s.input);
  });
  app.post('/api/energy/scenarios/excel', (req, res) => {
    v.oneOf(req.body.model, 'Scenario', MODELS);
    sendXlsx(res, v.text(req.body.name, 'Nome', { max: 120 }) || 'Scenario', req.body.model, cleanInput(req.body.input));
  });
}

// Ipotesi dal browser: solo numeri finiti, più l'elenco dei capex e la curva dei prezzi. Niente funzioni né oggetti strani.
function cleanInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Le ipotesi non sono valide');
  const clean = {};
  for (const [k, val] of Object.entries(input)) {
    if (!/^[a-zA-Z][\w]{0,40}$/.test(k)) throw new HttpError(400, 'Le ipotesi non sono valide');
    if (k === 'capex') {
      if (!val || typeof val !== 'object') throw new HttpError(400, 'Il capex non è valido');
      clean.capex = Object.fromEntries(Object.entries(val).map(([name, x]) => [String(name).slice(0, 40), num(x, `capex ${name}`, { min: 0 }) || 0]));
    } else if (k === 'prices') {
      if (!Array.isArray(val) || !val.length || val.length > 60) throw new HttpError(400, 'La curva dei prezzi non è valida');
      clean.prices = val.map((x, i) => num(x, `prezzo anno ${i + 1}`, { min: 0, max: 10000 }));
    } else {
      const n = num(val, k);
      if (n !== null && n !== undefined) clean[k] = n;
    }
  }
  if (clean.years !== undefined && (clean.years < 1 || clean.years > 50)) throw new HttpError(400, 'Gli anni vanno da 1 a 50');
  return clean;
}

// Fogli dell'Excel di uno scenario: ipotesi, risultati e flussi anno per anno.
const FLOW_COLS = [['year', 'Anno'], ['energy', 'Energia (MWh)'], ['revenue', 'Ricavi energia'], ['extraRevenue', 'Altri ricavi'], ['opex', 'OPEX'],
  ['ebitda', 'EBITDA'], ['depreciation', 'Ammortamenti'], ['interest', 'Interessi'], ['taxes', 'Imposte'], ['netIncome', 'Utile netto'],
  ['capex', 'Capex'], ['debtRepaid', 'Rimborso debito'], ['fcfUnlevered', 'FCF unlevered'], ['fcfLevered', 'FCF levered']];
const KPI_LABELS = [['capex', 'Capex (€)'], ['debt', 'Debito (€)'], ['equity', 'Equity (€)'], ['wacc', 'WACC'], ['irrUnlevered', 'IRR di progetto'],
  ['irrLevered', 'IRR dell\'equity'], ['npvUnlevered', 'VAN al WACC (€)'], ['npvLevered', 'VAN dell\'equity (€)'], ['paybackUnlevered', 'Payback (anni)'],
  ['dscrMin', 'DSCR minimo'], ['dscrAvg', 'DSCR medio'], ['lcoe', 'LCOE (€/MWh)'], ['roe', 'ROE primo anno']];
const r2 = x => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);
const flowSheet = rows => [FLOW_COLS.map(([, l]) => l), ...rows.map(r => FLOW_COLS.map(([k]) => r2(r[k])))];
const kpiRows = kpi => KPI_LABELS.filter(([k]) => kpi[k] !== undefined && kpi[k] !== null).map(([k, l]) => [l, r2(kpi[k])]);

function scenarioSheets(name, result) {
  const inputs = [['Ipotesi', 'Valore'], ...Object.entries(result.inputs || {})
    .filter(([, val]) => typeof val === 'number').map(([k, val]) => [k, val])];
  if (result.model === 'fv_classico') {
    const cols = [['year', 'Anno'], ['projects', 'Progetti'], ['mwp', 'MWp sviluppati'], ['rtb', 'MWp a RTB'], ['built', 'MWp costruiti'],
      ['outflow', 'Esborsi Almacis'], ['revenue', 'Ricavi Almacis'], ['net', 'Risultato']];
    const sheets = { Riepilogo: [[name, 'A Solo sviluppo', 'B Costruisci e vendi', 'C Costruisci e gestisci'],
      ...[['outflow', 'Esborsi Almacis (€)'], ['revenue', 'Ricavi Almacis (€)'], ['net', 'Risultato netto (€)'], ['roi', 'ROI'], ['atRisk', 'Capitale a rischio (€)']]
        .map(([k, l]) => [l, ...['A', 'B', 'C'].map(x => r2(result.variants[x].totals[k]))]),
      ['IRR a 25 anni degli impianti tenuti (C)', '', '', r2(result.variants.C.longTerm.irr)]], Ipotesi: inputs };
    for (const x of ['A', 'B', 'C']) sheets[`Variante ${x}`] = [cols.map(([, l]) => l), ...result.variants[x].years.map(y => cols.map(([k]) => r2(y[k])))];
    return sheets;
  }
  if (result.model === 'revamping') {
    return {
      Riepilogo: [[name, 'Valore'], ['Taglia dopo il repowering (MW)', result.sizeAfter],
        ['Rivendita: utile del ciclo (€)', r2(result.rivendita.kpi.netIncome)], ['Rivendita: ROE del ciclo', r2(result.rivendita.kpi.roe)],
        ['Rivendita: margine per MW (€)', r2(result.rivendita.kpi.marginPerMw)], ...kpiRows(result.gestione.kpi).map(([l, x]) => [`Gestione: ${l}`, x]),
        ['Conviene', result.confronto.meglio]],
      Ipotesi: inputs, 'Flussi gestione': flowSheet(result.gestione.rows),
    };
  }
  return {
    Riepilogo: [[name, 'Valore'], ['Potenza (kWp)', r2(result.plant.kwp)], ['Produzione primo anno (MWh)', r2(result.plant.energy1)],
      ['Risparmio del cliente, primo anno (€)', r2(result.customer.saving1)], ['Risparmio del cliente, contratto (€)', r2(result.customer.savingTotal)],
      ...kpiRows(result.flows.kpi)],
    Ipotesi: inputs, Flussi: flowSheet(result.flows.rows),
  };
}

module.exports = { registerEnergy };
