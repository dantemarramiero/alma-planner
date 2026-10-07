// Storie: barra in cima alla Home, visore a schermo intero (5 secondi a foto) e nuova storia.
import { h, clear, fill, avatar, modal, toast, timeAgo, confirmDialog } from './ui.js';
import { get, post, del } from './api.js';
import { store, userById, firstName } from './store.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';
import { icon } from './social.js';

const DURATION = 5000;

export async function loadStories() {
  store.stories = await get('/api/stories');
  store.storyRings = new Map(store.stories.map(g => [g.user_id, !g.all_seen]));
  return store.stories;
}

export function storiesBar({ onChange } = {}) {
  const bar = h('div.stories');

  function draw() {
    clear(bar);
    store.stories ||= [];
    const mine = store.stories.find(g => g.user_id === store.me.id);
    bar.append(h('button.story-item', { type: 'button', on: { click: () => (mine ? openStories(store.me.id, { onChange: refresh }) : addStory(refresh)) } },
      h('span.ring', { class: mine ? 'ring-seen' : '' }, avatar(store.me, 62),
        h('span.story-add', { title: 'Nuova storia', on: { click: e => { e.stopPropagation(); addStory(refresh); } } }, icon('plus', { size: 14 }))),
      h('span.story-name', 'La tua storia')));
    for (const g of store.stories.filter(x => x.user_id !== store.me.id)) {
      const u = userById(g.user_id);
      if (!u) continue;
      bar.append(h('button.story-item', { type: 'button', on: { click: () => openStories(g.user_id, { onChange: refresh }) } },
        h('span.ring', { class: g.all_seen ? 'ring-seen' : 'ring-new' }, avatar(u, 62)),
        h('span.story-name', firstName(u))));
    }
  }

  async function refresh() {
    await loadStories();
    draw();
    onChange?.();
  }

  draw();
  return { el: bar, refresh };
}

