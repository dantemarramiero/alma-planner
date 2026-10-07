// Gantt. Le righe sono le attività, cioè i ticket del progetto con date: «Fatto» sul ticket = attività completata.
// - Gantt di un progetto (?project=id): il progetto è solo il titolo, le barre sono le sue attività.
// - Gantt generale: una barra per progetto lunga quanto le sue attività (non si sposta a mano);
//   aprendo un progetto compaiono le sue attività sotto.
// Trascinare/allungare una barra cambia le date del ticket; la maniglia cambia l'avanzamento.
import { h, clear, toast, loading, fmtDate, addDays, toISODate, STATUS } from './ui.js';
import { get, patch } from './api.js';
import { store, loadProjects, userById, projectById } from './store.js';
import { openTicket } from './tickets.js';
import { newActivity } from './activities.js';

const OPEN_KEY = 'alma.ganttOpen';
const MODE_KEY = 'alma.ganttMode';
const MODES = [['Day', 'Giorni'], ['Week', 'Settimane'], ['Month', 'Mesi']];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readStore = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ } };
const firstNames = ids => ids.map(id => userById(id)?.name.split(' ')[0]).filter(Boolean).join(', ');

// opts.embedded: Gantt di un progetto dentro la sua pagina (senza intestazione);
// opts.onChange: chiamata quando le attività vengono cambiate dal Gantt (non quando lo ricarica qualcun altro).
export async function ganttView(container, params, { embedded = false, onChange } = {}) {
  const onlyProject = params.get('project') ? Number(params.get('project')) : null;
  let open = new Set(readStore(OPEN_KEY, []));
  let mode = readStore(MODE_KEY, 'Week');
  let hideDone = false; // le completate restano visibili (sbiadite, con ✓) se non si sceglie di nasconderle
  let showLoose = false;
  let tickets = [];
  let gantt = null;

  const chartBox = h('div.card.gantt-card');
  const undatedBox = h('div.undated');
  const styleEl = h('style');

  const modeSeg = h('div.seg', MODES.map(([k, l]) => h('button', { type: 'button', 'data-k': k, class: k === mode ? 'on' : '', on: { click: () => {
    mode = k; writeStore(MODE_KEY, k);
    modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    draw();
  } } }, l)));

  const expandAll = h('button.btn', { type: 'button', on: { click: () => {
    const ids = visibleProjects().map(p => p.id);
    open = ids.every(id => open.has(id)) ? new Set() : new Set(ids);
    writeStore(OPEN_KEY, [...open]);
    draw();
  } } }, 'Apri/chiudi tutte le attività');

  const projectSelect = h('select.select', { 'aria-label': 'Progetto', on: { change: e => {
    location.hash = e.target.value ? `#/gantt?project=${e.target.value}` : '#/gantt';
  } } },
  h('option', { value: '' }, 'Tutti i progetti'),
  store.projects.filter(p => p.status !== 'archived' || p.id === onlyProject)
    .map(p => h('option', { value: String(p.id), selected: p.id === onlyProject }, p.name)));

  const newActivityBtn = onlyProject
    ? h('button.btn.btn-primary', { type: 'button', on: { click: () => newActivity(onlyProject, { onSaved: refresh }) } }, '+ Attività')
    : null;
  const project = onlyProject ? projectById(onlyProject) : null;

  clear(container).append(...[
    embedded ? null : h('div.page-head',
      h('div', h('h1', project ? project.name : 'Gantt'), h('div.sub', onlyProject
        ? 'Ogni attività è un ticket del progetto: quando lo metti in «Fatto» l\'attività è completata. Trascina le barre per spostare le date.'
        : 'Ogni barra è un progetto, lunga quanto le sue attività. Clicca un progetto per aprire il suo Gantt.')),
      projectSelect),
    h('div.toolbar', modeSeg, onlyProject ? null : expandAll,
      h('label.check', h('input', { type: 'checkbox', on: { change: e => { hideDone = e.target.checked; draw(); } } }), 'Nascondi completate'),
      onlyProject ? null : h('label.check', h('input', { type: 'checkbox', on: { change: e => { showLoose = e.target.checked; draw(); } } }), 'Ticket senza progetto'),
      h('span.grow'),
      embedded ? h('a.btn.btn-sm', { href: `#/gantt?project=${onlyProject}` }, 'Apri a tutta pagina') : null,
      newActivityBtn),
    styleEl, chartBox, undatedBox,
    h('div.gantt-legend',
      onlyProject ? null : h('span', '▬ barra piena: progetto'),
      h('span', '▭ attività (ticket)'), h('span', '░ sbiadita: completata'), h('span', '→ dipendenze')),
  ].filter(Boolean));

  chartBox.append(loading());
  await reload();

  function visibleProjects() {
    return store.projects.filter(p => (onlyProject ? p.id === onlyProject : p.status === 'active' || p.status === 'paused'));
  }

  function ticketRow(t, group) {
    return {
      id: `t-${t.id}`,
      name: esc(`${t.status === 'done' ? '✓ ' : ''}${t.title}${t.assignee_ids.length ? ` · ${firstNames(t.assignee_ids)}` : ''}`),
      start: t.start_date || t.due_date, end: t.due_date || t.start_date,
      progress: t.progress, dependencies: '',
      custom_class: `gt-${group}${t.status === 'done' ? '-done' : ''}`, // un solo nome di classe: Frappe non ne accetta di più
      _ticket: t,
    };
  }

  // attività di un progetto (i suoi ticket con date), in ordine di inizio
  function projectItems(pid) {
    return tickets.filter(t => t.project_id === pid && (t.start_date || t.due_date) && (!hideDone || t.status !== 'done'))
      .map(t => ticketRow(t, pid))
      .sort((x, y) => x.start.localeCompare(y.start) || x.end.localeCompare(y.end));
  }

  function build() {
    const rows = [];
    const css = [];
    for (const p of visibleProjects()) {
      css.push(`.gantt :is(.gt-${p.id},.gt-${p.id}-done) .bar{fill:${p.color}2e;stroke:${p.color}88;stroke-width:1}`,
        `.gantt :is(.gt-${p.id},.gt-${p.id}-done) .bar-progress{fill:${p.color}99}`);
      const items = projectItems(p.id);
      if (onlyProject) { rows.push(...items); continue; }
      // vista generale: barra del progetto = arco delle sue attività
      if (!p.span_start) continue;
      const isOpen = open.has(p.id);
      const pct = p.activity_count ? Math.round((p.done_count / p.ticket_count) * 100) : 0;
      rows.push({
        id: `p-${p.id}`, name: esc(`${isOpen ? '▾' : '▸'} ${p.name}`), start: p.span_start, end: p.span_end, progress: pct,
        dependencies: '', custom_class: `gp-${p.id}`, _project: p,
      });
      css.push(`.gantt .gp-${p.id} .bar{fill:${p.color}}`,
        `.gantt .gp-${p.id} .bar-progress{fill:rgba(0,0,0,.22)}`,
        `.gantt .gp-${p.id} .bar-label:not(.big){fill:#fff;font-weight:700}`);
      if (isOpen) rows.push(...items);
    }
    if (showLoose && !onlyProject) {
      tickets.filter(t => !t.project_id && (t.start_date || t.due_date) && (!hideDone || t.status !== 'done'))
        .forEach(t => rows.push(ticketRow(t, 'none')));
      css.push('.gantt :is(.gt-none,.gt-none-done) .bar{fill:#E6E2DD;stroke:#cfcac4}', '.gantt :is(.gt-none,.gt-none-done) .bar-progress{fill:#bdb7b0}');
    }
    // dipendenze solo tra righe visibili
    const shown = new Set(rows.map(r => r.id));
    for (const r of rows) {
      if (r._ticket) r.dependencies = r._ticket.depends_on.map(d => `t-${d}`).filter(id => shown.has(id)).join(',');
    }
    css.push('.gantt [class$="-done"] .bar{opacity:.55}');
    styleEl.textContent = css.join('\n');
    return rows;
  }

  function draw() {
    const rows = build();
    clear(chartBox);
    drawUndated();
    if (!rows.length) {
      chartBox.append(h('div.empty', onlyProject
        ? ['Nessuna attività. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); newActivityBtn.click(); } } }, 'Crea la prima'), ' oppure dai le date ai ticket del progetto.']
        : ['Nessun progetto con attività. ', h('a', { href: '#/projects' }, 'Vai ai progetti')]));
      gantt = null;
      return;
    }
    const el = h('div');
    chartBox.append(el);
    const byId = new Map(rows.map(r => [r.id, r]));
    // eslint-disable-next-line no-undef
    gantt = new Gantt(el, rows, {
      view_mode: mode,
      language: 'it',
      bar_height: 26,
      padding: 16,
      container_height: 'auto',
      today_button: true,
      scroll_to: onlyProject ? addDays(rows[0].start, -3) : 'today', // un progetto: si parte dalla prima attività
      move_dependencies: false,
      auto_move_label: true,
      popup_on: 'click',
      holidays: mode === 'Day' ? { 'var(--g-weekend-highlight-color)': 'weekend' } : {},
      popup: ctx => {
        const r = byId.get(ctx.task.id);
        const s = toISODate(ctx.task._start), e = toISODate(new Date(ctx.task._end.getTime() - 1000));
        if (r._project) {
          // clic su un progetto nel Gantt generale: si apre il suo Gantt di dettaglio
          location.hash = `#/gantt?project=${r._project.id}`;
          return false;
        }
        {
          const t = r._ticket;
          ctx.set_title(esc(t.title));
          ctx.set_subtitle(`${fmtDate(s)} → ${fmtDate(e)} · ${t.status === 'done' ? 'completata' : STATUS[t.status].toLowerCase()}`);
          const who = t.assignee_ids.map(id => userById(id)?.name).filter(Boolean);
          ctx.set_details(`${esc(who.join(', ') || 'Nessun responsabile')}<br>Avanzamento ${t.progress}%${t.file_count ? ` · 📎 ${t.file_count}` : ''}`);
          ctx.add_action('Apri', () => openTicket(t.id, { onSaved: refresh }));
        }
      },
      on_date_change: async (task, start, end) => {
        const r = byId.get(task.id);
        if (r._project) {
          toast('La durata del progetto viene dalle sue attività: sposta quelle');
          draw();
          return;
        }
        const s = toISODate(start), e = toISODate(end);
        try {
          await patch(`/api/tickets/${r._ticket.id}`, { start_date: s, due_date: e }, { quiet: true });
          Object.assign(r._ticket, { start_date: s, due_date: e });
          await loadProjects();
          onChange?.();
        } catch (err) {
          toast(err.message, 'err');
          reload();
        }
      },
      on_progress_change: async (task, progress) => {
        const r = byId.get(task.id);
        if (r._project) { toast('L\'avanzamento del progetto si calcola dalle attività completate'); draw(); return; }
        const value = Math.max(0, Math.min(100, Math.round(progress / 5) * 5));
        try {
          await patch(`/api/tickets/${r._ticket.id}`, { progress: value }, { quiet: true });
          r._ticket.progress = value;
          onChange?.();
        } catch (err) { toast(err.message, 'err'); reload(); }
      },
      on_double_click: task => {
        const r = byId.get(task.id);
        if (!r._project) openTicket(r._ticket.id, { onSaved: refresh });
      },
    });
    // altezza «auto» di Frappe non conta la barra di scorrimento orizzontale: senza questo compare anche quella verticale
    const box = el.querySelector('.gantt-container');
    if (box) box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`;
    const todayBtn = el.querySelector('.today-button');
    if (todayBtn) todayBtn.textContent = 'Oggi';
  }

  function drawUndated() {
    clear(undatedBox);
    const ids = new Set(visibleProjects().filter(p => onlyProject || open.has(p.id)).map(p => p.id));
    const list = tickets.filter(t => ids.has(t.project_id) && !t.start_date && !t.due_date && t.status !== 'done');
    if (!list.length) return;
    undatedBox.append(h('div.small.muted', { style: { marginBottom: '6px' } }, `${list.length} ticket del progetto senza date (non compaiono nel Gantt):`),
      h('div.row', list.map(t => h('button.btn.btn-sm', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: refresh }) } }, t.title))));
  }

  async function reload() {
    await loadProjects();
    tickets = await get(`/api/tickets${onlyProject ? `?project=${onlyProject}` : ''}`);
    draw();
  }

  async function refresh() {
    await reload();
    onChange?.();
  }

  return { reload };
}
