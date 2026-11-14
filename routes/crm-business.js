// Nuovi business (Dante 14/11/2026, canvas «Nuovi business · ingresso in nuove aree d'affari»):
// - iniziative con responsabile, sponsor, 5 fasi e un gate tra una fase e l'altra (Prosegui / Rimanda / Abbandona,
//   decide la direzione o lo sponsor; la decisione resta nelle riflessioni);
// - chat con l'assistente che conosce Almacis e il CRM e cerca in rete; ogni risposta diventa riflessione, clienti
//   target, gap, passi o piano con un clic;
// - clienti target con le sinergie trovate nel CRM, «Aggiungi al CRM come lead» (owner = responsabile);
// - cosa ci manca, piano d'ingresso con i passi, riflessioni e SWOT, radar dell'iniziativa (stesso punteggio delle BU);
// - analisi per la direzione: fase e gate, gap colmati, imbuto, attività del responsabile, spesa, rischi, semaforo.
// Tutti quelli che usano il CRM vedono le iniziative (regola «tutti vedono tutto»); le modifica chi le segue.
const { HttpError, v } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { scoreSignal, norm } = require('../lib/crm-radar');
const B = require('../lib/crm-business');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const month = () => todayRome().slice(0, 7);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOf = x => (x ? (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10) : null);
const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));
const keys = list => list.map(([k]) => k);
function money(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  let t = String(value).replace(/\s|€/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return n;
}
const strList = (value, field, max = 40) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return [...new Set(value.map(x => String(x ?? '').trim().slice(0, 120)).filter(Boolean))].slice(0, max);
};

