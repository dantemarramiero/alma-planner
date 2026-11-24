// Nuovi business come progetto (ALM2-79): ogni iniziativa ha il suo progetto di Alma Space e ogni passo del piano il suo
// compito (ticket). Come Alma Strategy ↔ A3 (lib/strategy-sync.js): il progetto nasce la prima volta che si apre
// l'iniziativa; poi titolo, chi, scadenza e «fatto» passano da una parte all'altra.
const PHASES = ['esplorazione', 'analisi', 'piano', 'ingresso', 'consolidamento'];
const PHASE_LABEL = { esplorazione: 'Esplorazione', analisi: 'Analisi', piano: 'Piano', ingresso: 'Ingresso', consolidamento: 'Consolidamento' };
const iso = d => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function addMembers(q, projectId, ids, by) {
  const { rows: [p] } = await q.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  for (const uid of new Set(ids.filter(Boolean))) {
    if (uid === p?.owner_id) continue;
    await q.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [projectId, uid, by || null]);
  }
}

// il ticket di un passo: parte qualche giorno prima della scadenza (il Gantt ha una barra), «fatto» se il passo è fatto
async function createTicket(q, step, projectId, userId) {
  const due = iso(step.due_date);
  const start = due ? addDays(due, -4) : null;
  const { rows: [{ pos }] } = await q.query('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM tickets');
  const { rows: [t] } = await q.query(
    `INSERT INTO tickets (project_id, title, description, status, start_date, due_date, position, created_by, crm_phase, progress)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [projectId, String(step.title).slice(0, 300), `Piano · ${PHASE_LABEL[step.phase] || ''}`, step.done_at ? 'done' : 'todo', start, due, pos,
      step.created_by || userId || null, Math.max(1, Math.min(4, PHASES.indexOf(step.phase) + 1 || 1)), step.done_at ? 100 : 0]);
  if (step.owner_id) {
    await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, step.owner_id]);
    await addMembers(q, projectId, [step.owner_id], userId);
  }
  await q.query('UPDATE crm_initiative_tasks SET ticket_id = $2 WHERE id = $1', [step.id, t.id]);
  return t.id;
}

// Il progetto dell'iniziativa: c'è già (anche lanciato) o nasce ora, con i membri e un compito per ogni passo.
async function ensureProject(db, initiativeId, userId) {
  return db.tx(async q => {
    const { rows: [i] } = await q.query('SELECT * FROM crm_initiatives WHERE id = $1 FOR UPDATE', [initiativeId]);
    if (!i) return null;
    let pid = i.project_id;
    if (!pid) {
      const owner = i.owner_id || i.created_by || userId;
      const step = Math.max(0, Math.min(4, PHASES.indexOf(i.phase)));
      const { rows: [p] } = await q.query(
        `INSERT INTO projects (name, description, color, status, start_date, owner_id, crm_kind, crm_goal, crm_step)
         VALUES ($1, $2, '#3A3835', 'active', $3, $4, 'settore', $5, $6) RETURNING id`,
        [i.name.slice(0, 200), String(i.description || '').slice(0, 2000), iso(i.started_on), owner, JSON.stringify({ budget: Number(i.budget_eur) || 0 }), step]);
      pid = p.id;
      await addMembers(q, pid, [i.sponsor_id, i.created_by, userId], userId);
      await q.query('UPDATE crm_initiatives SET project_id = $2 WHERE id = $1', [i.id, pid]);
      // i clienti target già nel CRM sono le prime relazioni del progetto
      await q.query(`INSERT INTO crm_project_links (project_id, subject_id, role, linked_by)
                     SELECT DISTINCT $1::int, subject_id, 'cliente_target', $2::int FROM crm_initiative_targets
                      WHERE initiative_id = $3 AND subject_id IS NOT NULL AND status <> 'scartato' ON CONFLICT DO NOTHING`, [pid, userId, i.id]);
    }
    const { rows: steps } = await q.query('SELECT * FROM crm_initiative_tasks WHERE initiative_id = $1 AND ticket_id IS NULL ORDER BY sort, id', [i.id]);
    for (const s of steps) await createTicket(q, s, pid, userId);
    return pid;
  });
}

// passo nuovo in un'iniziativa che ha il progetto: il suo compito
async function ticketForStep(db, step, userId) {
  const { rows: [i] } = await db.query('SELECT project_id FROM crm_initiatives WHERE id = $1', [step.initiative_id]);
  if (!i?.project_id || step.ticket_id) return null;
  return db.tx(q => createTicket(q, step, i.project_id, userId));
}

// passo cambiato nel Piano → il suo compito
async function stepToTicket(db, step, changed, userId) {
  if (!step.ticket_id) return;
  const sets = [], vals = [step.ticket_id];
  const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if ('title' in changed) add('title', String(step.title).slice(0, 300));
  if ('due_date' in changed) {
    add('due_date', iso(step.due_date));
    if (step.due_date) sets.push(`start_date = CASE WHEN start_date IS NULL OR start_date > $${vals.length} THEN $${vals.length}::date - 4 ELSE start_date END`);
  }
  if ('phase' in changed) { add('crm_phase', Math.max(1, PHASES.indexOf(step.phase) + 1)); add('description', `Piano · ${PHASE_LABEL[step.phase] || ''}`); }
  if ('done_at' in changed) {
    if (step.done_at) { add('status', 'done'); add('progress', 100); }
    else sets.push("status = CASE WHEN status = 'done' THEN 'todo' ELSE status END");
  }
  if (sets.length) await db.query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  if ('owner_id' in changed) {
    await db.query('DELETE FROM ticket_assignees WHERE ticket_id = $1', [step.ticket_id]);
    if (step.owner_id) {
      await db.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [step.ticket_id, step.owner_id]);
      const { rows: [t] } = await db.query('SELECT project_id FROM tickets WHERE id = $1', [step.ticket_id]);
      if (t?.project_id) await addMembers(db, t.project_id, [step.owner_id], userId);
    }
  }
}

// compito cambiato in Alma Space (bacheca, Gantt, scheda) → il suo passo. Dentro la transazione del ticket.
async function ticketToStep(q, ticketId, fields, assigneeIds) {
  const sets = [], vals = [ticketId];
  if ('status' in fields) sets.push(fields.status === 'done' ? 'done_at = COALESCE(done_at, now())' : 'done_at = NULL');
  if ('title' in fields) { vals.push(String(fields.title).slice(0, 300)); sets.push(`title = $${vals.length}`); }
  if ('due_date' in fields) { vals.push(fields.due_date || null); sets.push(`due_date = $${vals.length}, alerted_at = NULL`); }
  if (assigneeIds) { vals.push(assigneeIds[0] || null); sets.push(`owner_id = $${vals.length}`); }
  if (sets.length) await q.query(`UPDATE crm_initiative_tasks SET ${sets.join(', ')} WHERE ticket_id = $1`, vals);
}

module.exports = { ensureProject, ticketForStep, stepToTicket, ticketToStep, addMembers };
