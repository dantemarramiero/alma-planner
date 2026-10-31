// Alma Energy: modulo della BU Energy (business IPP). Membri del modulo, CRM (aziende e persone), opportunità delle
// tre pipeline con lo storico degli stadi, collegamenti con un ruolo e simulatore dei rendimenti.
// Tutto riservato ai membri del modulo (per ora Dante e Tullio): gli altri ricevono 403.
const { HttpError, v } = require('../lib/http');
const {
  STAGES, KINDS, COMPANY_TYPES, LINK_ROLES, RELATIONS, COMPANY_STATUS, INFLUENCE, CHANNELS, stageKeys,
} = require('../lib/energy');
const { cashflows, buyRevampSell, portfolioYear, sensitivity, DEFAULTS, PRICE_CURVE } = require('../lib/energy-sim');

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
        companyStatus: COMPANY_STATUS, influence: INFLUENCE, channels: CHANNELS },
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
    res.json({ ...o, links, history });
  });

  app.patch('/api/energy/opportunities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    const f = opportunityFields(req.body, { partial: true });
    delete f.kind;
    if (f.data) f.data = { ...cur.data, ...f.data };
    if (!Object.keys(f).length) return res.json(cur);
    const { rows: [o] } = await db.query(updateSql('energy_opportunities', f), [id, ...vals(f)]);
    res.json(o);
  });

  // Cambio di stadio: resta nello storico. «perso» chiede il motivo; «target» passa da «Seleziona come target».
  app.post('/api/energy/opportunities/:id/stage', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    const stage = v.oneOf(req.body.stage, 'Stadio', stageKeys(cur.kind));
    if (!stage) throw new HttpError(400, 'Scegli lo stadio');
    if (stage === 'target') throw new HttpError(400, 'Un\'opportunità diventa Impianto target con «Seleziona come target»');
    if (cur.stage === 'target') throw new HttpError(400, 'L\'opportunità è già un Impianto target: si segue dal progetto');
    const note = v.text(req.body.note, 'Nota', { max: 1000 }) || '';
    const lostReason = stage === 'perso' ? v.text(req.body.lost_reason, 'Motivo', { max: 300, required: true }) : '';
    if (stage === cur.stage) return res.json(cur);
    const opp = await db.tx(async q => {
      const { rows: [o] } = await q.query(
        `UPDATE energy_opportunities SET stage = $2, lost_reason = $3, stage_changed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, stage, lostReason]);
      await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)',
        [id, cur.stage, stage, stage === 'perso' ? [lostReason, note].filter(Boolean).join(' · ') : note, req.user.id]);
      return o;
    });
    res.json(opp);
  });

  app.delete('/api/energy/opportunities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await opportunityById(id);
    if (cur.project_id) throw new HttpError(400, 'L\'opportunità è già un Impianto target: archivia il progetto invece di cancellarla');
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

  // ── simulatore: calcolo senza salvare (gli scenari salvati arrivano con ALM2-9) ───────────────
  app.get('/api/energy/simulate/defaults', (_req, res) => res.json({ defaults: DEFAULTS, priceCurve: PRICE_CURVE }));

  app.post('/api/energy/simulate', (req, res) => {
    const model = v.oneOf(req.body.model, 'Modello', ['cashflows', 'brs', 'portfolio']);
    const input = req.body.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Le ipotesi non sono valide');
    // solo numeri finiti (e l'elenco dei capex e dei prezzi): niente funzioni né oggetti strani dal browser
    const clean = {};
    for (const [k, val] of Object.entries(input)) {
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
    if (model === 'brs') return res.json(buyRevampSell(clean));
    if (model === 'portfolio') return res.json(portfolioYear(clean));
    if (!(clean.sizeMw > 0)) throw new HttpError(400, 'Indica la taglia dell\'impianto in MW');
    const out = cashflows(clean);
    res.json({ ...out, sensitivity: req.body.sensitivity ? sensitivity(clean) : undefined });
  });
}

module.exports = { registerEnergy };
