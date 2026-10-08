// Ticket: lista, bacheca con trascinamento, scheda di dettaglio (drawer).
import { h, clear, modal, confirmDialog, toast, fmtDate, fmtDateTime, today, addDays, statusPill, projChip, avatar, loading, debounce, isMobile, STATUS, PRIORITY } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store, userById, activeProjects, projectById, loadProjects } from './store.js';
import { peoplePicker, avatarsFor } from './people.js';
import { pickDriveItem } from './drive.js';
import { uploadButton, fileRow } from './activities.js';
import { openChatWithEmails, openMailComposer } from './teams.js';
import { notesPanel } from './notes.js';
import { rdaTicketBox, rdaChip } from './rda.js';

const VIEW_KEY = 'alma.ticketView';
const savedView = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };
const saveView = v => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* niente */ } };

const isLate = t => t.due_date && t.status !== 'done' && t.due_date < today();

// ── vista elenco/bacheca ───────────────────────────────────────────────────
// opts: { title, subtitle, fixed: { assignee?, project? }, embedded }
export function ticketsView(container, opts = {}) {
  const fixed = opts.fixed || {};
  const mobile = isMobile(); // sul telefono: solo schede, stato scelto con i pulsanti tondi
  const state = {
    view: mobile ? 'list' : opts.view || savedView(),
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
  const statusSelect = h('select.select.st-select', { on: { change: e => { state.status = e.target.value; load(); } } },
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

  const toolbar = h('div.toolbar.tickets-tools', search,
    fixed.project === undefined ? projectSelect : null,
    fixed.assignee === undefined ? peopleSelect : null,
    statusSelect, h('span.grow'), viewSeg, newBtn);

  clear(container);
  if (opts.title) container.append(h('div.page-head', h('div', h('h1', opts.title), opts.subtitle ? h('div.sub', opts.subtitle) : null)));
  // telefono: Aperti / In corso / Fatti al posto del menu dello stato
  const pills = mobile ? h('div.m-pills', [['open', 'Aperti'], ['doing', 'In corso'], ['done', 'Fatti']].map(([k, l]) =>
    h('button.m-pill', { type: 'button', class: state.status === k ? 'on' : '', 'aria-pressed': String(state.status === k), on: { click: e => {
      state.status = k;
      for (const b of pills.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }
      load();
    } } }, l))) : null;
  container.append(...(mobile ? [pills, toolbar] : [toolbar]), body);

  async function load() {
    body.replaceChildren(loading());
    tickets = await get(`/api/tickets${qs({ q: state.q, project: state.project, assignee: state.assignee, status: state.view === 'board' ? '' : state.status })}`);
    render();
    opts.onLoaded?.(tickets);
  }

  function render() {
    clear(body);
    if (mobile) return body.append(mobileList(tickets, { onChange: load, hideProject: fixed.project !== undefined, done: state.status === 'done' }));
    if (state.view === 'board') return body.append(board(tickets, { onChange: load, hideProject: fixed.project !== undefined }));
    if (!tickets.length) return body.append(h('div.card.empty', 'Nessun ticket. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); newBtn.click(); } } }, 'Creane uno')));
    const sorted = [...tickets].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id);
    body.append(h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', h('th', 'Ticket'), fixed.project === undefined ? h('th', 'Progetto') : null, h('th', 'Assegnati'), h('th', 'Stato'), h('th', 'Priorità'), h('th', 'Scadenza'), h('th.t-trash-col', { 'aria-label': 'Cancella' }))),
      h('tbody', sorted.map(t => h('tr', { on: { click: () => openTicket(t.id, { onSaved: load }) } },
        h('td', h('div.t-title', t.title, rdaChip(t)), h('div.t-meta', `#${t.id}`, t.comment_count ? ` · 💬 ${t.comment_count}` : '', t.file_count ? ` · 📎 ${t.file_count}` : '')),
        fixed.project === undefined ? h('td', projChip(t.project_name, t.project_color)) : null,
        h('td', avatarsFor(t.assignee_ids)),
        h('td', statusPill(t.status)),
        h('td', h('span', { class: `pr-${t.priority}` }, PRIORITY[t.priority])),
        h('td', { class: isLate(t) ? 'due-late' : '' }, t.due_date ? fmtDate(t.due_date) : h('span.muted', '—')),
        h('td.t-trash-col', trashButton(t, load)),
      ))))));
  }

  load();
  return { reload: load };
}

// ── telefono: schede raggruppate per scadenza ──────────────────────────────
function dueGroup(t) {
  if (t.status === 'done') return 'Fatti';
  if (!t.due_date) return 'Senza scadenza';
  const d = today();
  if (t.due_date < d) return 'In ritardo';
  if (t.due_date === d) return 'Oggi';
  if (t.due_date <= addDays(d, 7)) return 'Prossimi 7 giorni';
  return 'Più avanti';
}
const GROUP_ORDER = ['In ritardo', 'Oggi', 'Prossimi 7 giorni', 'Più avanti', 'Senza scadenza', 'Fatti'];

function mobileList(tickets, { onChange, hideProject, done }) {
  if (!tickets.length) return h('div.m-empty', done ? 'Ancora nessun ticket fatto.' : 'Niente qui. Bel lavoro.');
  const sorted = [...tickets].sort((a, b) => done
    ? String(b.updated_at).localeCompare(String(a.updated_at))
    : (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id - b.id);
  const groups = new Map();
  for (const t of sorted) {
    const g = dueGroup(t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  return h('div', GROUP_ORDER.filter(g => groups.has(g)).map(g => h('section',
    h('h2.m-group', g), groups.get(g).map(t => ticketCard(t, { onChange, hideProject })))));
}

// Scheda di un ticket per il telefono: il cerchio lo segna come fatto (o lo riapre), il resto apre il dettaglio.
export function ticketCard(t, { onChange, hideProject = false, trash = true } = {}) {
  let isDone = t.status === 'done';
  const mark = h('span.m-check');
  const paint = () => {
    card.classList.toggle('done', isDone);
    mark.classList.toggle('on', isDone);
    mark.replaceChildren(...(isDone ? [checkIcon()] : []));
    btn.setAttribute('aria-label', isDone ? 'Riapri il ticket' : 'Segna come fatto');
  };
  const btn = h('button.m-check-btn', { type: 'button', on: { click: async e => {
    e.stopPropagation();
    isDone = !isDone;
    paint();
    try {
      await patch(`/api/tickets/${t.id}`, isDone ? { status: 'done' } : { status: 'todo' });
      toast(isDone ? 'Fatto ✓' : 'Ticket riaperto');
      setTimeout(() => onChange?.(), 700);
    } catch {
      isDone = !isDone;
      paint();
    }
  } } }, mark);
  const card = h('div.m-ticket', { on: { click: () => openTicket(t.id, { onSaved: onChange }) } },
    btn,
    h('div.grow',
      h('div.m-ticket-title', t.title),
      h('div.m-ticket-meta',
        rdaChip(t),
        !hideProject && t.project_name ? projChip(t.project_name, t.project_color) : null,
        t.status === 'doing' || t.status === 'review' ? statusPill(t.status) : null,
        t.due_date && t.status !== 'done' ? h('span.m-due', { class: isLate(t) ? 'late' : '' }, t.due_date === today() ? 'Oggi' : fmtDate(t.due_date)) : null)),
    avatarsFor(t.assignee_ids, 3),
    trash ? trashButton(t, onChange) : null);
  paint();
  return card;
}

// Il ticket lo cancella solo chi l'ha creato (senza autore: un amministratore), come controlla il server.
export const canDeleteTicket = t => t.created_by === store.me.id || (t.created_by == null && Boolean(store.me.is_admin));

// Cestino nell'elenco, nella bacheca e nelle schede del telefono: cancella il ticket senza aprirlo, dopo la conferma.
// Per gli altri non compare.
export function trashButton(t, onDone) {
  if (!canDeleteTicket(t)) return null;
  const stop = e => e.stopPropagation(); // non apre il ticket e non avvia il trascinamento
  return h('button.t-trash', {
    type: 'button', title: 'Cancella il ticket', 'aria-label': `Cancella il ticket «${t.title}»`, draggable: false,
    on: {
      mousedown: stop, pointerdown: stop, dragstart: e => { e.preventDefault(); stop(e); },
      click: async e => {
        stop(e);
        const extra = t.outlook_event_id ? ' Sparisce anche dal calendario Outlook.' : '';
        if (!await confirmDialog(`Cancellare il ticket «${t.title}»?${extra}`, { ok: 'Cancella', danger: true })) return;
        try {
          await del(`/api/tickets/${t.id}`);
          toast('Ticket cancellato');
          onDone?.();
        } catch { /* l'errore lo mostra già api() */ }
      },
    },
  }, trashIcon());
}

function trashIcon() {
  const tpl = document.createElement('template');
  tpl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  return tpl.content.firstChild;
}

function checkIcon() {
  const tpl = document.createElement('template');
  tpl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  return tpl.content.firstChild;
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
    h('div.tcard-top', h('div.t-title', t.title), trashButton(t, onChange)),
    t.project_name && !hideProject ? projChip(t.project_name, t.project_color) : null,
    rdaChip(t),
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
// requireSchedule: il ticket è un'attività del Gantt, quindi servono inizio, scadenza e almeno un responsabile.
export async function openTicket(id, { defaults = {}, onSaved, requireSchedule = false } = {}) {
  const isNew = !id;
  let t = isNew
    ? { title: '', description: '', status: 'todo', priority: 'normal', project_id: null, start_date: null, due_date: null, progress: 0, assignee_ids: [], depends_on: [], files: [], comments: [], ...defaults }
    : await get(`/api/tickets/${id}`);
  let changed = false;

  const title = h('input.title-input', { value: t.title, placeholder: requireSchedule ? 'Nome dell\'attività' : 'Titolo del ticket', autofocus: isNew });
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
  const people = peoplePicker({ selected: t.assignee_ids, label: requireSchedule ? '+ Responsabile' : '+ Assegna' });
  // RDA interna: riquadro con funzione, stato e ore; finché non è accettata niente stato, avanzamento o assegnatari
  const rda = isNew ? null : rdaTicketBox(t);
  const rdaOpen = Boolean(rda && !rda.accepted);
  status.addEventListener('change', () => {
    if (status.value === 'done') { progress.value = '100'; progressVal.textContent = '100%'; }
    // a ticket fatto le ore effettive partono da quelle confermate
    if (status.value === 'done' && rda?.actualInput && !rda.actualInput.value && t.hours_approved) rda.actualInput.value = String(Number(t.hours_approved));
  });
  if (rdaOpen) { status.disabled = true; progress.disabled = true; }

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
    rda ? rda.el : '',
    h('div.grid-2',
      h('label.field', h('span', 'Progetto'), project),
      h('label.field', h('span', 'Stato'), status),
      h('label.field', h('span', 'Inizio'), start),
      h('label.field', h('span', 'Scadenza'), due),
      h('label.field', h('span', 'Priorità'), priority),
      h('label.field', h('span', h('span', 'Avanzamento '), progressVal), progress)),
    rdaOpen ? '' : h('div.field', h('span', requireSchedule ? 'Responsabili' : 'Assegnato a'), people.el),
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
      ...(rda ? rda.values() : {}),
    };
    if (rdaOpen) { delete payload.status; delete payload.progress; delete payload.assignee_ids; }
    if (!payload.title.trim()) { toast('Scrivi un titolo', 'err'); title.focus(); return null; }
    if (requireSchedule && (!payload.start_date || !payload.due_date)) { toast('Un\'attività ha sempre inizio e fine', 'err'); return null; }
    if (requireSchedule && !payload.assignee_ids.length) { toast('Indica almeno un responsabile', 'err'); return null; }
    const saved = isNew ? await post('/api/tickets', payload) : await patch(`/api/tickets/${t.id}`, payload);
    changed = true;
    if (close) { m.close(); toast(isNew ? 'Ticket creato' : 'Ticket salvato'); }
    return saved;
  }

  const left = [];
  if (!isNew && canDeleteTicket(t)) {
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
    title: h('span.muted', isNew ? (requireSchedule ? `Nuova attività · ${projectById(t.project_id)?.name || ''}` : 'Nuovo ticket') : `Ticket #${t.id}`),
    body,
    left,
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => save() } }, isNew ? (requireSchedule ? 'Crea attività' : 'Crea ticket') : 'Salva'),
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

    // Scrivere agli assegnati: chat di Teams o email da Outlook, con il link al ticket
    const assignees = t.assignee_ids.map(userById).filter(u => u && u.id !== store.me.id);
    if (store.me.microsoft && assignees.length) {
      const link = `${location.origin}/app#/tickets/${t.id}`;
      outlook.append(h('div.row', { style: { marginTop: '8px' } },
        h('button.btn.btn-sm', { type: 'button', on: { click: () => openChatWithEmails(assignees.map(u => u.email)) } }, '💬 Chat con gli assegnati'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => openMailComposer({
          to: assignees.map(u => u.email),
          subject: `[Alma] ${t.title}`,
          text: `\n\n—\nTicket: ${t.title}\n${link}`,
        }) } }, '✉ Email agli assegnati')));
    }

    // File: caricati nella cartella OneDrive del progetto (sottocartella del ticket) o collegati da OneDrive
    const fileActions = h('div.row');
    if (store.me.microsoft) {
      if (t.project_id) fileActions.append(uploadButton(`/api/tickets/${t.id}/files/upload`, t.project_id, { onDone: () => { changed = true; refresh(); } }));
      fileActions.append(h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        const project = projectById(t.project_id);
        const start = project?.onedrive_item_id ? { driveId: project.onedrive_drive_id, id: project.onedrive_item_id, name: project.onedrive_name } : null;
        const item = await pickDriveItem({ title: 'Collega un file al ticket', start });
        if (!item) return;
        await post(`/api/tickets/${t.id}/files`, { drive_id: item.driveId, item_id: item.id, name: item.name, web_url: item.webUrl });
        changed = true;
        refresh();
      } } }, '🔗 Collega da OneDrive'));
    }
    const files = h('div.section', h('div.spread', h('h3', `File${t.files.length ? ` (${t.files.length})` : ''}`), fileActions));
    if (!t.files.length) files.append(h('div.muted.small', t.project_id ? 'Nessun file. Quelli caricati vanno nella cartella OneDrive del progetto.' : 'Nessun file collegato.'));
    for (const f of t.files) {
      files.append(fileRow(f, { onRemove: async () => { await del(`/api/tickets/${t.id}/files/${f.id}`); changed = true; refresh(); } }));
    }

    // Note con data (come nel CRM)
    const notesBox = h('div.section');
    notesPanel(notesBox, { url: `/api/tickets/${t.id}/notes` });

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

    extra.append(outlook, files, notesBox, comments,
      h('div.muted.small.section', `Creato il ${fmtDateTime(t.created_at)} · aggiornato il ${fmtDateTime(t.updated_at)}`));
  }
}
