// Gantt (layout del design «Alma Planet – Gantt»): tabella a sinistra (attività, responsabile, fine, %) e linea del tempo
// a destra, nella stessa griglia scorrevole. Le righe sono le attività, cioè i ticket con date: «Fatto» = completata.
// - Gantt di un progetto (?project=id): le righe sono le sue attività.
// - Gantt generale: una riga per progetto (barra = arco delle sue attività, arancione = avanzamento) con sotto,
//   aprendola, le sue attività. I progetti seguono l'ordine delle macro aree; si può vederne una sola.
// Trascinare una barra sposta le date del ticket, trascinarne un bordo le allunga; un clic apre il ticket.
// Un ticket con la sola scadenza è una milestone (rombo).
// Collegamenti come in Microsoft Project (fine-inizio, inizio-inizio, fine-fine, inizio-fine, con scarto): si creano
// trascinando il pallino alla fine di una barra su un'altra attività, e quando un'attività si sposta le collegate la
// seguono (lo calcola il server, lib/schedule.js). Durante il trascinamento le collegate si muovono insieme.
import { h, clear, toast, loading, fmtDate, today, STATUS, initials } from './ui.js';
import { get, patch } from './api.js';
import { store, loadProjects, loadAreas, userById, projectById, areaById } from './store.js';
import { openTicket, movedText } from './tickets.js';
import { newActivity } from './activities.js';
import { icon } from './icons.js';

