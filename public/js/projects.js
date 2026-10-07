// Progetti: griglia, scheda del progetto (ticket, cartella OneDrive), creazione e modifica.
import { h, clear, modal, confirmDialog, toast, fmtDate, avatar, loading, PROJECT_STATUS, PROJECT_COLORS } from './ui.js';
import { post, patch, del } from './api.js';
import { store, loadProjects, projectById, userById } from './store.js';
import { ticketsView } from './tickets.js';
import { driveBrowser, pickDriveItem } from './drive.js';
import { ganttView } from './gantt.js';

const dates = p => {
  const s = p.start_date || p.tickets_start, e = p.end_date || p.tickets_end;
  if (!s && !e) return 'Senza date';
  return `${fmtDate(s) || '…'} → ${fmtDate(e) || '…'}`;
};
const pct = p => (p.ticket_count ? Math.round((p.done_count / p.ticket_count) * 100) : 0);

export async function projectsView(container) {
  clear(container).append(loading());
  await loadProjects();
  let showArchived = false;

  const grid = h('div.proj-grid');
  const archivedToggle = h('label.check', h('input', { type: 'checkbox', on: { change: e => { showArchived = e.target.checked; draw(); } } }), 'Mostra archiviati');
  clear(container).append(
    h('div.page-head', h('div', h('h1', 'Progetti'), h('div.sub', 'Ogni progetto raccoglie i suoi ticket, la cartella OneDrive e le date per il Gantt.')),
      h('div.row', archivedToggle, h('button.btn.btn-primary', { type: 'button', on: { click: () => editProject(null, async p => { location.hash = `#/projects/${p.id}`; }) } }, '+ Nuovo progetto'))),
    grid);

  function draw() {
    clear(grid);
    const list = store.projects.filter(p => showArchived || p.status !== 'archived');
    if (!list.length) return grid.append(h('div.card.empty', { style: { gridColumn: '1/-1' } }, 'Ancora nessun progetto.'));
    for (const p of list) {
      const owner = userById(p.owner_id);
      grid.append(h('div.card.proj-card', { style: { '--c': p.color }, on: { click: () => { location.hash = `#/projects/${p.id}`; } } },
        h('div.spread', h('h2', p.name), h('span.pill', PROJECT_STATUS[p.status])),
        p.description ? h('p', p.description) : null,
        h('div', h('div.spread.small.muted', { style: { marginBottom: '5px' } }, h('span', `${p.done_count}/${p.ticket_count} ticket fatti`), h('span', `${pct(p)}%`)),
          h('div.progress', h('i', { style: { width: `${pct(p)}%` } }))),
        h('div.spread.small.muted', h('span', dates(p)), owner ? h('span.row', avatar(owner, 22), owner.name) : null)));
    }
  }
  draw();
}

export async function projectDetail(container, id) {
  clear(container).append(loading());
  await loadProjects();
  const p = projectById(id);
  if (!p) return clear(container).append(h('div.card.empty', 'Progetto non trovato. ', h('a', { href: '#/projects' }, 'Torna ai progetti')));
  const owner = userById(p.owner_id);

  const ticketsBox = h('div');
  const ganttBox = h('div');
  const driveBox = h('div');

  clear(container).append(
    h('div.page-head',
      h('div', h('div.small', h('a', { href: '#/projects', class: 'muted' }, '← Progetti')),
        h('h1.row', h('span', { style: { width: '14px', height: '14px', borderRadius: '4px', background: p.color, display: 'inline-block' } }), p.name),
        h('div.sub', [PROJECT_STATUS[p.status], dates(p), owner ? `Responsabile: ${owner.name}` : null].filter(Boolean).join(' · '))),
      h('div.row',
        h('button.btn', { type: 'button', on: { click: () => editProject(p, () => projectDetail(container, id)) } }, 'Modifica'))),
    p.description ? h('p', { style: { marginTop: 0, color: 'var(--mid)', whiteSpace: 'pre-wrap', maxWidth: '760px' } }, p.description) : null,
    h('div.card', { style: { padding: '12px 14px', maxWidth: '520px', '--c': p.color } },
      h('div.spread.small.muted', { style: { marginBottom: '6px' } }, h('span', `${p.done_count} di ${p.ticket_count} ticket fatti`), h('span', `${pct(p)}%`)),
      h('div.progress', h('i', { style: { width: `${pct(p)}%` } }))),
    h('div.section', h('div.spread', h('h2', 'Ticket')), ticketsBox),
    h('div.section', h('div.spread', h('h2', 'Gantt del progetto')), ganttBox),
    h('div.section', h('div.spread', h('h2', 'Cartella OneDrive'),
      store.me.microsoft ? h('button.btn.btn-sm', { type: 'button', on: { click: linkFolder } }, p.onedrive_item_id ? 'Cambia cartella' : 'Collega una cartella') : null),
    driveBox));

  // il Gantt si ridisegna quando cambiano i ticket (nuovi, spostati, chiusi)
  const drawGantt = () => ganttView(ganttBox, new URLSearchParams({ project: String(p.id) }), { embedded: true });
  let firstLoad = true;
  ticketsView(ticketsBox, { fixed: { project: String(p.id) }, view: 'board', onLoaded: () => { if (!firstLoad) drawGantt(); firstLoad = false; } });
  drawGantt();

  if (!store.me.microsoft) driveBox.append(h('div.card.empty', 'OneDrive non è ancora collegato.'));
  else if (!p.onedrive_item_id) driveBox.append(h('div.card.empty', 'Nessuna cartella collegata. Collegane una per avere qui i documenti del progetto.'));
  else {
    driveBox.append(h('div.small.muted', { style: { marginBottom: '8px' } }, h('a', { href: p.onedrive_url, target: '_blank', rel: 'noopener' }, `Apri «${p.onedrive_name}» in OneDrive ↗`)));
    const inner = h('div');
    driveBox.append(inner);
    driveBrowser(inner, { root: { driveId: p.onedrive_drive_id, id: p.onedrive_item_id, name: p.onedrive_name }, tabs: false });
  }

  async function linkFolder() {
    const folder = await pickDriveItem({ title: 'Scegli la cartella del progetto', folders: true });
    if (!folder) return;
    await patch(`/api/projects/${p.id}`, { onedrive_drive_id: folder.driveId, onedrive_item_id: folder.id, onedrive_name: folder.name, onedrive_url: folder.webUrl || null });
    toast('Cartella collegata');
    projectDetail(container, id);
  }
}

