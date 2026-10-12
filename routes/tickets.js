// Ticket: assegnatari (uno o più), progetto, date per il Gantt, dipendenze, file OneDrive, commenti,
// e un evento «giornata intera» sul calendario Outlook che segue le date del ticket.
const { HttpError, v } = require('../lib/http');
const { graph, TIMEZONE } = require('../lib/graph');
const { createTicketMail } = require('../lib/ticket-mail');
const { findFunction, orgOidOf, headUserSql } = require('../lib/functions');

const STATUSES = ['todo', 'doing', 'review', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_LABEL = { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' };

const SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color,
         COALESCE((SELECT json_agg(a.user_id ORDER BY a.user_id) FROM ticket_assignees a WHERE a.ticket_id = t.id), '[]') AS assignee_ids,
         COALESCE((SELECT json_agg(d.depends_on_id ORDER BY d.depends_on_id) FROM ticket_deps d WHERE d.ticket_id = t.id), '[]') AS depends_on,
         (SELECT COUNT(*)::int FROM ticket_comments c WHERE c.ticket_id = t.id) AS comment_count,
         (SELECT COUNT(*)::int FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count,
         ${headUserSql('t.rda_head_oid')} AS rda_head_id
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id`;

const nextDay = d => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

function readBody(body, { partial }) {
  const out = {
    title: v.text(body.title, 'titolo', { max: 300, required: !partial }),
    description: v.text(body.description, 'descrizione', { max: 20000 }),
    project_id: v.int(body.project_id, 'progetto', { min: 1, nullable: true }),
    status: v.oneOf(body.status, 'stato', STATUSES),
    priority: v.oneOf(body.priority, 'priorità', PRIORITIES),
    start_date: v.date(body.start_date, 'inizio'),
    due_date: v.date(body.due_date, 'scadenza'),
    progress: v.int(body.progress, 'avanzamento', { min: 0, max: 100 }),
    position: body.position === undefined ? undefined : Number(body.position),
  };
  if (partial && out.title === '') throw new HttpError(400, 'Il campo «titolo» è obbligatorio');
  if (out.position !== undefined && !Number.isFinite(out.position)) throw new HttpError(400, 'Posizione non valida');
  if (out.status === 'done' && out.progress === undefined) out.progress = 100;
  const fields = Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
  return {
    fields,
    assigneeIds: v.ids(body.assignee_ids, 'assegnatari'),
    dependsOn: v.ids(body.depends_on, 'dipendenze'),
    // ore delle RDA interne: chi può cambiarle lo decide la PATCH
    hours: Object.fromEntries(Object.entries({
      hours_estimated: v.hours(body.hours_estimated, 'ore stimate'),
      hours_approved: v.hours(body.hours_approved, 'ore confermate'),
      hours_actual: v.hours(body.hours_actual, 'ore effettive', { nullable: true }),
    }).filter(([, val]) => val !== undefined)),
  };
}

// Le RDA da accettare o rifiutate non sono ancora lavoro: fuori da elenchi, bacheca, Gantt e calendario.
const LIVE_SQL = "(t.rda_state IS NULL OR t.rda_state = 'accepted')";

// Regole delle ore e dello stato di una RDA in una modifica del ticket. Restituisce le colonne in più da scrivere.
async function rdaRules(db, req, before, { fields, assigneeIds, hours }) {
  const extra = {};
  if (!before.rda_function) {
    if (Object.keys(hours).length) throw new HttpError(400, 'Le ore si indicano solo nelle RDA interne');
    return extra;
  }
  if (before.rda_state !== 'accepted') {
    if (['status', 'progress', 'position'].some(k => k in fields) || assigneeIds || 'hours_approved' in hours || 'hours_actual' in hours) {
      throw new HttpError(400, before.rda_state === 'pending'
        ? 'La richiesta va prima accettata dal responsabile della funzione'
        : 'La richiesta è stata rifiutata');
    }
    if ('hours_estimated' in hours) {
      if (before.rda_state !== 'pending' || before.created_by !== req.user.id) throw new HttpError(403, 'Le ore stimate le cambia solo chi ha fatto la richiesta, finché non è accettata');
      extra.hours_estimated = hours.hours_estimated;
    }
    return extra;
  }
  if ('hours_estimated' in hours) throw new HttpError(400, 'La richiesta è già accettata: le ore ora sono quelle confermate');
  if ('hours_approved' in hours) {
    const fn = await findFunction(db, before.rda_function);
    const myOid = await orgOidOf(db, req.user.id);
    if (!myOid || (myOid !== before.rda_head_oid && myOid !== fn?.head?.oid)) throw new HttpError(403, 'Le ore confermate le cambia solo il responsabile della funzione');
    extra.hours_approved = hours.hours_approved;
  }
  if ('hours_actual' in hours) extra.hours_actual = hours.hours_actual;
  // ticket fatto: le ore effettive, se nessuno le ha scritte, sono quelle confermate
  if (fields.status === 'done' && before.status !== 'done' && !('hours_actual' in hours) && before.hours_actual === null) {
    extra.hours_actual = extra.hours_approved ?? before.hours_approved;
  }
  return extra;
}

function registerTickets(app, { db, auth, baseUrl, access }) {
  const ticketMail = createTicketMail({ db, auth, baseUrl }); // email a chi riceve un ticket
  async function getTicket(id, q = db) {
    const { rows } = await q.query(`${SELECT} WHERE t.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Ticket non trovato');
    return rows[0];
  }

  async function setAssignees(q, ticketId, ids) {
    if (ids.length) {
      const { rows } = await q.query('SELECT COUNT(*)::int AS n FROM users WHERE id = ANY($1::int[])', [ids]);
      if (rows[0].n !== ids.length) throw new HttpError(400, 'Uno degli assegnatari non esiste');
    }
    // si tolgono solo quelli rimossi e si aggiungono solo i nuovi: chi resta conserva la data di assegnazione (assigned_at)
    await q.query('DELETE FROM ticket_assignees WHERE ticket_id = $1 AND NOT (user_id = ANY($2::int[]))', [ticketId, ids]);
    for (const uid of ids) await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ticketId, uid]);
  }

  async function setDeps(q, ticketId, ids) {
    if (ids.includes(ticketId)) throw new HttpError(400, 'Un ticket non può dipendere da sé stesso');
    if (ids.length) {
      // Nessun ciclo: nessuna delle nuove dipendenze può a sua volta dipendere (anche indirettamente) da questo ticket.
      const { rows } = await q.query(`
        WITH RECURSIVE up(id) AS (
          SELECT unnest($1::int[])
          UNION SELECT d.depends_on_id FROM ticket_deps d JOIN up ON d.ticket_id = up.id
        ) SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS cycle`, [ids, ticketId]);
      if (rows[0].cycle) throw new HttpError(400, 'Le dipendenze creerebbero un ciclo');
      const found = await q.query('SELECT COUNT(*)::int AS n FROM tickets WHERE id = ANY($1::int[])', [ids]);
      if (found.rows[0].n !== ids.length) throw new HttpError(400, 'Una delle dipendenze non esiste');
    }
    await q.query('DELETE FROM ticket_deps WHERE ticket_id = $1', [ticketId]);
    for (const dep of ids) await q.query('INSERT INTO ticket_deps (ticket_id, depends_on_id) VALUES ($1, $2)', [ticketId, dep]);
  }

  // ── evento Outlook del ticket ──────────────────────────────────────────────
  function eventBody(t) {
    const start = t.start_date || t.due_date;
    const end = t.due_date || t.start_date;
    return {
      subject: `[Alma] ${t.title}`,
      body: {
        contentType: 'text',
        content: `${t.project_name ? `Progetto: ${t.project_name}\n` : ''}Stato: ${STATUS_LABEL[t.status]}\n\n${t.description || ''}\n\nApri in Alma Planet: ${baseUrl}/app#/tickets/${t.id}`,
      },
      isAllDay: true,
      showAs: 'free',
      isReminderOn: false,
      start: { dateTime: `${start}T00:00:00`, timeZone: TIMEZONE },
      end: { dateTime: `${nextDay(end)}T00:00:00`, timeZone: TIMEZONE },
      categories: ['Alma Planet'],
    };
  }

  async function assigneeAttendees(ticketId) {
    const { rows } = await db.query(
      'SELECT u.email, u.name FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = $1', [ticketId]);
    return rows.map(r => ({ type: 'required', emailAddress: { address: r.email, name: r.name } }));
  }

  // Dopo una modifica: aggiorna (o toglie) l'evento Outlook con il token di chi l'ha creato. Mai bloccante.
  async function syncOutlook(ticketId) {
    const t = await getTicket(ticketId);
    if (!t.outlook_event_id || !t.outlook_event_owner) return;
    try {
      const token = await auth.graphToken(t.outlook_event_owner);
      if (!t.start_date && !t.due_date) {
        await graph(token, 'DELETE', `/me/events/${encodeURIComponent(t.outlook_event_id)}`).catch(() => {});
        await db.query('UPDATE tickets SET outlook_event_id = NULL, outlook_event_owner = NULL WHERE id = $1', [ticketId]);
      } else {
        await graph(token, 'PATCH', `/me/events/${encodeURIComponent(t.outlook_event_id)}`, { body: eventBody(t) });
      }
    } catch (err) {
      console.warn(`[outlook] ticket ${ticketId}: evento non aggiornato (${err.message})`);
    }
  }

  // ── rotte ──────────────────────────────────────────────────────────────────
  app.get('/api/tickets', async (req, res) => {
    const where = [], params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    const { project, assignee, status, q, from, to } = req.query;
    if (project === 'none') where.push('t.project_id IS NULL');
    else if (project) add('t.project_id = ?', v.int(project, 'progetto', { min: 1 }));
    if (assignee === 'me') add('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?)', req.user.id);
    else if (assignee === 'none') where.push('NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id)');
    else if (assignee) add('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?)', v.int(assignee, 'assegnatario', { min: 1 }));
    if (status === 'open') where.push("t.status <> 'done'");
    else if (status) add('t.status = ?', v.oneOf(status, 'stato', STATUSES));
    if (q) add('(t.title ILIKE ? OR t.description ILIKE $' + (params.length + 1) + ')', `%${String(q).slice(0, 100)}%`);
    if (from) add('COALESCE(t.due_date, t.start_date) >= ?', v.date(from, 'da'));
    if (to) add('COALESCE(t.start_date, t.due_date) <= ?', v.date(to, 'a'));
    // solo i ticket dei progetti che si vedono (lib/access.js); per un amministratore il filtro è TRUE e non ha parametri
    where.push(LIVE_SQL);
    const visible = access.ticketFilter(req, 't', `$${params.length + 1}`);
    if (visible !== 'TRUE') { params.push(req.user.id); where.push(visible); }
    const { rows } = await db.query(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.position, t.id LIMIT 2000`, params);
    res.json(rows);
  });

  app.get('/api/tickets/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const t = await getTicket(id);
    const [files, comments] = await Promise.all([
      db.query('SELECT f.*, u.name AS added_by_name FROM ticket_files f LEFT JOIN users u ON u.id = f.added_by WHERE f.ticket_id = $1 ORDER BY f.created_at', [id]),
      db.query('SELECT c.*, u.name AS user_name FROM ticket_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.ticket_id = $1 ORDER BY c.created_at', [id]),
    ]);
    res.json({ ...t, files: files.rows, comments: comments.rows });
  });

  app.post('/api/tickets', async (req, res) => {
    const { fields, assigneeIds, dependsOn } = readBody(req.body || {}, { partial: false });
    if (fields.start_date && fields.due_date && fields.start_date > fields.due_date) throw new HttpError(400, 'La scadenza è prima dell\'inizio');
    if (fields.project_id) await access.assertProject(req, fields.project_id);
    const id = await db.tx(async q => {
      if (fields.position === undefined) {
        const { rows } = await q.query('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tickets');
        fields.position = rows[0].p;
      }
      fields.created_by = req.user.id;
      const cols = Object.keys(fields);
      const { rows } = await q.query(
        `INSERT INTO tickets (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(fields));
      const newId = rows[0].id;
      await setAssignees(q, newId, assigneeIds || []);
      // chi viene assegnato a un ticket del progetto entra nel progetto
      if (fields.project_id) await access.addMembers(q, fields.project_id, assigneeIds || [], req.user.id);
      await setDeps(q, newId, dependsOn || []);
      return newId;
    });
    const created = await getTicket(id);
    res.status(201).json(created);
    ticketMail.notifyAssigned(created, assigneeIds, req.user); // dopo la risposta: non fa aspettare
  });

  app.patch('/api/tickets/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const body = readBody(req.body || {}, { partial: true });
    const { fields, assigneeIds, dependsOn } = body;
    if (fields.project_id) await access.assertProject(req, fields.project_id); // spostarlo in un progetto che si vede
    let previous = [];
    await db.tx(async q => {
      const before = await getTicket(id, q);
      previous = before.assignee_ids;
      Object.assign(fields, await rdaRules(q, req, before, body));
      const start = fields.start_date !== undefined ? fields.start_date : before.start_date;
      const due = fields.due_date !== undefined ? fields.due_date : before.due_date;
      if (start && due && start > due) throw new HttpError(400, 'La scadenza è prima dell\'inizio');
      const cols = Object.keys(fields);
      if (cols.length) {
        await q.query(`UPDATE tickets SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...Object.values(fields)]);
      }
      if (assigneeIds) await setAssignees(q, id, assigneeIds);
      const projectId = fields.project_id !== undefined ? fields.project_id : before.project_id;
      if (projectId && (assigneeIds || fields.project_id)) {
        await access.addMembers(q, projectId, assigneeIds || before.assignee_ids, req.user.id);
      }
      if (dependsOn) await setDeps(q, id, dependsOn);
    });
    const touchesEvent = ['title', 'description', 'start_date', 'due_date', 'status', 'project_id'].some(k => k in fields);
    if (touchesEvent) await syncOutlook(id);
    const updated = await getTicket(id);
    res.json(updated);
    // email solo a chi è stato aggiunto ora
    if (assigneeIds) ticketMail.notifyAssigned(updated, assigneeIds.filter(uid => !previous.includes(uid)), req.user);
  });

  app.delete('/api/tickets/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const t = await getTicket(id);
    // Lo cancella solo chi l'ha creato; un ticket rimasto senza autore (persona uscita) lo cancella un amministratore.
    if (t.created_by !== req.user.id && !(t.created_by === null && access.isAdmin(req))) {
      throw new HttpError(403, 'Può cancellare il ticket solo chi l\'ha creato');
    }
    if (t.outlook_event_id && t.outlook_event_owner) {
      try {
        const token = await auth.graphToken(t.outlook_event_owner);
        await graph(token, 'DELETE', `/me/events/${encodeURIComponent(t.outlook_event_id)}`);
      } catch (err) {
        console.warn(`[outlook] ticket ${id}: evento non cancellato (${err.message})`);
      }
    }
    await db.query('DELETE FROM tickets WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // Aggiunge il ticket al calendario Outlook di chi clicca (o aggiorna l'evento che ha già).
  app.post('/api/tickets/:id/outlook', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const t = await getTicket(id);
    if (!t.start_date && !t.due_date) throw new HttpError(400, 'Dai al ticket almeno una data prima di metterlo in calendario');
    const token = await auth.graphToken(req.user.id);
    const body = eventBody(t);
    if (req.body?.invite) body.attendees = await assigneeAttendees(id);
    let event;
    if (t.outlook_event_id && t.outlook_event_owner === req.user.id) {
      event = await graph(token, 'PATCH', `/me/events/${encodeURIComponent(t.outlook_event_id)}`, { body });
    } else {
      event = await graph(token, 'POST', '/me/events', { body });
      await db.query('UPDATE tickets SET outlook_event_id = $1, outlook_event_owner = $2 WHERE id = $3', [event.id, req.user.id, id]);
    }
    res.json({ ok: true, webLink: event.webLink });
  });

  app.delete('/api/tickets/:id/outlook', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const t = await getTicket(id);
    if (!t.outlook_event_id) return res.json({ ok: true });
    if (t.outlook_event_owner !== req.user.id) throw new HttpError(403, 'L\'evento è nel calendario di un collega: può toglierlo solo lui');
    const token = await auth.graphToken(req.user.id);
    await graph(token, 'DELETE', `/me/events/${encodeURIComponent(t.outlook_event_id)}`).catch(err => { if (err.status !== 404) throw err; });
    await db.query('UPDATE tickets SET outlook_event_id = NULL, outlook_event_owner = NULL WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── file OneDrive collegati ────────────────────────────────────────────────
  app.post('/api/tickets/:id/files', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    await getTicket(id);
    const b = req.body || {};
    const row = [
      v.text(b.drive_id, 'drive', { max: 300, required: true }),
      v.text(b.item_id, 'file', { max: 300, required: true }),
      v.text(b.name, 'nome', { max: 500, required: true }),
      v.text(b.web_url, 'link', { max: 2000 }) || null,
    ];
    await db.query(
      `INSERT INTO ticket_files (ticket_id, drive_id, item_id, name, web_url, added_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticket_id, drive_id, item_id) DO NOTHING`, [id, ...row, req.user.id]);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/tickets/:id/files/:fileId', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const fileId = v.int(req.params.fileId, 'file', { min: 1 });
    await db.query('DELETE FROM ticket_files WHERE id = $1 AND ticket_id = $2', [fileId, id]);
    res.json({ ok: true });
  });

  // ── commenti ───────────────────────────────────────────────────────────────
  app.post('/api/tickets/:id/comments', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    await getTicket(id);
    const body = v.text(req.body?.body, 'commento', { max: 10000, required: true });
    await db.query('INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3)', [id, req.user.id, body]);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/tickets/:id/comments/:commentId', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertTicket(req, id);
    const cid = v.int(req.params.commentId, 'commento', { min: 1 });
    const { rowCount } = await db.query('DELETE FROM ticket_comments WHERE id = $1 AND ticket_id = $2 AND user_id = $3', [cid, id, req.user.id]);
    if (!rowCount) throw new HttpError(403, 'Puoi cancellare solo i tuoi commenti');
    res.json({ ok: true });
  });
}

module.exports = { registerTickets, STATUSES, PRIORITIES };
