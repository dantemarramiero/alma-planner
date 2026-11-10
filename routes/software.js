// Censimento dei software aziendali: catalogo, tipologie di licenza con quantità e costi, chi ha cosa (persone di
// Microsoft), pacchetti per ruolo e collegamenti che si aggiornano da soli (Microsoft 365, software esterni di Entra).
// Tutto riservato agli amministratori: costi e licenze di ognuno non li vedono gli altri.
const { HttpError, v } = require('../lib/http');
const { SOURCES, applySource } = require('../lib/software-sources');
const zoho = require('../lib/zoho');
const linear = require('../lib/linear');
const { refreshLinear } = require('../lib/it-tickets');
const { proposeFor, itDepartment } = require('../lib/software-proposals');

const STATUS = ['attivo', 'da_verificare', 'archiviato'];
const BILLING = ['mese', 'anno', 'una_tantum'];
const duplicate = err => err?.code === '23505';

// Importo in euro: «11,70», «11.7» o numero; vuoto = non noto.
function money(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(String(value).replace(/\s|€/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new HttpError(400, `L'importo «${field}» non è valido`);
  return Math.round(n * 100) / 100;
}
const url = (value, field) => {
  const s = v.text(value, field, { max: 300 });
  if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, `Il campo «${field}» deve iniziare con https://`);
  return s === '' ? null : s;
};
const textList = (value, field) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return [...new Set(value.map(x => v.text(x, field, { max: 120 })).filter(Boolean))];
};
const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));

// Costo al mese di una licenza (l'annuale si divide per 12; una tantum non pesa sul mese).
const monthly = p => (p.unit_cost === null || p.unit_cost === undefined ? null
  : p.billing === 'anno' ? Number(p.unit_cost) / 12 : p.billing === 'una_tantum' ? 0 : Number(p.unit_cost));
const round = n => Math.round(n * 100) / 100;

// Licenza da recuperare: account disattivato in Microsoft, o licenza messa a mano a chi non è più nell'organigramma.
// (Gli account senza casella, es. «edile@…onmicrosoft.com», non sono nell'organigramma ma esistono: non contano.)
const DEPARTED = `(a.account_disabled OR (a.source IN ('manuale', 'pacchetto') AND NOT EXISTS (SELECT 1 FROM org_people o WHERE o.oid = a.person_oid)))`;

