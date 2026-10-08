// Home dell'intranet: storie, nuovo post, bacheca (in evidenza + cronologica a scorrimento infinito),
// e a lato il proprio profilo, i ticket da fare e i colleghi.
import { h, clear, fill, avatar, modal, toast, timeAgo, fmtDate, confirmDialog, today, loading, isMobile } from './ui.js';
import { get, post, del } from './api.js';
import { store, userById, firstName } from './store.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';
import { icon, richText, withMentions, popMenu, ringAvatar, userLink } from './social.js';
import { storiesBar, loadStories, openStories } from './stories.js';
import { onLive } from './live.js';
import { messageButton } from './teams.js';
import { ticketCard } from './tickets.js';

const MAX_PHOTOS = 10;
const CAPTION_CUT = 220;

export function homeView(view, params) {
  const tag = params.get('tag');
  const offs = [];
  let next = null, busy = false, observer = null;

  const pinnedBox = h('div.feed-list');
  const list = h('div.feed-list');
  const sentinel = h('div.feed-end');
  const newPill = h('button.new-posts', { type: 'button', hidden: true, on: { click: () => { newPill.hidden = true; reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); } } }, '↑ Nuovi post');
  const stories = tag ? null : storiesBar({ onChange: () => redrawRings() });

  const feedCol = h('div.feed-col',
    newPill,
    tag
      ? h('div.tag-head', h('h1', `#${tag}`), h('a.btn.btn-sm', { href: '#/' }, '← Tutta la bacheca'))
      : [stories.el, isMobile() ? todayCard() : null, composerCard(() => reload())],
    pinnedBox, list, sentinel);

  fill(view, h('div.home', feedCol, sideColumn()));

  // le storie danno l'anello agli avatar dei post
  function redrawRings() {
    for (const el of view.querySelectorAll('article.post')) el.replaceWith(postCard(el._post, cardOpts));
  }

  const cardOpts = {
    onRemove: el => el.remove(),
    onStory: uid => openStories(uid, { onChange: () => stories?.refresh() }),
  };

  async function load() {
    if (busy || next === false) return;
    busy = true;
    sentinel.replaceChildren(loading());
    try {
      const q = new URLSearchParams();
      if (tag) q.set('tag', tag);
      if (next) q.set('before', next);
      const data = await get(`/api/feed?${q}`);
      if (!next && data.pinned?.length) pinnedBox.append(...data.pinned.map(p => postCard(p, cardOpts)));
      list.append(...data.posts.map(p => postCard(p, cardOpts)));
      next = data.next || false;
      if (!list.childElementCount && !pinnedBox.childElementCount) {
        list.append(h('div.card.empty', tag ? `Nessun post con #${tag}.` : 'Ancora nessun post: scrivi il primo!'));
      }
    } finally {
      busy = false;
      sentinel.replaceChildren(next === false && list.childElementCount > 3 ? h('span.muted.small', 'Hai visto tutto ✓') : '');
    }
  }

  function reload() {
    clear(pinnedBox); clear(list);
    next = null;
    load();
  }

  (async () => {
    if (!tag) {
      await loadStories().catch(() => { store.stories = []; });
      stories.refresh();
    }
    await load();
    observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) load(); }, { rootMargin: '600px' });
    observer.observe(sentinel);
  })();

  offs.push(onLive('post', d => { if (d.author_id !== store.me.id && !tag) newPill.hidden = false; }));
  offs.push(onLive('story', () => stories?.refresh()));

  return () => { observer?.disconnect(); offs.forEach(off => off()); };
}

// ── nuovo post ──────────────────────────────────────────────────────────────
function composerCard(onCreated) {
  const open = () => openComposer({ onCreated });
  return h('div.card.composer', { on: { click: open } },
    avatar(store.me, 40),
    h('div.composer-fake', `A cosa stai lavorando, ${firstName(store.me)}?`),
    h('button.btn-icon', { type: 'button', title: 'Aggiungi foto' }, icon('image', { size: 22 })));
}

