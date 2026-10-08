// Email di Outlook nei progetti: si sceglie dalla propria casella (Graph, permesso Mail.Read) e se ne copiano
// testo e allegati nel progetto, così ogni membro le legge. Le vede e le assegna chi vede il progetto;
// le toglie chi le ha assegnate, il responsabile del progetto o un amministratore.
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const PAGE = 25;
const MAX_ASSIGN = 50;                       // email per richiesta
const MAX_ATTACHMENT = 20 * 1024 * 1024;     // un allegato
const MAX_EMAIL_ATTACHMENTS = 50 * 1024 * 1024; // allegati di una email
const FOLDERS = { inbox: 'inbox', sent: 'sentitems', all: null };
const LIST_SELECT = 'id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,hasAttachments,internetMessageId,isDraft';

const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });

// Graph risponde 403 se manca il consenso a Mail.Read: lo si dice chiaro.
async function mailGraph(token, method, path, opts) {
  try {
    return await graph(token, method, path, opts);
  } catch (err) {
    if (err.status === 403) throw new HttpError(403, 'Per leggere la posta serve il permesso «Mail.Read» di Microsoft: chiedi all\'amministratore di approvarlo', 'mail_read');
    throw err;
  }
}

// Contenuto binario di un allegato (graph() legge le risposte come testo).
async function graphBinary(token, path) {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(502, `Allegato non scaricato da Outlook (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const toBuffer = d => (Buffer.isBuffer(d) ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength));
const safeFilename = s => String(s || 'allegato').replace(/[\r\n"\\/]/g, '_').slice(0, 200);

function registerProjectEmails(app, { db, auth, access }) {
  async function getEmail(req, id) {
    const { rows } = await db.query('SELECT * FROM project_emails WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Email non trovata');
    await access.assertProject(req, rows[0].project_id); // 404 se il progetto non è visibile
    return rows[0];
  }

  // ── la propria casella, per scegliere le email da assegnare ────────────────
  app.get('/api/mail/messages', async (req, res) => {
    const folderKey = v.oneOf(req.query.folder, 'cartella', Object.keys(FOLDERS)) || 'inbox';
    const q = (v.text(req.query.q, 'ricerca', { max: 200 }) || '').replace(/"/g, '');
    const projectId = v.int(req.query.project, 'progetto', { min: 1 });
    if (projectId) await access.assertProject(req, projectId);
    const token = await auth.graphToken(req.user.id);

    let path;
    const next = typeof req.query.next === 'string' ? req.query.next : '';
    if (next) {
      // solo pagine successive della propria casella: il token non va mai verso altri indirizzi
      if (!next.startsWith(`${GRAPH}/me/`)) throw new HttpError(400, 'Pagina non valida');
      path = next;
    } else {
      const base = FOLDERS[folderKey] ? `/me/mailFolders/${FOLDERS[folderKey]}/messages` : '/me/messages';
      const params = new URLSearchParams({ $select: LIST_SELECT, $top: String(PAGE) });
      if (q) params.set('$search', `"${q}"`); else params.set('$orderby', 'receivedDateTime desc');
      path = `${base}?${params}`;
    }
    const data = await mailGraph(token, 'GET', path);
    const items = (data.value || []).filter(m => !m.isDraft);

    let assigned = new Set();
    if (projectId && items.length) {
      const { rows } = await db.query(
        'SELECT internet_message_id FROM project_emails WHERE project_id = $1 AND internet_message_id = ANY($2::text[])',
        [projectId, items.map(m => m.internetMessageId).filter(Boolean)]);
      assigned = new Set(rows.map(r => r.internet_message_id));
    }
    res.json({
      messages: items.map(m => ({
        id: m.id,
        subject: m.subject || '(senza oggetto)',
        from: person(m.from),
        to: (m.toRecipients || []).map(person),
        date: m.receivedDateTime || m.sentDateTime,
        preview: (m.bodyPreview || '').slice(0, 240),
        has_attachments: Boolean(m.hasAttachments),
        assigned: assigned.has(m.internetMessageId),
      })),
      next: data['@odata.nextLink'] || null,
    });
  });

  // ── email del progetto ─────────────────────────────────────────────────────
  app.get('/api/projects/:id/emails', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, id);
    const { rows } = await db.query(
      `SELECT e.id, e.subject, e.from_name, e.from_address, e.to_list, e.sent_at, e.assigned_by, e.assigned_at,
              left(regexp_replace(e.body_text, '\\s+', ' ', 'g'), 200) AS preview,
              (SELECT COUNT(*)::int FROM project_email_attachments a WHERE a.email_id = e.id) AS attachment_count
         FROM project_emails e WHERE e.project_id = $1 ORDER BY e.sent_at DESC NULLS LAST, e.id DESC`, [id]);
    res.json(rows);
  });

  app.post('/api/projects/:id/emails', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, projectId);
    const ids = req.body?.message_ids;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Scegli almeno una email');
    if (ids.length > MAX_ASSIGN) throw new HttpError(400, `Al massimo ${MAX_ASSIGN} email alla volta`);
    const messageIds = [...new Set(ids.map(x => v.text(x, 'email', { max: 500, required: true })))];
    const token = await auth.graphToken(req.user.id);

    let added = 0, already = 0;
    const skippedAttachments = [];
    for (const mid of messageIds) {
      const enc = encodeURIComponent(mid);
      const m = await mailGraph(token, 'GET',
        `/me/messages/${enc}?$select=subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,internetMessageId,hasAttachments,webLink`,
        { headers: { Prefer: 'outlook.body-content-type="text"' } });
      const imid = m.internetMessageId || `outlook:${mid}`;
      const { rows: dup } = await db.query('SELECT 1 FROM project_emails WHERE project_id = $1 AND internet_message_id = $2', [projectId, imid]);
      if (dup[0]) { already++; continue; }

      // allegati veri (non le immagini dentro la firma), entro i limiti
      const files = [];
      if (m.hasAttachments) {
        const list = await mailGraph(token, 'GET', `/me/messages/${enc}/attachments?$select=id,name,contentType,size,isInline`);
        let total = 0;
        for (const a of list.value || []) {
          if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
          if (a.size > MAX_ATTACHMENT || total + a.size > MAX_EMAIL_ATTACHMENTS) { skippedAttachments.push(a.name); continue; }
          const data = await graphBinary(token, `/me/messages/${enc}/attachments/${encodeURIComponent(a.id)}/$value`);
          total += data.length;
          files.push({ name: a.name || 'allegato', type: a.contentType || 'application/octet-stream', data });
        }
      }

      const inserted = await db.tx(async q => {
        const { rows } = await q.query(
          `INSERT INTO project_emails (project_id, internet_message_id, subject, from_name, from_address, to_list, cc_list,
                                       sent_at, body_text, assigned_by, outlook_id, web_link)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (project_id, internet_message_id) DO NOTHING RETURNING id`,
          [projectId, imid, (m.subject || '(senza oggetto)').slice(0, 1000), person(m.from).name || null, person(m.from).address || null,
            JSON.stringify((m.toRecipients || []).map(person)), JSON.stringify((m.ccRecipients || []).map(person)),
            m.sentDateTime || m.receivedDateTime || null, (m.body?.content || '').slice(0, 500000),
            req.user.id, mid, m.webLink || null]);
        if (!rows[0]) return false; // assegnata nel frattempo da un collega
        for (const f of files) {
          await q.query('INSERT INTO project_email_attachments (email_id, name, content_type, size, data) VALUES ($1, $2, $3, $4, $5)',
            [rows[0].id, f.name.slice(0, 300), f.type.slice(0, 200), f.data.length, f.data]);
        }
        return true;
      });
      if (inserted) added++; else already++;
    }
    res.status(201).json({ added, already, skipped_attachments: skippedAttachments });
  });

  app.get('/api/project-emails/:id', async (req, res) => {
    const e = await getEmail(req, v.int(req.params.id, 'email', { min: 1 }));
    const { rows } = await db.query('SELECT id, name, content_type, size FROM project_email_attachments WHERE email_id = $1 ORDER BY id', [e.id]);
    const { outlook_id: _o, web_link, ...rest } = e;
    // «Apri in Outlook» funziona solo nella casella di chi l'ha assegnata
    res.json({ ...rest, web_link: e.assigned_by === req.user.id ? web_link : null, attachments: rows });
  });

  app.get('/api/project-emails/:id/attachments/:aid', async (req, res) => {
    const e = await getEmail(req, v.int(req.params.id, 'email', { min: 1 }));
    const aid = v.int(req.params.aid, 'allegato', { min: 1 });
    const { rows } = await db.query('SELECT name, content_type, data FROM project_email_attachments WHERE id = $1 AND email_id = $2', [aid, e.id]);
    if (!rows[0]) throw new HttpError(404, 'Allegato non trovato');
    const name = safeFilename(rows[0].name);
    res.set({
      // mai interpretato dal browser come pagina: si scarica
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
    });
    res.send(toBuffer(rows[0].data));
  });

  app.delete('/api/project-emails/:id', async (req, res) => {
    const e = await getEmail(req, v.int(req.params.id, 'email', { min: 1 }));
    if (e.assigned_by !== req.user.id) {
      const role = await access.projectRole(req, e.project_id);
      if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Può toglierla chi l\'ha assegnata, il responsabile del progetto o un amministratore');
    }
    await db.query('DELETE FROM project_emails WHERE id = $1', [e.id]);
    res.json({ ok: true });
  });
}

module.exports = { registerProjectEmails };
