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

const view = document.getElementById('view');
let cleanup = null;

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || 'mine';

  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === section));
  cleanup?.();
  cleanup = null;
  clear(view).append(loading());

  switch (section) {
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
      const c = calendarView(view);
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

async function start() {
  store.me = await get('/api/me');
  await Promise.all([loadUsers(), loadProjects()]);
  document.getElementById('me').append(avatar(store.me, 30), h('div', { style: { minWidth: 0 } }, h('div.me-name', store.me.name), h('div.me-mail', store.me.email)));
  document.getElementById('logout').addEventListener('click', async () => {
    await post('/auth/logout');
    location.href = '/';
  });
  window.addEventListener('hashchange', route);
  route();
}

start();
