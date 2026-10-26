// Note con data su progetti e ticket. Le vede e le scrive chi vede il progetto o il ticket;
// le modifica, le fissa e le elimina chi le ha scritte o un amministratore. Eliminare si può annullare.
// Nel progetto compaiono anche le note dei suoi ticket (quelle dei ticket che chi guarda vede).
// @nome.cognome nel testo o nel titolo = menzione: chi viene taggato riceve una notifica nell'app, ma solo se vede
// il progetto o il ticket della nota (gli altri tornano in «cannot_see», e l'app avvisa chi scrive).
// Una nota può avere dei file (note_files, nel database) e può essere la nota di un incontro collegato al progetto
// (meeting_id, vedi routes/project-meetings.js): allora sta sia nell'incontro sia qui.
const express = require('express');
const { HttpError, v } = require('../lib/http');

const KINDS = ['nota', 'telefonata', 'riunione', 'decisione'];
const FILE_MAX = 20 * 1024 * 1024;

const NOTE_SELECT = `
  SELECT n.id, n.project_id, n.ticket_id, n.kind, n.title, n.body, n.note_date, n.pinned, n.author_id,
         n.created_at, n.updated_at, t.title AS ticket_title,
         n.meeting_id, m.subject AS meeting_subject, to_char(m.start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS meeting_start, m.all_day AS meeting_all_day,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'size', f.size, 'added_by', f.added_by) ORDER BY f.id)
                     FROM note_files f WHERE f.note_id = n.id), '[]') AS files
    FROM notes n LEFT JOIN tickets t ON t.id = n.ticket_id LEFT JOIN project_meetings m ON m.id = n.meeting_id`;
const ORDER = 'ORDER BY n.pinned DESC, n.note_date DESC, n.id DESC';

