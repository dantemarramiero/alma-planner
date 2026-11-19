// «Porta avanti», «I miei progetti» e la scheda del progetto del CRM (canvas v9 approvato da Dante il 19/11/2026:
// «Porta avanti», «I miei progetti», «Il progetto»). Il progetto è un progetto vero di Alma Planet: la scheda usa
// projectDetail con la testata scura del CRM e i tab Panoramica · Compiti · Relazioni · Incontri · Calendario · Note ·
// Gantt · Rendiconto · Documenti (più Email e Membri in fondo).
import { h, fill, toast, loading, fmtDate, initials, debounce, today, addDays } from './ui.js';
import { get, post, api, del } from './api.js';
import { store } from './store.js';
import { ic } from './crm-v2.js';
import { openTicket } from './tickets.js';
import { projectDetail, editProject } from './projects.js';
import { openMeeting, meetingWhen } from './project-meetings.js';

const STAGE_LABEL = { '': 'Programmata', programmata: 'Programmata', finanziata: 'Finanziata', progetto: 'Progetto approvato', determina: 'Determina o avviso', vinta_altri: 'Vinta da altri' };
const PARTS = [['fit', 'Coerenza'], ['concreteness', 'Concretezza'], ['timing', 'Tempi'], ['relationship', 'Rapporto'], ['value', 'Valore']];
const eur = n => (n === null || n === undefined || n === '' || !Number(n) ? '—' : Number(n) >= 1e6 ? `€ ${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M`
  : Number(n) >= 1e4 ? `€ ${Math.round(Number(n) / 1e3).toLocaleString('it-IT')} k` : `€ ${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })}`);
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const daysTo = d => Math.round((Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 864e5);
const firstName = n => String(n || '').split(' ')[0];
const ini = (name, cls = '') => h('span.pv-ini', { class: cls, title: name || '' }, initials(name || '?'));
const inis = (names, max = 4) => h('span.pv-inis', names.slice(0, max).map(n => ini(n)), names.length > max ? h('span.pv-ini.more', `+${names.length - max}`) : null);
const glassTile = (k, v, s = '', tone = '') => h('div.pv-glass', { class: tone }, h('span.pv-k', k), h('b', v), s ? h('small', s) : null);
const userName = id => store.users.find(u => u.id === id)?.name || '';

// ═══ Sala di lancio ═════════════════════════════════════════════════════════════════════════════════
export async function launchRoom(container, type, id) {
  fill(container, loading());
  const qs = type === 'i' ? `initiative=${id}` : `signal=${id}`;
  const r = await get(`/api/crm/lancio/proposta?${qs}`);
  if (r.already) { location.replace(`#/crm/progetto/${r.already}`); return; }
  const gara = r.kind === 'gara';
  const users = r.users;
  const opts = users.map(u => [u.id, u.name]);
  const sel = (value, attrs = {}) => h('select.pv-sel', attrs, opts.map(([k, l]) => h('option', { value: k, selected: Number(k) === Number(value) }, l)));
  // stato modificabile
  const st = { owner: r.owner_id, team: r.team.map(t => ({ ...t })), phases: r.phases.map(p => ({ title: p.title, tasks: p.tasks.map(t => ({ ...t })) })), goal: { ...r.goal } };

  // ── colonna sinistra: l'opportunità in grande ──
  const tiles = gara
    ? [['Valore', eur(r.amount)], [r.deadline ? 'Scadenza' : 'Bando atteso', r.deadline ? day(r.deadline) : r.expected_on ? day(r.expected_on) : 'da capire'], ['Fase', STAGE_LABEL[r.stage] || 'Programmata'], ['BU', r.bu_label || '—']]
    : [['Budget', eur(r.goal.budget)], ['Clienti target', String(r.targets || 0)], ['Prossimo gate', r.next_gate ? `G${r.next_gate.n}${r.next_gate.due_date ? ` · ${day(r.next_gate.due_date)}` : ''}` : '—'], ['ASA', r.bu_label || '—']];
  const score = Number(r.score) || 0;
  const gauge = () => {
    const C = Math.PI * 44;
    const el = h('div.pv-gauge');
    el.innerHTML = `<svg width="132" height="76" viewBox="0 0 120 70" aria-hidden="true"><defs><linearGradient id="pvg" x1="0" x2="1"><stop offset="0" stop-color="#FFB066"/><stop offset="1" stop-color="#FF8A26"/></linearGradient></defs><path d="M16 64 A44 44 0 0 1 104 64" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="10" stroke-linecap="round"/><path d="M16 64 A44 44 0 0 1 104 64" fill="none" stroke="url(#pvg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * score / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>`;
    el.append(h('b', String(score)), h('small', 'su 100'));
    return el;
  };
  const parts = r.score_parts || {};
  const dotTone = v => (v >= 15 ? 'gr' : v >= 8 ? 'or' : '');
  const timeline = () => {
    const pts = gara ? [['oggi', 0], ['contatto', 22], ['bando', 55], ['offerta', 80], ['esito', 100]] : [['oggi', 0], ['G2', 25], ['G3', 50], ['G4', 75], ['Go', 100]];
    return h('div.pv-tl', h('span.pv-tl-k', 'Linea del tempo'), h('div.pv-tl-bar', h('i', { style: { width: '22%' } }),
      pts.map(([l, x]) => h('span.pv-tl-pt', { style: { left: `${x}%` }, class: x <= 22 ? 'on' : '' }, h('small', l)))));
  };
  const left = h('aside.pv-l',
    h('a.pv-back', { href: gara ? '#/crm/radar' : `#/crm/business/${r.source.id}` }, ic('chevron-left', 14), gara ? 'Radar' : 'Nuovi business'),
    h('div.pv-l-head', h('span.pv-kicker', gara ? `Dal Radar · ${STAGE_LABEL[r.stage] || 'Programmata'}` : 'Da Nuovi business · nuovo settore'),
      h('h1.pv-l-title', r.name), h('div.pv-l-sub', [r.entity, r.place || r.region, r.cig ? `CIG ${r.cig}` : ''].filter(Boolean).join(' · '))),
    h('div.pv-l-tiles', tiles.map(([k, v]) => glassTile(k, v))),
    gara ? h('section.pv-glass.pv-score',
      h('div.pv-row', h('b.pv-grow', 'Punteggio di Alma'), h('small', { class: score >= 70 ? 'gr' : score >= 50 ? 'or' : '' }, score >= 70 ? 'conviene' : score >= 50 ? 'da valutare' : 'debole')),
      gauge(),
      PARTS.filter(([k]) => parts[k] !== undefined).map(([k, l]) => h('div.pv-why', h('span.pv-dot', { class: dotTone(parts[k]) }), h('span.pv-why-k', l), h('span', String(parts[k])))),
      r.warm_paths.length ? h('div.pv-why', h('span.pv-dot.gr'), h('span.pv-why-k', 'Strade calde'), h('span', r.warm_paths.map(p => `${firstName(p.us)} → ${p.contact}`).join(' · ')))
        : h('div.pv-why', h('span.pv-dot'), h('span.pv-why-k', 'Strade calde'), h('span', 'nessuno ci conosce: serve un primo contatto'))) : null,
    !gara && r.description ? h('section.pv-glass.pv-desc', h('span.pv-k', 'L\'idea'), h('p', r.description)) : null,
    timeline());

  // ── centro: squadra e piano ──
  const teamBox = h('div.pv-team');
  const planBox = h('div.pv-plan');
  const drawTeam = () => fill(teamBox,
    h('div.pv-resp', 'Responsabile: ', sel(st.owner, { 'aria-label': 'Responsabile', on: { change: e => { st.owner = Number(e.target.value); drawAll(); } } }),
      (() => { const t = st.team.find(x => x.user_id === st.owner); return t?.why ? h('span', ` · ${t.why}`) : null; })()),
    st.team.filter(t => t.user_id !== st.owner).map(t => h('button.pv-member', { type: 'button', class: t.on ? 'on' : '', 'aria-pressed': String(t.on),
      on: { click: () => { t.on = !t.on; drawAll(); } } },
      ini(t.name, 'lg'), h('span.pv-grow', h('b', t.name), h('small', ` · ${t.role}`), h('span.pv-member-why', t.why)), h('span.pv-check', t.on ? ic('check', 12) : null))),
    (() => {
      const add = h('select.pv-sel.pv-add', { 'aria-label': 'Aggiungi una persona' }, h('option', { value: '' }, '+ persona'),
        users.filter(u => u.id !== st.owner && !st.team.some(t => t.user_id === u.id)).map(u => h('option', { value: u.id }, u.name)));
      add.addEventListener('change', () => { const u = users.find(x => x.id === Number(add.value)); if (u) { st.team.push({ user_id: u.id, name: u.name, role: 'squadra', why: 'aggiunto da te', on: true }); drawAll(); } });
      return add;
    })());
  const phaseColor = i => ['#FF8A26', '#FFB066', '#2C2C2C', '#8A8A8A', '#5A6B7A', '#7A5A6B'][i % 6];
  const drawPlan = () => {
    const n = st.phases.reduce((s, p) => s + p.tasks.length, 0);
    fill(planBox,
      h('div.pv-row.pv-plan-h', h('b.pv-grow', 'Il piano'), h('small', `${st.phases.length} fasi · ${n} compiti · fino all'${gara ? 'esito' : 'ultimo gate'}`)),
      st.phases.map((ph, pi) => h('div.pv-phase',
        h('div.pv-phase-rail', h('span.pv-phase-n', { style: { background: phaseColor(pi) } }, String(pi + 1)), h('i')),
        h('div.pv-phase-b',
          h('input.pv-phase-t', { value: ph.title, 'aria-label': `Nome della fase ${pi + 1}`, on: { input: e => { ph.title = e.target.value; } } }),
          ph.tasks.map((t, ti) => h('div.pv-task',
            h('span.pv-box'),
            h('input.pv-task-t', { value: t.title, 'aria-label': 'Compito', on: { input: e => { t.title = e.target.value; } } }),
            sel(t.owner_id, { class: 'pv-who', 'aria-label': 'Chi', on: { change: e => { t.owner_id = Number(e.target.value); drawAll(); } } }),
            h('input.pv-date', { type: 'date', value: t.due_date || '', 'aria-label': 'Entro', on: { change: e => { t.due_date = e.target.value; } } }),
            h('button.pv-x', { type: 'button', 'aria-label': 'Togli il compito', on: { click: () => { ph.tasks.splice(ti, 1); drawAll(); } } }, ic('x', 12)))),
          h('button.pv-addtask', { type: 'button', on: { click: () => { ph.tasks.push({ title: '', owner_id: st.owner, due_date: addDays(today(), 14) }); drawAll(); planBox.querySelectorAll('.pv-phase')[pi]?.querySelector('.pv-task:last-of-type .pv-task-t')?.focus(); } } }, '+ compito')))),
      h('button.pv-addtask.phase', { type: 'button', on: { click: () => { st.phases.push({ title: 'Nuova fase', tasks: [] }); drawAll(); } } }, '+ fase'));
  };

  // ── destra: obiettivo ──
  const goalBox = h('div.pv-goal');
  const weighted = () => Math.round((Number(st.goal.value) || 0) * (Number(st.goal.probability) || 0) / 100);
  const field = (k, label, suffix) => {
    const i = h('input', { type: 'number', min: 0, step: k === 'value' || k === 'budget' ? 1000 : 1, value: st.goal[k] ?? '', 'aria-label': label });
    i.addEventListener('input', () => { st.goal[k] = Number(i.value) || 0; drawWeighted(); });
    return h('label.pv-gf', h('span', label), h('span.pv-gf-in', i, suffix ? h('small', suffix) : null));
  };
  const wBox = h('div.pv-weighted');
  const drawWeighted = () => {
    if (gara) {
      const margin = Math.round(weighted() * (Number(st.goal.margin) || 0) / 100);
      fill(wBox, h('span.pv-k', 'Valore pesato'), h('b', eur(weighted())),
        h('small', `margine atteso ${eur(margin)} · ${st.goal.hours || 0} h di lavoro${st.goal.hours ? ` = ${eur(Math.round(margin / st.goal.hours))} per ora` : ''}`));
    } else fill(wBox, h('span.pv-k', 'Budget'), h('b', eur(st.goal.budget)), h('small', `${r.spent ? `${eur(r.spent)} già spesi · ` : ''}${st.goal.hours || 0} h di lavoro previste`));
  };
  const effects = h('div.pv-effects');
  const drawEffects = () => {
    const n = st.phases.reduce((s, p) => s + p.tasks.filter(t => t.title.trim()).length, 0);
    const who = new Set(st.phases.flatMap(p => p.tasks.filter(t => t.title.trim()).map(t => t.owner_id)));
    fill(effects, h('b', 'Cosa succede quando lanci'),
      [['folder', 'nasce il progetto in I miei progetti'], ['bell', `${n} compiti arrivano a ${who.size} ${who.size === 1 ? 'persona' : 'persone'} (avviso + email)`],
        gara ? ['building', r.subject_id ? `${r.entity} è collegato al progetto` : `${r.entity} entra nel CRM`] : ['sprout', 'l\'iniziativa resta in Nuovi business, collegata'],
        gara ? ['radar', 'l\'opportunità resta nel Radar con «in corso»'] : ['flag', 'i gate restano decisi dalla direzione']]
        .map(([i, t]) => h('div.pv-eff', h('span', ic(i, 14)), t)));
  };
  const launchBtn = h('button.pv-launch', { type: 'button', on: { click: async () => {
    const phases = st.phases.map(p => ({ title: p.title.trim(), tasks: p.tasks.filter(t => t.title.trim()) })).filter(p => p.tasks.length || p.title);
    if (!phases.some(p => p.tasks.length)) { toast('Serve almeno un compito nel piano', 'error'); return; }
    launchBtn.disabled = true;
    try {
      const out = await post('/api/crm/lancio', { [gara ? 'signal_id' : 'initiative_id']: r.source.id, owner_id: st.owner,
        member_ids: st.team.filter(t => t.on && t.user_id !== st.owner).map(t => t.user_id), phases, goal: st.goal, name: r.name });
      toast(`Progetto lanciato: ${out.tasks} compiti a ${out.people} ${out.people === 1 ? 'persona' : 'persone'}`);
      location.hash = `#/crm/progetto/${out.project_id}`;
    } catch { launchBtn.disabled = false; }
  } } }, ic('check', 16), 'Lancia il progetto');
  fill(goalBox, h('b.pv-goal-t', 'L\'obiettivo'),
    h('div.pv-gfs', gara ? [field('value', 'Valore', '€'), field('probability', 'Probabilità', '%'), field('margin', 'Margine', '%'), field('hours', 'Ore stimate', 'h')]
      : [field('budget', 'Budget', '€'), field('hours', 'Ore stimate', 'h')]),
    wBox, effects, launchBtn, h('small.pv-after', 'si cambia tutto anche dopo, dalla scheda del progetto'));

  function drawAll() { drawTeam(); drawPlan(); drawWeighted(); drawEffects(); }
  fill(container, h('div.pv-launchroom',
    left,
    h('main.pv-c',
      h('div.pv-c-head', h('span.pv-spark', ic('sparkles', 20)),
        h('div.pv-grow', h('h2', 'Lancia il progetto'), h('p', gara ? 'Alma ha preparato squadra e piano dalla scadenza del bando e da chi conosciamo: rivedi e lancia.' : 'Alma ha preparato squadra e piano dai gate dell\'iniziativa: rivedi e lancia.')),
        h('span.pv-stepchips', ['1 · Squadra', '2 · Piano', '3 · Obiettivo'].map((t, i) => h('span', { class: i === 0 ? 'on' : '' }, t)))),
      h('div.pv-c-grid',
        h('section.pv-c-team', h('div.pv-row', h('b.pv-grow', 'La squadra'), h('small', `${st.team.filter(t => t.on).length} persone`)), teamBox),
        h('section.pv-card', planBox))),
    h('aside.pv-r', goalBox)));
  drawAll();
}

// ═══ I miei progetti ════════════════════════════════════════════════════════════════════════════════
let mineView = 'miei';
export async function mieiProgetti(container) {
  fill(container, loading());
  const r = await get(`/api/crm/progetti?vista=${mineView}`);
  const again = () => mieiProgetti(container);
  const gare = r.projects.filter(p => p.kind === 'gara');
  const settori = r.projects.filter(p => p.kind === 'settore');
  const nextDue = p => p.next?.due_date || p.source?.deadline || p.source?.next_gate?.due_date || '9999';
  [gare, settori].forEach(list => list.sort((a, b) => nextDue(a).localeCompare(nextDue(b))));
  const totVal = gare.reduce((s, p) => s + (Number(p.goal.value) || Number(p.source?.amount) || 0), 0);
  const weighted = r.projects.reduce((s, p) => s + p.weighted, 0);
  const todayTasks = r.tasks.filter(t => t.today).length;
  const lateTasks = r.tasks.filter(t => t.late).length;
  const nextGate = settori.map(p => p.source?.next_gate).filter(Boolean).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))[0];
  const now = new Date();
  const hour = Number(now.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
  const hello = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const seg = h('div.pv-seg', [['miei', 'Miei'], ['team', 'Del mio team'], ['tutti', 'Tutti']].map(([k, l]) =>
    h('button', { type: 'button', class: k === mineView ? 'on' : '', 'aria-pressed': String(k === mineView), on: { click: () => { mineView = k; again(); } } }, l)));
  const sentence = [`${mineView === 'miei' ? 'Stai portando avanti' : mineView === 'team' ? 'Nel tuo team ci sono' : 'In tutto ci sono'} ${r.projects.length} ${r.projects.length === 1 ? 'progetto' : 'progetti'}`,
    todayTasks || r.meetings.length ? `oggi ${[todayTasks ? `${todayTasks} ${todayTasks === 1 ? 'compito' : 'compiti'}` : null, r.meetings.length ? `${r.meetings.length} ${r.meetings.length === 1 ? 'incontro' : 'incontri'}` : null].filter(Boolean).join(' e ')}` : null].filter(Boolean).join(': ');

  const ring = (pct, col) => {
    const el = h('span.pv-ring');
    const C = 2 * Math.PI * 20;
    el.innerHTML = `<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="20" fill="none" stroke="var(--cv-ring)" stroke-width="5"/><circle cx="26" cy="26" r="20" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 26 26)"/></svg>`;
    el.append(h('b', `${pct}%`));
    return el;
  };
  const tile = p => {
    const g = p.kind === 'gara';
    const col = g ? '#FF8A26' : '#3A3835';
    const amount = Number(p.goal.value) || Number(p.source?.amount) || 0;
    const meta = g ? (p.source?.deadline ? (daysTo(p.source.deadline) >= 0 ? `gara chiude in ${daysTo(p.source.deadline)} giorni` : 'gara chiusa')
      : p.source?.expected_on ? `bando atteso ${day(p.source.expected_on)}` : p.goal.probability ? `probabilità ${p.goal.probability}%` : '')
      : p.source?.next_gate ? `G${p.source.next_gate.n}${p.source.next_gate.due_date ? ` il ${day(p.source.next_gate.due_date)}` : ''}` : '';
    return h('a.pv-tile', { href: `#/crm/progetto/${p.id}`, class: g ? 'gara' : 'settore' },
      h('span.pv-band'),
      h('div.pv-tile-b',
        h('div.pv-row.top', h('div.pv-grow', h('span.pv-tile-k', `${g ? 'Gara' : 'Nuovo settore'}${p.source?.bu_label ? ` · ${p.source.bu_label}` : ''}`), h('b.pv-tile-t', p.name),
          h('small', g ? [p.source?.entity, amount ? eur(amount) : null].filter(Boolean).join(' · ') : [p.source?.budget ? `budget ${eur(p.source.budget)}` : null, `${p.tasks_total} compiti`].filter(Boolean).join(' · '))),
        ring(p.pct, col)),
        h('div.pv-steps', p.steps.map((_, i) => h('i', { class: i < p.step ? 'done' : i === p.step ? 'now' : '' }))),
        h('div.pv-row', h('b.pv-step-l', p.steps[p.step]), h('span.pv-grow'), p.tasks_late ? h('span.pv-flag', `${p.tasks_late} in ritardo`) : null),
        h('div.pv-next', h('span.pv-k', 'Prossimo'), h('span', p.next ? [p.next.title, firstName(p.next.who), p.next.due_date ? (p.next.due_date === today() ? 'oggi' : day(p.next.due_date)) : null].filter(Boolean).join(' · ') : 'nessun compito aperto')),
        h('div.pv-row', inis(p.team.map(t => t.name)), h('span.pv-grow'), h('small', meta))));
  };
  const addTile = () => h('a.pv-tile.add', { href: '#/crm/radar' }, h('span.pv-add-ic', ic('plus', 18)), h('b', 'Porta avanti un\'opportunità'), h('small', 'dal Radar o da Nuovi business'));
  const section = (title, sub, list, withAdd) => [
    h('div.pv-sec', h('b', title), h('span', ` · ${list.length} · ${sub}`), h('span.pv-grow'), list.length > 1 ? h('small', 'per prossima scadenza') : null),
    h('div.pv-tiles', list.map(tile), withAdd || !list.length ? addTile() : null)];

  // la mia giornata: incontri e compiti di oggi in ordine di ora
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const agenda = [
    ...r.meetings.map(m => ({ time: String(m.start_at).slice(11, 16), t: m.subject || 'Incontro', sub: m.project_name, k: 'inc', min: Number(String(m.start_at).slice(11, 13)) * 60 + Number(String(m.start_at).slice(14, 16)), href: `#/crm/progetto/${m.project_id}/incontri` })),
    ...r.tasks.filter(t => t.today || t.late).map(t => ({ time: t.late ? 'ritardo' : 'oggi', t: t.title, sub: t.project_name, k: t.late ? 'late' : 'task', min: t.late ? -1 : 24 * 60, ticket: t.id })),
  ].sort((a, b) => a.min - b.min);
  const nowIdx = agenda.findIndex(a => a.k === 'inc' && a.min >= nowMin - 30);
  const dayBox = h('section.pv-side',
    h('div.pv-row', h('b.pv-grow', 'La mia giornata'), h('small', now.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric' }))),
    agenda.length ? agenda.map((a, i) => h(a.href ? 'a.pv-ag' : 'button.pv-ag', { type: a.href ? undefined : 'button', href: a.href, class: `${a.k} ${i === nowIdx ? 'now' : ''}`,
      on: a.ticket ? { click: () => openTicket(a.ticket, { onSaved: again }) } : undefined },
      h('span.pv-ag-time', a.time), h('span.pv-ag-dot'), h('span.pv-ag-b', h('b', a.t), h('small', a.sub))))
      : h('p.pv-empty', 'Oggi niente in agenda nei tuoi progetti.'));
  const tasksBox = h('section.pv-side',
    h('div.pv-row', h('b.pv-grow', 'I miei compiti'), h('small', `questa settimana · ${r.tasks.length}`)),
    r.tasks.length ? r.tasks.slice(0, 12).map(t => h('div.pv-todo',
      h('button.pv-todo-box', { type: 'button', 'aria-label': `Segna fatto: ${t.title}`, title: 'Segna fatto', on: { click: async e => {
        e.currentTarget.disabled = true;
        await api('PATCH', `/api/tickets/${t.id}`, { status: 'done' });
        toast('Fatto'); again();
      } } }),
      h('button.pv-todo-b', { type: 'button', on: { click: () => openTicket(t.id, { onSaved: again }) } }, h('b', t.title), h('small', t.project_name)),
      h('span.pv-todo-d', { class: t.late ? 'late' : t.today ? 'today' : '' }, t.late ? 'in ritardo' : t.today ? 'oggi' : t.due_date ? day(t.due_date) : '—')))
      : h('p.pv-empty', 'Nessun compito per questa settimana.'));

  fill(container, h('div.pv-mine',
    h('div.pv-mine-main',
      h('section.pv-hero',
        h('div.pv-row.top', h('div.pv-grow',
          h('span.pv-kicker', now.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })),
          h('h1.pv-h1', `${hello} ${firstName(store.me.name)}`), h('p.pv-hero-sub', `${sentence}.`)), seg),
        h('div.pv-glasses',
          glassTile('Gare che seguo', String(gare.length), totVal ? `${eur(totVal)} di valore` : 'dal Radar'),
          glassTile('Nuovi settori', String(settori.length), nextGate ? `G${nextGate.n}${nextGate.due_date ? ` il ${day(nextGate.due_date)}` : ''}` : 'da Nuovi business'),
          glassTile('Valore pesato', weighted ? eur(weighted) : '—', mineView === 'miei' ? 'il mio portafoglio' : 'del portafoglio', 'or'),
          glassTile('Compiti', `${todayTasks} oggi`, lateTasks ? `${lateTasks} in ritardo` : 'nessun ritardo', lateTasks ? 'rd' : ''))),
      section('Gare che seguo', 'dal Radar', gare, false),
      section('Nuovi settori', 'da Nuovi business', settori, true)),
    h('div.pv-mine-side', dayBox, tasksBox)));
}

