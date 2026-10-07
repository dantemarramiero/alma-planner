// Gantt: una barra per progetto; aprendo un progetto i suoi ticket diventano attività sotto la barra.
// Trascinare o allungare una barra cambia le date (progetto o ticket); la maniglia cambia l'avanzamento del ticket.
import { h, clear, toast, loading, fmtDate, today, addDays, toISODate, STATUS } from './ui.js';
import { get, patch } from './api.js';
import { store, loadProjects, userById } from './store.js';
import { openTicket } from './tickets.js';
import { editProject } from './projects.js';

const OPEN_KEY = 'alma.ganttOpen';
const MODE_KEY = 'alma.ganttMode';
const MODES = [['Day', 'Giorni'], ['Week', 'Settimane'], ['Month', 'Mesi']];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readStore = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ } };

// opts.embedded: Gantt di un solo progetto dentro la sua pagina (senza intestazione, ticket sempre aperti).
export async function ganttView(container, params, { embedded = false } = {}) {
  const onlyProject = params.get('project') ? Number(params.get('project')) : null;
  const loadTickets = () => get(`/api/tickets${onlyProject ? `?project=${onlyProject}` : ''}`);
  let open = new Set(readStore(OPEN_KEY, []));
  if (onlyProject) open.add(onlyProject);
  let mode = readStore(MODE_KEY, 'Week');
  let showDone = false;
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
    const allOpen = ids.every(id => open.has(id));
    open = allOpen ? new Set() : new Set(ids);
    writeStore(OPEN_KEY, [...open]);
    draw();
  } } }, 'Apri/chiudi tutti i ticket');

  // scelta del progetto: «Tutti» oppure il Gantt di un progetto solo
  const projectSelect = h('select.select', { 'aria-label': 'Progetto', on: { change: e => {
    location.hash = e.target.value ? `#/gantt?project=${e.target.value}` : '#/gantt';
  } } },
  h('option', { value: '' }, 'Tutti i progetti'),
  store.projects.filter(p => p.status !== 'archived' || p.id === onlyProject)
    .map(p => h('option', { value: String(p.id), selected: p.id === onlyProject }, p.name)));

  clear(container).append(...[
    embedded ? null : h('div.page-head',
      h('div', h('h1', 'Gantt'), h('div.sub', onlyProject
        ? 'I ticket del progetto come attività. Trascina le barre per spostare le date, la maniglia per l\'avanzamento.'
        : 'Trascina le barre per spostare le date. Clicca un progetto per vedere i suoi ticket come attività.')),
      projectSelect),
    h('div.toolbar', modeSeg, onlyProject ? null : expandAll,
      h('label.check', h('input', { type: 'checkbox', on: { change: e => { showDone = e.target.checked; draw(); } } }), 'Ticket fatti'),
      onlyProject ? null : h('label.check', h('input', { type: 'checkbox', on: { change: e => { showLoose = e.target.checked; draw(); } } }), 'Ticket senza progetto'),
      h('span.grow'),
      embedded ? h('a.btn.btn-sm', { href: `#/gantt?project=${onlyProject}` }, 'Apri a tutta pagina') : null),
    styleEl, chartBox, undatedBox,
    h('div.gantt-legend', h('span', '▬ barra piena: progetto'), h('span', '▭ barra chiara: ticket'), h('span', '→ frecce: dipendenze tra ticket')),
  ].filter(Boolean));

  chartBox.append(loading());
  await loadProjects();
  tickets = await loadTickets();
  draw();

  function visibleProjects() {
    return store.projects.filter(p => (onlyProject ? p.id === onlyProject : p.status === 'active' || p.status === 'paused'));
  }

  function ticketTask(t, groupClass) {
    const s = t.start_date || t.due_date, e = t.due_date || t.start_date;
    const who = t.assignee_ids.map(id => userById(id)?.name.split(' ')[0]).filter(Boolean).join(', ');
    return {
      id: `t-${t.id}`,
      name: esc(who ? `${t.title} · ${who}` : t.title),
      start: s, end: e,
      progress: t.progress,
      dependencies: '',
      custom_class: `${groupClass}${t.status === 'done' ? '-done' : ''}`, // un solo nome di classe: Frappe non ne accetta di più
      _ticket: t,
    };
  }

  function build() {
    const rows = [];
    const css = [];
    for (const p of visibleProjects()) {
      const s = p.start_date || p.tickets_start || today();
      let e = p.end_date || p.tickets_end || addDays(s, 13);
      if (e < s) e = s;
      const isOpen = open.has(p.id);
      const pct = p.ticket_count ? Math.round((p.done_count / p.ticket_count) * 100) : 0;
      rows.push({
        id: `p-${p.id}`, name: esc(`${isOpen ? '▾' : '▸'} ${p.name}`), start: s, end: e, progress: pct,
        dependencies: '', custom_class: `gp-${p.id}`, _project: p,
      });
      css.push(`.gantt .gp-${p.id} .bar{fill:${p.color}}`,
        `.gantt .gp-${p.id} .bar-progress{fill:rgba(0,0,0,.22)}`,
        `.gantt .gp-${p.id} .bar-label:not(.big){fill:#fff;font-weight:700}`,
        `.gantt :is(.gt-${p.id},.gt-${p.id}-done) .bar{fill:${p.color}2e;stroke:${p.color}88;stroke-width:1}`,
        `.gantt :is(.gt-${p.id},.gt-${p.id}-done) .bar-progress{fill:${p.color}99}`);
      if (isOpen) {
        tickets.filter(t => t.project_id === p.id && (t.start_date || t.due_date) && (showDone || t.status !== 'done'))
          .sort((a, b) => (a.start_date || a.due_date).localeCompare(b.start_date || b.due_date))
          .forEach(t => rows.push(ticketTask(t, `gt-${p.id}`)));
      }
    }
    if (showLoose && !onlyProject) {
      tickets.filter(t => !t.project_id && (t.start_date || t.due_date) && (showDone || t.status !== 'done'))
        .forEach(t => rows.push(ticketTask(t, 'gt-none')));
      css.push('.gantt :is(.gt-none,.gt-none-done) .bar{fill:#E6E2DD;stroke:#cfcac4}', '.gantt :is(.gt-none,.gt-none-done) .bar-progress{fill:#bdb7b0}');
    }
    // dipendenze solo tra ticket visibili
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
      chartBox.append(h('div.empty', 'Nessun progetto attivo. ', h('a', { href: '#/projects' }, 'Crea un progetto')));
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
      scroll_to: onlyProject ? addDays(rows[0].start, -3) : 'today', // un progetto: si parte dal suo inizio
      move_dependencies: false,
      auto_move_label: true,
      popup_on: 'click',
      holidays: mode === 'Day' ? { 'var(--g-weekend-highlight-color)': 'weekend' } : {},
      popup: ctx => {
        const r = byId.get(ctx.task.id);
        const s = toISODate(ctx.task._start), e = toISODate(new Date(ctx.task._end.getTime() - 1000));
        if (r._project) {
          const p = r._project;
          ctx.set_title(esc(p.name));
          ctx.set_subtitle(`${fmtDate(s)} → ${fmtDate(e)}`);
          ctx.set_details(`${p.done_count}/${p.ticket_count} ticket fatti${p.start_date ? '' : '<br><small>Date ricavate dai ticket</small>'}`);
          ctx.add_action(open.has(p.id) ? 'Nascondi ticket' : 'Mostra ticket', () => toggle(p.id));
          ctx.add_action('Apri progetto', () => { location.hash = `#/projects/${p.id}`; });
          ctx.add_action('Modifica', () => editProject(p, reload));
        } else {
          const t = r._ticket;
          ctx.set_title(esc(t.title));
          ctx.set_subtitle(`${fmtDate(s)} → ${fmtDate(e)} · ${STATUS[t.status]}`);
          const who = t.assignee_ids.map(id => userById(id)?.name).filter(Boolean);
          ctx.set_details(`${esc(who.join(', ') || 'Nessun assegnatario')}<br>Avanzamento ${t.progress}%`);
          ctx.add_action('Apri ticket', () => openTicket(t.id, { onSaved: reload }));
        }
      },
      on_date_change: async (task, start, end) => {
        const r = byId.get(task.id);
        const s = toISODate(start), e = toISODate(end);
        try {
          if (r._project) {
            await patch(`/api/projects/${r._project.id}`, { start_date: s, end_date: e }, { quiet: true });
            Object.assign(r._project, { start_date: s, end_date: e });
          } else {
            const t = r._ticket;
            await patch(`/api/tickets/${t.id}`, { start_date: s, due_date: e }, { quiet: true });
            Object.assign(t, { start_date: s, due_date: e });
            await loadProjects();
          }
        } catch (err) {
          toast(err.message, 'err');
          reload();
        }
      },
      on_progress_change: async (task, progress) => {
        const r = byId.get(task.id);
        if (r._project) { toast('L\'avanzamento del progetto si calcola dai ticket fatti'); draw(); return; }
        const value = Math.max(0, Math.min(100, Math.round(progress / 5) * 5));
        try {
          await patch(`/api/tickets/${r._ticket.id}`, { progress: value }, { quiet: true });
          r._ticket.progress = value;
        } catch (err) { toast(err.message, 'err'); reload(); }
      },
      on_double_click: task => {
        const r = byId.get(task.id);
        if (r._project) toggle(r._project.id);
        else openTicket(r._ticket.id, { onSaved: reload });
      },
    });
    // altezza «auto» di Frappe non conta la barra di scorrimento orizzontale: senza questo compare anche quella verticale
    const box = el.querySelector('.gantt-container');
    if (box) box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`;
    const todayBtn = el.querySelector('.today-button');
    if (todayBtn) todayBtn.textContent = 'Oggi';
  }

  function toggle(id) {
    if (open.has(id)) open.delete(id); else open.add(id);
    if (!onlyProject) writeStore(OPEN_KEY, [...open]); // la vista di un progetto non cambia quella generale
    gantt?.popup?.hide?.();
    draw();
  }

  function drawUndated() {
    clear(undatedBox);
    const ids = new Set(visibleProjects().filter(p => open.has(p.id)).map(p => p.id));
    const list = tickets.filter(t => ids.has(t.project_id) && !t.start_date && !t.due_date && t.status !== 'done');
    if (!list.length) return;
    undatedBox.append(h('div.small.muted', { style: { marginBottom: '6px' } }, `${list.length} ticket senza date (non compaiono nel Gantt):`),
      h('div.row', list.map(t => h('button.btn.btn-sm', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: reload }) } }, t.title))));
  }

  async function reload() {
    await loadProjects();
    tickets = await loadTickets();
    draw();
  }
}