const OPEN_KEY = 'alma.ganttOpen';
const MODE_KEY = 'alma.ganttZoom';
const AREA_KEY = 'alma.ganttArea';
const MIN_ROWS = 5;            // righe minime, anche se le attività sono meno
const RH = 40;                 // altezza di una riga
const PPD = { g: 38, w: 18, m: 5 }; // pixel per giorno: Giorni, Settimane, Mesi
const ZOOMS = [['g', 'Giorni'], ['w', 'Settimane'], ['m', 'Mesi']];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DAY = 86400000;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readStore = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* niente */ } };
// date ISO (AAAA-MM-GG) ↔ giorni dal 1970, in UTC per non avere sorprese con l'ora legale
const dn = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const iso = n => new Date(n * DAY).toISOString().slice(0, 10);
const dow = n => (new Date(n * DAY).getUTCDay() + 6) % 7; // 0 = lunedì
const short = n => { const d = new Date(n * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`; };

export async function ganttView(container, params, { embedded = false, onChange } = {}) {
  const onlyProject = params.get('project') ? Number(params.get('project')) : null;
  let open = new Set(readStore(OPEN_KEY, []));
  let zoom = readStore(MODE_KEY, 'w');
  if (!PPD[zoom]) zoom = 'w';
  let areaFilter = readStore(AREA_KEY, ''); // '' = tutte, 'none' = senza macro area, altrimenti l'id
  if (!onlyProject) await loadAreas().catch(() => {});
  if (areaFilter && areaFilter !== 'none' && !areaById(Number(areaFilter))) areaFilter = '';
  let hideDone = false;
  let showLoose = false;
  let tickets = [];
  let scrolledOnce = false;
  const project = onlyProject ? projectById(onlyProject) : null;
  const TODAY = dn(today());

  // ── barra degli strumenti ─────────────────────────────────────────────────
  const zoomSeg = h('div.seg', ZOOMS.map(([k, l]) => h('button', { type: 'button', 'data-k': k, class: k === zoom ? 'on' : '', on: { click: () => {
    zoom = k; writeStore(MODE_KEY, k);
    zoomSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    scrolledOnce = false;
    draw();
  } } }, l)));
  const todayBtn = h('button.btn.btn-primary', { type: 'button', on: { click: () => scrollToDay(TODAY, true) } }, icon('crosshair', { size: 16 }), 'Oggi');
  const expandBtn = onlyProject ? null : h('button.btn.btn-ghost', { type: 'button', on: { click: () => {
    const ids = groups().map(g => g.key);
    open = ids.every(id => open.has(id)) ? new Set() : new Set(ids);
    writeStore(OPEN_KEY, [...open]);
    draw();
  } } });
  const projectSelect = embedded ? null : h('select.select', { 'aria-label': 'Progetto', on: { change: e => {
    location.hash = e.target.value ? `#/gantt?project=${e.target.value}` : '#/gantt';
  } } },
  h('option', { value: '' }, 'Tutti i progetti'),
  store.projects.filter(p => p.status !== 'archived' || p.id === onlyProject).map(p => h('option', { value: String(p.id), selected: p.id === onlyProject }, p.name)));
  const areaSelect = onlyProject || !store.areas.length ? null : h('select.select', { 'aria-label': 'Macro area', on: { change: e => {
    areaFilter = e.target.value; writeStore(AREA_KEY, areaFilter); draw();
  } } },
  h('option', { value: '' }, 'Tutte le macro aree'),
  store.areas.map(a => h('option', { value: String(a.id), selected: String(a.id) === areaFilter }, a.name)),
  h('option', { value: 'none', selected: areaFilter === 'none' }, 'Senza macro area'));
  const chip = (label, get, set) => {
    const el = h('button.gx-chip', { type: 'button', 'aria-pressed': 'false', on: { click: () => {
      set(!get()); el.classList.toggle('on', get()); el.setAttribute('aria-pressed', String(get())); draw();
    } } }, h('i'), label);
    return el;
  };
  const newActivityBtn = onlyProject ? h('button.btn.btn-primary', { type: 'button', on: { click: () => newActivity(onlyProject, { onSaved: refresh }) } }, icon('plus', { size: 16 }), 'Attività') : null;
  if (newActivityBtn) todayBtn.className = 'btn';

  const summary = h('div.gx-sum');
  const scroller = h('div.gx-sc');
  const tip = h('div.gx-tip', { hidden: true });
  const undatedBox = h('div.undated');

  clear(container).append(...[
    embedded ? null : h('div.page-head',
      h('div', h('h1', project ? project.name : 'Gantt'), h('div.sub', onlyProject
        ? 'Ogni attività è un ticket del progetto: quando lo metti in «Fatto» è completata. Trascina una barra per spostarla, un bordo per allungarla, il pallino alla sua fine su un\'altra attività per collegarle: le collegate seguono il loro predecessore.'
        : 'Ogni barra è un progetto, lunga quanto le sue attività. Apri un progetto per vederne le attività, o clicca il nome per il suo Gantt.')),
      projectSelect),
    h('div.gx-tools',
      h('div.gx-bar', zoomSeg, todayBtn, h('span.grow'),
        embedded ? h('a.btn.btn-ghost', { href: `#/gantt?project=${onlyProject}` }, icon('external', { size: 16 }), 'Apri a tutta pagina') : null,
        expandBtn, newActivityBtn),
      h('div.gx-bar.gx-filters',
        h('span.gx-lbl', icon('sliders', { size: 16 }), 'Filtri'), areaSelect,
        chip('Nascondi completate', () => hideDone, v => { hideDone = v; }),
        onlyProject ? null : chip('Ticket senza progetto', () => showLoose, v => { showLoose = v; })),
      summary),
    h('div.card.gx-card', scroller),
    undatedBox,
    h('div.gx-legend',
      onlyProject ? null : h('div', h('span.gx-lg-p'), 'Progetto (arancione = avanzamento)'),
      h('div', h('span.gx-lg-t'), 'Attività'), h('div', h('span.gx-lg-done'), 'Completata'), h('div', h('span.gx-lg-late'), 'In ritardo'),
      h('div', h('span.gx-lg-ms'), 'Milestone (solo scadenza)'), h('div', icon('arrows', { size: 16 }), 'Collegamenti: trascina il pallino alla fine di una barra su un\'altra attività')),
    tip,
  ].filter(Boolean));

  // ── dati ──────────────────────────────────────────────────────────────────
  function visibleProjects() {
    if (onlyProject) return store.projects.filter(p => p.id === onlyProject);
    const areaOf = p => (areaById(p.area_id) ? p.area_id : null);
    const rank = p => { const i = store.areas.findIndex(a => a.id === areaOf(p)); return i < 0 ? store.areas.length : i; };
    return store.projects
      .filter(p => p.status === 'active' || p.status === 'paused')
      .filter(p => !areaFilter || (areaFilter === 'none' ? !areaOf(p) : String(areaOf(p)) === areaFilter))
      .sort((a, b) => rank(a) - rank(b));
  }

  const isMilestone = t => !t.start_date && Boolean(t.due_date);
  const startOf = t => dn(t.start_date || t.due_date);
  const endOf = t => dn(t.due_date || t.start_date);
  const isDone = t => t.status === 'done';
  const linksOf = t => t.links || (t.depends_on || []).map(id => ({ id, type: 'FS', lag: 0 }));
  const LINK_SHORT = { FS: 'FI', SS: 'II', FF: 'FF', SF: 'IF' };
  const linkLabel = l => `${LINK_SHORT[l.type] || 'FI'}${l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag} g` : ''}`;
  // successori diretti e indiretti di un ticket (per farli muovere insieme mentre lo si trascina)
  function successorsOf(id) {
    const out = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const t of tickets) if (!out.has(t.id) && linksOf(t).some(l => out.has(l.id))) { out.add(t.id); grew = true; }
    }
    out.delete(id);
    return out;
  }
  const isLate = t => !isDone(t) && t.due_date && dn(t.due_date) < TODAY;
  const dated = list => list.filter(t => (t.start_date || t.due_date) && (!hideDone || !isDone(t)))
    .sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));

  // gruppi: un progetto (o «Ticket senza progetto») con le sue attività
  function groups() {
    const out = visibleProjects().map(p => ({ key: p.id, project: p, tasks: dated(tickets.filter(t => t.project_id === p.id)) }))
      .filter(g => onlyProject || g.tasks.length);
    if (showLoose && !onlyProject) {
      const loose = dated(tickets.filter(t => !t.project_id));
      if (loose.length) out.push({ key: 'loose', project: null, tasks: loose });
    }
    return out;
  }

  function rowsOf(gs) {
    const rows = [];
    for (const g of gs) {
      if (onlyProject) { g.tasks.forEach(t => rows.push({ kind: 't', t, g })); continue; }
      rows.push({ kind: 'p', g });
      if (open.has(g.key)) g.tasks.forEach(t => rows.push({ kind: 't', t, g }));
    }
    return rows;
  }

  const span = g => {
    const s = Math.min(...g.tasks.map(startOf)), e = Math.max(...g.tasks.map(endOf));
    // avanzamento: media dell'avanzamento delle attività pesata sulla durata (completate = 100%, milestone escluse)
    const work = g.tasks.filter(t => !isMilestone(t));
    const days = work.reduce((n, t) => n + endOf(t) - startOf(t) + 1, 0);
    const pct = days ? Math.round(work.reduce((n, t) => n + (endOf(t) - startOf(t) + 1) * (isDone(t) ? 100 : t.progress || 0), 0) / days) : 0;
    return { s, e, pct };
  };

  // ── disegno ───────────────────────────────────────────────────────────────
  function draw() {
    tip.hidden = true;
    const gs = groups();
    const rows = rowsOf(gs);
    if (expandBtn) expandBtn.replaceChildren(icon(gs.length && gs.every(g => open.has(g.key)) ? 'collapse' : 'expand', { size: 16 }),
      gs.length && gs.every(g => open.has(g.key)) ? 'Comprimi tutto' : 'Espandi tutto');

    const all = gs.flatMap(g => g.tasks);
    const late = all.filter(isLate).length;
    summary.replaceChildren(...[
      onlyProject ? null : h('span', h('b', String(gs.filter(g => g.project).length)), ' progetti'),
      h('span', h('b', String(all.length)), ' attività'),
      h('span', h('b', String(all.filter(isDone).length)), ' completate'),
      late ? h('span.late', h('b', String(late)), ' in ritardo') : null,
      h('span', `Oggi: ${fmtDate(today(), { year: true })}`),
    ].filter(Boolean));
    drawUndated(gs);

    // intervallo: dal lunedì prima della prima attività (o di 2 settimane fa) a qualche settimana dopo l'ultima
    const starts = all.map(startOf), ends = all.map(endOf);
    let d0 = Math.min(TODAY - 14, ...(starts.length ? starts : [TODAY])) - 7;
    d0 -= dow(d0);
    const d1 = Math.max(TODAY + 60, ...(ends.length ? ends : [TODAY])) + 28;
    const N = d1 - d0;
    const ppd = PPD[zoom], W = N * ppd, unit = zoom === 'g' ? ppd : ppd * 7;
    const x = n => (n - d0) * ppd;

    const total = Math.max(rows.length, MIN_ROWS);
    const H = total * RH;

    // intestazione: mesi sopra, giorni o settimane sotto
    let months = '';
    for (let i = 0; i < N;) {
      const m = new Date((d0 + i) * DAY).getUTCMonth();
      let j = i;
      while (j < N && new Date((d0 + j) * DAY).getUTCMonth() === m) j++;
      const w = (j - i) * ppd, d = new Date((d0 + i) * DAY);
      const name = zoom === 'm' ? MONTHS[m].slice(0, 3) : MONTHS[m][0].toUpperCase() + MONTHS[m].slice(1);
      months += `<div class="gx-mo" style="left:${i * ppd}px;width:${w}px">${w < 60 ? '' : `${name} ${d.getUTCFullYear()}`}</div>`;
      i = j;
    }
    let units = '';
    if (zoom === 'g') {
      for (let i = 0; i < N; i++) {
        const n = d0 + i;
        units += `<div class="gx-un${dow(n) > 4 ? ' we' : ''}${n === TODAY ? ' now' : ''}" style="left:${i * ppd}px;width:${ppd}px"><span>${new Date(n * DAY).getUTCDate()}</span></div>`;
      }
    } else {
      for (let i = 0; i < N; i += 7) {
        const a = d0 + i, b = a + 6, now = TODAY >= a && TODAY <= b;
        const da = new Date(a * DAY), db = new Date(b * DAY);
        const label = zoom === 'm' ? String(da.getUTCDate())
          : da.getUTCMonth() === db.getUTCMonth() ? `${da.getUTCDate()}–${db.getUTCDate()} ${MONTHS[db.getUTCMonth()].slice(0, 3)}` : `${short(a)} – ${short(b)}`;
        units += `<div class="gx-un${now ? ' now' : ''}" style="left:${i * ppd}px;width:${7 * ppd}px"><span>${label}</span></div>`;
      }
    }

    // sfondo: weekend (Giorni) o settimana corrente, linea di oggi
    let bg = '';
    if (zoom === 'g') { for (let i = 0; i < N; i++) if (dow(d0 + i) > 4) bg += `<div class="gx-bg we" style="left:${i * ppd}px;width:${ppd}px"></div>`; }
    else { const ws = TODAY - dow(TODAY); bg += `<div class="gx-bg wk" style="left:${x(ws)}px;width:${7 * ppd}px"></div>`; }
    bg += `<div class="gx-now" style="left:${x(TODAY) + ppd / 2 - 1}px"></div>`;

    // righe: cella a sinistra + barra a destra
    const pos = new Map(); // ticket id → { x1, x2, y }
    let left = '', bars = '';
    rows.forEach((r, i) => {
      const y = i * RH;
      if (r.kind === 'p') {
        const g = r.g, sp = span(g), p = g.project;
        const owner = p ? userById(p.owner_id) : null;
        const area = p ? areaById(p.area_id) : null;
        const isOpen = open.has(g.key);
        bg += `<div class="gx-bg pr" style="left:0;right:0;top:${y}px;height:${RH}px"></div>`;
        left += `<div class="gx-lc p" data-r="${i}" style="grid-row:${i + 2}">
          <div class="gx-nm"><button type="button" class="gx-chev${isOpen ? '' : ' cl'}" data-toggle="${g.key}" aria-label="${isOpen ? 'Chiudi' : 'Apri'} ${esc(p ? p.name : 'Ticket senza progetto')}" aria-expanded="${isOpen}">${chev}</button>
          ${p ? `<a href="#/gantt?project=${p.id}" title="Apri il Gantt di ${esc(p.name)}">${esc(p.name)}</a>` : '<span>Ticket senza progetto</span>'}
          ${area ? `<em class="gx-tag">${esc(area.name)}</em>` : ''}</div>
          ${av(owner)}<span class="gx-d">${short(sp.e)}</span><span class="gx-pc">${sp.pct}%</span></div>`;
        bars += `<div class="gx-b pj" data-toggle="${g.key}" data-tip="${esc(p ? p.name : 'Ticket senza progetto')}|${short(sp.s)} – ${short(sp.e)}|Avanzamento ${sp.pct}%" style="left:${x(sp.s)}px;width:${(sp.e - sp.s + 1) * ppd}px;top:${y + 15}px"><i style="width:${sp.pct}%"></i></div>`;
        return;
      }
      const t = r.t, s = startOf(t), e = endOf(t), L = isLate(t), done = isDone(t);
      const who = t.assignee_ids.map(userById).filter(Boolean);
      left += `<div class="gx-lc t${L ? ' late' : ''}" data-r="${i}" data-open="${t.id}" style="grid-row:${i + 2}">
        <div class="gx-nm"><span class="gx-st ${isMilestone(t) ? 'ms' : done ? 'done' : L ? 'late' : t.status === 'todo' && !t.progress ? 'todo' : ''}"></span><span title="${esc(t.title)}">${esc(t.title)}</span></div>
        ${av(who[0], who.length > 1 ? `${who.map(u => u.name).join(', ')}` : null, who.length > 1 ? `+${who.length - 1}` : '')}<span class="gx-d">${short(e)}</span><span class="gx-pc">${done ? 100 : t.progress}%</span></div>`;
      const preds = linksOf(t).map(l => { const p = tickets.find(x => x.id === l.id); return p ? `${esc(p.title)} (${linkLabel(l)})` : null; }).filter(Boolean);
      const tipText = `${esc(t.title)}|${isMilestone(t) ? `Scadenza ${short(e)}` : `${short(s)} – ${short(e)}`}|${done ? 'Completata' : L ? `In ritardo · ${t.progress}%` : `${STATUS[t.status]} · ${t.progress}%`}${who.length ? ` · ${esc(who.map(u => u.name.split(' ')[0]).join(', '))}` : ''}${preds.length ? `<br>Dopo: ${preds.join(', ')}` : ''}`;
      const dot = (left, top) => `<span class="gx-ln" data-from="${t.id}" title="Trascina su un'altra attività per collegarla" style="left:${left}px;top:${top}px"></span>`;
      if (isMilestone(t)) {
        const cx = x(s) + ppd / 2;
        pos.set(t.id, { x1: cx - 8, x2: cx + 8, y: y + RH / 2 });
        bars += `<div class="gx-ms${done ? ' done' : ''}${L ? ' late' : ''}" data-open="${t.id}" data-id="${t.id}" data-tip="${tipText}" style="left:${cx - 7}px;top:${y + 13}px"></div>${dot(cx + 10, y + 16)}
          <div class="gx-bl${L ? ' late' : ''}" style="left:${cx + 22}px;top:${y + 12}px">${short(s)}</div>`;
      } else {
        const bx = x(s), bw = (e - s + 1) * ppd;
        pos.set(t.id, { x1: bx, x2: bx + bw, y: y + RH / 2 });
        bars += `<div class="gx-b tk${done ? ' done' : ''}${L ? ' late' : ''}" data-id="${t.id}" data-tip="${tipText}" style="left:${bx}px;width:${bw}px;top:${y + 9}px">
          ${done ? '' : `<i style="width:${t.progress}%"></i>`}<span class="gx-h l"></span><span class="gx-h r"></span></div>${dot(bx + bw + 3, y + 16)}`;
      }
    });
    for (let i = rows.length; i < total; i++) left += `<div class="gx-lc f" style="grid-row:${i + 2}"></div>`;

    // collegamenti, solo tra righe visibili: escono dalla fine (o dall'inizio, per II e IF) del predecessore ed
    // entrano nell'inizio (o nella fine, per FF e IF) del successore, come in Microsoft Project
    let deps = '';
    for (const r of rows) {
      if (r.kind !== 't') continue;
      for (const l of linksOf(r.t)) {
        const A = pos.get(l.id), B = pos.get(r.t.id);
        if (!A || !B) continue;
        const fromStart = l.type === 'SS' || l.type === 'SF', toEnd = l.type === 'FF' || l.type === 'SF';
        const sx = fromStart ? A.x1 : A.x2, p1 = sx + (fromStart ? -8 : 8);
        const ex = toEnd ? B.x2 + 2 : B.x1 - 2, side = toEnd ? 1 : -1;
        const direct = side < 0 ? p1 <= ex - 6 : p1 >= ex + 6;
        const mid = B.y + (B.y >= A.y ? -14 : 14);
        deps += direct
          ? `<path d="M${sx} ${A.y}H${p1}V${B.y}H${ex}"/>`
          : `<path d="M${sx} ${A.y}H${p1}V${mid}H${ex + 10 * side}V${B.y}H${ex}"/>`;
      }
    }

    const keep = scrolledOnce ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null;
    scroller.innerHTML = `<div class="gx-g" style="grid-template-columns:var(--gx-lw) ${W}px;grid-template-rows:64px repeat(${total},${RH}px)">
      <div class="gx-corner"><span>${onlyProject ? 'Attività' : 'Progetto / attività'}</span><span>Resp.</span><span>Fine</span><span>%</span></div>
      <div class="gx-th" style="width:${W}px">${months}${units}</div>
      ${left}
      <div class="gx-tb" style="grid-column:2;grid-row:2/span ${total};height:${H}px;--unit:${unit}px">
        ${bg}<div class="gx-hl"></div>
        <svg class="gx-dep" width="${W}" height="${H}" aria-hidden="true"><defs><marker id="gx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>${deps}</svg>
        ${bars}
      </div></div>
      ${rows.length ? '' : `<div class="gx-empty">${onlyProject ? 'Nessuna attività con date. Crea la prima con «Attività», oppure dai inizio e scadenza ai ticket del progetto.' : 'Nessun progetto con attività per questi filtri.'}</div>`}`;
    if (keep) { scroller.scrollTop = keep.top; scroller.scrollLeft = keep.left; }
    else {
      scrolledOnce = true;
      // un progetto: si parte dalla prima attività; il Gantt generale da oggi
      scrollToDay(onlyProject && starts.length ? Math.min(...starts) : TODAY, false, d0);
    }
    scroller.dataset.d0 = String(d0);
    wire(rows);
  }

  const chev = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function av(u, title, extra = '') {
    if (!u) return '<span class="gx-av empty"></span>';
    return `<span class="gx-av" title="${esc(title || u.name)}">${esc(initials(u.name))}${extra ? `<small>${extra}</small>` : ''}</span>`;
  }

  function scrollToDay(n, smooth, d0 = Number(scroller.dataset.d0)) {
    const left = Math.max(0, (n - d0 + 0.5) * PPD[zoom] - 180);
    scroller.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ── interazione: righe evidenziate, suggerimenti, apertura, trascinamento ──
  function wire(rows) {
    const tb = scroller.querySelector('.gx-tb');
    const hl = scroller.querySelector('.gx-hl');
    if (!tb) return;
    const hover = r => {
      scroller.querySelectorAll('.gx-lc.hv').forEach(e => e.classList.remove('hv'));
      if (r == null || r >= rows.length) { hl.style.display = 'none'; return; }
      hl.style.display = 'block';
      hl.style.top = `${r * RH}px`;
      scroller.querySelector(`.gx-lc[data-r="${r}"]`)?.classList.add('hv');
    };
    tb.onmousemove = e => hover(Math.floor((e.clientY - tb.getBoundingClientRect().top) / RH));
    tb.onmouseleave = () => hover(null);
    scroller.querySelectorAll('.gx-lc[data-r]').forEach(c => { c.onmouseenter = () => hover(Number(c.dataset.r)); c.onmouseleave = () => hover(null); });

    scroller.onclick = e => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const k = tg.dataset.toggle === 'loose' ? 'loose' : Number(tg.dataset.toggle);
        if (open.has(k)) open.delete(k); else open.add(k);
        writeStore(OPEN_KEY, [...open]);
        draw();
        return;
      }
      const o = e.target.closest('[data-open]');
      if (o) openTicket(Number(o.dataset.open), { onSaved: refresh });
    };
    scroller.onmouseover = e => {
      const b = e.target.closest('[data-tip]');
      if (!b || dragging) { tip.hidden = true; return; }
      const [a, c, d] = b.dataset.tip.split('|');
      tip.innerHTML = `<b>${a}</b>${c}${d ? `<br><span>${d}</span>` : ''}`;
      tip.hidden = false;
    };
    scroller.onmousemove = e => {
      if (tip.hidden) return;
      tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 290)}px`;
      tip.style.top = `${e.clientY + 16}px`;
    };
    scroller.onmouseleave = () => { tip.hidden = true; };
    scroller.querySelectorAll('.gx-b.tk').forEach(el => { el.onpointerdown = e => startDrag(e, el); });
    scroller.querySelectorAll('.gx-ln').forEach(el => { el.onpointerdown = e => startLink(e, el); });
  }

  // Collegare due attività come in Project: dal pallino alla fine di una barra a un'altra barra (o milestone).
  // Il collegamento nuovo è fine-inizio senza scarto: il successore si mette subito dopo (lo sposta il server).
  function startLink(e, dot) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const fromId = Number(dot.dataset.from);
    const pred = tickets.find(x => x.id === fromId);
    const tb = scroller.querySelector('.gx-tb'), svg = tb?.querySelector('.gx-dep');
    if (!pred || !svg) return;
    const at = ev => { const r = tb.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const [sx, sy] = at({ clientX: dot.getBoundingClientRect().left + 5, clientY: dot.getBoundingClientRect().top + 5 });
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'gx-ln-tmp');
    svg.append(line);
    dragging = { dot };
    tip.hidden = true;
    tb.classList.add('linking');
    try { dot.setPointerCapture(e.pointerId); } catch { /* il collegamento funziona lo stesso */ }
    let target = null;
    const mark = el => { target?.classList.remove('gx-target'); target = el; target?.classList.add('gx-target'); };
    dot.onpointermove = ev => {
      const [x2, y2] = at(ev);
      line.setAttribute('d', `M${sx} ${sy}L${x2} ${y2}`);
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.gx-b.tk[data-id], .gx-ms[data-id]');
      mark(over && Number(over.dataset.id) !== fromId ? over : null);
    };
    dot.onpointerup = dot.onpointercancel = async () => {
      dot.onpointermove = dot.onpointerup = dot.onpointercancel = null;
      line.remove();
      tb.classList.remove('linking');
      dragging = null;
      const el = target;
      mark(null);
      if (!el) return;
      const succ = tickets.find(x => x.id === Number(el.dataset.id));
      if (!succ) return;
      if (linksOf(succ).some(l => l.id === fromId)) { toast('Queste due attività sono già collegate'); return; }
      try {
        const r = await patch(`/api/tickets/${succ.id}`, { depends_on: [...linksOf(succ), { id: fromId, type: 'FS', lag: 0 }] }, { quiet: true });
        toast(`Collegate: «${pred.title}» → «${succ.title}»`);
        if (r.rescheduled?.length) toast(movedText(r.rescheduled));
        await reload();
        onChange?.();
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  // Trascinamento: il corpo sposta inizio e fine, i bordi ne cambiano uno; scatta di un giorno alla volta.
  // Senza spostamento è un clic e apre il ticket.
  let dragging = null;
  function startDrag(e, el) {
    if (e.button !== 0) return;
    const t = tickets.find(x => x.id === Number(el.dataset.id));
    if (!t) return;
    e.preventDefault();
    const mode = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : 'move';
    const ppd = PPD[zoom], x0 = e.clientX, left0 = el.offsetLeft, width0 = el.offsetWidth;
    const s0 = startOf(t), e0 = endOf(t);
    let dd = 0;
    dragging = { el };
    tip.hidden = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* alcuni dispositivi non la concedono: il trascinamento funziona lo stesso */ }
    el.classList.add('drag');
    // anteprima: spostando la barra (o la sua fine) le attività collegate si muovono insieme; le date esatte, in giorni
    // lavorativi, le calcola il server al rilascio
    const tb = scroller.querySelector('.gx-tb');
    tb?.classList.add('dragging');
    const followers = mode === 'start' ? [] : [...successorsOf(t.id)]
      .filter(id => !isDone(tickets.find(x => x.id === id) || {}))
      .flatMap(id => [...scroller.querySelectorAll(`.gx-b.tk[data-id="${id}"], .gx-ms[data-id="${id}"]`)])
      .map(f => ({ f, left: f.offsetLeft }));
    el.onpointermove = ev => {
      dd = Math.round((ev.clientX - x0) / ppd);
      if (mode === 'move') el.style.left = `${left0 + dd * ppd}px`;
      else if (mode === 'start') { dd = Math.min(dd, e0 - s0); el.style.left = `${left0 + dd * ppd}px`; el.style.width = `${width0 - dd * ppd}px`; }
      else { dd = Math.max(dd, s0 - e0); el.style.width = `${width0 + dd * ppd}px`; }
      for (const { f, left } of followers) { f.style.left = `${left + dd * ppd}px`; f.classList.toggle('follow', Boolean(dd)); }
    };
    el.onpointerup = async () => {
      el.onpointermove = el.onpointerup = null;
      el.classList.remove('drag');
      tb?.classList.remove('dragging');
      dragging = null;
      if (!dd) { openTicket(t.id, { onSaved: refresh }); return; }
      const ns = mode === 'end' ? s0 : s0 + dd, ne = mode === 'start' ? e0 : e0 + dd;
      // una milestone ha solo la scadenza, un ticket con il solo inizio solo l'inizio
      const body = { start_date: t.start_date ? iso(ns) : null, due_date: t.due_date ? iso(ne) : null };
      if (mode === 'move') body.keep_duration = true; // il server tiene la durata in giorni lavorativi, come Project
      try {
        const r = await patch(`/api/tickets/${t.id}`, body, { quiet: true });
        toast(`${t.title}: ${short(startOf(r))} – ${short(endOf(r))}`);
        if (r.rescheduled?.length) toast(movedText(r.rescheduled));
        await reload();
        onChange?.();
      } catch (err) { toast(err.message, 'err'); reload(); }
    };
  }

  function drawUndated(gs) {
    clear(undatedBox);
    const ids = new Set(gs.filter(g => g.project && (onlyProject || open.has(g.key))).map(g => g.key));
    const list = tickets.filter(t => ids.has(t.project_id) && !t.start_date && !t.due_date && t.status !== 'done');
    if (!list.length) return;
    undatedBox.append(h('div.small.muted', { style: { marginBottom: '6px' } }, `${list.length} ticket senza date (non compaiono nel Gantt):`),
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

  // il primo caricamento va in fondo: prima devono esistere tutte le costanti usate da draw() (const = zona morta fino alla dichiarazione)
  scroller.append(loading());
  await reload();
  return { reload };
}
