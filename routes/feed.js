// Bacheca dell'intranet: post con testo e foto, «mi piace», commenti con risposte, menzioni, hashtag e post in evidenza.
const { HttpError, v } = require('../lib/http');
const { checkOwnMedia } = require('../lib/media');

const PAGE = 10;
const MAX_PHOTOS = 10;
const TAG_RE = /^[\p{L}\p{N}_]{1,50}$/u;

// $1 = utente che guarda.
const POST_SELECT = `
  SELECT p.id, p.author_id, p.body, p.pinned_at, p.created_at,
         COALESCE((SELECT json_agg(json_build_object('id', m.id, 'w', m.width, 'h', m.height) ORDER BY pm.position)
                     FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id), '[]') AS media,
         (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id = p.id) AS like_count,
         EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked,
         (SELECT l.user_id FROM post_likes l WHERE l.post_id = p.id AND l.user_id <> $1 ORDER BY l.created_at DESC LIMIT 1) AS last_liker_id,
         (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
         COALESCE((SELECT json_agg(c ORDER BY c.id) FROM (
                     SELECT c.id, c.user_id, c.body, c.created_at FROM post_comments c
                      WHERE c.post_id = p.id ORDER BY c.id DESC LIMIT 2) c), '[]') AS recent_comments
    FROM posts p`;

