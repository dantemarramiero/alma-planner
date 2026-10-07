// Attività del Gantt create a mano (con responsabili) e file del progetto o delle sue attività.
// I file si caricano nella cartella OneDrive collegata al progetto; quelli di un'attività in una sottocartella col suo nome.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { uploadFile } = require('../lib/onedrive');

const SELECT = `
  SELECT a.*, p.name AS project_name, p.color AS project_color,
         COALESCE((SELECT json_agg(x.user_id ORDER BY x.user_id) FROM activity_assignees x WHERE x.activity_id = a.id), '[]') AS assignee_ids,
         (SELECT COUNT(*)::int FROM project_files f WHERE f.activity_id = a.id) AS file_count
    FROM activities a
    JOIN projects p ON p.id = a.project_id`;

function readBody(body, { partial }) {
  const out = {
    title: v.text(body.title, 'titolo', { max: 300, required: !partial }),
    description: v.text(body.description, 'descrizione', { max: 20000 }),
    start_date: v.date(body.start_date, 'inizio'),
    end_date: v.date(body.end_date, 'fine'),
    progress: v.int(body.progress, 'avanzamento', { min: 0, max: 100 }),
  };
  if (partial && out.title === '') throw new HttpError(400, 'Il campo «titolo» è obbligatorio');
  if (out.start_date === null || out.end_date === null) throw new HttpError(400, 'Un\'attività ha sempre inizio e fine');
  if (!partial && (!out.start_date || !out.end_date)) throw new HttpError(400, 'Un\'attività ha sempre inizio e fine');
  return {
    fields: Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined)),
    assigneeIds: v.ids(body.assignee_ids, 'responsabili'),
  };
}

