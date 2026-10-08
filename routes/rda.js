// RDA interna: si chiede un lavoro a un'altra funzione aziendale (reparto dell'organigramma) indicando le ore stimate.
// Solo il responsabile della funzione la accetta, confermando o cambiando le ore (chi ha chiesto viene avvisato,
// senza dover riapprovare) e assegnandola al suo team; oppure la rifiuta con un motivo.
// Accettata, è un ticket come gli altri; quando è fatto le ore effettive partono da quelle confermate.
const { HttpError, v } = require('../lib/http');
const { loadFunctions, findFunction, orgOidOf, headUserSql } = require('../lib/functions');
const { createTicketMail } = require('../lib/ticket-mail');

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const SELECT = `
  SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.start_date, t.project_id, t.created_by, t.created_at,
         t.rda_function, t.rda_state, t.hours_estimated, t.hours_approved, t.hours_actual,
         t.rda_decided_by, t.rda_decided_at, t.rda_reject_reason,
         p.name AS project_name, p.color AS project_color,
         ${headUserSql('t.rda_head_oid')} AS rda_head_id,
         COALESCE((SELECT json_agg(a.user_id ORDER BY a.user_id) FROM ticket_assignees a WHERE a.ticket_id = t.id), '[]') AS assignee_ids
    FROM tickets t LEFT JOIN projects p ON p.id = t.project_id`;

