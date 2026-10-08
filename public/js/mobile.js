// Alma Planner sul telefono: tasto «+» (ticket, post, storia, evento), menu con le altre pagine e avatar nella barra in basso.
import { h, avatar, mobileQuery } from './ui.js';
import { post } from './api.js';
import { store } from './store.js';
import { openTicket } from './tickets.js';
import { openComposer } from './feed.js';
import { addStory } from './stories.js';
import { openRdaForm } from './rda.js';

const MQ = mobileQuery;

// Ridisegna la pagina corrente (dopo aver creato qualcosa).
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
function go(hash) {
  if (location.hash === hash) rerender(); else location.hash = hash;
}

// Foglio che sale dal basso; si chiude toccando fuori, con Esc o cambiando pagina.
function sheet(title, content) {
  const root = document.getElementById('overlay-root');
  root.querySelector(':scope > .sheet-backdrop')?._close(); // un foglio alla volta (doppio tocco sul +)
  const prevFocus = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === backdrop) close(); };
  const box = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-grip'), h('h2', title), content);
  const backdrop = h('div.sheet-backdrop', box);
  backdrop._close = close;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  root.append(backdrop);
  // il fuoco va sul foglio, non sulla prima voce: sul telefono il bordo arancione di focus su «Progetti» non serve
  box.tabIndex = -1;
  setTimeout(() => box.focus({ preventScroll: true }), 0);
  return close;
}

const SVG = {
  ticket: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8 12 3 3 5-6"/>',
  post: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  story: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/><path d="M12 8v8M8 12h8"/>',
  event: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  rda: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
};
function svg(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
  return tpl.content.firstChild;
}

function openCreate() {
  const opt = (key, color, label, hint, action) => h('button.create-opt', { type: 'button', on: { click: () => { close(); action(); } } },
    h('i', { style: { background: color } }, svg(key)),
    h('span', h('strong', label), h('small', hint)));
  const close = sheet('Cosa vuoi creare?', h('div.create-grid',
    opt('ticket', 'var(--orange)', 'Ticket', 'Una cosa da fare', () => openTicket(null, {
      defaults: { assignee_ids: [store.me.id] },
      onSaved: () => go('#/mine'),
    })),
    opt('post', 'var(--blue)', 'Post', 'Foto e testo per tutti', () => openComposer({ onCreated: () => go('#/') })),
    opt('story', 'var(--violet)', 'Storia', 'Sparisce dopo 24 ore', () => addStory(() => go('#/'))),
    opt('event', 'var(--green)', 'Evento', 'Nel calendario Outlook', () => go('#/calendar?new=1')),
    opt('rda', 'var(--ink)', 'RDA interna', 'Chiedi lavoro a un\'altra funzione, con le ore', () => openRdaForm({ onDone: () => go('#/rda') }))));
}

function openMenu() {
  const link = (hash, ico, label) => h('a', { href: hash, on: { click: () => close() } }, h('span.nav-ico', ico), label);
  const close = sheet('Menu', h('nav.menu-list',
    link('#/projects', '▣', 'Progetti'),
    link('#/tickets', '☰', 'Tutti i ticket'),
    link('#/rda', '⇄', 'RDA interne'),
    link('#/gantt', '▤', 'Gantt'),
    link('#/drive', '☁', 'OneDrive'),
    link('#/org', '⧉', 'Organigramma'),
    store.me.internal_chat ? link('#/chat', '✉', 'Chat interna') : null,
    h('button.danger', { type: 'button', on: { click: async () => { await post('/auth/logout'); location.href = '/'; } } }, h('span.nav-ico', '⎋'), 'Esci')));
}

function drawMe() {
  const me = document.getElementById('m-me');
  me.href = `#/u/${store.me.id}`;
  me.replaceChildren(avatar(store.me, 28));
}

export function setupMobile() {
  drawMe();
  document.addEventListener('me-changed', drawMe);
  document.getElementById('m-create').addEventListener('click', openCreate);
  document.getElementById('m-menu').addEventListener('click', openMenu);
  // passando da telefono a schermo largo (o ruotando un tablet) le pagine si ridisegnano nella forma giusta
  MQ.addEventListener('change', rerender);
}