export function editProject(p, onSaved) {
  const isNew = !p;
  p = p || { name: '', description: '', color: PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length], status: 'active', start_date: null, end_date: null, owner_id: store.me.id };
  let color = p.color;
  const name = h('input.input', { value: p.name, autofocus: true, placeholder: 'Es. Sito nuovo Almacis' });
  const desc = h('textarea.input', { rows: 3 }, p.description);
  const status = h('select.select', Object.entries(PROJECT_STATUS).map(([k, l]) => h('option', { value: k, selected: k === p.status }, l)));
  const owner = h('select.select', h('option', { value: '' }, '—'), store.users.map(u => h('option', { value: String(u.id), selected: u.id === p.owner_id }, u.name)));
  const start = h('input.input', { type: 'date', value: p.start_date || '' });
  const end = h('input.input', { type: 'date', value: p.end_date || '' });
  const swatches = h('div.swatches', PROJECT_COLORS.map(c => h('button.swatch', { type: 'button', title: c, class: c === color ? 'on' : '', style: { background: c }, on: { click: e => {
    color = c; swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); e.currentTarget.classList.add('on');
  } } })));

  const left = isNew ? [] : [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
    if (!await confirmDialog(`Cancellare il progetto «${p.name}»? I suoi ticket restano, senza progetto.`, { ok: 'Cancella', danger: true })) return;
    await del(`/api/projects/${p.id}`);
    m.close();
    await loadProjects();
    toast('Progetto cancellato');
    location.hash = '#/projects';
  } } }, 'Cancella')];

  const m = modal({
    title: isNew ? 'Nuovo progetto' : 'Modifica progetto',
    body: [
      h('label.field', h('span', 'Nome'), name),
      h('label.field', h('span', 'Descrizione'), desc),
      h('div.grid-2',
        h('label.field', h('span', 'Inizio'), start),
        h('label.field', h('span', 'Fine'), end),
        h('label.field', h('span', 'Stato'), status),
        h('label.field', h('span', 'Responsabile'), owner)),
      h('div.field', h('span', 'Colore'), swatches),
      h('div.muted.small', 'Senza date, il Gantt usa quelle dei ticket del progetto.'),
    ],
    left,
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: save } }, isNew ? 'Crea progetto' : 'Salva'),
    ],
  });

  async function save() {
    if (!name.value.trim()) { toast('Scrivi un nome', 'err'); return; }
    const payload = {
      name: name.value, description: desc.value, color, status: status.value,
      owner_id: owner.value ? Number(owner.value) : null,
      start_date: start.value || null, end_date: end.value || null,
    };
    const r = isNew ? await post('/api/projects', payload) : await patch(`/api/projects/${p.id}`, payload);
    m.close();
    await loadProjects();
    toast(isNew ? 'Progetto creato' : 'Progetto salvato');
    onSaved?.({ id: isNew ? r.id : p.id });
  }
}
