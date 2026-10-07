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
import { directView } from './direct.js';
import { homeView, openPost, openComposer } from './feed.js';
import { profileView } from './profile.js';
import { notificationsView } from './notifications.js';
import { startLive, onLive } from './live.js';
import { setupMobile } from './mobile.js';

const view = document.getElementById('view');
let cleanup = null;

// Cambiando pagina si chiudono le finestre aperte (es. da un post al profilo di chi ha commentato).
function closeOverlays() {
  const root = document.getElementById('overlay-root');
  for (let i = root.childElementCount; i > 0; i--) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || 'home';

  closeOverlays();
  const navKey = section === 'u' && Number(parts[1]) === store.me.id ? 'me' : section === 'p' ? 'home' : section;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
  document.body.classList.toggle('on-chat', section === 'chat');
  document.body.classList.toggle('on-direct', section === 'direct');
  document.title = section === 'direct' ? 'Chat · Alma Planner' : 'Alma Planner';
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
    case 'chat':
      if (!store.me.internal_chat) { clear(view).append(h('div.card.empty', 'Pagina non trovata.')); break; }
      cleanup = directView(view, parts[1] ? Number(parts[1]) : null);
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
    case 'org':
      await orgView(view, params);
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
  store.me = await get('/api/me');
  await Promise.all([loadUsers(), loadProjects()]);
  drawMe();
  setupMobile();
  document.addEventListener('me-changed', drawMe);
  document.getElementById('logout').addEventListener('click', async () => {
    await post('/auth/logout');
    location.href = '/';
  });
  document.getElementById('create').addEventListener('click', () => openComposer({
    onCreated: () => { if (location.hash.replace(/^#\/?/, '') === '') route(); else location.hash = '#/'; },
  }));

  startLive();
  for (const ev of ['notification', 'badges', 'message', 'read']) onLive(ev, refreshBadges);
  document.getElementById('nav-chat').hidden = !store.me.internal_chat;
  refreshBadges();

  window.addEventListener('hashchange', route);
  route();
}

start();
