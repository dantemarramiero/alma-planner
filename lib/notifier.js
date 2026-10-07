// Notifiche dell'intranet (mi piace, commenti, risposte, menzioni, post in evidenza), inviate subito a chi è collegato.

// @nome.cognome = parte dell'email prima della chiocciola.
const MENTION_RE = /(^|[^\w.@])@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)/gi;

function createNotifier({ db, live }) {
  async function notify({ userIds, actorId, kind, postId = null, commentId = null }) {
    const targets = [...new Set(userIds)].filter(id => id && id !== actorId);
    for (const uid of targets) {
      await db.query('INSERT INTO notifications (user_id, actor_id, kind, post_id, comment_id) VALUES ($1, $2, $3, $4, $5)',
        [uid, actorId, kind, postId, commentId]);
    }
    if (targets.length) live.send(targets, 'notification', { kind, post_id: postId });
    return targets;
  }

  async function mentionedIds(text) {
    const handles = [...new Set([...String(text || '').matchAll(MENTION_RE)].map(m => m[2].toLowerCase()))];
    if (!handles.length) return [];
    const { rows } = await db.query("SELECT id FROM users WHERE split_part(email, '@', 1) = ANY($1::text[])", [handles]);
    return rows.map(r => r.id);
  }

  return { notify, mentionedIds };
}

module.exports = { createNotifier, MENTION_RE };
