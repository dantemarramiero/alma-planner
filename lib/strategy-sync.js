// Alma Strategy ↔ progetti di Alma Planner. Ogni A3 ha il suo progetto (Gantt, ticket, documenti, email, incontri,
// note, membri) e ogni contromisura il suo ticket: titolo = attività, scadenza = scadenza, «Fatto» = chiusa.
// Il collegamento si fa la prima volta che si apre l'A3; poi le modifiche passano da una parte all'altra.

// «A. Erbivendolo» o «Antonio Erbivendolo» → l'utente con quel cognome e quell'iniziale (o quel nome intero).
function matchUser(users, text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  const exact = users.find(u => u.name.toLowerCase() === s);
  if (exact) return exact.id;
  const words = s.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  const last = words[words.length - 1], initial = words[0]?.[0];
  const hit = users.filter(u => {
    const w = u.name.toLowerCase().split(/\s+/);
    return w[w.length - 1] === last && (!initial || w[0][0] === initial);
  });
  return hit.length === 1 ? hit[0].id : null;
}
async function usersFor(q, texts) {
  const { rows: users } = await q.query('SELECT id, name FROM users WHERE name <> \'\'');
  return texts.flatMap(t => String(t || '').split(/[,;]/)).map(t => matchUser(users, t)).filter(Boolean);
}

const STATUS_DONE = 'done';