// ═══ Scheda del progetto del CRM ════════════════════════════════════════════════════════════════════
export async function crmProjectPage(container, id) {
  fill(container, loading());
  let info = await get(`/api/crm/progetti/${id}`);
  const base = `#/crm/progetto/${id}`;
  const gara = info.kind === 'gara';
  const accent = gara ? '#FF8A26' : '#FFB066';
  const tabs = [['panoramica', 'Panoramica'], ['compiti', 'Compiti'], ['relazioni', 'Relazioni'], ['incontri', 'Incontri'], ['calendario', 'Calendario'],
    ['note', 'Note'], ['gantt', 'Gantt'], ['rendiconto', 'Rendiconto'], ['documenti', 'Documenti'], ['email', 'Email'], ['membri', 'Membri']];
  const canEdit = p => p.my_role && p.my_role !== 'viewer';

  const hero = ({ p, reload, show, canManage }) => {
    const s = info.source || {};
    const chips = gara
      ? [s.bu_label, eur(info.goal.value || s.amount), s.deadline ? `scade ${day(s.deadline)}` : s.expected_on ? `bando atteso ${day(s.expected_on)}` : null, s.score ? `punteggio ${s.score}` : null]
      : [s.bu_label, info.goal.budget ? `budget ${eur(info.goal.budget)}` : null, s.next_gate ? `G${s.next_gate.n}${s.next_gate.due_date ? ` · ${day(s.next_gate.due_date)}` : ''}` : null];
    const hoursGoal = Number(info.goal.hours) || 0;
    const kpis = gara
      ? [['Compiti', `${info.tasks_done} / ${info.tasks_total}`, info.tasks_late ? `${info.tasks_late} in ritardo` : 'nessun ritardo'],
        ['Ore', `${info.hours} / ${hoursGoal} h`, hoursGoal ? `${Math.round(100 * info.hours / hoursGoal)}% del budget` : 'budget di ore non fissato'],
        ['Valore pesato', eur(info.weighted), info.goal.probability ? `probabilità ${info.goal.probability}%` : 'probabilità da fissare'],
        ['Prossimo', info.next?.due_date ? day(info.next.due_date) : '—', info.next?.title || 'nessun compito aperto']]
      : [['Compiti', `${info.tasks_done} / ${info.tasks_total}`, info.tasks_late ? `${info.tasks_late} in ritardo` : 'nessun ritardo'],
        ['Ore', `${info.hours} h`, `${info.team.length} ${info.team.length === 1 ? 'persona' : 'persone'}`],
        ['Budget', `${s.spent ? eur(s.spent) : '€ 0'} / ${eur(info.goal.budget || s.budget)}`, (info.goal.budget || s.budget) ? `${Math.round(100 * (s.spent || 0) / (info.goal.budget || s.budget))}% speso` : ''],
        ['Prossimo gate', s.next_gate ? `G${s.next_gate.n}` : '—', s.next_gate?.due_date ? `${day(s.next_gate.due_date)} · direzione` : 'da fissare']];
    const member = canEdit(p);
    const stepper = h('div.pv-stepper', info.steps.map((label, i) => h(member ? 'button' : 'div', {
      type: member ? 'button' : undefined, class: i < info.step ? 'done' : i === info.step ? 'now' : '', title: member ? `Siamo a «${label}»` : undefined,
      on: member ? { click: async () => { info = { ...info, ...(await api('PATCH', `/api/crm/progetti/${id}`, { step: i })) }; reload(); } } : undefined,
    }, h('i'), h('span', label))));
    return h('section.pv-hero.pv-phero', { class: gara ? 'gara' : 'settore', style: { '--acc': accent } },
      h('div.pv-row.top',
        h('div.pv-grow',
          h('a.pv-back.light', { href: '#/crm/progetti' }, ic('chevron-left', 14), 'I miei progetti'),
          h('span.pv-kicker', gara ? 'Dal Radar · gara' : 'Da Nuovi business · nuovo settore'),
          h('h1.pv-ptitle', p.name),
          h('p.pv-hero-sub', [s.entity, `responsabile ${info.owner_name || '—'}`].filter(Boolean).join(' · ')),
          h('div.pv-chips', chips.filter(Boolean).map(c => h('span', c)),
            s.type === 'signal' ? h('a', { href: '#/crm/radar', title: 'Apri il Radar' }, ic('radar', 12), 'nel Radar') : s.type === 'initiative' ? h('a', { href: `#/crm/business/${s.id}` }, ic('sprout', 12), 'l\'iniziativa') : null)),
        h('div.pv-hero-r',
          inis(info.team.map(t => t.name), 5),
          h('div.pv-hero-act',
            h('a.pv-ghost', { href: `/api/crm/progetti/${id}/rendiconto?formato=csv`, download: '' }, ic('download', 13), 'Rendiconto'),
            canManage ? h('button.pv-ghost', { type: 'button', on: { click: () => editProject(p, reload) } }, ic('pencil', 13), 'Modifica') : null,
            member ? h('button.pv-ghost.pri', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: p.id, assignee_ids: [store.me.id] }, onSaved: () => { refreshInfo().then(reload); } }) } }, ic('plus', 13), 'Nuovo compito') : null))),
      stepper,
      h('div.pv-glasses', kpis.map(([k, v, s2]) => glassTile(k, v, s2))));
  };
  const refreshInfo = async () => { info = await get(`/api/crm/progetti/${id}`); };

  // ── Panoramica: questa settimana, compiti a colonne, incontri e note ──
  const overview = async (box, { p, show, reload }) => {
    const changed = async () => { await refreshInfo(); reload(); };
    const [tickets, meetings, notes] = await Promise.all([
      get(`/api/tickets?project=${p.id}`), get(`/api/projects/${p.id}/meetings`, { quiet: true }).catch(() => []), get(`/api/projects/${p.id}/notes`, { quiet: true }).catch(() => [])]);
    const card = (icon, title, body, right) => h('section.pv-card.pv-ocard', h('div.pv-row.pv-ocard-h', h('span.pv-oic', ic(icon, 14)), h('b.pv-grow', title), right || null), body);
    const linkBtn = (label, k) => h('button.pv-lnk', { type: 'button', on: { click: () => show(k) } }, label);
    box.append(h('div.pv-over',
      card('calendar', 'Questa settimana', weekStrip(tickets, meetings, p, 0, { compact: true }), linkBtn('Apri il calendario', 'calendario')),
      card('check', 'Compiti', taskBoard(tickets, p, changed, { max: 3 }), canEdit(p) ? h('button.pv-lnk', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: p.id, assignee_ids: [store.me.id] }, onSaved: changed }) } }, '+ compito') : linkBtn('Tutti', 'compiti')),
      h('div.pv-over2',
        card('users', 'Incontri', meetingList(meetings.slice().sort((a, b) => String(b.start_at).localeCompare(String(a.start_at))).slice(0, 4), p, () => show('panoramica')), linkBtn('Tutti', 'incontri')),
        card('file-text', 'Note', noteList(notes.slice(0, 3)), linkBtn(canEdit(p) ? '+ nota' : 'Tutte', 'note')))));
  };

  const extraTabs = [
    ['compiti', 'Compiti', async (box, reload) => {
      // dopo una modifica si ridisegna tutta la scheda, così anche i numeri della testata sono aggiornati
      const changed = async () => { await refreshInfo(); reload(); };
      const draw = async () => fill(box, h('div.pv-tabhead', h('div', h('h3', 'Compiti'), h('p', 'Trascina un compito per cambiarne lo stato. Chi viene assegnato riceve l\'avviso.')),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: id, assignee_ids: [store.me.id] }, onSaved: changed }) } }, ic('plus', 15), 'Nuovo compito')),
        taskBoard(await get(`/api/tickets?project=${id}`), { id }, changed, { drag: true }));
      fill(box, loading()); await draw();
    }],
    ['relazioni', 'Relazioni', async box => relationsTab(box, id, info, async () => { await refreshInfo(); })],
    ['calendario', 'Calendario', async box => calendarTab(box, id)],
    ['rendiconto', 'Rendiconto', async box => reportTab(box, id)],
  ];
  return projectDetail(container, id, { base, crumb: { href: '#/crm/progetti', label: 'I miei progetti' }, tabs, extraTabs, hero, overview });
}

