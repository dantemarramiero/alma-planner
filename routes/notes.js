// Note con data su progetti e ticket. Le vede e le scrive chi vede il progetto o il ticket;
// le modifica, le fissa e le elimina chi le ha scritte o un amministratore. Eliminare si può annullare.
// Nel progetto compaiono anche le note dei suoi ticket (quelle dei ticket che chi guarda vede).
const { HttpError, v } = require('../lib/http');

const KINDS = ['nota', 'telefonata', 'riunione', 'decisione'];

const NOTE_SELECT = `
  SELECT n.id, n.project_id, n.ticket_id, n.kind, n.title, n.body, n.note_date, n.pinned, n.author_id,
         n.created_at, n.updated_at, t.title AS ticket_title
    FROM notes n LEFT JOIN tickets t ON t.id = n.ticket_id`;
const ORDER = 'ORDER BY n.pinned DESC, n.note_date DESC, n.id DESC';

function readNote(body, { partial }) {
  const out = {
    kind: v.oneOf(body.kind, 'tipo', KINDS),
    title: v.text(body.title, 'titolo', { max: 200 }),
    body: v.text(body.body, 'testo', { max: 20000, required: !partial }),
    note_date: v.date(body.note_date, 'data'),
    pinned: body.pinned === undefined ? undefined : Boolean(body.pinned),
  };
  if (out.body === '') throw new HttpError(400, 'Scrivi il testo della nota');
  if (out.note_date === null) throw new HttpError(400, 'La data della nota è obbligatoria');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

function registerNotes(app, { db, access }) {
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

  async function create(req, res, target) {
    const f = readNote(req.body || {}, { partial: false });
    const { rows } = await db.query(
      `INSERT INTO notes (project_id, ticket_id, kind, title, body, note_date, pinned, author_id)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8) RETURNING id`,
      [target.project_id || null, target.ticket_id || null, f.kind || 'nota', f.title || '', f.body, f.note_date || null, Boolean(f.pinned), req.user.id]);
    res.status(201).json(await one(req, rows[0].id));
  }

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
    res.json(await one(req, id));
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

module.exports = { registerNotes, KINDS };