export function openComposer({ onCreated } = {}) {
  const photos = []; // { id?, url, uploading }
  const text = h('textarea.input.composer-text', { placeholder: 'Scrivi un post… usa @ per menzionare un collega e # per un argomento', maxLength: 5000, autofocus: true });
  const strip = h('div.photo-strip');
  const publish = h('button.btn.btn-primary', { type: 'button' }, 'Pubblica');

  const drawStrip = () => {
    fill(strip, ...photos.map((p, i) => h('div.photo-thumb', { class: p.uploading ? 'uploading' : '' },
      h('img', { src: p.url, alt: '' }),
      p.uploading ? h('span.spinner') : null,
      h('button.thumb-x', { type: 'button', title: 'Togli', on: { click: () => { photos.splice(i, 1); drawStrip(); } } }, icon('close', { size: 14 })))));
    if (photos.length < MAX_PHOTOS) {
      strip.append(h('button.photo-add', { type: 'button', on: { click: addPhotos } }, icon('image', { size: 22 }), h('span', photos.length ? 'Altre foto' : 'Aggiungi foto')));
    }
    publish.disabled = photos.some(p => p.uploading);
  };

  async function addFiles(files) {
    for (const file of files.slice(0, MAX_PHOTOS - photos.length)) {
      const p = { url: URL.createObjectURL(file), uploading: true };
      photos.push(p);
      drawStrip();
      uploadImage(file).then(m => { p.id = m.id; p.uploading = false; drawStrip(); })
        .catch(err => { photos.splice(photos.indexOf(p), 1); drawStrip(); if (!err.status) toast(err.message, 'err'); });
    }
  }
  async function addPhotos() { addFiles(await pickImages({ multiple: true })); }

  const body = h('div.composer-body',
    h('div.row', avatar(store.me, 36), h('strong', store.me.name)),
    withMentions(text), strip);
  body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag'); });
  body.addEventListener('dragleave', () => body.classList.remove('drag'));
  body.addEventListener('drop', e => {
    e.preventDefault();
    body.classList.remove('drag');
    addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  });
  drawStrip();

  const m = modal({ title: 'Nuovo post', body, actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), publish] });
  m.box.classList.add('composer-modal');
  publish.addEventListener('click', async () => {
    if (!text.value.trim() && !photos.length) return toast('Scrivi qualcosa o aggiungi una foto', 'err');
    publish.disabled = true;
    try {
      const p = await post('/api/posts', { body: text.value, media_ids: photos.map(x => x.id) });
      m.close();
      toast('Post pubblicato');
      onCreated?.(p);
    } catch { publish.disabled = false; }
  });
}

// ── carosello di foto ───────────────────────────────────────────────────────
function carousel(media, { onDoubleTap } = {}) {
  const first = media[0];
  // proporzioni come Instagram: tra 4:5 (verticale) e 1.91:1 (orizzontale)
  const ratio = first.w && first.h ? Math.min(1.91, Math.max(0.8, first.w / first.h)) : 1;
  const track = h('div.car-track', media.map(m => h('div.car-slide', h('img', { src: mediaUrl(m.id), alt: '', loading: 'lazy', draggable: false }))));
  const dots = media.length > 1 ? h('div.car-dots', media.map((_, i) => h('i', { class: i === 0 ? 'on' : '' }))) : null;
  const go = d => track.scrollBy({ left: d * track.clientWidth, behavior: 'smooth' });
  const prev = media.length > 1 ? h('button.car-btn.prev', { type: 'button', 'aria-label': 'Foto precedente', hidden: true, on: { click: () => go(-1) } }, icon('left', { size: 18 })) : null;
  const nextBtn = media.length > 1 ? h('button.car-btn.next', { type: 'button', 'aria-label': 'Foto successiva', on: { click: () => go(1) } }, icon('right', { size: 18 })) : null;
  const heart = h('div.heart-burst', icon('heart', { size: 96, filled: true }));
  const el = h('div.carousel', { style: { aspectRatio: String(ratio) } }, track, prev, nextBtn, dots, heart,
    media.length > 1 ? h('span.car-count', `1/${media.length}`) : null);
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    dots?.querySelectorAll('i').forEach((d, j) => d.classList.toggle('on', i === j));
    if (prev) prev.hidden = i === 0;
    if (nextBtn) nextBtn.hidden = i === media.length - 1;
    const count = el.querySelector('.car-count');
    if (count) count.textContent = `${i + 1}/${media.length}`;
  }, { passive: true });
  track.addEventListener('dblclick', () => {
    heart.classList.remove('go');
    void heart.offsetWidth;
    heart.classList.add('go');
    onDoubleTap?.();
  });
  return el;
}