// ── pezzi della scheda ──────────────────────────────────────────────────────────────────────────────
function weekStrip(tickets, meetings, p, offset = 0, { compact = false } = {}) {
  const t0 = new Date(`${today()}T12:00:00Z`);
  const monday = addDays(today(), -((t0.getUTCDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: compact ? 5 : 7 }, (_, i) => addDays(monday, i));
  return h('div.pv-week', { class: compact ? '' : 'full' }, days.map(d => {
    const dd = new Date(`${d}T12:00:00Z`);
    const items = [
      ...meetings.filter(m => String(m.start_at).slice(0, 10) === d).map(m => ({ k: 'inc', t: `${String(m.start_at).slice(11, 16)} ${m.subject || 'Incontro'}`, on: () => openMeeting(m.id, p) })),
      ...tickets.filter(t => t.due_date === d).map(t => ({ k: t.status === 'done' ? 'done' : t.due_date < today() ? 'sca' : 'tsk', t: t.title, on: () => openTicket(t.id, {}) })),
    ];
    return h('div.pv-day', { class: d === today() ? 'today' : '' },
      h('div.pv-row', h('b.pv-grow', `${dd.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' })} ${dd.getUTCDate()}`), d === today() ? h('small', 'oggi') : null),
      items.length ? items.map(it => h('button.pv-ev', { type: 'button', class: it.k, on: { click: it.on } }, it.k === 'inc' ? ic('users', 11) : it.k === 'sca' ? ic('flag', 11) : it.k === 'done' ? ic('check', 11) : h('span.pv-evbox'), h('span', it.t))) : null);
  }));
}

function taskBoard(tickets, p, onChange, { max = 0, drag = false } = {}) {
  const cols = [['todo', 'Da fare', t => t.status === 'todo'], ['doing', 'In corso', t => t.status === 'doing' || t.status === 'review'], ['done', 'Fatti', t => t.status === 'done']];
  return h('div.pv-board', cols.map(([k, label, f]) => {
    const list = tickets.filter(f).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    const shown = max ? (k === 'done' ? list.slice().reverse().slice(0, max - 1) : list.slice(0, max)) : list;
    const col = h('div.pv-bcol', { class: k },
      h('div.pv-row', h('b.pv-grow', label), h('small', String(list.length))),
      shown.map(t => h('button.pv-bcard', { type: 'button', draggable: drag ? 'true' : undefined, 'data-id': String(t.id),
        on: { click: () => openTicket(t.id, { onSaved: onChange }), dragstart: e => { e.dataTransfer.setData('text/plain', String(t.id)); e.currentTarget.classList.add('drag'); }, dragend: e => e.currentTarget.classList.remove('drag') } },
        h('span.pv-bcard-t', t.title),
        h('span.pv-row', inis((t.assignee_ids || []).map(userName).filter(Boolean), 3), h('span.pv-grow'),
          t.due_date ? h('small', { class: t.status !== 'done' && t.due_date < today() ? 'late' : '' }, day(t.due_date)) : null))),
      max && list.length > shown.length ? h('small.pv-more', `e altri ${list.length - shown.length}`) : null,
      !list.length ? h('p.pv-empty', k === 'done' ? 'Ancora niente.' : 'Niente qui.') : null);
    if (drag) {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', async e => {
        e.preventDefault(); col.classList.remove('over');
        const t = tickets.find(x => String(x.id) === e.dataTransfer.getData('text/plain'));
        if (!t || f(t)) return;
        await api('PATCH', `/api/tickets/${t.id}`, { status: k });
        toast(`«${t.title}» → ${label}`);
        onChange?.();
      });
    }
    return col;
  }));
}

