// Messaggi diretti: elenco delle chat a sinistra, conversazione a destra (sul telefono una alla volta).
import { h, clear, fill, avatar, modal, toast, timeAgo, confirmDialog, promptDialog, loading } from './ui.js';
import { get, post, patch, del } from './api.js';
import { store, userById, firstName } from './store.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';
import { icon, richText, popMenu } from './social.js';
import { peoplePicker } from './people.js';
import { onLive } from './live.js';

const others = c => c.members.filter(m => m.user_id !== store.me.id);

export function convTitle(c) {
  if (c.title) return c.title;
  const names = others(c).map(m => userById(m.user_id)).filter(Boolean);
  if (!names.length) return 'Solo tu';
  return c.is_group ? names.map(firstName).join(', ') : names[0].name;
}

export function convAvatar(c, size = 48) {
  const o = others(c);
  if (!c.is_group && o[0]) {
    return h('span.dm-av', avatar(userById(o[0].user_id), size), o[0].online ? h('i.online') : null);
  }
  const [a, b] = o.map(m => userById(m.user_id));
  return h('span.dm-av.group', { style: { width: `${size}px`, height: `${size}px` } }, avatar(a, Math.round(size * 0.68)), b ? avatar(b, Math.round(size * 0.68)) : null);
}

function preview(c) {
  const m = c.last_message;
  if (!m) return 'Nuova conversazione';
  const who = m.user_id === store.me.id ? 'Tu: ' : c.is_group ? `${firstName(userById(m.user_id))}: ` : '';
  return who + (m.body || (m.media_id ? 'Foto' : m.post_id ? 'Post condiviso' : ''));
}

