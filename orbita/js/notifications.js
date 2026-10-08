// Notifiche: chi ha messo mi piace, commentato, risposto o ti ha menzionato (nei post e nelle note).
import { h, clear, fill, avatar, timeAgo, loading } from './ui.js';
import { get, post } from './api.js';
import { userById } from './store.js';
import { mediaUrl } from './media.js';
import { openPost } from './feed.js';
import { onLive } from './live.js';

const quote = s => (s ? ` «${s.length > 80 ? `${s.slice(0, 80)}…` : s}»` : '');

function sentence(n) {
  switch (n.kind) {
    case 'like': return 'ha messo mi piace al tuo post.';
    case 'comment': return `ha commentato:${quote(n.comment_body)}`;
    case 'reply': return `ti ha risposto:${quote(n.comment_body)}`;
    case 'mention': return n.comment_id ? `ti ha menzionato in un commento:${quote(n.comment_body)}` : 'ti ha menzionato in un post.';
    case 'comment_like': return `ha messo mi piace al tuo commento:${quote(n.comment_body)}`;
    case 'pin': return 'ha messo in evidenza il tuo post.';
    case 'note_mention': return `ti ha menzionato in una nota:${quote(n.note_body)}`;
    default: return '';
  }
}

// Dove porta il clic: il post, oppure la nota (tab Note del progetto, o la scheda del ticket).
async function open(n) {
  if (n.post_id) return openPost(n.post_id, { focus: !!n.comment_id });
  if (n.note_project_id) location.hash = `#/projects/${n.note_project_id}/note`;
  else if (n.note_ticket_id) (await import('./tickets.js')).openTicket(n.note_ticket_id, {});
}

export function notificationsView(view) {
  const list = h('div.card.notif-list', loading());
  fill(view, h('div.narrow', h('div.page-head', h('h1', 'Notifiche')), list));

  async function load() {
    const items = await get('/api/notifications');
    clear(list);
    if (!items.length) return list.append(h('div.empty', 'Qui trovi mi piace, commenti e menzioni nei post e nelle note.'));
    const fresh = items.filter(n => !n.read_at), old = items.filter(n => n.read_at);
    const section = (title, rows) => rows.length ? [h('div.notif-section', title), ...rows.map(row)] : [];
    list.append(...section('Nuove', fresh), ...section('Precedenti', old));
    if (fresh.length) post('/api/notifications/read', {}, { quiet: true }).catch(() => {});
  }

  function row(n) {
    const u = userById(n.actor_id);
    return h('button.notif', { type: 'button', class: n.read_at ? '' : 'new', on: { click: () => open(n) } },
      avatar(u, 44),
      h('div.grow', h('strong', u?.name || 'Qualcuno'), ' ', sentence(n), h('span.notif-time', ` ${timeAgo(n.created_at)}`)),
      n.post_media_id ? h('img.notif-thumb', { src: mediaUrl(n.post_media_id), alt: '' }) : n.post_body ? h('span.notif-thumb.text', n.post_body) : null);
  }

  load();
  return onLive('notification', load);
}
