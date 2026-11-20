// «Porta avanti» e «I miei progetti» (canvas v9 approvato da Dante il 19/11/2026):
// - la sala di lancio propone squadra, piano a fasi (con compiti, persone e date) e obiettivo, calcolati dall'opportunità
//   del Radar (scadenza o bando atteso, chi conosce l'ente, BU, ufficio gare) o dall'iniziativa di Nuovi business (gate);
// - «Lancia il progetto» crea un progetto di Alma Space (crm_kind gara/settore): i compiti diventano ticket assegnati
//   (avviso ed email), l'ente entra nel CRM ed è collegato al progetto, l'opportunità resta nel Radar con «in corso»;
// - «I miei progetti»: il portafoglio di chi li segue (miei · del mio team · tutti), la giornata e i compiti della settimana;
// - la testata della scheda del progetto (tappe, quattro numeri) e il rendiconto (obiettivo contro fatto, CSV).
const { HttpError, v } = require('../lib/http');
const { loadSettings, managerOf } = require('../lib/crm-commerciale');
const { relationsFor, pathsOf } = require('../lib/crm-relazioni');
const { addDays } = require('../lib/workdays');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const STEPS = {
  gara: ['Seguo', 'Contatto fatto', 'Gara uscita', 'Offerta', 'Esito'],
  settore: ['G1 · Idea', 'G2 · Mercato e clienti', 'G3 · Cosa ci manca', 'G4 · Piano d\'ingresso', 'Go / No-go'],
};
const PHASE_OF_INITIATIVE = { esplorazione: 0, analisi: 1, piano: 2, ingresso: 3, consolidamento: 4, abbandonata: 0 };
const iso = d => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const later = (a, b) => (a > b ? a : b);
const num = (x, { min = 0, max = 1e12 } = {}) => { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0; };
const csvCell = x => { const s = String(x ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function registerCrmProgetti(app, { db, alerts, notifier }) {
  async function people() {
    const { rows } = await db.query('SELECT id, name, email FROM users');
    return rows;
  }
  const nameOf = (users, id) => users.find(u => u.id === id)?.name || '';

  // ── proposta della sala di lancio ─────────────────────────────────────────────────────────────
  async function signalProposal(req, id, users, settings) {
    const { rows: [g] } = await db.query(
      `SELECT g.*, s.name AS subject_name, a.label AS bu_label FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id
         LEFT JOIN crm_asa a ON a.key = g.bu WHERE g.id = $1`, [id]);
    if (!g) throw new HttpError(404, 'Opportunità non trovata');
    if (g.project_id) return { already: g.project_id };
    const today = todayRome();
    const me = req.user.id;
    const buManager = managerOf(settings.profiles[g.bu], users)?.id || null;
    const gare = (settings.radar.gare_users || []).filter(uid => users.some(u => u.id === uid && u.active !== false));
    const rel = g.subject_id ? (await relationsFor(db, [g.subject_id], settings.relazioni))[g.subject_id] : null;
    const paths = pathsOf(rel);
    const warm = paths.find(p => p.us);
    const owner = warm?.us?.id === me || !warm ? me : me; // il responsabile è chi lancia; chi conosce l'ente entra in squadra
    const team = [];
    const add = (uid, role, why, on = true) => { if (uid && !team.some(t => t.user_id === uid)) team.push({ user_id: uid, name: nameOf(users, uid), role, why, on }); };
    add(owner, 'responsabile', warm?.us?.id === owner ? `conosce ${warm.contact}${warm.job ? ` (${warm.job})` : ''}` : 'porta avanti l\'opportunità');
    for (const p of paths.filter(x => x.us)) add(p.us.id, 'strada calda', `conosce ${p.contact}${p.job ? ` (${p.job})` : ''}`);
    add(buManager, g.bu_label || 'BU', `responsabile della BU ${g.bu_label || ''}`.trim());
    for (const uid of gare.slice(0, 2)) add(uid, 'ufficio gare', 'requisiti, documenti e offerta');
    // date del piano: dalla scadenza della gara se c'è, se no dal bando atteso, se no a 2–3 mesi
    const deadline = iso(g.deadline);
    const expected = iso(g.expected_on);
    const bando = deadline ? addDays(deadline, -25) : expected || addDays(today, 60);
    const clamp = d => later(d, addDays(today, 1));
    const contactWho = warm?.us?.id || owner;
    const gareWho = gare[0] || owner;
    const techWho = buManager || owner;
    const entity = g.subject_name || g.entity || 'l\'ente';
    const phases = [
      { title: 'Agganciare l\'ente', tasks: [
        { title: warm ? `Chiamare ${warm.contact}` : `Trovare il referente in ${entity}`, owner_id: contactWho, due_date: clamp(addDays(today, 3)) },
        { title: 'Mandare referenze di lavori simili', owner_id: owner, due_date: clamp(addDays(today, 7)) }] },
      { title: 'Prepararsi alla gara', tasks: [
        { title: g.soa?.length ? `Verificare i requisiti SOA ${g.soa.join(', ')}` : 'Verificare requisiti e qualifiche', owner_id: gareWho, due_date: clamp(addDays(today, 14)) },
        { title: 'Sopralluogo', owner_id: techWho, due_date: clamp(addDays(today, 18)) },
        { title: 'Stima costi e margine', owner_id: techWho, due_date: clamp(later(addDays(today, 25), addDays(bando, -5))) }] },
      { title: 'Offerta', tasks: [
        { title: 'Documenti amministrativi', owner_id: gareWho, due_date: clamp(deadline ? addDays(deadline, -7) : addDays(bando, 10)) },
        { title: 'Offerta tecnica ed economica', owner_id: techWho, due_date: clamp(deadline ? addDays(deadline, -3) : addDays(bando, 25)) }] },
      { title: 'Esito', tasks: [
        { title: 'Registrare l\'esito e le lezioni', owner_id: owner, due_date: clamp(addDays(deadline || addDays(bando, 30), 30)) }] },
    ];
    const value = g.amount != null ? Number(g.amount) : 0;
    const probability = Math.max(10, Math.min(70, Math.round((g.score || 0) * 0.45)));
    return {
      kind: 'gara', source: { type: 'signal', id: g.id }, name: g.title, entity, subject_id: g.subject_id, bu: g.bu, bu_label: g.bu_label || '',
      stage: g.stage, deadline, expected_on: expected, amount: value || null, score: g.score, score_parts: g.score_parts || {}, why: g.why || '',
      warm: rel?.level || '', warm_paths: paths.slice(0, 3).map(p => ({ us: p.us?.name || '', contact: p.contact, job: p.job || '', level: p.level })),
      url: g.url || '', soa: g.soa || [], cig: g.cig || '', region: g.region || '', place: g.place || '',
      owner_id: owner, team, phases, steps: STEPS.gara,
      goal: { value, probability, margin: 12, hours: value >= 5e6 ? 240 : value >= 1e6 ? 160 : 80 },
    };
  }

  async function initiativeProposal(req, id, users) {
    const { rows: [i] } = await db.query('SELECT i.*, a.label AS asa_label FROM crm_initiatives i LEFT JOIN crm_asa a ON a.key = i.asa WHERE i.id = $1', [id]);
    if (!i) throw new HttpError(404, 'Iniziativa non trovata');
    if (i.project_id) return { already: i.project_id };
    const today = todayRome();
    const owner = i.owner_id || req.user.id;
    const [{ rows: gates }, { rows: tasks }, { rows: targets }] = await Promise.all([
      db.query('SELECT n, question, due_date, decision FROM crm_initiative_gates WHERE initiative_id = $1 ORDER BY n', [id]),
      db.query('SELECT title, owner_id, due_date, phase FROM crm_initiative_tasks WHERE initiative_id = $1 AND done_at IS NULL ORDER BY sort, id', [id]),
      db.query('SELECT count(*)::int AS n FROM crm_initiative_targets WHERE initiative_id = $1', [id]).catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    const at = PHASE_OF_INITIATIVE[i.phase] ?? 0;
    const team = [];
    const add = (uid, role, why, on = true) => { if (uid && !team.some(t => t.user_id === uid)) team.push({ user_id: uid, name: nameOf(users, uid), role, why, on }); };
    add(owner, 'responsabile', 'responsabile dell\'iniziativa');
    add(i.sponsor_id, 'sponsor', 'decide ai gate per la direzione');
    for (const t of tasks) add(t.owner_id, 'squadra', 'ha compiti nell\'iniziativa');
    const phaseKeys = ['esplorazione', 'analisi', 'piano', 'ingresso', 'consolidamento'];
    const phases = [1, 2, 3, 4].map(n => {
      const gate = gates.find(x => x.n === n);
      const due = iso(gate?.due_date) || addDays(today, 30 * n);
      const own = tasks.filter(t => t.phase === phaseKeys[n - 1]).map(t => ({ title: t.title, owner_id: t.owner_id || owner, due_date: later(iso(t.due_date) || addDays(due, -7), addDays(today, 1)) }));
      return { title: `G${n} · ${STEPS.settore[n].split(' · ')[1] || ''}`.replace(/ · $/, ''), skip: n - 1 < at,
        tasks: [...own, { title: `Dossier del gate G${n} per la direzione`, owner_id: owner, due_date: later(due, addDays(today, 1)) }] };
    }).filter(p => !p.skip).map(({ skip, ...p }) => p);
    const budget = Number(i.budget_eur) || 0;
    return {
      kind: 'settore', source: { type: 'initiative', id: i.id }, name: i.name, entity: i.asa_label || 'Nuovo settore', subject_id: null, bu: i.asa || '', bu_label: i.asa_label || '',
      description: i.description || '', targets: targets[0]?.n || 0, phase: i.phase, started_on: iso(i.started_on), spent: Number(i.spent_eur) || 0,
      next_gate: gates.find(x => x.n > at && !x.decision) ? { n: gates.find(x => x.n > at && !x.decision).n, due_date: iso(gates.find(x => x.n > at && !x.decision).due_date) } : null,
      owner_id: owner, team, phases, steps: STEPS.settore, step: Math.min(at, 4),
      goal: { value: 0, probability: 0, margin: 0, hours: 80, budget },
    };
  }

  app.get('/api/crm/lancio/proposta', async (req, res) => {
    const [users, settings] = await Promise.all([people(), loadSettings(db)]);
    const out = req.query.signal ? await signalProposal(req, v.int(req.query.signal, 'opportunità', { min: 1 }), users, settings)
      : req.query.initiative ? await initiativeProposal(req, v.int(req.query.initiative, 'iniziativa', { min: 1 }), users)
        : null;
    if (!out) throw new HttpError(400, 'Serve un\'opportunità o un\'iniziativa');
    res.json({ ...out, users: users.filter(u => u.active !== false).map(u => ({ id: u.id, name: u.name })) });
  });

  // ── «Lancia il progetto» ───────────────────────────────────────────────────────────────────────
  app.post('/api/crm/lancio', async (req, res) => {
    const b = req.body || {};
    const users = await people();
    const known = new Set(users.map(u => u.id));
    const signalId = b.signal_id ? v.int(b.signal_id, 'opportunità', { min: 1 }) : null;
    const initiativeId = b.initiative_id ? v.int(b.initiative_id, 'iniziativa', { min: 1 }) : null;
    if (!signalId === !initiativeId) throw new HttpError(400, 'Serve un\'opportunità o un\'iniziativa');
    const ownerId = known.has(Number(b.owner_id)) ? Number(b.owner_id) : req.user.id;
    const memberIds = [...new Set((Array.isArray(b.member_ids) ? b.member_ids : []).map(Number).filter(id => known.has(id) && id !== ownerId))];
    const today = todayRome();
    const phases = (Array.isArray(b.phases) ? b.phases : []).slice(0, 8).map(p => ({
      title: String(p?.title || '').trim().slice(0, 120),
      tasks: (Array.isArray(p?.tasks) ? p.tasks : []).slice(0, 30).map(t => ({
        title: String(t?.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        owner_id: known.has(Number(t?.owner_id)) ? Number(t.owner_id) : ownerId,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(t?.due_date || '')) ? String(t.due_date) : null,
      })).filter(t => t.title),
    })).filter(p => p.title || p.tasks.length);
    const g = b.goal || {};
    const goal = { value: num(g.value), probability: num(g.probability, { max: 100 }), margin: num(g.margin, { max: 100 }), hours: num(g.hours, { max: 100000 }), budget: num(g.budget) };
    const created = [];
    const result = await db.tx(async q => {
      let src, kind, name, color, desc, subjectId = null, step = 0;
      if (signalId) {
        const { rows: [s] } = await q.query('SELECT * FROM crm_signals WHERE id = $1 FOR UPDATE', [signalId]);
        if (!s) throw new HttpError(404, 'Opportunità non trovata');
        if (s.project_id) throw new HttpError(409, 'Questa opportunità è già stata portata avanti');
        src = s; kind = 'gara'; color = '#FF8A26';
        name = String(b.name || s.title).trim().slice(0, 200);
        desc = [s.entity, s.summary || s.why].filter(Boolean).join(' · ').slice(0, 2000);
        subjectId = s.subject_id;
        // l'ente entra nel CRM se non c'è (come lead della BU dell'opportunità)
        if (!subjectId && s.entity) {
          const { rows: [dup] } = await q.query('SELECT id FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1', [s.entity.trim()]);
          if (dup) subjectId = dup.id;
          else {
            const { rows: [n] } = await q.query(
              `INSERT INTO crm_subjects (name, roles, asa, owner_id, lead_why, origin, created_by, created_quick)
               VALUES ($1, '{lead}', $2, $3, $4, 'Radar', $5, true) RETURNING id, lead_stage`,
              [s.entity.trim().slice(0, 200), s.bu ? [s.bu] : [], ownerId, `Dal Radar: ${s.title}`.slice(0, 1000), req.user.id]);
            await q.query('INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)', [n.id, n.lead_stage, 'portata avanti dal Radar', req.user.id]);
            subjectId = n.id;
          }
          await q.query('UPDATE crm_signals SET subject_id = $2 WHERE id = $1', [s.id, subjectId]);
        }
        step = 0;
      } else {
        const { rows: [i] } = await q.query('SELECT * FROM crm_initiatives WHERE id = $1 FOR UPDATE', [initiativeId]);
        if (!i) throw new HttpError(404, 'Iniziativa non trovata');
        if (i.project_id) throw new HttpError(409, 'Questa iniziativa ha già il suo progetto');
        src = i; kind = 'settore'; color = '#3A3835';
        name = String(b.name || i.name).trim().slice(0, 200);
        desc = String(i.description || '').slice(0, 2000);
        step = Math.min(PHASE_OF_INITIATIVE[i.phase] ?? 0, 4);
      }
      const allDue = phases.flatMap(p => p.tasks.map(t => t.due_date)).filter(Boolean).sort();
      const { rows: [p] } = await q.query(
        `INSERT INTO projects (name, description, color, status, start_date, end_date, owner_id, crm_kind, crm_goal, crm_step)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [name, desc, color, today, allDue.length ? later(allDue[allDue.length - 1], today) : null, ownerId, kind, JSON.stringify(goal), step]);
      const pid = p.id;
      const add = async uid => q.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [pid, uid, req.user.id]);
      if (ownerId !== req.user.id) await add(req.user.id);
      for (const uid of memberIds) await add(uid);
      const { rows: [{ pos }] } = await q.query('SELECT COALESCE(MAX(position), 0) AS pos FROM tickets');
      let n = 0;
      for (const [pi, ph] of phases.entries()) {
        for (const t of ph.tasks) {
          n += 1;
          const start = t.due_date && t.due_date < addDays(today, 5) ? (t.due_date < today ? t.due_date : today) : t.due_date ? addDays(t.due_date, -4) : null;
          const { rows: [tk] } = await q.query(
            `INSERT INTO tickets (project_id, title, description, status, start_date, due_date, position, created_by, crm_phase)
             VALUES ($1, $2, $3, 'todo', $4, $5, $6, $7, $8) RETURNING id, title, due_date`,
            [pid, t.title, ph.title ? `Fase ${pi + 1} · ${ph.title}` : '', start, t.due_date, Number(pos) + n, req.user.id, pi + 1]);
          await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tk.id, t.owner_id]);
          if (t.owner_id !== ownerId) await add(t.owner_id);
          created.push({ ticket: { id: tk.id, title: tk.title, due_date: iso(tk.due_date) }, user: t.owner_id });
        }
      }
      if (subjectId) await q.query("INSERT INTO crm_project_links (project_id, subject_id, linked_by, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [pid, subjectId, req.user.id, signalId ? 'ente' : '']);
      if (signalId) {
        await q.query(`INSERT INTO crm_project_links (project_id, subject_id, contact_id, role, linked_by)
                       SELECT $1, subject_id, contact_id, role, $3 FROM crm_signal_links WHERE signal_id = $2 ON CONFLICT DO NOTHING`, [pid, signalId, req.user.id]);
      }
      if (signalId) {
        await q.query(`UPDATE crm_signals SET project_id = $2, status = CASE WHEN status IN ('nuovo', 'interessa') THEN 'interessa' ELSE status END,
                         decided_by = COALESCE(decided_by, $3), decided_at = COALESCE(decided_at, now()) WHERE id = $1`, [signalId, pid, req.user.id]);
      } else {
        await q.query('UPDATE crm_initiatives SET project_id = $2, updated_at = now() WHERE id = $1', [initiativeId, pid]);
      }
      return { project_id: pid, kind, tasks: n, people: new Set(created.map(c => c.user)).size, subject_id: subjectId, source: src.id };
    });
    res.status(201).json(result);
    // dopo la risposta: i compiti arrivano alle persone (campanella, telefono, email)
    for (const c of created) {
      if (c.user === req.user.id) continue;
      (alerts ? alerts.ticketAssigned(c.ticket, [c.user], req.user) : Promise.resolve()).catch(() => {});
    }
  });

  // ── dati di un progetto del CRM (testata della scheda, carte di «I miei progetti», rendiconto) ─────────
  async function summaries(projectIds, users) {
    if (!projectIds.length) return [];
    const today = todayRome();
    const [{ rows: ps }, { rows: tk }, { rows: mem }, { rows: sigs }, { rows: inits }, { rows: meet }] = await Promise.all([
      db.query('SELECT id, name, owner_id, status, crm_kind, crm_goal, crm_step, start_date, end_date, created_at FROM projects WHERE id = ANY($1::int[])', [projectIds]),
      db.query(`SELECT t.id, t.project_id, t.title, t.status, t.due_date, t.crm_phase, t.hours_actual, t.hours_estimated, t.updated_at,
                       COALESCE(array_agg(a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') AS assignee_ids
                  FROM tickets t LEFT JOIN ticket_assignees a ON a.ticket_id = t.id WHERE t.project_id = ANY($1::int[]) GROUP BY t.id`, [projectIds]),
      db.query('SELECT project_id, user_id FROM project_members WHERE project_id = ANY($1::int[])', [projectIds]),
      db.query(`SELECT g.id, g.project_id, g.title, g.entity, g.bu, g.amount, g.deadline, g.expected_on, g.stage, g.score, s.name AS subject_name, a.label AS bu_label
                  FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id LEFT JOIN crm_asa a ON a.key = g.bu WHERE g.project_id = ANY($1::int[])`, [projectIds]),
      db.query(`SELECT i.id, i.project_id, i.name, i.asa, i.phase, i.budget_eur, i.spent_eur, a.label AS asa_label,
                       (SELECT json_build_object('n', gg.n, 'due_date', gg.due_date) FROM crm_initiative_gates gg WHERE gg.initiative_id = i.id AND gg.decision = '' AND gg.n > 0 ORDER BY gg.n LIMIT 1) AS next_gate
                  FROM crm_initiatives i LEFT JOIN crm_asa a ON a.key = i.asa WHERE i.project_id = ANY($1::int[])`, [projectIds]),
      db.query("SELECT project_id, count(*)::int AS n, min(start_at) FILTER (WHERE start_at >= (now() AT TIME ZONE 'Europe/Rome')) AS next_at FROM project_meetings WHERE project_id = ANY($1::int[]) GROUP BY project_id", [projectIds]).catch(() => ({ rows: [] })),
    ]);
    return ps.map(p => {
      const tasks = tk.filter(t => t.project_id === p.id);
      const open = tasks.filter(t => t.status !== 'done');
      const late = open.filter(t => t.due_date && iso(t.due_date) < today);
      const next = open.filter(t => t.due_date).sort((a, b) => iso(a.due_date).localeCompare(iso(b.due_date)))[0] || open[0] || null;
      const sig = sigs.find(s => s.project_id === p.id);
      const ini = inits.find(i => i.project_id === p.id);
      const goal = p.crm_goal || {};
      const hours = tasks.reduce((s, t) => s + (Number(t.hours_actual) || 0), 0);
      const team = [p.owner_id, ...mem.filter(m => m.project_id === p.id).map(m => m.user_id)].filter((x, i, a) => x && a.indexOf(x) === i);
      const m = meet.find(x => x.project_id === p.id);
      return {
        id: p.id, name: p.name, kind: p.crm_kind, status: p.status, owner_id: p.owner_id, owner_name: nameOf(users, p.owner_id),
        step: p.crm_step, steps: STEPS[p.crm_kind] || STEPS.gara, goal,
        weighted: Math.round((Number(goal.value) || 0) * (Number(goal.probability) || 0) / 100),
        tasks_total: tasks.length, tasks_done: tasks.length - open.length, tasks_late: late.length,
        pct: tasks.length ? Math.round(100 * (tasks.length - open.length) / tasks.length) : 0,
        hours: Math.round(hours * 10) / 10,
        next: next ? { id: next.id, title: next.title, due_date: iso(next.due_date), who: nameOf(users, next.assignee_ids[0]), late: Boolean(next.due_date && iso(next.due_date) < today) } : null,
        team: team.map(id => ({ id, name: nameOf(users, id) })),
        meetings: m?.n || 0, next_meeting: m?.next_at || null,
        source: sig ? { type: 'signal', id: sig.id, entity: sig.subject_name || sig.entity || '', bu: sig.bu, bu_label: sig.bu_label || '', amount: sig.amount != null ? Number(sig.amount) : null,
          deadline: iso(sig.deadline), expected_on: iso(sig.expected_on), stage: sig.stage, score: sig.score }
          : ini ? { type: 'initiative', id: ini.id, entity: ini.asa_label || '', bu: ini.asa || '', bu_label: ini.asa_label || '', budget: Number(ini.budget_eur) || 0,
            spent: Number(ini.spent_eur) || 0, phase: ini.phase, next_gate: ini.next_gate ? { n: ini.next_gate.n, due_date: iso(ini.next_gate.due_date) } : null }
            : null,
      };
    });
  }

  async function myBus(userId) {
    const [settings, users] = await Promise.all([loadSettings(db), people()]);
    return Object.entries(settings.profiles).filter(([, p]) => managerOf(p, users)?.id === userId).map(([k]) => k);
  }

  app.get('/api/crm/progetti', async (req, res) => {
    const vista = ['miei', 'team', 'tutti'].includes(req.query.vista) ? req.query.vista : 'miei';
    const me = req.user.id;
    const users = await people();
    let ids;
    if (vista === 'miei') {
      ({ rows: ids } = await db.query(`SELECT p.id FROM projects p WHERE p.crm_kind <> '' AND p.status <> 'archived'
        AND (p.owner_id = $1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1))`, [me]));
    } else if (vista === 'team') {
      const bus = await myBus(me);
      ({ rows: ids } = await db.query(`SELECT p.id FROM projects p WHERE p.crm_kind <> '' AND p.status <> 'archived' AND (
          EXISTS (SELECT 1 FROM crm_signals g WHERE g.project_id = p.id AND g.bu = ANY($1::text[]))
          OR EXISTS (SELECT 1 FROM crm_initiatives i WHERE i.project_id = p.id AND i.asa = ANY($1::text[]))
          OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))`, [bus, me]));
    } else {
      ({ rows: ids } = await db.query("SELECT id FROM projects WHERE crm_kind <> '' AND status <> 'archived'"));
    }
    const list = await summaries(ids.map(r => r.id), users);
    const today = todayRome();
    const weekEnd = addDays(today, 7);
    // i miei compiti dei progetti del CRM: in ritardo, oggi e questa settimana
    const { rows: mine } = await db.query(
      `SELECT t.id, t.title, t.due_date, t.status, p.id AS project_id, p.name AS project_name
         FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id AND a.user_id = $1 JOIN projects p ON p.id = t.project_id AND p.crm_kind <> ''
        WHERE t.status <> 'done' AND (t.due_date IS NULL OR t.due_date <= $2) ORDER BY t.due_date NULLS LAST, t.id LIMIT 40`, [me, weekEnd]);
    const { rows: meetings } = await db.query(
      `SELECT m.id, m.subject, m.start_at, m.end_at, m.location, p.id AS project_id, p.name AS project_name
         FROM project_meetings m JOIN projects p ON p.id = m.project_id AND p.crm_kind <> ''
        WHERE m.start_at::date = $1::date
          AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2))
        ORDER BY m.start_at`, [today, me]).catch(() => ({ rows: [] }));
    res.json({
      vista, projects: list,
      tasks: mine.map(t => ({ ...t, due_date: iso(t.due_date), late: Boolean(t.due_date && iso(t.due_date) < today), today: iso(t.due_date) === today })),
      meetings,
    });
  });

  async function crmProject(req, id) {
    const { rows: [p] } = await db.query('SELECT id, crm_kind FROM projects WHERE id = $1', [id]);
    if (!p || !p.crm_kind) throw new HttpError(404, 'Non è un progetto del CRM');
    return p;
  }
  app.get('/api/crm/progetti/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await crmProject(req, id);
    const users = await people();
    const [s] = await summaries([id], users);
    const { rows: links } = await db.query(
      `SELECT l.subject_id, l.contact_id, s.name AS subject_name, s.roles, trim(concat_ws(' ', c.first_name, c.last_name)) AS contact_name
         FROM crm_project_links l LEFT JOIN crm_subjects s ON s.id = l.subject_id LEFT JOIN crm_contacts c ON c.id = l.contact_id
        WHERE l.project_id = $1 ORDER BY l.created_at`, [id]);
    res.json({ ...s, links });
  });

  // tappa raggiunta (Seguo → … → Esito; G1 → … → Go/No-go) e obiettivo: chi gestisce il progetto
  app.patch('/api/crm/progetti/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await crmProject(req, id);
    const { rows: [p] } = await db.query(
      'SELECT owner_id, crm_goal, EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = $2) AS member FROM projects WHERE id = $1', [id, req.user.id]);
    if (!req.crm.admin && p.owner_id !== req.user.id && !p.member) throw new HttpError(403, 'Solo chi è nel progetto può cambiarlo');
    const b = req.body || {};
    if (b.step !== undefined) await db.query('UPDATE projects SET crm_step = $2, updated_at = now() WHERE id = $1', [id, v.int(b.step, 'tappa', { min: 0, max: 4 })]);
    if (b.goal && typeof b.goal === 'object') {
      const g = { ...(p.crm_goal || {}) };
      for (const k of ['value', 'probability', 'margin', 'hours', 'budget']) if (b.goal[k] !== undefined) g[k] = num(b.goal[k], { max: ['probability', 'margin'].includes(k) ? 100 : 1e12 });
      await db.query('UPDATE projects SET crm_goal = $2, updated_at = now() WHERE id = $1', [id, JSON.stringify(g)]);
    }
    const [s] = await summaries([id], await people());
    res.json(s);
  });

  // rendiconto: obiettivo contro fatto, compiti per fase e ore per persona (anche in CSV)
  app.get('/api/crm/progetti/:id/rendiconto', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await crmProject(req, id);
    const users = await people();
    const [s] = await summaries([id], users);
    const { rows: tasks } = await db.query(
      `SELECT t.id, t.title, t.status, t.due_date, t.crm_phase, t.hours_actual, t.updated_at, t.description,
              COALESCE(array_agg(a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') AS assignee_ids
         FROM tickets t LEFT JOIN ticket_assignees a ON a.ticket_id = t.id WHERE t.project_id = $1 GROUP BY t.id ORDER BY t.crm_phase NULLS LAST, t.due_date NULLS LAST, t.id`, [id]);
    const [{ rows: [{ notes }] }, { rows: [{ meetings }] }] = await Promise.all([
      db.query('SELECT count(*)::int AS notes FROM notes WHERE project_id = $1', [id]).catch(() => ({ rows: [{ notes: 0 }] })),
      db.query('SELECT count(*)::int AS meetings FROM project_meetings WHERE project_id = $1', [id]).catch(() => ({ rows: [{ meetings: 0 }] })),
    ]);
    const byPerson = {};
    for (const t of tasks) for (const uid of t.assignee_ids) {
      const r = byPerson[uid] || (byPerson[uid] = { id: uid, name: nameOf(users, uid), tasks: 0, done: 0, hours: 0 });
      r.tasks += 1; if (t.status === 'done') r.done += 1; r.hours += (Number(t.hours_actual) || 0) / t.assignee_ids.length;
    }
    const rows = tasks.map(t => ({ id: t.id, title: t.title, status: t.status, phase: t.crm_phase, due_date: iso(t.due_date), hours: Number(t.hours_actual) || 0,
      who: t.assignee_ids.map(uid => nameOf(users, uid)).filter(Boolean).join(', '), done_at: t.status === 'done' ? iso(t.updated_at) : null }));
    if (req.query.formato === 'csv') {
      const head = ['Fase', 'Compito', 'Chi', 'Scadenza', 'Stato', 'Fatto il', 'Ore'];
      const STATO = { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' };
      const lines = [
        [`Rendiconto · ${s.name}`], [`Obiettivo: valore ${s.goal.value || 0} € · probabilità ${s.goal.probability || 0}% · ore ${s.goal.hours || 0}`],
        [`Fatto: ${s.tasks_done} compiti su ${s.tasks_total} · ${s.hours} ore · ${meetings} incontri · ${notes} note`], [],
        head, ...rows.map(r => [r.phase || '', r.title, r.who, r.due_date || '', STATO[r.status] || r.status, r.done_at || '', String(r.hours).replace('.', ',')])];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rendiconto-progetto-${id}.csv"`);
      return res.send(`﻿${lines.map(l => l.map(csvCell).join(';')).join('\r\n')}\r\n`);
    }
    res.json({ project: s, tasks: rows, people: Object.values(byPerson).map(p => ({ ...p, hours: Math.round(p.hours * 10) / 10 })), notes, meetings });
  });
}

module.exports = { registerCrmProgetti, STEPS };
