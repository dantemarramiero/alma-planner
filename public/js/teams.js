// Messaggi = chat di Microsoft Teams (elenco a sinistra, conversazione a destra) ed email da Outlook.
// Le chat sono quelle vere di Teams: quello che si scrive qui compare in Teams e viceversa.
import { h, clear, fill, avatar, modal, toast, timeAgo, loading, debounce } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';

const POLL_CHAT = 5000;
const POLL_LIST = 30000;
const chatHash = id => `#/direct/${encodeURIComponent(id)}`;

const others = c => c.members.filter(m => m.email?.toLowerCase() !== store.me.email.toLowerCase());
export function chatTitle(c) {
  if (c.topic) return c.topic;
  const o = others(c);
  if (!o.length) return 'Solo tu';
  return c.type === 'oneOnOne' ? o[0].name : o.map(m => (m.name || '').split(' ')[0]).join(', ');
}
function chatAvatar(c, size = 44) {
  const o = others(c);
  if (c.type === 'oneOnOne' || o.length < 2) return h('span.tm-av', avatar(o[0] || { name: chatTitle(c) }, size));
  return h('span.tm-av.group', { style: { width: `${size}px`, height: `${size}px` } }, avatar(o[0], Math.round(size * 0.68)), avatar(o[1], Math.round(size * 0.68)));
}
const dayLabel = iso => new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const timeLabel = iso => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// La chat aperta sta nell'indirizzo: #/direct/<id della chat Teams>.
function chatIdFromHash() {
  const part = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[1];
  return part ? decodeURIComponent(part) : null;
}