// ── scheda di un post ───────────────────────────────────────────────────────
function likesLine(p, onOpen) {
  if (!p.like_count) return h('div.post-likes.muted', 'Nessun mi piace');
  const other = userById(p.last_liker_id);
  const btn = (label) => h('button.link-btn', { type: 'button', on: { click: onOpen } }, label);
  if (p.liked && p.like_count === 1) return h('div.post-likes', 'Piace a ', btn('te'));
  if (other) {
    const rest = p.like_count - 1;
    return h('div.post-likes', 'Piace a ', h('a.user-link.strong', { href: `#/u/${other.id}` }, other.name),
      rest ? [' e ', btn(`${rest === 1 && p.liked ? 'a te' : `altri ${rest}`}`)] : null);
  }
  return h('div.post-likes', btn(`${p.like_count} mi piace`));
}

export function postCard(p, opts = {}) {
  const author = userById(p.author_id);
  const el = h('article.card.post');
  el._post = p;

  const replace = np => { const n = postCard(np, opts); el.replaceWith(n); return n; };
  const refresh = async () => replace(await get(`/api/posts/${p.id}`));

  async function toggleLike(force) {
    const want = force ?? !p.liked;
    if (want === p.liked) return;
    const np = { ...p, liked: want, like_count: p.like_count + (want ? 1 : -1) };
    replace(np);
    const r = await (want ? post(`/api/posts/${p.id}/like`) : del(`/api/posts/${p.id}/like`)).catch(() => null);
    if (!r) replace(p);
  }

  const more = h('button.btn-icon', { type: 'button', title: 'Altre azioni', on: { click: () => popMenu(more, [
    { label: 'Vai al post', onClick: () => openPost(p.id, { onChange: refresh }) },
    { label: 'Copia link', onClick: () => copyPostLink(p) },
    store.me.is_admin ? { label: p.pinned_at ? 'Togli dall\'evidenza' : 'Metti in evidenza', onClick: async () => {
      replace(await (p.pinned_at ? del(`/api/posts/${p.id}/pin`) : post(`/api/posts/${p.id}/pin`)));
      toast(p.pinned_at ? 'Tolto dall\'evidenza' : 'In evidenza in cima alla bacheca per tutti');
    } } : null,
    (p.author_id === store.me.id || store.me.is_admin) ? { label: 'Elimina', danger: true, onClick: async () => {
      if (!await confirmDialog('Eliminare questo post? Spariscono anche commenti e mi piace.', { ok: 'Elimina', danger: true })) return;
      await del(`/api/posts/${p.id}`);
      opts.onRemove ? opts.onRemove(el) : el.remove();
      toast('Post eliminato');
    } } : null,
  ]) } }, icon('more', { size: 20 }));

  const head = h('header.post-head',
    h('a', { href: `#/u/${p.author_id}` }, ringAvatar(author, 36, { onStory: opts.onStory })),
    h('div.grow', h('div', userLink(author)), h('div.post-meta', [author?.job_title, timeAgo(p.created_at)].filter(Boolean).join(' · '))),
    p.pinned_at ? h('span.pinned', icon('pin', { size: 14 }), 'In evidenza') : null,
    more);

  const hasMedia = p.media.length > 0;
  const caption = p.body ? captionBlock(author, p.body, { withName: hasMedia }) : null;

  const actions = h('div.post-actions',
    h('button.btn-icon.like', { type: 'button', class: p.liked ? 'on' : '', title: p.liked ? 'Non mi piace più' : 'Mi piace', on: { click: () => toggleLike() } },
      icon('heart', { size: 24, filled: p.liked })),
    h('button.btn-icon', { type: 'button', title: 'Commenta', on: { click: () => openPost(p.id, { onChange: refresh, focus: true }) } }, icon('comment', { size: 24 })),
    h('button.btn-icon', { type: 'button', title: 'Copia il link del post', on: { click: () => copyPostLink(p) } }, icon('send', { size: 23 })));

  const commentInput = h('input.input.comment-input', { placeholder: 'Aggiungi un commento…', maxLength: 2200 });
  const sendBtn = h('button.link-btn.strong', { type: 'submit', hidden: true }, 'Pubblica');
  commentInput.addEventListener('input', () => { sendBtn.hidden = !commentInput.value.trim(); });
  const form = h('form.post-comment', {
    on: { submit: async e => {
      e.preventDefault();
      const body = commentInput.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try { await post(`/api/posts/${p.id}/comments`, { body }); await refresh(); } finally { sendBtn.disabled = false; }
    } },
  }, withMentions(commentInput), sendBtn);

  fill(el,
    head,
    hasMedia ? carousel(p.media, { onDoubleTap: () => toggleLike(true) }) : null,
    !hasMedia && caption ? h('div.post-text', caption) : null,
    actions,
    likesLine(p, () => showLikers(p.id)),
    hasMedia ? caption : null,
    p.comment_count > p.recent_comments.length
      ? h('button.link-btn.muted.more-comments', { type: 'button', on: { click: () => openPost(p.id, { onChange: refresh }) } }, `Mostra tutti i ${p.comment_count} commenti`)
      : null,
    p.recent_comments.length ? h('div.post-recent', p.recent_comments.map(c => h('div.recent-comment', userLink(userById(c.user_id)), ' ', richText(c.body)))) : null,
    form);
  return el;
}

