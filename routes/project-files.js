// Documenti del progetto e dei suoi ticket (le attività del Gantt sono ticket).
// L'elenco mostra il contenuto VERO della cartella OneDrive del progetto (letto da Microsoft a ogni apertura, quindi
// compare anche ciò che viene messo nella cartella da OneDrive o da Teams), più i file collegati da altre cartelle e
// quelli delle attività. Se il progetto non ha ancora una cartella, il primo caricamento crea «Alma Planet/<progetto>»
// nel OneDrive di chi carica, la collega al progetto e la condivide con le persone del progetto.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { graphAll } = require('../lib/graph');
const { uploadFile, ensureFolder, shareFolder, driveError } = require('../lib/onedrive');
const { mapItem } = require('./drive');

const LIST_SELECT = 'id,name,size,folder,file,lastModifiedDateTime,lastModifiedBy,webUrl,parentReference';

function registerProjectFiles(app, { db, auth, access }) {
  // Solo chi vede il progetto (responsabile, membri, amministratori) ne vede e tocca i documenti.
  async function getProject(req, id) {
    await access.assertProject(req, id);
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Progetto non trovato');
    return rows[0];
  }

  const folderPath = p => `/drives/${encodeURIComponent(p.onedrive_drive_id)}/items/${encodeURIComponent(p.onedrive_item_id)}`;

  async function memberEmails(projectId, exceptUserId) {
    const { rows } = await db.query(
      `SELECT DISTINCT u.email FROM projects p JOIN users u ON u.id = p.owner_id OR u.id IN (SELECT user_id FROM project_members WHERE project_id = p.id)
        WHERE p.id = $1 AND u.id <> $2`, [projectId, exceptUserId]);
    return rows.map(r => r.email);
  }

  // Cartella del progetto: quella collegata, oppure ne crea una al primo caricamento e la condivide con i membri.
  async function folderFor(req, p, token) {
    if (p.onedrive_item_id) return { p, created: false };
    const f = await ensureFolder(token, p.name);
    const { rows } = await db.query(
      `UPDATE projects SET onedrive_drive_id = $2, onedrive_item_id = $3, onedrive_name = $4, onedrive_url = $5, updated_at = now()
        WHERE id = $1 AND onedrive_item_id IS NULL RETURNING *`, [p.id, f.driveId, f.id, f.name, f.webUrl]);
    if (!rows[0]) return { p: (await db.query('SELECT * FROM projects WHERE id = $1', [p.id])).rows[0], created: false }; // qualcuno l'ha appena collegata
    const shared = await shareFolder(token, f.driveId, f.id, await memberEmails(p.id, req.user.id));
    return { p: rows[0], created: true, shared };
  }

  const fileName = req => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Il file è vuoto o non è arrivato'); // prima di creare la cartella
    const name = v.text(req.query.name, 'nome', { max: 250, required: true });
    if (!name) throw new HttpError(400, 'Manca il nome del file');
    return name; // i caratteri che OneDrive non accetta li sostituisce uploadFile
  };
  // ?path=Cartella/Sottocartella: dove mettere il file dentro la cartella del progetto (cartelle caricate dal computer)
  const subPath = req => String(req.query.path || '').split('/').map(x => x.trim()).filter(x => x && x !== '.' && x !== '..').slice(0, 12);

  // Documenti: cartella del progetto (dal vivo), file collegati da altre cartelle, file delle attività.
  app.get('/api/projects/:id/files', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    const p = await getProject(req, id);
    const [own, fromTickets] = await Promise.all([
      db.query(
        `SELECT f.*, u.name AS added_by_name FROM project_files f LEFT JOIN users u ON u.id = f.added_by
          WHERE f.project_id = $1 ORDER BY f.created_at DESC`, [id]),
      db.query(
        `SELECT f.*, t.title AS ticket_title, u.name AS added_by_name
           FROM ticket_files f JOIN tickets t ON t.id = f.ticket_id LEFT JOIN users u ON u.id = f.added_by
          WHERE t.project_id = $1 ORDER BY f.created_at DESC`, [id]),
    ]);
    let items = null, folderError = null;
    if (p.onedrive_item_id && auth.msConfigured) {
      try {
        const token = await auth.graphToken(req.user.id);
        items = (await graphAll(token, `${folderPath(p)}/children?$select=${LIST_SELECT}&$top=200`, { max: 1000 })).map(mapItem)
          .sort((a, b) => (b.folder - a.folder) || String(b.modified).localeCompare(String(a.modified)));
      } catch (err) {
        folderError = (driveError(err)).message;
      }
    }
    const inFolder = new Set((items || []).map(i => i.id));
    res.json({
      folder: p.onedrive_item_id ? { name: p.onedrive_name, webUrl: p.onedrive_url } : null,
      items, folderError,
      files: own.rows.filter(f => !inFolder.has(f.item_id)), // collegati da altre cartelle
      ticketFiles: fromTickets.rows,
    });
  });

  // Collega al progetto file o cartelle già su OneDrive: uno ({ drive_id, item_id, … }) o più ({ items: [...] }).
  app.post('/api/projects/:id/files', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await getProject(req, projectId);
    const list = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
    if (!list.length || list.length > 100) throw new HttpError(400, 'Scegli da 1 a 100 elementi');
    let added = 0;
    await db.tx(async q => {
      for (const b of list) {
        const r = await q.query(
          `INSERT INTO project_files (project_id, drive_id, item_id, name, web_url, size, is_folder, added_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [projectId,
            v.text(b.drive_id, 'drive', { max: 300, required: true }),
            v.text(b.item_id, 'file', { max: 300, required: true }),
            v.text(b.name, 'nome', { max: 500, required: true }),
            v.text(b.web_url, 'link', { max: 2000 }) || null,
            b.size === undefined || b.size === null ? null : v.int(b.size, 'dimensione', { min: 0 }),
            Boolean(b.folder), req.user.id]);
        added += r.rowCount;
      }
    });
    res.status(201).json({ ok: true, added });
  });

  // Carica un file dal computer nella cartella del progetto (creata al primo caricamento se manca).
  app.post('/api/projects/:id/files/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const name = fileName(req);
    const token = await auth.graphToken(req.user.id);
    const { p, created, shared } = await folderFor(req, await getProject(req, projectId), token);
    const item = await uploadFile(token, folderPath(p), { name, data: req.body, subfolders: subPath(req) });
    res.status(201).json({ ok: true, name: item.name, webUrl: item.webUrl, folderCreated: created ? p.onedrive_name : null, sharedWith: shared || 0 });
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    const fileId = v.int(req.params.fileId, 'file', { min: 1 });
    await access.assertProject(req, projectId);
    await db.query('DELETE FROM project_files WHERE id = $1 AND project_id = $2', [fileId, projectId]);
    res.json({ ok: true });
  });

  // Carica un file su un ticket: nella cartella del suo progetto, sottocartella del ticket.
  app.post('/api/tickets/:id/files/upload', express.raw({ type: () => true, limit: '250mb' }), async (req, res) => {
    const ticketId = v.int(req.params.id, 'ticket', { min: 1 });
    await access.assertTicket(req, ticketId);
    const { rows } = await db.query('SELECT id, title, project_id FROM tickets WHERE id = $1', [ticketId]);
    const t = rows[0];
    if (!t) throw new HttpError(404, 'Ticket non trovato');
    if (!t.project_id) throw new HttpError(400, 'Il ticket non è in un progetto: collega un file da OneDrive', 'no_folder');
    const name = fileName(req);
    const token = await auth.graphToken(req.user.id);
    const { p, created, shared } = await folderFor(req, await getProject(req, t.project_id), token);
    const item = await uploadFile(token, folderPath(p), { name, data: req.body, subfolders: [`Ticket ${t.id} - ${t.title}`] });
    await db.query(
      `INSERT INTO ticket_files (ticket_id, drive_id, item_id, name, web_url, size, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ticket_id, drive_id, item_id) DO NOTHING`,
      [ticketId, item.parentReference?.driveId || p.onedrive_drive_id, item.id, item.name, item.webUrl, item.size ?? null, req.user.id]);
    res.status(201).json({ ok: true, name: item.name, webUrl: item.webUrl, folderCreated: created ? p.onedrive_name : null, sharedWith: shared || 0 });
  });
}

module.exports = { registerProjectFiles };
