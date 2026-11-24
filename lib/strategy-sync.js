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
    // ALM2-85: le contromisure non diventano più ticket da sole; i ticket del progetto li crea chi ci lavora
    return proj.id;
  });
}

// Contromisura nuova: nessun ticket automatico (ALM2-85).
async function ticketForNewTask() { return null; }

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