function captionBlock(author, body, { withName }) {
  const long = body.length > CAPTION_CUT;
  const box = h('div.post-caption');
  const draw = full => {
    fill(box, withName ? [userLink(author), ' '] : null,
      richText(full || !long ? body : `${body.slice(0, CAPTION_CUT).trimEnd()}… `),
      long && !full ? h('button.link-btn.muted', { type: 'button', on: { click: () => draw(true) } }, 'altro') : null);
  };
  draw(false);
  return box;
}

async function showLikers(postId) {
  const ids = await get(`/api/posts/${postId}/likes`);
  const m = modal({
    title: 'Mi piace',
    body: h('div.people-list', ids.map(id => {
      const u = userById(id);
      return h('a.people-row', { href: `#/u/${id}`, on: { click: () => closeAllModals(m) } },
        avatar(u, 40), h('div.grow', h('strong', u?.name || ''), h('small', u?.job_title || `@${u?.handle || ''}`)));
    })),
  });
}

// Andando a un profilo da una finestra si chiudono anche quelle sotto (es. post aperto → mi piace).
export function closeAllModals(m) {
  m?.close();
  for (const x of [...document.querySelectorAll('#overlay-root .backdrop')].reverse()) x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// ── post aperto: foto a sinistra, commenti a destra ─────────────────────────
export async function openPost(id, { onChange, focus = false } = {}) {
  let p;
  try { p = await get(`/api/posts/${id}`); } catch { return; }
  let changed = false, replyTo = null;
  const author = userById(p.author_id);

  const thread = h('div.pm-thread');
  const input = h('input.input', { placeholder: 'Aggiungi un commento…', maxLength: 2200 });
  const replyBar = h('div.reply-bar', { hidden: true });
  const likeBtn = h('button.btn-icon.like', { type: 'button' });
  const likesBox = h('div');

  const drawLikes = () => {
    fill(likeBtn, icon('heart', { size: 24, filled: p.liked }));
    likeBtn.classList.toggle('on', p.liked);
    fill(likesBox, likesLine(p, () => showLikers(p.id)));
  };
  likeBtn.addEventListener('click', async () => {
    p.liked = !p.liked; p.like_count += p.liked ? 1 : -1; changed = true; drawLikes();
    await (p.liked ? post(`/api/posts/${p.id}/like`) : del(`/api/posts/${p.id}/like`));
  });

  const setReply = c => {
    replyTo = c;
    const u = userById(c?.user_id);
    replyBar.hidden = !c;
    fill(replyBar, c ? [`Rispondi a ${u?.name || ''}`, h('button.link-btn', { type: 'button', on: { click: () => setReply(null) } }, icon('close', { size: 14 }))] : '');
    if (c) {
      if (u && u.id !== store.me.id && !input.value.includes(`@${u.handle}`)) input.value = `@${u.handle} ${input.value}`;
      input.focus();
    }
  };

  function commentRow(c) {
    const u = userById(c.user_id);
    const canDelete = c.user_id === store.me.id || p.author_id === store.me.id || store.me.is_admin;
    const like = h('button.btn-icon.like.small', { type: 'button', class: c.liked ? 'on' : '', title: 'Mi piace',
      on: { click: async () => {
        c.liked = !c.liked; c.like_count += c.liked ? 1 : -1;
        await (c.liked ? post(`/api/comments/${c.id}/like`) : del(`/api/comments/${c.id}/like`));
        drawThread();
      } } }, icon('heart', { size: 14, filled: c.liked }));
    return h('div.pm-comment', { class: c.parent_id ? 'reply' : '' },
      h('a', { href: `#/u/${c.user_id}` }, avatar(u, c.parent_id ? 26 : 32)),
      h('div.grow',
        h('div', userLink(u), ' ', richText(c.body)),
        h('div.pm-meta', timeAgo(c.created_at),
          c.like_count ? h('span', `${c.like_count} mi piace`) : null,
          h('button.link-btn', { type: 'button', on: { click: () => setReply(c) } }, 'Rispondi'),
          canDelete ? h('button.link-btn', { type: 'button', on: { click: async () => {
            if (!await confirmDialog('Eliminare il commento?', { ok: 'Elimina', danger: true })) return;
            await del(`/api/comments/${c.id}`);
            p.comments = p.comments.filter(x => x.id !== c.id && x.parent_id !== c.id);
            changed = true;
            drawThread();
          } } }, 'Elimina') : null)),
      like);
  }

  function drawThread() {
    clear(thread);
    if (p.body && p.media.length) {
      thread.append(h('div.pm-comment', h('a', { href: `#/u/${p.author_id}` }, avatar(author, 32)),
        h('div.grow', h('div', userLink(author), ' ', richText(p.body)), h('div.pm-meta', timeAgo(p.created_at)))));
    }
    const roots = p.comments.filter(c => !c.parent_id);
    for (const c of roots) {
      thread.append(commentRow(c));
      for (const r of p.comments.filter(x => x.parent_id === c.id)) thread.append(commentRow(r));
    }
    if (!roots.length) thread.append(h('div.pm-empty', h('strong', 'Ancora nessun commento.'), h('span.muted', 'Inizia la conversazione.')));
  }

  const send = h('button.link-btn.strong', { type: 'submit' }, 'Pubblica');
  const form = h('form.pm-form', {
    on: { submit: async e => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        const c = await post(`/api/posts/${p.id}/comments`, { body, parent_id: replyTo?.id || null });
        p.comments.push(c);
        input.value = '';
        setReply(null);
        changed = true;
        drawThread();
        thread.lastElementChild?.scrollIntoView({ block: 'nearest' });
      } finally { send.disabled = false; }
    } },
  }, withMentions(input), send);

  const side = h('div.pm-side',
    h('header.post-head', ringAvatar(author, 32), h('div.grow', userLink(author), h('div.post-meta', author?.job_title || '')),
      p.pinned_at ? h('span.pinned', icon('pin', { size: 14 }), 'In evidenza') : null),
    !p.media.length && p.body ? h('div.post-text.pm-text', richText(p.body)) : null,
    thread,
    h('div.pm-bottom',
      h('div.post-actions', likeBtn,
        h('button.btn-icon', { type: 'button', title: 'Commenta', on: { click: () => input.focus() } }, icon('comment', { size: 24 })),
        h('button.btn-icon', { type: 'button', title: 'Copia il link del post', on: { click: () => copyPostLink(p) } }, icon('send', { size: 23 }))),
      likesBox,
      h('div.post-meta.pm-date', fmtDate(p.created_at.slice(0, 10), { year: true })),
      replyBar, form));

  drawLikes();
  drawThread();
  const m = modal({
    title: h('span'),
    body: h('div.pm', { class: p.media.length ? '' : 'text-only' }, p.media.length ? h('div.pm-media', carousel(p.media)) : null, side),
    onClose: () => { if (changed) onChange?.(); },
  });
  m.box.classList.add('post-modal');
  if (focus) input.focus();
}

