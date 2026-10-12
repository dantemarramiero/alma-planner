// Profilo di una persona: foto, ruolo, presentazione, numeri e griglia dei post.
import { h, clear, fill, avatar, modal, toast, loading } from './ui.js';
import { get, post, patch } from './api.js';
import { icon as lucide } from './icons.js';
import { store, loadUsers, activeProjects } from './store.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';
import { icon, richText, ringAvatar } from './social.js';
import { openPost } from './feed.js';
import { messageButton } from './teams.js';
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
          : messageButton(p)),
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

  const postsBox = p.posts.length ? grid : h('div.empty', own ? 'Non hai ancora pubblicato nulla. Il tuo primo post compare qui.' : 'Nessun post per ora.');
  if (!own) return fill(view, h('div.profile', head, h('div.profile-tabs', h('span.on', 'Post')), postsBox));

  // Nel proprio profilo, come la griglia di Instagram: i post e i progetti (un riquadro colorato per progetto)
  const projects = activeProjects().filter(x => x.status !== 'done');
  const projBox = projects.length
    ? h('div.profile-grid', projects.map(x => {
      const pct = x.ticket_count ? Math.round((x.done_count / x.ticket_count) * 100) : 0;
      return h('a.proj-tile', { href: `#/projects/${x.id}`, style: { '--c': x.color } },
        h('strong', x.name),
        h('span', h('small', `${pct}%`), h('span.bar', { style: { display: 'block' } }, h('i', { style: { width: `${pct}%` } }))));
    }))
    : h('div.empty', 'Nessun progetto attivo.');
  const tabs = h('div.profile-tabs', [['post', 'Post'], ['progetti', 'Progetti']].map(([k, l]) =>
    h('button', { type: 'button', 'data-k': k, class: k === 'post' ? 'on' : '', 'aria-pressed': String(k === 'post'), on: { click: () => show(k) } }, l)));
  const body = h('div', postsBox);
  function show(k) {
    for (const b of tabs.children) { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-pressed', String(b.dataset.k === k)); }
    body.replaceChildren(k === 'post' ? postsBox : projBox);
  }
  fill(view, h('div.profile', head, tabs, body));
}

// Riepilogo del mattino: acceso/spento e ora (a quarti d'ora), più «Mandami una prova» e l'anteprima.
let digestState = null, digestInitial = null;
function digestBox() {
  const enabled = h('input', { type: 'checkbox' });
  const time = h('select.select', { 'aria-label': 'Ora del riepilogo' });
  for (let m = 6 * 60; m <= 12 * 60; m += 15) time.append(h('option', { value: String(m) }, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`));
  const status = h('p.digest-note', 'Caricamento…');
  const testBtn = h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
    testBtn.disabled = true;
    try {
      const r = await post('/api/me/digest/test', {});
      toast(r.items ? `Riepilogo di prova inviato: ${r.items} ${r.items === 1 ? 'voce' : 'voci'}` : "Riepilogo di prova inviato (oggi non c'è niente da segnalare)");
    } catch { /* l'errore lo mostra api() */ } finally { testBtn.disabled = false; }
  } } }, 'Mandami una prova');
  const box = h('div.digest-box',
    h('div.digest-head', lucide('sunrise', { size: 18 }), 'Riepilogo del mattino'),
    h('label.digest-check', enabled, "Ricevi ogni giorno lavorativo un'email con scadenze, ritardi e RDA da approvare"),
    h('div.digest-row', h('span.muted', 'Alle'), time, testBtn, h('a.btn.btn-sm.btn-ghost', { href: '/api/me/digest/preview', target: '_blank', rel: 'noopener' }, 'Vedi anteprima')),
    status);
  const sync = () => { time.disabled = !enabled.checked; digestState = { enabled: enabled.checked, minute: Number(time.value) }; };
  enabled.addEventListener('change', sync);
  time.addEventListener('change', sync);
  get('/api/me/digest', { quiet: true }).then(d => {
    enabled.checked = d.enabled;
    time.value = String(d.minute);
    sync();
    digestInitial = { ...digestState };
    const last = d.last?.find(x => x.status === 'sent');
    status.textContent = `Oggi: ${d.preview.total ? `${d.preview.total} ${d.preview.total === 1 ? 'voce' : 'voci'}` : 'niente da segnalare'}${last ? ` · ultimo inviato il ${last.day.split('-').reverse().join('/')}` : ''}. Arriva dalla tua casella, solo nei giorni lavorativi e solo se c'è qualcosa.`;
  }).catch(() => { status.textContent = 'Preferenze del riepilogo non disponibili.'; });
  return box;
}
async function saveDigest() {
  if (!digestState || !digestInitial) return;
  if (digestState.enabled === digestInitial.enabled && digestState.minute === digestInitial.minute) return;
  await patch('/api/me/digest', digestState);
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
      digestBox(),
    ],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await saveDigest(); // riepilogo del mattino: solo se cambiato
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
