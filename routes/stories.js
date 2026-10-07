// Storie: una foto con didascalia che resta visibile 24 ore, con chi l'ha vista.
const { HttpError, v } = require('../lib/http');
const { checkOwnMedia } = require('../lib/media');

function registerStories(app, { db, live }) {
  // Raggruppate per persona: prima le proprie, poi chi ha storie non ancora viste, poi le altre.
  app.get('/api/stories', async (req, res) => {
    const me = req.user.id;
    const { rows } = await db.query(
      `SELECT s.id, s.author_id, s.media_id, m.width, m.height, s.caption, s.created_at,
              EXISTS (SELECT 1 FROM story_views x WHERE x.story_id = s.id AND x.user_id = $1) AS seen,
              CASE WHEN s.author_id = $1 THEN (SELECT COUNT(*)::int FROM story_views x WHERE x.story_id = s.id) END AS view_count
         FROM stories s JOIN media m ON m.id = s.media_id
        WHERE s.expires_at > now()
        ORDER BY s.id`, [me]);
    const groups = new Map();
    for (const s of rows) {
      if (!groups.has(s.author_id)) groups.set(s.author_id, { user_id: s.author_id, items: [] });
      groups.get(s.author_id).items.push(s);
    }
    const list = [...groups.values()].map(g => ({ ...g, all_seen: g.user_id === me || g.items.every(s => s.seen), latest: g.items[g.items.length - 1].id }));
    list.sort((a, b) => (b.user_id === me) - (a.user_id === me) || a.all_seen - b.all_seen || b.latest - a.latest);
    res.json(list);
  });

  app.post('/api/stories', async (req, res) => {
    const mediaId = v.int(req.body?.media_id, 'foto', { min: 1 });
    if (!mediaId) throw new HttpError(400, 'Aggiungi una foto alla storia');
    const caption = v.text(req.body?.caption, 'didascalia', { max: 300 }) || '';
    await checkOwnMedia(db, [mediaId], req.user.id);
    const { rows } = await db.query('INSERT INTO stories (author_id, media_id, caption) VALUES ($1, $2, $3) RETURNING id', [req.user.id, mediaId, caption]);
    live.broadcast('story', { id: rows[0].id, author_id: req.user.id }, { except: req.user.id });
    res.status(201).json({ id: rows[0].id });
  });

  app.post('/api/stories/:id/view', async (req, res) => {
    const id = v.int(req.params.id, 'storia', { min: 1 });
    await db.query(
      `INSERT INTO story_views (story_id, user_id)
       SELECT id, $2 FROM stories WHERE id = $1 AND author_id <> $2 ON CONFLICT DO NOTHING`, [id, req.user.id]);
    res.json({ ok: true });
  });

  app.get('/api/stories/:id/viewers', async (req, res) => {
    const id = v.int(req.params.id, 'storia', { min: 1 });
    const { rows } = await db.query(
      `SELECT x.user_id, x.viewed_at FROM story_views x JOIN stories s ON s.id = x.story_id
        WHERE x.story_id = $1 AND s.author_id = $2 ORDER BY x.viewed_at DESC`, [id, req.user.id]);
    res.json(rows);
  });

  app.delete('/api/stories/:id', async (req, res) => {
    const id = v.int(req.params.id, 'storia', { min: 1 });
    const { rowCount } = await db.query('DELETE FROM stories WHERE id = $1 AND author_id = $2', [id, req.user.id]);
    if (!rowCount) throw new HttpError(403, 'Puoi cancellare solo le tue storie');
    res.json({ ok: true });
  });
}

module.exports = { registerStories };