function registerRda(app, { db, auth, baseUrl, access, isAdmin, notifier, live }) {
  const mail = createTicketMail({ db, auth, baseUrl });

  const myOid = req => orgOidOf(db, req.user.id);

  async function getRda(id) {
    const { rows } = await db.query(`${SELECT} WHERE t.id = $1 AND t.rda_function IS NOT NULL`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Richiesta non trovata');
    return rows[0];
  }

  // Solo il responsabile attuale della funzione (o quello a cui è arrivata) decide; ne restituisce la funzione.
  async function assertHead(req, t) {
    const fn = await findFunction(db, t.rda_function);
    const oid = await myOid(req);
    const { rows } = await db.query('SELECT rda_head_oid FROM tickets WHERE id = $1', [t.id]);
    if (!oid || (oid !== fn?.head?.oid && oid !== rows[0].rda_head_oid)) throw new HttpError(403, `Solo il responsabile di «${t.rda_function}» può decidere`);
    return fn;
  }

  // Funzioni a cui si può chiedere, con il loro responsabile; quelle che guido io e la mia.
  app.get('/api/rda/functions', async (req, res) => {
    const oid = await myOid(req);
    const list = await loadFunctions(db);
    res.json(list.map(f => ({
      name: f.name,
      head: f.head && { name: f.head.name, user_id: f.head.user_id, oid: f.head.oid },
      head_source: f.head_source,
      member_count: f.members.length,
      mine: f.members.some(m => m.oid === oid),
      i_lead: Boolean(oid && f.head?.oid === oid),
      // il team a cui assegnare lo vede solo chi guida la funzione (o un amministratore)
      team: (oid && f.head?.oid === oid) || isAdmin(req) ? f.team.filter(m => m.user_id).map(m => ({ user_id: m.user_id, name: m.name, job_title: m.job_title })) : undefined,
    })));
  });

  // Un amministratore sceglie il responsabile di una funzione (null = torna quello ricavato dall'organigramma).
  app.put('/api/rda/functions/:name/head', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Solo un amministratore può cambiare il responsabile di una funzione');
    const name = v.text(req.params.name, 'funzione', { max: 200, required: true });
    const headOid = req.body?.head_oid ?? null;
    if (headOid === null) await db.query('DELETE FROM function_heads WHERE department = $1', [name]);
    else {
      const { rows } = await db.query('SELECT 1 FROM org_people WHERE oid = $1', [String(headOid)]);
      if (!rows[0]) throw new HttpError(400, 'Persona non trovata nell\'organigramma');
      await db.query(
        `INSERT INTO function_heads (department, head_oid, set_by) VALUES ($1, $2, $3)
         ON CONFLICT (department) DO UPDATE SET head_oid = EXCLUDED.head_oid, set_by = EXCLUDED.set_by, set_at = now()`,
        [name, String(headOid), req.user.id]);
    }
    res.json({ ok: true });
  });

  // Tutto quello che serve alla pagina «RDA interne»: da accettare (se guido una funzione), arrivate alla mia funzione, fatte da me.
  app.get('/api/rda', async (req, res) => {
    const oid = await myOid(req);
    const led = (await loadFunctions(db)).filter(f => oid && f.head?.oid === oid).map(f => f.name);
    const [sent, received] = await Promise.all([
      db.query(`${SELECT} WHERE t.rda_function IS NOT NULL AND t.created_by = $1 ORDER BY t.created_at DESC LIMIT 300`, [req.user.id]),
      led.length
        ? db.query(`${SELECT} WHERE t.rda_function = ANY($1::text[]) ORDER BY t.created_at DESC LIMIT 500`, [led])
        : { rows: [] },
    ]);
    res.json({
      led,
      inbox: received.rows.filter(t => t.rda_state === 'pending'),
      received: received.rows.filter(t => t.rda_state !== 'pending'),
      sent: sent.rows,
    });
  });

  // Nuova richiesta: un ticket senza assegnatari, da accettare.
  app.post('/api/rda', async (req, res) => {
    const b = req.body || {};
    const title = v.text(b.title, 'cosa ti serve', { max: 300, required: true });
    const description = v.text(b.description, 'dettagli', { max: 20000 }) || '';
    const fnName = v.text(b.function, 'funzione', { max: 200, required: true });
    const hours = v.hours(b.hours_estimated, 'ore stimate');
    if (hours === undefined) throw new HttpError(400, 'Indica più o meno quante ore servono');
    const due = v.date(b.due_date, 'entro il') || null;
    const priority = v.oneOf(b.priority, 'priorità', PRIORITIES) || 'normal';
    const projectId = v.int(b.project_id, 'progetto', { min: 1, nullable: true }) || null;
    if (projectId) await access.assertProject(req, projectId);
    const fn = await findFunction(db, fnName);
    if (!fn) throw new HttpError(400, 'Funzione non trovata nell\'organigramma');
    if (!fn.head) throw new HttpError(400, `«${fn.name}» non ha ancora un responsabile: chiedi a un amministratore di indicarlo nell'organigramma`);

    const { rows } = await db.query(
      `INSERT INTO tickets (title, description, priority, due_date, project_id, created_by, position,
                            rda_function, rda_state, rda_head_oid, hours_estimated)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(position), 0) + 1 FROM tickets), $7, 'pending', $8, $9) RETURNING id`,
      [title, description, priority, due, projectId, req.user.id, fn.name, fn.head.oid, hours]);
    const t = await getRda(rows[0].id);
    res.status(201).json(t);

    // al responsabile: notifica nell'app (se è già entrato) ed email (anche se non è mai entrato)
    if (fn.head.user_id) {
      await notifier.notify({ userIds: [fn.head.user_id], actorId: req.user.id, kind: 'rda_new', ticketId: t.id }).catch(() => {});
      live.send([fn.head.user_id], 'rda');
    }
    mail.notifyRdaRequest(t, fn.head, req.user);
  });

  // Accetta: ore confermate (le stimate o cambiate), a chi del team, entro quando; una nota facoltativa va nei commenti.
  app.post('/api/rda/:id/accept', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const t = await getRda(id);
    if (t.rda_state !== 'pending') throw new HttpError(400, 'La richiesta è già stata decisa');
    const fn = await assertHead(req, t);
    const b = req.body || {};
    const hours = v.hours(b.hours_approved, 'ore confermate') ?? Number(t.hours_estimated);
    const assignees = v.ids(b.assignee_ids, 'assegnatari') || [];
    if (!assignees.length) throw new HttpError(400, 'Assegnala ad almeno una persona del tuo team');
    const team = new Set((fn?.team || []).map(m => m.user_id).filter(Boolean));
    if (assignees.some(uid => !team.has(uid))) throw new HttpError(400, 'Si assegna solo a persone del proprio team');
    const due = b.due_date === undefined ? t.due_date : v.date(b.due_date, 'scadenza');
    const start = v.date(b.start_date, 'inizio') ?? t.start_date ?? null;
    if (start && due && start > due) throw new HttpError(400, 'La scadenza è prima dell\'inizio');
    const note = v.text(b.note, 'nota', { max: 5000 });

    await db.tx(async q => {
      await q.query(
        `UPDATE tickets SET rda_state = 'accepted', hours_approved = $2, due_date = $3, start_date = $4,
                rda_decided_by = $5, rda_decided_at = now(), updated_at = now() WHERE id = $1`,
        [id, hours, due || null, start, req.user.id]);
      for (const uid of assignees) await q.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, uid]);
      if (t.project_id) await access.addMembers(q, t.project_id, assignees, req.user.id);
      if (note) await q.query('INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3)', [id, req.user.id, note]);
    });
    const updated = await getRda(id);
    res.json(updated);

    await notifier.notify({ userIds: [t.created_by], actorId: req.user.id, kind: 'rda_accepted', ticketId: id }).catch(() => {});
    const { rows } = await db.query(`SELECT t.*, p.name AS project_name FROM tickets t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`, [id]);
    mail.notifyAssigned(rows[0], assignees, req.user);
  });

  app.post('/api/rda/:id/reject', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const t = await getRda(id);
    if (t.rda_state !== 'pending') throw new HttpError(400, 'La richiesta è già stata decisa');
    await assertHead(req, t);
    const reason = v.text(req.body?.reason, 'motivo', { max: 2000, required: true });
    await db.query(
      `UPDATE tickets SET rda_state = 'rejected', rda_reject_reason = $2, rda_decided_by = $3, rda_decided_at = now(), updated_at = now()
        WHERE id = $1`, [id, reason, req.user.id]);
    res.json(await getRda(id));
    await notifier.notify({ userIds: [t.created_by], actorId: req.user.id, kind: 'rda_rejected', ticketId: id }).catch(() => {});
  });
}

module.exports = { registerRda };
