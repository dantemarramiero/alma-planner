// File del progetto e dei suoi ticket (le attività del Gantt sono ticket).
// I file caricati dal computer vanno nella cartella OneDrive collegata al progetto;
// quelli di un ticket in una sottocartella «Ticket N - titolo».
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { uploadFile } = require('../lib/onedrive');

function registerProjectFiles(app, { db, auth }) {
  async function getProject(id) {
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Progetto non trovato');
    return rows[0];
  }

  const folderPath = p => `/drives/${encodeURIComponent(p.onedrive_drive_id)}/items/${encodeURIComponent(p.onedrive_item_id)}`;

  function readUpload(req, p) {
    if (!p.onedrive_item_id) throw new HttpError(400, 'Collega prima una cartella OneDrive al progetto', 'no_folder');
    const name = v.text(req.query.name, 'nome', { max: 250, required: true });
    if (/[\\/:*?"<>|]/.test(name)) throw new HttpError(400, 'Il nome del file contiene caratteri non ammessi');
    return name;
  }

  // Tutti i documenti del progetto: del progetto intero e dei suoi ticket/attività.
  app.get('/api/projects/:id/files', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const [own, fromTickets] = await Promise.all([
      db.query(
        `SELECT f.*, u.name AS added_by_name FROM project_files f LEFT JOIN users u ON u.id = f.added_by
          WHERE f.project_id = $1 ORDER BY f.created_at DESC`, [id]),
      db.query(
        `SELECT f.*, t.title AS ticket_title, u.name AS added_by_name
           FROM ticket_files f JOIN tickets t ON t.id = f.ticket_id LEFT JOIN users u ON u.id = f.added_by
          WHERE t.project_id = $1 ORDER BY f.created_at DESC`, [id]),
    ]);
    res.json({ files: own.rows, ticketFiles: fromTickets.rows });
  });

  // Collega al progetto un file già presente su OneDrive.
  app.post('/api/projects/:id/files', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await getProject(projectId);
    const b = req.body || {};
    await db.query(
      `INSERT INTO project_files (project_id, drive_id, item_id, name, web_url, size, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [projectId,
        v.text(b.drive_id, 'drive', { max: 300, required: true }),
        v.text(b.item_id, 'file', { max: 300, required: true }),
        v.text(b.name, 'nome', { max: 500, required: true }),
        v.text(b.web_url, 'link', { max: 2000 }) || null,
        b.size === undefined || b.size === null ? null : v.int(b.size, 'dimensione', { min: 0 }),
        req.user.id]);
    res.status(201).json({ ok: true });
  });

  // Carica un file dal computer nella cartella del progetto.
  app.post('/api/projects/:id/files/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await getProject(projectId);
    const name = readUpload(req, p);
    const token = await auth.graphToken(req.user.id);
    const item = await uploadFile(token, folderPath(p), { name, data: req.body });
    await db.query(
      `INSERT INTO project_files (project_id, drive_id, item_id, name, web_url, size, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [projectId, item.parentReference?.driveId || p.onedrive_drive_id, item.id, item.name, item.webUrl, item.size ?? null, req.user.id]);
    res.status(201).json({ ok: true, name: item.name, webUrl: item.webUrl });
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const fileId = v.int(req.params.fileId, 'file', { min: 1 });
    await db.query('DELETE FROM project_files WHERE id = $1 AND project_id = $2', [fileId, projectId]);
    res.json({ ok: true });
  });

  // Carica un file su un ticket: nella cartella del suo progetto, sottocartella del ticket.
  app.post('/api/tickets/:id/files/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const ticketId = v.int(req.params.id, 'ticket', { min: 1 });
    const { rows } = await db.query('SELECT id, title, project_id FROM tickets WHERE id = $1', [ticketId]);
    const t = rows[0];
    if (!t) throw new HttpError(404, 'Ticket non trovato');
    if (!t.project_id) throw new HttpError(400, 'Il ticket non è in un progetto: collega un file da OneDrive', 'no_folder');
    const p = await getProject(t.project_id);
    const name = readUpload(req, p);
    const token = await auth.graphToken(req.user.id);
    const item = await uploadFile(token, folderPath(p), { name, data: req.body, subfolders: [`Ticket ${t.id} - ${t.title}`] });
    await db.query(
      `INSERT INTO ticket_files (ticket_id, drive_id, item_id, name, web_url, size, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ticket_id, drive_id, item_id) DO NOTHING`,
      [ticketId, item.parentReference?.driveId || p.onedrive_drive_id, item.id, item.name, item.webUrl, item.size ?? null, req.user.id]);
    res.status(201).json({ ok: true, name: item.name, webUrl: item.webUrl });
  });
}

module.exports = { registerProjectFiles };
