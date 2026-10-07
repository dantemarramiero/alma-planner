// Profilo di una persona: foto, ruolo, presentazione, numeri e griglia dei post.
import { h, clear, fill, avatar, modal, toast, loading } from './ui.js';
import { get, patch } from './api.js';
import { store, loadUsers } from './store.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';
import { icon, richText, ringAvatar } from './social.js';
import { openPost, openChatWith } from './feed.js';
import { loadStories, openStories } from './stories.js';

export async function profileView(view, id) {
  fill(view, loading());
  let p;
  try {
    [p] = await Promise.all([get(`/api/profiles/${id}`), store.stories ? null : loadStories().catch(() => null)]);
  } catch {
    return fill(view, h('div.card.empty', 'Persona non trovata.'));
  }
  const own = p.id === store.me.id;

  const stat = (n, label) => h('div.stat', h('strong', String(n)), h('span', label)); // String: h() salterebbe lo 0
  const head = h('header.profile-head',
    h('div.profile-av', ringAvatar(p, 132, { onStory: uid => openStories(uid, { onChange: () => profileView(view, id) }) })),
    h('div.profile-info',
      h('div.profile-name-row', h('h1', p.name),
        own
          ? h('button.btn', { type: 'button', on: { click: () => editProfile(() => profileView(view, id)) } }, 'Modifica profilo')
          : h('button.btn.btn-primary', { type: 'button', on: { click: () => openChatWith(p.id) } }, 'Messaggio')),
      h('div.profile-stats', stat(p.post_count, p.post_count === 1 ? 'post' : 'post'), stat(p.likes_received, 'mi piace ricevuti'), stat(p.open_tickets, 'ticket aperti')),
      h('div.profile-handle', `@${p.handle}`, p.job_title ? h('span', ` · ${p.job_title}`) : null),
      p.bio ? h('p.profile-bio', richText(p.bio)) : own ? h('p.profile-bio.muted', 'Aggiungi una presentazione: cosa fai, su cosa lavori.') : null,
      h('a.small.muted', { href: `mailto:${p.email}` }, p.email)));

  const grid = h('div.profile-grid');
  for (const x of p.posts) {
    const tile = h('button.tile', { type: 'button', on: { click: () => openPost(x.id, { onChange: () => profileView(view, id) }) } },
      x.cover ? h('img', { src: mediaUrl(x.cover.id), alt: '', loading: 'lazy' }) : h('div.tile-text', x.body),
      x.media_count > 1 ? h('span.tile-multi', icon('layers', { size: 18 })) : null,
      x.pinned_at ? h('span.tile-pin', icon('pin', { size: 16 })) : null,
      h('span.tile-hover', h('span', icon('heart', { size: 18, filled: true }), x.like_count), h('span', icon('comment', { size: 18, filled: true }), x.comment_count)));
    grid.append(tile);
  }

  fill(view, h('div.profile', head,
    h('div.profile-tabs', h('span.on', 'Post')),
    p.posts.length ? grid : h('div.empty', own ? 'Non hai ancora pubblicato nulla. Il tuo primo post compare qui.' : 'Nessun post per ora.')));
}

function editProfile(onSaved) {
  let avatarId;
  const preview = h('span', avatar(store.me, 88));
  const bio = h('textarea.input', { maxLength: 300, placeholder: 'Due righe su di te: ruolo, progetti, competenze…' });
  bio.value = store.me.bio || '';
  const count = h('small.muted', `${bio.value.length}/300`);
  bio.addEventListener('input', () => { count.textContent = `${bio.value.length}/300`; });
  const m = modal({
    title: 'Modifica profilo',
    body: [
      h('div.row', preview, h('div', h('strong', store.me.name), h('div.row', { style: { marginTop: '6px' } },
        h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
          const [f] = await pickImages();
          if (!f) return;
          try {
            const media = await uploadImage(f, { max: 480 });
            avatarId = media.id;
            fill(preview, avatar({ ...store.me, avatar_id: media.id }, 88));
          } catch (err) { if (!err.status) toast(err.message, 'err'); }
        } } }, 'Cambia foto'),
        store.me.avatar_id ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { avatarId = null; fill(preview, avatar({ ...store.me, avatar_id: null }, 88)); } } }, 'Togli foto') : null))),
      h('label.field', h('span', 'Presentazione'), bio, count),
    ],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { bio: bio.value };
        if (avatarId !== undefined) body.avatar_id = avatarId;
        Object.assign(store.me, await patch('/api/me', body));
        await loadUsers();
        document.dispatchEvent(new CustomEvent('me-changed'));
        m.close();
        toast('Profilo aggiornato');
        onSaved?.();
      } } }, 'Salva')],
  });
}