const toBuffer = d => (Buffer.isBuffer(d) ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength));
const safeFilename = s => String(s || 'file').replace(/[\r\n"\\/]/g, '_').slice(0, 200);

// allowEmpty: la nota nasce solo per dei file (il testo si può aggiungere dopo)
function readNote(body, { partial, allowEmpty = false }) {
  const out = {
    kind: v.oneOf(body.kind, 'tipo', KINDS),
    title: v.text(body.title, 'titolo', { max: 200 }),
    body: v.text(body.body, 'testo', { max: 20000, required: !partial && !allowEmpty }),
    note_date: v.date(body.note_date, 'data'),
    pinned: body.pinned === undefined ? undefined : Boolean(body.pinned),
  };
  if (out.body === '' && !allowEmpty) throw new HttpError(400, 'Scrivi il testo della nota');
  if (out.note_date === null) throw new HttpError(400, 'La data della nota è obbligatoria');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

function registerNotes(app, { db, access, notifier }) {
  // Chi è menzionato nel testo: [vede la nota, non la vede]. Si controlla con le stesse regole di accesso
  // (lib/access.js) facendo finta di essere quella persona.
  async function mentioned(n, text, except = []) {
    const ids = (await notifier.mentionedIds(text)).filter(id => !except.includes(id));
    if (!ids.length) return [[], []];
    const { rows } = await db.query('SELECT id, email FROM users WHERE id = ANY($1::int[])', [ids]);
    const yes = [], no = [];
    for (const u of rows) {
      const as = { user: { id: u.id, email: u.email } };
      try {
        if (n.project_id) await access.assertProject(as, n.project_id); else await access.assertTicket(as, n.ticket_id);
        yes.push(u.id);
      } catch { no.push(u.id); }
    }
    return [yes, no];
  }
  const noteText = n => `${n.title || ''}\n${n.body || ''}`;

  // Notifica le persone menzionate (escluse quelle già menzionate prima, per le modifiche) e dice a chi scrive come è andata.
  async function tellMentioned(req, n, before = null) {
    const already = before ? await notifier.mentionedIds(noteText(before)) : [];
    const [yes, no] = await mentioned(n, noteText(n), [...already, req.user.id]);
    if (yes.length) await notifier.notify({ userIds: yes, actorId: req.user.id, kind: 'note_mention', noteId: n.id });
    return { notified: yes, cannot_see: no };
  }

  async function getNote(req, id, { withDeleted = false } = {}) {
    const { rows } = await db.query(`SELECT * FROM notes WHERE id = $1 ${withDeleted ? '' : 'AND deleted_at IS NULL'}`, [id]);
    const n = rows[0];
    if (!n) throw new HttpError(404, 'Nota non trovata');
    if (n.project_id) await access.assertProject(req, n.project_id); else await access.assertTicket(req, n.ticket_id);
    return n;
  }
  const assertAuthor = (req, n) => {
    if (n.author_id !== req.user.id && !access.isAdmin(req)) throw new HttpError(403, 'Può cambiare la nota solo chi l\'ha scritta');
  };
  const one = async (req, id) => (await db.query(`${NOTE_SELECT} WHERE n.id = $1`, [id])).rows[0];

  // target: { project_id } | { ticket_id } | { project_id, meeting_id, kind, note_date, title } (nota di un incontro)
  async function create(req, res, target) {
    const b = req.body || {};
    const f = readNote(b, { partial: false, allowEmpty: Boolean(b.with_files) });
    const { rows } = await db.query(
      `INSERT INTO notes (project_id, ticket_id, meeting_id, kind, title, body, note_date, pinned, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9) RETURNING id`,
      [target.project_id || null, target.ticket_id || null, target.meeting_id || null, f.kind || target.kind || 'nota',
        f.title || target.title || '', f.body || '', f.note_date || target.note_date || null, Boolean(f.pinned), req.user.id]);
    const note = await one(req, rows[0].id);
    res.status(201).json({ ...note, mentions: await tellMentioned(req, note) });
  }

  // ── nota di un incontro: è una nota del progetto, di tipo «riunione», con la data e il titolo dell'incontro ──
  app.post('/api/meetings/:id/notes', async (req, res) => {
    const id = v.int(req.params.id, 'incontro', { min: 1 });
    const { rows: [m] } = await db.query('SELECT id, project_id, subject, start_at::date::text AS day FROM project_meetings WHERE id = $1', [id]);
    if (!m) throw new HttpError(404, 'Incontro non trovato');
    await access.assertProject(req, m.project_id);
    await create(req, res, { project_id: m.project_id, meeting_id: m.id, kind: 'riunione', note_date: m.day, title: m.subject.slice(0, 200) });
  });

  // ── file delle note (nel database, come gli allegati delle email): li aggiunge chi ha scritto la nota ─────────
  app.post('/api/notes/:id/files', express.raw({ type: () => true, limit: FILE_MAX }), async (req, res) => {
    const n = await getNote(req, v.int(req.params.id, 'nota', { min: 1 }));
    assertAuthor(req, n);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Il file è vuoto o non è arrivato');
    const name = v.text(req.query.name, 'nome del file', { max: 250, required: true });
    const type = (v.text(req.query.type, 'tipo', { max: 200 }) || 'application/octet-stream');
    const { rows: [f] } = await db.query(
      'INSERT INTO note_files (note_id, name, content_type, size, data, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, size, added_by',
      [n.id, name, type, req.body.length, req.body, req.user.id]);
    res.status(201).json(f);
  });

  async function getFile(req, id) {
    const { rows: [f] } = await db.query('SELECT id, note_id, name, added_by FROM note_files WHERE id = $1', [id]);
    if (!f) throw new HttpError(404, 'File non trovato');
    return { f, n: await getNote(req, f.note_id) }; // 404 se la nota è eliminata o non si vede
  }

  app.get('/api/note-files/:id', async (req, res) => {
    const { f } = await getFile(req, v.int(req.params.id, 'file', { min: 1 }));
    const { rows: [d] } = await db.query('SELECT data FROM note_files WHERE id = $1', [f.id]);
    const name = safeFilename(f.name);
    res.set({
      // mai interpretato dal browser come pagina: si scarica
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
    });
    res.send(toBuffer(d.data));
  });

  app.delete('/api/note-files/:id', async (req, res) => {
    const { f, n } = await getFile(req, v.int(req.params.id, 'file', { min: 1 }));
    if (f.added_by !== req.user.id && n.author_id !== req.user.id && !access.isAdmin(req)) throw new HttpError(403, 'Può togliere il file chi l\'ha aggiunto o chi ha scritto la nota');
    await db.query('DELETE FROM note_files WHERE id = $1', [f.id]);
    res.json({ ok: true });
  });

  // ── progetto: le sue note + quelle dei suoi ticket visibili ────────────────
  app.get('/api/projects/:id/notes', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, id);
    // per un amministratore il filtro è TRUE e non usa l'utente: il parametro si passa solo se serve
    const filter = access.ticketFilter(req, 't', '$2');
    const { rows } = await db.query(
      `${NOTE_SELECT}
        WHERE n.deleted_at IS NULL
          AND (n.project_id = $1 OR (t.project_id = $1 AND ${filter}))
        ${ORDER}`, filter === 'TRUE' ? [id] : [id, req.user.id]);
    res.json(rows);
  });

  app.post('/api/projects/:id/notes', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, id);
    await create(req, res, { project_id: id });
  });

  // ── ticket ─────────────────────────────────────────────────────────────────
  app.get('/api/tickets/:id/notes', async (req, res) => {
    const id = v.int(req.params.id, 'ticket', { min: 1 });
    await access.assertTicket(req, id);
    const { rows } = await db.query(`${NOTE_SELECT} WHERE n.deleted_at IS NULL AND n.ticket_id = $1 ${ORDER}`, [id]);
    res.json(rows);
  });

  app.post('/api/tickets/:id/notes', async (req, res) => {
    const id = v.int(req.params.id, 'ticket', { min: 1 });
    await access.assertTicket(req, id);
    await create(req, res, { ticket_id: id });
  });

  // ── singola nota ───────────────────────────────────────────────────────────
  app.patch('/api/notes/:id', async (req, res) => {
    const id = v.int(req.params.id, 'nota', { min: 1 });
    const n = await getNote(req, id);
    assertAuthor(req, n);
    const f = readNote(req.body || {}, { partial: true });
    const cols = Object.keys(f);
    if (cols.length) {
      // fissare/sganciare non conta come modifica del testo
      const edited = cols.some(c => c !== 'pinned');
      await db.query(`UPDATE notes SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}${edited ? ', updated_at = now()' : ''} WHERE id = $1`,
        [id, ...Object.values(f)]);
    }
    const note = await one(req, id);
    // nelle modifiche si avvisano solo le persone menzionate adesso per la prima volta
    res.json(f.body !== undefined || f.title !== undefined ? { ...note, mentions: await tellMentioned(req, note, n) } : note);
  });

  app.delete('/api/notes/:id', async (req, res) => {
    const id = v.int(req.params.id, 'nota', { min: 1 });
    const n = await getNote(req, id);
    assertAuthor(req, n);
    await db.query('UPDATE notes SET deleted_at = now() WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  app.post('/api/notes/:id/restore', async (req, res) => {
    const id = v.int(req.params.id, 'nota', { min: 1 });
    const n = await getNote(req, id, { withDeleted: true });
    assertAuthor(req, n);
    await db.query('UPDATE notes SET deleted_at = NULL WHERE id = $1', [id]);
    res.json(await one(req, id));
  });
}

module.exports = { registerNotes, KINDS, NOTE_SELECT, ORDER };