// Pagina Messaggi. Ritorna la funzione di pulizia per il router.
export function teamsView(view) {
  const chatId = chatIdFromHash();
  let chats = [];
  let current = null;
  let messages = [];
  let older = null;
  let stopped = false;
  const timers = [];

  const listBox = h('div.tm-items', loading());
  const chat = h('section.tm-chat');
  const root = h('div.tm.card', { class: chatId ? 'tm-open' : '' },
    h('aside.tm-list',
      h('div.tm-list-head', h('h2', 'Chat'),
        h('button.btn.btn-sm', { type: 'button', title: 'Nuova chat', on: { click: () => newChat() } }, '＋ Nuova')),
      listBox),
    chat);
  clear(view).append(root);

  if (!store.me.microsoft) {
    fill(listBox, h('div.empty', 'Microsoft 365 non è collegato.'));
    return () => {};
  }

  loadList();
  timers.push(setInterval(() => { if (!document.hidden) loadList(); }, POLL_LIST));
  if (chatId) openChat(chatId); else placeholder();

  async function loadList() {
    try {
      chats = await get('/api/teams/chats', { quiet: true });
    } catch (err) {
      if (!chats.length) fill(listBox, h('div.empty', err.code === 'reauth' ? 'Serve un nuovo accesso.' : err.message));
      return;
    }
    if (stopped) return;
    drawList();
  }

  function drawList() {
    if (!chats.length) return fill(listBox, h('div.empty', 'Nessuna chat in Teams. Iniziane una con «＋ Nuova».'));
    fill(listBox, chats.map(c => h('a.tm-item', { href: chatHash(c.id), class: [c.id === current?.id ? 'on' : '', c.unread ? 'unread' : ''].join(' ') },
      chatAvatar(c),
      h('div.grow',
        h('div.tm-item-title', chatTitle(c)),
        h('div.tm-item-sub', h('span.tm-preview', c.last ? `${c.last.mine ? 'Tu: ' : c.type !== 'oneOnOne' && c.last.from ? `${c.last.from.split(' ')[0]}: ` : ''}${c.last.text || 'Allegato'}` : 'Nessun messaggio'),
          c.updated_at ? h('span', ` · ${timeAgo(c.updated_at)}`) : null)))));
  }

  function placeholder() {
    fill(chat, h('div.tm-placeholder',
      h('span.tm-big', '✉'),
      h('h2', 'Le tue chat di Teams'),
      h('p.muted', 'Scrivi a un collega o a un gruppo: i messaggi arrivano anche su Teams.'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => newChat() } }, 'Nuova chat')));
  }

  async function openChat(id) {
    const scroller = h('div.tm-messages', loading());
    const input = h('textarea.input.tm-input', { rows: 1, placeholder: 'Scrivi un messaggio…' });
    const send = h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: submit } }, 'Invia');
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    const head = h('header.tm-head',
      h('a.btn.btn-ghost.btn-sm.tm-back', { href: '#/direct' }, '‹'),
      h('div.grow', h('strong', '…')));
    fill(chat, head, scroller, h('div.tm-compose', input, send));

    try {
      current = await get(`/api/teams/chats/${encodeURIComponent(id)}`);
    } catch {
      fill(chat, h('div.tm-placeholder', h('p.muted', 'Chat non trovata.')));
      return;
    }
    fill(head, h('a.btn.btn-ghost.btn-sm.tm-back', { href: '#/direct' }, '‹'), chatAvatar(current, 36),
      h('div.grow', h('strong', chatTitle(current)), h('div.muted.small', others(current).map(m => m.name).join(', '))),
      current.webUrl ? h('a.btn.btn-sm', { href: current.webUrl, target: '_blank', rel: 'noopener' }, 'Apri in Teams') : null,
      others(current).some(m => m.email) ? h('button.btn.btn-sm', { type: 'button', on: { click: () => openMailComposer({ to: others(current).map(m => m.email).filter(Boolean) }) } }, '✉ Email') : null);
    drawList();
    await loadMessages(true);
    post(`/api/teams/chats/${encodeURIComponent(id)}/read`, {}, { quiet: true }).then(() => {
      const c = chats.find(x => x.id === id);
      if (c?.unread) { c.unread = false; drawList(); }
      document.dispatchEvent(new CustomEvent('teams-read'));
    }).catch(() => {});
    timers.push(setInterval(() => { if (!document.hidden) loadMessages(false); }, POLL_CHAT));
    input.focus();

    async function loadMessages(first) {
      let r;
      try { r = await get(`/api/teams/chats/${encodeURIComponent(id)}/messages`, { quiet: true }); } catch { return; }
      if (stopped || current?.id !== id) return;
      const known = new Set(messages.map(m => m.id));
      const fresh = r.messages.filter(m => !known.has(m.id));
      if (!first && !fresh.length) return;
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      if (first) { messages = r.messages; older = r.older; } else messages = [...messages, ...fresh];
      drawMessages();
      if (first || atBottom) scroller.scrollTop = scroller.scrollHeight;
      if (!first && fresh.some(m => !m.mine)) post(`/api/teams/chats/${encodeURIComponent(id)}/read`, {}, { quiet: true }).catch(() => {});
    }

    async function loadOlder() {
      if (!older) return;
      const before = scroller.scrollHeight;
      const r = await get(`/api/teams/chats/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(older)}`);
      const known = new Set(messages.map(m => m.id));
      messages = [...r.messages.filter(m => !known.has(m.id)), ...messages];
      older = r.older;
      drawMessages();
      scroller.scrollTop = scroller.scrollHeight - before;
    }

    function drawMessages() {
      const items = [];
      if (older) items.push(h('button.btn.btn-sm.tm-older', { type: 'button', on: { click: loadOlder } }, 'Messaggi precedenti'));
      let lastDay = null;
      messages.forEach((m, i) => {
        if (m.system) return;
        const day = m.at.slice(0, 10);
        if (day !== lastDay) { items.push(h('div.tm-day', dayLabel(m.at))); lastDay = day; }
        const next = messages[i + 1];
        const lastOfRun = !next || next.from?.oid !== m.from?.oid || next.at.slice(0, 10) !== day;
        const prev = messages[i - 1];
        const firstOfRun = !prev || prev.from?.oid !== m.from?.oid || prev.at.slice(0, 10) !== day;
        items.push(h('div.tm-msg', { class: [m.mine ? 'mine' : '', lastOfRun ? 'last' : ''].join(' ') },
          h('span.tm-msg-av', !m.mine && lastOfRun ? avatar({ name: m.from?.name || '?' }, 28) : null),
          h('div.tm-msg-body',
            !m.mine && firstOfRun && current.type !== 'oneOnOne' ? h('span.tm-sender', m.from?.name || '') : null,
            m.deleted ? h('div.bubble.muted', 'Messaggio eliminato') : m.text ? h('div.bubble', { title: timeLabel(m.at) }, m.text) : null,
            m.files.map(f => h('a.bubble', { href: f.url, target: '_blank', rel: 'noopener' }, `📎 ${f.name}`)),
            lastOfRun ? h('span.tm-sender', timeLabel(m.at)) : null)));
      });
      if (!items.length) items.push(h('div.tm-start', chatAvatar(current, 64), h('strong', chatTitle(current)), h('span.muted', 'Scrivi il primo messaggio.')));
      fill(scroller, items);
    }

    async function submit() {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const m = await post(`/api/teams/chats/${encodeURIComponent(id)}/messages`, { text });
        input.value = '';
        input.style.height = 'auto';
        if (!messages.some(x => x.id === m.id)) messages.push(m);
        drawMessages();
        scroller.scrollTop = scroller.scrollHeight;
        loadList();
      } finally {
        send.disabled = false;
        input.focus();
      }
    }
  }

  return () => {
    stopped = true;
    timers.forEach(clearInterval);
  };
}

