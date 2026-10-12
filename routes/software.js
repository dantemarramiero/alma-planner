// Censimento dei software aziendali: catalogo, tipologie di licenza con quantità e costi, chi ha cosa (persone di
// Microsoft), pacchetti per ruolo e collegamenti che si aggiornano da soli (Microsoft 365, software esterni di Entra).
// Tutto riservato agli amministratori: costi e licenze di ognuno non li vedono gli altri.
const { HttpError, v } = require('../lib/http');
const { SOURCES, applySource } = require('../lib/software-sources');

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

function registerSoftware(app, { db, auth, isAdmin }) {
  app.use('/api/software', (req, _res, next) => {
    if (!isAdmin(req)) return next(new HttpError(403, 'Il censimento dei software è riservato agli amministratori'));
    next();
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
    const [{ rows: list }, plans, { rows: syncs }, { rows: departed }, { rows: people }] = await Promise.all([
      db.query(`SELECT s.*, o.name AS owner_name FROM software s LEFT JOIN org_people o ON o.oid = s.owner_oid ORDER BY lower(s.name)`),
      plansFor(),
      db.query('SELECT s.source, s.synced_at, s.result, u.name AS synced_by_name FROM software_sync s LEFT JOIN users u ON u.id = s.synced_by'),
      db.query(
        `SELECT a.id, a.person_oid, a.person_name, a.person_email, a.source, p.name AS plan_name, s.name AS software_name, s.id AS software_id
           FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id JOIN software s ON s.id = p.software_id
          WHERE ${DEPARTED} AND s.status <> 'archiviato'
          ORDER BY a.person_name, s.name`),
      db.query('SELECT COUNT(*)::int AS n FROM org_people'),
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

    const active = software.filter(s => s.status !== 'archiviato');
    const freeCost = round(plans.filter(p => bySw.get(p.software_id)?.status !== 'archiviato')
      .reduce((a, p) => a + (p.free && p.monthly_unit ? p.free * p.monthly_unit : 0), 0));
    res.json({
      software,
      sync: Object.fromEntries(syncs.map(s => [s.source, s])),
      sources: Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label })),
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
    if (plan.external_id && (d.seats !== undefined || d.name !== undefined)) {
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
        `SELECT pp.package_id, p.id AS plan_id, p.name AS plan_name, p.unit_cost, p.billing, p.external_id, s.id AS software_id, s.name AS software_name
           FROM software_package_plans pp JOIN software_plans p ON p.id = pp.plan_id JOIN software s ON s.id = p.software_id
          ORDER BY lower(s.name), lower(p.name)`),
    ]);
    res.json(packages.map(k => {
      const plans = items.filter(i => i.package_id === k.id).map(i => ({ ...i, unit_cost: i.unit_cost === null ? null : Number(i.unit_cost), monthly_unit: monthly(i) === null ? null : round(monthly(i)) }));
      return { ...k, plans, monthly_cost: round(plans.reduce((a, p) => a + (p.monthly_unit || 0), 0)) };
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
    return { data: out, planIds: v.ids(body.plan_ids, 'licenze') };
  }
  async function setPlans(q, packageId, planIds) {
    if (planIds === undefined) return;
    if (planIds.length) {
      const { rows } = await q.query('SELECT id FROM software_plans WHERE id = ANY($1::int[])', [planIds]);
      if (rows.length !== planIds.length) throw new HttpError(400, 'Una delle licenze del pacchetto non esiste più');
    }
    await q.query('DELETE FROM software_package_plans WHERE package_id = $1', [packageId]);
    for (const id of planIds) await q.query('INSERT INTO software_package_plans (package_id, plan_id) VALUES ($1, $2)', [packageId, id]);
  }

  app.post('/api/software/packages', async (req, res) => {
    const { data: d, planIds } = readPackage(req.body || {}, { partial: false });
    try {
      const id = await db.tx(async q => {
        const { rows: [k] } = await q.query(
          `INSERT INTO software_packages (name, description, job_titles, departments) VALUES ($1, COALESCE($2, ''), COALESCE($3::text[], '{}'), COALESCE($4::text[], '{}')) RETURNING id`,
          [d.name, d.description, d.job_titles, d.departments]);
        await setPlans(q, k.id, planIds || []);
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
    const { data: d, planIds } = readPackage(req.body || {}, { partial: true });
    try {
      await db.tx(async q => {
        const cols = Object.keys(d);
        if (cols.length) await q.query(`UPDATE software_packages SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(d)]);
        await setPlans(q, id, planIds);
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

  // Assegna a una persona tutte le licenze del pacchetto che si gestiscono qui. Quelle che arrivano da un
  // collegamento (es. Microsoft 365) vanno assegnate là: si restituiscono come «da fare» con il link.
  app.post('/api/software/packages/:id/apply', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const oids = readOids(req.body);
    const { rows: plans } = await db.query(
      `SELECT p.id, p.name, p.external_id, s.name AS software_name, s.source
         FROM software_package_plans pp JOIN software_plans p ON p.id = pp.plan_id JOIN software s ON s.id = p.software_id
        WHERE pp.package_id = $1`, [id]);
    if (!plans.length) throw new HttpError(400, 'Il pacchetto non ha licenze');
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

  // scheda di un software (dopo /people e /packages, che altrimenti finirebbero qui)
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
    const token = await auth.graphTokenFor(req.user.id, src.scopes);
    let list;
    try {
      list = await src.read(token);
    } catch (err) {
      if (err.status === 403) throw new HttpError(403, `Microsoft non concede la lettura: serve il consenso amministratore a ${src.scopes.join(', ')} per l'app Alma Planner`, 'consent');
      throw err;
    }
    res.json(await applySource(db, source, list, req.user.id));
  });
}

module.exports = { registerSoftware };
