// Notifiche dell'intranet e contatori per il menu. Le chat di Teams hanno il loro (/api/teams/unread);
// «internal» = chat interna con messaggi non letti, solo se è accesa (INTERNAL_CHAT=1).
function registerNotifications(app, { db, live, internalChat }) {
  app.get('/api/notifications', async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id, n.actor_id, n.kind, n.post_id, n.comment_id, n.note_id, n.read_at, n.created_at,
              nt.project_id AS note_project_id, nt.ticket_id AS note_ticket_id, left(nt.body, 120) AS note_body,
              left(c.body, 120) AS comment_body,
              (SELECT pm.media_id FROM post_media pm WHERE pm.post_id = n.post_id ORDER BY pm.position LIMIT 1) AS post_media_id,
              left(p.body, 80) AS post_body
         FROM notifications n
         LEFT JOIN post_comments c ON c.id = n.comment_id
         LEFT JOIN posts p ON p.id = n.post_id
         LEFT JOIN notes nt ON nt.id = n.note_id
        WHERE n.user_id = $1 AND (n.note_id IS NULL OR nt.deleted_at IS NULL) -- una nota eliminata non si notifica più
        ORDER BY n.id DESC LIMIT 100`, [req.user.id]);
    res.json(rows);
  });

  app.post('/api/notifications/read', async (req, res) => {
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    live.send([req.user.id], 'badges');
    res.json({ ok: true });
  });

  app.get('/api/badges', async (req, res) => {
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM notifications n LEFT JOIN notes nt ON nt.id = n.note_id
                WHERE n.user_id = $1 AND n.read_at IS NULL AND (n.note_id IS NULL OR nt.deleted_at IS NULL)) AS notifications
              ${internalChat ? `, (SELECT COUNT(*)::int FROM conversation_members cm
                WHERE cm.user_id = $1 AND EXISTS (
                  SELECT 1 FROM messages m WHERE m.conversation_id = cm.conversation_id
                     AND m.id > cm.last_read_id AND m.user_id IS DISTINCT FROM $1)) AS internal` : ''}`, [req.user.id]);
    res.json(rows[0]);
  });
}

module.exports = { registerNotifications };