// ── nuova chat ───────────────────────────────────────────────────────────────
let orgCache = null;
async function orgPeople() {
  if (!orgCache) orgCache = (await get('/api/org')).people.filter(p => p.email && p.email.toLowerCase() !== store.me.email.toLowerCase());
  return orgCache;
}

// Apre (o ritrova) la chat Teams con queste persone e la mostra.
export async function openChatWith(oids, topic) {
  const { id } = await post('/api/teams/chats', { oids, topic });
  location.hash = chatHash(id);
}

// Come openChatWith, partendo dalle email (le persone dell'app non hanno l'id Microsoft a portata di mano).
export async function openChatWithEmails(emails) {
  const people = await orgPeople().catch(() => []);
  const wanted = new Set(emails.map(e => e.toLowerCase()));
  const oids = people.filter(p => wanted.has(p.email.toLowerCase())).map(p => p.oid);
  if (!oids.length) return toast('Queste persone non sono nell\'organigramma: aggiornalo da Microsoft nella pagina Organigramma', 'err');
  if (oids.length < wanted.size) toast('Alcune persone non sono nell\'organigramma e non sono state aggiunte alla chat');
  await openChatWith(oids);
}

export async function newChat() {
  const people = await orgPeople().catch(() => []);
  const picked = new Map();
  const chips = h('div.people');
  const results = h('div');
  const search = h('input.input', { type: 'search', placeholder: 'Cerca un collega…', autofocus: true });
  const topic = h('input.input', { placeholder: 'Nome del gruppo (facoltativo)', hidden: true });
  const draw = () => {
    clear(chips).append(...[...picked.values()].map(p => h('span.person-chip', avatar(p), p.name,
      h('button', { type: 'button', on: { click: () => { picked.delete(p.oid); draw(); } } }, '×'))));
    topic.hidden = picked.size < 2;
    const q = search.value.trim().toLowerCase();
    const list = people.filter(p => !picked.has(p.oid) && (!q || [p.name, p.email, p.job_title, p.department].some(x => x?.toLowerCase().includes(q)))).slice(0, 30);
    fill(results, list.length ? list.map(p => h('div.picker-item', { on: { click: () => { picked.set(p.oid, p); search.value = ''; draw(); search.focus(); } } },
      avatar(p), h('div.grow', p.name, h('small', [p.job_title, p.department].filter(Boolean).join(' · ') || p.email))))
      : h('div.muted.small', people.length ? 'Nessuno trovato.' : 'L\'elenco dei colleghi viene dall\'organigramma: aggiornalo da Microsoft nella pagina Organigramma.'));
  };
  search.addEventListener('input', debounce(draw, 120));
  const m = modal({
    title: 'Nuova chat',
    body: [chips, search, topic, h('div', { style: { maxHeight: '320px', overflowY: 'auto' } }, results)],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!picked.size) return toast('Scegli almeno un collega', 'err');
        await openChatWith([...picked.keys()], topic.value.trim() || undefined);
        m.close();
      } } }, 'Apri chat'),
    ],
  });
  draw();
}

// ── email ────────────────────────────────────────────────────────────────────
// Finestra per scrivere un'email dal proprio Outlook. to: indirizzi già compilati.
export function openMailComposer({ to = [], subject = '', text = '' } = {}) {
  if (!store.me.microsoft) return toast('Microsoft 365 non è collegato', 'err');
  const toI = h('input.input', { value: to.join(', '), placeholder: 'indirizzi separati da virgola', autofocus: !to.length });
  const ccI = h('input.input', { placeholder: 'facoltativo' });
  const subj = h('input.input', { value: subject, autofocus: Boolean(to.length) && !subject });
  const body = h('textarea.input', { rows: 10, autofocus: Boolean(to.length && subject) }, text);
  const split = s => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const sendBtn = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!split(toI.value).length) return toast('Indica almeno un destinatario', 'err');
    if (!subj.value.trim()) return toast('Scrivi l\'oggetto', 'err');
    sendBtn.disabled = true;
    try {
      await post('/api/mail/send', { to: split(toI.value), cc: split(ccI.value), subject: subj.value, text: body.value });
      m.close();
      toast('Email inviata');
    } finally { sendBtn.disabled = false; }
  } } }, 'Invia');
  const m = modal({
    title: 'Nuova email',
    wide: true,
    body: [
      h('label.field', h('span', 'A'), toI),
      h('label.field', h('span', 'Cc'), ccI),
      h('label.field', h('span', 'Oggetto'), subj),
      h('label.field', h('span', 'Messaggio'), body),
      h('div.muted.small', 'Parte dalla tua casella Outlook e resta negli Inviati.'),
    ],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      sendBtn,
    ],
  });
}
