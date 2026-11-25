// Avvio e navigazione (#/percorso?parametri).
import { mioBigliettoView } from './biglietti.js';
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
import { settimanaView, ticketsPage } from './settimana.js';
import { personeView } from './persone.js';
import { fleetView } from './fleet.js';
import { energyView } from './energy.js';
import { crmView } from './crm.js';
import { attachHelp } from './manuali.js';
import { strategyView } from './strategy.js';
import { ideasView } from './ideas.js';
import { welcomeView } from './welcome.js';
import { icon } from './icons.js';
import { startPwa } from './pwa.js';
import { notifSettingsView } from './notif-settings.js';
import { renderImpostazioni } from './impostazioni.js';
import { lavoroView, inboxView, esploraView, ioView, markPlace, trackRecent, isRoot } from './app2.js';
import { agoraView, crmHome, contactPage as contactPage3, scanPage, mioBiglietto, compitiView } from './app3.js';
import { fotoPage, diarioPage, cantieriPage } from './cantieri.js';
import { isMobile } from './ui.js';
import { almaView, setupAlma } from './alma.js';
import { openFeedback, feedbackView } from './feedback.js';
import { postaVocePage } from './posta-voce.js';
import { firmaView } from './firma.js';
import { postaMiaView } from './posta-mia.js';

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
  document.getElementById('backbar').hidden = isRoot(section) || section === 'home' || section === 'benvenuto' || section === 'energy' || section === 'strategy' || section === 'crm' || section === 'impianti' || section === 'procurement' || section === 'hr' || section === 'alma' || /^#\/projects\/\d+/.test(here);
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
  // menu più lungo della barra (schermi bassi): sfumatura in fondo finché ci sono voci più giù (22/11/2026)
  const more = (showActive = false) => {
    for (const nav of document.querySelectorAll('.sidebar > .nav')) {
      if (nav.hidden) continue;
      // la pagina aperta resta sempre in vista, anche quando il menu scorre
      const act = showActive && nav.querySelector('a.active');
      if (act) {
        const a = act.getBoundingClientRect(), n = nav.getBoundingClientRect();
        const top = a.top - n.top + nav.scrollTop;
        if (nav.scrollHeight > nav.clientHeight + 2 && (top < nav.scrollTop || top + act.offsetHeight > nav.scrollTop + nav.clientHeight - 28)) nav.scrollTop = top - nav.clientHeight / 2;
        // barra in alto (tablet): il menu scorre di lato
        const left = a.left - n.left + nav.scrollLeft;
        if (nav.scrollWidth > nav.clientWidth + 2 && (left < nav.scrollLeft || left + act.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollLeft = left - (nav.clientWidth - act.offsetWidth) / 2;
      }
      nav.classList.toggle('more-below', nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4);
    }
  };
  for (const nav of document.querySelectorAll('.sidebar > .nav')) nav.addEventListener('scroll', () => more(), { passive: true });
  addEventListener('resize', () => more(true));
  addEventListener('hashchange', () => setTimeout(() => more(true), 80));
  new MutationObserver(() => more()).observe(document.querySelector('.sidebar'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  setTimeout(() => more(true), 400);
}
// ── selettore del modulo nella barra laterale, come in MyWinery ──
// Alma Agorà è la intranet (feed, chat, persone), Alma Project il planner (ticket, progetti, calendario, mezzi),
// Alma Strategy (Hoshin Kanri e performance management), Alma Energy solo per chi ce l'ha. Ogni modulo ha il
// suo menu laterale e ricorda l'ultima pagina aperta: tornandoci si riparte da lì. Il selettore lo vedono tutti.
const MODULES = [
  { key: 'planet', label: 'Alma Agorà', icon: 'house', home: '#/benvenuto', can: () => true },
  { key: 'project', label: 'Alma Project', icon: 'folder-kanban', home: '#/settimana', can: () => true },
  { key: 'strategy', label: 'Alma Strategy', icon: 'target', home: '#/strategy/hoshin', can: () => true },
  // Alma IT: «I miei strumenti» per tutti, censimento e richieste per il team IT
  { key: 'it', label: 'Alma IT', icon: 'monitor', home: '#/it/strumenti', can: () => true },
  { key: 'energy', label: 'Alma Energy', icon: 'zap', home: '#/energy/panoramica', can: () => Boolean(store.me.energy) },
  // Alma CRM: la direzione e chi è assegnato a un'ASA (canvas del 12/11/2026)
  { key: 'crm', label: 'Alma CRM', icon: 'contact', home: '#/crm/settimana', can: () => Boolean(store.me.crm) },
  // Alma Impianti (ALM2-73): la BU Impianti sopra il CRM comune; chi vede il CRM vede anche questo
  { key: 'impianti', label: 'Alma Impianti', icon: 'factory', home: '#/impianti/home', can: () => Boolean(store.me.crm) },
  // Alma Procurement (ALM2-81): capitolato merci, fornitori, Chiedi ad Alma, richieste di quotazione; sopra il CRM comune
  { key: 'procurement', label: 'Alma Procurement', icon: 'package', home: '#/procurement/home', can: () => Boolean(store.me.procurement) },
  // Alma HR: griglia salary grade, mansionario e il mio percorso per tutti; persone, RAL e pannello solo al team HR
  { key: 'hr', label: 'Alma HR', icon: 'id-card', home: '#/hr/percorso', can: () => Boolean(store.me?.hr_on) }, // nascosto a tutti finché HR_ATTIVO non è 1
];
// sezioni del planner: vanno in Alma Project. La ricerca resta nel modulo in cui si è.
const PROJECT_SECTIONS = new Set(['settimana', 'mine', 'tickets', 'rda', 'mezzi', 'projects', 'gantt', 'calendar']); // OneDrive è in Alma Agorà
let lastModule = 'planet';
const ENERGY_CRM = new Set(['scheda', 'contatti', 'lead', 'clienti', 'fornitori', 'partner', 'tutte', 'progetto', 'posta', 'doppioni']);
const moduleOf = section => (section === 'search' ? lastModule
  : PROJECT_SECTIONS.has(section) ? 'project'
  : section === 'energy' || section === 'strategy' || section === 'it' || section === 'crm' || section === 'hr' || section === 'impianti' || section === 'procurement' ? section : 'planet');
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
  document.dispatchEvent(new CustomEvent('module-changed', { detail: { key: current, label: mod.label, modules: mods } })); // barre del telefono
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
  // ALM2-89: da Alma Energy le schede e gli elenchi del CRM si aprono dentro Energy (stesse pagine, area fissa);
  // «?centrale=1» apre il CRM generale
  // ALM2-92: lo stesso per Alma Impianti
  if (section === 'crm' && lastModule === 'impianti' && ENERGY_CRM.has(parts[1]) && !params.has('centrale')) {
    const to = parts[1] === 'posta' ? ['impianti', 'posta', ...parts.slice(2)] : ['impianti', 'crm', ...parts.slice(1)];
    location.replace(`#/${to.join('/')}${query ? `?${query}` : ''}`);
    return;
  }
  if (section === 'crm' && lastModule === 'energy' && ENERGY_CRM.has(parts[1]) && !params.has('centrale')) {
    const to = parts[1] === 'posta' ? ['energy', 'posta', ...parts.slice(2)] : ['energy', 'crm', ...parts.slice(1)];
    location.replace(`#/${to.join('/')}${query ? `?${query}` : ''}`);
    return;
  }

  closeOverlays();
  // in Alma Energy la voce attiva è la sezione (energy-ppa, energy-aziende…)
  const navKey = section === 'u' && Number(parts[1]) === store.me.id ? 'me' : section === 'p' ? 'home'
    : section === 'energy' ? (parts[1] === 'crm' ? `energy-crm-${parts[2] === 'partner' ? 'partner' : parts[2] || 'lead'}` : `energy-${parts[1] || 'panoramica'}`)
    : section === 'crm' ? `crm-${parts[1] === 'scheda' ? '' : parts[1] === 'progetto' ? 'progetti' : parts[1] === 'prima' ? 'concorrenza' : parts[1] === 'lancio' ? (parts[2] === 'i' ? 'business' : 'radar') : parts[1] || 'settimana'}`
    : section === 'impianti' ? (parts[1] === 'crm' ? `impianti-crm-${parts[2] || 'lead'}` : parts[1] === 'nuovi-lead' ? 'impianti-crm-lead' : parts[1] === 'dare-avere' ? 'impianti-progettisti' : `impianti-${parts[1] || 'home'}`)
    : section === 'procurement' ? `procurement-${parts[1] || 'home'}`
    : section === 'strategy' ? `strategy-${parts[1] === 'matrix' || !parts[1] ? 'hoshin' : parts[1]}`
    : section === 'hr' ? `hr-${parts[1] === 'persona' ? 'persone' : parts[1] === 'ruolo' ? 'mansionario' : parts[1] === 'candidato' ? 'richieste' : ['incontro', 'fineprova', 'onboarding'].includes(parts[1]) ? (store.me?.hr ? 'onboarding' : 'onboarding-mie') : ['valutazione', 'semestre'].includes(parts[1]) ? 'valutazioni' : parts[1] === 'esito' ? 'percorso' : parts[1] || 'percorso'}`
    : section === 'org' ? 'persone' : section === 'mine' ? 'tickets'
    : section === 'it' ? `it-${parts[1] === 'software' || parts[1] === 'fornitore' ? 'fornitori' : parts[1] || 'strumenti'}` : section;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  document.body.classList.toggle('on-direct', section === 'direct');
  const modLabel = MODULES.find(m => m.key === moduleOf(section))?.label || 'Alma Agorà';
  document.title = section === 'direct' ? `Chat · ${modLabel}` : modLabel;
  trackBack(section);
  drawModule(section);
  markPlace(section); // telefono: posto acceso nella barra in basso
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
    case 'notifiche': // Profilo → Notifiche: campanella, telefono, email
      await notifSettingsView(view);
      break;
    case 'mine': // pagina unica dei Ticket: «I miei» è la vista di partenza
      location.replace('#/tickets');
      return;
    case 'tickets':
      ticketsPage(view, params);
      if (parts[1]) openTicket(Number(parts[1]), {});
      break;
    case 'settimana':
      await settimanaView(view, params);
      break;
    case 'persone':
      await personeView(view, params);
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
    case 'benvenuto': // sul telefono la Home è Alma Agorà (app 3.0, 20/11): la bacheca con la riga «Oggi»
      if (isMobile()) cleanup = agoraView(view, params);
      else await welcomeView(view);
      break;
    case 'cantieri': // storie dai cantieri (app 3.0): foto, diario, elenco (cantieri = commesse BOSS, BSAL-1725)
      if (!isMobile()) { clear(view).append(h('div.card.empty', h('p', 'Le foto e il diario dei cantieri per ora si usano dal telefono.'))); break; }
      if (parts[1] === 'foto') cleanup = (await fotoPage(view)) || null;
      else if (Number(parts[1])) cleanup = (await diarioPage(view, Number(parts[1]), params)) || null;
      else await cantieriPage(view);
      break;
    case 'compiti': // telefono: ticket, passi del CRM e RDA in una lista sola
      if (isMobile()) await compitiView(view, params); else location.replace('#/settimana');
      break;
    // i cinque posti dell'app sul telefono; sul computer portano alla pagina che c'era già
    case 'lavoro':
      if (isMobile()) await lavoroView(view, params); else location.replace('#/settimana');
      break;
    case 'inbox':
      if (isMobile()) await inboxView(view); else location.replace('#/notifications');
      break;
    case 'esplora':
      if (isMobile()) esploraView(view); else location.replace('#/benvenuto');
      break;
    case 'io':
      if (isMobile()) await ioView(view); else location.replace(`#/u/${store.me.id}`);
      break;
    case 'idee':
      await ideasView(view, parts, params);
      break;
    case 'org': // l'organigramma è una vista di Persone
      location.replace('#/persone?vista=organigramma');
      return;
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
    case 'hr': {
      if (!store.me?.hr_on) { location.replace('#/home'); break; } // Alma HR nascosto a tutti per ora
      const { hrView } = await import('./hr.js');
      await hrView(view, parts, params);
      break;
    }
    case 'strategy':
      await strategyView(view, parts);
      break;
    case 'crm':
      // telefono (app 3.0): CRM essenziale, scheda del contatto e scansione dei biglietti; il resto come sul computer
      if (isMobile() && !parts[1]) await crmHome(view, params);
      else if (isMobile() && parts[1] === 'persona' && Number(parts[2])) await contactPage3(view, Number(parts[2]));
      else if (isMobile() && parts[1] === 'scansiona') cleanup = (await scanPage(view, params)) || null;
      else if (parts[1] === 'persona') location.replace(`#/crm/contatti/${Number(parts[2]) || ''}`); // link del telefono aperto dal computer
      else if (parts[1] === 'scansiona') location.replace('#/crm/contatti/biglietti');
      else if (parts[1] === 'segnale') { // ALM2-94: link da Teams, email e avvisi; ?decidi=tieni|scarta = la scelta già fatta
        const id = Number(parts[2]) || 0;
        const decideOpt = params.get('decidi');
        location.replace('#/crm/radar');
        if (id) setTimeout(async () => (await import('./crm-radar.js')).openSignal(id, null, store.crmData || null, [], { decide: decideOpt }), 400);
      }
      else await crmView(view, parts);
      attachHelp(view); // «Come si usa»: il manuale della pagina (ALM2-72)
      break;
    case 'procurement': { // Alma Procurement (ALM2-81)
      const { procurementView } = await import('./procurement.js');
      await procurementView(view, parts);
      break;
    }
    case 'impianti': { // Alma Impianti (ALM2-73): Da fare, Radar per settore, Fondi, Progettisti
      const { impiantiView } = await import('./impianti.js');
      await impiantiView(view, parts);
      attachHelp(view); // «Come si usa»: il manuale 17 · Alma Impianti
      break;
    }
    case 'posta-voce': // Posta in macchina (ALM2-57): solo Dante, a voce con Alma
      cleanup = (await postaVocePage(view)) || null;
      break;
    case 'firma': // La mia firma nelle email (ALM2-64)
      await firmaView(view);
      break;
    case 'posta-mia': // La mia posta nel CRM: condivisione e risposte nuove (ALM2-67)
      await postaMiaView(view);
      break;
    case 'biglietto': // il mio biglietto da visita con QR (canvas CRM v10; sul telefono la versione dell'app 3.0)
      if (isMobile() && !params.get('modifica')) cleanup = (await mioBiglietto(view)) || null;
      else await mioBigliettoView(view);
      break;
    case 'impostazioni': // Impostazioni uniche (amministratori; Costi AI anche per chi ha «Costi AI: Tutto»)
      await renderImpostazioni(view, parts);
      break;
    case 'feedback': // «I miei feedback»: esito dei feedback su Alma Space (ALM2-56)
      cleanup = (await feedbackView(view)) || null;
      break;
    case 'alma': // Alma, l'assistente: chat e (amministratori) impostazioni
      cleanup = (await almaView(view, parts, params)) || null;
      break;
    default:
      clear(view).append(h('div.card.empty', 'Pagina non trovata.'));
  }
  view.focus({ preventScroll: true });
  trackRecent();
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
  const me = document.getElementById('me'); // in barra laterale non c'è più (profilo in alto, Dante 22/11)
  if (me) clear(me).append(avatar(store.me, 30), h('div', { style: { minWidth: 0 } }, h('div.me-name', store.me.name), h('div.me-mail', store.me.email)));
  for (const a of document.querySelectorAll('[data-nav="me"]')) a.href = `#/u/${store.me.id}`;
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
  setupAlma(); // tasto «Alma» in basso a destra: l'assistente da ogni pagina
  document.addEventListener('me-changed', drawMe);
  document.addEventListener('badges-changed', refreshBadges); // es. richiesta di un mezzo appena approvata
  document.getElementById('logout').addEventListener('click', async () => {
    await post('/auth/logout');
    location.href = '/';
  });
  document.getElementById('nav-feedback').addEventListener('click', () => openFeedback()); // feedback su Alma Space
  document.getElementById('create').addEventListener('click', () => openComposer({
    onCreated: () => { if (location.hash.replace(/^#\/?/, '') === '') route(); else location.hash = '#/'; },
  }));

  startLive();
  startPwa(); // app sul telefono: service worker per le notifiche, avviso «Aggiungi alla schermata Home» su iPhone
  for (const ev of ['notification', 'badges', 'message', 'read', 'rda']) onLive(ev, refreshBadges);
  // censimento software: amministratori e team IT (il server lo rifiuta comunque agli altri)
  // Alma IT: le voci del team IT solo per amministratori e team IT (il server lo rifiuta comunque agli altri)
  for (const el of document.querySelectorAll('[data-it-team]')) el.hidden = !store.me.software;
  // Alma Strategy: dashboard dei team e mansionario solo agli amministratori (il server lo rifiuta comunque agli altri)
  document.getElementById('nav-pm-mans').hidden = !store.me.is_admin;
  document.getElementById('nav-crm-asa').hidden = !store.me.is_admin; // CRM: ASA e accessi solo per la direzione
  document.getElementById('nav-crm-settings').hidden = !store.me.is_admin; // e le impostazioni del lavoro commerciale
  // «Proposte dal radar» non è più nel menu (19/11): l'ufficio gare lavora nel Radar, la pagina resta su #/crm/gare; // coda dell'ufficio gare (chi è dell'ufficio la trova in La mia settimana)
  document.getElementById('nav-crm-admin-label').hidden = !store.me.is_admin;
  // la dashboard dei team la vedono gli amministratori, il team HR e chi è responsabile di qualcuno
  document.getElementById('nav-pm-team').hidden = !store.me.is_admin;
  for (const el of document.querySelectorAll('.nav-hr-team')) el.hidden = !store.me.hr; // Alma HR: solo il team HR
  for (const el of document.querySelectorAll('.nav-hr-qhse')) el.hidden = !(store.me.hr || store.me.qhse); // formazione: HR e QHSE
  for (const el of document.querySelectorAll('.nav-onb')) el.hidden = !store.me.onboarding; // il mio inserimento
  for (const el of document.querySelectorAll('.nav-hr-dir')) el.hidden = !['hr', 'direzione', 'cfo'].includes(store.me.ruolo_hr); // revisione: HR, Direzione, CFO
  for (const el of document.querySelectorAll('.nav-hr-dirhr')) el.hidden = !['hr', 'direzione'].includes(store.me.ruolo_hr); // avanzamento del ciclo: HR e Direzione
  for (const el of document.querySelectorAll('.nav-onb-team')) el.hidden = store.me.hr || !store.me.onb_team; // responsabili e buddy con qualcuno in inserimento
  document.getElementById('nav-settings').hidden = false; // Impostazioni uniche: tutti (chi non è amministratore vede i Manuali d'uso, ALM2-72)
  if (!store.me.is_admin) get('/api/pm/flags', { quiet: true }).then(f => { document.getElementById('nav-pm-team').hidden = !(f?.manager || f?.hr); }).catch(() => {});
  refreshBadges();

  document.getElementById('back').addEventListener('click', goBack);
  window.addEventListener('hashchange', route);
  // aprendo l'app senza un indirizzo preciso si parte dalla pagina di benvenuto (la bacheca resta su #/)
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/benvenuto');
  route();
}

start();