function meetingList(list, p, onChange) {
  if (!list.length) return h('p.pv-empty', 'Nessun incontro collegato. Collegali dal tab Incontri, dal calendario di Outlook.');
  return h('div', list.map(m => {
    const d = new Date(`${String(m.start_at).slice(0, 10)}T12:00:00Z`);
    const past = String(m.start_at).slice(0, 10) <= today();
    return h('button.pv-meet', { type: 'button', on: { click: () => openMeeting(m.id, p, onChange) } },
      h('span.pv-meet-d', h('b', String(d.getUTCDate())), h('small', d.toLocaleDateString('it-IT', { month: 'short', timeZone: 'UTC' }))),
      h('span.pv-grow', h('b', m.subject || 'Incontro'), h('small', meetingWhen(m))),
      past && !m.note_count ? h('span.pv-bang', { title: 'Incontro fatto senza note' }, '!') : m.online_url ? h('span.pv-teams', 'Teams') : m.note_count ? h('small.pv-ok', ic('check', 11), 'note') : null);
  }));
}

function noteList(list) {
  if (!list.length) return h('p.pv-empty', 'Ancora nessuna nota.');
  const KIND = { telefonata: 'telefonata', riunione: 'riunione', decisione: 'decisione' };
  return h('div', list.map(n => h('div.pv-note', ini(userName(n.author_id)),
    h('div', h('div.pv-row', h('b', firstName(userName(n.author_id)) || '—'), h('small', n.note_date ? day(n.note_date) : ''), KIND[n.kind] ? h('span.pv-tag', KIND[n.kind]) : null),
      h('p', (n.title ? `${n.title}: ` : '') + String(n.body || '').slice(0, 220))))));
}