function registerCrmBusiness(app, { db, notifier, radarFetch }) {
  const aiKey = () => process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '');
  const fetchImpl = () => radarFetch || fetch;

  async function byId(id) {
    const { rows: [i] } = await db.query(
      `SELECT i.*, o.name AS owner_name, o.email AS owner_email, s.name AS sponsor_name, a.label AS asa_label
         FROM crm_initiatives i LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users s ON s.id = i.sponsor_id
         LEFT JOIN crm_asa a ON a.key = i.asa WHERE i.id = $1`, [id]);
    if (!i) throw new HttpError(404, 'Iniziativa non trovata');
    return i;
  }
  const canEdit = (req, i) => req.crm.admin || [i.owner_id, i.sponsor_id, i.created_by].includes(req.user.id);
  const canDecide = (req, i) => req.crm.admin || i.sponsor_id === req.user.id;
  async function editable(req, id) {
    const i = await byId(id);
    if (!canEdit(req, i)) throw new HttpError(403, 'L\'iniziativa la modificano il responsabile, lo sponsor e la direzione');
    return i;
  }
  const iid = req => v.int(req.params.id, 'id', { min: 1 });
  async function child(table, id, label) {
    const { rows: [x] } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!x) throw new HttpError(404, `${label} non trovato`);
    return x;
  }
  async function userOk(id) {
    if (!id) return null;
    if (!(await db.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) throw new HttpError(400, 'Persona non trovata');
    return id;
  }
  const touch = id => db.query('UPDATE crm_initiatives SET updated_at = now() WHERE id = $1', [id]);
  const addSpend = (id, eur) => (eur > 0 ? db.query(
    'INSERT INTO crm_initiative_spend (initiative_id, month, eur) VALUES ($1, $2, $3) ON CONFLICT (initiative_id, month) DO UPDATE SET eur = crm_initiative_spend.eur + EXCLUDED.eur', [id, month(), eur]) : null);

  // azienda del CRM con quel nome (come il radar)
  async function matchSubject(name) {
    const n = norm(name).replace(/[^a-z0-9 ]/g, '').replace(/\b(srl|spa|s r l|s p a|snc|sas|scarl|soc coop)\b/g, '').trim();
    if (n.length < 3) return null;
    const { rows } = await db.query(
      `SELECT id, name, roles FROM crm_subjects WHERE merged_into IS NULL
          AND (lower(name) = lower($1) OR lower(short_name) = lower($1)
               OR regexp_replace(lower(name), '[^a-z0-9 ]|\\m(srl|spa|snc|sas)\\M', '', 'g') ILIKE $2)
        ORDER BY length(name) LIMIT 1`, [String(name).trim(), `%${n}%`]);
    return rows[0] || null;
  }

  // sinergie dal CRM per un'azienda: ruoli, contatti, colleghi che l'hanno incontrata o scritto, gruppo
  async function synergies(subjectId) {
    if (!subjectId) return [];
    const { rows: [s] } = await db.query(
      `SELECT s.id, s.name, s.roles, s.group_id, u.name AS owner_name, g.name AS group_name,
              (SELECT COUNT(*)::int FROM crm_contact_links l WHERE l.subject_id = s.id AND l.date_to IS NULL) AS contacts
         FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id LEFT JOIN crm_subjects g ON g.id = s.group_id WHERE s.id = $1`, [subjectId]);
    if (!s) return [];
    const out = [];
    const roleLabel = { cliente: 'cliente', partner: 'partner', fornitore: 'fornitore', lead: 'lead', concorrente: 'concorrente' };
    if (s.roles.length) out.push(`già nel CRM come ${s.roles.map(r => roleLabel[r]).join(' e ')}${s.owner_name ? ` · segue ${s.owner_name}` : ''}`);
    out.push(s.contacts ? `${s.contacts} ${s.contacts === 1 ? 'contatto' : 'contatti'} nel CRM` : 'nessun contatto nel CRM');
    const { rows: met } = await db.query(
      `SELECT m.organizer_name AS who, COUNT(DISTINCT m.id)::int AS n, MAX(m.start_at) AS last FROM crm_meetings m
         JOIN crm_meeting_links l ON l.meeting_id = m.id AND NOT l.removed
        WHERE (l.subject_id = $1 OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = $1))
          AND m.organizer_name IS NOT NULL GROUP BY m.organizer_name ORDER BY n DESC LIMIT 3`, [subjectId]);
    for (const m of met) out.push(`${m.who} l'ha ${m.n === 1 ? 'incontrata 1 volta' : `incontrata ${m.n} volte`} (ultima ${dayOf(m.last).split('-').reverse().join('/')})`);
    const { rows: wrote } = await db.query(
      `SELECT u.name AS who, COUNT(DISTINCT e.id)::int AS n FROM crm_emails e JOIN crm_email_links l ON l.email_id = e.id
         JOIN users u ON u.id = e.assigned_by
        WHERE l.subject_id = $1 OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = $1)
        GROUP BY u.name ORDER BY n DESC LIMIT 2`, [subjectId]);
    for (const w of wrote) out.push(`${w.who}: ${w.n} email collegate`);
    if (s.group_id) {
      const { rows: sib } = await db.query(`SELECT name, roles FROM crm_subjects WHERE (group_id = $1 OR id = $1) AND id <> $2 AND merged_into IS NULL AND roles && ARRAY['cliente','partner','fornitore'] LIMIT 3`, [s.group_id, s.id]);
      for (const x of sib) out.push(`stesso gruppo (${s.group_name}): ${x.name} è ${x.roles.filter(r => r !== 'lead').join(' e ')}`);
    }
    return out;
  }

  // quello che serve per lista e analisi: fase, gate corrente, gap, clienti, attività, spesa, semaforo
  async function stats(i) {
    const id = i.id;
    const [{ rows: gates }, { rows: [gap] }, { rows: tg }, { rows: [ai] }, { rows: [task] }, { rows: [hyp] }, last] = await Promise.all([
      db.query('SELECT * FROM crm_initiative_gates WHERE initiative_id = $1 ORDER BY n', [id]),
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ce')::int AS ok, COUNT(*) FILTER (WHERE status = 'manca')::int AS missing,
                       COALESCE(SUM(cost_eur) FILTER (WHERE status <> 'ce'), 0) AS cost FROM crm_initiative_gaps WHERE initiative_id = $1`, [id]),
      db.query(`SELECT status, COUNT(*)::int AS n FROM crm_initiative_targets WHERE initiative_id = $1 GROUP BY status`, [id]),
      db.query('SELECT COALESCE(SUM(eur), 0) AS eur FROM crm_initiative_spend WHERE initiative_id = $1', [id]),
      db.query(`SELECT COUNT(*) FILTER (WHERE done_at IS NULL AND due_date < $2)::int AS late FROM crm_initiative_tasks WHERE initiative_id = $1`, [id, todayRome()]),
      db.query(`SELECT COUNT(*)::int AS n FROM crm_initiative_notes WHERE initiative_id = $1 AND kind = 'ipotesi' AND check_status = 'da_verificare' AND deleted_at IS NULL`, [id]),
      lastActivity(i),
    ]);
    const by = Object.fromEntries(tg.map(r => [r.status, r.n]));
    const order = ['contattato', 'incontro', 'qualificati', 'opportunita'];
    const reached = k => order.slice(order.indexOf(k)).reduce((s, x) => s + (by[x] || 0), 0);
    const found = tg.filter(r => r.status !== 'scartato').reduce((s, r) => s + r.n, 0);
    const funnel = { individuati: found, contattati: reached('contattato'), incontrati: reached('incontro'), qualificati: reached('qualificati'), opportunita: by.opportunita || 0 };
    const pi = B.PHASE_KEYS.indexOf(i.phase);
    const gate = pi >= 0 ? gates.find(g => g.n === pi) || null : null;
    const spent = Number(i.spent_eur) + Number(ai.eur);
    const light = B.trafficLight({ phase: i.phase, gate: gate && { ...gate, due_date: dayOf(gate.due_date) }, lastActivity: last, spent, budget: Number(i.budget_eur), openHypotheses: hyp.n, lateTasks: task.late, today: todayRome() });
    return {
      gates: gates.map(g => ({ ...g, due_date: dayOf(g.due_date) })), gate: gate && { ...gate, due_date: dayOf(gate.due_date), late: gate.due_date && !gate.decision && dayOf(gate.due_date) < todayRome() },
      gaps: { total: gap.total, ok: gap.ok, missing: gap.missing, cost: Number(gap.cost) }, funnel, targets: found,
      spent, ai_eur: Number(ai.eur), lateTasks: task.late, openHypotheses: hyp.n, lastActivity: last, light,
    };
  }

  // ultima cosa fatta sull'iniziativa o con le sue aziende target
  async function lastActivity(i) {
    const { rows: [r] } = await db.query(
      `SELECT GREATEST(
         (SELECT MAX(created_at) FROM crm_initiative_notes WHERE initiative_id = $1 AND deleted_at IS NULL),
         (SELECT MAX(created_at) FROM crm_initiative_messages WHERE initiative_id = $1 AND role = 'user'),
         (SELECT MAX(done_at) FROM crm_initiative_tasks WHERE initiative_id = $1),
         (SELECT MAX(updated_at) FROM crm_initiative_targets WHERE initiative_id = $1),
         (SELECT MAX(updated_at) FROM crm_initiative_gaps WHERE initiative_id = $1),
         (SELECT MAX(m.start_at)::timestamptz FROM crm_meetings m JOIN crm_meeting_links l ON l.meeting_id = m.id AND NOT l.removed
             WHERE m.start_at <= now() AND l.subject_id IN (SELECT subject_id FROM crm_initiative_targets WHERE initiative_id = $1)),
         (SELECT MAX(e.sent_at) FROM crm_emails e JOIN crm_email_links l ON l.email_id = e.id
             WHERE l.subject_id IN (SELECT subject_id FROM crm_initiative_targets WHERE initiative_id = $1)),
         $2::timestamptz) AS at`, [i.id, i.created_at]);
    return r.at ? new Date(r.at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
  }

  // ── elenco e iniziativa ──────────────────────────────────────────────────────────────────────
  app.get('/api/crm/business', async (req, res) => {
    const { rows } = await db.query(
      `SELECT i.*, o.name AS owner_name, s.name AS sponsor_name FROM crm_initiatives i LEFT JOIN users o ON o.id = i.owner_id
         LEFT JOIN users s ON s.id = i.sponsor_id ORDER BY (i.phase = 'abbandonata'), i.updated_at DESC`);
    const list = await Promise.all(rows.map(async i => ({ ...i, started_on: dayOf(i.started_on), ...(await stats(i)) })));
    const open = list.filter(i => i.phase !== 'abbandonata');
    res.json({
      initiatives: list, ai: Boolean(aiKey()), meta: meta(),
      kpis: {
        open: open.length, targets: open.reduce((s, i) => s + i.funnel.individuati, 0), contacted: open.reduce((s, i) => s + i.funnel.contattati, 0),
        lateGates: open.filter(i => i.gate?.late).length, spent: open.reduce((s, i) => s + i.spent, 0), budget: open.reduce((s, i) => s + Number(i.budget_eur), 0),
      },
    });
  });
  const meta = () => ({ phases: B.PHASES, targetStatus: B.TARGET_STATUS, gapStatus: B.GAP_STATUS, gapKinds: B.GAP_KINDS, howKinds: B.HOW_KINDS, noteKinds: B.NOTE_KINDS, gates: B.GATES });

  async function fields(b, { partial }) {
    const f = pick({
      name: v.text(b.name, 'Nome', { max: 200, required: !partial }),
      description: v.text(b.description, 'Descrizione', { max: 2000 }),
      owner_id: b.owner_id === undefined ? undefined : await userOk(b.owner_id ? v.int(b.owner_id, 'Responsabile', { min: 1 }) : null),
      sponsor_id: b.sponsor_id === undefined ? undefined : await userOk(b.sponsor_id ? v.int(b.sponsor_id, 'Sponsor', { min: 1 }) : null),
      budget_eur: money(b.budget_eur, 'Budget'),
      spent_eur: money(b.spent_eur, 'Spese'),
      started_on: b.started_on === undefined ? undefined : v.date(b.started_on, 'Avviata il'),
    });
    if (f.budget_eur === null) f.budget_eur = 0;
    if (f.spent_eur === null) f.spent_eur = 0;
    if (f.started_on === null) delete f.started_on;
    if (b.asa !== undefined) {
      f.asa = b.asa ? String(b.asa) : null;
      if (f.asa && !(await db.query('SELECT 1 FROM crm_asa WHERE key = $1', [f.asa])).rowCount) throw new HttpError(400, 'ASA non trovata');
    }
    if (b.periods !== undefined) {
      if (typeof b.periods !== 'object' || !b.periods) throw new HttpError(400, 'Periodi non validi');
      f.periods = JSON.stringify(Object.fromEntries(B.PHASE_KEYS.map(k => [k, String(b.periods[k] || '').slice(0, 60)]).filter(([, x]) => x)));
    }
    if (!partial && !f.owner_id) throw new HttpError(400, 'Scegli il responsabile');
    return f;
  }

  app.post('/api/crm/business', async (req, res) => {
    const f = await fields(req.body, { partial: false });
    f.created_by = req.user.id;
    if (!f.sponsor_id && req.crm.admin) f.sponsor_id = req.user.id;
    const c = Object.keys(f);
    const { rows: [i] } = await db.query(`INSERT INTO crm_initiatives (${c.join(', ')}) VALUES (${c.map((_, k) => `$${k + 1}`).join(', ')}) RETURNING *`, Object.values(f));
    // G0 fra due settimane (aprire l'iniziativa dopo l'esplorazione), gli altri senza data finché non c'è il piano
    for (let n = 0; n < 5; n++) await db.query('INSERT INTO crm_initiative_gates (initiative_id, n, question, due_date) VALUES ($1, $2, $3, $4)', [i.id, n, B.GATES[n], n === 0 ? addDays(todayRome(), 14) : null]);
    res.status(201).json(i);
  });

  app.get('/api/crm/business/:id', async (req, res) => {
    const i = await byId(iid(req));
    res.json({ ...i, started_on: dayOf(i.started_on), ...(await stats(i)), canEdit: canEdit(req, i), canDecide: canDecide(req, i), ai: Boolean(aiKey()), meta: meta() });
  });
  app.patch('/api/crm/business/:id', async (req, res) => {
    const i = await editable(req, iid(req));
    const f = await fields(req.body, { partial: true });
    if (!Object.keys(f).length) return res.json(i);
    const c = Object.keys(f);
    const { rows: [out] } = await db.query(`UPDATE crm_initiatives SET ${c.map((k, n) => `${k} = $${n + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [i.id, ...Object.values(f)]);
    res.json(out);
  });
  app.delete('/api/crm/business/:id', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione elimina un\'iniziativa (si può anche abbandonarla dal gate)');
    await db.query('DELETE FROM crm_initiatives WHERE id = $1', [iid(req)]);
    res.json({ ok: true });
  });

  // ── gate ─────────────────────────────────────────────────────────────────────────────────────
  app.patch('/api/crm/business/:id/gates/:n', async (req, res) => {
    const i = await editable(req, iid(req));
    const n = v.int(req.params.n, 'gate', { min: 0, max: 4 });
    const f = pick({ question: v.text(req.body.question, 'Domanda', { max: 300 }), due_date: req.body.due_date === undefined ? undefined : v.date(req.body.due_date, 'Data del gate') });
    if (!Object.keys(f).length) throw new HttpError(400, 'Niente da cambiare');
    const c = Object.keys(f);
    const { rows: [g] } = await db.query(`UPDATE crm_initiative_gates SET ${c.map((k, x) => `${k} = $${x + 3}`).join(', ')}, alerted_at = NULL WHERE initiative_id = $1 AND n = $2 RETURNING *`, [i.id, n, ...Object.values(f)]);
    res.json(g);
  });
  app.post('/api/crm/business/:id/gates/:n/decide', async (req, res) => {
    const i = await byId(iid(req));
    if (!canDecide(req, i)) throw new HttpError(403, 'Il gate lo decide la direzione (o lo sponsor dell\'iniziativa)');
    const n = v.int(req.params.n, 'gate', { min: 0, max: 4 });
    if (i.phase === 'abbandonata') throw new HttpError(409, 'L\'iniziativa è stata abbandonata');
    if (B.PHASE_KEYS.indexOf(i.phase) !== n) throw new HttpError(409, 'Si decide solo il gate della fase in corso');
    const decision = v.oneOf(req.body.decision, 'Decisione', ['prosegui', 'rimanda', 'abbandona']);
    const note = v.text(req.body.note, 'Perché', { max: 2000, required: decision !== 'prosegui' }) || '';
    const { rows: [g] } = await db.query('SELECT * FROM crm_initiative_gates WHERE initiative_id = $1 AND n = $2', [i.id, n]);
    const label = { prosegui: 'Prosegui', rimanda: 'Rimandato', abbandona: 'Abbandonata' }[decision];
    if (decision === 'rimanda') {
      const due = v.date(req.body.due_date, 'Nuova data');
      if (!due) throw new HttpError(400, 'Scegli la nuova data del gate');
      await db.query('UPDATE crm_initiative_gates SET due_date = $3, alerted_at = NULL WHERE initiative_id = $1 AND n = $2', [i.id, n, due]);
    } else {
      await db.query('UPDATE crm_initiative_gates SET decision = $3, decision_note = $4, decided_by = $5, decided_at = now() WHERE initiative_id = $1 AND n = $2', [i.id, n, decision, note, req.user.id]);
      const next = decision === 'abbandona' ? 'abbandonata' : B.PHASE_KEYS[Math.min(n + 1, 4)];
      await db.query('UPDATE crm_initiatives SET phase = $2, abandoned_reason = $3, updated_at = now() WHERE id = $1', [i.id, next, decision === 'abbandona' ? note : '']);
    }
    await db.query(`INSERT INTO crm_initiative_notes (initiative_id, kind, title, body, author_id) VALUES ($1, 'decisione', $2, $3, $4)`,
      [i.id, `Gate G${n} · ${label}`, [g?.question, note, decision === 'rimanda' ? `Nuova data: ${String(req.body.due_date).split('-').reverse().join('/')}` : ''].filter(Boolean).join('\n'), req.user.id]);
    const others = [i.owner_id, i.sponsor_id].filter(x => x && x !== req.user.id);
    if (others.length) await notifier.notify({ userIds: [...new Set(others)], actorId: req.user.id, kind: 'crm', body: `ha deciso il gate G${n} di «${i.name}»: ${label}${note ? ` — ${note.slice(0, 120)}` : ''}`, link: `/crm/business/${i.id}/piano` });
    res.json(await byId(i.id));
  });

  // ── clienti target ──────────────────────────────────────────────────────────────────────────
  async function targetFields(b, { partial }) {
    const f = pick({
      name: v.text(b.name, 'Azienda', { max: 200, required: !partial }),
      segment: v.text(b.segment, 'Segmento', { max: 80 }),
      why: v.text(b.why, 'Perché', { max: 1000 }),
      priority: b.priority === undefined ? undefined : v.oneOf(b.priority, 'Priorità', ['alta', 'media', 'bassa']),
      status: b.status === undefined ? undefined : v.oneOf(b.status, 'Stato', keys(B.TARGET_STATUS)),
      note: v.text(b.note, 'Nota', { max: 2000 }),
      subject_id: b.subject_id === undefined ? undefined : (b.subject_id ? v.int(b.subject_id, 'Azienda del CRM', { min: 1 }) : null),
    });
    if (f.subject_id && !(await db.query('SELECT 1 FROM crm_subjects WHERE id = $1', [f.subject_id])).rowCount) throw new HttpError(400, 'Azienda del CRM non trovata');
    return f;
  }
  async function addTarget(i, t, userId) {
    const dup = await db.query('SELECT id FROM crm_initiative_targets WHERE initiative_id = $1 AND lower(name) = lower($2)', [i.id, t.name]);
    if (dup.rowCount) return null;
    const subject = t.subject_id ? { id: t.subject_id } : await matchSubject(t.name);
    const { rows: [x] } = await db.query(
      `INSERT INTO crm_initiative_targets (initiative_id, subject_id, name, segment, why, priority, status, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [i.id, subject?.id || null, t.name, t.segment || '', t.why || '', t.priority || 'media', t.status || 'da_contattare', t.note || '', userId]);
    return x;
  }
  app.get('/api/crm/business/:id/targets', async (req, res) => {
    const i = await byId(iid(req));
    const { rows } = await db.query(
      `SELECT t.*, s.name AS subject_name, s.roles AS subject_roles FROM crm_initiative_targets t LEFT JOIN crm_subjects s ON s.id = t.subject_id
        WHERE t.initiative_id = $1 ORDER BY (t.status = 'scartato'), CASE t.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, t.name`, [i.id]);
    res.json({ targets: await Promise.all(rows.map(async t => ({ ...t, synergies: await synergies(t.subject_id) }))) });
  });
  app.post('/api/crm/business/:id/targets', async (req, res) => {
    const i = await editable(req, iid(req));
    const t = await addTarget(i, await targetFields(req.body, { partial: false }), req.user.id);
    if (!t) throw new HttpError(409, 'Questa azienda è già tra i clienti target');
    await touch(i.id);
    res.status(201).json(t);
  });
  app.patch('/api/crm/business/targets/:tid', async (req, res) => {
    const t = await child('crm_initiative_targets', v.int(req.params.tid, 'id', { min: 1 }), 'Cliente target');
    await editable(req, t.initiative_id);
    const f = await targetFields(req.body, { partial: true });
    if (!Object.keys(f).length) return res.json(t);
    const c = Object.keys(f);
    const { rows: [out] } = await db.query(`UPDATE crm_initiative_targets SET ${c.map((k, n) => `${k} = $${n + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [t.id, ...Object.values(f)]);
    res.json(out);
  });
  app.delete('/api/crm/business/targets/:tid', async (req, res) => {
    const t = await child('crm_initiative_targets', v.int(req.params.tid, 'id', { min: 1 }), 'Cliente target');
    await editable(req, t.initiative_id);
    await db.query('DELETE FROM crm_initiative_targets WHERE id = $1', [t.id]);
    res.json({ ok: true });
  });
  // «Aggiungi al CRM come lead»: owner = responsabile dell'iniziativa, ASA dell'iniziativa, perché = quello del target
  app.post('/api/crm/business/targets/:tid/lead', async (req, res) => {
    const t = await child('crm_initiative_targets', v.int(req.params.tid, 'id', { min: 1 }), 'Cliente target');
    const i = await editable(req, t.initiative_id);
    if (t.subject_id) throw new HttpError(409, 'Questa azienda è già nel CRM');
    const found = await matchSubject(t.name);
    let subjectId = found?.id;
    if (!subjectId) {
      const asa = i.asa || (await db.query('SELECT key FROM crm_asa ORDER BY sort, label LIMIT 1')).rows[0]?.key;
      if (!asa) throw new HttpError(400, 'Scegli l\'ASA dell\'iniziativa (Modifica) prima di creare il lead');
      const { rows: [s] } = await db.query(
        `INSERT INTO crm_subjects (name, roles, asa, owner_id, lead_why, priority, segment, notes, created_by)
         VALUES ($1, '{lead}', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [t.name, [asa], i.owner_id || req.user.id, t.why.slice(0, 500), t.priority, t.segment.slice(0, 80), `Nuovo business: ${i.name}`, req.user.id]);
      subjectId = s.id;
    }
    await db.query('UPDATE crm_initiative_targets SET subject_id = $2, updated_at = now() WHERE id = $1', [t.id, subjectId]);
    res.status(201).json({ subject_id: subjectId, existed: Boolean(found) });
  });

  // ── cosa ci manca ───────────────────────────────────────────────────────────────────────────
  function gapFields(b, { partial }) {
    return pick({
      title: v.text(b.title, 'Requisito', { max: 200, required: !partial }),
      kind: b.kind === undefined ? undefined : (b.kind ? v.oneOf(b.kind, 'Tipo', B.GAP_KINDS) : ''),
      status: b.status === undefined ? undefined : v.oneOf(b.status, 'Stato', keys(B.GAP_STATUS)),
      how_kind: b.how_kind === undefined ? undefined : (b.how_kind ? v.oneOf(b.how_kind, 'Come', keys(B.HOW_KINDS)) : ''),
      how: v.text(b.how, 'Come colmarlo', { max: 1000 }),
      cost_eur: money(b.cost_eur, 'Costo'),
      timing: v.text(b.timing, 'Tempi', { max: 60 }),
      who: v.text(b.who, 'Chi', { max: 120 }),
    });
  }
  app.get('/api/crm/business/:id/gaps', async (req, res) => {
    const i = await byId(iid(req));
    res.json({ gaps: (await db.query(`SELECT * FROM crm_initiative_gaps WHERE initiative_id = $1 ORDER BY CASE status WHEN 'manca' THEN 0 WHEN 'in_corso' THEN 1 ELSE 2 END, sort, id`, [i.id])).rows });
  });
  async function insertGap(id, f) {
    const c = ['initiative_id', ...Object.keys(f)];
    return (await db.query(`INSERT INTO crm_initiative_gaps (${c.join(', ')}) VALUES (${c.map((_, k) => `$${k + 1}`).join(', ')}) RETURNING *`, [id, ...Object.values(f)])).rows[0];
  }
  app.post('/api/crm/business/:id/gaps', async (req, res) => {
    const i = await editable(req, iid(req));
    res.status(201).json(await insertGap(i.id, gapFields(req.body, { partial: false })));
  });
  app.patch('/api/crm/business/gaps/:gid', async (req, res) => {
    const g = await child('crm_initiative_gaps', v.int(req.params.gid, 'id', { min: 1 }), 'Requisito');
    await editable(req, g.initiative_id);
    const f = gapFields(req.body, { partial: true });
    if (!Object.keys(f).length) return res.json(g);
    const c = Object.keys(f);
    res.json((await db.query(`UPDATE crm_initiative_gaps SET ${c.map((k, n) => `${k} = $${n + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [g.id, ...Object.values(f)])).rows[0]);
  });
  app.delete('/api/crm/business/gaps/:gid', async (req, res) => {
    const g = await child('crm_initiative_gaps', v.int(req.params.gid, 'id', { min: 1 }), 'Requisito');
    await editable(req, g.initiative_id);
    await db.query('DELETE FROM crm_initiative_gaps WHERE id = $1', [g.id]);
    res.json({ ok: true });
  });

  // ── piano: passi per fase ───────────────────────────────────────────────────────────────────
  const TASK_SELECT = `SELECT t.*, u.name AS owner_name FROM crm_initiative_tasks t LEFT JOIN users u ON u.id = t.owner_id`;
  const taskOut = t => ({ ...t, due_date: dayOf(t.due_date), late: !t.done_at && t.due_date && dayOf(t.due_date) < todayRome() });
  app.get('/api/crm/business/:id/tasks', async (req, res) => {
    const i = await byId(iid(req));
    const { rows } = await db.query(`${TASK_SELECT} WHERE t.initiative_id = $1 ORDER BY array_position($2::text[], t.phase), (t.done_at IS NOT NULL) DESC, t.due_date NULLS LAST, t.sort, t.id`, [i.id, B.PHASE_KEYS]);
    res.json({ tasks: rows.map(taskOut) });
  });
  async function taskFields(b, { partial }) {
    return pick({
      title: v.text(b.title, 'Cosa fare', { max: 300, required: !partial }),
      phase: b.phase === undefined ? undefined : v.oneOf(b.phase, 'Fase', B.PHASE_KEYS),
      owner_id: b.owner_id === undefined ? undefined : await userOk(b.owner_id ? v.int(b.owner_id, 'Chi lo fa', { min: 1 }) : null),
      due_date: b.due_date === undefined ? undefined : v.date(b.due_date, 'Entro quando'),
    });
  }
  async function insertTask(i, f, userId) {
    f.phase = f.phase || (B.PHASE_KEYS.includes(i.phase) ? i.phase : 'esplorazione');
    if (f.owner_id === undefined) f.owner_id = i.owner_id;
    f.created_by = userId;
    const c = ['initiative_id', ...Object.keys(f)];
    return (await db.query(`INSERT INTO crm_initiative_tasks (${c.join(', ')}) VALUES (${c.map((_, k) => `$${k + 1}`).join(', ')}) RETURNING *`, [i.id, ...Object.values(f)])).rows[0];
  }
  app.post('/api/crm/business/:id/tasks', async (req, res) => {
    const i = await editable(req, iid(req));
    res.status(201).json(taskOut(await insertTask(i, await taskFields(req.body, { partial: false }), req.user.id)));
  });
  app.patch('/api/crm/business/tasks/:tid', async (req, res) => {
    const t = await child('crm_initiative_tasks', v.int(req.params.tid, 'id', { min: 1 }), 'Passo');
    await editable(req, t.initiative_id);
    const f = await taskFields(req.body, { partial: true });
    if (req.body.done !== undefined) Object.assign(f, req.body.done ? { done_at: new Date(), done_by: req.user.id } : { done_at: null, done_by: null });
    if (!Object.keys(f).length) return res.json(taskOut(t));
    const c = Object.keys(f);
    const out = (await db.query(`UPDATE crm_initiative_tasks SET ${c.map((k, n) => `${k} = $${n + 2}`).join(', ')}, alerted_at = NULL WHERE id = $1 RETURNING *`, [t.id, ...Object.values(f)])).rows[0];
    await touch(t.initiative_id);
    res.json(taskOut(out));
  });
  app.delete('/api/crm/business/tasks/:tid', async (req, res) => {
    const t = await child('crm_initiative_tasks', v.int(req.params.tid, 'id', { min: 1 }), 'Passo');
    await editable(req, t.initiative_id);
    await db.query('DELETE FROM crm_initiative_tasks WHERE id = $1', [t.id]);
    res.json({ ok: true });
  });

  // ── riflessioni e SWOT ──────────────────────────────────────────────────────────────────────
  app.get('/api/crm/business/:id/riflessioni', async (req, res) => {
    const i = await byId(iid(req));
    const { rows } = await db.query(`SELECT n.*, u.name AS author_name FROM crm_initiative_notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.initiative_id = $1 AND n.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC`, [i.id]);
    res.json({ notes: rows, swot: i.swot });
  });
  function noteFields(b, { partial }) {
    const f = pick({
      kind: b.kind === undefined ? undefined : v.oneOf(b.kind, 'Tipo', keys(B.NOTE_KINDS)),
      title: v.text(b.title, 'Titolo', { max: 200 }),
      body: v.text(b.body, 'Testo', { max: 8000 }),
      check_status: b.check_status === undefined ? undefined : (b.check_status ? v.oneOf(b.check_status, 'Verifica', ['da_verificare', 'confermata', 'smentita']) : ''),
      level: b.level === undefined ? undefined : (b.level ? v.oneOf(b.level, 'Livello', ['alto', 'medio', 'basso']) : ''),
      mitigation: v.text(b.mitigation, 'Mitigazione', { max: 500 }),
    });
    if (!partial && !f.title && !f.body) throw new HttpError(400, 'Scrivi la riflessione');
    if (!partial && f.kind === 'ipotesi' && !f.check_status) f.check_status = 'da_verificare';
    if (!partial && f.kind === 'decisione') throw new HttpError(400, 'Le decisioni si scrivono dal gate');
    return f;
  }
  async function insertNote(id, f, userId) {
    const c = ['initiative_id', 'author_id', ...Object.keys(f)];
    return (await db.query(`INSERT INTO crm_initiative_notes (${c.join(', ')}) VALUES (${c.map((_, k) => `$${k + 1}`).join(', ')}) RETURNING *`, [id, userId, ...Object.values(f)])).rows[0];
  }
  app.post('/api/crm/business/:id/riflessioni', async (req, res) => {
    const i = await editable(req, iid(req));
    const n = await insertNote(i.id, noteFields(req.body, { partial: false }), req.user.id);
    await touch(i.id);
    res.status(201).json(n);
  });
  app.patch('/api/crm/business/riflessioni/:nid', async (req, res) => {
    const n = await child('crm_initiative_notes', v.int(req.params.nid, 'id', { min: 1 }), 'Riflessione');
    const i = await editable(req, n.initiative_id);
    if (n.kind === 'decisione' && !req.crm.admin) throw new HttpError(403, 'Le decisioni dei gate non si cambiano');
    if (n.author_id !== req.user.id && !canDecide(req, i) && req.body.check_status === undefined) throw new HttpError(403, 'Cambia la riflessione solo chi l\'ha scritta');
    const f = noteFields(req.body, { partial: true });
    delete f.kind;
    if (!Object.keys(f).length) return res.json(n);
    const c = Object.keys(f);
    res.json((await db.query(`UPDATE crm_initiative_notes SET ${c.map((k, x) => `${k} = $${x + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [n.id, ...Object.values(f)])).rows[0]);
  });
  app.delete('/api/crm/business/riflessioni/:nid', async (req, res) => {
    const n = await child('crm_initiative_notes', v.int(req.params.nid, 'id', { min: 1 }), 'Riflessione');
    await editable(req, n.initiative_id);
    if (n.kind === 'decisione') throw new HttpError(403, 'Le decisioni dei gate restano');
    await db.query('UPDATE crm_initiative_notes SET deleted_at = now() WHERE id = $1', [n.id]);
    res.json({ ok: true });
  });
  app.put('/api/crm/business/:id/swot', async (req, res) => {
    const i = await editable(req, iid(req));
    const s = Object.fromEntries(['forze', 'debolezze', 'opportunita', 'minacce'].map(k => [k, String(req.body[k] ?? '').slice(0, 2000)]));
    const swot = { ...s, by: req.user.name || '', at: todayRome() };
    await db.query('UPDATE crm_initiatives SET swot = $2, updated_at = now() WHERE id = $1', [i.id, JSON.stringify(swot)]);
    res.json(swot);
  });

  // ── assistente ──────────────────────────────────────────────────────────────────────────────
  async function almacisContext() {
    const settings = await loadSettings(db);
    const { rows: asa } = await db.query('SELECT key, label FROM crm_asa ORDER BY sort, label');
    const bus = asa.map(a => {
      const p = settings.profiles?.[a.key] || {};
      return `- ${a.label}${p.description ? `: ${p.description}` : ''}${p.works?.length ? ` · lavori: ${p.works.slice(0, 8).join(', ')}` : ''}${p.soa?.length ? ` · SOA ${p.soa.join(', ')}` : ''}`;
    });
    const [{ rows: [n] }, { rows: clients }, { rows: partners }] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS subjects, (SELECT COUNT(*)::int FROM crm_contacts) AS contacts FROM crm_subjects WHERE merged_into IS NULL`),
      db.query(`SELECT name FROM crm_subjects WHERE merged_into IS NULL AND 'cliente' = ANY(roles) ORDER BY client_since DESC NULLS LAST, name LIMIT 60`),
      db.query(`SELECT name, roles, soa FROM crm_subjects WHERE merged_into IS NULL AND roles && ARRAY['partner','fornitore'] ORDER BY (jsonb_array_length(soa) > 0) DESC, name LIMIT 80`),
    ]);
    return [
      'Business unit (BU):', ...bus,
      `CRM: ${n.subjects} aziende, ${n.contacts} contatti.`,
      clients.length ? `Clienti: ${clients.map(c => c.name).join('; ')}.` : '',
      partners.length ? `Partner e fornitori: ${partners.map(p => `${p.name} (${p.roles.filter(r => r !== 'lead').join('/')}${p.soa?.length ? `, SOA ${p.soa.map(x => `${x.cat} ${x.cls}`).join(' ')}` : ''})`).join('; ')}.` : '',
    ].filter(Boolean).join('\n');
  }
  async function initiativeContext(i) {
    const [{ rows: t }, { rows: g }, { rows: n }, { rows: k }] = await Promise.all([
      db.query('SELECT name, segment, status, priority FROM crm_initiative_targets WHERE initiative_id = $1 ORDER BY id LIMIT 40', [i.id]),
      db.query('SELECT title, status, how FROM crm_initiative_gaps WHERE initiative_id = $1 ORDER BY id LIMIT 40', [i.id]),
      db.query(`SELECT kind, title, body FROM crm_initiative_notes WHERE initiative_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 12`, [i.id]),
      db.query(`SELECT title, phase, due_date, done_at FROM crm_initiative_tasks WHERE initiative_id = $1 ORDER BY id LIMIT 40`, [i.id]),
    ]);
    return [
      `«${i.name}»: ${i.description || '—'}. Fase: ${i.phase}. Responsabile: ${i.owner_name || '—'}. Budget ${Number(i.budget_eur)} €.`,
      t.length ? `Clienti target: ${t.map(x => `${x.name} (${x.segment || '—'}, ${x.status}, priorità ${x.priority})`).join('; ')}.` : 'Nessun cliente target ancora.',
      g.length ? `Cosa ci manca: ${g.map(x => `${x.title} [${x.status}]${x.how ? ` — ${x.how}` : ''}`).join('; ')}.` : '',
      k.length ? `Passi: ${k.map(x => `${x.title} (${x.phase}${x.done_at ? ', fatto' : x.due_date ? `, entro ${dayOf(x.due_date)}` : ''})`).join('; ')}.` : '',
      n.length ? `Riflessioni: ${n.map(x => `[${x.kind}] ${x.title}: ${x.body.slice(0, 200)}`).join(' | ')}` : '',
    ].filter(Boolean).join('\n');
  }
  const msgOut = async m => {
    const out = { ...m, cost_eur: Number(m.cost_eur) };
    if (m.role === 'assistant') {
      out.crm = [];
      for (const name of (m.proposals.crm || []).slice(0, 8)) {
        const s = await matchSubject(name);
        if (s) out.crm.push({ subject_id: s.id, name: s.name, roles: s.roles, synergies: await synergies(s.id) });
      }
    }
    return out;
  };
  async function chat(req, i) {
    const question = v.text(req.body.question, 'Domanda', { max: 4000, required: true });
    const key = aiKey();
    if (!key) throw new HttpError(503, 'L\'assistente si accende quando c\'è OPENAI_API_KEY su Railway');
    const id = i?.id || null;
    const { rows: hist } = await db.query(
      `SELECT role, body FROM (SELECT role, body, id FROM crm_initiative_messages WHERE initiative_id IS NOT DISTINCT FROM $1 AND ($1::int IS NOT NULL OR author_id = $2) ORDER BY id DESC LIMIT 10) x ORDER BY id`, [id, req.user.id]);
    const system = B.systemPrompt({ today: todayRome(), almacis: await almacisContext(), initiative: i ? await initiativeContext(i) : '' });
    await db.query(`INSERT INTO crm_initiative_messages (initiative_id, role, body, author_id) VALUES ($1, 'user', $2, $3)`, [id, question, req.user.id]);
    let r;
    try {
      r = await B.ask({ apiKey: key, system, history: hist, question, fetchImpl: fetchImpl() });
    } catch (err) {
      throw new HttpError(502, `L'assistente non ha risposto: ${String(err.message || err).slice(0, 200)}`);
    }
    const proposals = { targets: r.targets, gaps: r.gaps, steps: r.steps, plan: r.plan, crm: r.crm };
    const { rows: [m] } = await db.query(
      `INSERT INTO crm_initiative_messages (initiative_id, role, body, sources, proposals, cost_eur, author_id) VALUES ($1, 'assistant', $2, $3, $4, $5, $6) RETURNING *`,
      [id, r.answer, JSON.stringify(r.sources), JSON.stringify(proposals), r.costEur, req.user.id]);
    if (id) { await addSpend(id, r.costEur); await touch(id); }
    return msgOut(m);
  }
  app.get('/api/crm/business/:id/messages', async (req, res) => {
    const i = await byId(iid(req));
    const { rows } = await db.query(`SELECT m.*, u.name AS author_name FROM crm_initiative_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.initiative_id = $1 ORDER BY m.id`, [i.id]);
    const { rows: [c] } = await db.query('SELECT COALESCE(SUM(eur), 0) AS eur FROM crm_initiative_spend WHERE initiative_id = $1 AND month = $2', [i.id, month()]);
    res.json({ messages: await Promise.all(rows.map(msgOut)), monthCost: Number(c.eur), ai: Boolean(aiKey()) });
  });
  app.post('/api/crm/business/:id/messages', async (req, res) => {
    const i = await byId(iid(req));
    res.status(201).json(await chat(req, i));
  });
  app.post('/api/crm/business/idea', async (req, res) => { // «Chiedi all'assistente un'idea» dall'elenco, senza iniziativa
    res.status(201).json(await chat(req, null));
  });
  // azioni sotto una risposta: diventa riflessione, clienti target, gap, passi o piano
  app.post('/api/crm/business/messages/:mid/apply', async (req, res) => {
    const m = await child('crm_initiative_messages', v.int(req.params.mid, 'id', { min: 1 }), 'Messaggio');
    if (m.role !== 'assistant' || !m.initiative_id) throw new HttpError(400, 'Questa risposta non è di un\'iniziativa');
    const i = await editable(req, m.initiative_id);
    const what = v.oneOf(req.body.what, 'Azione', ['note', 'targets', 'gaps', 'steps', 'plan']);
    if (m.used?.[what]) throw new HttpError(409, 'Già fatto da questa risposta');
    const p = m.proposals || {};
    const only = Array.isArray(req.body.indexes) ? new Set(req.body.indexes.map(Number)) : null;
    const chosen = list => (list || []).filter((_, k) => !only || only.has(k));
    let added = 0;
    if (what === 'note') {
      const { rows: [q] } = await db.query(`SELECT body FROM crm_initiative_messages WHERE initiative_id = $1 AND role = 'user' AND id < $2 ORDER BY id DESC LIMIT 1`, [i.id, m.id]);
      const title = v.text(req.body.title, 'Titolo', { max: 200 }) || (q?.body || 'Dalla chat').slice(0, 120);
      await insertNote(i.id, { kind: 'chat', title, body: m.body.slice(0, 8000), message_id: m.id }, req.user.id);
      added = 1;
    } else if (what === 'targets') {
      for (const t of chosen(p.targets)) if (await addTarget(i, t, req.user.id)) added++;
    } else if (what === 'gaps') {
      for (const g of chosen(p.gaps)) {
        const dup = await db.query('SELECT 1 FROM crm_initiative_gaps WHERE initiative_id = $1 AND lower(title) = lower($2)', [i.id, g.title]);
        if (!dup.rowCount) { await insertGap(i.id, { title: g.title, kind: g.kind, status: g.status, how: g.how, timing: g.timing }); added++; }
      }
    } else if (what === 'steps') {
      for (const s of chosen(p.steps)) { await insertTask(i, { title: s.title, due_date: addDays(todayRome(), s.days) }, req.user.id); added++; }
    } else if (what === 'plan') {
      if (!p.plan?.length) throw new HttpError(400, 'Questa risposta non ha un piano');
      const periods = { ...i.periods };
      for (const ph of p.plan) {
        if (ph.when) periods[ph.phase] = ph.when;
        const n = B.PHASE_KEYS.indexOf(ph.phase);
        if (ph.gate) await db.query(`UPDATE crm_initiative_gates SET question = $3 WHERE initiative_id = $1 AND n = $2 AND decision = ''`, [i.id, n, ph.gate]);
        // passi solo per le fasi non ancora chiuse
        if (n >= B.PHASE_KEYS.indexOf(i.phase)) for (const s of ph.steps) { await insertTask(i, { title: s, phase: ph.phase, due_date: null }, req.user.id); added++; }
      }
      await db.query('UPDATE crm_initiatives SET periods = $2 WHERE id = $1', [i.id, JSON.stringify(periods)]);
    }
    await db.query(`UPDATE crm_initiative_messages SET used = used || jsonb_build_object($2::text, $3::int) WHERE id = $1`, [m.id, what, added]);
    await touch(i.id);
    res.json({ added });
  });

  // ── radar dell'iniziativa: stesso punteggio delle BU, profilo dell'iniziativa come una BU in più ──────
  app.get('/api/crm/business/:id/radar', async (req, res) => {
    const i = await byId(iid(req));
    const { rows } = await db.query(`SELECT * FROM crm_initiative_signals WHERE initiative_id = $1 AND status = 'nuovo' ORDER BY score DESC, created_at DESC LIMIT 60`, [i.id]);
    res.json({ profile: i.profile, signals: rows.map(s => ({ ...s, published_on: dayOf(s.published_on), deadline: dayOf(s.deadline) })), ai: Boolean(aiKey()) });
  });
  app.put('/api/crm/business/:id/profile', async (req, res) => {
    const i = await editable(req, iid(req));
    const b = req.body || {};
    const profile = pick({
      description: v.text(b.description, 'Cosa cerchiamo', { max: 1000 }) || '',
      works: strList(b.works, 'Lavori') || [], soa: strList(b.soa, 'SOA') || [], keywords: strList(b.keywords, 'Parole utili') || [],
      regions: strList(b.regions, 'Zone') || [], exclude: strList(b.exclude, 'Escludi') || [],
      amount_min: money(b.amount_min, 'Importo minimo') ?? undefined, amount_max: money(b.amount_max, 'Importo massimo') ?? undefined,
    });
    await db.query('UPDATE crm_initiatives SET profile = $2, updated_at = now() WHERE id = $1', [i.id, JSON.stringify(profile)]);
    res.json(profile);
  });
  app.post('/api/crm/business/:id/radar/run', async (req, res) => {
    const i = await editable(req, iid(req));
    const key = aiKey();
    if (!key) throw new HttpError(503, 'Il radar si accende quando c\'è OPENAI_API_KEY su Railway');
    const profile = { ...i.profile, description: i.profile?.description || i.description };
    if (!profile.description) throw new HttpError(400, 'Scrivi prima cosa cerca il radar (profilo dell\'iniziativa)');
    const { searchBu } = require('../lib/crm-radar-ai');
    const { rows: tg } = await db.query('SELECT name FROM crm_initiative_targets WHERE initiative_id = $1 AND status <> \'scartato\' LIMIT 30', [i.id]);
    let r;
    try {
      r = await searchBu({ apiKey: key, buLabel: `Nuovo business: ${i.name}`, profile, clients: tg.map(x => x.name), today: todayRome(), fetchImpl: fetchImpl() });
    } catch (err) { throw new HttpError(502, `Il radar non ha risposto: ${String(err.message || err).slice(0, 200)}`); }
    const { scoring } = await loadSettings(db);
    let added = 0;
    for (const s of r.signals) {
      const subject = s.entity ? await matchSubject(s.entity) : null;
      const sc = scoreSignal({ ...s, soa: [] }, profile, scoring, { relationship: subject ? (subject.roles.includes('cliente') ? 'client' : 'known') : 'unknown', today: todayRome() });
      const { rowCount } = await db.query(
        `INSERT INTO crm_initiative_signals (initiative_id, title, entity, kind, summary, why, url, region, amount, published_on, deadline, score, score_parts, subject_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (initiative_id, url) WHERE url <> '' DO NOTHING`,
        [i.id, s.title, s.entity, s.kind, s.summary, s.why, s.url, s.region, s.amount, s.published_on, s.deadline, sc.score, JSON.stringify(sc.parts), subject?.id || null]);
      added += rowCount;
    }
    await addSpend(i.id, r.costEur);
    res.json({ found: r.signals.length, added, cost: r.costEur });
  });
  app.post('/api/crm/business/signals/:sid/:action', async (req, res) => {
    const s = await child('crm_initiative_signals', v.int(req.params.sid, 'id', { min: 1 }), 'Segnale');
    const i = await editable(req, s.initiative_id);
    const action = v.oneOf(req.params.action, 'Azione', ['target', 'scarta']);
    if (action === 'target') {
      if (!s.entity) throw new HttpError(400, 'Il segnale non dice di quale azienda o ente si tratta');
      await addTarget(i, { name: s.entity, subject_id: s.subject_id, why: [s.title, s.why].filter(Boolean).join(' — ').slice(0, 1000), priority: s.score >= 70 ? 'alta' : 'media' }, req.user.id);
    }
    await db.query('UPDATE crm_initiative_signals SET status = $2 WHERE id = $1', [s.id, action === 'target' ? 'target' : 'scartato']);
    res.json({ ok: true });
  });

  // ── analisi per la direzione ────────────────────────────────────────────────────────────────
  app.get('/api/crm/business/:id/analisi', async (req, res) => {
    const i = await byId(iid(req));
    const st = await stats(i);
    const from = addDays(todayRome(), -27);
    const weekOf = d => Math.min(3, Math.max(0, Math.floor((Date.parse(`${dayOf(d)}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (7 * 86400000))));
    const weeks = [0, 1, 2, 3].map(k => ({ from: addDays(from, k * 7), meetings: 0, emails: 0, notes: 0, tasks: 0 }));
    const email = String(i.owner_email || '').toLowerCase();
    const owner = i.owner_id || 0;
    const targetsSql = 'SELECT subject_id FROM crm_initiative_targets WHERE initiative_id = $1 AND subject_id IS NOT NULL';
    const contactsSql = `SELECT contact_id FROM crm_contact_links WHERE subject_id IN (${targetsSql})`;
    const [{ rows: meets }, { rows: mails }, { rows: notes }, { rows: tasks }] = await Promise.all([
      db.query(`SELECT DISTINCT m.id, m.start_at AS d FROM crm_meetings m JOIN crm_meeting_links l ON l.meeting_id = m.id AND NOT l.removed
        WHERE (l.subject_id IN (${targetsSql}) OR l.contact_id IN (${contactsSql})) AND m.start_at::date BETWEEN $2 AND $3
          AND (lower(m.organizer_address) = $4 OR m.attendees @> jsonb_build_array(jsonb_build_object('address', $4::text)) OR m.linked_by = $5)`, [i.id, from, todayRome(), email, owner]),
      db.query(`SELECT DISTINCT e.id, e.sent_at AS d FROM crm_emails e JOIN crm_email_links l ON l.email_id = e.id
        WHERE (l.subject_id IN (${targetsSql}) OR l.contact_id IN (${contactsSql})) AND e.sent_at::date BETWEEN $2 AND $3
          AND (lower(e.from_address) = $4 OR e.assigned_by = $5)`, [i.id, from, todayRome(), email, owner]),
      db.query(`SELECT created_at AS d FROM crm_initiative_notes WHERE initiative_id = $1 AND author_id = $2 AND deleted_at IS NULL AND created_at::date >= $3
        UNION ALL SELECT n.created_at FROM crm_notes n WHERE n.author_id = $2 AND n.deleted_at IS NULL AND n.created_at::date >= $3
          AND n.subject_id IN (SELECT subject_id FROM crm_initiative_targets WHERE initiative_id = $1 AND subject_id IS NOT NULL)`, [i.id, owner, from]),
      db.query(`SELECT done_at AS d FROM crm_initiative_tasks WHERE initiative_id = $1 AND done_by = $2 AND done_at::date >= $3`, [i.id, owner, from]),
    ]);
    for (const [list, k] of [[meets, 'meetings'], [mails, 'emails'], [notes, 'notes'], [tasks, 'tasks']]) for (const x of list) if (x.d) weeks[weekOf(x.d)][k]++;
    const [{ rows: next }, { rows: risks }] = await Promise.all([
      db.query(`${TASK_SELECT} WHERE t.initiative_id = $1 AND t.done_at IS NULL ORDER BY t.due_date NULLS LAST, t.id LIMIT 8`, [i.id]),
      db.query(`SELECT * FROM crm_initiative_notes WHERE initiative_id = $1 AND kind = 'rischio' AND deleted_at IS NULL ORDER BY CASE level WHEN 'alto' THEN 0 WHEN 'medio' THEN 1 ELSE 2 END, id`, [i.id]),
    ]);
    res.json({ ...st, weeks, next: next.map(taskOut), risks, owner_name: i.owner_name, phase: i.phase, budget: Number(i.budget_eur) });
  });
  app.post('/api/crm/business/:id/sintesi', async (req, res) => { // sintesi dell'assistente per la riunione di direzione
    const i = await byId(iid(req));
    req.body = { question: 'Scrivi la sintesi per la riunione di direzione: cosa ha fatto il responsabile nelle ultime 4 settimane, a che punto è l\'iniziativa, cosa manca per il prossimo gate, le sinergie più forti con il CRM e una proposta di decisione. Massimo 8 righe. Liste targets, gaps, steps e plan vuote.' };
    const m = await chat(req, i);
    res.status(201).json(m);
  });
}

module.exports = { registerCrmBusiness };
