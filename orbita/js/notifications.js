// Notifiche: chi ha messo mi piace, commentato, risposto o ti ha menzionato (nei post e nelle note).
import { h, clear, fill, avatar, timeAgo, loading } from './ui.js';
import { get, post } from './api.js';
import { userById } from './store.js';
import { mediaUrl } from './media.js';
import { openPost } from './feed.js';
import { onLive } from './live.js';
import { icon } from './icons.js';

const hours = n => `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`;
const quote = s => (s ? ` «${s.length > 80 ? `${s.slice(0, 80)}…` : s}»` : '');

function sentence(n) {
  switch (n.kind) {
    case 'like': return 'ha messo mi piace al tuo post.';
    case 'comment': return `ha commentato:${quote(n.comment_body)}`;
    case 'reply': return `ti ha risposto:${quote(n.comment_body)}`;
    case 'mention': return n.comment_id ? `ti ha menzionato in un commento:${quote(n.comment_body)}` : 'ti ha menzionato in un post.';
    case 'comment_like': return `ha messo mi piace al tuo commento:${quote(n.comment_body)}`;
    case 'pin': return 'ha messo in evidenza il tuo post.';
    case 'due_tomorrow': return `Promemoria:${quote(n.ticket_title)} scade il prossimo giorno lavorativo.`;
    case 'overdue_project': return `Ritardo nel tuo progetto:${quote(n.ticket_title)} è scaduto da almeno 2 giorni lavorativi.`;
    case 'note_mention': return `ti ha menzionato in una nota:${quote(n.note_body)}`;
    case 'rda_new': return `ti chiede${quote(n.ticket_title)} per ${n.rda_function} (${hours(n.hours_estimated)} stimate).`;
    case 'rda_accepted': return Number(n.hours_approved) === Number(n.hours_estimated)
      ? `ha accettato la tua richiesta${quote(n.ticket_title)} (${hours(n.hours_approved)}).`
      : `ha accettato la tua richiesta${quote(n.ticket_title)} con ${hours(n.hours_approved)} invece delle ${hours(n.hours_estimated)} stimate.`;
    case 'rda_rejected': return `ha rifiutato la tua richiesta${quote(n.ticket_title)}:${quote(n.rda_reject_reason)}`;
    case 'software_proposal': return `Persona nuova in Microsoft: ${n.proposal_person || 'qualcuno'}${n.proposal_role ? ` (${n.proposal_role})` : ''}. Proposta di software «${n.proposal_package || 'pacchetto'}» da accettare.`;
    default: return '';
  }
}

// Dove porta il clic: il post, oppure la nota (tab Note del progetto, o la scheda del ticket).
async function open(n) {
  if (n.post_id) return openPost(n.post_id, { focus: !!n.comment_id });
  if (n.kind === 'rda_new' || n.kind === 'rda_rejected') { location.hash = '#/rda'; return; }
  if (n.kind === 'software_proposal') { location.hash = '#/software/proposte'; return; }
  if (n.ticket_id) return (await import('./tickets.js')).openTicket(n.ticket_id, {});
  if (n.note_project_id) location.hash = `#/projects/${n.note_project_id}/note`;
  else if (n.note_ticket_id) (await import('./tickets.js')).openTicket(n.note_ticket_id, {});
}

export function notificationsView(view) {
  const list = h('div.card.notif-list', loading());
  fill(view, h('div.narrow', h('div.page-head', h('h1', 'Notifiche')), list));

  async function load() {
    const items = await get('/api/notifications');
    clear(list);
    if (!items.length) return list.append(h('div.empty', 'Qui trovi mi piace, commenti e menzioni nei post e nelle note, e le RDA interne.'));
    const fresh = items.filter(n => !n.read_at), old = items.filter(n => n.read_at);
    const section = (title, rows) => rows.length ? [h('div.notif-section', title), ...rows.map(row)] : [];
    list.append(...section('Nuove', fresh), ...section('Precedenti', old));
    if (fresh.length) post('/api/notifications/read', {}, { quiet: true }).catch(() => {});
  }

  function row(n) {
    const u = userById(n.actor_id);
    const system = ['due_tomorrow', 'overdue_project', 'software_proposal'].includes(n.kind); // li manda Alma Planet, non una persona
    return h('button.notif', { type: 'button', class: n.read_at ? '' : 'new', on: { click: () => open(n) } },
      system ? h('span.notif-sys', icon(n.kind === 'software_proposal' ? 'package' : 'alarm-clock', { size: 22 })) : avatar(u, 44),
      h('div.grow', system ? null : [h('strong', u?.name || 'Qualcuno'), ' '], sentence(n), h('span.notif-time', ` ${timeAgo(n.created_at)}`)),
      n.post_media_id ? h('img.notif-thumb', { src: mediaUrl(n.post_media_id), alt: '' }) : n.post_body ? h('span.notif-thumb.text', n.post_body) : null);
  }

  load();
  return onLive('notification', load);
}