function registerActivities(app, { db, auth }) {
  async function getActivity(id, q = db) {
    const { rows } = await q.query(`${SELECT} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Attività non trovata');
    return rows[0];
  }

  async function getProject(id) {
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Progetto non trovato');
    return rows[0];
  }

  async function setAssignees(q, activityId, ids) {
    if (ids.length) {
      const { rows } = await q.query('SELECT COUNT(*)::int AS n FROM users WHERE id = ANY($1::int[])', [ids]);
      if (rows[0].n !== ids.length) throw new HttpError(400, 'Uno dei responsabili non esiste');
    }
    await q.query('DELETE FROM activity_assignees WHERE activity_id = $1', [activityId]);
    for (const uid of ids) await q.query('INSERT INTO activity_assignees (activity_id, user_id) VALUES ($1, $2)', [activityId, uid]);
  }

  // ── attività ───────────────────────────────────────────────────────────────
  app.get('/api/projects/:id/activities', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const { rows } = await db.query(`${SELECT} WHERE a.project_id = $1 ORDER BY a.start_date, a.id`, [id]);
    res.json(rows);
  });

  // ?assignee=me: attività aperte di cui sono responsabile (per «I miei ticket»); senza filtro: tutte (Gantt generale).
  app.get('/api/activities', async (req, res) => {
    if (req.query.assignee === 'me') {
      const { rows } = await db.query(
        `${SELECT} WHERE EXISTS (SELECT 1 FROM activity_assignees x WHERE x.activity_id = a.id AND x.user_id = $1)
           AND a.progress < 100 AND p.status <> 'archived'
         ORDER BY a.end_date, a.id`, [req.user.id]);
      return res.json(rows);
    }
    const { rows } = await db.query(`${SELECT} WHERE p.status <> 'archived' ORDER BY a.start_date, a.id LIMIT 5000`);
    res.json(rows);
  });

  app.get('/api/activities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const a = await getActivity(id);
    const files = await db.query(
      `SELECT f.*, u.name AS added_by_name FROM project_files f LEFT JOIN users u ON u.id = f.added_by
        WHERE f.activity_id = $1 ORDER BY f.created_at`, [id]);
    res.json({ ...a, files: files.rows });
  });

  app.post('/api/projects/:id/activities', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await getProject(projectId);
    const { fields, assigneeIds } = readBody(req.body || {}, { partial: false });
    if (fields.start_date > fields.end_date) throw new HttpError(400, 'La fine è prima dell\'inizio');
    const id = await db.tx(async q => {
      const all = { ...fields, project_id: projectId, created_by: req.user.id };
      const cols = Object.keys(all);
      const { rows } = await q.query(
        `INSERT INTO activities (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(all));
      await setAssignees(q, rows[0].id, assigneeIds || []);
      return rows[0].id;
    });
    res.status(201).json(await getActivity(id));
  });

  app.patch('/api/activities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { fields, assigneeIds } = readBody(req.body || {}, { partial: true });
    await db.tx(async q => {
      const before = await getActivity(id, q);
      const start = fields.start_date || before.start_date;
      const end = fields.end_date || before.end_date;
      if (start > end) throw new HttpError(400, 'La fine è prima dell\'inizio');
      const cols = Object.keys(fields);
      if (cols.length) {
        await q.query(`UPDATE activities SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...Object.values(fields)]);
      }
      if (assigneeIds) await setAssignees(q, id, assigneeIds);
    });
    res.json(await getActivity(id));
  });

  // I file restano su OneDrive: si toglie solo il collegamento.
  app.delete('/api/activities/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query('DELETE FROM activities WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Attività non trovata');
    res.json({ ok: true });
  });

  // ── file del progetto e delle attività ─────────────────────────────────────
  // Tutti i documenti del progetto: del progetto intero, delle attività e dei ticket.
  app.get('/api/projects/:id/files', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const [own, fromTickets] = await Promise.all([
      db.query(
        `SELECT f.*, a.title AS activity_title, u.name AS added_by_name
           FROM project_files f
           LEFT JOIN activities a ON a.id = f.activity_id
           LEFT JOIN users u ON u.id = f.added_by
          WHERE f.project_id = $1 ORDER BY f.created_at DESC`, [id]),
      db.query(
        `SELECT f.id, f.ticket_id, t.title AS ticket_title, f.drive_id, f.item_id, f.name, f.web_url, f.created_at, u.name AS added_by_name
           FROM ticket_files f
           JOIN tickets t ON t.id = f.ticket_id
           LEFT JOIN users u ON u.id = f.added_by
          WHERE t.project_id = $1 ORDER BY f.created_at DESC`, [id]),
    ]);
    res.json({ files: own.rows, ticketFiles: fromTickets.rows });
  });

  async function checkActivity(projectId, activityId) {
    if (activityId === null || activityId === undefined) return null;
    const a = await getActivity(activityId);
    if (a.project_id !== projectId) throw new HttpError(400, 'L\'attività non è di questo progetto');
    return a;
  }

  async function insertFile(projectId, activityId, f, userId) {
    await db.query(
      `INSERT INTO project_files (project_id, activity_id, drive_id, item_id, name, web_url, size, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [projectId, activityId, f.drive_id, f.item_id, f.name, f.web_url || null, f.size ?? null, userId]);
  }

  // Collega un file già presente su OneDrive.
  app.post('/api/projects/:id/files', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await getProject(projectId);
    const b = req.body || {};
    const activityId = v.int(b.activity_id, 'attività', { min: 1, nullable: true }) ?? null;
    await checkActivity(projectId, activityId);
    await insertFile(projectId, activityId, {
      drive_id: v.text(b.drive_id, 'drive', { max: 300, required: true }),
      item_id: v.text(b.item_id, 'file', { max: 300, required: true }),
      name: v.text(b.name, 'nome', { max: 500, required: true }),
      web_url: v.text(b.web_url, 'link', { max: 2000 }),
      size: b.size === undefined || b.size === null ? null : v.int(b.size, 'dimensione', { min: 0 }),
    }, req.user.id);
    res.status(201).json({ ok: true });
  });

  // Carica un file dal computer nella cartella OneDrive del progetto (sottocartella dell'attività, se indicata).
  app.post('/api/projects/:id/files/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await getProject(projectId);
    if (!p.onedrive_item_id) throw new HttpError(400, 'Collega prima una cartella OneDrive al progetto', 'no_folder');
    const name = v.text(req.query.name, 'nome', { max: 250, required: true });
    if (/[\\/:*?"<>|]/.test(name)) throw new HttpError(400, 'Il nome del file contiene caratteri non ammessi');
    const activityId = v.int(req.query.activity, 'attività', { min: 1, nullable: true }) ?? null;
    const activity = await checkActivity(projectId, activityId);
    const token = await auth.graphToken(req.user.id);
    const item = await uploadFile(token, `/drives/${encodeURIComponent(p.onedrive_drive_id)}/items/${encodeURIComponent(p.onedrive_item_id)}`, {
      name, data: req.body, subfolders: activity ? [`Attività ${activity.id} - ${activity.title}`] : [],
    });
    await insertFile(projectId, activityId, {
      drive_id: item.parentReference?.driveId || p.onedrive_drive_id, item_id: item.id, name: item.name, web_url: item.webUrl, size: item.size,
    }, req.user.id);
    res.status(201).json({ ok: true, name: item.name, webUrl: item.webUrl });
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const fileId = v.int(req.params.fileId, 'file', { min: 1 });
    await db.query('DELETE FROM project_files WHERE id = $1 AND project_id = $2', [fileId, projectId]);
    res.json({ ok: true });
  });
}

module.exports = { registerActivities };
