// Avvio e navigazione (#/percorso?parametri).
import { h, clear, avatar, loading } from './ui.js';
import { get, post } from './api.js';
import { store, loadUsers, loadProjects } from './store.js';
import { ticketsView, openTicket } from './tickets.js';
import { projectsView, projectDetail } from './projects.js';
import { ganttView } from './gantt.js';
import { calendarView } from './calendar.js';
import { driveView } from './drive.js';
import { orgView } from './org.js';
import { homeView, openPost, openComposer } from './feed.js';
import { profileView } from './profile.js';
import { notificationsView } from './notifications.js';
import { startLive, onLive } from './live.js';
import { setupMobile } from './mobile.js';
import { fillIcons } from './icons.js';
import { rdaView } from './rda.js';
import { searchView, setupSearch } from './search.js';
import { itView, oldSoftwareHash } from './software.js';
import { fleetView } from './fleet.js';
import { energyView } from './energy.js';
import { strategyView } from './strategy.js';
import { ideasView } from './ideas.js';
import { welcomeView } from './welcome.js';
import { icon } from './icons.js';

const view = document.getElementById('view');
let cleanup = null;

// Cambiando pagina si chiudono le finestre aperte (es. da un post al profilo di chi ha commentato).
function closeOverlays() {
  const root = document.getElementById('overlay-root');
  for (let i = root.childElementCount; i > 0; i--) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

// ── freccia «Indietro» ──────────────────────────────────────────────────────
// Ricorda le pagine dell'app visitate in questa scheda: la freccia torna alla precedente, e se si è appena
// entrati porta alla Home (non al login di Microsoft o al sito da cui si è arrivati). In Home non compare.
const BACK_KEY = 'alma.backStack';
const readStack = () => { try { return JSON.parse(sessionStorage.getItem(BACK_KEY)) || []; } catch { return []; } };
const saveStack = s => { try { sessionStorage.setItem(BACK_KEY, JSON.stringify(s.slice(-50))); } catch { /* niente */ } };
function trackBack(section) {
  // i tab del progetto cambiano l'indirizzo senza nuova pagina: contano come la stessa pagina
  const here = (location.hash || '#/').replace(/^(#\/projects\/\d+)\/.*$/, '$1');
  const stack = readStack();
  if (stack[stack.length - 2] === here) stack.pop(); // si è tornati indietro
  else if (stack[stack.length - 1] !== here) stack.push(here);
  saveStack(stack);
  // nella scheda di un progetto il percorso «‹ Progetti» in alto fa già da indietro; in Alma Energy bastano i tab
  document.getElementById('backbar').hidden = section === 'home' || section === 'benvenuto' || section === 'energy' || section === 'strategy' || /^#\/projects\/\d+/.test(here);
}

// ── barra laterale a icone: «Tieni aperta» la fissa, e la scelta resta per le volte dopo ──
const RAIL_KEY = 'alma.railPinned';
function setupRail() {
  const btn = document.getElementById('rail-pin');
  let pinned = false;
  try { pinned = localStorage.getItem(RAIL_KEY) === '1'; } catch { /* niente */ }
  const apply = () => {
    document.body.classList.toggle('rail-pinned', pinned);
    btn.setAttribute('aria-pressed', String(pinned));
    btn.lastChild.textContent = pinned ? 'Richiudi la barra' : 'Tieni aperta';
  };
  apply();
  btn.addEventListener('click', () => {
    pinned = !pinned;
    try { localStorage.setItem(RAIL_KEY, pinned ? '1' : '0'); } catch { /* niente */ }
    apply();
  });
}
// ── selettore del modulo nella barra laterale, come in MyWinery ──
// Alma Planet è la intranet (feed, chat, persone), Alma Project il planner (ticket, progetti, calendario, mezzi),
// Alma Strategy (Hoshin Kanri e performance management), Alma Energy solo per chi ce l'ha. Ogni modulo ha il
// suo menu laterale e ricorda l'ultima pagina aperta: tornandoci si riparte da lì. Il selettore lo vedono tutti.
const MODULES = [
  { key: 'planet', label: 'Alma Planet', icon: 'house', home: '#/benvenuto', can: () => true },
  { key: 'project', label: 'Alma Project', icon: 'folder-kanban', home: '#/mine', can: () => true },
  { key: 'strategy', label: 'Alma Strategy', icon: 'target', home: '#/strategy/hoshin', can: () => true },
  // Alma IT: «I miei strumenti» per tutti, censimento e richieste per il team IT
  { key: 'it', label: 'Alma IT', icon: 'monitor', home: '#/it/strumenti', can: () => true },
  { key: 'energy', label: 'Alma Energy', icon: 'zap', home: '#/energy/panoramica', can: () => Boolean(store.me.energy) },
];
// sezioni del planner: vanno in Alma Project. La ricerca resta nel modulo in cui si è.
const PROJECT_SECTIONS = new Set(['mine', 'tickets', 'rda', 'mezzi', 'projects', 'gantt', 'calendar', 'drive']);
let lastModule = 'planet';
const moduleOf = section => (section === 'search' ? lastModule
  : PROJECT_SECTIONS.has(section) ? 'project'
  : section === 'energy' || section === 'strategy' || section === 'it' ? section : 'planet');
const MOD_KEY = 'alma.modulePages';
const readPages = () => { try { return JSON.parse(sessionStorage.getItem(MOD_KEY)) || {}; } catch { return {}; } };
const availableModules = () => MODULES.filter(m => m.can());

function setModuleMenu(open) {
  const menu = document.getElementById('ws-menu');
  menu.hidden = !open;
  document.getElementById('ws-trigger').setAttribute('aria-expanded', String(open));
  document.getElementById('ws-switch').classList.toggle('is-on', open);
}

function drawModule(section) {
  const current = moduleOf(section);
  lastModule = current;
  const pages = { ...readPages(), [current]: location.hash || '#/' };
  try { sessionStorage.setItem(MOD_KEY, JSON.stringify(pages)); } catch { /* niente */ }
  const mods = availableModules();
  const mod = MODULES.find(m => m.key === current);
  // menu laterale del modulo
  for (const nav of document.querySelectorAll('.sidebar [data-ws]')) nav.hidden = nav.dataset.ws !== current;
  const sw = document.getElementById('ws-switch');
  sw.hidden = mods.length < 2;
  if (sw.hidden) return;
  document.getElementById('ws-name').textContent = mod.label;
  document.getElementById('ws-badge').replaceChildren(icon(mod.icon, { size: 18 }));
  document.getElementById('ws-menu').replaceChildren(...mods.map(m => {
    const a = document.createElement('a');
    a.href = m.key === current ? m.home : (pages[m.key] || m.home);
    a.setAttribute('role', 'menuitem');
    a.className = m.key === current ? 'active' : '';
    const badge = document.createElement('span');
    badge.className = 'ws-badge';
    badge.append(icon(m.icon, { size: 16 }));
    const check = document.createElement('span');
    check.className = 'ws-check';
    check.append(icon('check', { size: 16 }));
    a.append(badge, m.label, check);
    a.addEventListener('click', () => setModuleMenu(false));
    return a;
  }));
}

function setupModules() {
  const trigger = document.getElementById('ws-trigger');
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    setModuleMenu(document.getElementById('ws-menu').hidden);
  });
  document.addEventListener('click', e => { if (!e.target.closest('#ws-switch')) setModuleMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setModuleMenu(false); });
}
function goBack() {
  const stack = readStack();
  if (stack.length > 1) history.back();
  else location.hash = '#/';
}

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || 'home';

  closeOverlays();
  // in Alma Energy la voce attiva è la sezione (energy-ppa, energy-aziende…)
  const navKey = section === 'u' && Number(parts[1]) === store.me.id ? 'me' : section === 'p' ? 'home'
    : section === 'energy' ? `energy-${parts[1] || 'panoramica'}`
    : section === 'strategy' ? `strategy-${parts[1] === 'matrix' || !parts[1] ? 'hoshin' : parts[1]}`
    : section === 'it' ? `it-${parts[1] === 'software' || parts[1] === 'fornitore' ? 'fornitori' : parts[1] || 'strumenti'}` : section;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  document.body.classList.toggle('on-direct', section === 'direct');
  const modLabel = MODULES.find(m => m.key === moduleOf(section))?.label || 'Alma Planet';
  document.title = section === 'direct' ? `Chat · ${modLabel}` : modLabel;
  trackBack(section);
  drawModule(section);
  cleanup?.();
  cleanup = null;
  clear(view).append(loading());

  switch (section) {
    case 'home':
      cleanup = homeView(view, params);
      break;
    case 'p':
      cleanup = homeView(view, new URLSearchParams());
      openPost(Number(parts[1]));
      break;
    case 'u':
      await profileView(view, Number(parts[1]));
      break;
    case 'direct': {
      // Chat = chat di Microsoft Teams (public/js/teams.js, a cura della sessione Teams).
      const teams = await import('./teams.js').catch(() => null);
      if (teams) cleanup = (await teams.teamsView(view, params)) || null;
      else {
        clear(view).append(h('div.card.empty',
          h('p', 'Qui arriveranno le chat di Microsoft Teams.'),
          h('a.btn.btn-primary', { href: 'https://teams.microsoft.com/', target: '_blank', rel: 'noopener' }, 'Apri Teams')));
      }
      break;
    }
    case 'rda':
      rdaView(view);
      break;
    case 'notifications':
      cleanup = notificationsView(view);
      break;
    case 'mine':
      ticketsView(view, { title: 'I miei ticket', subtitle: 'Ticket e attività di progetto assegnati a te.', fixed: { assignee: 'me' } });
      break;
    case 'tickets':
      ticketsView(view, { title: 'Tutti i ticket', subtitle: 'Filtra per progetto, persona o stato.' });
      if (parts[1]) openTicket(Number(parts[1]), {});
      break;
    case 'projects':
      if (parts[1]) await projectDetail(view, Number(parts[1]));
      else await projectsView(view);
      break;
    case 'gantt':
      await ganttView(view, params);
      break;
    case 'calendar': {
      const c = calendarView(view, params);
      cleanup = c.destroy;
      break;
    }
    case 'drive':
      driveView(view);
      break;
    case 'search':
      searchView(view, params);
      break;
    case 'benvenuto':
      await welcomeView(view);
      break;
    case 'idee':
      await ideasView(view, parts, params);
      break;
    case 'org':
      await orgView(view, params);
      break;
    case 'it':
      await itView(view, parts);
      break;
    case 'software': // indirizzi di prima del modulo Alma IT
      location.replace(oldSoftwareHash(parts));
      return;
    case 'mezzi':
      await fleetView(view, parts);
      break;
    case 'energy':
      await energyView(view, parts);
      break;
    case 'strategy':
      await strategyView(view, parts);
      break;
    default:
      clear(view).append(h('div.card.empty', 'Pagina non trovata.'));
  }
  view.focus({ preventScroll: true });
}

