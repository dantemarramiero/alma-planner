// CRM di Alma Planet: soggetti (Lead, Clienti, Fornitori, Partner, Concorrenti), contatti, attività, ASA.
// Regole (canvas del 12/11/2026):
// - un soggetto è una sola scheda con più ruoli; P.IVA e codice fiscale non si ripetono;
// - ogni soggetto ha una o più ASA: chi è di un'ASA vede solo i soggetti della sua, la direzione tutti;
// - un lead diventa cliente da solo alla prima commessa in BOSS (POST …/prima-commessa, che chiamerà BOSS), non a mano;
// - le opportunità restano in BOSS; le qualifiche dei fornitori in Vittoria (collegamento come secondo passo).
const { HttpError, v } = require('../lib/http');
const {
  ROLES, KINDS, STATUS, LEAD_STAGES, PRIORITIES, ORIGINS, LOST_REASONS, SEGMENTS, SUPPLIER_CATEGORIES, NOTE_KINDS,
  SOA_CATEGORIES, SOA_CLASSES, LEGAL_FORMS, TITLES, CONTACT_JOBS, LANGUAGES, SUPPLIER_SUBCATEGORIES, CONTACT_STATUS, LEGAL_BASIS, vatOk, taxCodeOk,
} = require('../lib/crm');
const { REGIONS, PROVINCES } = require('../lib/energy-places');
const { registerCrmLinks } = require('./crm-links');
const { registerCrmImport } = require('./crm-import');
const { loadFunctions } = require('../lib/functions');
const SUBCATS = [...new Set(Object.values(SUPPLIER_SUBCATEGORIES).flat())];
const SOA_CATS = SOA_CATEGORIES.map(([k]) => k);
const SOA_CLS = SOA_CLASSES.map(([k]) => k);
// vuoto oppure uno dell'elenco
const pickOrEmpty = (value, field, allowed) => (value === '' ? '' : v.oneOf(value, field, allowed));
// SOA: [{ cat, cls, expires }]
function soaList(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 40) throw new HttpError(400, 'Le categorie SOA non sono valide');
  const seen = new Set();
  return value.map(x => ({ cat: v.oneOf(x?.cat, 'Categoria SOA', SOA_CATS), cls: v.oneOf(x?.cls, 'Classifica SOA', SOA_CLS), expires: v.date(x?.expires || null, 'Scadenza SOA') }))
    .filter(x => (seen.has(x.cat) ? false : seen.add(x.cat)));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));
const duplicate = err => err?.code === '23505';
const STAGE_KEYS = LEAD_STAGES.map(([k]) => k);
// adesso in ora italiana, come gli orari degli incontri copiati da Outlook
const nowRome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);

function num(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  // «1.200.000», «1.200.000,50», «1200000.00», «1200000,5»: il punto è delle migliaia solo se c'è la virgola
  // o se separa gruppi di tre cifre
  let t = typeof value === 'number' ? String(value) : String(value).replace(/\s|€/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return n;
}
const list = (value, field, allowed) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `Il campo «${field}» non è valido`);
  const out = [...new Set(value.map(x => v.text(x, field, { max: 60 })).filter(Boolean))];
  for (const x of out) if (allowed && !allowed.includes(x)) throw new HttpError(400, `Il valore «${x}» di «${field}» non è valido`);
  return out;
};
const email = (value, field) => {
  const s = v.text(value, field, { max: 200 });
  if (s && !EMAIL_RE.test(s)) throw new HttpError(400, `L'email «${field}» non è valida`);
  return s === undefined ? undefined : s.toLowerCase();
};
const vatClean = value => {
  const s = v.text(value, 'P.IVA', { max: 20 });
  if (s === undefined) return undefined;
  const out = s.replace(/[\s.-]/g, '').toUpperCase().replace(/^IT(?=\d{11}$)/, '');
  if (out && !vatOk(out)) throw new HttpError(400, 'La P.IVA non è valida: controlla le cifre');
  return out;
};
const taxClean = value => {
  const s = v.text(value, 'Codice fiscale', { max: 20 });
  if (s === undefined) return undefined;
  const out = s.replace(/\s/g, '').toUpperCase();
  if (out && !taxCodeOk(out)) throw new HttpError(400, 'Il codice fiscale non è valido');
  return out;
};

const cols = f => Object.keys(f);
const insertSql = (table, f) => `INSERT INTO ${table} (${cols(f).join(', ')}) VALUES (${cols(f).map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`;
const vals = f => Object.entries(f).map(([k, val]) => (k === 'soa' ? JSON.stringify(val) : val));
const updateSql = (table, f) => `UPDATE ${table} SET ${cols(f).map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`;

