// Ticket: lista, bacheca con trascinamento, scheda di dettaglio (drawer).
import { h, clear, modal, confirmDialog, toast, fmtDate, fmtDateTime, today, statusPill, projChip, avatar, loading, debounce, STATUS, PRIORITY } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store, userById, activeProjects, projectById, loadProjects } from './store.js';
import { peoplePicker, avatarsFor } from './people.js';
import { pickDriveItem } from './drive.js';

const VIEW_KEY = 'alma.ticketView';
const savedView = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };
const saveView = v => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* niente */ } };

const isLate = t => t.due_date && t.status !== 'done' && t.due_date < today();

// ── vista elenco/bacheca ───────────────────────────────────────────────────
// opts: { title, subtitle, fixed: { assignee?, project? }, embedded }
export function ticketsView(container, opts = {}) {
  const fixed = opts.fixed || {};
  const state = {
    view: opts.view || savedView(),
    q: '',
    project: fixed.project ?? '',
    assignee: fixed.assignee ?? '',
    status: opts.defaultStatus ?? 'open',
  };
  let tickets = [];
  const body = h('div');

  const projectSelect = h('select.select', { on: { change: e => { state.project = e.target.value; load(); } } },
    h('option', { value: '' }, 'Tutti i progetti'),
    h('option', { value: 'none' }, 'Senza progetto'),
    activeProjects().map(p => h('option', { value: String(p.id) }, p.name)));
  const peopleSelect = h('select.select', { on: { change: e => { state.assignee = e.target.value; load(); } } },
    h('option', { value: '' }, 'Tutte le persone'),
    h('option', { value: 'me' }, 'Assegnati a me'),
    h('option', { value: 'none' }, 'Non assegnati'),
    store.users.map(u => h('option', { value: String(u.id) }, u.name)));
  const statusSelect = h('select.select', { on: { change: e => { state.status = e.target.value; load(); } } },
    h('option', { value: 'open', selected: state.status === 'open' }, 'Aperti'),
    h('option', { value: '', selected: state.status === '' }, 'Tutti gli stati'),
    Object.entries(STATUS).map(([k, l]) => h('option', { value: k }, l)));
  const viewSeg = h('div.seg',
    ['list', 'board'].map(v => h('button', { type: 'button', class: state.view === v ? 'on' : '', on: { click: () => {
      state.view = v; saveView(v);
      viewSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
      statusSelect.hidden = v === 'board';
      if (v === 'board' && state.status === 'open') state.status = '';
      load();
    } }, 'data-v': v }, v === 'list' ? 'Lista' : 'Bacheca')));
  statusSelect.hidden = state.view === 'board';
  if (state.view === 'board' && state.status === 'open') state.status = '';

  const search = h('input.input', { type: 'search', placeholder: 'Cerca…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } });
  const newBtn = h('button.btn.btn-primary', { type: 'button', on: { click: () => openTicket(null, {
    defaults: { project_id: fixed.project ? Number(fixed.project) : null, assignee_ids: fixed.assignee === 'me' || !fixed.project ? [store.me.id] : [] },
    onSaved: load,
  }) } }, '+ Nuovo ticket');

  const toolbar = h('div.toolbar', search,
    fixed.project === undefined ? projectSelect : null,
    fixed.assignee === undefined ? peopleSelect : null,
    statusSelect, h('span.grow'), viewSeg, newBtn);

  clear(container);
  if (opts.title) container.append(h('div.page-head', h('div', h('h1', opts.title), opts.subtitle ? h('div.sub', opts.subtitle) : null)));
  container.append(toolbar, body);

  async function load() {
    body.replaceChildren(loading());
    tickets = await get(`/api/tickets${qs({ q: state.q, project: state.project, assignee: state.assignee, status: state.view === 'board' ? '' : state.status })}`);
    render();
    opts.onLoaded?.(tickets);
  }

  function render() {
    clear(body);
    if (state.view === 'board') return body.append(board(tickets, { onChange: load, hideProject: fixed.project !== undefined }));
    if (!tickets.length) return body.append(h('div.card.empty', 'Nessun ticket. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); newBtn.click(); } } }, 'Creane uno')));
    const sorted = [...tickets].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id);
    body.append(h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', h('th', 'Ticket'), fixed.project === undefined ? h('th', 'Progetto') : null, h('th', 'Assegnati'), h('th', 'Stato'), h('th', 'Priorità'), h('th', 'Scadenza'))),
      h('tbody', sorted.map(t => h('tr', { on: { click: () => openTicket(t.id, { onSaved: load }) } },
        h('td', h('div.t-title', t.title), h('div.t-meta', `#${t.id}`, t.comment_count ? ` · 💬 ${t.comment_count}` : '', t.file_count ? ` · 📎 ${t.file_count}` : '')),
        fixed.project === undefined ? h('td', projChip(t.project_name, t.project_color)) : null,
        h('td', avatarsFor(t.assignee_ids)),
        h('td', statusPill(t.status)),
        h('td', h('span', { class: `pr-${t.priority}` }, PRIORITY[t.priority])),
        h('td', { class: isLate(t) ? 'due-late' : '' }, t.due_date ? fmtDate(t.due_date) : h('span.muted', '—')),
      ))))));
  }

  load();
  return { reload: load };
}

// Bacheca a colonne: trascinando una scheda cambia stato e ordine.
function board(tickets, { onChange, hideProject }) {
  const cols = {};
  const root = h('div.board');
  let dragged = null;

  for (const [status, label] of Object.entries(STATUS)) {
    const list = tickets.filter(t => t.status === status).sort((a, b) => a.position - b.position);
    const col = h('div.col', { 'data-status': status },
      h('div.col-head', h('span', label), h('span.muted', String(list.length))),
      list.map(card));
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('drop');
      const after = cardAfter(col, e.clientY);
      const el = root.querySelector('.dragging');
      if (!el) return;
      if (after) col.insertBefore(el, after); else col.append(el);
    });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drop');
      if (!dragged) return;
      const cards = [...col.querySelectorAll('.tcard')];
      const i = cards.findIndex(c => Number(c.dataset.id) === dragged.id);
      const prev = cards[i - 1] && tickets.find(t => t.id === Number(cards[i - 1].dataset.id));
      const next = cards[i + 1] && tickets.find(t => t.id === Number(cards[i + 1].dataset.id));
      const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : dragged.position;
      const change = { position };
      if (dragged.status !== status) change.status = status;
      try { await patch(`/api/tickets/${dragged.id}`, change); } finally { onChange(); }
    });
    cols[status] = col;
    root.append(col);
  }

  function card(t) {
    const el = h('div.tcard', { draggable: 'true', 'data-id': String(t.id), on: {
      click: () => openTicket(t.id, { onSaved: onChange }),
      dragstart: e => { dragged = t; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); },
      dragend: () => { el.classList.remove('dragging'); },
    } },
    h('div.t-title', t.title),
    t.project_name && !hideProject ? projChip(t.project_name, t.project_color) : null,
    h('div.tcard-foot', avatarsFor(t.assignee_ids, 3),
      h('span', { class: isLate(t) ? 'due-late' : `pr-${t.priority}` },
        t.priority === 'urgent' || t.priority === 'high' ? `${PRIORITY[t.priority]} · ` : '',
        t.due_date ? fmtDate(t.due_date) : '')));
    return el;
  }

  function cardAfter(col, y) {
    return [...col.querySelectorAll('.tcard:not(.dragging)')].find(c => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
  }
  return root;
}

