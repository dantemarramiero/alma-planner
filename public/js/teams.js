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
// ── presenza di Teams (pallino) ──────────────────────────────────────────────
const presence = new Map(); // oid → availability di Teams
const PRESENCE_LABEL = {
  Available: 'Disponibile', AvailableIdle: 'Disponibile', Busy: 'Occupato', BusyIdle: 'Occupato',
  DoNotDisturb: 'Non disturbare', BeRightBack: 'Torno subito', Away: 'Assente', Offline: 'Offline',
};
const presenceClass = a => ({ Available: 'on', AvailableIdle: 'on', Busy: 'busy', BusyIdle: 'busy', DoNotDisturb: 'dnd', BeRightBack: 'away', Away: 'away' })[a] || 'off';
export const presenceLabel = oid => PRESENCE_LABEL[presence.get(oid)] || '';

// Chiede la presenza di queste persone (il server la tiene 60 s); ritorna quando è arrivata.
export async function loadPresence(oids) {
  const want = [...new Set(oids.filter(Boolean))];
  if (!want.length || !store.me.microsoft) return;
  try {
    const r = await get(`/api/teams/presence?oids=${want.join(',')}`, { quiet: true });
    for (const [oid, a] of Object.entries(r)) presence.set(oid, a);
  } catch { /* senza presenza si va avanti */ }
}
export function presenceDot(oid) {
  const a = presence.get(oid);
  if (!a || a === 'PresenceUnknown') return null;
  return h('i.tm-dot', { class: presenceClass(a), title: PRESENCE_LABEL[a] || a });
}

// Persona: avatar tondo (con il pallino). Gruppo: riquadro con le iniziali del nome. Riunione: riquadro con il calendario.
const isPerson = c => c.type === 'oneOnOne';
function chatAvatar(c, size = 44) {
  if (isPerson(c)) return h('span.tm-av', avatar(others(c)[0] || { name: chatTitle(c) }, size), presenceDot(others(c)[0]?.oid));
  const box = h('span.tm-av.tm-box', { class: c.type === 'meeting' ? 'meeting' : 'group', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` } });
  if (c.type === 'meeting') box.textContent = '📅';
  else box.textContent = chatTitle(c).split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '#';
  return box;
}
// «Gruppo · 4 persone», «Riunione · 6 persone»: chi scrive conta anche sé stesso, come in Teams.
function chatKind(c) {
  if (isPerson(c)) return null;
  const n = c.members.length;
  return `${c.type === 'meeting' ? 'Riunione' : 'Gruppo'}${n ? ` · ${n} persone` : ''}`;
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
  // Tutte | Persone | Gruppi (le riunioni stanno con i gruppi)
  let filter = 'all';
  const filterSeg = h('div.seg.tm-filter', [['all', 'Tutte'], ['people', 'Persone'], ['groups', 'Gruppi']].map(([k, l]) =>
    h('button', { type: 'button', 'data-k': k, class: k === filter ? 'on' : '', on: { click: () => {
      filter = k;
      filterSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      drawList();
    } } }, l)));
  const chat = h('section.tm-chat');
  const root = h('div.tm.card', { class: chatId ? 'tm-open' : '' },
    h('aside.tm-list',
      h('div.tm-list-head', h('h2', 'Chat'),
        h('button.btn.btn-sm', { type: 'button', title: 'Nuova chat', on: { click: () => newChat() } }, '＋ Nuova')),
      filterSeg,
      listBox),
    chat);
  clear(view).append(root);

  if (!store.me.microsoft) {
    fill(listBox, h('div.empty', 'Microsoft 365 non è collegato.'));
    return () => {};
  }

  // L'ultimo elenco visto si mostra subito (Microsoft ci mette qualche secondo); poi arriva quello aggiornato.
  const CACHE_KEY = `alma.teamsChats.${store.me.id}`;
  try { chats = JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { chats = []; }
  if (chats.length) drawList();
  loadList();
  timers.push(setInterval(() => { if (!document.hidden) loadList(); }, POLL_LIST));
  if (chatId) openChat(chatId); else placeholder();

  async function loadList({ fresh = false } = {}) {
    try {
      chats = await get(`/api/teams/chats${fresh ? '?fresh=1' : ''}`, { quiet: true });
    } catch (err) {
      if (!chats.length) fill(listBox, h('div.empty', err.code === 'reauth' ? 'Serve un nuovo accesso.' : err.message));
      return;
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(chats)); } catch { /* niente */ }
    if (stopped) return;
    drawList();
    // pallini di presenza delle persone con cui si ha una chat 1:1 (arrivano dopo, non rallentano l'elenco)
    await loadPresence(chats.filter(isPerson).map(c => others(c)[0]?.oid));
    if (!stopped) drawList();
  }

  function drawList() {
    if (!chats.length) return fill(listBox, h('div.empty', 'Nessuna chat in Teams. Iniziane una con «＋ Nuova».'));
    const shown = chats.filter(c => filter === 'all' || (filter === 'people') === isPerson(c));
    if (!shown.length) return fill(listBox, h('div.empty', filter === 'people' ? 'Nessuna chat con una persona.' : 'Nessun gruppo.'));
    fill(listBox, shown.map(c => h('a.tm-item', { href: chatHash(c.id), class: [c.id === current?.id ? 'on' : '', c.unread ? 'unread' : ''].join(' ') },
      chatAvatar(c),
      h('div.grow',
        h('div.tm-item-title', chatTitle(c), chatKind(c) ? h('span.tm-kind', chatKind(c)) : null),
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
      h('div.grow', h('strong', chatTitle(current)), isPerson(current)
        ? h('div.muted.small', [presenceLabel(others(current)[0]?.oid), others(current)[0]?.email].filter(Boolean).join(' · '))
        : h('button.tm-members', { type: 'button', title: 'Vedi chi c\'è nel gruppo', on: { click: () => showMembers(current) } }, chatKind(current))),
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

// Membri di un gruppo o di una riunione, con la chat 1:1 a un clic.
function showMembers(c) {
  const members = [...c.members].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));
  const md = modal({
    title: `${chatTitle(c)} · ${members.length} persone`,
    body: members.map(m => h('div.picker-item', h('span.tm-av', avatar(m), presenceDot(m.oid)), h('div.grow', m.name || m.email, h('small', [presenceLabel(m.oid), m.email].filter(Boolean).join(' · '))),
      m.email && m.email.toLowerCase() !== store.me.email.toLowerCase()
        ? h('button.btn.btn-sm', { type: 'button', on: { click: () => { md.close(); openChatWithEmails([m.email]); } } }, 'Chat')
        : h('span.muted.small', 'tu'))),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => md.close() } }, 'Chiudi')],
  });
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

// Come openChatWith, partendo dalle email: il server trova i colleghi su Microsoft 365 (serve solo che siano nel tenant).
export async function openChatWithEmails(emails, topic) {
  if (!store.me.microsoft) return toast('Microsoft 365 non è collegato', 'err');
  const { id } = await post('/api/teams/chats', { emails, topic });
  location.hash = chatHash(id);
}

// Pulsante «Messaggio» per una persona: apre la sua chat Teams dentro Alma Planner.
export function messageButton(person, { className = 'btn.btn-primary', label = 'Messaggio' } = {}) {
  return h(`button.${className}`, { type: 'button', title: `Scrivi a ${person.name} (chat di Teams)`, on: { click: e => {
    e.preventDefault();
    e.stopPropagation();
    openChatWithEmails([person.email]);
  } } }, label);
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