async function calendarTab(box, id) {
  let offset = 0;
  const p = { id };
  const [tickets, meetings] = await Promise.all([get(`/api/tickets?project=${id}`), get(`/api/projects/${id}/meetings`, { quiet: true }).catch(() => [])]);
  const draw = () => {
    const t0 = new Date(`${today()}T12:00:00Z`);
    const monday = addDays(today(), -((t0.getUTCDay() + 6) % 7) + offset * 7);
    fill(box, h('div.pv-tabhead', h('div', h('h3', 'Calendario'), h('p', 'Incontri (da Outlook e Teams), compiti e scadenze del progetto, settimana per settimana.')),
      h('div.pv-row', h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana prima', on: { click: () => { offset -= 1; draw(); } } }, ic('chevron-left', 14)),
        h('b.pv-weeklabel', `${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}`),
        h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana dopo', on: { click: () => { offset += 1; draw(); } } }, ic('chevron-right', 14)),
        offset ? h('button.btn.btn-sm', { type: 'button', on: { click: () => { offset = 0; draw(); } } }, 'Oggi') : null)),
      h('section.pv-card', weekStrip(tickets, meetings, p, offset)),
      h('div.pv-legend', h('span.inc', 'incontro'), h('span.tsk', 'compito'), h('span.sca', 'scaduto'), h('span.done', 'fatto')));
  };
  draw();
}

