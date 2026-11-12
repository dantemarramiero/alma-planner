// Alma Planet sul telefono: tasto «+» (ticket, post, storia, evento), menu con le altre pagine e avatar nella barra in basso.
import { h, mobileQuery } from './ui.js';
import { icon } from './icons.js';
import { get, post } from './api.js';
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
  idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  mezzo: '<rect x="3" y="10" width="18" height="8" rx="2"/><path d="m5 10 1.5-4h11L19 10M7 14h.01M17 14h.01M5 18v2M19 18v2"/>',
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
    opt('rda', 'var(--ink)', 'RDA interna', 'Chiedi lavoro a un\'altra funzione, con le ore', () => openRdaForm({ onDone: () => go('#/rda') })),
    opt('mezzo', 'var(--amber)', 'Mezzo aziendale', 'Prenota un\'auto o un furgone', () => go('#/mezzi/prenota')),
    opt('idea', 'var(--green)', 'Idea', 'Per il Laboratorio delle idee', () => go('#/idee?new=1'))));
}

// ── barre del telefono (canvas 11/11) ─────────────────────────────────────────────────────────────
// In basso le 4 pagine più usate del modulo + Menu; il Menu ha tutte le pagine, gli altri moduli, le scorciatoie,
// profilo e notifiche. In alto: logo Almacis, il modulo (tocca per cambiarlo), cerca e campanella.
const TABS = {
  planet: [['#/benvenuto', 'benvenuto', 'house', 'Home'], ['#/', 'home', 'layout-dashboard', 'Bacheca'], ['#/persone', 'persone', 'users', 'Persone'], ['#/idee', 'idee', 'lightbulb', 'Idee']],
  project: [['#/settimana', 'settimana', 'calendar', 'Settimana'], ['#/tickets', 'tickets', 'square-check', 'Ticket'], ['#/rda', 'rda', 'arrows', 'RDA'], ['#/projects', 'projects', 'folder', 'Progetti']],
  strategy: [['#/strategy/hoshin', 'strategy-hoshin', 'grid-3x3', 'Hoshin'], ['#/strategy/a3', 'strategy-a3', 'file-text', 'A3'], ['#/strategy/dashboard', 'strategy-dashboard', 'layout-dashboard', 'Dashboard'], ['#/strategy/obiettivi', 'strategy-obiettivi', 'target', 'Obiettivi']],
  itTeam: [['#/it/strumenti', 'it-strumenti', 'monitor', 'Strumenti'], ['#/it/ticket', 'it-ticket', 'life-buoy', 'Ticket IT'], ['#/it/richieste', 'it-richieste', 'inbox', 'Richieste'], ['#/it/panoramica', 'it-panoramica', 'layout-dashboard', 'Panoramica']],
  it: [['#/it/strumenti', 'it-strumenti', 'monitor', 'Strumenti'], ['#/it/strumenti?azione=segnala', '', 'life-buoy', 'Segnala'], ['#/it/strumenti?azione=richiedi', '', 'plus', 'Richiedi']],
  crm: [['#/crm/lead', 'crm-lead', 'target', 'Lead'], ['#/crm/clienti', 'crm-clienti', 'building', 'Clienti'], ['#/crm/fornitori', 'crm-fornitori', 'package', 'Fornitori'], ['#/crm/contatti', 'crm-contatti', 'contact', 'Contatti']],
  energy: [['#/energy/panoramica', 'energy-panoramica', 'layout-dashboard', 'Panoramica'], ['#/energy/ppa', 'energy-ppa energy-revamping energy-fv energy-opportunita', 'sun', 'Pipeline'], ['#/energy/aziende', 'energy-aziende', 'building', 'Aziende'], ['#/energy/screening', 'energy-screening', 'map', 'Mappa']],
};
let current = { key: 'planet', label: 'Alma Planet', modules: [] };

function drawTabs() {
  const bar = document.getElementById('m-tabs');
  if (!bar) return;
  const key = current.key === 'it' && store.me?.software ? 'itTeam' : current.key;
  const tabs = TABS[key] || TABS.planet;
  bar.style.setProperty('--n', String(tabs.length + 1));
  bar.replaceChildren(...tabs.map(([href, nav, ico, label]) => h('a.m-tab', { href, 'data-tab': nav || '', on: { click: e => { if (href === location.hash) { e.preventDefault(); rerender(); } } } },
    icon(ico, { size: 22 }), h('span', label))),
  h('button.m-tab', { type: 'button', id: 'm-menu', on: { click: openMenu } }, icon('menu', { size: 22 }), h('span', 'Menu')));
  markActive();
}
// la pagina attiva: la stessa voce accesa nel menu laterale
function markActive() {
  const on = document.querySelector('.sidebar nav[data-ws]:not([hidden]) a.active')?.dataset.nav;
  for (const a of document.querySelectorAll('#m-tabs [data-tab]')) a.classList.toggle('active', Boolean(on) && a.dataset.tab.split(' ').includes(on));
}