export function directView(view, convId) {
  const offs = [];
  let convs = [], current = null, messages = [], older = null;

  const listBox = h('div.dm-items', loading());
  const chat = h('section.dm-chat');
  const root = h('div.dm card', { class: convId ? 'dm-open' : '' },
    h('aside.dm-list',
      h('div.dm-list-head', h('h2', 'Messaggi'),
        h('button.btn-icon', { type: 'button', title: 'Nuovo messaggio', on: { click: newChat } }, icon('edit', { size: 22 }))),
      listBox),
    chat);
  fill(view, root);

  async function loadList() {
    convs = await get('/api/conversations');
    drawList();
  }

  function drawList() {
    clear(listBox);
    if (!convs.length) listBox.append(h('div.empty.small', 'Nessuna conversazione. ', h('button.link-btn.strong.accent', { type: 'button', on: { click: newChat } }, 'Scrivi a un collega')));
    for (const c of convs) {
      listBox.append(h('a.dm-item', { href: `#/direct/${c.id}`, class: [c.id === convId ? 'on' : '', c.unread ? 'unread' : ''].join(' ') },
        convAvatar(c, 48),
        h('div.grow',
          h('div.dm-item-title', convTitle(c)),
          h('div.dm-item-sub', h('span.dm-preview', preview(c)), c.last_message ? h('span', ` · ${timeAgo(c.last_message.created_at)}`) : null)),
        c.unread ? h('i.dot-unread') : null));
    }
  }

  // ── conversazione ─────────────────────────────────────────────────────────
  const scroller = h('div.dm-messages');
  const text = h('textarea.input.dm-input', { rows: 1, placeholder: 'Scrivi un messaggio…', maxLength: 5000 });
  const sendBtn = h('button.link-btn.strong.accent', { type: 'submit', hidden: true }, 'Invia');

  async function openConversation() {
    if (!convId) {
      fill(chat, h('div.dm-placeholder',
        h('span.dm-big', icon('send', { size: 44 })),
        h('h2', 'I tuoi messaggi'),
        h('p.muted', 'Scrivi a un collega o crea un gruppo di lavoro.'),
        h('button.btn.btn-primary', { type: 'button', on: { click: newChat } }, 'Nuovo messaggio')));
      return;
    }
    fill(chat, loading());
    try {
      current = await get(`/api/conversations/${convId}`);
    } catch {
      fill(chat, h('div.dm-placeholder', h('p.muted', 'Conversazione non trovata.')));
      return;
    }
    const data = await get(`/api/conversations/${convId}/messages`);
    messages = data.messages;
    older = data.next;
    drawChat();
    markRead();
  }

  function headSub() {
    if (current.is_group) return `${current.members.length} persone`;
    const o = others(current)[0];
    const u = userById(o?.user_id);
    return o?.online ? 'Attivo ora' : u?.job_title || (u ? `@${u.handle}` : '');
  }

  function drawChat() {
    const o = others(current)[0];
    const head = h('header.dm-head',
      h('a.btn-icon.dm-back', { href: '#/direct', title: 'Indietro' }, icon('left', { size: 24 })),
      convAvatar(current, 40),
      h('div.grow',
        current.is_group ? h('strong', convTitle(current)) : h('a.user-link.strong', { href: `#/u/${o?.user_id}` }, convTitle(current)),
        h('div.post-meta', headSub())),
      current.is_group ? groupMenu() : null);

    const form = h('form.dm-compose', {
      on: { submit: e => { e.preventDefault(); sendText(); } },
    },
    h('button.btn-icon', { type: 'button', title: 'Invia una foto', on: { click: sendPhoto } }, icon('image', { size: 22 })),
    text, sendBtn);

    fill(chat, head, scroller, form);
    drawMessages(true);
    text.focus();
  }

  function groupMenu() {
    const btn = h('button.btn-icon', { type: 'button', title: 'Gruppo', on: { click: () => popMenu(btn, [
      { label: 'Rinomina il gruppo', onClick: async () => {
        const title = await promptDialog('Nome del gruppo', { value: current.title || '' });
        if (title === null) return;
        current = await patch(`/api/conversations/${current.id}`, { title });
        drawChat(); loadList();
      } },
      { label: 'Persone nel gruppo', onClick: membersDialog },
      { label: 'Esci dal gruppo', danger: true, onClick: async () => {
        if (!await confirmDialog('Uscire dal gruppo? Non riceverai più i messaggi.', { ok: 'Esci', danger: true })) return;
        await del(`/api/conversations/${current.id}/members/me`);
        location.hash = '#/direct';
      } },
    ]) } }, icon('more', { size: 22 }));
    return btn;
  }

  function membersDialog() {
    const picker = peoplePicker({ selected: [], label: '+ Aggiungi persone' });
    const m = modal({
      title: 'Persone nel gruppo',
      body: [
        h('div.people-list', current.members.map(x => {
          const u = userById(x.user_id);
          return h('a.people-row', { href: `#/u/${x.user_id}`, on: { click: () => m.close() } }, avatar(u, 36),
            h('div.grow', h('strong', u?.name || ''), h('small', x.online ? 'Attivo ora' : u?.job_title || '')));
        })),
        picker.el,
      ],
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (picker.value.length) {
          current = await post(`/api/conversations/${current.id}/members`, { user_ids: picker.value });
          drawChat();
        }
        m.close();
      } } }, 'Fatto')],
    });
  }

  const dayKey = iso => new Date(iso).toDateString();
  const dayLabel = iso => {
    const d = new Date(iso), t = new Date();
    const y = new Date(); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Oggi';
    if (d.toDateString() === y.toDateString()) return 'Ieri';
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  function drawMessages(toBottom) {
    const prevHeight = scroller.scrollHeight, prevTop = scroller.scrollTop;
    clear(scroller);
    if (older) scroller.append(h('button.link-btn.muted.dm-older', { type: 'button', on: { click: loadOlder } }, 'Messaggi precedenti'));
    if (!messages.length) scroller.append(h('div.dm-start', convAvatar(current, 72), h('strong', convTitle(current)), h('span.muted.small', 'Inizia la conversazione.')));
    let lastDay = null;
    messages.forEach((m, i) => {
      if (dayKey(m.created_at) !== lastDay) {
        lastDay = dayKey(m.created_at);
        scroller.append(h('div.dm-day', dayLabel(m.created_at)));
      }
      const mine = m.user_id === store.me.id;
      const prevM = messages[i - 1], nextM = messages[i + 1];
      const firstOfRun = !prevM || prevM.user_id !== m.user_id || dayKey(prevM.created_at) !== dayKey(m.created_at);
      const lastOfRun = !nextM || nextM.user_id !== m.user_id || dayKey(nextM.created_at) !== dayKey(m.created_at);
      const u = userById(m.user_id);
      const content = [];
      if (m.post) content.push(sharedPost(m.post));
      else if (m.post_id) content.push(h('div.bubble.muted', 'Post non più disponibile'));
      if (m.media_id) {
        content.push(h('a.dm-photo', { href: mediaUrl(m.media_id), target: '_blank', rel: 'noopener' },
          h('img', { src: mediaUrl(m.media_id), alt: 'Foto', loading: 'lazy', style: m.media_w ? { aspectRatio: `${m.media_w} / ${m.media_h}` } : null })));
      }
      if (m.body) content.push(h('div.bubble', richText(m.body)));
      scroller.append(h('div.dm-msg', { class: [mine ? 'mine' : '', lastOfRun ? 'last' : ''].join(' '), title: new Date(m.created_at).toLocaleString('it-IT') },
        !mine && current.is_group ? h('span.dm-msg-av', lastOfRun ? avatar(u, 28) : null) : null,
        h('div.dm-msg-body',
          !mine && current.is_group && firstOfRun ? h('div.dm-sender', firstName(u)) : null,
          content)));
    });
    // «Visto» sotto il mio ultimo messaggio
    const lastMine = [...messages].reverse().find(m => m.user_id === store.me.id);
    if (lastMine && lastMine === messages[messages.length - 1]) {
      const seen = others(current).filter(x => x.last_read_id >= lastMine.id);
      if (seen.length) scroller.append(h('div.dm-seen', current.is_group ? `Visto da ${seen.map(x => firstName(userById(x.user_id))).join(', ')}` : 'Visto'));
    }
    if (toBottom) scroller.scrollTop = scroller.scrollHeight;
    else scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
  }

  function sharedPost(sp) {
    const a = userById(sp.author_id);
    return h('button.dm-post', { type: 'button', on: { click: async () => (await import('./feed.js')).openPost(sp.id) } },
      h('div.dm-post-head', avatar(a, 24), h('strong', a?.name || '')),
      sp.media_id ? h('img', { src: mediaUrl(sp.media_id), alt: '', loading: 'lazy' }) : null,
      sp.body ? h('div.dm-post-body', sp.body) : null);
  }

  async function loadOlder() {
    const data = await get(`/api/conversations/${convId}/messages?before=${older}`);
    messages = [...data.messages, ...messages];
    older = data.next;
    drawMessages(false);
  }

  function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120; }

  function addMessage(m) {
    if (messages.some(x => x.id === m.id)) return;
    const stick = m.user_id === store.me.id || nearBottom();
    messages.push(m);
    drawMessages(stick);
  }

  async function sendText() {
    const body = text.value.trim();
    if (!body) return;
    text.value = '';
    autosize();
    sendBtn.hidden = true;
    try {
      addMessage(await post(`/api/conversations/${convId}/messages`, { body }));
    } catch { text.value = body; autosize(); }
  }

  async function sendPhoto() {
    const files = await pickImages({ multiple: true });
    for (const f of files.slice(0, 10)) {
      try {
        const media = await uploadImage(f);
        addMessage(await post(`/api/conversations/${convId}/messages`, { media_id: media.id }));
      } catch (err) { if (!err.status) toast(err.message, 'err'); }
    }
  }

  let readTimer = null;
  function markRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (document.hidden || !current) return;
      await post(`/api/conversations/${current.id}/read`, {}, { quiet: true }).catch(() => {});
      const c = convs.find(x => x.id === current.id);
      if (c?.unread) { c.unread = 0; drawList(); }
    }, 300);
  }

  function autosize() {
    text.style.height = 'auto';
    text.style.height = `${Math.min(text.scrollHeight, 140)}px`;
  }
  text.addEventListener('input', () => { autosize(); sendBtn.hidden = !text.value.trim(); });
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });

  // ── nuova chat ────────────────────────────────────────────────────────────
  function newChat() {
    const name = h('input.input', { placeholder: 'Nome del gruppo (facoltativo)', maxLength: 100 });
    const nameField = h('label.field', { hidden: true }, h('span', 'Nome del gruppo'), name);
    const picker = peoplePicker({ selected: [], label: '+ Scegli colleghi', onChange: ids => { nameField.hidden = ids.length < 2; } });
    const m = modal({
      title: 'Nuovo messaggio',
      body: [h('label.field', h('span', 'A'), picker.el), nameField],
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          if (!picker.value.length) return toast('Scegli almeno un collega', 'err');
          const c = await post('/api/conversations', { user_ids: picker.value, title: picker.value.length > 1 ? name.value.trim() : '' });
          m.close();
          location.hash = `#/direct/${c.id}`;
        } } }, 'Chatta')],
    });
  }

  // ── tempo reale ───────────────────────────────────────────────────────────
  offs.push(onLive('message', d => {
    if (d.conversation_id === convId && current) {
      addMessage(d.message);
      if (d.message.user_id !== store.me.id) markRead();
    }
    loadList();
  }));
  offs.push(onLive('read', d => {
    if (d.conversation_id !== convId || !current) return;
    const mem = current.members.find(x => x.user_id === d.user_id);
    if (mem) { mem.last_read_id = d.last_read_id; drawMessages(nearBottom()); }
  }));
  offs.push(onLive('conversation', () => loadList()));
  const onVisible = () => { if (!document.hidden && current) markRead(); };
  document.addEventListener('visibilitychange', onVisible);
  offs.push(() => document.removeEventListener('visibilitychange', onVisible));

  loadList();
  openConversation();
  return () => { clearTimeout(readTimer); offs.forEach(off => off()); };
}
