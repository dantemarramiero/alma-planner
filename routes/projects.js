// Progetti: elenco con avanzamento, creazione, modifica, macro area, cartella OneDrive collegata, membri.
// Ognuno vede solo i progetti di cui è responsabile o membro (gli amministratori li vedono tutti): lib/access.js.
const { HttpError, v } = require('../lib/http');

const STATUSES = ['active', 'paused', 'done', 'archived'];

// La durata del progetto è l'arco delle sue attività, cioè dei suoi ticket con date.
// $1 = utente collegato (per il suo ruolo nel progetto).
const SELECT = `
  SELECT p.*, o.name AS owner_name,
         COUNT(t.id)::int AS ticket_count,
         COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS done_count,
         COUNT(t.id) FILTER (WHERE t.start_date IS NOT NULL OR t.due_date IS NOT NULL)::int AS activity_count,
         MIN(COALESCE(t.start_date, t.due_date)) AS span_start,
         MAX(COALESCE(t.due_date, t.start_date)) AS span_end,
         (SELECT COUNT(*)::int FROM project_members m WHERE m.project_id = p.id AND m.user_id <> p.owner_id) AS member_count,
         CASE WHEN p.owner_id = $1 THEN 'owner'
              WHEN EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1) THEN 'member'
              ELSE 'admin' END AS my_role
    FROM projects p
    LEFT JOIN users o ON o.id = p.owner_id
    LEFT JOIN tickets t ON t.project_id = p.id`;

function readBody(body, { partial }) {
  const out = {
    name: v.text(body.name, 'nome', { max: 200, required: !partial }),
    description: v.text(body.description, 'descrizione', { max: 5000 }),
    color: v.color(body.color, 'colore'),
    status: v.oneOf(body.status, 'stato', STATUSES),
    start_date: v.date(body.start_date, 'inizio'),
    end_date: v.date(body.end_date, 'fine'),
    owner_id: v.int(body.owner_id, 'responsabile', { min: 1, nullable: true }),
    area_id: v.int(body.area_id, 'macro area', { min: 1, nullable: true }),
    onedrive_drive_id: v.text(body.onedrive_drive_id, 'cartella OneDrive', { max: 300 }),
    onedrive_item_id: v.text(body.onedrive_item_id, 'cartella OneDrive', { max: 300 }),
    onedrive_name: v.text(body.onedrive_name, 'cartella OneDrive', { max: 500 }),
    onedrive_url: v.text(body.onedrive_url, 'cartella OneDrive', { max: 2000 }),
  };
  if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
  if (out.start_date && out.end_date && out.start_date > out.end_date) throw new HttpError(400, 'La fine del progetto è prima dell\'inizio');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

function registerProjects(app, { db, access }) {
  async function assertArea(areaId) {
    if (!areaId) return;
    const { rows } = await db.query('SELECT 1 FROM areas WHERE id = $1', [areaId]);
    if (!rows[0]) throw new HttpError(400, 'La macro area non esiste più: ricarica la pagina');
  }

  app.get('/api/projects', async (req, res) => {
    const all = req.query.all === '1';
    const { rows } = await db.query(
      `${SELECT} WHERE ${access.projectFilter(req, 'p', '$1')} ${all ? '' : "AND p.status <> 'archived'"}
       GROUP BY p.id, o.name ORDER BY p.status = 'active' DESC, p.name`, [req.user.id]);
    res.json(rows);
  });

  app.get('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertProject(req, id);
    const { rows } = await db.query(`${SELECT} WHERE p.id = $2 GROUP BY p.id, o.name`, [req.user.id, id]);
    res.json(rows[0]);
  });

  app.post('/api/projects', async (req, res) => {
    const data = readBody(req.body || {}, { partial: false });
    if (data.owner_id === undefined || data.owner_id === null) data.owner_id = req.user.id;
    await assertArea(data.area_id);
    const id = await db.tx(async q => {
      const cols = Object.keys(data);
      const { rows } = await q.query(
        `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(data));
      // chi crea il progetto per un altro responsabile ne resta membro
      if (data.owner_id !== req.user.id) await access.addMembers(q, rows[0].id, [req.user.id], req.user.id);
      return rows[0].id;
    });
    res.status(201).json({ id });
  });

  app.patch('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const data = readBody(req.body || {}, { partial: true });
    const onlyFolder = Object.keys(data).every(k => k.startsWith('onedrive_'));
    // la cartella OneDrive la può collegare ogni membro; il resto solo responsabile e amministratori
    if (onlyFolder) await access.assertProject(req, id); else await access.assertManage(req, id);
    await assertArea(data.area_id);
    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok: true });
    await db.tx(async q => {
      const before = (await q.query('SELECT owner_id FROM projects WHERE id = $1', [id])).rows[0];
      await q.query(`UPDATE projects SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
        [id, ...Object.values(data)]);
      // cambiando responsabile, quello di prima resta nel progetto come membro
      if (data.owner_id && before.owner_id && data.owner_id !== before.owner_id) await access.addMembers(q, id, [before.owner_id], req.user.id);
    });
    res.json({ ok: true });
  });

  // Cancellare un progetto non cancella i ticket: restano senza progetto.
  app.delete('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertManage(req, id);
    await db.query('DELETE FROM projects WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── membri ─────────────────────────────────────────────────────────────────
  // Il responsabile per primo, poi i membri; con quanti ticket aperti ha ciascuno nel progetto.
  app.get('/api/projects/:id/members', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertProject(req, id);
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.job_title, u.last_login IS NOT NULL AS active,
              (u.id = p.owner_id) AS owner, m.added_at, ab.name AS added_by_name,
              (SELECT COUNT(*)::int FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id
                WHERE t.project_id = p.id AND a.user_id = u.id AND t.status <> 'done') AS open_tickets
         FROM projects p
         JOIN users u ON u.id = p.owner_id OR u.id IN (SELECT user_id FROM project_members WHERE project_id = p.id)
         LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = u.id
         LEFT JOIN users ab ON ab.id = m.added_by
        WHERE p.id = $1
        ORDER BY (u.id = p.owner_id) DESC, u.name`, [id]);
    res.json(rows);
  });

  app.post('/api/projects/:id/members', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertManage(req, id);
    const ids = v.ids(req.body?.user_ids, 'persone');
    if (!ids?.length) throw new HttpError(400, 'Scegli almeno una persona');
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = ANY($1::int[])', [ids]);
    if (rows[0].n !== ids.length) throw new HttpError(400, 'Una delle persone non esiste');
    await db.tx(q => access.addMembers(q, id, ids, req.user.id));
    res.status(201).json({ ok: true });
  });

  // Togliere un membro (responsabile o amministratore), oppure uscire da soli. Il responsabile non si toglie:
  // prima si cambia responsabile. I ticket già assegnati restano visibili a chi ne è assegnatario.
  app.delete('/api/projects/:id/members/:userId', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    if (userId === req.user.id) await access.assertProject(req, id); else await access.assertManage(req, id);
    const { rows } = await db.query('SELECT owner_id FROM projects WHERE id = $1', [id]);
    if (rows[0]?.owner_id === userId) throw new HttpError(400, 'Il responsabile non si può togliere: prima assegna il progetto a un altro responsabile');
    await db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId]);
    res.json({ ok: true });
  });
}

module.exports = { registerProjects };