function subjectFields(b, { partial, asaKeys }) {
  return pick({
    name: v.text(b.name, 'Ragione sociale', { max: 200, required: !partial }),
    short_name: v.text(b.short_name, 'Nome breve', { max: 60 }),
    kind: v.oneOf(b.kind, 'Tipo di soggetto', Object.keys(KINDS)),
    legal_form: pickOrEmpty(b.legal_form, 'Forma giuridica', LEGAL_FORMS),
    vat: vatClean(b.vat),
    tax_code: taxClean(b.tax_code),
    ipa_code: v.text(b.ipa_code, 'Codice IPA', { max: 20 }),
    sdi_code: v.text(b.sdi_code, 'Codice SDI', { max: 10 }),
    pec: email(b.pec, 'PEC'),
    email: email(b.email, 'Email'),
    phone: v.text(b.phone, 'Telefono', { max: 40 }),
    website: v.text(b.website, 'Sito web', { max: 200 }),
    address: v.text(b.address, 'Indirizzo', { max: 200 }),
    city: v.text(b.city, 'Comune', { max: 100 }),
    province: pickOrEmpty(b.province, 'Provincia', [...PROVINCES.keys()]),
    region: pickOrEmpty(b.region, 'Regione', REGIONS.map(r => r.name)),
    ateco: v.text(b.ateco, 'ATECO', { max: 20 }),
    group_id: v.int(b.group_id, 'Gruppo', { min: 1, nullable: true }),
    roles: list(b.roles, 'Ruoli', Object.keys(ROLES)),
    asa: list(b.asa, 'ASA', asaKeys),
    owner_id: v.int(b.owner_id, 'Owner', { min: 1, nullable: true }),
    function_name: v.text(b.function_name, 'Funzione di riferimento', { max: 120 }),
    status: v.oneOf(b.status, 'Stato', Object.keys(STATUS)),
    block_reason: v.text(b.block_reason, 'Motivo del blocco', { max: 300 }),
    segment: v.text(b.segment, 'Segmento', { max: 60 }),
    lead_why: v.text(b.lead_why, 'Perché ci interessa', { max: 1000 }),
    potential_value: num(b.potential_value, 'Valore potenziale'),
    priority: b.priority === '' ? '' : v.oneOf(b.priority, 'Priorità', Object.keys(PRIORITIES)),
    origin: v.text(b.origin, 'Origine', { max: 60 }),
    referred_by: v.text(b.referred_by, 'Segnalato da', { max: 120 }),
    next_step: v.text(b.next_step, 'Prossimo passo', { max: 300 }),
    next_step_date: v.date(b.next_step_date, 'Data del prossimo passo'),
    supplier_categories: list(b.supplier_categories, 'Categorie del fornitore', Object.keys(SUPPLIER_CATEGORIES)),
    supplier_subcategories: list(b.supplier_subcategories, 'Sottocategorie', SUBCATS),
    supplier_zones: list(b.supplier_zones, 'Zone servite', [...PROVINCES.keys()]),
    soa: soaList(b.soa),
    boss_code: v.text(b.boss_code, 'Codice BOSS', { max: 40 }),
    accounting_code: v.text(b.accounting_code, 'Codice contabile', { max: 40 }),
    zoho_id: v.text(b.zoho_id, 'Codice Zoho', { max: 40 }),
    vittoria_id: v.text(b.vittoria_id, 'Codice Vittoria', { max: 40 }),
    notes: v.text(b.notes, 'Note', { max: 5000 }),
  });
}

function contactFields(b, { partial }) {
  return pick({
    title: pickOrEmpty(b.title, 'Titolo', TITLES),
    first_name: v.text(b.first_name, 'Nome', { max: 120 }),
    last_name: v.text(b.last_name, 'Cognome', { max: 120, required: !partial }),
    email: email(b.email, 'Email'),
    mobile: v.text(b.mobile, 'Cellulare', { max: 40 }),
    phone: v.text(b.phone, 'Telefono', { max: 40 }),
    linkedin: v.text(b.linkedin, 'LinkedIn', { max: 200 }),
    language: pickOrEmpty(b.language, 'Lingua', LANGUAGES),
    owner_id: v.int(b.owner_id, 'Responsabile', { min: 1, nullable: true }),
    status: v.oneOf(b.status, 'Stato', Object.keys(CONTACT_STATUS)),
    legal_basis: v.oneOf(b.legal_basis, 'Base giuridica', Object.keys(LEGAL_BASIS)),
    newsletter: b.newsletter === undefined ? undefined : Boolean(b.newsletter),
    notes: v.text(b.notes, 'Note', { max: 5000 }),
  });
}