function registerFeed(app, { db, live, notifier, isAdmin }) {
  async function getPost(id, userId) {
    const { rows } = await db.query(`${POST_SELECT} WHERE p.id = $2`, [userId, id]);
    if (!rows[0]) throw new HttpError(404, 'Post non trovato');
    return rows[0];
  }

  async function getComment(id) {
    const { rows } = await db.query(
      'SELECT c.*, p.author_id AS post_author_id FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Commento non trovato');
    return rows[0];
  }

  // ── bacheca ────────────────────────────────────────────────────────────────
  app.get('/api/feed', async (req, res) => {
    const params = [req.user.id];
    const where = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
    const author = v.int(req.query.author, 'autore', { min: 1 });
    const before = v.int(req.query.before, 'cursore', { min: 1 });
    const tag = req.query.tag === undefined ? undefined : String(req.query.tag);
    if (tag !== undefined && !TAG_RE.test(tag)) throw new HttpError(400, 'Hashtag non valido');
    if (author) add('p.author_id = ?', author);
    if (tag) add("p.body ~* ?", `(^|[^[:alnum:]_])#${tag}([^[:alnum:]_]|$)`);
    const home = !author && !tag;
    if (home) where.push('p.pinned_at IS NULL');
    if (before) add('p.id < ?', before);
    const { rows } = await db.query(
      `${POST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.id DESC LIMIT ${PAGE + 1}`, params);
    let pinned = [];
    if (home && !before) {
      pinned = (await db.query(`${POST_SELECT} WHERE p.pinned_at IS NOT NULL ORDER BY p.pinned_at DESC`, [req.user.id])).rows;
    }
    const more = rows.length > PAGE;
    const posts = rows.slice(0, PAGE);
    res.json({ pinned, posts, next: more ? posts[posts.length - 1].id : null });
  });

  app.get('/api/posts/:id', async (req, res) => {
    const id = v.int(req.params.id, 'post', { min: 1 });
    const p = await getPost(id, req.user.id);
    const { rows } = await db.query(
      `SELECT c.id, c.user_id, c.parent_id, c.body, c.created_at,
              (SELECT COUNT(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS like_count,
              EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $2) AS liked
         FROM post_comments c WHERE c.post_id = $1 ORDER BY c.id`, [id, req.user.id]);
    res.json({ ...p, comments: rows });
  });

  app.post('/api/posts', async (req, res) => {
    const b = req.body || {};
    const body = v.text(b.body, 'testo', { max: 5000 }) || '';
    const mediaIds = v.ids(b.media_ids, 'foto') || [];
    if (!body && !mediaIds.length) throw new HttpError(400, 'Scrivi qualcosa o aggiungi una foto');
    if (mediaIds.length > MAX_PHOTOS) throw new HttpError(400, `Al massimo ${MAX_PHOTOS} foto per post`);
    const id = await db.tx(async q => {
      await checkOwnMedia(q, mediaIds, req.user.id);
      const { rows } = await q.query('INSERT INTO posts (author_id, body) VALUES ($1, $2) RETURNING id', [req.user.id, body]);
      for (const [i, mid] of mediaIds.entries()) {
        await q.query('INSERT INTO post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [rows[0].id, mid, i]);
      }
      return rows[0].id;
    });
    await notifier.notify({ userIds: await notifier.mentionedIds(body), actorId: req.user.id, kind: 'mention', postId: id });
    live.broadcast('post', { id, author_id: req.user.id }, { except: req.user.id });
    res.status(201).json(await getPost(id, req.user.id));
  });

  app.delete('/api/posts/:id', async (req, res) => {
    const id = v.int(req.params.id, 'post', { min: 1 });
    const p = await getPost(id, req.user.id);
    if (p.author_id !== req.user.id && !isAdmin(req)) throw new HttpError(403, 'Puoi cancellare solo i tuoi post');
    await db.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── in evidenza (solo amministratori) ──────────────────────────────────────
  app.post('/api/posts/:id/pin', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Solo gli amministratori mettono i post in evidenza');
    const id = v.int(req.params.id, 'post', { min: 1 });
    const p = await getPost(id, req.user.id);
    await db.query('UPDATE posts SET pinned_at = now(), pinned_by = $2 WHERE id = $1', [id, req.user.id]);
    if (!p.pinned_at) await notifier.notify({ userIds: [p.author_id], actorId: req.user.id, kind: 'pin', postId: id });
    res.json(await getPost(id, req.user.id));
  });

  app.delete('/api/posts/:id/pin', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Solo gli amministratori tolgono i post dall\'evidenza');
    const id = v.int(req.params.id, 'post', { min: 1 });
    await db.query('UPDATE posts SET pinned_at = NULL, pinned_by = NULL WHERE id = $1', [id]);
    res.json(await getPost(id, req.user.id));
  });

  // ── mi piace ───────────────────────────────────────────────────────────────
  app.post('/api/posts/:id/like', async (req, res) => {
    const id = v.int(req.params.id, 'post', { min: 1 });
    const p = await getPost(id, req.user.id);
    const { rowCount } = await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    if (rowCount) await notifier.notify({ userIds: [p.author_id], actorId: req.user.id, kind: 'like', postId: id });
    const after = await getPost(id, req.user.id);
    res.json({ liked: true, like_count: after.like_count });
  });

  app.delete('/api/posts/:id/like', async (req, res) => {
    const id = v.int(req.params.id, 'post', { min: 1 });
    await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    await db.query("DELETE FROM notifications WHERE kind = 'like' AND post_id = $1 AND actor_id = $2", [id, req.user.id]);
    const after = await getPost(id, req.user.id);
    res.json({ liked: false, like_count: after.like_count });
  });

  app.get('/api/posts/:id/likes', async (req, res) => {
    const id = v.int(req.params.id, 'post', { min: 1 });
    const { rows } = await db.query('SELECT user_id FROM post_likes WHERE post_id = $1 ORDER BY created_at DESC', [id]);
    res.json(rows.map(r => r.user_id));
  });

  // ── commenti ───────────────────────────────────────────────────────────────
  app.post('/api/posts/:id/comments', async (req, res) => {
    const postId = v.int(req.params.id, 'post', { min: 1 });
    const p = await getPost(postId, req.user.id);
    const body = v.text(req.body?.body, 'commento', { max: 2200, required: true });
    let parentId = v.int(req.body?.parent_id, 'risposta', { min: 1, nullable: true }) || null;
    let parentAuthor = null;
    if (parentId) {
      const parent = await getComment(parentId);
      if (parent.post_id !== postId) throw new HttpError(400, 'Il commento a cui rispondi è di un altro post');
      parentId = parent.parent_id || parent.id; // un solo livello di risposte
      parentAuthor = parent.user_id;
    }
    const { rows } = await db.query(
      'INSERT INTO post_comments (post_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING id, user_id, parent_id, body, created_at',
      [postId, req.user.id, parentId, body]);
    const c = rows[0];
    const told = new Set([req.user.id]);
    const tell = async (ids, kind) => {
      const fresh = ids.filter(x => x && !told.has(x));
      fresh.forEach(x => told.add(x));
      await notifier.notify({ userIds: fresh, actorId: req.user.id, kind, postId, commentId: c.id });
    };
    if (parentAuthor) await tell([parentAuthor], 'reply');
    await tell([p.author_id], 'comment');
    await tell(await notifier.mentionedIds(body), 'mention');
    res.status(201).json({ ...c, like_count: 0, liked: false });
  });

  app.delete('/api/comments/:id', async (req, res) => {
    const id = v.int(req.params.id, 'commento', { min: 1 });
    const c = await getComment(id);
    // Lo cancellano chi l'ha scritto, l'autore del post o un amministratore.
    if (c.user_id !== req.user.id && c.post_author_id !== req.user.id && !isAdmin(req)) {
      throw new HttpError(403, 'Puoi cancellare solo i tuoi commenti o quelli sui tuoi post');
    }
    await db.query('DELETE FROM post_comments WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  app.post('/api/comments/:id/like', async (req, res) => {
    const id = v.int(req.params.id, 'commento', { min: 1 });
    const c = await getComment(id);
    const { rowCount } = await db.query('INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    if (rowCount) await notifier.notify({ userIds: [c.user_id], actorId: req.user.id, kind: 'comment_like', postId: c.post_id, commentId: id });
    res.json({ liked: true });
  });

  app.delete('/api/comments/:id/like', async (req, res) => {
    const id = v.int(req.params.id, 'commento', { min: 1 });
    await db.query('DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [id, req.user.id]);
    await db.query("DELETE FROM notifications WHERE kind = 'comment_like' AND comment_id = $1 AND actor_id = $2", [id, req.user.id]);
    res.json({ liked: false });
  });
}

module.exports = { registerFeed, POST_SELECT };