async function relationsTab(box, id, info, onChange) {
  const draw = async () => {
    const r = await get(`/api/crm/progetti/${id}`);
    const search = h('input.input', { type: 'search', placeholder: 'Collega un\'azienda, un ente o una persona del CRM…', 'aria-label': 'Cerca nel CRM' });
    const results = h('div.pv-results');
    search.addEventListener('input', debounce(async () => {
      const q = search.value.trim();
      if (q.length < 2) { fill(results); return; }
      const [{ subjects = [] }, contacts] = await Promise.all([get(`/api/crm/subjects?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({})), get(`/api/crm/contacts?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => [])]);
      const people = Array.isArray(contacts) ? contacts : contacts.contacts || [];
      fill(results, [...subjects.slice(0, 6).map(s => ['subjects', s.id, s.name, (s.roles || []).join(', ') || 'azienda']),
        ...people.slice(0, 6).map(c => ['contacts', c.id, [c.first_name, c.last_name].filter(Boolean).join(' '), c.subject_name || c.email || 'persona'])]
        .map(([target, tid, name, sub]) => h('button.pv-res', { type: 'button', on: { click: async () => {
          await post(`/api/crm/${target}/${tid}/projects`, { project_id: id });
          toast(`${name} collegato al progetto`); await onChange?.(); draw();
        } } }, ic(target === 'subjects' ? 'building' : 'user', 14), h('b', name), h('small', sub))));
    }, 250));
    fill(box, h('div.pv-tabhead', h('div', h('h3', 'Relazioni'), h('p', 'Enti, clienti, partner e persone collegati a questo progetto. Si vedono anche nella loro scheda del CRM.'))),
      h('section.pv-card', h('div.pv-relsearch', ic('search', 14), search), results,
        r.links.length ? h('div.pv-rels', r.links.map(l => {
          const subj = Boolean(l.subject_id);
          return h('div.pv-rel', h('span.pv-oic', ic(subj ? 'building' : 'user', 14)),
            h('a.pv-grow', { href: subj ? `#/crm/scheda/${l.subject_id}` : `#/crm/contatti/${l.contact_id}` }, h('b', subj ? l.subject_name : l.contact_name), h('small', subj ? (l.roles || []).join(', ') || 'azienda' : 'persona')),
            h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Scollega', title: 'Scollega dal progetto', on: { click: async () => {
              await del(`/api/crm/${subj ? 'subjects' : 'contacts'}/${subj ? l.subject_id : l.contact_id}/projects/${id}`);
              await onChange?.(); draw();
            } } }, ic('x', 14)));
        })) : h('p.pv-empty', 'Ancora nessun collegamento.')));
  };
  fill(box, loading());
  await draw();
}

