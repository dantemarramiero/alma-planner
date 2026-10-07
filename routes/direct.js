// Messaggi diretti: chat a due e di gruppo, con foto, post condivisi, non letti e «Visto», in tempo reale.
const { HttpError, v } = require('../lib/http');
const { checkOwnMedia } = require('../lib/media');

const PAGE = 50;

// $1 = utente che guarda.
const CONV_SELECT = `
  SELECT c.id, c.title, c.is_group, c.created_at, c.last_message_at,
         (SELECT json_agg(json_build_object('user_id', x.user_id, 'last_read_id', x.last_read_id) ORDER BY x.user_id)
            FROM conversation_members x WHERE x.conversation_id = c.id) AS members,
         (SELECT row_to_json(lm) FROM (
            SELECT m.id, m.user_id, m.body, m.media_id, m.post_id, m.created_at
              FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) lm) AS last_message,
         (SELECT COUNT(*)::int FROM messages m
           WHERE m.conversation_id = c.id AND m.id > cm.last_read_id AND m.user_id IS DISTINCT FROM $1) AS unread
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1`;

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.user_id, m.body, m.media_id, mm.width AS media_w, mm.height AS media_h, m.post_id, m.created_at,
         CASE WHEN m.post_id IS NOT NULL THEN (
           SELECT json_build_object('id', p.id, 'author_id', p.author_id, 'body', left(p.body, 140),
                    'media_id', (SELECT pm.media_id FROM post_media pm WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1))
             FROM posts p WHERE p.id = m.post_id) END AS post
    FROM messages m LEFT JOIN media mm ON mm.id = m.media_id`;

function registerDirect(app, { db, live }) {
  const withPresence = c => ({ ...c, members: c.members.map(m => ({ ...m, online: live.isOnline(m.user_id) })) });

  async function getConversation(id, userId) {
    const { rows } = await db.query(`${CONV_SELECT} WHERE c.id = $2`, [userId, id]);
    if (!rows[0]) throw new HttpError(404, 'Conversazione non trovata');
    return withPresence(rows[0]);
  }

  const memberIds = c => c.members.map(m => m.user_id);

  async function checkUsers(ids) {
    if (!ids.length) return;
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = ANY($1::int[])', [ids]);
    if (rows[0].n !== ids.length) throw new HttpError(400, 'Una delle persone non esiste');
  }

  app.get('/api/conversations', async (req, res) => {
    const { rows } = await db.query(`${CONV_SELECT} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, [req.user.id]);
    res.json(rows.map(withPresence));
  });

  // Con una sola persona riapre la chat che c'è già; con più persone crea un gruppo.
  app.post('/api/conversations', async (req, res) => {
    const others = (v.ids(req.body?.user_ids, 'persone') || []).filter(id => id !== req.user.id);
    if (!others.length) throw new HttpError(400, 'Scegli almeno un collega');
    await checkUsers(others);
    const title = v.text(req.body?.title, 'nome del gruppo', { max: 100 }) || null;
    const members = [req.user.id, ...others].sort((a, b) => a - b);
    const isGroup = others.length > 1 || Boolean(title);
    if (!isGroup) {
      const { rows } = await db.query(
        `SELECT c.id FROM conversations c WHERE NOT c.is_group
            AND (SELECT array_agg(x.user_id ORDER BY x.user_id) FROM conversation_members x WHERE x.conversation_id = c.id) = $1::int[]
          LIMIT 1`, [members]);
      if (rows[0]) return res.json(await getConversation(rows[0].id, req.user.id));
    }
    const id = await db.tx(async q => {
      const { rows } = await q.query('INSERT INTO conversations (title, is_group, created_by) VALUES ($1, $2, $3) RETURNING id', [title, isGroup, req.user.id]);
      for (const uid of members) await q.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)', [rows[0].id, uid]);
      return rows[0].id;
    });
    const c = await getConversation(id, req.user.id);
    live.send(others, 'conversation', { id });
    res.status(201).json(c);
  });

  app.get('/api/conversations/:id', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    res.json(await getConversation(id, req.user.id));
  });

  app.patch('/api/conversations/:id', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    const c = await getConversation(id, req.user.id);
    if (!c.is_group) throw new HttpError(400, 'Solo i gruppi hanno un nome');
    const title = v.text(req.body?.title, 'nome del gruppo', { max: 100 }) || null;
    await db.query('UPDATE conversations SET title = $2 WHERE id = $1', [id, title]);
    live.send(memberIds(c), 'conversation', { id });
    res.json(await getConversation(id, req.user.id));
  });

  app.post('/api/conversations/:id/members', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    const c = await getConversation(id, req.user.id);
    if (!c.is_group) throw new HttpError(400, 'Per aggiungere persone crea un gruppo');
    const ids = v.ids(req.body?.user_ids, 'persone') || [];
    await checkUsers(ids);
    // Chi entra parte dai messaggi nuovi: quelli vecchi non risultano non letti.
    for (const uid of ids) {
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, last_read_id)
         VALUES ($1, $2, COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = $1), 0)) ON CONFLICT DO NOTHING`, [id, uid]);
    }
    const after = await getConversation(id, req.user.id);
    live.send(memberIds(after), 'conversation', { id });
    res.json(after);
  });

  app.delete('/api/conversations/:id/members/me', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    const c = await getConversation(id, req.user.id);
    if (!c.is_group) throw new HttpError(400, 'Puoi uscire solo dai gruppi');
    await db.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [id, req.user.id]);
    live.send(memberIds(c).filter(u => u !== req.user.id), 'conversation', { id });
    res.json({ ok: true });
  });

  // ── messaggi ───────────────────────────────────────────────────────────────
  app.get('/api/conversations/:id/messages', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    await getConversation(id, req.user.id);
    const before = v.int(req.query.before, 'cursore', { min: 1 });
    const { rows } = await db.query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 ${before ? 'AND m.id < $2' : ''} ORDER BY m.id DESC LIMIT ${PAGE + 1}`,
      before ? [id, before] : [id]);
    const more = rows.length > PAGE;
    const messages = rows.slice(0, PAGE).reverse();
    res.json({ messages, next: more ? messages[0].id : null });
  });

  app.post('/api/conversations/:id/messages', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    const c = await getConversation(id, req.user.id);
    const body = v.text(req.body?.body, 'messaggio', { max: 5000 }) || '';
    const mediaId = v.int(req.body?.media_id, 'foto', { min: 1, nullable: true }) || null;
    const postId = v.int(req.body?.post_id, 'post', { min: 1, nullable: true }) || null;
    if (!body && !mediaId && !postId) throw new HttpError(400, 'Il messaggio è vuoto');
    if (postId) {
      const { rows } = await db.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
      if (!rows[0]) throw new HttpError(404, 'Post non trovato');
    }
    const msgId = await db.tx(async q => {
      if (mediaId) {
        await checkOwnMedia(q, [mediaId], req.user.id);
        await q.query('UPDATE media SET conversation_id = $2 WHERE id = $1', [mediaId, id]); // da qui la vedono solo i membri
      }
      const { rows } = await q.query(
        'INSERT INTO messages (conversation_id, user_id, body, media_id, post_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
        [id, req.user.id, body, mediaId, postId]);
      await q.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [id, rows[0].created_at]);
      await q.query('UPDATE conversation_members SET last_read_id = $3 WHERE conversation_id = $1 AND user_id = $2', [id, req.user.id, rows[0].id]);
      return rows[0].id;
    });
    const { rows } = await db.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [msgId]);
    live.send(memberIds(c), 'message', { conversation_id: id, message: rows[0] });
    res.status(201).json(rows[0]);
  });

  app.post('/api/conversations/:id/read', async (req, res) => {
    const id = v.int(req.params.id, 'conversazione', { min: 1 });
    const c = await getConversation(id, req.user.id);
    const { rows } = await db.query(
      `UPDATE conversation_members SET last_read_id = GREATEST(last_read_id, COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = $1), 0))
        WHERE conversation_id = $1 AND user_id = $2 RETURNING last_read_id`, [id, req.user.id]);
    live.send(memberIds(c), 'read', { conversation_id: id, user_id: req.user.id, last_read_id: rows[0].last_read_id });
    res.json({ last_read_id: rows[0].last_read_id });
  });
}

module.exports = { registerDirect };
