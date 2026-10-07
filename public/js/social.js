// Pezzi comuni dell'intranet: icone, testo con @menzioni/#hashtag/link, suggerimenti delle menzioni,
// menu a comparsa e avatar con l'anello delle storie.
import { h, clear, fill, avatar } from './ui.js';
import { store, userByHandle } from './store.js';

// ── icone (SVG costanti, mai testo dell'utente) ────────────────────────────
const PATHS = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  comment: '<path d="M20.7 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.3a8.5 8.5 0 1 1 15.7-4.2z"/>',
  send: '<path d="M22 3 11 14"/><path d="M22 3 15 21l-4-7-7-4 18-7z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8V3h6v7.8l3 3.2H6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  layers: '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M17 3H6a3 3 0 0 0-3 3v11"/>',
};

export function icon(name, { size = 24, filled = false, cls = '' } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstChild;
}

// ── testo ───────────────────────────────────────────────────────────────────
const TOKEN_RE = /(@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)|(#[\p{L}\p{N}_]+)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/giu;

// Testo dell'utente come nodi (niente HTML): @menzioni al profilo, #hashtag alla bacheca filtrata, link cliccabili.
export function richText(text) {
  const out = [];
  let last = 0;
  for (const m of String(text || '').matchAll(TOKEN_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const u = userByHandle(m[1].slice(1));
      out.push(u ? h('a.mention', { href: `#/u/${u.id}` }, m[1]) : m[1]);
    } else if (m[2]) {
      out.push(h('a.hashtag', { href: `#/?tag=${encodeURIComponent(m[2].slice(1).toLowerCase())}` }, m[2]));
    } else {
      out.push(h('a.link', { href: m[3], target: '_blank', rel: 'noopener noreferrer' }, m[3]));
    }
    last = m.index + m[0].length;
  }
  if (last < String(text || '').length) out.push(text.slice(last));
  return out;
}

// ── suggerimenti @menzione su un campo di testo ─────────────────────────────
// Restituisce un contenitore con il campo dentro: scrivendo «@an» compare l'elenco dei colleghi.
export function withMentions(field) {
  const wrap = h('div.mention-wrap', field);
  let menu = null, items = [], active = 0;
  const close = () => { menu?.remove(); menu = null; };

  const query = () => {
    const before = field.value.slice(0, field.selectionStart);
    const m = before.match(/(^|[\s(])@([a-z0-9._-]*)$/i);
    return m ? m[2].toLowerCase() : null;
  };

  const pick = u => {
    const pos = field.selectionStart;
    const before = field.value.slice(0, pos).replace(/@([a-z0-9._-]*)$/i, `@${u.handle} `);
    field.value = before + field.value.slice(pos);
    field.setSelectionRange(before.length, before.length);
    field.dispatchEvent(new Event('input'));
    close();
    field.focus();
  };

  const draw = () => {
    const q = query();
    if (q === null) return close();
    items = store.users.filter(u => u.id !== store.me.id && (u.handle.includes(q) || u.name.toLowerCase().includes(q))).slice(0, 6);
    if (!items.length) return close();
    active = Math.min(active, items.length - 1);
    if (!menu) { menu = h('div.mention-menu'); wrap.append(menu); }
    fill(menu, ...items.map((u, i) => h('div.mention-item', {
      class: i === active ? 'on' : '',
      on: { mousedown: e => { e.preventDefault(); pick(u); } },
    }, avatar(u, 24), h('div', h('strong', u.name), h('small', `@${u.handle}`)))));
  };

  field.addEventListener('input', () => { active = 0; draw(); });
  field.addEventListener('blur', () => setTimeout(close, 100));
  field.addEventListener('keydown', e => {
    if (!menu) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { pick(items[active]); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Escape') { close(); e.stopPropagation(); }
  });
  return wrap;
}

// ── menu a comparsa ─────────────────────────────────────────────────────────
// items: [{ label, onClick, danger }]
export function popMenu(anchor, items) {
  const menu = h('div.pop-menu', items.filter(Boolean).map(it => h('button', {
    type: 'button', class: it.danger ? 'danger' : '',
    on: { click: () => { close(); it.onClick(); } },
  }, it.label)));
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8);
  Object.assign(menu.style, { top: `${r.bottom + window.scrollY + 4}px`, left: `${Math.max(8, left)}px` });
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}

// ── avatar con l'anello delle storie ────────────────────────────────────────
// store.storyRings: Map userId → true se ha storie non viste, false se le ha già viste tutte.
export function ringAvatar(user, size, { onStory } = {}) {
  const state = store.storyRings?.get(user?.id);
  const el = h('span.ring', { class: state === undefined ? '' : state ? 'ring-new' : 'ring-seen' }, avatar(user, size));
  if (state !== undefined && onStory) {
    el.classList.add('clickable');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onStory(user.id); });
  }
  return el;
}

// Nome cliccabile verso il profilo.
export const userLink = (u, cls = 'strong') => (u ? h(`a.user-link.${cls}`, { href: `#/u/${u.id}` }, u.name) : h('span.muted', 'Utente rimosso'));
