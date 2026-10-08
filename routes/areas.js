// Macro aree personali: ognuno ha le sue e ci raggruppa i progetti che vede. Nessun altro le vede o le cambia.
// Dove sta un progetto lo decide ciascuno per sé (project_areas), quindi basta poter vedere il progetto.
const { HttpError, v } = require('../lib/http');

function readBody(body, { partial }) {
  const out = {
    name: v.text(body.name, 'nome', { max: 80, required: !partial }),
    color: v.color(body.color, 'colore'),
    position: v.int(body.position, 'posizione', { min: 0, max: 10000 }),
  };
  if (partial && out.name === '') throw new HttpError(400, 'Il campo «nome» è obbligatorio');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

const duplicate = err => err?.code === '23505';

function registerAreas(app, { db, access }) {
  // 404 anche per le macro aree degli altri: non si rivela che esistono.
  async function assertMine(req, id) {
    const { rows } = await db.query('SELECT 1 FROM areas WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Macro area non trovata');
  }

  // Le mie macro aree, con quanti dei progetti che vedo (non archiviati) ci ho messo.
  app.get('/api/areas', async (req, res) => {
    const { rows } = await db.query(
      `SELECT a.id, a.name, a.color, a.position,
              (SELECT COUNT(*)::int FROM project_areas pa JOIN projects p ON p.id = pa.project_id
                WHERE pa.area_id = a.id AND p.status <> 'archived' AND ${access.projectFilter(req, 'p', '$1')}) AS project_count
         FROM areas a WHERE a.user_id = $1 ORDER BY a.position, lower(a.name)`, [req.user.id]);
    res.json(rows);
  });

  app.post('/api/areas', async (req, res) => {
    const data = readBody(req.body || {}, { partial: false });
    if (data.position === undefined) {
      const { rows } = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM areas WHERE user_id = $1', [req.user.id]);
      data.position = rows[0].n;
    }
    try {
      const { rows } = await db.query(
        'INSERT INTO areas (user_id, name, color, position) VALUES ($1, $2, COALESCE($3, \'#5B6770\'), $4) RETURNING id',
        [req.user.id, data.name, data.color ?? null, data.position]);
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `Hai già una macro area «${data.name}»`);
      throw err;
    }
  });

  app.patch('/api/areas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await assertMine(req, id);
    const data = readBody(req.body || {}, { partial: true });
    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok: true });
    try {
      await db.query(`UPDATE areas SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(data)]);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `Hai già una macro area «${data.name}»`);
      throw err;
    }
    res.json({ ok: true });
  });

  // I progetti della macro area restano, senza macro area (le righe di project_areas spariscono con lei).
  app.delete('/api/areas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await assertMine(req, id);
    await db.query('DELETE FROM areas WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // Mette un progetto in una delle mie macro aree (area_id null = toglierlo). Basta vedere il progetto.
  app.put('/api/projects/:id/area', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await access.assertProject(req, id);
    const areaId = v.int(req.body?.area_id, 'macro area', { min: 1, nullable: true }) ?? null;
    if (areaId === null) {
      await db.query('DELETE FROM project_areas WHERE user_id = $1 AND project_id = $2', [req.user.id, id]);
      return res.json({ ok: true });
    }
    await assertMine(req, areaId);
    await db.query(
      `INSERT INTO project_areas (user_id, project_id, area_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, project_id) DO UPDATE SET area_id = EXCLUDED.area_id`, [req.user.id, id, areaId]);
    res.json({ ok: true });
  });
}

module.exports = { registerAreas };
