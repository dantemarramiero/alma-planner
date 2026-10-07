// Persone del team: chi ha già fatto accesso, più i colleghi aggiunti dalla rubrica Microsoft.
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');

function registerUsers(app, { db, auth }) {
  app.get('/api/me', (req, res) => {
    res.json({ ...req.user, microsoft: auth.msConfigured });
  });

  app.get('/api/users', async (_req, res) => {
    const { rows } = await db.query('SELECT id, email, name, job_title, last_login IS NOT NULL AS active FROM users ORDER BY name');
    res.json(rows);
  });

  // Cerca nella rubrica del tenant (per assegnare ticket a chi non è ancora entrato).
  app.get('/api/users/directory', async (req, res) => {
    const q = v.text(req.query.q, 'ricerca', { max: 100 }) || '';
    if (q.length < 2) return res.json([]);
    const token = await auth.graphToken(req.user.id);
    const term = q.replace(/"/g, '');
    const data = await graph(token, 'GET',
      `/users?$search=${encodeURIComponent(`"displayName:${term}" OR "mail:${term}"`)}&$select=id,displayName,mail,userPrincipalName,jobTitle&$top=15`,
      { headers: { ConsistencyLevel: 'eventual' } });
    res.json((data.value || [])
      .filter(u => u.mail || u.userPrincipalName)
      .map(u => ({ oid: u.id, name: u.displayName, email: (u.mail || u.userPrincipalName).toLowerCase(), job_title: u.jobTitle })));
  });

  app.post('/api/users', async (req, res) => {
    const b = req.body || {};
    const email = v.text(b.email, 'email', { max: 300, required: true }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Email non valida');
    const name = v.text(b.name, 'nome', { max: 200, required: true });
    const { rows } = await db.query(
      `INSERT INTO users (oid, email, name, job_title) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET oid = COALESCE(users.oid, EXCLUDED.oid) RETURNING id`,
      [v.text(b.oid, 'oid', { max: 100 }) || null, email, name, v.text(b.job_title, 'ruolo', { max: 200 }) || null]);
    res.status(201).json({ id: rows[0].id });
  });
}

module.exports = { registerUsers };