// ── scheda del ticket ──────────────────────────────────────────────────────
export async function openTicket(id, { defaults = {}, onSaved } = {}) {
  const isNew = !id;
  let t = isNew
    ? { title: '', description: '', status: 'todo', priority: 'normal', project_id: null, start_date: null, due_date: null, progress: 0, assignee_ids: [], depends_on: [], files: [], comments: [], ...defaults }
    : await get(`/api/tickets/${id}`);
  let changed = false;

  const title = h('input.title-input', { value: t.title, placeholder: 'Titolo del ticket', autofocus: isNew });
  const desc = h('textarea.input', { placeholder: 'Descrizione, note, link…', rows: 5 }, t.description);
  const project = h('select.select', h('option', { value: '' }, 'Nessun progetto'),
    store.projects.filter(p => p.status !== 'archived' || p.id === t.project_id)
      .map(p => h('option', { value: String(p.id), selected: p.id === t.project_id }, p.name)));
  const status = h('select.select', Object.entries(STATUS).map(([k, l]) => h('option', { value: k, selected: k === t.status }, l)));
  const priority = h('select.select', Object.entries(PRIORITY).map(([k, l]) => h('option', { value: k, selected: k === t.priority }, l)));
  const start = h('input.input', { type: 'date', value: t.start_date || '' });
  const due = h('input.input', { type: 'date', value: t.due_date || '' });
  const progressVal = h('span.muted', `${t.progress}%`);
  const progress = h('input.range', { type: 'range', min: '0', max: '100', step: '5', value: String(t.progress), on: { input: e => { progressVal.textContent = `${e.target.value}%`; } } });
  const people = peoplePicker({ selected: t.assignee_ids, label: '+ Assegna' });
  status.addEventListener('change', () => { if (status.value === 'done') { progress.value = '100'; progressVal.textContent = '100%'; } });

  // dipendenze: altri ticket dello stesso progetto (o tutti se senza progetto)
  const depsBox = h('div.people');
  let deps = [...t.depends_on];
  let candidates = [];
  async function loadCandidates() {
    const pid = project.value;
    candidates = (await get(`/api/tickets${qs({ project: pid || undefined })}`)).filter(x => x.id !== t.id);
    drawDeps();
  }
  function drawDeps() {
    clear(depsBox);
    for (const d of deps) {
      const c = candidates.find(x => x.id === d);
      depsBox.append(h('span.person-chip', { style: { paddingLeft: '8px' } }, c ? c.title : `#${d}`,
        h('button', { type: 'button', on: { click: () => { deps = deps.filter(x => x !== d); drawDeps(); } } }, '×')));
    }
    const sel = h('select.select', { on: { change: e => { if (e.target.value) { deps.push(Number(e.target.value)); drawDeps(); } } } },
      h('option', { value: '' }, '+ Dipende da…'),
      candidates.filter(c => !deps.includes(c.id)).map(c => h('option', { value: String(c.id) }, `#${c.id} ${c.title}`)));
    depsBox.append(sel);
  }
  project.addEventListener('change', loadCandidates);

  const form = [
    title,
    h('div.grid-2',
      h('label.field', h('span', 'Progetto'), project),
      h('label.field', h('span', 'Stato'), status),
      h('label.field', h('span', 'Inizio'), start),
      h('label.field', h('span', 'Scadenza'), due),
      h('label.field', h('span', 'Priorità'), priority),
      h('label.field', h('span', h('span', 'Avanzamento '), progressVal), progress)),
    h('div.field', h('span', 'Assegnato a'), people.el),
    h('label.field', h('span', 'Descrizione'), desc),
    h('div.field', h('span', 'Dipende da (per il Gantt)'), depsBox),
  ];

  const extra = h('div');
  const body = [...form, extra];

  async function save({ close = true } = {}) {
    const payload = {
      title: title.value,
      description: desc.value,
      project_id: project.value ? Number(project.value) : null,
      status: status.value,
      priority: priority.value,
      start_date: start.value || null,
      due_date: due.value || null,
      progress: Number(progress.value),
      assignee_ids: people.value,
      depends_on: deps,
    };
    if (!payload.title.trim()) { toast('Scrivi un titolo', 'err'); title.focus(); return null; }
    const saved = isNew ? await post('/api/tickets', payload) : await patch(`/api/tickets/${t.id}`, payload);
    changed = true;
    if (close) { m.close(); toast(isNew ? 'Ticket creato' : 'Ticket salvato'); }
    return saved;
  }

  const left = [];
  if (!isNew) {
    left.push(h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare il ticket «${t.title}»?`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/tickets/${t.id}`);
      changed = true;
      m.close();
      toast('Ticket cancellato');
    } } }, 'Cancella'));
  }

  const m = modal({
    drawer: true,
    title: h('span.muted', isNew ? 'Nuovo ticket' : `Ticket #${t.id}`),
    body,
    left,
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => save() } }, isNew ? 'Crea ticket' : 'Salva'),
    ],
    onClose: () => {
      if (!isNew && location.hash.startsWith(`#/tickets/${t.id}`)) history.replaceState(null, '', '#/tickets');
      if (changed) { onSaved?.(); loadProjects().catch(() => {}); }
    },
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  loadCandidates();

  if (!isNew) renderExtra();

  async function refresh() {
    t = await get(`/api/tickets/${t.id}`);
    renderExtra();
  }

  function renderExtra() {
    clear(extra);
    // Outlook
    const outlook = h('div.section', h('div.spread', h('h3', 'Calendario Outlook')));
    if (store.me.microsoft) {
      const invite = h('input', { type: 'checkbox' });
      const row = h('div.row');
      if (t.outlook_event_id) {
        row.append(h('span.pill.st-done', '✓ In calendario', t.outlook_event_owner !== store.me.id ? ` di ${userById(t.outlook_event_owner)?.name || 'un collega'}` : ''),
          h('span.muted.small', 'Si aggiorna da solo quando cambi le date.'));
        if (t.outlook_event_owner === store.me.id) {
          row.append(h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await del(`/api/tickets/${t.id}/outlook`); changed = true; toast('Tolto dal calendario'); refresh(); } } }, 'Togli'));
        }
      } else {
        row.append(
          h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
            const saved = await save({ close: false });
            if (!saved) return;
            const r = await post(`/api/tickets/${t.id}/outlook`, { invite: invite.checked });
            toast('Aggiunto al calendario Outlook');
            if (r.webLink) window.open(r.webLink, '_blank', 'noopener');
            refresh();
          } } }, '📅 Aggiungi al mio calendario'),
          h('label.check.small', invite, 'invita gli assegnati'));
      }
      outlook.append(row);
    } else {
      outlook.append(h('div.muted.small', 'Outlook non è ancora collegato.'));
    }

    // File
    const files = h('div.section', h('div.spread', h('h3', `File OneDrive${t.files.length ? ` (${t.files.length})` : ''}`),
      store.me.microsoft ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        const project = projectById(t.project_id);
        const start = project?.onedrive_item_id ? { driveId: project.onedrive_drive_id, id: project.onedrive_item_id, name: project.onedrive_name } : null;
        const item = await pickDriveItem({ title: 'Collega un file al ticket', start });
        if (!item) return;
        await post(`/api/tickets/${t.id}/files`, { drive_id: item.driveId, item_id: item.id, name: item.name, web_url: item.webUrl });
        changed = true;
        refresh();
      } } }, '+ Collega file') : null));
    if (!t.files.length) files.append(h('div.muted.small', 'Nessun file collegato.'));
    for (const f of t.files) {
      files.append(h('div.file-row', h('span', f.name.match(/\.(xlsx?|csv)$/i) ? '📊' : f.name.match(/\.(docx?|pdf)$/i) ? '📄' : '📎'),
        h('a', { href: f.web_url || '#', target: '_blank', rel: 'noopener' }, f.name),
        h('span.muted.small', f.added_by_name || ''),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Scollega', on: { click: async () => { await del(`/api/tickets/${t.id}/files/${f.id}`); changed = true; refresh(); } } }, '×')));
    }

    // Commenti
    const text = h('textarea.input', { rows: 2, placeholder: 'Scrivi un commento…', style: { minHeight: '60px' } });
    const comments = h('div.section', h('div.spread', h('h3', `Commenti${t.comments.length ? ` (${t.comments.length})` : ''}`)),
      h('div.comments', t.comments.map(c => h('div.comment', avatar(userById(c.user_id) || { name: c.user_name || '?' }),
        h('div', h('div.comment-head', h('strong', c.user_name || 'Utente'), h('span', fmtDateTime(c.created_at)),
          c.user_id === store.me.id ? h('a', { href: '#', on: { click: async e => { e.preventDefault(); await del(`/api/tickets/${t.id}/comments/${c.id}`); refresh(); } } }, 'cancella') : null),
        h('div.comment-body', c.body))))),
      h('div.field', { style: { marginTop: '10px' } }, text,
        h('div', h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
          if (!text.value.trim()) return;
          await post(`/api/tickets/${t.id}/comments`, { body: text.value });
          changed = true;
          refresh();
        } } }, 'Commenta'))));

    extra.append(outlook, files, comments,
      h('div.muted.small.section', `Creato il ${fmtDateTime(t.created_at)} · aggiornato il ${fmtDateTime(t.updated_at)}`));
  }
}