function registerSoftware(app, { db, auth, notifier, softwareAccess, baseUrl }) {
  app.use('/api/software', (req, _res, next) => {
    softwareAccess.canUse(req).then(ok => next(ok ? undefined : new HttpError(403, 'Il censimento dei software è riservato agli amministratori e al team IT')), next);
  });

  // Piani con quante assegnazioni hanno e il loro costo al mese.
  async function plansFor(where = 'true', params = []) {
    const { rows } = await db.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM software_assignments a WHERE a.plan_id = p.id) AS assigned
         FROM software_plans p WHERE ${where} ORDER BY p.software_id, lower(p.name)`, params);
    return rows.map(p => {
      const unit = monthly(p);
      const count = p.seats ?? p.assigned;
      return {
        ...p, unit_cost: p.unit_cost === null ? null : Number(p.unit_cost),
        monthly_unit: unit === null ? null : round(unit),
        monthly_cost: unit === null ? null : round(unit * count),
        free: p.seats === null ? null : Math.max(0, p.seats - p.assigned),
        over: p.seats === null ? 0 : Math.max(0, p.assigned - p.seats),
      };
    });
  }

  // ── cruscotto: tutti i software con piani, totali e cose da sistemare ─────────────────────────────
  app.get('/api/software', async (_req, res) => {
    const zohoState = await zoho.status(db);
    const [{ rows: list }, plans, { rows: syncs }, { rows: departed }, { rows: people }, { rows: [pending] }, { rows: [asked] }, { rows: [newTickets] }] = await Promise.all([
      db.query(`SELECT s.*, o.name AS owner_name FROM software s LEFT JOIN org_people o ON o.oid = s.owner_oid ORDER BY lower(s.name)`),
      plansFor(),
      db.query('SELECT s.source, s.synced_at, s.result, u.name AS synced_by_name FROM software_sync s LEFT JOIN users u ON u.id = s.synced_by'),
      db.query(
        `SELECT a.id, a.person_oid, a.person_name, a.person_email, a.source, p.name AS plan_name, s.name AS software_name, s.id AS software_id
           FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id JOIN software s ON s.id = p.software_id
          WHERE ${DEPARTED} AND s.status <> 'archiviato'
          ORDER BY a.person_name, s.name`),
      db.query('SELECT COUNT(*)::int AS n FROM org_people'),
      db.query("SELECT COUNT(*)::int AS n FROM software_proposals WHERE status = 'da_accettare'"),
      db.query("SELECT COUNT(*)::int AS n FROM it_requests WHERE status = 'da_rispondere'"),
      db.query("SELECT COUNT(*)::int AS n FROM it_tickets WHERE status = 'nuovo'"),
    ]);
    const bySw = new Map(list.map(s => [s.id, { ...s, plans: [] }]));
    for (const p of plans) bySw.get(p.software_id)?.plans.push(p);
    const software = [...bySw.values()].map(s => {
      const costs = s.plans.map(p => p.monthly_cost).filter(c => c !== null);
      return {
        ...s,
        people: new Set(), // riempito sotto
        monthly_cost: costs.length ? round(costs.reduce((a, b) => a + b, 0)) : null,
        seats: s.plans.every(p => p.seats !== null) ? s.plans.reduce((a, p) => a + p.seats, 0) : null,
        assigned: s.plans.reduce((a, p) => a + p.assigned, 0),
        free: s.plans.reduce((a, p) => a + (p.free || 0), 0),
        // «Utenti collegati» dei software scoperti in Entra dice chi li usa, non è una licenza da pagare
        missing_cost: s.plans.filter(p => p.unit_cost === null && p.external_id !== 'collegati' && p.assigned + (p.seats || 0) > 0).length,
        estimated: s.plans.some(p => p.cost_estimated),
        renewal_date: s.plans.map(p => p.renewal_date).filter(Boolean).sort()[0] || null,
      };
    });
    const { rows: ppl } = await db.query(
      'SELECT DISTINCT p.software_id, a.person_oid FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id');
    const count = new Map();
    for (const r of ppl) count.set(r.software_id, (count.get(r.software_id) || 0) + 1);
    for (const s of software) { delete s.people; s.people_count = count.get(s.id) || 0; }
    // persone per fornitore, senza doppioni (chi ha Zoho CRM e Zoho Sign conta una volta)
    const vendorOf = new Map(software.filter(s => s.status !== 'archiviato').map(s => [s.id, (s.vendor || '').trim() || s.name]));
    const vendorPeople = new Map();
    for (const r of ppl) {
      const v = vendorOf.get(r.software_id);
      if (!v) continue;
      if (!vendorPeople.has(v)) vendorPeople.set(v, new Set());
      vendorPeople.get(v).add(r.person_oid);
    }

    const active = software.filter(s => s.status !== 'archiviato');
    const freeCost = round(plans.filter(p => bySw.get(p.software_id)?.status !== 'archiviato')
      .reduce((a, p) => a + (p.free && p.monthly_unit ? p.free * p.monthly_unit : 0), 0));
    res.json({
      software,
      vendor_people: Object.fromEntries([...vendorPeople].map(([v, set]) => [v, set.size])),
      sync: Object.fromEntries(syncs.map(s => [s.source, s])),
      sources: Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, needs: s.needs || null,
        configured: s.oauth ? zohoState.configured : !s.needs || Boolean(process.env[s.needs]),
        ...(s.oauth ? { oauth: s.oauth, connected: zohoState.connected } : {}) })),
      departed,
      totals: {
        software: active.filter(s => s.status === 'attivo').length,
        to_check: software.filter(s => s.status === 'da_verificare').length,
        monthly_cost: round(active.reduce((a, s) => a + (s.monthly_cost || 0), 0)),
        free_seats: active.reduce((a, s) => a + s.free, 0),
        free_cost: freeCost,
        missing_cost: active.filter(s => s.status === 'attivo').reduce((a, s) => a + s.missing_cost, 0),
        estimated: active.filter(s => s.estimated).length,
        departed: departed.length,
        people: people[0].n,
        proposals: pending.n,
        requests: asked.n,
        tickets: newTickets.n,
      },
    });
  });

  // ── scheda di un software ─────────────────────────────────────────────────
  async function getSoftware(id) {
    const { rows: [s] } = await db.query('SELECT s.*, o.name AS owner_name FROM software s LEFT JOIN org_people o ON o.oid = s.owner_oid WHERE s.id = $1', [id]);
    if (!s) throw new HttpError(404, 'Software non trovato');
    return s;
  }

  function readSoftware(body, { partial }) {
    const out = pick({
      name: v.text(body.name, 'nome', { max: 120, required: !partial }),
      vendor: v.text(body.vendor, 'produttore', { max: 120 }),
      category: v.text(body.category, 'tipo', { max: 80 }),
      website: url(body.website, 'sito'),
      owner_oid: body.owner_oid === undefined ? undefined : (body.owner_oid ? v.text(body.owner_oid, 'referente', { max: 64 }) : null),
      status: v.oneOf(body.status, 'stato', STATUS),
      notes: v.text(body.notes, 'note', { max: 2000 }),
    });
    if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
    return out;
  }

  app.post('/api/software', async (req, res) => {
    const d = readSoftware(req.body || {}, { partial: false });
    try {
      const { rows: [s] } = await db.query(
        `INSERT INTO software (name, vendor, category, website, owner_oid, status, notes, created_by)
         VALUES ($1, COALESCE($2, ''), COALESCE($3, ''), $4, $5, COALESCE($6, 'attivo'), COALESCE($7, ''), $8) RETURNING id`,
        [d.name, d.vendor, d.category, d.website ?? null, d.owner_oid ?? null, d.status, d.notes, req.user.id]);
      res.status(201).json({ id: s.id });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `«${d.name}» è già nel censimento`);
      throw err;
    }
  });

  app.patch('/api/software/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await getSoftware(id);
    const d = readSoftware(req.body || {}, { partial: true });
    const cols = Object.keys(d);
    if (!cols.length) return res.json({ ok: true });
    try {
      await db.query(`UPDATE software SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...Object.values(d)]);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `«${d.name}» è già nel censimento`);
      throw err;
    }
    res.json({ ok: true });
  });

  // Si cancella solo un software messo a mano; quelli che arrivano da un collegamento si archiviano
  // (altrimenti al prossimo aggiornamento tornerebbero).
  app.delete('/api/software/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await getSoftware(id);
    if (s.external_id) throw new HttpError(400, `«${s.name}» arriva da ${SOURCES[s.source]?.label || s.source}: archivialo invece di cancellarlo`);
    await db.query('DELETE FROM software WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── tipologie di licenza ──────────────────────────────────────────────────
  async function getPlan(id) {
    const { rows: [p] } = await db.query(
      'SELECT p.*, s.source, s.name AS software_name FROM software_plans p JOIN software s ON s.id = p.software_id WHERE p.id = $1', [id]);
    if (!p) throw new HttpError(404, 'Tipologia di licenza non trovata');
    return p;
  }
  function readPlan(body, { partial }) {
    const out = pick({
      name: v.text(body.name, 'nome', { max: 120, required: !partial }),
      seats: v.int(body.seats, 'licenze acquistate', { min: 0, max: 1e6, nullable: true }),
      unit_cost: money(body.unit_cost, 'costo'),
      billing: v.oneOf(body.billing, 'fatturazione', BILLING),
      renewal_date: v.date(body.renewal_date, 'rinnovo'),
      notes: v.text(body.notes, 'note', { max: 1000 }),
    });
    if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
    if (out.unit_cost !== undefined) out.cost_estimated = false; // chi scrive il prezzo mette quello vero
    return out;
  }

  app.post('/api/software/:id/plans', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await getSoftware(id);
    const d = readPlan(req.body || {}, { partial: false });
    try {
      const { rows: [p] } = await db.query(
        `INSERT INTO software_plans (software_id, name, seats, unit_cost, billing, renewal_date, notes)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'mese'), $6, COALESCE($7, '')) RETURNING id`,
        [id, d.name, d.seats ?? null, d.unit_cost ?? null, d.billing, d.renewal_date ?? null, d.notes]);
      res.status(201).json({ id: p.id });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `C'è già una licenza «${d.name}»`);
      throw err;
    }
  });

  app.patch('/api/software/plans/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const plan = await getPlan(id);
    const d = readPlan(req.body || {}, { partial: true });
    // quantità e nome delle licenze lette da un collegamento li decide la fonte
    // nome (e quantità, se la fonte la dà) delle licenze lette da un collegamento li decide la fonte
    const seatsManual = Boolean(SOURCES[plan.source]?.seatsManual);
    if (plan.external_id && (d.name !== undefined || (d.seats !== undefined && !seatsManual))) {
      throw new HttpError(400, `Nome e quantità di «${plan.name}» arrivano da ${SOURCES[plan.source]?.label || plan.source}: si cambiano lì`);
    }
    const cols = Object.keys(d);
    if (!cols.length) return res.json({ ok: true });
    try {
      await db.query(`UPDATE software_plans SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(d)]);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `C'è già una licenza «${d.name}»`);
      throw err;
    }
    res.json({ ok: true });
  });

  app.delete('/api/software/plans/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const plan = await getPlan(id);
    if (plan.external_id) throw new HttpError(400, `«${plan.name}» arriva da ${SOURCES[plan.source]?.label || plan.source}: non si cancella da qui`);
    await db.query('DELETE FROM software_plans WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── assegnazioni ──────────────────────────────────────────────────────────
  async function assign(q, planId, oids, { source = 'manuale', packageId = null, userId }) {
    if (!oids.length) return 0;
    const { rows: people } = await q.query('SELECT oid, name, email FROM org_people WHERE oid = ANY($1::text[])', [oids]);
    if (people.length !== oids.length) throw new HttpError(400, 'Una delle persone non è nell\'organigramma di Microsoft');
    let added = 0;
    for (const p of people) {
      const { rowCount } = await q.query(
        `INSERT INTO software_assignments (plan_id, person_oid, person_name, person_email, source, package_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (plan_id, person_oid) DO NOTHING`,
        [planId, p.oid, p.name, p.email || '', source, packageId, userId]);
      added += rowCount;
    }
    return added;
  }
  const readOids = body => {
    const list = Array.isArray(body?.oids) ? body.oids : [];
    if (!list.length || list.length > 500) throw new HttpError(400, 'Scegli almeno una persona');
    return [...new Set(list.map(o => v.text(o, 'persona', { max: 64, required: true })))];
  };

  app.post('/api/software/plans/:id/assignments', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const plan = await getPlan(id);
    if (plan.external_id) throw new HttpError(400, `Le licenze «${plan.name}» si assegnano in ${SOURCES[plan.source]?.label || plan.source}: qui arrivano da sole all'aggiornamento`);
    const oids = readOids(req.body);
    const added = await db.tx(q => assign(q, id, oids, { userId: req.user.id }));
    res.status(201).json({ added });
  });

  app.delete('/api/software/assignments/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [a] } = await db.query('SELECT a.source FROM software_assignments a WHERE a.id = $1', [id]);
    if (!a) throw new HttpError(404, 'Assegnazione non trovata');
    // una licenza letta da un collegamento si toglie là (anche quella di un account disattivato)
    if (SOURCES[a.source]) {
      throw new HttpError(400, `Questa licenza arriva da ${SOURCES[a.source].label}: toglila lì, al prossimo aggiornamento sparisce anche qui`);
    }
    await db.query('DELETE FROM software_assignments WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── persone: chi ha cosa ──────────────────────────────────────────────────
  async function assignmentsOf(where, params) {
    const { rows } = await db.query(
      `SELECT a.id, a.person_oid, a.source, a.assigned_at, a.package_id, pk.name AS package_name,
              p.id AS plan_id, p.name AS plan_name, p.unit_cost, p.billing, p.cost_estimated, s.id AS software_id, s.name AS software_name, s.category
         FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id JOIN software s ON s.id = p.software_id
         LEFT JOIN software_packages pk ON pk.id = a.package_id
        WHERE s.status <> 'archiviato' AND ${where} ORDER BY lower(s.name), lower(p.name)`, params);
    return rows.map(r => ({ ...r, unit_cost: r.unit_cost === null ? null : Number(r.unit_cost), monthly_cost: monthly(r) === null ? null : round(monthly(r)) }));
  }

  app.get('/api/software/people', async (_req, res) => {
    const [{ rows: people }, all] = await Promise.all([
      db.query('SELECT oid, name, email, job_title, department FROM org_people ORDER BY lower(name)'),
      assignmentsOf('true', []),
    ]);
    const by = new Map();
    for (const a of all) {
      const x = by.get(a.person_oid) || { software: new Set(), monthly_cost: 0, items: 0 };
      x.software.add(a.software_name);
      x.monthly_cost += a.monthly_cost || 0;
      x.items++;
      by.set(a.person_oid, x);
    }
    const row = (p, extra = {}) => {
      const x = by.get(p.oid);
      return { ...p, ...extra, software: x ? [...x.software] : [], licenses: x?.items || 0, monthly_cost: x ? round(x.monthly_cost) : 0 };
    };
    // anche gli account con licenze che non sono nell'organigramma (senza casella, disattivati, usciti)
    const inOrg = new Set(people.map(p => p.oid));
    const { rows: others } = await db.query(
      `SELECT DISTINCT ON (a.person_oid) a.person_oid AS oid, a.person_name AS name, a.person_email AS email, a.account_disabled
         FROM software_assignments a ORDER BY a.person_oid, a.account_disabled DESC`);
    res.json([...people.map(p => row(p)), ...others.filter(o => !inOrg.has(o.oid)).map(o => row(o, { not_in_org: true }))]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'it')));
  });

  app.get('/api/software/people/:oid', async (req, res) => {
    const oid = v.text(req.params.oid, 'persona', { max: 64, required: true });
    const { rows: [p] } = await db.query('SELECT oid, name, email, job_title, department FROM org_people WHERE oid = $1', [oid]);
    const items = await assignmentsOf('a.person_oid = $1', [oid]);
    if (!p && !items.length) throw new HttpError(404, 'Persona non trovata');
    const { rows: packages } = await db.query(
      `SELECT k.id, k.name FROM software_packages k
        WHERE ($1::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.job_titles) t WHERE lower(t) = lower($1)))
           OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.departments) d WHERE lower(d) = lower($2)))
        ORDER BY lower(k.name)`, [p?.job_title || null, p?.department || null]);
    res.json({
      person: p || { oid, name: (await db.query('SELECT person_name FROM software_assignments WHERE person_oid = $1 LIMIT 1', [oid])).rows[0]?.person_name, departed: true },
      items,
      monthly_cost: round(items.reduce((a, i) => a + (i.monthly_cost || 0), 0)),
      suggested_packages: packages,
    });
  });

  // ── pacchetti per ruolo ───────────────────────────────────────────────────
  app.get('/api/software/packages', async (_req, res) => {
    const [{ rows: packages }, { rows: items }] = await Promise.all([
      db.query('SELECT * FROM software_packages ORDER BY lower(name)'),
      db.query(
        `SELECT pp.package_id, pp.on_request, p.id AS plan_id, p.name AS plan_name, p.unit_cost, p.billing, p.external_id, s.id AS software_id, s.name AS software_name, s.vendor
           FROM software_package_plans pp JOIN software_plans p ON p.id = pp.plan_id JOIN software s ON s.id = p.software_id
          ORDER BY lower(s.name), lower(p.name)`),
    ]);
    res.json(packages.map(k => {
      const plans = items.filter(i => i.package_id === k.id).map(i => ({ ...i, unit_cost: i.unit_cost === null ? null : Number(i.unit_cost), monthly_unit: monthly(i) === null ? null : round(monthly(i)) }));
      // costo del pacchetto = solo le licenze di base; quelle su richiesta si sommano a parte
      const base = plans.filter(p => !p.on_request), extra = plans.filter(p => p.on_request);
      return { ...k, plans, monthly_cost: round(base.reduce((a, p) => a + (p.monthly_unit || 0), 0)), on_request_cost: round(extra.reduce((a, p) => a + (p.monthly_unit || 0), 0)) };
    }));
  });

  function readPackage(body, { partial }) {
    const out = pick({
      name: v.text(body.name, 'nome', { max: 120, required: !partial }),
      description: v.text(body.description, 'descrizione', { max: 1000 }),
      job_titles: textList(body.job_titles, 'ruoli'),
      departments: textList(body.departments, 'reparti'),
    });
    if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
    return { data: out, planIds: v.ids(body.plan_ids, 'licenze'), requestIds: v.ids(body.request_ids, 'licenze su richiesta') || [] };
  }
  // planIds = tutte le licenze del pacchetto; requestIds = quelle tra loro che sono «su richiesta»
  async function setPlans(q, packageId, planIds, requestIds = []) {
    if (planIds === undefined) return;
    if (planIds.length) {
      const { rows } = await q.query('SELECT id FROM software_plans WHERE id = ANY($1::int[])', [planIds]);
      if (rows.length !== planIds.length) throw new HttpError(400, 'Una delle licenze del pacchetto non esiste più');
    }
    await q.query('DELETE FROM software_package_plans WHERE package_id = $1', [packageId]);
    for (const id of planIds) await q.query('INSERT INTO software_package_plans (package_id, plan_id, on_request) VALUES ($1, $2, $3)', [packageId, id, requestIds.includes(id)]);
  }

  app.post('/api/software/packages', async (req, res) => {
    const { data: d, planIds, requestIds } = readPackage(req.body || {}, { partial: false });
    try {
      const id = await db.tx(async q => {
        const { rows: [k] } = await q.query(
          `INSERT INTO software_packages (name, description, job_titles, departments) VALUES ($1, COALESCE($2, ''), COALESCE($3::text[], '{}'), COALESCE($4::text[], '{}')) RETURNING id`,
          [d.name, d.description, d.job_titles, d.departments]);
        await setPlans(q, k.id, planIds || [], requestIds);
        return k.id;
      });
      res.status(201).json({ id });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `C'è già un pacchetto «${d.name}»`);
      throw err;
    }
  });

  app.patch('/api/software/packages/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [k] } = await db.query('SELECT id FROM software_packages WHERE id = $1', [id]);
    if (!k) throw new HttpError(404, 'Pacchetto non trovato');
    const { data: d, planIds, requestIds } = readPackage(req.body || {}, { partial: true });
    try {
      await db.tx(async q => {
        const cols = Object.keys(d);
        if (cols.length) await q.query(`UPDATE software_packages SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(d)]);
        await setPlans(q, id, planIds, requestIds);
      });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `C'è già un pacchetto «${d.name}»`);
      throw err;
    }
    res.json({ ok: true });
  });

  app.delete('/api/software/packages/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await db.query('DELETE FROM software_packages WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // Assegna a una persona le licenze di base del pacchetto (non quelle su richiesta) che si gestiscono qui. Quelle che arrivano da un
  // collegamento (es. Microsoft 365) vanno assegnate là: si restituiscono come «da fare» con il link.
  app.post('/api/software/packages/:id/apply', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const oids = readOids(req.body);
    const { rows: plans } = await db.query(
      `SELECT p.id, p.name, p.external_id, s.name AS software_name, s.source
         FROM software_package_plans pp JOIN software_plans p ON p.id = pp.plan_id JOIN software s ON s.id = p.software_id
        WHERE pp.package_id = $1 AND NOT pp.on_request`, [id]);
    if (!plans.length) throw new HttpError(400, 'Il pacchetto non ha licenze di base');
    const result = await db.tx(async q => {
      let added = 0;
      for (const p of plans.filter(x => !x.external_id)) added += await assign(q, p.id, oids, { source: 'pacchetto', packageId: id, userId: req.user.id });
      return added;
    });
    const { rows: have } = await db.query(
      'SELECT plan_id, person_oid FROM software_assignments WHERE plan_id = ANY($1::int[]) AND person_oid = ANY($2::text[])',
      [plans.map(p => p.id), oids]);
    const todo = plans.filter(p => p.external_id).flatMap(p => oids
      .filter(o => !have.some(hv => hv.plan_id === p.id && hv.person_oid === o))
      .map(o => ({ oid: o, software: p.software_name, plan: p.name, where: SOURCES[p.source]?.label || p.source })));
    res.json({ added: result, todo });
  });

  // ── proposte per ruolo: il team IT le accetta (tutte o in parte) o le rifiuta ─────────────────────
  app.get('/api/software/proposals', async (req, res) => {
    const status = v.oneOf(req.query.status || 'da_accettare', 'stato', ['da_accettare', 'accettata', 'rifiutata']);
    const [{ rows: props }, { rows: items }] = await Promise.all([
      db.query(
        `SELECT sp.*, u.name AS decided_by_name FROM software_proposals sp LEFT JOIN users u ON u.id = sp.decided_by
          WHERE sp.status = $1 ORDER BY sp.created_at DESC LIMIT 200`, [status]),
      db.query(
        `SELECT i.proposal_id, i.plan_id, i.accepted, i.on_request, p.name AS plan_name, p.unit_cost, p.billing, p.external_id,
                s.id AS software_id, s.name AS software_name, s.vendor, s.source,
                EXISTS (SELECT 1 FROM software_assignments a JOIN software_proposals x ON x.id = i.proposal_id
                         WHERE a.plan_id = i.plan_id AND a.person_oid = x.person_oid) AS has_it
           FROM software_proposal_items i JOIN software_plans p ON p.id = i.plan_id JOIN software s ON s.id = p.software_id
          ORDER BY i.on_request, lower(s.name), lower(p.name)`),
    ]);
    res.json({
      it_department: await itDepartment(db),
      proposals: props.map(sp => ({
        ...sp,
        items: items.filter(i => i.proposal_id === sp.id).map(i => ({
          ...i, unit_cost: i.unit_cost === null ? null : Number(i.unit_cost),
          monthly_unit: monthly(i) === null ? null : round(monthly(i)),
          managed_by: i.external_id ? (SOURCES[i.source]?.label || i.source) : null,
        })),
      })),
    });
  });

  async function getProposal(id) {
    const { rows: [sp] } = await db.query('SELECT * FROM software_proposals WHERE id = $1', [id]);
    if (!sp) throw new HttpError(404, 'Proposta non trovata');
    if (sp.status !== 'da_accettare') throw new HttpError(400, `Questa proposta è già stata ${sp.status === 'accettata' ? 'accettata' : 'rifiutata'}`);
    return sp;
  }

  // Accetta le licenze scelte (plan_ids; assente = quelle di base, senza le «su richiesta»). Quelle gestite qui si assegnano subito; quelle che
  // arrivano da un collegamento (Microsoft 365) si restituiscono «da fare» nel sistema di origine.
  app.post('/api/software/proposals/:id/accept', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const sp = await getProposal(id);
    const { rows: items } = await db.query(
      `SELECT i.plan_id, i.on_request, p.name, p.external_id, s.name AS software_name, s.source
         FROM software_proposal_items i JOIN software_plans p ON p.id = i.plan_id JOIN software s ON s.id = p.software_id
        WHERE i.proposal_id = $1`, [id]);
    const chosen = req.body?.plan_ids === undefined ? items.filter(i => !i.on_request).map(i => i.plan_id) : v.ids(req.body.plan_ids, 'licenze');
    if (chosen.some(pid => !items.some(i => i.plan_id === pid))) throw new HttpError(400, 'Una delle licenze non fa parte della proposta');
    const { rows: [inOrg] } = await db.query('SELECT 1 FROM org_people WHERE oid = $1', [sp.person_oid]);
    if (chosen.length && !inOrg) throw new HttpError(400, `${sp.person_name} non è più nell'organigramma di Microsoft: rifiuta la proposta`);
    const added = await db.tx(async q => {
      let n = 0;
      for (const it of items) {
        const ok = chosen.includes(it.plan_id);
        await q.query('UPDATE software_proposal_items SET accepted = $3 WHERE proposal_id = $1 AND plan_id = $2', [id, it.plan_id, ok]);
        if (ok && !it.external_id) n += await assign(q, it.plan_id, [sp.person_oid], { source: 'pacchetto', packageId: sp.package_id, userId: req.user.id });
      }
      await q.query(
        `UPDATE software_proposals SET status = $2, decided_by = $3, decided_at = now(), note = COALESCE($4, note) WHERE id = $1`,
        [id, chosen.length ? 'accettata' : 'rifiutata', req.user.id, v.text(req.body?.note, 'nota', { max: 500 }) ?? null]);
      return n;
    });
    const todo = items.filter(i => i.external_id && chosen.includes(i.plan_id))
      .map(i => ({ oid: sp.person_oid, software: i.software_name, plan: i.name, where: SOURCES[i.source]?.label || i.source }));
    res.json({ added, todo });
  });

  app.post('/api/software/proposals/:id/reject', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await getProposal(id);
    await db.tx(async q => {
      await q.query('UPDATE software_proposal_items SET accepted = false WHERE proposal_id = $1', [id]);
      await q.query(`UPDATE software_proposals SET status = 'rifiutata', decided_by = $2, decided_at = now(), note = $3 WHERE id = $1`,
        [id, req.user.id, v.text(req.body?.note, 'motivo', { max: 500 }) || '']);
    });
    res.json({ ok: true });
  });

  // Proposta a mano per una persona già presente (es. cambio di ruolo): stessa regola di quella automatica.
  app.post('/api/software/proposals', async (req, res) => {
    const oid = v.text(req.body?.oid, 'persona', { max: 64, required: true });
    const { rows: [p] } = await db.query('SELECT oid FROM org_people WHERE oid = $1', [oid]);
    if (!p) throw new HttpError(400, 'La persona non è nell\'organigramma di Microsoft');
    res.status(201).json({ created: await proposeFor(db, notifier, [oid], { actorId: req.user.id }) });
  });

  // ── richieste delle persone (Alma IT): un software, uno nuovo, o «non mi serve più» ─────────────
  app.get('/api/software/requests', async (req, res) => {
    const status = v.oneOf(req.query.status || 'da_rispondere', 'stato', ['da_rispondere', 'accettata', 'rifiutata', 'annullata']);
    const { rows } = await db.query(
      `SELECT r.*, u.name AS decided_by_name, o.job_title, o.department,
              p.name AS plan_name, p.seats, p.external_id, s.id AS software_id, s.name AS plan_software, s.source,
              (SELECT COUNT(*)::int FROM software_assignments a WHERE a.plan_id = r.plan_id) AS assigned
         FROM it_requests r
         LEFT JOIN users u ON u.id = r.decided_by
         LEFT JOIN org_people o ON o.oid = r.person_oid
         LEFT JOIN software_plans p ON p.id = r.plan_id
         LEFT JOIN software s ON s.id = p.software_id
        WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`, [status]);
    res.json(rows.map(r => ({
      ...r,
      free: r.seats === null || r.seats === undefined ? null : Math.max(0, r.seats - r.assigned),
      managed_by: r.external_id && r.external_id !== 'collegati' ? (SOURCES[r.source]?.label || r.source) : null,
    })));
  });

  async function openRequest(id) {
    const { rows: [r] } = await db.query(
      `SELECT r.*, p.external_id, s.source, s.name AS plan_software FROM it_requests r
         LEFT JOIN software_plans p ON p.id = r.plan_id LEFT JOIN software s ON s.id = p.software_id WHERE r.id = $1`, [id]);
    if (!r) throw new HttpError(404, 'Richiesta non trovata');
    if (r.status !== 'da_rispondere') throw new HttpError(400, 'Questa richiesta ha già una risposta');
    return r;
  }
  const tellRequester = (r, actorId, body) => notifier?.notify({ userIds: [r.user_id], actorId, kind: 'it', body, link: '/it/strumenti' }).catch(() => {});

  // Accetta: un software del censimento si assegna (quelli di un collegamento restano «da fare» là),
  // «non mi serve più» toglie la licenza, un software nuovo si segna accettato (lo si aggiunge al censimento).
  app.post('/api/software/requests/:id/accept', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const answer = v.text(req.body?.answer, 'risposta', { max: 1000 }) || '';
    const r = await openRequest(id);
    const managed = r.external_id && r.external_id !== 'collegati';
    const where = SOURCES[r.source]?.label || r.source;
    let added = 0, removed = 0, todo = null;
    await db.tx(async q => {
      if (r.kind === 'software' && r.plan_id) {
        if (managed) todo = `Assegna «${r.software_name}» a ${r.person_name} in ${where}: arriva qui con «Aggiorna»`;
        else if (r.person_oid) added = await assign(q, r.plan_id, [r.person_oid], { source: 'manuale', userId: req.user.id });
        else throw new HttpError(400, `${r.person_name} non è nell'organigramma di Microsoft: assegnala dalla scheda del software`);
      }
      if (r.kind === 'rilascio' && r.assignment_id) {
        const { rows: [a] } = await q.query('SELECT source FROM software_assignments WHERE id = $1', [r.assignment_id]);
        if (a && SOURCES[a.source]) todo = `Togli «${r.software_name}» a ${r.person_name} in ${SOURCES[a.source].label}: sparisce qui con «Aggiorna»`;
        else if (a) removed = (await q.query('DELETE FROM software_assignments WHERE id = $1', [r.assignment_id])).rowCount;
      }
      await q.query(`UPDATE it_requests SET status = 'accettata', answer = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [id, answer, req.user.id]);
    });
    await tellRequester(r, req.user.id, r.kind === 'rilascio'
      ? `Il team IT ha preso in carico «${r.software_name}» che non ti serve più${answer ? `: ${answer}` : ''}`
      : `Il team IT ha accettato la tua richiesta di «${r.software_name}»${answer ? `: ${answer}` : ''}`);
    res.json({ added, removed, todo });
  });

  app.post('/api/software/requests/:id/reject', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const answer = v.text(req.body?.answer, 'motivo', { max: 1000 }) || '';
    const r = await openRequest(id);
    await db.query(`UPDATE it_requests SET status = 'rifiutata', answer = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [id, answer, req.user.id]);
    await tellRequester(r, req.user.id, `Il team IT non ha accettato la richiesta di «${r.software_name}»${answer ? `: ${answer}` : ''}`);
    res.json({ ok: true });
  });

  // ── ticket IT ────────────────────────────────────────────────────────────
  const ticketOf = async id => {
    const { rows: [t] } = await db.query('SELECT * FROM it_tickets WHERE id = $1', [id]);
    if (!t) throw new HttpError(404, 'Ticket non trovato');
    return t;
  };
  const tellReporter = (t, actorId, body) => notifier?.notify({ userIds: [t.user_id], actorId, kind: 'it', body, link: '/it/strumenti' }).catch(() => {});

  app.get('/api/software/tickets', async (_req, res) => {
    let board = null, linearError = null;
    if (linear.configured()) {
      try {
        await refreshLinear(db, notifier);
        board = await linear.board();
      } catch (err) {
        linearError = err.message;
      }
    }
    const { rows } = await db.query(
      `SELECT t.*, u.name AS handled_by_name FROM it_tickets t LEFT JOIN users u ON u.id = t.handled_by
        WHERE t.status IN ('nuovo', 'in_corso', 'linear') OR (t.status = 'chiuso' AND t.closed_at > now() - interval '7 days')
        ORDER BY CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, t.created_at`);
    res.json({
      linear: { configured: linear.configured(), error: linearError, team: board?.team || null },
      tickets: rows,
      board: board ? board.issues : null,
    });
  });

  app.post('/api/software/tickets/:id/take', async (req, res) => {
    const t = await ticketOf(v.int(req.params.id, 'id', { min: 1 }));
    if (t.status !== 'nuovo') throw new HttpError(400, 'Questo ticket è già stato smistato');
    await db.query("UPDATE it_tickets SET status = 'in_corso', handled_by = $2, updated_at = now() WHERE id = $1", [t.id, req.user.id]);
    await tellReporter(t, req.user.id, `${req.user.name} del team IT ha preso in carico «${t.title}»`);
    res.json({ ok: true });
  });

  app.post('/api/software/tickets/:id/linear', async (req, res) => {
    const t = await ticketOf(v.int(req.params.id, 'id', { min: 1 }));
    if (!['nuovo', 'in_corso'].includes(t.status)) throw new HttpError(400, 'Questo ticket è già su Linear o chiuso');
    const priority = req.body?.priority ? v.oneOf(req.body.priority, 'priorità', ['bassa', 'media', 'alta', 'urgente']) : t.priority;
    const category = v.text(req.body?.category, 'tipo', { max: 60 }) || t.category;
    const description = [
      t.body || '_Nessun dettaglio._', '',
      `**Segnalato da** ${t.person_name}${t.department ? ` · ${t.department}` : ''}${t.person_email ? ` · ${t.person_email}` : ''}`,
      `**Tipo** ${category}`,
      `Aperto in Alma IT: ${baseUrl}/app#/it/ticket`,
    ].join('\n');
    let issue;
    try {
      issue = await linear.createIssue({ title: t.title, description, priority });
    } catch (err) {
      throw new HttpError(err.status === 400 ? 400 : err.status === 403 ? 403 : 502, err.message);
    }
    await db.query(
      `UPDATE it_tickets SET status = 'linear', priority = $2, category = $3, handled_by = COALESCE(handled_by, $4), linear_id = $5, linear_identifier = $6,
              linear_url = $7, linear_state = $8, linear_state_type = $9, linear_assignee = $10, updated_at = now() WHERE id = $1`,
      [t.id, priority, category, req.user.id, issue.id, issue.identifier, issue.url, issue.state?.name || null, issue.state?.type || null, issue.assignee?.name || null]);
    await tellReporter(t, req.user.id, `Il team IT ha preso in carico «${t.title}» (${issue.identifier})`);
    res.json({ identifier: issue.identifier, url: issue.url });
  });

  app.post('/api/software/tickets/:id/close', async (req, res) => {
    const t = await ticketOf(v.int(req.params.id, 'id', { min: 1 }));
    if (!['nuovo', 'in_corso'].includes(t.status)) throw new HttpError(400, t.status === 'linear' ? 'Questo ticket si chiude su Linear' : 'Questo ticket è già chiuso');
    const answer = v.text(req.body?.answer, 'risposta', { max: 2000 }) || '';
    await db.query("UPDATE it_tickets SET status = 'chiuso', answer = $2, handled_by = COALESCE(handled_by, $3), closed_at = now(), updated_at = now() WHERE id = $1",
      [t.id, answer, req.user.id]);
    await tellReporter(t, req.user.id, `Il team IT ha risolto «${t.title}»${answer ? `: ${answer.slice(0, 160)}` : ''}`);
    res.json({ ok: true });
  });

  // Zoho: l'amministratore entra in Zoho e dà il consenso; il ritorno arriva qui (stesso indirizzo registrato nella console Zoho)
  app.get('/api/software/zoho/connect', async (req, res) => {
    try {
      res.redirect(await zoho.authorizeUrl(db, baseUrl, req.user.id));
    } catch (err) {
      res.redirect(`/app#/it/collegamenti?zoho_errore=${encodeURIComponent(err.message)}`);
    }
  });
  app.get('/api/software/zoho/callback', async (req, res) => {
    try {
      await zoho.finishConnect(db, auth, baseUrl, req.user.id, req.query);
      res.redirect('/app#/it/collegamenti?zoho=ok');
    } catch (err) {
      res.redirect(`/app#/it/collegamenti?zoho_errore=${encodeURIComponent(err.message)}`);
    }
  });
  app.post('/api/software/zoho/disconnect', async (_req, res) => {
    await zoho.disconnect(db);
    res.json({ ok: true });
  });

  // scheda di un software (dopo /people, /packages /proposals e /requests, che altrimenti finirebbero qui)
  app.get('/api/software/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await getSoftware(id);
    const [plans, { rows: assignments }] = await Promise.all([
      plansFor('p.software_id = $1', [id]),
      db.query(
        `SELECT a.*, ${DEPARTED} AS departed, o.job_title, o.department, pk.name AS package_name, u.name AS assigned_by_name
           FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id
           LEFT JOIN org_people o ON o.oid = a.person_oid
           LEFT JOIN software_packages pk ON pk.id = a.package_id
           LEFT JOIN users u ON u.id = a.assigned_by
          WHERE p.software_id = $1 ORDER BY lower(a.person_name)`, [id]),
    ]);
    res.json({ ...s, plans, assignments });
  });

  // ── collegamenti ──────────────────────────────────────────────────────────
  app.post('/api/software/sync/:source', async (req, res) => {
    const source = v.oneOf(req.params.source, 'collegamento', Object.keys(SOURCES));
    const src = SOURCES[source];
    let list;
    let warnings = [];
    if (src.oauth === 'zoho') {
      const { rows: people } = await db.query('SELECT oid, name, email FROM org_people');
      try {
        const { token, apiDomain } = await zoho.accessToken(db, auth);
        list = await src.read({ token, apiDomain, people });
        warnings = list.warnings || [];
      } catch (err) {
        throw new HttpError(err.status === 403 ? 403 : err.status === 400 ? 400 : 502, err.message);
      }
    } else if (src.needs) {
      // collegamento con una chiave del fornitore, salvata come variabile del servizio (mai nel database)
      const apiKey = process.env[src.needs]?.trim();
      if (!apiKey) throw new HttpError(400, `${src.label} non è ancora collegato: manca la variabile ${src.needs} su Railway`, 'not_configured');
      const { rows: people } = await db.query('SELECT oid, name, email FROM org_people');
      try {
        list = await src.read({ apiKey, people });
      } catch (err) {
        throw new HttpError(err.status === 403 ? 403 : 502, err.message);
      }
    } else {
      const token = await auth.graphTokenFor(req.user.id, src.scopes);
      try {
        list = await src.read({ token });
      } catch (err) {
        if (err.status === 403) throw new HttpError(403, `Microsoft non concede la lettura: serve il consenso amministratore a ${src.scopes.join(', ')} per l'app Alma Planner`, 'consent');
        throw err;
      }
    }
    res.json({ ...(await applySource(db, source, list, req.user.id)), warnings });
  });
}

module.exports = { registerSoftware };