// «+» tondo: crea la cosa della pagina in cui si è
function fabAction() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  const sec = path.split('/')[0];
  if (path === '' ) return () => openComposer({ onCreated: () => go('#/') });
  if (sec === 'tickets' || sec === 'settimana') return () => openTicket(null, { defaults: { assignee_ids: [store.me.id] }, onSaved: rerender });
  if (sec === 'idee') return () => go('#/idee?new=1');
  if (sec === 'rda') return () => openRdaForm({ onDone: rerender });
  if (sec === 'mezzi') return () => go('#/mezzi/prenota');
  if (path === 'benvenuto') return () => openCreate();
  return null;
}
function drawFab() {
  const fab = document.getElementById('m-fab');
  if (!fab) return;
  const act = fabAction();
  fab.hidden = !act;
  fab.onclick = act;
}

// Le voci del modulo corrente (dal suo menu laterale), gli altri moduli, le scorciatoie, profilo e notifiche.
function openMenu() {
  const nav = document.querySelector('.sidebar nav[data-ws]:not([hidden])');
  const items = [...(nav?.querySelectorAll('a[data-nav]') || [])]
    .filter(a => !a.hidden)
    .map(a => h('a', {
      href: a.getAttribute('href'), class: a.classList.contains('active') ? 'active' : '', on: { click: () => close() },
    }, h('span.nav-ico', icon(a.querySelector('[data-icon]')?.dataset.icon || 'file')),
    [...a.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()));
  const others = (current.modules || []).filter(m => m.key !== current.key);
  const shortcuts = h('div.menu-shortcuts');
  if (current.key === 'planet') {
    get('/api/welcome', { quiet: true }).then(d => {
      const list = (d?.shortcuts || []).filter(x => x.url);
      if (list.length) shortcuts.replaceChildren(h('span.menu-modules-label', 'Scorciatoie'), h('div.menu-grid', list.map(x =>
        h('a', { href: x.url, ...(/^https?:/i.test(x.url) ? { target: '_blank', rel: 'noopener' } : {}), on: { click: () => close() } }, x.label))));
    }).catch(() => {});
  }
  const close = sheet(current.label || 'Menu', h('div',
    h('nav.menu-list', items),
    shortcuts,
    others.length ? h('div.menu-others', h('span.menu-modules-label', 'Altri moduli'), h('div.menu-grid', others.map(m =>
      h('a', { href: m.home, on: { click: () => close() } }, icon(m.icon, { size: 18 }), m.label)))) : null,
    h('nav.menu-list.menu-foot',
      h('a', { href: `#/u/${store.me.id}`, on: { click: () => close() } }, h('span.nav-ico', icon('user')), 'Il mio profilo'),
      h('a', { href: '#/notifiche/impostazioni', on: { click: () => close() } }, h('span.nav-ico', icon('settings')), 'Notifiche: campanella, telefono, email'),
      h('button.danger', { type: 'button', on: { click: async () => { await post('/auth/logout'); location.href = '/'; } } }, h('span.nav-ico', icon('log-out')), 'Esci'))));
}

// tocca il nome del modulo: scegli un altro modulo
function openModules() {
  const mods = current.modules || [];
  const close = sheet('Moduli', h('nav.menu-list', mods.map(m => h('a', { href: m.home, class: m.key === current.key ? 'active' : '', on: { click: () => close() } },
    h('span.nav-ico', icon(m.icon)), m.label))));
}

// Sul telefono ogni tabella con intestazione diventa un elenco di schede (canvas 11/11, regola 3): le celle
// prendono il nome della colonna, il CSS (.m-cards) fa il resto. Non le tabelle del calendario e del Gantt.
function cardifyTables() {
  if (!MQ.matches) return;
  for (const t of document.querySelectorAll('#view table')) {
    if (t.closest('.fc, .gx, .no-cards') || !t.tHead) continue;
    const heads = [...t.tHead.rows[0]?.cells || []].map(th => th.textContent.trim());
    if (!heads.length) continue;
    t.classList.add('m-cards');
    for (const tr of [...t.tBodies].flatMap(b => [...b.rows])) {
      [...tr.cells].forEach((td, i) => { if (heads[i] && !td.dataset.label) td.dataset.label = heads[i]; });
    }
  }
}
let cardTimer = null;

export function setupMobile() {
  new MutationObserver(() => { clearTimeout(cardTimer); cardTimer = setTimeout(cardifyTables, 60); }).observe(document.getElementById('view'), { childList: true, subtree: true });
  document.getElementById('m-module')?.addEventListener('click', openModules);
  document.addEventListener('module-changed', e => {
    current = e.detail;
    const name = document.getElementById('m-module-name');
    if (name) name.textContent = current.label;
    drawTabs();
  });
  window.addEventListener('hashchange', () => setTimeout(() => { markActive(); drawFab(); }, 0));
  drawTabs();
  setTimeout(() => { markActive(); drawFab(); }, 0);
  // passando da telefono a schermo largo (o ruotando un tablet) le pagine si ridisegnano nella forma giusta
  MQ.addEventListener('change', rerender);
}