// ── contatori nel menu ──────────────────────────────────────────────────────
let badgeTimer = null;
function refreshBadges() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    const [b, teams] = await Promise.all([
      get('/api/badges', { quiet: true }).catch(() => null),
      get('/api/teams/unread', { quiet: true }).catch(() => null), // chat di Teams non lette, quando c'è
    ]);
    if (!b) return;
    b.direct = teams?.chats || 0;
    for (const [key, n] of Object.entries(b)) {
      for (const el of document.querySelectorAll(`[data-badge="${key}"]`)) {
        el.hidden = !n;
        el.textContent = n > 99 ? '99+' : String(n);
      }
    }
  }, 150);
}

function drawMe() {
  const me = document.getElementById('me');
  clear(me).append(avatar(store.me, 30), h('div', { style: { minWidth: 0 } }, h('div.me-name', store.me.name), h('div.me-mail', store.me.email)));
  document.querySelector('[data-nav="me"]').href = `#/u/${store.me.id}`;
}

async function start() {
  fillIcons(); // icone Lucide del menu laterale (data-icon in app.html)
  setupRail();
  setupModules();
  store.me = await get('/api/me');
  await Promise.all([loadUsers(), loadProjects()]);
  drawMe();
  setupMobile();
  setupSearch(); // casella di ricerca nella barra laterale, lente sul telefono, «/» e Ctrl+K
  document.addEventListener('me-changed', drawMe);
  document.addEventListener('badges-changed', refreshBadges); // es. richiesta di un mezzo appena approvata
  document.getElementById('logout').addEventListener('click', async () => {
    await post('/auth/logout');
    location.href = '/';
  });
  document.getElementById('create').addEventListener('click', () => openComposer({
    onCreated: () => { if (location.hash.replace(/^#\/?/, '') === '') route(); else location.hash = '#/'; },
  }));

  startLive();
  for (const ev of ['notification', 'badges', 'message', 'read', 'rda']) onLive(ev, refreshBadges);
  // censimento software: amministratori e team IT (il server lo rifiuta comunque agli altri)
  // Alma IT: le voci del team IT solo per amministratori e team IT (il server lo rifiuta comunque agli altri)
  for (const el of document.querySelectorAll('[data-it-team]')) el.hidden = !store.me.software;
  // Alma Strategy: dashboard dei team e mansionario solo agli amministratori (il server lo rifiuta comunque agli altri)
  document.getElementById('nav-pm-mans').hidden = !store.me.is_admin;
  // la dashboard dei team la vedono gli amministratori, il team HR e chi è responsabile di qualcuno
  document.getElementById('nav-pm-team').hidden = !store.me.is_admin;
  if (!store.me.is_admin) get('/api/pm/flags', { quiet: true }).then(f => { document.getElementById('nav-pm-team').hidden = !(f?.manager || f?.hr); }).catch(() => {});
  refreshBadges();

  document.getElementById('back').addEventListener('click', goBack);
  window.addEventListener('hashchange', route);
  // aprendo l'app senza un indirizzo preciso si parte dalla pagina di benvenuto (la bacheca resta su #/)
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/benvenuto');
  route();
}

start();
