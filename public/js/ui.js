// Piccola libreria di interfaccia: elementi, modali, drawer, avvisi, formati.

// h('div.cls#id', { attr, on: { click } }, ...figli) — i testi diventano nodi di testo (niente HTML iniettato).
export function h(tag, attrs, ...children) {
  const [, name, rest] = tag.match(/^([a-z0-9-]+)(.*)$/i);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
      }
    }
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = el => { el.replaceChildren(); return el; };
// Svuota e riempie, accettando come h() liste annidate e valori vuoti (null/false) che vengono saltati.
export const fill = (el, ...children) => { el.replaceChildren(); append(el, children); return el; };

// ── avvisi ──────────────────────────────────────────────────────────────────
export function toast(message, kind = 'ok') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const t = h('div.toast', { class: kind === 'err' ? 'err' : '' }, message);
  root.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

// ── modali e drawer ─────────────────────────────────────────────────────────
export function modal({ title, body, actions = [], left = [], wide = false, drawer = false, onClose }) {
  const root = document.getElementById('overlay-root');
  const prevFocus = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === backdrop) close(); };
  const head = h('div.modal-head', typeof title === 'string' ? h('h2', title) : title,
    h('button.x', { type: 'button', 'aria-label': 'Chiudi', on: { click: close } }, '×'));
  const foot = actions.length || left.length ? h('div.modal-foot', h('div.left', left), actions) : null;
  const box = h(drawer ? 'div.drawer' : 'div.modal', { role: 'dialog', 'aria-modal': 'true', class: wide ? 'wide' : '' },
    head, h('div.modal-body', body), foot);
  const backdrop = h('div.backdrop', { class: drawer ? 'drawer-backdrop' : '' }, box);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  root.append(backdrop);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input, textarea, select, button:not(.x)'))?.focus(), 0);
  return { close, box, head, foot };
}

export function confirmDialog(message, { ok = 'Conferma', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title: 'Conferma',
      body: h('p', { style: { margin: 0 } }, message),
      actions: [
        h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn', { type: 'button', class: danger ? 'btn-danger' : 'btn-primary', on: { click: () => { done = true; m.close(); resolve(true); } } }, ok),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function promptDialog(title, { label, value = '', ok = 'Salva' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = h('input.input', { value, autofocus: true });
    const submit = () => { if (!input.value.trim()) return; done = true; m.close(); resolve(input.value.trim()); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    const m = modal({
      title,
      body: h('label.field', h('span', label || ''), input),
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: submit } }, ok)],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

// ── formati ─────────────────────────────────────────────────────────────────
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function fmtDate(d, { year = false } = {}) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  const showYear = year || y !== new Date().getFullYear();
  return `${day} ${MONTHS[m - 1]}${showYear ? ` ${y}` : ''}`;
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtSize(n) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const toISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};

export const STATUS = { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' };
export const PRIORITY = { low: 'Bassa', normal: 'Normale', high: 'Alta', urgent: 'Urgente' };
export const PROJECT_STATUS = { active: 'Attivo', paused: 'In pausa', done: 'Concluso', archived: 'Archiviato' };
export const PROJECT_COLORS = ['#E85A0A', '#0057B8', '#1B7A45', '#8A1538', '#4A3082', '#009260', '#B84207', '#5B6770', '#C2185B', '#00838F'];

// «ora», «5 min», «3 h», «2 g», poi la data.
export function timeAgo(iso) {
  if (!iso) return '';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'ora';
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} g`;
  return fmtDate(new Date(iso).toISOString());
}

export const statusPill = s => h('span.pill', { class: `st-${s}` }, h('span.dot'), STATUS[s]);

// ── avatar ──────────────────────────────────────────────────────────────────
const AV_COLORS = ['#E85A0A', '#0057B8', '#1B7A45', '#8A1538', '#4A3082', '#009260', '#5B6770', '#B84207'];
export function initials(name = '?') {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
// Con la foto del profilo (avatar_id) mostra l'immagine, altrimenti le iniziali su un colore fisso per persona.
export function avatar(user, size) {
  if (!user) return null;
  let hash = 0;
  for (const c of user.email || user.name || '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const el = h('span.avatar', { title: user.name, style: { background: AV_COLORS[hash % AV_COLORS.length] } },
    user.avatar_id ? h('img', { src: `/api/media/${user.avatar_id}`, alt: '', loading: 'lazy' }) : initials(user.name));
  if (size) Object.assign(el.style, { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` });
  return el;
}

export const projChip = (name, color) => name
  ? h('span.proj-chip', h('i', { style: { background: color || '#ccc' } }), h('span', name))
  : h('span.proj-chip.muted', '—');

export const loading = () => h('div.loading', h('span.spinner'));

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Telefono: sotto i 760 px l'app usa la barra in basso, le schede dei ticket e le attività in lista (css/mobile.css).
export const mobileQuery = window.matchMedia('(max-width: 760px)');
export const isMobile = () => mobileQuery.matches;