// ── link al post, da incollare in Teams o in una email ──────────────────────
export function copyPostLink(p) {
  const url = `${location.origin}/app#/p/${p.id}`;
  navigator.clipboard.writeText(url).then(() => toast('Link copiato: incollalo in Teams o in una email'), () => toast(url));
}


// ── colonna a lato ──────────────────────────────────────────────────────────
// Telefono: i ticket più urgenti in cima alla bacheca (sul computer stanno nella colonna a destra).
function todayCard() {
  const box = h('div', loading());
  const card = h('section.m-today', h('div.m-today-head', h('h2', 'Da fare per te'), h('a', { href: '#/mine' }, 'Tutti')), box);
  const draw = async () => {
    const list = await get('/api/tickets?assignee=me&status=open', { quiet: true }).catch(() => null);
    if (!list) return card.remove();
    list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id);
    fill(box, list.length
      ? list.slice(0, 3).map(t => ticketCard(t, { onChange: draw, trash: false })) // riepilogo: niente cestino
      : h('p.muted', { style: { margin: '0 4px 10px' } }, 'Niente in sospeso. Bel lavoro.'));
  };
  draw();
  return card;
}

function sideColumn() {
  const tickets = h('div.side-list', loading());
  const people = h('div.side-list');
  get('/api/tickets?assignee=me&status=open', { quiet: true }).then(list => {
    list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    fill(tickets, list.length
      ? list.slice(0, 5).map(t => h('a.side-ticket', { href: `#/tickets/${t.id}` },
        h('span.side-ticket-title', t.title),
        t.due_date ? h('small', { class: t.due_date < today() ? 'due-late' : 'muted' }, fmtDate(t.due_date)) : null))
      : h('div.muted.small', 'Niente in sospeso.'));
  }).catch(() => clear(tickets));
  const colleagues = store.users.filter(u => u.id !== store.me.id && u.active);
  people.append(...colleagues.slice(0, 8).map(u => h('div.side-person',
    h('a', { href: `#/u/${u.id}` }, avatar(u, 34)),
    h('div.grow', h('a.user-link.strong', { href: `#/u/${u.id}` }, u.name), h('small', u.job_title || `@${u.handle}`)),
    messageButton(u, { className: 'link-btn.strong.accent' }))));
  if (!colleagues.length) people.append(h('div.muted.small', 'I colleghi compaiono qui dopo il loro primo accesso.'));

  return h('aside.home-side',
    h('a.side-me', { href: `#/u/${store.me.id}` }, avatar(store.me, 52), h('div', h('strong', store.me.name), h('small', `@${store.me.handle}`))),
    h('section', h('div.side-title', h('span', 'Da fare per te'), h('a', { href: '#/mine' }, 'Tutti')), tickets),
    h('section', h('div.side-title', h('span', 'Colleghi')), people),
    h('div.side-foot', 'Intranet Almacis · Alma Planet'));
}
