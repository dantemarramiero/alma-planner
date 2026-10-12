// Persone del team: chi ha già fatto accesso, più i colleghi aggiunti dalla rubrica Microsoft.
// Ognuno ha un profilo dell'intranet: foto, presentazione e i suoi post.
const { HttpError, v } = require('../lib/http');
const { graph } = require('../lib/graph');
const { checkOwnMedia } = require('../lib/media');

// handle = parte dell'email prima della chiocciola, usata per le @menzioni.
const USER_COLS = "u.id, u.email, u.name, u.job_title, split_part(u.email, '@', 1) AS handle, u.avatar_id, u.bio, u.last_login IS NOT NULL AS active";

function registerUsers(app, { db, auth, isAdmin, internalChat, softwareAccess }) {
  const getUser = async id => (await db.query(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id])).rows[0];

  app.get('/api/me', async (req, res) => {
    res.json({ ...(await getUser(req.user.id)), microsoft: auth.msConfigured, is_admin: isAdmin(req), internal_chat: Boolean(internalChat),
      software: softwareAccess ? await softwareAccess.canUse(req) : isAdmin(req) });
  });

  app.patch('/api/me', async (req, res) => {
    const b = req.body || {};
    const bio = v.text(b.bio, 'presentazione', { max: 300 });
    const avatarId = v.int(b.avatar_id, 'foto', { min: 1, nullable: true });
    if (avatarId) await checkOwnMedia(db, [avatarId], req.user.id);
    if (bio !== undefined) await db.query('UPDATE users SET bio = $2 WHERE id = $1', [req.user.id, bio]);
    if (avatarId !== undefined) await db.query('UPDATE users SET avatar_id = $2 WHERE id = $1', [req.user.id, avatarId]);
    res.json({ ...(await getUser(req.user.id)), microsoft: auth.msConfigured, is_admin: isAdmin(req) });
  });

  app.get('/api/users', async (_req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users u ORDER BY u.name`);
    res.json(rows);
  });

  // Profilo: dati della persona, numeri e griglia dei post.
  app.get('/api/profiles/:id', async (req, res) => {
    const id = v.int(req.params.id, 'persona', { min: 1 });
    const { rows } = await db.query(
      `SELECT ${USER_COLS},
              (SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id) AS post_count,
              (SELECT COUNT(*)::int FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = u.id) AS likes_received,
              (SELECT COUNT(*)::int FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = u.id AND t.status <> 'done') AS open_tickets
         FROM users u WHERE u.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Persona non trovata');
    const posts = await db.query(
      `SELECT p.id, left(p.body, 200) AS body, p.pinned_at,
              (SELECT json_build_object('id', m.id, 'w', m.width, 'h', m.height) FROM post_media pm JOIN media m ON m.id = pm.media_id
                WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS cover,
              (SELECT COUNT(*)::int FROM post_media pm WHERE pm.post_id = p.id) AS media_count,
              (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id = p.id) AS like_count,
              (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comment_count
         FROM posts p WHERE p.author_id = $1 ORDER BY p.id DESC LIMIT 90`, [id]);
    res.json({ ...rows[0], posts: posts.rows });
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