// Apre le storie di una persona e prosegue con quelle delle persone successive.
export function openStories(userId, { onChange } = {}) {
  const groups = store.stories;
  let gi = groups.findIndex(g => g.user_id === userId);
  if (gi < 0) return;
  // si parte dalla prima storia non vista
  let si = Math.max(0, groups[gi].items.findIndex(s => !s.seen && groups[gi].user_id !== store.me.id));
  let timer = null, started = 0, elapsed = 0, paused = false, changed = false;

  const frame = h('div.story-frame');
  const root = h('div.story-viewer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Storie' }, frame);
  document.body.append(root);
  document.body.classList.add('no-scroll');

  function close() {
    clearTimeout(timer);
    root.remove();
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    if (changed) onChange?.();
  }

  function next() {
    if (si < groups[gi].items.length - 1) si++;
    else if (gi < groups.length - 1) { gi++; si = 0; }
    else return close();
    show();
  }
  function prev() {
    if (si > 0) si--;
    else if (gi > 0) { gi--; si = groups[gi].items.length - 1; }
    show();
  }

  function schedule(ms) {
    clearTimeout(timer);
    started = Date.now();
    timer = setTimeout(next, ms);
  }
  function pause() {
    if (paused) return;
    paused = true;
    elapsed += Date.now() - started;
    clearTimeout(timer);
    frame.classList.add('paused');
  }
  function resume() {
    if (!paused) return;
    paused = false;
    frame.classList.remove('paused');
    schedule(DURATION - elapsed);
  }

  function show() {
    const g = groups[gi], s = g.items[si], u = userById(g.user_id);
    const own = g.user_id === store.me.id;
    elapsed = 0; paused = false;
    if (!own && !s.seen) {
      s.seen = true;
      changed = true;
      post(`/api/stories/${s.id}/view`, {}, { quiet: true }).catch(() => {});
    }

    const bars = h('div.story-bars', g.items.map((_, i) => h('span', h('i', {
      class: i < si ? 'done' : i === si ? 'run' : '',
      style: i === si ? { animationDuration: `${DURATION}ms` } : null,
    }))));
    const reply = own ? null : h('form.story-reply', {
      on: {
        submit: async e => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const c = await post('/api/conversations', { user_ids: [g.user_id] });
          await post(`/api/conversations/${c.id}/messages`, { body: `Risposta alla tua storia${s.caption ? ` «${s.caption}»` : ''}: ${text}` });
          input.value = '';
          toast('Messaggio inviato');
          input.blur();
        },
      },
    }, null);
    const input = h('input.input', {
      placeholder: `Rispondi a ${firstName(u)}…`,
      on: { focus: pause, blur: resume, keydown: e => e.stopPropagation() },
    });
    reply?.append(input, h('button.btn-icon.light', { type: 'submit', title: 'Invia' }, icon('send', { size: 22 })));

    const actions = [];
    if (own) {
      actions.push(h('button.story-seen', { type: 'button', on: { click: async () => { pause(); await showViewers(s); resume(); } } },
        `Visto da ${s.view_count || 0}`));
    }
    fill(frame, 
      bars,
      h('div.story-head',
        avatar(u, 32), h('a.user-link', { href: `#/u/${u?.id}`, on: { click: close } }, u?.name || ''), h('span.story-time', timeAgo(s.created_at)),
        h('span.grow'),
        own ? h('button.btn-icon.light', {
          type: 'button', title: 'Elimina storia',
          on: { click: async () => { pause(); if (await confirmDialog('Eliminare questa storia?', { ok: 'Elimina', danger: true })) { await del(`/api/stories/${s.id}`); changed = true; g.items.splice(si, 1); if (!g.items.length) { groups.splice(gi, 1); return close(); } si = Math.min(si, g.items.length - 1); show(); } else resume(); } },
        }, icon('more', { size: 22 })) : null,
        h('button.btn-icon.light', { type: 'button', title: 'Chiudi', on: { click: close } }, icon('close', { size: 24 }))),
      h('img.story-img', { src: mediaUrl(s.media_id), alt: s.caption || 'Storia' }),
      s.caption ? h('div.story-caption', s.caption) : null,
      h('button.story-tap.left', { type: 'button', 'aria-label': 'Storia precedente', on: { click: prev } }),
      h('button.story-tap.right', { type: 'button', 'aria-label': 'Storia successiva', on: { click: next } }),
      h('div.story-foot', reply, ...actions));
    schedule(DURATION);
  }

  // tieni premuto per fermare
  frame.addEventListener('pointerdown', e => { if (e.target.closest('.story-tap')) pause(); });
  frame.addEventListener('pointerup', e => { if (e.target.closest('.story-tap') && document.activeElement?.tagName !== 'INPUT') resume(); });
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });

  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  };
  document.addEventListener('keydown', onKey);
  show();
}

async function showViewers(s) {
  const list = await get(`/api/stories/${s.id}/viewers`);
  await new Promise(resolve => modal({
    title: `Visto da ${list.length}`,
    body: list.length ? h('div.people-list', list.map(v => {
      const u = userById(v.user_id);
      return h('div.people-row', avatar(u, 36), h('div.grow', h('strong', u?.name || ''), h('small', timeAgo(v.viewed_at))));
    })) : h('p.muted', 'Ancora nessuno.'),
    onClose: resolve,
  }));
}

export async function addStory(onDone) {
  const [file] = await pickImages();
  if (!file) return;
  const preview = h('img.story-preview', { src: URL.createObjectURL(file), alt: '' });
  const caption = h('input.input', { placeholder: 'Scrivi una didascalia… (facoltativa)', maxLength: 300 });
  const share = h('button.btn.btn-primary', { type: 'button' }, 'Condividi la storia');
  const m = modal({
    title: 'Nuova storia',
    body: [preview, caption, h('p.small.muted', 'Resta visibile a tutti per 24 ore.')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), share],
  });
  share.addEventListener('click', async () => {
    share.disabled = true;
    try {
      const media = await uploadImage(file, { max: 1440 });
      await post('/api/stories', { media_id: media.id, caption: caption.value.trim() });
      m.close();
      toast('Storia pubblicata');
      onDone?.();
    } catch (err) {
      if (err.message && !err.status) toast(err.message, 'err');
      share.disabled = false;
    }
  });
}
