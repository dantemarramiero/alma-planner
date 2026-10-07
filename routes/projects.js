// Progetti: elenco con avanzamento, creazione, modifica, cartella OneDrive collegata.
const { HttpError, v } = require('../lib/http');

const STATUSES = ['active', 'paused', 'done', 'archived'];

// Date «effettive» per il Gantt: quelle del progetto, altrimenti l'arco dei suoi ticket.
const SELECT = `
  SELECT p.*, o.name AS owner_name,
         COUNT(t.id)::int AS ticket_count,
         COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS done_count,
         MIN(COALESCE(t.start_date, t.due_date)) AS tickets_start,
         MAX(COALESCE(t.due_date, t.start_date)) AS tickets_end
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
    onedrive_drive_id: v.text(body.onedrive_drive_id, 'cartella OneDrive', { max: 300 }),
    onedrive_item_id: v.text(body.onedrive_item_id, 'cartella OneDrive', { max: 300 }),
    onedrive_name: v.text(body.onedrive_name, 'cartella OneDrive', { max: 500 }),
    onedrive_url: v.text(body.onedrive_url, 'cartella OneDrive', { max: 2000 }),
  };
  if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
  if (out.start_date && out.end_date && out.start_date > out.end_date) throw new HttpError(400, 'La fine del progetto è prima dell\'inizio');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

function registerProjects(app, { db }) {
  app.get('/api/projects', async (req, res) => {
    const all = req.query.all === '1';
    const { rows } = await db.query(`${SELECT} ${all ? '' : "WHERE p.status <> 'archived'"} GROUP BY p.id, o.name ORDER BY p.status = 'active' DESC, p.name`);
    res.json(rows);
  });

  app.get('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows } = await db.query(`${SELECT} WHERE p.id = $1 GROUP BY p.id, o.name`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Progetto non trovato');
    res.json(rows[0]);
  });

  app.post('/api/projects', async (req, res) => {
    const data = readBody(req.body || {}, { partial: false });
    if (data.owner_id === undefined) data.owner_id = req.user.id;
    const cols = Object.keys(data);
    const { rows } = await db.query(
      `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(data));
    res.status(201).json({ id: rows[0].id });
  });

  app.patch('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const data = readBody(req.body || {}, { partial: true });
    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok: true });
    const { rowCount } = await db.query(
      `UPDATE projects SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...Object.values(data)]);
    if (!rowCount) throw new HttpError(404, 'Progetto non trovato');
    res.json({ ok: true });
  });

  // Cancellare un progetto non cancella i ticket: restano senza progetto.
  app.delete('/api/projects/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Progetto non trovato');
    res.json({ ok: true });
  });
}

module.exports = { registerProjects };
