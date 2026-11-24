// «Porta avanti», «I miei progetti» e la scheda del progetto del CRM (canvas v9 approvato da Dante il 19/11/2026:
// «Porta avanti», «I miei progetti», «Il progetto»). Il progetto è un progetto vero di Alma Space: la scheda usa
// projectDetail con la testata scura del CRM e i tab Panoramica · Compiti · Relazioni · Incontri · Calendario · Note ·
// Gantt · Rendiconto · Documenti (più Email e Membri in fondo).
import { h, fill, toast, loading, fmtDate, initials, debounce, today, addDays, modal } from './ui.js';
import { get, post, api, del } from './api.js';
import { store } from './store.js';
import { ic } from './crm-v2.js';
import { openTicket } from './tickets.js';
import { projectDetail, editProject } from './projects.js';
import { openMeeting, meetingWhen } from './project-meetings.js';
import { loadDeal, dealHero, dealOverview } from './crm-posta.js';

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
  const trattativa = r.kind === 'trattativa'; // nata da una email (ALM2-55, tavola C)
  const fromSignal = r.source.type === 'signal';
  const money = gara || trattativa;
  const users = r.users;
  const opts = users.map(u => [u.id, u.name]);
  const sel = (value, attrs = {}) => h('select.pv-sel', attrs, opts.map(([k, l]) => h('option', { value: k, selected: Number(k) === Number(value) }, l)));
  // stato modificabile
  const st = { owner: r.owner_id, team: r.team.map(t => ({ ...t })), phases: r.phases.map(p => ({ title: p.title, tasks: p.tasks.map(t => ({ ...t })) })), goal: { ...r.goal } };

  // ── colonna sinistra: l'opportunità in grande ──
  const tiles = trattativa
    ? [['Valore', eur(r.amount)], ['Offerte entro', r.deadline ? day(r.deadline) : 'da capire'], ['Prossimo passo', r.concept?.prossimo_passo || '—'], ['BU', r.bu_label || '—']]
    : gara
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
    const pts = trattativa ? [['oggi', 0], ['incontro', 22], ['sopralluogo', 45], ['offerta', 80], ['esito', 100]] : gara ? [['oggi', 0], ['contatto', 22], ['bando', 55], ['offerta', 80], ['esito', 100]] : [['oggi', 0], ['G2', 25], ['G3', 50], ['G4', 75], ['Go', 100]];
    return h('div.pv-tl', h('span.pv-tl-k', 'Linea del tempo'), h('div.pv-tl-bar', h('i', { style: { width: '22%' } }),
      pts.map(([l, x]) => h('span.pv-tl-pt', { style: { left: `${x}%` }, class: x <= 22 ? 'on' : '' }, h('small', l)))));
  };
  const left = h('aside.pv-l',
    h('a.pv-back', { href: fromSignal ? (r.source.email ? '#/crm/posta' : '#/crm/radar') : `#/crm/business/${r.source.id}` }, ic('chevron-left', 14), fromSignal ? (r.source.email ? 'Posta' : 'Radar') : 'Nuovi business'),
    h('div.pv-l-head', h('span.pv-kicker', trattativa ? 'Sala di lancio · nata da una email' : r.source.email ? 'Da una email · gara' : gara ? `Dal Radar · ${STAGE_LABEL[r.stage] || 'Programmata'}` : 'Da Nuovi business · nuovo settore'),
      h('h1.pv-l-title', r.name), h('div.pv-l-sub', [r.entity, r.place || r.region, r.cig ? `CIG ${r.cig}` : ''].filter(Boolean).join(' · '))),
    h('div.pv-l-tiles', tiles.map(([k, v]) => glassTile(k, v))),
    r.source.email ? h('section.pv-glass.pv-desc.pv-concept', h('span.pv-k', 'Cosa ha capito Alma dalla email'),
      [['Cosa', r.concept?.cosa], ['Dove', r.concept?.dove || r.place], ['Per chi', r.concept?.per_chi || r.concept?.committente], ['Tempi', r.concept?.tempi]].filter(([, x]) => x).map(([k, x]) => h('p', h('b', `${k}: `), x)),
      r.warm_paths.length ? h('div.pv-why', h('span.pv-dot.gr'), h('span.pv-why-k', 'Strade calde'), h('span', r.warm_paths.map(p => `${firstName(p.us)} → ${p.contact}`).join(' · '))) : null) : null,
    gara && !r.source.email ? h('section.pv-glass.pv-score',
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
      h('div.pv-row.pv-plan-h', h('b.pv-grow', 'Il piano'), h('small', `${st.phases.length} fasi · ${n} compiti · fino all'${money ? 'esito' : 'ultimo gate'}`)),
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
    if (money) {
      const margin = Math.round(weighted() * (Number(st.goal.margin) || 0) / 100);
      fill(wBox, h('span.pv-k', 'Valore pesato'), h('b', eur(weighted())),
        h('small', `margine atteso ${eur(margin)} · ${st.goal.hours || 0} h di lavoro${st.goal.hours ? ` = ${eur(Math.round(margin / st.goal.hours))} per ora` : ''}`));
    } else fill(wBox, h('span.pv-k', 'Budget'), h('b', eur(st.goal.budget)), h('small', `${r.spent ? `${eur(r.spent)} già spesi · ` : ''}${st.goal.hours || 0} h di lavoro previste`));
  };
  const effects = h('div.pv-effects');
  const drawEffects = () => {
    const who = new Set(st.phases.flatMap(p => p.tasks.filter(t => t.title.trim()).map(t => t.owner_id)));
    fill(effects, h('b', 'Cosa succede quando lanci'),
      [['folder', 'nasce il progetto in I miei progetti'], ['users', `${who.size} ${who.size === 1 ? 'persona del piano entra' : 'persone del piano entrano'} nella squadra (i ticket li crea chi ci lavora)`],
        money ? ['building', r.subject_id ? `${r.entity} è collegato al progetto` : `${r.entity} entra nel CRM`] : ['sprout', 'l\'iniziativa resta in Nuovi business, collegata'],
        r.source.email ? ['mail', r.source.mail_owner_id && r.source.mail_owner_id !== store.me.id ? `le email sono nella casella di ${userName(r.source.mail_owner_id) || 'un collega'}: entrano solo dopo il suo sì` : r.source.mail_mode === 'auto' ? 'le email che hai scelto entrano nel progetto e le risposte nuove si aggiungono da sole' : 'le email che hai scelto entrano nel progetto; le risposte nuove aspettano il tuo sì in Posta › Da approvare'] : gara ? ['radar', 'l\'opportunità resta nel Radar con «in corso»'] : ['flag', 'i gate restano decisi dalla direzione']]
        .map(([i, t]) => h('div.pv-eff', h('span', ic(i, 14)), t)));
  };
  const launchBtn = h('button.pv-launch', { type: 'button', on: { click: async () => {
    const phases = st.phases.map(p => ({ title: p.title.trim(), tasks: p.tasks.filter(t => t.title.trim()) })).filter(p => p.tasks.length || p.title);
    launchBtn.disabled = true;
    try {
      const out = await post('/api/crm/lancio', { [fromSignal ? 'signal_id' : 'initiative_id']: r.source.id, owner_id: st.owner,
        member_ids: st.team.filter(t => t.on && t.user_id !== st.owner).map(t => t.user_id), phases, goal: st.goal, name: r.name });
      toast(`Progetto lanciato${out.mail?.copied ? ` · ${out.mail.copied} email nel progetto` : ''}${out.mail?.pending ? ` · ${out.mail.pending} email aspettano il sì di chi le ha ricevute` : ''}`);
      location.hash = `#/crm/progetto/${out.project_id}`;
    } catch { launchBtn.disabled = false; }
  } } }, ic('check', 16), 'Lancia il progetto');
  fill(goalBox, h('b.pv-goal-t', 'L\'obiettivo'),
    h('div.pv-gfs', money ? [field('value', 'Valore', '€'), field('probability', 'Probabilità', '%'), field('margin', 'Margine', '%'), field('hours', 'Ore stimate', 'h')]
      : [field('budget', 'Budget', '€'), field('hours', 'Ore stimate', 'h')]),
    wBox, effects, launchBtn, h('small.pv-after', 'si cambia tutto anche dopo, dalla scheda del progetto'));

  function drawAll() { drawTeam(); drawPlan(); drawWeighted(); drawEffects(); }
  fill(container, h('div.pv-launchroom',
    left,
    h('main.pv-c',
      h('div.pv-c-head', h('span.pv-spark', ic('sparkles', 20)),
        h('div.pv-grow', h('h2', 'Lancia il progetto'), h('p', trattativa ? 'Alma ha preparato squadra e piano dalla email: date, prossimo passo e colleghi in copia. Rivedi e lancia.' : gara ? 'Alma ha preparato squadra e piano dalla scadenza del bando e da chi conosciamo: rivedi e lancia.' : 'Alma ha preparato squadra e piano dai gate dell\'iniziativa: rivedi e lancia.')),
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
  const trattative = r.projects.filter(p => p.kind === 'trattativa'); // nate dalle email (ALM2-55)
  const nextDue = p => p.next?.due_date || p.source?.deadline || p.source?.next_gate?.due_date || '9999';
  [gare, settori, trattative].forEach(list => list.sort((a, b) => nextDue(a).localeCompare(nextDue(b))));
  const totVal = [...gare, ...trattative].reduce((s, p) => s + (Number(p.goal.value) || Number(p.source?.amount) || 0), 0);
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
    const tr = p.kind === 'trattativa';
    const g = p.kind === 'gara' || tr;
    const col = g ? '#FF8A26' : '#3A3835';
    const amount = Number(p.goal.value) || Number(p.source?.amount) || 0;
    const meta = tr ? (p.source?.deadline ? (daysTo(p.source.deadline) >= 0 ? `offerte tra ${daysTo(p.source.deadline)} giorni` : 'offerte scadute') : p.goal.probability ? `probabilità ${p.goal.probability}%` : '')
      : g ? (p.source?.deadline ? (daysTo(p.source.deadline) >= 0 ? `gara chiude in ${daysTo(p.source.deadline)} giorni` : 'gara chiusa')
      : p.source?.expected_on ? `bando atteso ${day(p.source.expected_on)}` : p.goal.probability ? `probabilità ${p.goal.probability}%` : '')
      : p.source?.next_gate ? `G${p.source.next_gate.n}${p.source.next_gate.due_date ? ` il ${day(p.source.next_gate.due_date)}` : ''}` : '';
    return h('a.pv-tile', { href: `#/crm/progetto/${p.id}`, class: g ? 'gara' : 'settore' },
      h('span.pv-band'),
      h('div.pv-tile-b',
        h('div.pv-row.top', h('div.pv-grow', h('span.pv-tile-k', `${tr ? 'Trattativa privata' : g ? 'Gara' : 'Nuovo settore'}${p.source?.bu_label ? ` · ${p.source.bu_label}` : ''}`), h('b.pv-tile-t', p.name),
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
          glassTile('Gare e trattative', String(gare.length + trattative.length), totVal ? `${eur(totVal)} di valore` : 'dal Radar e dalle email'),
          glassTile('Nuovi settori', String(settori.length), nextGate ? `G${nextGate.n}${nextGate.due_date ? ` il ${day(nextGate.due_date)}` : ''}` : 'da Nuovi business'),
          glassTile('Valore pesato', weighted ? eur(weighted) : '—', mineView === 'miei' ? 'il mio portafoglio' : 'del portafoglio', 'or'),
          glassTile('Compiti', `${todayTasks} oggi`, lateTasks ? `${lateTasks} in ritardo` : 'nessun ritardo', lateTasks ? 'rd' : ''))),
      section('Gare che seguo', 'dal Radar', gare, false),
      trattative.length ? section('Trattative private', 'nate dalle email', trattative, false) : null,
      section('Nuovi settori', 'da Nuovi business', settori, true)),
    h('div.pv-mine-side', dayBox, tasksBox)));
}

// ═══ Scheda del progetto del CRM ════════════════════════════════════════════════════════════════════
export async function crmProjectPage(container, id) {
  fill(container, loading());
  let info = await get(`/api/crm/progetti/${id}`);
  // progetto di un'iniziativa non ancora portata avanti (ALM2-79): si lavora dalla pagina dell'iniziativa
  if (info.source?.type === 'initiative' && !info.source.launched) {
    const t = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[3] || '';
    location.replace(`#/crm/business/${info.source.id}${t && t !== 'panoramica' ? `/${t}` : '/compiti'}`);
    return;
  }
  // progetto nato da una email o trattativa privata (ALM2-55, tavola D): testata e panoramica della trattativa
  let deal = info.kind === 'trattativa' || info.source?.email ? await loadDeal(id) : null;
  const base = `#/crm/progetto/${id}`;
  const gara = info.kind === 'gara';
  const accent = gara ? '#FF8A26' : '#FFB066';
  const tabs = [['panoramica', 'Panoramica'], ['compiti', 'Compiti'], ['relazioni', 'Relazioni'], ['incontri', 'Incontri'], ['calendario', 'Calendario'],
    ['note', 'Note'], ['gantt', 'Gantt'], ['rendiconto', 'Rendiconto'], ['documenti', 'Documenti'], ['email', 'Email'], ['membri', 'Membri']];
  const canEdit = p => p.my_role && p.my_role !== 'viewer';

  const reloadAll = reload => async () => { info = await get(`/api/crm/progetti/${id}`); if (deal) deal = (await loadDeal(id)) || deal; reload(); };
  const hero = args => (deal ? heroDeal(args) : heroBase(args));
  const heroDeal = ({ p, reload, canManage }) => {
    const member = canEdit(p);
    const again = reloadAll(reload);
    const stepper = h('div.pv-stepper', info.steps.map((label, i) => h(member ? 'button' : 'div', {
      type: member ? 'button' : undefined, class: i < info.step ? 'done' : i === info.step ? 'now' : '', title: member ? `Siamo a «${label}»` : undefined,
      on: member ? { click: async () => { await api('PATCH', `/api/crm/progetti/${id}`, { step: i }); again(); } } : undefined,
    }, h('i'), h('span', label))));
    const actions = [
      h('a.pv-ghost', { href: `/api/crm/progetti/${id}/rendiconto?formato=csv`, download: '' }, ic('download', 13), 'Rendiconto'),
      canManage ? h('button.pv-ghost', { type: 'button', on: { click: () => editProject(p, again) } }, ic('pencil', 13), 'Modifica') : null,
      member ? h('button.pv-ghost.pri', { type: 'button', on: { click: () => openTicket(null, { defaults: { project_id: p.id, assignee_ids: [store.me.id] }, onSaved: again }) } }, ic('plus', 13), 'Nuovo compito') : null];
    return dealHero({ info, deal, p, member, stepper, actions, reload: again, id });
  };
  const heroBase = ({ p, reload, show, canManage }) => {
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
    if (deal) return dealOverview(box, { id, p, info, deal, member: canEdit(p), reload: reloadAll(reload), team: info.team });
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
    ['relazioni', 'Relazioni', async box => { fill(box, h('div.pv-tabhead', h('div', h('h3', 'Relazioni'), h('p', 'Aziende ed enti collegati al progetto, ognuno con le sue persone, con il loro ruolo. Si vedono anche nella loro scheda del CRM.'))), (() => { const rb = relationsBox(id, { onChange: refreshInfo }); return [touchBox({ project: id }, { onChange: () => { refreshInfo(); rb.replaceWith(relationsBox(id, { onChange: refreshInfo })); } }), rb]; })()); }],
    ['calendario', 'Calendario', async box => calendarTab(box, id)],
    ['rendiconto', 'Rendiconto', async box => reportTab(box, id)],
  ];
  return projectDetail(container, id, { base, crumb: { href: '#/crm/progetti', label: 'I miei progetti' }, tabs, extraTabs, hero, overview });
}

// ── pezzi della scheda ──────────────────────────────────────────────────────────────────────────────
function weekStrip(tickets, meetings, p, offset = 0, { compact = false, extra = [] } = {}) {
  const t0 = new Date(`${today()}T12:00:00Z`);
  const monday = addDays(today(), -((t0.getUTCDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: compact ? 5 : 7 }, (_, i) => addDays(monday, i));
  return h('div.pv-week', { class: compact ? '' : 'full' }, days.map(d => {
    const dd = new Date(`${d}T12:00:00Z`);
    const items = [
      ...meetings.filter(m => String(m.start_at).slice(0, 10) === d).map(m => ({ k: 'inc', t: `${String(m.start_at).slice(11, 16)} ${m.subject || 'Incontro'}`, on: () => openMeeting(m.id, p) })),
      ...tickets.filter(t => t.due_date === d).map(t => ({ k: t.status === 'done' ? 'done' : t.due_date < today() ? 'sca' : 'tsk', t: t.title, on: () => openTicket(t.id, {}) })),
      // altre scadenze (ALM2-79: i gate della direzione di Nuovi business)
      ...extra.filter(x => x.date === d).map(x => ({ k: x.kind || 'gate', t: x.title, on: x.on || (() => {}) })),
    ];
    return h('div.pv-day', { class: d === today() ? 'today' : '' },
      h('div.pv-row', h('b.pv-grow', `${dd.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'UTC' })} ${dd.getUTCDate()}`), d === today() ? h('small', 'oggi') : null),
      items.length ? items.map(it => h('button.pv-ev', { type: 'button', class: it.k, on: { click: it.on } }, it.k === 'inc' ? ic('users', 11) : it.k === 'gate' ? ic('flag', 11) : it.k === 'sca' ? ic('flag', 11) : it.k === 'done' ? ic('check', 11) : h('span.pv-evbox'), h('span', it.t))) : null);
  }));
}

export function taskBoard(tickets, p, onChange, { max = 0, drag = false, origin = false } = {}) {
  const cols = [['todo', 'Da fare', t => t.status === 'todo'], ['doing', 'In corso', t => t.status === 'doing' || t.status === 'review'], ['done', 'Fatti', t => t.status === 'done']];
  return h('div.pv-board', cols.map(([k, label, f]) => {
    const list = tickets.filter(f).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
    const shown = max ? (k === 'done' ? list.slice().reverse().slice(0, max - 1) : list.slice(0, max)) : list;
    const col = h('div.pv-bcol', { class: k },
      h('div.pv-row', h('b.pv-grow', label), h('small', String(list.length))),
      shown.map(t => h('button.pv-bcard', { type: 'button', draggable: drag ? 'true' : undefined, 'data-id': String(t.id),
        on: { click: () => openTicket(t.id, { onSaved: onChange }), dragstart: e => { e.dataTransfer.setData('text/plain', String(t.id)); e.currentTarget.classList.add('drag'); }, dragend: e => e.currentTarget.classList.remove('drag') } },
        h('span.pv-bcard-t', t.title),
        origin && /^Piano · /.test(t.description || '') ? h('span.pv-tag.rl-from', 'Piano') : origin && /^Fase \d/.test(t.description || '') ? h('span.pv-tag.rl-from', 'Lancio') : null,
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

export async function calendarTab(box, id, { extra = [] } = {}) {
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
      h('section.pv-card', weekStrip(tickets, meetings, p, offset, { extra })),
      h('div.pv-legend', h('span.inc', 'incontro'), h('span.tsk', 'compito'), h('span.sca', 'scaduto'), extra.length ? h('span.gate', 'gate della direzione') : null, h('span.done', 'fatto')));
  };
  draw();
}

async function reportTab(box, id) {
  fill(box, loading());
  const r = await get(`/api/crm/progetti/${id}/rendiconto`);
  const p = r.project;
  const gara = p.kind !== 'settore';
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

// ═══ Collegati (canvas v9 «Collegamenti»): aziende e persone del CRM collegate a una gara, opportunità o progetto ═══
// target: { project: id } oppure { signal: id }. «+ Collega» cerca in tutto il CRM con un campo solo, si sceglie il ruolo;
// se non c'è si crea al volo come lead da completare.
export function linksBox(target, { title = 'Collegati', onChange } = {}) {
  const qs2 = target.project ? `project=${target.project}` : `signal=${target.signal}`;
  const box = h('section.pv-card.lk-box', loading());
  let roles = {};
  const roleSel = (value, attrs = {}) => h('select.pv-sel.lk-role', attrs, h('option', { value: '' }, 'ruolo…'), Object.entries(roles).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
  const save = async (who, role) => { const r = await post('/api/crm/collegamenti', { ...target, ...who, role }); onChange?.(); return r; };
  const draw = async (links = null) => {
    if (!links) { const r = await get(`/api/crm/collegamenti?${qs2}`); roles = r.roles; links = r.links; }
    const search = h('input.input', { type: 'search', placeholder: 'Cerca un\'azienda, un ente o una persona del CRM…', 'aria-label': 'Cerca nel CRM' });
    const pickRole = roleSel('', { 'aria-label': 'Come' });
    const results = h('div.pv-results');
    const add = async (who, name) => { const r = await save(who, pickRole.value); toast(`${name} collegato${pickRole.value ? ` come ${roles[pickRole.value]}` : ''}`); draw(r.links); };
    search.addEventListener('input', debounce(async () => {
      const q = search.value.trim();
      if (q.length < 2) { fill(results); return; }
      const [{ subjects = [] }, contacts] = await Promise.all([get(`/api/crm/subjects?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({})), get(`/api/crm/contacts?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => [])]);
      const people = Array.isArray(contacts) ? contacts : contacts.contacts || [];
      fill(results,
        subjects.slice(0, 5).map(s => h('button.pv-res', { type: 'button', on: { click: () => add({ subject_id: s.id }, s.name) } }, ic('building', 14), h('b', s.name), h('small', [(s.roles || []).join(', '), s.city].filter(Boolean).join(' · ') || 'azienda'))),
        people.slice(0, 5).map(c => h('button.pv-res', { type: 'button', on: { click: () => add({ contact_id: c.id }, [c.first_name, c.last_name].filter(Boolean).join(' ')) } }, ic('user', 14), h('b', [c.title, c.first_name, c.last_name].filter(Boolean).join(' ')), h('small', c.subject_name || c.email || 'persona'))),
        h('button.pv-res.new', { type: 'button', on: { click: async () => { const s = await post('/api/crm/subjects/rapida', { name: q }); add({ subject_id: s.id }, s.name); } } }, ic('plus', 14), h('b', `Crea «${q}» al volo`), h('small', 'lead da completare')));
    }, 250));
    fill(box,
      h('div.pv-row.lk-h', h('span.pv-oic', ic('link', 14)), h('b.pv-grow', title), h('small', links.length ? `${links.length}` : '')),
      links.length ? h('div.lk-list', links.map(l => {
        const sel = roleSel(l.role, { 'aria-label': `Ruolo di ${l.name}` });
        sel.addEventListener('change', async () => { const r = await save(l.subject_id ? { subject_id: l.subject_id } : { contact_id: l.contact_id }, sel.value); draw(r.links); });
        return h('div.lk-row', h('span.lk-ic', { class: l.kind }, ic(l.kind === 'subject' ? 'building' : 'user', 14)),
          h('a.pv-grow', { href: l.subject_id ? `#/crm/scheda/${l.subject_id}` : `#/crm/contatti/${l.contact_id}` }, h('b', l.name || '—'), h('small', l.sub || (l.kind === 'subject' ? 'azienda' : 'persona'))),
          sel,
          h('button.pv-x', { type: 'button', 'aria-label': `Scollega ${l.name}`, title: 'Scollega', on: { click: async () => {
            const r = await api('DELETE', '/api/crm/collegamenti', { ...target, ...(l.subject_id ? { subject_id: l.subject_id } : { contact_id: l.contact_id }) });
            onChange?.(); draw(r.links);
          } } }, ic('x', 12)));
      })) : h('p.pv-empty', 'Ancora nessuno: collega l\'ente, il RUP, i partner per l\'ATI, i concorrenti…'),
      h('div.lk-add', h('div.pv-relsearch', search), h('span.lk-come', 'come'), pickRole),
      results);
  };
  draw().catch(() => fill(box, h('p.pv-empty', 'Collegamenti non disponibili.')));
  return box;
}

// ═══ Relazioni a gruppi (ALM2-79, canvas «Nuovi business come progetto», tavola 5) ═══════════════════════════════
// Le aziende collegate al progetto, ognuna con le sue persone del CRM da spuntare; una persona collegata porta con sé
// la sua azienda (lo fa il server); «+ nuovo contatto» lo crea già dentro l'azienda e collegato.
export function relationsBox(projectId, { canEdit = true, onChange } = {}) {
  const box = h('div.rl');
  const list = h('div.rl-list', loading());
  let roles = {};
  const roleSel = (value, attrs = {}) => h('select.pv-sel.lk-role', attrs, h('option', { value: '' }, 'ruolo…'), Object.entries(roles).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
  const link = async (who, extra = {}) => { const r = await post('/api/crm/collegamenti', { project: projectId, ...who, ...extra }); onChange?.(); return r.links; };
  const unlink = async who => { const r = await api('DELETE', '/api/crm/collegamenti', { project: projectId, ...who }); onChange?.(); return r.links; };
  const fullName = c => [c.title, c.first_name, c.last_name].filter(Boolean).join(' ');

  // ricerca: un campo per aziende e persone del CRM; «Crea al volo» se non c'è
  const search = h('input.input', { type: 'search', placeholder: 'Cerca un\'azienda, un ente o una persona del CRM…', 'aria-label': 'Cerca nel CRM' });
  const pickRole = roleSel('', { 'aria-label': 'Come' });
  const results = h('div.pv-results');
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (q.length < 2) { fill(results); return; }
    const [{ subjects = [] }, contacts] = await Promise.all([get(`/api/crm/subjects?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({})), get(`/api/crm/contacts?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => [])]);
    const people = Array.isArray(contacts) ? contacts : contacts.contacts || [];
    const done = async (links, name) => { toast(`${name} collegato${pickRole.value ? ` come ${roles[pickRole.value]}` : ''}`); search.value = ''; fill(results); draw(links); };
    fill(results,
      subjects.slice(0, 5).map(s => h('button.pv-res', { type: 'button', on: { click: async () => {
        // le sue persone già nelle email o negli incontri del progetto si spuntano da sole
        const r = await post('/api/crm/collegamenti', { project: projectId, subject_id: s.id, role: pickRole.value, auto_contacts: true });
        onChange?.();
        await done(r.links, r.auto ? `${s.name} (con ${r.auto} ${r.auto === 1 ? 'persona già nelle email o negli incontri' : 'persone già nelle email o negli incontri'})` : s.name);
      } } },
        ic('building', 14), h('b', s.name), h('small', [(s.roles || []).join(', '), s.city].filter(Boolean).join(' · ') || 'azienda'), h('span.rl-act', 'Collega e scegli le persone'))),
      people.slice(0, 5).map(c => h('button.pv-res', { type: 'button', on: { click: async () => done(await link({ contact_id: c.id }, { role: pickRole.value }), fullName(c)) } },
        ic('user', 14), h('b', fullName(c)), h('small', c.subject_name || c.links?.[0]?.subject_name || c.email || 'persona'), h('span.rl-act', 'Collega (entra anche la sua azienda)'))),
      h('button.pv-res.new', { type: 'button', on: { click: async () => { const s = await post('/api/crm/subjects/rapida', { name: q }); done(await link({ subject_id: s.id }, { role: pickRole.value }), s.name); } } },
        ic('plus', 14), h('b', `Crea «${q}» al volo`), h('small', 'lead da completare')));
  }, 250));

  const newContact = (s, after) => {
    const nome = h('input.input', { placeholder: 'Nome e cognome', 'aria-label': 'Nome e cognome' });
    const email = h('input.input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
    const job = h('input.input', { placeholder: 'Ruolo in azienda (es. direttore tecnico)', 'aria-label': 'Ruolo in azienda' });
    const md = modal({
      title: `Nuovo contatto in ${s.name}`,
      body: h('div.rl-form', nome, email, job),
      actions: [h('button.btn', { type: 'button', on: { click: () => md.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          if (!nome.value.trim()) { toast('Scrivi il nome', 'error'); return; }
          const c = await post('/api/crm/contacts', { nome: nome.value.trim(), email: email.value.trim(), links: [{ subject_id: s.subject_id, job: job.value.trim(), is_primary: true }] });
          md.close();
          after(await link({ contact_id: c.id }));
          toast(`${nome.value.trim()} è in ${s.name} e nel progetto`);
        } } }, 'Crea e collega')],
    });
    nome.focus();
  };

  const draw = async (links = null) => {
    if (!links) { const r = await get(`/api/crm/collegamenti?project=${projectId}`); roles = r.roles; links = r.links; }
    if (pickRole.options.length < 2) pickRole.append(...Object.entries(roles).map(([k, l]) => h('option', { value: k }, l)));
    const subjects = links.filter(l => l.kind === 'subject');
    const contacts = links.filter(l => l.kind === 'contact');
    const people = await Promise.all(subjects.map(s => get(`/api/crm/collegamenti/persone?subject=${s.subject_id}`, { quiet: true }).then(r => r.people).catch(() => [])));
    const linkedC = new Set(contacts.map(c => c.contact_id));
    const shownC = new Set();
    const cards = subjects.map((s, k) => {
      const ppl = people[k].filter(p => !p.former || linkedC.has(p.id));
      ppl.forEach(p => shownC.add(p.id));
      const sel = roleSel(s.role, { 'aria-label': `Ruolo di ${s.name}`, disabled: !canEdit });
      sel.addEventListener('change', async () => draw(await link({ subject_id: s.subject_id }, { role: sel.value })));
      return h('section.pv-card.rl-co',
        h('div.rl-co-h', h('span.rl-ini', initials(s.name || '?')),
          h('a.pv-grow', { href: `#/crm/scheda/${s.subject_id}` }, h('b', s.name || '—'), h('small', [s.sub, `${ppl.length} ${ppl.length === 1 ? 'persona' : 'persone'} nel CRM`].filter(Boolean).join(' · '))),
          sel,
          canEdit ? h('button.pv-x', { type: 'button', 'aria-label': `Scollega ${s.name}`, title: 'Scollega l\'azienda', on: { click: async () => draw(await unlink({ subject_id: s.subject_id })) } }, ic('x', 12)) : null),
        h('div.rl-ppl',
          ppl.length ? ppl.map(p => {
            const on = linkedC.has(p.id);
            const cb = h('input', { type: 'checkbox', checked: on, disabled: !canEdit, 'aria-label': `${p.name} c'entra` });
            cb.addEventListener('change', async () => { cb.disabled = true; draw(cb.checked ? await link({ contact_id: p.id }) : await unlink({ contact_id: p.id })); });
            return h('label.rl-p', { class: on ? 'on' : '' }, cb, h('span.pv-grow', h('span', p.name), p.job ? h('small', ` · ${p.job}`) : null, p.former ? h('small', ' · non lavora più qui') : null),
              p.email ? h('small.rl-mail', p.email) : null);
          }) : h('p.pv-empty', 'Nessuna persona di questa azienda nel CRM.'),
          canEdit ? h('button.rl-new', { type: 'button', on: { click: () => newContact(s, draw) } }, `+ nuovo contatto in ${s.name}`) : null));
    });
    const loose = contacts.filter(c => !shownC.has(c.contact_id));
    fill(list,
      cards.length || loose.length ? null : h('p.pv-empty', 'Ancora nessuno: collega i clienti target, gli sviluppatori, i partner e le persone con cui parli.'),
      cards,
      loose.length ? h('section.pv-card.rl-co', h('div.rl-co-h', h('span.rl-ini', ic('user', 14)), h('b.pv-grow', 'Persone senza un\'azienda collegata')),
        h('div.rl-ppl', loose.map(c => h('div.rl-p.on', h('a.pv-grow', { href: `#/crm/contatti/${c.contact_id}` }, h('span', c.name), c.works_at ? h('small', ` · ${c.works_at}`) : null),
          canEdit ? h('button.pv-x', { type: 'button', 'aria-label': `Scollega ${c.name}`, on: { click: async () => draw(await unlink({ contact_id: c.contact_id })) } }, ic('x', 12)) : null)))) : null);
  };
  fill(box,
    canEdit ? h('section.pv-card.rl-add', h('div.lk-add', h('div.pv-relsearch', search), h('span.lk-come', 'come'), pickRole), results) : null,
    list);
  draw().catch(() => fill(list, h('p.pv-empty', 'Relazioni non disponibili.')));
  return box;
}

// ═══ Punti di contatto (canvas v9 «Collegamenti e punti di contatto») ═══════════════════════════════════════════
// target: { signal } | { project } | { subject }. Ogni segnale: Collega · Chiedi un'introduzione · Aggiungi alla squadra ·
// Non c'entra. Niente si collega da solo. Se non c'è niente il riquadro non si vede.
const TOUCH_ROLE = { rup: 'RUP', referente: 'referente', ati: 'partner ATI', concorrente: 'concorrente', subappalto: 'subappaltatore', altro: 'collegato' };
export function touchBox(target, { onChange } = {}) {
  const qs2 = new URLSearchParams(target).toString();
  const box = h('section.tp-box', { hidden: true });
  const draw = async () => {
    const r = await get(`/api/crm/punti-contatto?${qs2}`, { quiet: true }).catch(() => ({ items: [] }));
    if (!r.items.length) { box.hidden = true; fill(box); return; }
    box.hidden = false;
    const act = (label, cls, fn) => h(`button.tp-btn${cls}`, { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; try { await fn(); } catch { e.currentTarget.disabled = false; } } } }, label);
    fill(box,
      h('div.tp-h', h('span.tp-spark', ic('sparkles', 16)), h('div.pv-grow', h('b', 'Punti di contatto trovati'), h('small', `${r.items.length} · Alma incrocia CRM, Outlook e dati ANAC; niente si collega da solo`))),
      r.items.map(t => h('div.tp-item', { class: t.tone },
        h('span.tp-ic', ic(t.icon, 15)),
        h('div.pv-grow', h('b', t.title), h('small', t.detail),
          h('div.tp-acts',
            t.actions.includes('collega') ? act(['Collega', t.role ? ` come ${TOUCH_ROLE[t.role] || t.role}` : ''].join(''), '.pri', async () => {
              await post('/api/crm/collegamenti', { ...target, ...(t.contact_id ? { contact_id: t.contact_id } : { subject_id: t.subject_id }), role: t.role === 'referente' ? 'referente' : t.role || '' });
              toast(`${t.name} collegato`); await draw(); onChange?.();
            }) : null,
            t.actions.includes('introduzione') && t.knows ? act(`Chiedi a ${t.knows.name.split(' ')[0]} un'introduzione`, '', async () => {
              const out = await post('/api/crm/punti-contatto/introduzione', { ...target, user_id: t.knows.id, name: t.type === 'collega' ? (box.dataset.ente || 'l’ente') : t.name });
              toast(`Compito mandato a ${out.to}`);
            }) : null,
            t.actions.includes('squadra') && target.project ? act(`Aggiungi ${t.name.split(' ')[0]} alla squadra`, '', async () => {
              await post('/api/crm/punti-contatto/squadra', { ...target, user_id: t.user_id }); toast(`${t.name} è nella squadra`); onChange?.();
            }) : null,
            t.actions.includes('apri') ? h('a.tp-btn', { href: `#/crm/scheda/${t.subject_id}/incontri` }, 'Apri l’incontro') : null,
            act('Non c’entra', '.ghost', async () => { await post('/api/crm/punti-contatto/non-centra', { ...target, key: t.key }); await draw(); }))))));
  };
  draw();
  box.refresh = draw;
  return box;
}

// bollino verde «N punti di contatto» sulle righe di una lista (pagina Lead, carte del Radar): si legge dopo, a gruppi
export async function touchBadges(pairs) {
  const ids = [...new Set(pairs.map(([id]) => id).filter(Boolean))];
  if (!ids.length) return;
  const counts = await post('/api/crm/punti-contatto/conteggi', { subjects: ids }).catch(() => ({}));
  for (const [id, el] of pairs) if (counts[id] && el.isConnected) el.append(h('span.tp-badge', { title: 'Persone che conosciamo o incontri già in calendario: aprila per vederli' }, ic('link', 10), `${counts[id]} ${counts[id] === 1 ? 'punto di contatto' : 'punti di contatto'}`));
}
