// Macro aree: gruppi di progetti. Le vedono tutti (sono solo nomi); i progetti dentro restano visibili
// solo a chi ne è responsabile o membro (lib/access.js), quindi il conteggio è quello dei progetti che vedi tu.
// Le crea chiunque; rinominarle, riordinarle e cancellarle spetta a chi le ha create e agli amministratori.
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
  async function assertEdit(req, id) {
    const { rows } = await db.query('SELECT created_by FROM areas WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Macro area non trovata');
    if (rows[0].created_by !== req.user.id && !access.isAdmin(req)) {
      throw new HttpError(403, 'La macro area la può cambiare solo chi l\'ha creata o un amministratore');
    }
  }

  app.get('/api/areas', async (req, res) => {
    const filter = access.projectFilter(req, 'p', '$1');
    const { rows } = await db.query(
      `SELECT a.id, a.name, a.color, a.position, a.created_by,
              (a.created_by = $1) AS mine,
              (SELECT COUNT(*)::int FROM projects p WHERE p.area_id = a.id AND p.status <> 'archived' AND ${filter}) AS project_count
         FROM areas a ORDER BY a.position, lower(a.name)`, [req.user.id]);
    const admin = access.isAdmin(req);
    res.json(rows.map(r => ({ ...r, can_edit: r.mine || admin })));
  });

  app.post('/api/areas', async (req, res) => {
    const data = readBody(req.body || {}, { partial: false });
    if (data.position === undefined) {
      const { rows } = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM areas');
      data.position = rows[0].n;
    }
    try {
      const { rows } = await db.query(
        'INSERT INTO areas (name, color, position, created_by) VALUES ($1, COALESCE($2, \'#5B6770\'), $3, $4) RETURNING id',
        [data.name, data.color ?? null, data.position, req.user.id]);
      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `Esiste già una macro area «${data.name}»`);
      throw err;
    }
  });

  app.patch('/api/areas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await assertEdit(req, id);
    const data = readBody(req.body || {}, { partial: true });
    const cols = Object.keys(data);
    if (!cols.length) return res.json({ ok: true });
    try {
      await db.query(`UPDATE areas SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(data)]);
    } catch (err) {
      if (duplicate(err)) throw new HttpError(400, `Esiste già una macro area «${data.name}»`);
      throw err;
    }
    res.json({ ok: true });
  });

  // I progetti della macro area restano, senza macro area (ON DELETE SET NULL).
  app.delete('/api/areas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await assertEdit(req, id);
    await db.query('DELETE FROM areas WHERE id = $1', [id]);
    res.json({ ok: true });
  });
}

module.exports = { registerAreas };