async function reportTab(box, id) {
  fill(box, loading());
  const r = await get(`/api/crm/progetti/${id}/rendiconto`);
  const p = r.project;
  const gara = p.kind === 'gara';
  const STATO = { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' };
  const vs = (k, goal, done, sub) => h('div.pv-vs', h('span.pv-k', k), h('div.pv-row', h('b', done), goal !== null ? h('small', `obiettivo ${goal}`) : null), sub ? h('small', sub) : null);
  const phases = [...new Set(r.tasks.map(t => t.phase || 0))].sort((a, b) => (a || 99) - (b || 99));
  fill(box,
    h('div.pv-tabhead', h('div', h('h3', 'Rendiconto'), h('p', 'L\'obiettivo fissato al lancio contro quello che è stato fatto: compiti, ore, incontri e note.')),
      h('a.btn', { href: `/api/crm/progetti/${id}/rendiconto?formato=csv`, download: '' }, ic('download', 15), 'Scarica (Excel)')),
    h('div.pv-vss',
      vs('Compiti fatti', p.tasks_total, `${p.tasks_done}`, p.tasks_late ? `${p.tasks_late} in ritardo` : 'nessun ritardo'),
      vs('Ore', `${p.goal.hours || 0} h`, `${p.hours} h`, p.goal.hours ? `${Math.round(100 * p.hours / p.goal.hours)}% del budget di ore` : ''),
      gara ? vs('Valore in gioco', null, eur(p.goal.value), `pesato ${eur(p.weighted)} · probabilità ${p.goal.probability || 0}% · margine ${p.goal.margin || 0}%`)
        : vs('Budget', eur(p.goal.budget), eur(p.source?.spent || 0), 'speso finora'),
      vs('Incontri e note', null, `${r.meetings} · ${r.notes}`, 'collegati al progetto')),
    h('div.pv-report',
      h('section.pv-card', h('b.pv-card-t', 'Compiti per fase'),
        phases.map(ph => [h('div.pv-sect', ph ? `Fase ${ph}` : 'Senza fase'),
          r.tasks.filter(t => (t.phase || 0) === ph).map(t => h('div.pv-rrow', { class: t.status },
            h('span.pv-rst', STATO[t.status] || t.status), h('span.pv-grow', t.title), h('small', t.who), h('small', t.due_date ? day(t.due_date) : '—'), h('small', t.hours ? `${t.hours} h` : '')))])),
      h('section.pv-card', h('b.pv-card-t', 'Chi ha fatto cosa'),
        r.people.length ? r.people.map(u => h('div.pv-rrow', ini(u.name), h('span.pv-grow', u.name), h('small', `${u.done}/${u.tasks} compiti`), h('small', `${u.hours} h`))) : h('p.pv-empty', 'Nessun compito assegnato.'))));
}