function registerCrm(app, { db, auth, notifier, crmAccess, crmSync }) {
  app.use('/api/crm', (req, _res, next) => {
    crmAccess.canUse(req).then(ok => next(ok ? undefined : new HttpError(403, 'Il CRM è per la direzione e per chi è assegnato a un\'ASA')), next);
  });
  const functionNames = async () => (await loadFunctions(db)).map(f => f.name).sort((a, b) => a.localeCompare(b, 'it'));
  async function checkOwnerFunction(f, { creating }) {
    if (creating && !f.owner_id) throw new HttpError(400, 'Scegli l\'owner dell\'anagrafica');
    if (f.owner_id === null) throw new HttpError(400, 'L\'owner è obbligatorio');
    if (f.owner_id) { const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1', [f.owner_id]); if (!rowCount) throw new HttpError(400, 'Owner non trovato'); }
    if (f.function_name) { const names = await functionNames(); if (names.length && !names.includes(f.function_name)) throw new HttpError(400, 'La funzione di riferimento non è tra i reparti dell\'organigramma'); }
  }
  const allAsa = async () => (await db.query('SELECT key, label, boss_label, sort FROM crm_asa ORDER BY sort, label')).rows;

  // Filtro di visibilità sui soggetti (alias s): amministratori tutto, gli altri le loro ASA. Restituisce [sql, params].
  const seeSql = (req, alias, params) => {
    if (req.crm.admin) return 'TRUE';
    params.push(req.crm.asas);
    return `${alias}.asa && $${params.length}::text[]`;
  };
  async function subjectById(req, id, { forWrite = false } = {}) {
    const { rows: [s] } = await db.query(
      `SELECT s.*, u.name AS owner_name, g.name AS group_name, m.name AS merged_name FROM crm_subjects s
         LEFT JOIN users u ON u.id = s.owner_id LEFT JOIN crm_subjects g ON g.id = s.group_id
         LEFT JOIN crm_subjects m ON m.id = s.merged_into WHERE s.id = $1`, [id]);
    if (!s || !(req.crm.admin || s.asa.some(a => req.crm.asas.includes(a)))) throw new HttpError(404, 'Anagrafica non trovata');
    if (forWrite && s.merged_into) throw new HttpError(409, `Questa scheda è stata unita a «${s.merged_name}»`);
    return s;
  }
  // un non amministratore deve tenere almeno una delle sue ASA, sennò perderebbe la scheda
  function checkAsa(req, asa) {
    if (!asa.length) throw new HttpError(400, 'Scegli almeno un\'ASA');
    if (!req.crm.admin && !asa.some(a => req.crm.asas.includes(a))) throw new HttpError(400, 'Tra le ASA ci deve essere almeno una delle tue');
  }
  function checkRoles(req, roles, before = []) {
    if (!roles.length) throw new HttpError(400, 'Scegli almeno un ruolo');
    if (roles.includes('lead') && roles.includes('cliente')) throw new HttpError(400, 'Un soggetto è Lead oppure Cliente, non tutti e due');
    // Lead → Cliente succede da solo alla prima commessa in BOSS (decisione del 12/11)
    if (!req.crm.admin && before.includes('lead') && roles.includes('cliente')) {
      throw new HttpError(400, 'Un lead diventa cliente da solo alla prima commessa in BOSS');
    }
  }
  const history = (subjectId, from, to, note, userId) => db.query(
    'INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, $2, $3, $4, $5)', [subjectId, from, to, note || '', userId]);

  // ── pagina: elenchi e numeri ───────────────────────────────────────────────────────────────
  app.get('/api/crm', async (req, res) => {
    const params = [];
    const see = seeSql(req, 's', params);
    const [asa, { rows: counts }, { rows: stages }, functions] = await Promise.all([
      allAsa(),
      db.query(`SELECT r AS role, COUNT(*)::int AS n FROM crm_subjects s, unnest(s.roles) r WHERE s.merged_into IS NULL AND ${see} GROUP BY r`, params),
      db.query(`SELECT s.lead_stage AS stage, COUNT(*)::int AS n FROM crm_subjects s WHERE s.merged_into IS NULL AND 'lead' = ANY(s.roles) AND ${see} GROUP BY s.lead_stage`, params),
      functionNames(),
    ]);
    res.json({
      admin: req.crm.admin, myAsa: req.crm.asas, asa, functions,
      counts: Object.fromEntries(counts.map(r => [r.role, r.n])),
      stages: Object.fromEntries(stages.map(r => [r.stage, r.n])),
      meta: { roles: ROLES, kinds: KINDS, status: STATUS, leadStages: LEAD_STAGES, priorities: PRIORITIES, origins: ORIGINS, lostReasons: LOST_REASONS,
        segments: SEGMENTS, supplierCategories: SUPPLIER_CATEGORIES, supplierSubcategories: SUPPLIER_SUBCATEGORIES, noteKinds: NOTE_KINDS, contactStatus: CONTACT_STATUS, legalBasis: LEGAL_BASIS,
        soaCategories: SOA_CATEGORIES, soaClasses: SOA_CLASSES, legalForms: LEGAL_FORMS, titles: TITLES, contactJobs: CONTACT_JOBS, languages: LANGUAGES,
        regions: REGIONS.map(r => ({ name: r.name, provinces: r.provinces.map(p => [p.code, p.name]) })) },
    });
  });

  // ── ASA e accessi (solo direzione) ───────────────────────────────────────────────────────
  const adminOnly = req => { if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione gestisce ASA e accessi'); };
  app.get('/api/crm/asa', async (req, res) => {
    adminOnly(req);
    const [asa, { rows: members }, { rows: energy }] = await Promise.all([
      allAsa(),
      db.query(`SELECT m.asa_key, m.email, u.id AS user_id, u.name FROM crm_asa_members m LEFT JOIN users u ON lower(u.email) = m.email ORDER BY u.name NULLS LAST, m.email`),
      db.query(`SELECT em.email, u.id AS user_id, u.name FROM energy_members em LEFT JOIN users u ON lower(u.email) = em.email ORDER BY u.name NULLS LAST`),
    ]);
    res.json({ asa: asa.map(a => ({ ...a, members: members.filter(m => m.asa_key === a.key), energyMembers: a.key === 'energy' ? energy : [] })) });
  });
  app.post('/api/crm/asa', async (req, res) => {
    adminOnly(req);
    const label = v.text(req.body.label, 'Nome', { max: 60, required: true });
    const key = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (key.length < 2) throw new HttpError(400, 'Il nome dell\'ASA è troppo corto');
    try {
      const { rows: [a] } = await db.query(
        'INSERT INTO crm_asa (key, label, boss_label, sort) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 10 FROM crm_asa)) RETURNING *',
        [key, label, v.text(req.body.boss_label, 'Nome in BOSS', { max: 60 }) || '']);
      res.status(201).json(a);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'C\'è già un\'ASA con questo nome');
      throw err;
    }
  });
  app.post('/api/crm/asa/:key/members', async (req, res) => {
    adminOnly(req);
    const mail = email(req.body.email, 'Email');
    if (!mail) throw new HttpError(400, 'Scrivi l\'email della persona');
    const { rowCount } = await db.query('SELECT 1 FROM crm_asa WHERE key = $1', [req.params.key]);
    if (!rowCount) throw new HttpError(404, 'ASA non trovata');
    await db.query('INSERT INTO crm_asa_members (asa_key, email, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.params.key, mail, req.user.id]);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/crm/asa/:key/members/:email', async (req, res) => {
    adminOnly(req);
    await db.query('DELETE FROM crm_asa_members WHERE asa_key = $1 AND email = lower($2)', [req.params.key, req.params.email]);
    res.json({ ok: true });
  });

  // ── soggetti ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/crm/subjects', async (req, res) => {
    const params = [];
    const where = ['s.merged_into IS NULL', seeSql(req, 's', params)];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.role) add('? = ANY(s.roles)', String(req.query.role));
    if (req.query.asa) add('? = ANY(s.asa)', String(req.query.asa));
    if (req.query.stage) add('s.lead_stage = ?', String(req.query.stage));
    if (req.query.category) add('? = ANY(s.supplier_categories)', String(req.query.category));
    if (req.query.owner) add('s.owner_id = ?', Number(req.query.owner) || 0);
    if (req.query.function) add('s.function_name = ?', String(req.query.function));
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const n = params.length;
      where.push(`(s.name ILIKE $${n} OR s.short_name ILIKE $${n} OR s.vat ILIKE $${n} OR s.tax_code ILIKE $${n} OR s.city ILIKE $${n})`);
    }
    const { rows } = await db.query(
      `SELECT s.id, s.name, s.short_name, s.kind, s.vat, s.city, s.province, s.roles, s.asa, s.status, s.lead_stage, s.priority, s.potential_value,
              s.segment, s.supplier_categories, s.next_step, s.next_step_date, s.owner_id, u.name AS owner_name, s.function_name, s.updated_at,
              (SELECT COUNT(*)::int FROM crm_contact_links l WHERE l.subject_id = s.id AND l.date_to IS NULL) AS contacts,
              (SELECT COUNT(*)::int FROM crm_meeting_links ml JOIN crm_meetings m ON m.id = ml.meeting_id
                 WHERE NOT ml.removed AND (ml.subject_id = s.id OR ml.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = s.id
                       AND (cl.date_from IS NULL OR cl.date_from <= m.start_at::date) AND (cl.date_to IS NULL OR cl.date_to >= m.start_at::date)))
                   AND m.end_at < $${params.length + 1}::timestamp AND NOT EXISTS (SELECT 1 FROM crm_notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL)) AS missing_notes
         FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id
        WHERE ${where.join(' AND ')} ORDER BY lower(s.name) LIMIT 10000`, [...params, nowRome()]);
    res.json({ subjects: rows });
  });

  // Doppioni prima di salvare: stessa P.IVA, stesso codice fiscale o stesso nome. Le schede di altre ASA si vedono
  // solo con nome e P.IVA, con la possibilità di aggiungere la propria ASA invece di creare un doppione.
  app.get('/api/crm/subjects/check', async (req, res) => {
    let vat = '';
    let tax = '';
    try { vat = vatClean(String(req.query.vat || '')) || ''; } catch { /* P.IVA scritta a metà */ }
    try { tax = taxClean(String(req.query.tax_code || '')) || ''; } catch { /* idem */ }
    const name = String(req.query.name || '').trim();
    const { rows } = await db.query(
      `SELECT id, name, vat, asa FROM crm_subjects WHERE merged_into IS NULL
          AND (($1 <> '' AND vat = $1) OR ($2 <> '' AND tax_code = $2) OR ($3 <> '' AND lower(name) = lower($3))) LIMIT 5`, [vat, tax, name]);
    res.json({ matches: rows.map(r => ({ id: r.id, name: r.name, vat: r.vat, visible: req.crm.admin || r.asa.some(a => req.crm.asas.includes(a)) })) });
  });

  app.post('/api/crm/subjects', async (req, res) => {
    const asaKeys = (await allAsa()).map(a => a.key);
    const f = subjectFields(req.body, { partial: false, asaKeys });
    f.roles = f.roles || [];
    f.asa = f.asa || [];
    checkRoles(req, f.roles);
    checkAsa(req, f.asa);
    if (f.roles.includes('cliente')) f.client_since = new Date().toISOString().slice(0, 10);
    if (f.owner_id === undefined) f.owner_id = req.user.id;
    await checkOwnerFunction(f, { creating: true });
    f.created_by = req.user.id;
    try {
      const { rows: [s] } = await db.query(insertSql('crm_subjects', f), vals(f));
      if (s.roles.includes('lead')) await history(s.id, null, s.lead_stage, '', req.user.id);
      res.status(201).json(s);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'C\'è già un\'anagrafica con questa P.IVA o questo codice fiscale');
      throw err;
    }
  });

  app.get('/api/crm/subjects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id);
    const params = [id];
    const see = seeSql(req, 'x', params);
    const [{ rows: contacts }, { rows: stageHistory }, { rows: controlled }] = await Promise.all([
      db.query(`SELECT c.id, c.title, c.first_name, c.last_name, c.email, c.mobile, c.phone, c.status, l.job, l.is_primary, l.date_from, l.date_to
                  FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
                 WHERE l.subject_id = $1 ORDER BY l.date_to IS NOT NULL, l.is_primary DESC, lower(c.last_name)`, [id]),
      db.query(`SELECT h.*, u.name AS user_name FROM crm_stage_history h LEFT JOIN users u ON u.id = h.user_id
                 WHERE h.subject_id = $1 ORDER BY h.at DESC`, [id]),
      db.query(`SELECT x.id, x.name FROM crm_subjects x WHERE x.group_id = $1 AND x.merged_into IS NULL AND ${see} ORDER BY lower(x.name)`, params),
    ]);
    res.json({ ...s, contacts, history: stageHistory, controlled });
  });

  app.patch('/api/crm/subjects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    const asaKeys = (await allAsa()).map(a => a.key);
    const f = subjectFields(req.body, { partial: true, asaKeys });
    if (f.group_id === id) throw new HttpError(400, 'Un soggetto non può essere il gruppo di sé stesso');
    if (f.roles) checkRoles(req, f.roles, cur.roles);
    if (f.asa) checkAsa(req, f.asa);
    await checkOwnerFunction(f, { creating: false });
    if (f.roles?.includes('cliente') && !cur.roles.includes('cliente') && !cur.client_since) f.client_since = new Date().toISOString().slice(0, 10);
    if (!Object.keys(f).length) return res.json(cur);
    try {
      const { rows: [s] } = await db.query(updateSql('crm_subjects', f), [id, ...vals(f)]);
      res.json(s);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(409, 'C\'è già un\'anagrafica con questa P.IVA o questo codice fiscale');
      throw err;
    }
  });

  // Fase del lead, con lo storico. «Non interessato» vuole il motivo.
  app.post('/api/crm/subjects/:id/stage', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    if (!cur.roles.includes('lead')) throw new HttpError(400, 'Le fasi valgono solo per i lead');
    const stage = v.oneOf(req.body.stage, 'Fase', STAGE_KEYS);
    const lost = stage === 'non_interessato' ? v.text(req.body.lost_reason, 'Motivo', { max: 200, required: true }) : '';
    const retry = stage === 'non_interessato' ? v.date(req.body.retry_date, 'Riprovare il') ?? null : null;
    const note = v.text(req.body.note, 'Nota', { max: 500 }) || '';
    if (stage === cur.lead_stage) return res.json(cur);
    const { rows: [s] } = await db.query(
      'UPDATE crm_subjects SET lead_stage = $2, lost_reason = $3, retry_date = $4, updated_at = now() WHERE id = $1 RETURNING *', [id, stage, lost, retry]);
    await history(id, cur.lead_stage, stage, [lost, note].filter(Boolean).join(' · '), req.user.id);
    res.json(s);
  });

  // Prima commessa in BOSS: il lead diventa cliente. Lo chiamerà BOSS; per ora lo può fare la direzione.
  app.post('/api/crm/subjects/:id/prima-commessa', async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    if (cur.roles.includes('cliente')) return res.json(cur);
    const commessa = v.text(req.body.commessa, 'Commessa', { max: 100 }) || '';
    const roles = [...cur.roles.filter(r => r !== 'lead'), 'cliente'];
    const { rows: [s] } = await db.query(
      'UPDATE crm_subjects SET roles = $2, client_since = COALESCE(client_since, CURRENT_DATE), updated_at = now() WHERE id = $1 RETURNING *', [id, roles]);
    await history(id, cur.roles.includes('lead') ? cur.lead_stage : null, 'cliente', commessa ? `prima commessa ${commessa}` : 'prima commessa', req.user.id);
    res.json(s);
  });

  // «Collega a»: mode add, la stessa scheda ha un ruolo in più. «Trasforma in»: mode set, il ruolo cambia.
  // È sempre la stessa scheda: contatti, email, incontri, note e progetti restano; i dati del ruolo vecchio pure.
  app.post('/api/crm/subjects/:id/roles', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const cur = await subjectById(req, id, { forWrite: true });
    const mode = v.oneOf(req.body.mode, 'Azione', ['add', 'set']);
    const given = list(req.body.roles, 'Ruoli', Object.keys(ROLES)) || [];
    if (!given.length) throw new HttpError(400, 'Scegli almeno un ruolo');
    let roles = mode === 'add' ? [...new Set([...cur.roles, ...given])] : given;
    // aggiungere «cliente» a un lead = il lead diventa cliente (solo la direzione: di solito lo fa BOSS)
    if (mode === 'add' && given.includes('cliente')) roles = roles.filter(r => r !== 'lead');
    if (mode === 'add' && given.includes('lead') && cur.roles.includes('cliente')) throw new HttpError(400, 'È già cliente: non può tornare lead');
    checkRoles(req, roles, cur.roles);
    const note = v.text(req.body.note, 'Nota', { max: 300 }) || '';
    if (roles.length === cur.roles.length && roles.every(r => cur.roles.includes(r))) return res.json(cur);
    const sets = ['roles = $2', 'updated_at = now()'];
    if (roles.includes('cliente') && !cur.client_since) sets.push('client_since = CURRENT_DATE');
    const { rows: [s] } = await db.query(`UPDATE crm_subjects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, roles]);
    const label = r => r.map(x => ROLES[x]).join(', ');
    await history(id, null, 'ruoli', `${label(cur.roles)} → ${label(roles)}${note ? ` · ${note}` : ''}`, req.user.id);
    res.json(s);
  });

  // Doppione trovato in un'altra ASA: si aggiunge una delle proprie ASA alla scheda che c'è già.
  app.post('/api/crm/subjects/:id/join', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const asa = v.oneOf(req.body.asa, 'ASA', req.crm.asas);
    const { rows: [s] } = await db.query(
      `UPDATE crm_subjects SET asa = CASE WHEN $2 = ANY(asa) THEN asa ELSE asa || $2::text END, updated_at = now()
        WHERE id = $1 AND merged_into IS NULL RETURNING id, name`, [id, asa]);
    if (!s) throw new HttpError(404, 'Anagrafica non trovata');
    res.json(s);
  });

  // Unione di due schede (direzione): contatti, attività e storico passano alla scheda buona; l'altra rimanda lì.
  app.post('/api/crm/subjects/:id/merge', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const into = v.int(req.body.into, 'Scheda buona', { min: 1 });
    if (id === into) throw new HttpError(400, 'Scegli un\'altra scheda');
    const a = await subjectById(req, id, { forWrite: true });
    const b = await subjectById(req, into, { forWrite: true });
    await db.tx(async q => {
      await q.query(`INSERT INTO crm_contact_links (contact_id, subject_id, job, is_primary, date_from, date_to)
                      SELECT contact_id, $2, job, false, date_from, date_to FROM crm_contact_links WHERE subject_id = $1
                      ON CONFLICT (contact_id, subject_id) DO NOTHING`, [id, into]);
      await q.query('DELETE FROM crm_contact_links WHERE subject_id = $1', [id]);
      await q.query('UPDATE crm_notes SET subject_id = $2 WHERE subject_id = $1', [id, into]);
      for (const t of ['crm_email_links', 'crm_meeting_links', 'crm_project_links']) {
        await q.query(`DELETE FROM ${t} a USING ${t} b WHERE a.subject_id = $1 AND b.subject_id = $2 AND ${t === 'crm_project_links' ? 'a.project_id = b.project_id' : t === 'crm_email_links' ? 'a.email_id = b.email_id' : 'a.meeting_id = b.meeting_id'}`, [id, into]);
        await q.query(`UPDATE ${t} SET subject_id = $2 WHERE subject_id = $1`, [id, into]);
      }
      await q.query('UPDATE crm_contact_proposals SET subject_id = $2 WHERE subject_id = $1 AND email NOT IN (SELECT email FROM crm_contact_proposals WHERE subject_id = $2)', [id, into]);
      await q.query('UPDATE crm_stage_history SET subject_id = $2 WHERE subject_id = $1', [id, into]);
      await q.query('UPDATE crm_subjects SET group_id = $2 WHERE group_id = $1', [id, into]);
      await q.query(`UPDATE crm_subjects SET merged_into = $2, updated_at = now() WHERE id = $1`, [id, into]);
      const roles = [...new Set([...b.roles, ...a.roles])];
      await q.query(`UPDATE crm_subjects SET roles = $2, asa = $3, updated_at = now() WHERE id = $1`,
        [into, roles.includes('cliente') ? roles.filter(r => r !== 'lead') : roles, [...new Set([...b.asa, ...a.asa])]]);
    });
    res.json({ ok: true, into });
  });

  app.delete('/api/crm/subjects/:id', async (req, res) => {
    adminOnly(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    await db.query('DELETE FROM crm_subjects WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── contatti ─────────────────────────────────────────────────────────────────────────────
  // visibili se collegati a un soggetto visibile, o creati da me e non ancora collegati
  const contactSeeSql = (req, alias, params) => {
    if (req.crm.admin) return 'TRUE';
    params.push(req.crm.asas, req.user.id);
    const a = params.length - 1;
    return `(EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = ${alias}.id AND s.asa && $${a}::text[])
             OR (${alias}.created_by = $${a + 1} AND NOT EXISTS (SELECT 1 FROM crm_contact_links l WHERE l.contact_id = ${alias}.id)))`;
  };
  async function contactById(req, id) {
    const params = [id];
    const see = contactSeeSql(req, 'c', params);
    const { rows: [c] } = await db.query(`SELECT c.*, u.name AS owner_name FROM crm_contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = $1 AND ${see}`, params);
    if (!c) throw new HttpError(404, 'Contatto non trovato');
    return c;
  }
  // collegamenti ai soggetti: solo a soggetti che vedo
  async function cleanLinks(req, links) {
    if (links === undefined) return undefined;
    if (!Array.isArray(links)) throw new HttpError(400, 'I collegamenti non sono validi');
    const out = [];
    for (const l of links) {
      const subjectId = v.int(l?.subject_id, 'Soggetto', { min: 1 });
      await subjectById(req, subjectId);
      if (out.some(x => x.subject_id === subjectId)) continue;
      out.push({
        subject_id: subjectId, job: v.text(l.job, 'Qualifica', { max: 120 }) || '', is_primary: Boolean(l.is_primary),
        date_from: v.date(l.date_from, 'Dal') ?? null, date_to: v.date(l.date_to, 'Al') ?? null,
      });
    }
    return out;
  }
  async function saveLinks(req, contactId, links) {
    if (links === undefined) return;
    // tolgo solo i collegamenti a soggetti che vedo: quelli di altre ASA restano
    const params = [contactId];
    const see = seeSql(req, 's', params);
    await db.query(`DELETE FROM crm_contact_links l USING crm_subjects s WHERE l.subject_id = s.id AND l.contact_id = $1 AND ${see}`, params);
    for (const l of links) {
      await db.query(`INSERT INTO crm_contact_links (contact_id, subject_id, job, is_primary, date_from, date_to) VALUES ($1, $2, $3, $4, $5, $6)
                      ON CONFLICT (contact_id, subject_id) DO UPDATE SET job = EXCLUDED.job, is_primary = EXCLUDED.is_primary, date_from = EXCLUDED.date_from, date_to = EXCLUDED.date_to`,
      [contactId, l.subject_id, l.job, l.is_primary, l.date_from, l.date_to]);
    }
  }
  const linksOf = async (req, contactIds) => {
    if (!contactIds.length) return [];
    const params = [contactIds];
    const see = seeSql(req, 's', params);
    return (await db.query(`SELECT l.contact_id, l.subject_id, s.name, s.roles, l.job, l.is_primary, l.date_from, l.date_to
                              FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                             WHERE l.contact_id = ANY($1::int[]) AND ${see} ORDER BY l.date_to IS NOT NULL, l.is_primary DESC, lower(s.name)`, params)).rows;
  };

  app.get('/api/crm/contacts', async (req, res) => {
    const params = [];
    const where = [contactSeeSql(req, 'c', params)];
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      const n = params.length;
      where.push(`(c.last_name ILIKE $${n} OR c.first_name ILIKE $${n} OR (c.first_name || ' ' || c.last_name) ILIKE $${n} OR c.email ILIKE $${n})`);
    }
    if (req.query.role) {
      params.push(String(req.query.role));
      where.push(`EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = c.id AND $${params.length} = ANY(s.roles))`);
    }
    if (req.query.asa) {
      params.push(String(req.query.asa));
      where.push(`EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = c.id AND $${params.length} = ANY(s.asa))`);
    }
    const { rows } = await db.query(
      `SELECT c.id, c.title, c.first_name, c.last_name, c.email, c.mobile, c.phone, c.status, c.owner_id, u.name AS owner_name
         FROM crm_contacts c LEFT JOIN users u ON u.id = c.owner_id
        WHERE ${where.join(' AND ')} ORDER BY lower(c.last_name), lower(c.first_name) LIMIT 10000`, params);
    const links = await linksOf(req, rows.map(r => r.id));
    res.json({ contacts: rows.map(c => ({ ...c, links: links.filter(l => l.contact_id === c.id) })) });
  });

  // Prima di creare: stessa email, o stesso nome e cognome nello stesso soggetto.
  app.get('/api/crm/contacts/check', async (req, res) => {
    const mail = String(req.query.email || '').trim().toLowerCase();
    const last = String(req.query.last_name || '').trim();
    const first = String(req.query.first_name || '').trim();
    const subjectId = Number(req.query.subject_id) || 0;
    const params = [mail, last, first, subjectId];
    const see = contactSeeSql(req, 'c', params);
    const { rows } = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.email FROM crm_contacts c
        WHERE ${see} AND (($1 <> '' AND lower(c.email) = $1)
           OR ($2 <> '' AND lower(c.last_name) = lower($2) AND lower(c.first_name) = lower($3)
               AND ($4 = 0 OR EXISTS (SELECT 1 FROM crm_contact_links l WHERE l.contact_id = c.id AND l.subject_id = $4)))) LIMIT 5`, params);
    res.json({ matches: rows });
  });

  app.post('/api/crm/contacts', async (req, res) => {
    const f = contactFields(req.body, { partial: false });
    const links = await cleanLinks(req, req.body.links ?? []);
    if (!req.crm.admin && !links.length) throw new HttpError(400, 'Collega il contatto ad almeno un\'anagrafica');
    if (f.owner_id === undefined) f.owner_id = req.user.id;
    f.created_by = req.user.id;
    const { rows: [c] } = await db.query(insertSql('crm_contacts', f), vals(f));
    await saveLinks(req, c.id, links);
    res.status(201).json(c);
  });

  app.get('/api/crm/contacts/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const c = await contactById(req, id);
    const links = await linksOf(req, [id]);
    res.json({ ...c, links });
  });

  app.patch('/api/crm/contacts/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await contactById(req, id);
    const f = contactFields(req.body, { partial: true });
    const links = await cleanLinks(req, req.body.links);
    if (links && !links.length && !req.crm.admin) {
      // senza collegamenti visibili il contatto sparirebbe per chi lo modifica, se non ne ha in altre ASA
      const { rows: [r] } = await db.query('SELECT COUNT(*)::int AS n FROM crm_contact_links WHERE contact_id = $1', [id]);
      const visible = (await linksOf(req, [id])).length;
      if (r.n - visible === 0) throw new HttpError(400, 'Collega il contatto ad almeno un\'anagrafica');
    }
    let c = null;
    if (Object.keys(f).length) c = (await db.query(updateSql('crm_contacts', f), [id, ...vals(f)])).rows[0];
    await saveLinks(req, id, links);
    res.json(c || await contactById(req, id));
  });

  app.delete('/api/crm/contacts/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const c = await contactById(req, id);
    if (!req.crm.admin && c.created_by !== req.user.id) throw new HttpError(403, 'Lo cancella chi l\'ha creato o la direzione');
    await db.query('DELETE FROM crm_contacts WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── email, incontri, note e progetti (routes/crm-links.js) ─────────────────────────────────
  registerCrmLinks(app, { db, auth, notifier, crmSync, subjectById, contactById, seeSql, contactSeeSql });
  registerCrmImport(app, { db }); // primo caricamento da Zoho (direzione)
}

module.exports = { registerCrm };