// Ticket di una contromisura: inizia dove finisce la precedente, così il Gantt del progetto è la sequenza dell'A3.
async function createTicket(q, { task, projectId, startDate, userId, ownerId }) {
  const due = task.due_date || null;
  const own = task.start_date || null; // la data di inizio della contromisura, se c'è, comanda
  const start = own && (!due || own <= due) ? own : startDate && due && startDate <= due ? startDate : due;
  const { rows: [t] } = await q.query(
    `INSERT INTO tickets (project_id, title, description, status, start_date, due_date, position, created_by, progress)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [projectId, (task.activity || 'Contromisura').slice(0, 300), task.area ? `Area di intervento: ${task.area}` : '', task.closed_date ? STATUS_DONE : 'todo',
      start, due, task.position, userId, task.closed_date ? 100 : 0]);
  if (ownerId) await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, ownerId]);
  await q.query('UPDATE hk_tasks SET ticket_id = $2, start_date = $3 WHERE id = $1', [task.id, t.id, start]);
  return t.id;
}

async function ensureProject(db, hkId, userId) {
  return db.tx(async q => {
    const { rows: [p] } = await q.query(
      `SELECT h.*, f.color AS function_color FROM hk_projects h
         LEFT JOIN hk_areas a ON a.id = h.area_id LEFT JOIN hk_functions f ON f.id = a.function_id WHERE h.id = $1 FOR UPDATE OF h`, [hkId]);
    if (!p) return null;
    if (p.project_id) return p.project_id;
    const [ownerId] = await usersFor(q, [p.owner]);
    const team = await usersFor(q, [p.team]);
    const { rows: [proj] } = await q.query(
      `INSERT INTO projects (name, description, color, status, owner_id, hk) VALUES ($1, $2, $3, 'active', $4, true) RETURNING id`,
      [p.name.slice(0, 200), p.background || '', p.function_color || '#FF8A26', ownerId || userId]);
    for (const uid of new Set([userId, ...team])) {
      if (uid !== (ownerId || userId)) await q.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [proj.id, uid, userId]);
    }
    await q.query('UPDATE hk_projects SET project_id = $2 WHERE id = $1', [hkId, proj.id]);
    const { rows: tasks } = await q.query('SELECT * FROM hk_tasks WHERE project_id = $1 ORDER BY position, id', [hkId]);
    // la prima contromisura parte un mese prima della sua scadenza (nell'A3 non c'è una data di inizio)
    const monthBefore = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
    let prev = tasks[0]?.due_date ? monthBefore(tasks[0].due_date) : null;
    for (const task of tasks) {
      const [taskOwner] = await usersFor(q, [task.owner]);
      if (!task.ticket_id) await createTicket(q, { task, projectId: proj.id, startDate: prev, userId, ownerId: taskOwner || ownerId || null });
      if (task.due_date) prev = task.due_date;
    }
    return proj.id;
  });
}

// Contromisura nuova in un A3 già collegato: il suo ticket, dopo l'ultima contromisura.
async function ticketForNewTask(db, task, userId) {
  const { rows: [p] } = await db.query('SELECT project_id, owner FROM hk_projects WHERE id = $1', [task.project_id]);
  if (!p?.project_id) return null;
  const { rows: [last] } = await db.query('SELECT MAX(due_date) AS d FROM hk_tasks WHERE project_id = $1 AND id <> $2', [task.project_id, task.id]);
  return db.tx(async q => {
    const [ownerId] = await usersFor(q, [task.owner || p.owner]);
    return createTicket(q, { task, projectId: p.project_id, startDate: last?.d || null, userId, ownerId: ownerId || null });
  });
}

// Contromisura cambiata nell'A3 → il suo ticket. Lo stato si tocca solo se cambia la chiusura: «In corso» resta tale.
async function taskToTicket(db, task, changed) {
  if (!task.ticket_id) return;
  const sets = [], vals = [task.ticket_id];
  const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if ('activity' in changed) add('title', (task.activity || 'Contromisura').slice(0, 300));
  if ('start_date' in changed) add('start_date', task.start_date);
  if ('due_date' in changed) {
    add('due_date', task.due_date);
    sets.push(`start_date = CASE WHEN start_date IS NULL OR start_date > $${vals.length} THEN $${vals.length} ELSE start_date END`);
  }
  if ('closed_date' in changed) {
    if (task.closed_date) { add('status', STATUS_DONE); add('progress', 100); }
    else sets.push(`status = CASE WHEN status = '${STATUS_DONE}' THEN 'todo' ELSE status END`);
  }
  if ('owner' in changed) {
    const [uid] = await usersFor(db, [task.owner]);
    if (uid) await db.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [task.ticket_id, uid]);
  }
  if (sets.length) await db.query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  // l'inizio del ticket può essersi spostato con la scadenza: la contromisura lo segue (un solo Gantt)
  if ('due_date' in changed || 'start_date' in changed) {
    await db.query('UPDATE hk_tasks t SET start_date = k.start_date FROM tickets k WHERE k.id = t.ticket_id AND t.ticket_id = $1', [task.ticket_id]);
  }
  // un A3 che prosegue nell'anno dopo ha le stesse contromisure (stesso ticket) nei due anni: restano uguali
  await db.query(
    `UPDATE hk_tasks s SET activity = t.activity, area = t.area, weight = t.weight, owner = t.owner,
            due_date = t.due_date, closed_date = t.closed_date, start_date = t.start_date
       FROM hk_tasks t WHERE t.id = $1 AND s.ticket_id = t.ticket_id AND s.id <> t.id`, [task.id]);
}

// Ticket cambiato in Alma Planner (bacheca, Gantt, scheda) → la sua contromisura. Si chiama dentro la transazione del ticket.
async function ticketToTask(q, ticketId, fields) {
  const sets = [], vals = [ticketId];
  if ('status' in fields) sets.push(fields.status === STATUS_DONE ? 'closed_date = COALESCE(closed_date, CURRENT_DATE)' : 'closed_date = NULL');
  if ('title' in fields) { vals.push(String(fields.title).slice(0, 1000)); sets.push(`activity = $${vals.length}`); }
  if ('due_date' in fields) { vals.push(fields.due_date); sets.push(`due_date = $${vals.length}`); }
  if ('start_date' in fields) { vals.push(fields.start_date); sets.push(`start_date = $${vals.length}`); }
  if (sets.length) await q.query(`UPDATE hk_tasks SET ${sets.join(', ')} WHERE ticket_id = $1`, vals);
}

module.exports = { ensureProject, ticketForNewTask, taskToTicket, ticketToTask, matchUser };
