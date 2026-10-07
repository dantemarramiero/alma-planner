// Notifiche dell'intranet e contatore per il menu (le chat sono su Teams: il loro contatore è /api/teams/unread).
function registerNotifications(app, { db, live }) {
  app.get('/api/notifications', async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id, n.actor_id, n.kind, n.post_id, n.comment_id, n.read_at, n.created_at,
              left(c.body, 120) AS comment_body,
              (SELECT pm.media_id FROM post_media pm WHERE pm.post_id = n.post_id ORDER BY pm.position LIMIT 1) AS post_media_id,
              left(p.body, 80) AS post_body
         FROM notifications n
         LEFT JOIN post_comments c ON c.id = n.comment_id
         LEFT JOIN posts p ON p.id = n.post_id
        WHERE n.user_id = $1 ORDER BY n.id DESC LIMIT 100`, [req.user.id]);
    res.json(rows);
  });

  app.post('/api/notifications/read', async (req, res) => {
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    live.send([req.user.id], 'badges');
    res.json({ ok: true });
  });

  app.get('/api/badges', async (req, res) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS notifications FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    res.json(rows[0]);
  });
}

module.exports = { registerNotifications };
