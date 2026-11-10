// Alma Planet: pagina di benvenuto. Le scorciatoie più utili (BOSS, welfare, assistenza…), le news aziendali
// (i post messi in evidenza dagli amministratori), le ultime idee del Laboratorio e gli ultimi post della bacheca.
import { h, fill, avatar, timeAgo, loading, modal, toast } from './ui.js';
import { get, put } from './api.js';
import { store, userById, firstName } from './store.js';
import { icon } from './icons.js';
import { openPost } from './feed.js';
import { CATEGORIES, statusPill } from './ideas.js';

const ICONS = { clock: 'Orologio', 'hard-hat': 'Cantiere', gift: 'Regalo', headset: 'Assistenza', external: 'Link esterno', link: 'Link',
  calendar: 'Calendario', mail: 'Posta', 'file-text': 'Documento', users: 'Persone', building: 'Azienda', cloud: 'Cloud', package: 'Pacchetto', car: 'Auto' };
const nameOf = id => userById(id)?.name || 'Ex collega';
const excerpt = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function greeting() {
  const hr = new Date().getHours();
  return hr < 13 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

function shortcutCard(s, canEdit, edit) {
  const inner = [h('span.wl-ico', icon(s.icon || 'external', { size: 22 })),
    h('span.wl-text', h('strong', s.label), h('span.small.muted', s.url ? s.hint : (canEdit ? 'Indirizzo da impostare' : 'In arrivo')))];
  if (!s.url) return h(canEdit ? 'button.card.wl-shortcut.is-off' : 'div.card.wl-shortcut.is-off', canEdit ? { type: 'button', on: { click: edit } } : {}, inner);
  const external = /^https?:/i.test(s.url);
  return h('a.card.wl-shortcut', { href: s.url, ...(external ? { target: '_blank', rel: 'noopener' } : {}) },
    inner, external ? h('span.wl-out', icon('external', { size: 14 })) : null);
}

// Editor delle scorciatoie (amministratori).
function editShortcuts(list, onSaved) {
  const rows = h('div.wl-edit');
  const items = list.map(s => ({ ...s }));
  const draw = () => fill(rows, items.map((s, i) => h('div.wl-edit-row',
    h('div.grid-2',
      h('label.field', h('span', 'Nome'), h('input.input', { value: s.label, maxlength: 60, on: { input: e => { s.label = e.target.value; } } })),
      h('label.field', h('span', 'Icona'), h('select.select', { on: { change: e => { s.icon = e.target.value; } } },
        Object.entries(ICONS).map(([k, l]) => h('option', { value: k, selected: k === s.icon }, l))))),
    h('label.field', h('span', 'Descrizione'), h('input.input', { value: s.hint, maxlength: 120, on: { input: e => { s.hint = e.target.value; } } })),
    h('label.field', h('span', 'Indirizzo'), h('input.input', { value: s.url, type: 'url', placeholder: 'https://…', on: { input: e => { s.url = e.target.value; } } })),
    h('div.row-actions',
      i > 0 ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); draw(); } } }, 'Sposta su') : null,
      h('button.btn.btn-ghost.btn-sm.btn-danger', { type: 'button', on: { click: () => { items.splice(i, 1); draw(); } } }, 'Togli')))));
  draw();
  const m = modal({
    title: 'Scorciatoie della pagina di benvenuto',
    wide: true,
    body: [h('p.muted.small', 'Le vedono tutti in cima alla pagina di benvenuto. Senza indirizzo la scorciatoia resta in grigio.'), rows],
    left: [h('button.btn.btn-sm', { type: 'button', on: { click: () => { items.push({ label: '', hint: '', url: '', icon: 'external' }); draw(); } } }, icon('plus', { size: 14 }), 'Aggiungi scorciatoia')],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (items.some(s => !s.label.trim())) { toast('Ogni scorciatoia ha bisogno di un nome', 'err'); return; }
        const r = await put('/api/welcome/shortcuts', { shortcuts: items });
        m.close();
        toast('Scorciatoie salvate');
        onSaved(r.shortcuts);
      } } }, 'Salva'),
    ],
  });
}

export async function welcomeView(view) {
  fill(view, loading());
  const d = await get('/api/welcome');
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  const shortcuts = h('div.wl-shortcuts');
  const drawShortcuts = () => fill(shortcuts, d.shortcuts.map(s => shortcutCard(s, d.can_edit, edit)));
  const edit = () => editShortcuts(d.shortcuts, list => { d.shortcuts = list; drawShortcuts(); });
  drawShortcuts();

  const newsItem = p => h('button.wl-news', { type: 'button', on: { click: () => openPost(p.id) } },
    avatar(userById(p.author_id) || { name: '?' }, 36),
    h('span.wl-news-text',
      h('span.small', h('strong', nameOf(p.author_id)), h('span.muted', ` · ${timeAgo(p.pinned_at || p.created_at)}`)),
      h('span.wl-news-body', excerpt(p.body, 260))));

  const news = h('section.card.wl-panel.wl-news-panel',
    h('div.spread', h('h2', icon('megaphone', { size: 18 }), 'News aziendali'), h('a.small', { href: '#/' }, 'Vai alla bacheca')),
    d.news.length ? d.news.map(newsItem)
      : h('p.muted', store.me.is_admin ? 'Nessuna news: metti in evidenza un post della bacheca (menu «…» del post) e comparirà qui.'
        : 'Nessuna news aziendale per ora.'));

  const ideas = h('section.card.wl-panel',
    h('div.spread', h('h2', icon('lightbulb', { size: 18 }), 'Laboratorio delle idee'), h('a.small', { href: '#/idee' }, 'Tutte le idee')),
    d.ideas.length ? d.ideas.map(i => h('a.wl-idea', { href: `#/idee/${i.id}` },
      h('strong', i.title),
      h('span.small.muted', `${CATEGORIES[i.category] || ''} · ${nameOf(i.author_id)} · ${i.support_count} ${i.support_count === 1 ? 'sostegno' : 'sostegni'}`),
      i.status !== 'proposta' ? statusPill(i.status) : null))
      : h('p.muted', 'Ancora nessuna idea quest\'anno.'),
    h('a.btn.btn-sm', { href: '#/idee?new=1' }, icon('plus', { size: 14 }), 'Proponi un\'idea'));

  const latest = d.latest.length ? h('section.card.wl-panel',
    h('div.spread', h('h2', 'Dalla bacheca'), h('a.small', { href: '#/' }, 'Apri')),
    d.latest.map(p => h('button.wl-news.wl-news-sm', { type: 'button', on: { click: () => openPost(p.id) } },
      avatar(userById(p.author_id) || { name: '?' }, 28),
      h('span.wl-news-text', h('span.small', h('strong', nameOf(p.author_id)), h('span.muted', ` · ${timeAgo(p.created_at)}`)),
        h('span.wl-news-body', excerpt(p.body, 120)))))) : null;

  fill(view,
    h('div.page-head.wl-head',
      h('div', h('h1.wl-title', `${greeting()}, `, h('strong', firstName(store.me))), h('div.sub', today.charAt(0).toUpperCase() + today.slice(1))),
      d.can_edit ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: edit } }, icon('pencil', { size: 14 }), 'Modifica scorciatoie') : null),
    shortcuts,
    h('div.wl-cols', news, h('div.wl-side', ideas, latest)));
}
