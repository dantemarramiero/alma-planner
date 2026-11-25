// Nuovi business v2 (canvas «Design v2 · Nuovi business», approvato da Dante il 14/11/2026):
// elenco a schede, primo accesso, testata dell'iniziativa con fasi e gate, Chat · Clienti target · Cosa ci manca · Piano ·
// Riflessioni · Analisi (+ Radar in «Altro»), foglio A4 per la riunione, finestre e riquadri laterali.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading, initials } from './ui.js';
import { get, post, put, patch, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { warmPill, pathsBox, registraEsito } from './crm-esiti.js'; // forza dei rapporti e vinte/perse (win ratio, 16/11)
import { mercatoTab, soaDialog, marketCard } from './crm-business-mercato.js'; // mappa del mercato (20/11)
// ALM2-79: i tab del progetto dell'iniziativa, con gli stessi pezzi dei progetti
import { openTicket } from './tickets.js';
import { taskBoard, calendarTab, relationsBox, touchBox } from './crm-progetti.js';
import { projectMeetings } from './project-meetings.js';
import { projectEmails } from './project-emails.js';
import { notesPanel } from './notes.js';
import { projectDocuments } from './activities.js';
import { ganttView } from './gantt.js';
import { peoplePicker } from './people.js';
import { shareDialog, markShareOpened, shareStrip } from './condividi.js';

const PHASES = [['esplorazione', 'Esplorazione'], ['analisi', 'Analisi'], ['piano', 'Piano'], ['ingresso', 'Ingresso'], ['consolidamento', 'Consolidamento']];
const PHASE_KEYS = PHASES.map(([k]) => k);
const PHASE_HINT = ['Chi possono essere i clienti, cosa fanno i concorrenti.', 'Cosa ci manca: SOA, albi, persone, mezzi, referenze.', 'Piano con costi e tempi, da far approvare.', 'Qualifiche, prime gare, primi contratti.', 'Squadra dedicata: può diventare una BU.'];
const TARGET_STATUS = [['da_contattare', 'Da contattare'], ['contattato', 'Contattato'], ['incontro', 'Incontro'], ['qualificati', 'Qualificati'], ['opportunita', 'Opportunità'], ['scartato', 'Scartato']];
const TS = Object.fromEntries(TARGET_STATUS);
const TS_CLASS = { da_contattare: 's0', contattato: 's1', incontro: 's2', qualificati: 's3', opportunita: 's4', scartato: 's0' };
const GAP_STATUS = { manca: 'manca', in_corso: 'in corso', ce: 'c\'è' };
const GAP_CLASS = { manca: 'red', in_corso: 's2', ce: 's3' };
const GAP_KINDS = ['Requisito', 'Qualifica', 'Persone', 'Mezzi e squadre', 'Referenze', 'Certificazioni', 'Processi', 'Altro'];
const HOW_KINDS = [['assumere', 'Assumere'], ['formare', 'Formare'], ['partner', 'Partner o ATI'], ['avvalimento', 'Avvalimento'], ['acquisire', 'Acquisire'], ['noleggiare', 'Noleggiare'], ['non_serve', 'Non serve ora']];
const HOW = Object.fromEntries(HOW_KINDS);
const NOTE_KINDS = { ipotesi: 'Ipotesi', decisione: 'Decisione', chat: 'Dalla chat', nota: 'Nota', rischio: 'Rischio' };
const NOTE_ICON = { ipotesi: ['hyp', 'search'], rischio: ['risk', 'alert-triangle'], chat: ['chat', 'lightbulb'], decisione: ['dec', 'check'], nota: ['nota', 'file-text'] };
const CHECK = { da_verificare: 'da verificare', confermata: 'confermata', smentita: 'smentita' };
const PROB = [['poco', 'poco probabile'], ['possibile', 'possibile'], ['probabile', 'probabile']];
const LEVELS = ['alto', 'medio', 'basso'];
const LIGHT = { g: 'Verde', y: 'Giallo', r: 'Rosso', n: 'Spento' };
// ALM2-79 (canvas «Nuovi business come progetto», 24/11): due gruppi di tab, Strategia e Lavoro (quelli di un progetto)
const TABS = [['chat', 'Chat'], ['clienti', 'Clienti target'], ['gap', 'Cosa ci manca'], ['piano', 'Piano'], ['mercato', 'Mercato']];
const WORK_TABS = [['compiti', 'Compiti'], ['relazioni', 'Relazioni'], ['incontri', 'Incontri'], ['calendario', 'Calendario'], ['email', 'Email'], ['note', 'Note'], ['documenti', 'Documenti']];
const MORE_TABS = [['riflessioni', 'Riflessioni'], ['analisi', 'Analisi'], ['radar', 'Radar'], ['gantt', 'Gantt'], ['membri', 'Membri']];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const todayIso = () => new Date().toLocaleDateString('sv-SE');
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const dm = d => (d ? String(d).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' })} €`);
const eur2 = n => `${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const relDay = d => {
  if (!d) return '—';
  const n = Math.round((Date.parse(`${todayIso()}T12:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`)) / 86400000);
  return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : n < 14 ? `${n} giorni fa` : day(d);
};
const ic = (name, size = 16) => icon(name, { size });
const field = (label, control, hint) => h('label.nb-fl', h('span.nb-lbl', label), control, hint ? h('small', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = (none = '—') => [['', none], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const empty = (text, iconName = 'list', action = null) => h('div.nb-empty-s', h('span.nb-ki.nota', ic(iconName)), h('span', text), action);
const av = (name, cls = '') => h('span.nb-av', { class: cls, title: name || '' }, initials(name || '?'));
const pill = (text, cls = '') => h('span.nb-pill', { class: cls }, text);
const lightPill = (c, text) => h('span.nb-light', { class: c }, h('i'), text);
const dot = c => h('span.nb-dot', { class: c });
// pulsanti: un solo arancione per pagina (primary), gli altri bianchi; sm = 32 px
const btn = (label, onClick, { primary = false, small = false, ghost = false, ico = null, disabled = false, danger = false } = {}) =>
  h('button.nb-btn', { type: 'button', class: [primary && 'pri', small && 'sm', ghost && 'ghost', danger && 'danger'].filter(Boolean).join(' '), disabled, on: { click: onClick } }, ico ? ic(ico, small ? 14 : 16) : null, label);
const card = (title, extra, ...body) => h('section.nb-card', title ? h('div.nb-card-h', h('h3', title), extra || null) : null, ...body);
const chips = (items, active, onPick) => h('div.nb-chips', items.map(([k, label]) => h('button.nb-chip', { type: 'button', class: k === active ? 'on' : '', on: { click: () => onPick(k) } }, label)));
const seg = (items, active, onPick) => h('div.nb-seg', items.map(([k, label]) => h('button', { type: 'button', class: k === active ? 'on' : '', on: { click: () => onPick(k) } }, label)));
const counter = (iconName, n, label, cls = '') => h('div.nb-fc', { class: cls }, h('span.nb-fc-i', ic(iconName)), h('span.nb-fc-n', String(n)), h('span.nb-fc-l', label));
const burn = (pct, tick = null) => h('div.nb-burn', h('i', { style: { width: `${Math.min(100, Math.max(0, pct))}%` } }), tick !== null ? h('em', { style: { left: `${tick}%` } }) : null);
// nome con l'ultima parola in grassetto, come i titoli del refresh («Nuovi **business**»)
const title2 = name => { const w = String(name || '').split(' '); return w.length > 1 ? [w.slice(0, -1).join(' '), ' ', h('b', w.at(-1))] : [h('b', name)]; };
const dlg = (m, cls = '') => { m.box.classList.add('nb-dlg'); if (cls) m.box.classList.add(cls); return m; };
const synIcon = t => (/contatt/.test(t) ? 'users' : /incontr/.test(t) ? 'calendar' : /email/.test(t) ? 'mail' : /gruppo/.test(t) ? 'building' : 'link');

// testo dell'assistente: righe «- » diventano elenco, **grassetto**
function richText(text) {
  const inline = line => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', part) : part));
  const out = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*[-•]\s+/.test(line)) {
      if (!list) { list = h('ul'); out.push(list); }
      list.append(h('li', inline(line.replace(/^\s*[-•]\s+/, ''))));
    } else {
      list = null;
      if (line.trim()) out.push(h('p', inline(line)));
    }
  }
  return out;
}

// ── fasi ─────────────────────────────────────────────────────────────────────────────────────
const miniStep = phase => {
  if (phase === 'abbandonata') return pill('Abbandonata', 'off');
  const on = PHASE_KEYS.indexOf(phase);
  return h('div.nb-mini', PHASES.map(([, l], i) => h('span', { title: l, class: i < on ? 'd' : i === on ? 'o' : '' })), h('span.nb-mini-l', PHASES[on][1]));
};
function stepper(i) {
  const on = PHASE_KEYS.indexOf(i.phase);
  const today = todayIso();
  const out = [];
  PHASES.forEach(([, label], n) => {
    const state = i.phase === 'abbandonata' ? '' : n < on ? 'done' : n === on ? 'on' : '';
    out.push(h('span.nb-ph', { class: state }, h('span.nb-ph-c', state === 'done' ? ic('check', 12) : String(n + 1)), label));
    const g = i.gates.find(x => x.n === n);
    if (n < 4 && g) {
      const late = !g.decision && g.due_date && g.due_date < today && n === on;
      const cls = g.decision === 'prosegui' ? 'done' : late ? 'late' : '';
      const when = g.decision ? `${g.decision === 'prosegui' ? 'approvato' : g.decision === 'abbandona' ? 'abbandonata' : 'rimandato'} ${dm(g.decided_at)}` : g.due_date ? `${late ? 'scaduto ' : ''}${dm(g.due_date)}` : 'da fissare';
      out.push(h('span.nb-gl', { class: cls }, h('em'), h('u', `G${n} · ${when}`)));
    }
  });
  return h('div.nb-stepper', out);
}

// ── elenco ────────────────────────────────────────────────────────────────────────────────────
export async function businessView(container, parts = [], crmData = {}) {
  const id = Number(parts[0]);
  if (id) return initiativePage(container, id, parts[1] || 'chat', crmData);
  if (parts[0] === 'riepilogo') return riepilogoView(container, crmData);
  fill(container, loading());
  const d = await get('/api/crm/business');
  const ctx = { crmData, ai: d.ai, refresh: () => businessView(container, parts, crmData) };
  // #/crm/business/nuova: «Crea iniziativa» da Concorrenza e gare → Regioni (21/11), con nome e descrizione già scritti
  if (parts[0] === 'nuova') {
    let preset = {};
    try { preset = JSON.parse(sessionStorage.getItem('nb.preset') || '{}'); sessionStorage.removeItem('nb.preset'); } catch { /* niente */ }
    history.replaceState(null, '', '#/crm/business');
    ctx.refresh = () => businessView(container, [], crmData);
    setTimeout(() => initiativeForm(ctx, preset), 0);
  }
  const head = h('div.page-head.nb-head', h('div', h('div.en-eyebrow', 'Alma CRM · Strategia commerciale'), h('h1', 'Nuovi ', h('b', 'business')),
    h('div.sub', 'Le aree d\'affari in cui stiamo provando a entrare.')),
  d.initiatives.length ? h('div.nb-actions', viewSeg('elenco'), btn('Chiedi un\'idea', () => ideaDialog(ctx), { ico: 'lightbulb' }), btn('Nuova iniziativa', () => initiativeForm({ ...ctx }), { primary: true, ico: 'plus' })) : null);
  if (!d.initiatives.length) return fill(container, h('div.nb', head, emptyState(ctx)));
  const k = d.kpis;
  const late = d.initiatives.filter(i => i.phase !== 'abbandonata' && i.gate?.late);
  let filter = 'aperte';
  let q = '';
  const grid = h('div.nb-cards');
  const counts = {
    aperte: d.initiatives.filter(i => i.phase !== 'abbandonata').length, mie: d.initiatives.filter(i => i.owner_id === store.me.id && i.phase !== 'abbandonata').length,
    decidere: late.length, abbandonate: d.initiatives.filter(i => i.phase === 'abbandonata').length,
  };
  const draw = () => {
    const rows = d.initiatives.filter(i => (filter === 'abbandonate' ? i.phase === 'abbandonata' : i.phase !== 'abbandonata')
      && (filter !== 'mie' || i.owner_id === store.me.id) && (filter !== 'decidere' || i.gate?.late)
      && (!q || `${i.name} ${i.description}`.toLowerCase().includes(q)));
    grid.replaceChildren(...(rows.length ? rows.map(initiativeCard) : [empty('Nessuna iniziativa con questo filtro.', 'search')]));
  };
  const chipBar = h('div');
  const redrawChips = () => chipBar.replaceChildren(chips([['aperte', `Aperte ${counts.aperte}`], ['mie', `Le mie ${counts.mie}`], ['decidere', `Da decidere ${counts.decidere}`], ['abbandonate', `Abbandonate ${counts.abbandonate}`]], filter, x => { filter = x; redrawChips(); draw(); }));
  redrawChips();
  draw();
  const spendPct = k.budget ? Math.round(k.spent / k.budget * 100) : 0;
  fill(container, h('div.nb',
    head,
    h('div.nb-fcs',
      counter('grid', k.open, 'iniziative aperte'), counter('target', k.targets, 'clienti target', k.targets ? '' : 'zero'), counter('users', k.contacted, 'già contattati', k.contacted ? '' : 'zero'),
      counter('square-check', `${k.gapsOk}/${k.gapsTotal}`, 'requisiti a posto'), counter('alert-triangle', k.lateGates, k.lateGates === 1 ? 'gate scaduto' : 'gate scaduti', k.lateGates ? 'hot' : 'zero'),
      h('div.nb-fc.nb-fc-wide', h('div.nb-row-sb', h('span.nb-small.strong', 'Spesa sul budget'), h('b', eur(k.spent), h('span.muted', ` / ${eur(k.budget)}`))), burn(spendPct),
        h('div.nb-small.muted', `di cui assistente AI ${eur2(k.aiMonth)} questo mese`))),
    late.map(i => h('div.nb-focus', ic('alert-triangle'), h('div.grow', h('b', 'Da decidere dalla direzione: '), `${i.name} · gate G${i.gate.n} «${i.gate.question}» scaduto il ${day(i.gate.due_date)}.`),
      btn('Apri e decidi', () => { location.hash = `#/crm/business/${i.id}/piano`; }, { small: true }))),
    h('div.nb-tb', chipBar, h('label.nb-search', ic('search'), h('input', { type: 'search', placeholder: 'Cerca un\'iniziativa…', on: { input: e => { q = e.target.value.trim().toLowerCase(); draw(); } } }))),
    grid));
}

// «Elenco · Riepilogo» in testa alla pagina Nuovi business (canvas NB-Riepilogo)
const viewSeg = active => h('div.nb-seg.nb-vseg', [['elenco', 'Elenco', 'list', '#/crm/business'], ['riepilogo', 'Riepilogo', 'grid', '#/crm/business/riepilogo']]
  .map(([k, l, i, href]) => h('button', { type: 'button', class: k === active ? 'on' : '', 'aria-pressed': String(k === active), on: { click: () => { if (k !== active) location.hash = href; } } }, ic(i, 15), l)));

// ── Riepilogo per la direzione (canvas NB-Riepilogo, NB-Riepilogo-Stampa, NB-Riepilogo-Telefono, 20/11) ─────────────
async function riepilogoView(container, crmData) {
  fill(container, loading());
  const d = await get('/api/crm/business/riepilogo');
  const again = () => riepilogoView(container, crmData);
  const t = d.totals;
  const stamp = `${dm(d.today)} alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  const head = h('div.page-head.nb-head', h('div', h('div.en-eyebrow', 'Alma CRM · Strategia commerciale'), h('h1', 'Nuovi ', h('b', 'business')),
    h('div.sub', `Riepilogo per la riunione di direzione · dati di oggi, ${stamp}`)),
  h('div.nb-actions', viewSeg('riepilogo'), d.open.length ? btn('Esporta per la riunione', () => window.print(), { primary: true, ico: 'file-text' }) : null));
  if (!d.open.length) {
    return fill(container, h('div.nb', head, h('section.nb-card', empty('Nessuna iniziativa aperta: il riepilogo si riempie quando ne apri una.', 'grid',
      btn("Vai all'elenco", () => { location.hash = '#/crm/business'; }, { small: true })))));
  }
  const spendPct = t.budget ? Math.round(t.spent / t.budget * 100) : 0;
  const whenPill = g => {
    if (!g?.due_date) return h('span.nb-when.gy', 'data da fissare');
    if (g.days > 0) return h('span.nb-when.rd', g.days === 1 ? 'scaduto da 1 giorno' : `scaduto da ${g.days} giorni`);
    if (g.days === 0) return h('span.nb-when.rd', 'scade oggi');
    return h('span.nb-when.am', `scade il ${dm(g.due_date)}`);
  };
  // decidere: la stessa finestra del Piano, con i dati completi dell'iniziativa
  const decide = async (row, choice) => {
    const [i, tk] = await Promise.all([get(`/api/crm/business/${row.id}`), get(`/api/crm/business/${row.id}/tasks`)]);
    if (!i.gate) return toast('Il gate è già stato deciso', 'err');
    gateDialog(i, i.gate, choice, tk.tasks || [], again);
  };
  const why = i => {
    const out = [];
    if (i.lateTasks) out.push(`${i.lateTasks} ${i.lateTasks === 1 ? 'passo scaduto' : 'passi scaduti'}`);
    out.push(...i.light.reasons.filter(r => r.c !== 'g' && !/gate|pass/i.test(r.t)).map(r => r.t));
    out.push(i.gaps.total ? `${i.gaps.ok} requisiti su ${i.gaps.total} a posto` : "requisiti da analizzare");
    return out.slice(0, 3).join(' · ');
  };
  const byId = Object.fromEntries(d.open.map(i => [i.id, i]));
  const decBox = d.decide.length ? h('section.nb-dec',
    h('div.nb-dec-h', h('b', ic('alert-triangle', 16), 'Da decidere in questa riunione'), h('span.nb-small.muted', 'si decide in una finestra sola, con il perché')),
    d.decide.map(x => h('div.nb-drow',
      h('div.nb-min0', h('div.nb-dq', `${x.name} · gate G${x.gate.n} «${x.gate.question}»`, ' ', whenPill(x.gate)),
        h('div.nb-dw', [why(byId[x.id]), x.owner_name ? `responsabile ${x.owner_name}` : ''].filter(Boolean).join(' · '))),
      x.canDecide ? h('div.nb-dacts', btn('Prosegui', () => decide(x, 'prosegui'), { small: true }), btn('Rimanda', () => decide(x, 'rimanda'), { small: true }), btn('Abbandona', () => decide(x, 'abbandona'), { small: true }))
        : h('span.nb-small.muted', 'decide lo sponsor o la direzione')))) : null;

  // tabella: una colonna per iniziativa
  const cols = d.open;
  const phaseName = i => PHASES[PHASE_KEYS.indexOf(i.phase)]?.[1] || '—';
  const tk = phase => { const on = PHASE_KEYS.indexOf(phase); return h('div.nb-tk', PHASES.map((_, k) => h('i', { class: k < on ? 'd' : k === on ? 'o' : '' }))); };
  const funnel = f => {
    const v = [f.individuati, f.contattati, f.incontrati, f.opportunita];
    const mx = Math.max(v[0], 1);
    return h('div.nb-fun', v.map((n, k) => h('div', h('b', String(n)), h('i', { class: k === 3 ? 'k' : '', style: { height: `${Math.max(4, Math.round(n / mx * 30))}px` } }), h('span', ['indiv.', 'contatt.', 'incontri', 'opport.'][k]))));
  };
  const big = (n, cls = '') => h('div.nb-big', { class: cls }, n);
  const sub = x => h('div.nb-sub', x);
  const lightWhy = i => i.light.reasons.filter(r => r.c === i.light.color).map(r => r.t).join(' · ') || 'Tutto in regola';
  const meur = n => (n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : eur(n));
  const rows = [
    ['Semaforo · perché', i => h('div.nb-mx-t', lightWhy(i))],
    ['Fase e gate', i => [tk(i.phase), h('div.nb-mx-ph', phaseName(i), h('span.muted', ` · ${PHASE_KEYS.indexOf(i.phase) + 1} di 5`)),
      i.gate ? h('div.nb-mt8', h('span.nb-when', { class: i.gate.days > 0 ? 'rd' : i.gate.due_date && i.gate.days >= -14 ? 'am' : 'gy' },
        `G${i.gate.n} ${i.gate.due_date ? (i.gate.days > 0 ? `scaduto il ${dm(i.gate.due_date)}` : dm(i.gate.due_date)) : 'da fissare'}`)) : null]],
    ['Cosa ci manca', i => (i.gaps.total ? [big(`${i.gaps.ok} / ${i.gaps.total}`), h('div.nb-burn.ok', h('i', { style: { width: `${Math.round(i.gaps.ok / i.gaps.total * 100)}%` } })), sub('requisiti a posto')] : [big('—', 'dim'), sub('da analizzare')])],
    ['Clienti target', i => (i.funnel.individuati ? funnel(i.funnel) : [big('0', 'dim'), sub('nessun cliente target')])],
    ['Spesa', i => (i.budget ? [big(eur(i.spent)), h('div.nb-burn', { class: i.spent / i.budget > 0.9 ? 'r' : 'ok' }, h('i', { style: { width: `${Math.max(2, Math.min(100, Math.round(i.spent / i.budget * 100)))}%` } })), sub(`su ${eur(i.budget)} · ${Math.round(i.spent / i.budget * 100)}%`)]
      : [big(eur(i.spent)), h('div.nb-mt8', h('span.nb-pi.ln', 'budget da fissare'))])],
    ['Gare vinte e perse', i => (i.outcomes.won + i.outcomes.lost ? [big(`${Math.round(i.outcomes.won / (i.outcomes.won + i.outcomes.lost) * 100)}%`),
      h('div.nb-wl', h('span.nb-pi.gr', `${i.outcomes.won} ${i.outcomes.won === 1 ? 'vinta' : 'vinte'}`), h('span.nb-pi.rd', `${i.outcomes.lost} ${i.outcomes.lost === 1 ? 'persa' : 'perse'}`))] : [big('—', 'dim'), sub('nessuna gara ancora')])],
    ['Mercato · 12 mesi', i => (i.market ? [h('div.nb-mx-ph', `${i.market.gare} gare · ${meur(i.market.valore)}`),
      sub(i.market.ribasso != null ? `ribasso tipico ${Number(i.market.ribasso).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%` : 'ribasso non disponibile')]
      : [h('div.nb-mx-ph.warn-t', 'categorie da scegliere o in arrivo'), sub("tab Mercato dell'iniziativa")])],
    ['Ultima attività', i => h('div.nb-mx-t', { class: i.light.color === 'r' ? 'bad' : '' }, i.lastActivity ? relDay(i.lastActivity) : 'nessuna')],
  ];
  const mx = h('div.nb-mx-wrap', h('div.nb-rmx', { style: { '--n': String(cols.length) } },
    h('div.nb-mx-c.hd.lb', 'Iniziativa'),
    cols.map(i => h('a.nb-mx-c.hd', { href: `#/crm/business/${i.id}/analisi` }, h('div.nb-mx-nm', i.name), h('div.nb-who.nb-small', av(i.owner_name), i.owner_name || '—'), lightPill(i.light.color, LIGHT[i.light.color]))),
    rows.map(([label, f]) => [h('div.nb-mx-c.lb', label), cols.map(i => h('div.nb-mx-c', f(i)))])));

  // telefono: una scheda per iniziativa da scorrere di lato
  const phone = h('div.nb-rp-phone', cols.map((i, n) => h('a.nb-card.nb-rp-tc', { href: `#/crm/business/${i.id}/analisi` },
    h('div.nb-row-sb', h('span.nb-small.muted', `${n + 1} di ${cols.length}`), lightPill(i.light.color, LIGHT[i.light.color])),
    h('div.nb-t16', i.name), h('div.nb-small.muted', lightWhy(i)),
    h('div.nb-rp-kv', [['Fase', phaseName(i)], ['Requisiti', `${i.gaps.ok}/${i.gaps.total}`], ['Clienti', `${i.funnel.contattati}/${i.funnel.individuati}`],
      ['Spesa', eur(i.spent)], ['Gare', i.outcomes.won + i.outcomes.lost ? `${i.outcomes.won} ${i.outcomes.won === 1 ? 'vinta' : 'vinte'} · ${i.outcomes.lost} ${i.outcomes.lost === 1 ? 'persa' : 'perse'}` : '—'], ['Mercato', i.market ? `${i.market.gare} gare` : '—']]
      .map(([k, v]) => h('div', h('small', k), h('b', v)))))));

  const ab = d.abandoned.length ? h('div.nb-ab', ic('clock', 16), h('span', h('b', 'Abbandonate: '),
    d.abandoned.map(a => `${a.name}${a.abandoned_on ? ` · ${dm(a.abandoned_on)}` : ''}${a.abandoned_reason ? ` · «${a.abandoned_reason}»` : ''}${a.owner_name ? ` (${a.owner_name})` : ''}`).join(' — '), ' · non entrano nei totali.')) : null;

  fill(container, h('div.nb.nb-rp',
    head,
    h('div.nb-fcs.nb-rsum',
      counter('grid', t.open, t.open === 1 ? 'iniziativa aperta' : 'iniziative aperte'),
      counter('alert-triangle', t.decide, 'gate da decidere', t.lateGates ? 'hot' : t.decide ? '' : 'zero'),
      counter('target', t.targets, 'clienti target', t.targets ? '' : 'zero'),
      counter('square-check', `${t.gapsOk}/${t.gapsTotal}`, 'requisiti a posto'),
      counter('trophy', t.ratio === null ? '—' : `${t.ratio}%`, t.won + t.lost ? `win ratio · ${t.won} vinte · ${t.lost} perse` : 'win ratio', t.won + t.lost ? '' : 'zero'),
      h('div.nb-fc.nb-fc-wide', h('div.nb-row-sb', h('span.nb-small.strong', 'Spesa sul budget'), h('b', eur(t.spent), h('span.muted', ` / ${eur(t.budget)}`))), burn(spendPct),
        h('div.nb-small.muted', `${spendPct}% del budget delle iniziative aperte`))),
    decBox, mx, phone, ab,
    riepilogoPrint(d, stamp)));
}

// foglio A4 del riepilogo (si vede solo in stampa)
function riepilogoPrint(d, stamp) {
  const t = d.totals;
  const row = (label, f) => h('tr', h('th', label), d.open.map(i => h('td', f(i))));
  return h('div.nb-print.nb-rp-print', { 'aria-hidden': 'true' },
    h('div.nb-pr-head', h('div', h('div.en-eyebrow', 'Alma CRM · Nuovi business · riunione di direzione'), h('div.nb-pr-t', 'Riepilogo delle ', h('b', 'iniziative'))),
      h('div.nb-small.muted.nb-right', stamp, h('br'), `${t.open} aperte`)),
    h('div.nb-pr-k', [['Iniziative', String(t.open)], ['Gate da decidere', String(t.decide)], ['Requisiti a posto', `${t.gapsOk} di ${t.gapsTotal}`], ['Spesa', `${eur(t.spent)} / ${eur(t.budget)}`]]
      .map(([l, n]) => h('div', h('div.nb-lbl', l), h('b', n)))),
    d.decide.length ? h('div', h('div.nb-lbl', 'Da decidere'), d.decide.map(x => h('div.nb-pr-dec', `${x.name} · gate G${x.gate.n} «${x.gate.question}»${x.gate.due_date ? ` · ${x.gate.days > 0 ? 'scaduto il' : 'entro il'} ${dm(x.gate.due_date)}` : ''}`,
      h('div.nb-pr-box', '☐ Prosegui     ☐ Rimanda al ________     ☐ Abbandona')))) : null,
    h('table.nb-pr-tbl', h('thead', h('tr', h('th', ''), d.open.map(i => h('th', i.name)))),
      h('tbody',
        row('Responsabile', i => i.owner_name || '—'),
        row('Semaforo', i => LIGHT[i.light.color]),
        row('Fase', i => PHASES[PHASE_KEYS.indexOf(i.phase)]?.[1] || '—'),
        row('Gate', i => (i.gate ? `G${i.gate.n} ${i.gate.due_date ? dm(i.gate.due_date) : 'da fissare'}` : '—')),
        row('Requisiti', i => `${i.gaps.ok} / ${i.gaps.total}`),
        row('Clienti target', i => `${i.funnel.individuati} · ${i.funnel.contattati} contattati · ${i.funnel.opportunita} opport.`),
        row('Spesa', i => `${eur(i.spent)}${i.budget ? ` / ${eur(i.budget)}` : ''}`),
        row('Gare', i => (i.outcomes.won + i.outcomes.lost ? `${i.outcomes.won} vinte · ${i.outcomes.lost} perse` : '—')),
        row('Mercato', i => (i.market ? `${i.market.gare} gare` : '—')),
        row('Ultima attività', i => (i.lastActivity ? dm(i.lastActivity) : '—')))),
    h('div.nb-lbl', 'Note della riunione'), h('div.nb-pr-notes'),
    h('div.nb-small.muted.nb-pr-foot', 'Generato da Alma Space · Nuovi business · Riepilogo',
      d.abandoned.length ? ` · Abbandonate: ${d.abandoned.map(a => `${a.name}${a.abandoned_on ? ` (${dm(a.abandoned_on)})` : ''}`).join(', ')}` : ''));
}

function initiativeCard(i) {
  const reason = i.light.reasons.find(r => r.c === i.light.color && r.c !== 'g');
  const next = i.nextTask;
  return h('a.nb-card.nb-ini', { href: `#/crm/business/${i.id}` },
    h('div.nb-row-sb.top', h('div.nb-min0', h('div.nb-t16', i.name), i.description ? h('div.nb-small.muted.nb-clip2', i.description) : null),
      i.phase === 'abbandonata' ? pill('Abbandonata', 'off') : lightPill(i.light.color, LIGHT[i.light.color])),
    miniStep(i.phase),
    h('div.nb-ini-3',
      h('div', h('div.nb-lbl', 'Cosa ci manca'), h('div.nb-small.strong', i.gaps.total ? `${i.gaps.ok} di ${i.gaps.total} a posto` : 'da analizzare'),
        h('div.nb-bar', h('i', { style: { width: `${i.gaps.total ? Math.round(i.gaps.ok / i.gaps.total * 100) : 0}%` } }))),
      h('div', h('div.nb-lbl', 'Clienti contattati'), h('div.nb-n18', `${i.funnel.contattati} / ${i.funnel.individuati}`)),
      h('div', h('div.nb-lbl', 'Ultima attività'), h('div.nb-small.strong', relDay(i.lastActivity)))),
    h('div.nb-row-sb.foot', h('span.nb-who', av(i.owner_name), i.owner_name || '—'),
      i.phase === 'abbandonata' ? h('span.nb-small.muted', i.abandoned_reason || '') : reason ? h('span.nb-small.warn-t', reason.t) : h('span.nb-small.muted', next ? `Prossimo: ${next}` : 'Tutto in regola')));
}

function emptyState(ctx) {
  return [
    h('section.nb-card.nb-empty', h('span.nb-empty-i', ic('grid', 24)), h('div.nb-empty-t', 'Nessuna iniziativa ancora'),
      h('div.muted.nb-empty-d', 'Un\'iniziativa è un\'area d\'affari nuova da esplorare, per esempio «Reti elettriche MT/BT»: ha un responsabile, cinque fasi e una decisione della direzione tra una fase e l\'altra.'),
      h('div.nb-actions', btn('Chiedi un\'idea all\'assistente', () => ideaDialog(ctx), { ico: 'lightbulb' }), btn('Nuova iniziativa', () => initiativeForm(ctx), { primary: true, ico: 'plus' }))),
    h('div.nb-lbl.nb-sec', 'Come funziona'),
    h('section.nb-card.nb-how', PHASES.map(([, l], k) => h('div', h('span.nb-ph', h('span.nb-ph-c', String(k + 1)), h('b', l)), h('div.nb-small.muted', PHASE_HINT[k]),
      h('div.nb-small.muted.nb-who', h('span.nb-gd.static'), `gate G${k}`)))),
    h('div.nb-starter', [['Chat con l\'assistente', 'Conosce BU, SOA, commesse e CRM di Almacis e cerca in rete. Ogni risposta diventa clienti target, requisiti o passi con un clic.', 'lightbulb'],
      ['Sinergie dal CRM', 'Per ogni cliente target ti dice chi di noi lo conosce, chi l\'ha incontrato, quali partner ci lavorano già.', 'users'],
      ['Analisi per la direzione', 'Fase, gate, spesa, attività del responsabile e semaforo, calcolati da soli: niente report a mano.', 'square-check']]
      .map(([t, d, i]) => h('section.nb-card', h('span.nb-ki.chat', ic(i)), h('div.nb-t15', t), h('div.nb-small.muted', d)))),
  ];
}

// ── nuova iniziativa (due passi) e modifica ───────────────────────────────────────────────────
function initiativeForm(ctx, preset = {}) {
  const asa = ctx.crmData?.asa || [];
  const name = input({ value: preset.name || '', placeholder: 'Es. Reti elettriche MT/BT' });
  const desc = textarea(preset.description || '', { placeholder: 'Che cosa vorremmo fare, per chi', rows: 3 });
  const startAi = h('input', { type: 'checkbox', checked: Boolean(ctx.ai) });
  const owner = select(userOptions('Scegli…'), '');
  const sponsor = select(userOptions(), store.me.id);
  const asaSel = select([['', '—'], ...asa.map(a => [a.key, a.label])], '');
  const budget = input({ inputmode: 'decimal', placeholder: '25.000' });
  const g0 = input({ type: 'date', value: (() => { const x = new Date(); x.setDate(x.getDate() + 14); return x.toLocaleDateString('sv-SE'); })() });
  const body = h('div.nb-form');
  const stepTag = n => h('div.nb-steps', h('span.nb-pill', { class: n === 1 ? 's4' : 's3' }, n === 1 ? '1 · Cosa' : [ic('check', 12), ' 1 · Cosa']), h('span.muted', '→'), h('span.nb-pill', { class: n === 2 ? 's4' : 's0' }, '2 · Chi e quanto'));
  // un solo gestore per pulsante (onclick), cambiato a ogni passo
  const back = h('button.nb-btn.ghost', { type: 'button' }, 'Annulla');
  const nextBtn = h('button.nb-btn.pri', { type: 'button' }, 'Avanti');
  const m = dlg(modal({ title: 'Nuova iniziativa', body, left: [back], actions: [nextBtn] }));
  function goStep(n) {
    if (n === 2 && !name.value.trim()) return toast('Scrivi il nome dell\'iniziativa', 'err');
    if (n === 1) {
      fill(body, stepTag(1), field('Nome', name), field('Cosa vorremmo fare, per chi', desc),
        ctx.ai ? h('label.nb-prop.nb-checkrow', h('span.nb-ki.chat.sm', ic('lightbulb', 14)), h('div.grow.nb-small', h('b', 'Parti con l\'assistente'), h('br'), 'appena aperta, chiede chi possono essere i clienti e cosa ci manca. Costo stimato 0,05 €.'), startAi) : null);
      back.replaceChildren('Annulla'); back.onclick = () => m.close();
      setTimeout(() => name.focus(), 30);
      nextBtn.replaceChildren('Avanti'); nextBtn.onclick = () => goStep(2);
    } else {
      fill(body, stepTag(2), h('div.nb-two', field('Responsabile', owner), field('Sponsor della direzione', sponsor)),
        h('div.nb-two', field('Budget', budget, 'per la fase di esplorazione e analisi'), field('ASA dei nuovi lead', asaSel, 'i clienti target creati come lead prendono questa ASA')),
        field('Gate G0 · aprire l\'iniziativa', g0, 'è la prima decisione della direzione'));
      back.replaceChildren('Indietro'); back.onclick = () => goStep(1);
      nextBtn.replaceChildren('Apri l\'iniziativa'); nextBtn.onclick = save;
    }
  }
  async function save() {
    const out = await post('/api/crm/business', { name: name.value, description: desc.value, owner_id: Number(owner.value) || null, sponsor_id: Number(sponsor.value) || null, asa: asaSel.value || null, budget_eur: budget.value, gate0_due: g0.value || undefined });
    m.close();
    toast('Iniziativa aperta');
    location.hash = `#/crm/business/${out.id}/chat`;
    if (ctx.ai && startAi.checked) sessionStorage.setItem(`nb-ask-${out.id}`, 'Chi possono essere i primi clienti per questa iniziativa e cosa ci manca per entrare in questo business?');
  }
  goStep(1);
}

function editForm(i, asa, done, meta = {}) {
  const name = input({ value: i.name });
  const desc = textarea(i.description);
  const owner = select(userOptions('Scegli…'), i.owner_id || '');
  const sponsor = select(userOptions(), i.sponsor_id || '');
  const asaSel = select([['', '—'], ...asa.map(a => [a.key, a.label])], i.asa || '');
  const budget = input({ value: i.budget_eur ? String(Number(i.budget_eur)) : '', inputmode: 'decimal' });
  const spent = input({ value: i.spent_eur ? String(Number(i.spent_eur)) : '', inputmode: 'decimal' });
  const started = input({ type: 'date', value: i.started_on || '' });
  const pd = i.phase_dates || {};
  const dates = PHASES.map(([k, l]) => [k, l, input({ type: 'date', value: pd[k]?.from || '' }), input({ type: 'date', value: pd[k]?.to || '' }), input({ value: i.periods?.[k] || '', placeholder: 'es. nov – gen' })]);
  const m = dlg(modal({
    title: 'Modifica l\'iniziativa', wide: true,
    body: h('div.nb-form', field('Nome', name), field('Descrizione', desc),
      h('div.nb-two', field('Responsabile', owner), field('Sponsor della direzione', sponsor)),
      h('div.nb-two', field('ASA dei nuovi lead', asaSel), field('Budget', budget)),
      h('div.nb-fl', h('span.nb-lbl', 'Categorie SOA'), h('div.nb-row.wrap', (i.profile?.soa || []).length ? i.profile.soa.map(c => h('span.nb-chip.sm', c, i.profile.soa_classes?.[c] ? ` · cl. ${i.profile.soa_classes[c]}` : '')) : h('span.nb-small.muted', 'nessuna'),
        h('button.nb-link', { type: 'button', on: { click: () => { m.close(); soaDialog(i, meta, done); } } }, ic('pencil', 14), 'Scegli le categorie')), h('small', 'Servono al Radar e alla tab Mercato.')),
      h('div.nb-two', field('Spese scritte a mano', spent, 'Consulenze, corsi… L\'assistente si somma da solo.'), field('Avviata il', started)),
      h('div.nb-lbl', 'Quando si fa ogni fase'), h('small.muted', 'Le date disegnano il Gantt del piano; senza date valgono quelle dei gate.'),
      h('div.nb-dates', dates.map(([, l, f, t, p]) => [h('span.nb-small.strong', l), f, t, p]))),
    left: [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva', async () => {
      await patch(`/api/crm/business/${i.id}`, {
        name: name.value, description: desc.value, owner_id: Number(owner.value) || null, sponsor_id: Number(sponsor.value) || null, asa: asaSel.value || null,
        budget_eur: budget.value, spent_eur: spent.value, started_on: started.value || undefined,
        phase_dates: Object.fromEntries(dates.map(([k, , f, t]) => [k, { from: f.value || null, to: t.value || null }])),
        periods: Object.fromEntries(dates.map(([k, , , , p]) => [k, p.value])),
      });
      m.close();
      toast('Salvata');
      done();
    }, { primary: true })],
  }));
}

// «Chiedi un'idea»: finestra larga con domande pronte; le idee diventano schede «Apri come iniziativa»
function ideaDialog(ctx) {
  const list = h('div.nb-msgs');
  const q = textarea('', { rows: 2, placeholder: 'Scrivi una domanda…' });
  const send = async text => {
    if (!text.trim()) return;
    q.value = '';
    list.append(bubble({ role: 'user', body: text, author_name: store.me.name }));
    const wait = h('div.nb-wait', loading(), h('span.nb-small.muted', 'L\'assistente sta pensando…'));
    list.append(wait);
    try {
      const m = await post('/api/crm/business/idea', { question: text });
      wait.remove();
      const ideas = m.proposals?.ideas || [];
      list.append(h('div.nb-msg.ai', h('span.nb-who-i.ai', ic('lightbulb', 15)), h('div.grow.nb-col',
        ideas.length ? ideas.map(x => h('div.nb-prop.white', h('div.nb-prop-r', h('div.grow', h('div.nb-t15', x.name), h('div.nb-small.muted', x.why)),
          h('span.nb-who.nb-small', dot(x.closeness === 'alta' ? 'g' : x.closeness === 'media' ? 'y' : 'n'), `vicinanza ${x.closeness}`),
          btn('Apri come iniziativa', () => { md.close(); initiativeForm(ctx, { name: x.name, description: x.why }); }, { small: true }))))
          : h('div.nb-bubble', richText(m.body)),
        h('div.nb-small.muted', `${m.sources?.length ? `${m.sources.length} fonti · ` : ''}${eur2(m.cost_eur)}`))));
    } catch { wait.remove(); }
  };
  const md = dlg(modal({
    title: 'Chiedi un\'idea all\'assistente', wide: true,
    body: h('div.nb-form', h('div.nb-small.muted', 'Conosce BU, SOA, commesse e clienti di Almacis. Ti propone aree d\'affari vicine a quello che facciamo già.'),
      ctx.ai ? chips([['Quali mercati vicini alle reti gas e idriche potremmo provare nel 2027?', 'Mercati vicini alle reti gas e idriche'], ['Cosa possiamo fare di nuovo con le squadre di Facility?', 'Cosa fare con le squadre di Facility'], ['Quali lavori finanziati dal PNRR nel 2027 sono vicini a noi?', 'Lavori finanziati dal PNRR nel 2027']], null, send) : null,
      list,
      ctx.ai ? h('div.nb-comp', q, h('div.nb-row-end', btn('Invia', () => send(q.value), { primary: true, ico: 'message' }))) : empty('L\'assistente si accende quando su Railway c\'è OPENAI_API_KEY.', 'alert-triangle')),
    left: [h('span.nb-small.muted', 'Le risposte restano nella cronologia delle idee.')],
    actions: [btn('Chiudi', () => md.close())],
  }), 'nb-dlg-wide');
}

// ── iniziativa: testata, tab ──────────────────────────────────────────────────────────────────
async function initiativePage(container, id, tabKey, crmData) {
  fill(container, loading());
  const i = await get(`/api/crm/business/${id}`);
  markShareOpened('business', id); // ALM2-87: «aperta» per chi l'ha ricevuta con Condividi
  const allTabs = [...TABS, ...WORK_TABS, ...MORE_TABS];
  const tab = allTabs.some(([k]) => k === tabKey) ? tabKey : 'chat';
  const go = (k, extra) => { history.replaceState(null, '', `#/crm/business/${id}/${k}`); initiativePage(container, id, k, { ...crmData, ...extra }); };
  const refresh = () => initiativePage(container, id, tab, crmData);
  // il progetto dell'iniziativa (ALM2-79): compiti, relazioni, incontri, calendario, email, note, documenti, Gantt, membri
  const [{ tasks }, proj, sum] = await Promise.all([
    get(`/api/crm/business/${id}/tasks`),
    i.project_id ? get(`/api/projects/${i.project_id}`, { quiet: true }).catch(() => null) : null,
    i.project_id ? get(`/api/crm/progetti/${i.project_id}`, { quiet: true }).catch(() => null) : null]);
  const lateTask = tasks.find(t => t.late);
  const body = h('div.nb-body', loading());
  const toolbar = h('div.nb-tb-r');
  const more = h('div.nb-menu-list');
  if (crmData.admin) more.append(h('button.nb-menu-i.danger', { type: 'button', on: { click: async () => {
    if (!await confirmDialog(`Eliminare «${i.name}» con chat, clienti target, gap e riflessioni? Per chiuderla e tenerne la storia usa «Abbandona» al gate.`, { ok: 'Elimina', danger: true })) return;
    await del(`/api/crm/business/${id}`);
    location.hash = '#/crm/business';
  } } }, 'Elimina l\'iniziativa'));
  more.append(h('button.nb-menu-i', { type: 'button', on: { click: () => go('analisi', { print: true }) } }, 'Esporta per la riunione'));
  const reason = i.light.reasons.find(r => r.c === i.light.color && r.c !== 'g');
  const member = Boolean(proj && proj.my_role && proj.my_role !== 'viewer');
  const ctx = { i, id, body, toolbar, refresh, go, crmData, tasks, proj, sum, member, ask: q => go('chat', { ask: q }) };
  const n = (t, x) => [t, x ? h('span.nb-tab-n', x) : null];
  const tabBtn = (k, l, work = false) => h('button', { type: 'button', role: 'tab', class: [k === tab ? 'on' : '', work ? 'work' : ''].join(' '), 'aria-selected': String(k === tab), on: { click: () => go(k) } }, l);
  const openTasks = sum ? sum.tasks_total - sum.tasks_done : 0;
  const tabLabel = k => (k === 'gap' ? n('Cosa ci manca', i.gaps.total ? `${i.gaps.ok}/${i.gaps.total}` : '') : k === 'clienti' ? n('Clienti target', i.funnel.individuati || '')
    : k === 'piano' && i.lateTasks ? ['Piano', h('span.nb-bang', '!')] : k === 'mercato' ? n('Mercato', i.market_gare || '')
      : k === 'compiti' ? (sum?.tasks_late ? ['Compiti', h('span.nb-bang', '!')] : n('Compiti', openTasks || '')) : k === 'incontri' ? n('Incontri', sum?.meetings || '')
        : allTabs.find(x => x[0] === k)[1]);
  const moreMenu = h('details.nb-more-tab', { class: MORE_TABS.some(([k]) => k === tab) ? 'on' : '' },
    h('summary', MORE_TABS.find(([k]) => k === tab)?.[1] || 'Altro', ic('chevron-down', 12)),
    h('div.nb-menu-list', MORE_TABS.map(([k, l]) => h('button.nb-menu-i', { type: 'button', on: { click: () => go(k) } }, l))));
  const nextMeet = sum?.next_meeting ? new Date(sum.next_meeting) : null;
  const stats = h('div.nb-stats.four',
    h('div', h('b', sum ? `${sum.tasks_done} / ${sum.tasks_total}` : '—'), h('small', 'compiti fatti'), sum?.tasks_late ? h('small.nb-red', `${sum.tasks_late} in ritardo`) : null),
    h('div', h('b', nextMeet ? nextMeet.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'Europe/Rome' }) : '—'), h('small', 'prossimo incontro')),
    h('div', h('b', `${i.funnel.contattati} / ${i.funnel.individuati}`), h('small', 'clienti contattati')),
    h('div', h('b', eur(i.spent)), h('small', `su ${eur(i.budget_eur)} di budget`)));
  const newTask = () => openTicket(null, { defaults: { project_id: i.project_id, assignee_ids: [store.me.id] }, onSaved: refresh });
  const gl = i.gate;
  fill(container, h('div.nb',
    h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: '#/crm/business' }, ic('chevron-left'), 'Nuovi business')),
    h('section.nb-card.nb-hero',
      h('div.nb-min0', h('div.en-eyebrow', `Nuovo business · dal ${day(i.started_on)}`), h('h1', title2(i.name)),
        i.description ? h('div.nb-desc', i.description) : null,
        h('div.nb-meta', h('span.nb-who', av(i.owner_name), `${i.owner_name || '—'} · responsabile`), i.sponsor_name ? h('span.nb-who', av(i.sponsor_name, 'o'), `${i.sponsor_name} · sponsor`) : null,
          i.phase === 'abbandonata' ? pill('Abbandonata', 'off') : lightPill(i.light.color, `${LIGHT[i.light.color]}${reason ? ` · ${reason.t[0].toLowerCase()}${reason.t.slice(1)}` : ''}`))),
      h('div.nb-hero-r', h('div.nb-actions',
        // «Porta avanti» (canvas v9, ALM2-79): il progetto dell'iniziativa riceve squadra, piano e obiettivo ed entra in «I miei progetti»
        i.project_id && i.launched_at ? btn('Apri il progetto', () => { location.hash = `#/crm/progetto/${i.project_id}`; }, { ico: 'folder' })
          : i.canEdit && i.phase !== 'abbandonata' ? btn('Porta avanti', () => { location.hash = `#/crm/lancio/i/${i.id}`; }, { ico: 'rocket', primary: true }) : null,
        member ? btn('Nuovo compito', newTask, { ico: 'plus' }) : null,
        btn('Condividi', () => shareDialog({ kind: 'business', id: i.id }), { ico: 'share-2' }), // ALM2-87
        i.canEdit ? btn('Modifica', () => editForm(i, crmData.asa || [], refresh, crmData.meta || {}), { ico: 'pencil' }) : null,
        h('details.nb-menu', h('summary.nb-btn.ghost', { 'aria-label': 'Altro' }, ic('more')), more)), stats),
      h('div.nb-hero-steps', stepper(i))),
    gl?.late && i.phase !== 'abbandonata' ? h('div.nb-focus', ic('alert-triangle'), h('div.grow', h('b', 'Da decidere: '), `gate G${gl.n} «${gl.question}» è scaduto il ${day(gl.due_date)}.${lateTask ? ` Passo scaduto: «${lateTask.title}» (${lateTask.owner_name || '—'}).` : ''}`),
      i.canDecide ? btn('Decidi il gate', () => gateDialog(i, gl, 'prosegui', tasks, refresh), { small: true }) : null,
      lateTask ? btn('Apri il passo', () => go('piano'), { small: true, ghost: true }) : null) : null,
    shareStrip('business', id), // ALM2-87: chi l'ha condivisa, con chi e se l'hanno aperta
    h('div.nb-tb', h('nav.nb-tabs.nb-tabs2', { role: 'tablist', 'aria-label': 'Sezioni dell\'iniziativa' },
      h('span.nb-tabgrp', 'Strategia'), TABS.map(([k]) => tabBtn(k, tabLabel(k))),
      h('span.nb-tabsep', { 'aria-hidden': 'true' }),
      h('span.nb-tabgrp', 'Lavoro'), WORK_TABS.map(([k]) => tabBtn(k, tabLabel(k), true)), moreMenu), toolbar),
    body));
  const fn = { chat: chatTab, clienti: targetsTab, gap: gapsTab, piano: planTab, radar: radarTab, riflessioni: notesTab, analisi: analysisTab, mercato: mercatoTab,
    compiti: workTasksTab, relazioni: workRelationsTab, incontri: workTab, calendario: workTab, email: workTab, note: workTab, documenti: workTab, gantt: workTab, membri: membersTab }[tab];
  await fn({ ...ctx, tab, newTask });
}

// ── Lavoro: i tab del progetto dell'iniziativa (ALM2-79) ─────────────────────────────────────────
// Email suggerite da Alma: cerca nella MIA casella le email delle persone e aziende collegate e quelle che parlano
// dell'iniziativa; le vedo solo io ed entrano solo con il mio sì (come in Posta › Da approvare, ALM2-67).
function mailSuggestions(ctx) {
  const pid = ctx.proj.id;
  const box = h('section.nb-card.nb-sugg');
  const key = `nb.cerca.${pid}`;
  let searching = false;
  const draw = async () => {
    const { suggestions: list } = await get(`/api/crm/progetti/${pid}/suggerite`, { quiet: true }).catch(() => ({ suggestions: [] }));
    const act = async (s, azione) => { await post(`/api/crm/progetti/${pid}/suggerite/${s.id}`, { azione }); if (azione === 'aggiungi') ctx.go('email'); else draw(); };
    const searchBtn = btn(searching ? 'Cerco…' : 'Cerca nella mia posta', () => run(), { small: true, ico: 'search', disabled: searching });
    fill(box,
      h('div.nb-sugg-h', h('span.nb-ki.chat', ic('sparkles', 15)),
        h('div.grow', h('b', list.length ? `Alma ha trovato ${list.length} ${list.length === 1 ? 'email che sembra' : 'email che sembrano'} di questa iniziativa` : 'Email dell\'iniziativa nella tua posta'),
          h('div.nb-small.muted', list.length ? 'Sono nella tua casella: le vedi solo tu ed entrano nell\'iniziativa solo se dici sì.' : 'Alma cerca le email delle persone e delle aziende collegate e quelle che parlano dell\'iniziativa. Le vedi solo tu.')),
        list.length > 1 ? btn('Entrano tutte', async () => { await post(`/api/crm/progetti/${pid}/suggerite`, { azione: 'aggiungi' }); ctx.go('email'); }, { small: true }) : null,
        searchBtn),
      list.length ? h('div.nb-sugg-list', list.map(s => h('div.nb-sugg-r',
        h('div.grow', h('b', s.subject || '(senza oggetto)'), h('small', [s.from_name || s.from_address, s.sent_at ? relDay(s.sent_at) : null, s.why].filter(Boolean).join(' · '))),
        btn('Aggiungi', () => act(s, 'aggiungi'), { small: true }), btn('Non c\'entra', () => act(s, 'scarta'), { small: true, ghost: true })))) : null);
  };
  const run = async () => {
    searching = true; draw();
    try {
      const r = await post(`/api/crm/progetti/${pid}/cerca-email`, {});
      try { sessionStorage.setItem(key, '1'); } catch { /* niente */ }
      toast(r.found ? `Trovate ${r.found} email nuove da guardare` : 'Nessuna email nuova trovata');
    } finally { searching = false; draw(); }
  };
  // la prima volta che apro il tab in questa sessione Alma cerca da sola
  let done = false;
  try { done = sessionStorage.getItem(key) === '1'; } catch { /* niente */ }
  if (!done && ctx.member) run().catch(() => {}); else draw();
  return box;
}
const noProject = ctx => fill(ctx.body, empty('Il progetto dell\'iniziativa non si è caricato: ricarica la pagina.', 'alert-triangle'));
async function workTasksTab(ctx) {
  const { i, proj, body, member, newTask } = ctx;
  if (!proj) return noProject(ctx);
  const [tickets, meetings, emails, targets] = await Promise.all([get(`/api/tickets?project=${proj.id}`),
    get(`/api/projects/${proj.id}/meetings`, { quiet: true }).catch(() => []), get(`/api/projects/${proj.id}/emails`, { quiet: true }).catch(() => []),
    get(`/api/crm/business/${i.id}/targets`, { quiet: true }).then(r => r.targets).catch(() => [])]);
  // sinergie dal CRM: i clienti target che conosciamo già (contatti, incontri, email dei colleghi)
  const syn = targets.filter(t => t.subject_id && t.status !== 'scartato' && t.synergies?.length).slice(0, 4);
  let mine = false;
  const boardBox = h('div');
  // il selettore Tutti/Miei ridisegna solo la bacheca
  const segBox = h('div');
  const drawSeg = () => fill(segBox, seg([['tutti', 'Tutti'], ['miei', 'Miei']], mine ? 'miei' : 'tutti', k => { mine = k === 'miei'; drawSeg(); drawBoard(); }));
  const drawBoard = () => fill(boardBox, taskBoard(mine ? tickets.filter(t => (t.assignee_ids || []).includes(store.me.id)) : tickets, proj, ctx.refresh, { drag: member, origin: true }));
  const today = todayIso();
  const weekEnd = new Date(`${today}T12:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const we = weekEnd.toISOString().slice(0, 10);
  const week = [
    ...meetings.filter(m => String(m.start_at).slice(0, 10) >= today && String(m.start_at).slice(0, 10) <= we).map(m => ({ d: String(m.start_at).slice(0, 10), t: m.subject || 'Incontro', k: 'inc' })),
    ...tickets.filter(t => t.status !== 'done' && t.due_date && t.due_date <= we).map(t => ({ d: t.due_date, t: t.title, k: t.due_date < today ? 'late' : 'task', id: t.id })),
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
  fill(body, h('div.nb-work',
    h('div.nb-work-main',
      h('div.nb-work-h', h('div.grow', h('p.nb-small.muted', 'Gli stessi compiti di un progetto: assegnati, con scadenza, in «La mia settimana». I passi del Piano sono qui con l\'etichetta «Piano». Trascina un compito per cambiarne lo stato.')),
        segBox),
      boardBox),
    h('aside.nb-work-side',
      card('Questa settimana', h('button.nb-link', { type: 'button', on: { click: () => ctx.go('calendario') } }, 'Calendario'),
        week.length ? week.map(w => h(w.id ? 'button.nb-wk' : 'div.nb-wk', { type: w.id ? 'button' : undefined, class: w.k, on: w.id ? { click: () => openTicket(w.id, { onSaved: ctx.refresh }) } : undefined },
          h('span.nb-wk-d', w.d < today ? 'scaduto' : new Date(`${w.d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })), h('i'), h('span', w.t)))
          : h('p.nb-small.muted', 'Niente in agenda nei prossimi sette giorni.')),
      card('Ultime email', h('button.nb-link', { type: 'button', on: { click: () => ctx.go('email') } }, 'Tutte'),
        emails.length ? emails.slice(0, 3).map(e => h('div.nb-wm', h('b', e.subject || '(senza oggetto)'), h('small', [e.from_name || e.from_address, e.sent_at ? relDay(e.sent_at) : null].filter(Boolean).join(' · '))))
          : h('p.nb-small.muted', 'Nessuna email nell\'iniziativa. Collegale dal tab Email.')),
      card('Sinergie trovate', h('button.nb-link', { type: 'button', on: { click: () => ctx.go('clienti') } }, 'Clienti target'),
        syn.length ? syn.map(t => h('div.nb-wm', h('a.nb-t', { href: `#/crm/scheda/${t.subject_id}` }, t.subject_name || t.name), h('small', t.synergies.slice(0, 2).join(' · '))))
          : h('p.nb-small.muted', 'Nessun cliente target già nel CRM. Aggiungili dal tab Clienti target o dalla Chat.')))));
  drawSeg();
  drawBoard();
}
async function workRelationsTab(ctx) {
  const { proj, body, member } = ctx;
  if (!proj) return noProject(ctx);
  fill(body, h('div.nb-work',
    h('div.nb-work-main',
      h('p.nb-small.muted', 'Aziende ed enti del CRM collegati all\'iniziativa, ognuno con le sue persone: spunta chi c\'entra. Collegando una persona entra anche la sua azienda. I clienti target nel CRM entrano da soli.'),
      relationsBox(proj.id, { canEdit: member || ctx.i.canEdit })),
    h('aside.nb-work-side', touchBox({ project: proj.id }, { onChange: ctx.refresh }))));
}
async function workTab(ctx) {
  const { proj, body, tab } = ctx;
  if (!proj) return noProject(ctx);
  const box = h('div.nb-workpane');
  fill(body, box);
  const canManage = proj.my_role === 'owner' || proj.my_role === 'admin';
  if (tab === 'incontri') projectMeetings(box, proj, {});
  else if (tab === 'calendario') {
    // i gate della direzione ancora da decidere, con la loro data
    const gates = ctx.i.gates.filter(g => g.due_date && !g.decision).map(g => ({ date: g.due_date, kind: 'gate', title: `Gate G${g.n} · ${g.question}`,
      on: ctx.i.canDecide ? () => gateDialog(ctx.i, g, 'prosegui', ctx.tasks, ctx.refresh) : null }));
    calendarTab(box, proj.id, { extra: gates });
  } else if (tab === 'email') { box.append(mailSuggestions(ctx)); projectEmails(box, proj); }
  else if (tab === 'note') notesPanel(box, { url: `/api/projects/${proj.id}/notes`, showTicket: true });
  else if (tab === 'documenti') projectDocuments(box, proj.id, { canManage, onFolderChanged: ctx.refresh });
  else if (tab === 'gantt') ganttView(box, new URLSearchParams({ project: String(proj.id) }), { embedded: true });
}
async function membersTab(ctx) {
  const { proj, body, i } = ctx;
  if (!proj) return noProject(ctx);
  const canManage = proj.my_role === 'owner' || proj.my_role === 'admin' || i.canEdit;
  const team = await get(`/api/projects/${proj.id}/members`);
  const add = () => {
    const picker = peoplePicker({ selected: [], label: '＋ Scegli' });
    const md = modal({
      title: `Aggiungi persone a «${i.name}»`, body: [picker.el],
      actions: [btn('Annulla', () => md.close()), btn('Aggiungi', async () => {
        if (!picker.value.length) return toast('Scegli almeno una persona', 'err');
        await post(`/api/projects/${proj.id}/members`, { user_ids: picker.value });
        md.close(); toast('Aggiunte all\'iniziativa'); ctx.refresh();
      }, { primary: true })],
    });
  };
  fill(body, card('Membri', canManage ? btn('Aggiungi persone', add, { small: true, ico: 'plus' }) : null,
    h('p.nb-small.muted', 'Lavorano all\'iniziativa queste persone; gli altri la vedono in sola lettura. Chi viene assegnato a un compito entra da solo.'),
    h('div.nb-members', team.map(m => h('div.nb-member', av(m.name), h('div.grow', h('b', m.name), h('small', m.job_title || m.email || '')),
      h('small', m.owner ? 'Responsabile' : `${m.open_tickets} ${m.open_tickets === 1 ? 'compito aperto' : 'compiti aperti'}`),
      !m.owner && canManage ? btn('Togli', async () => {
        if (!await confirmDialog(`Togliere ${m.name} dall'iniziativa?`, { ok: 'Togli', danger: true })) return;
        await del(`/api/projects/${proj.id}/members/${m.id}`); ctx.refresh();
      }, { small: true, ghost: true }) : null)))));
}

// ── chat ──────────────────────────────────────────────────────────────────────────────────────
function bubble(m, opts = {}) {
  if (m.role === 'user') {
    return h('div.nb-msg.me', h('span.nb-who-i', initials(m.author_name || store.me.name || '?')),
      h('div.grow', h('div.nb-bubble', m.body), m.created_at ? h('div.nb-small.muted.nb-mt4', `${m.author_name || ''} · ${day(m.created_at)} ${String(new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}`) : null));
  }
  const nSrc = (m.sources?.length || 0) + (m.crm?.length || 0);
  return h('div.nb-msg.ai', h('span.nb-who-i.ai', ic('lightbulb', 15)),
    h('div.grow.nb-col',
      h('div.nb-bubble', richText(m.body),
        nSrc ? h('div.nb-srcs', (m.sources || []).map(s => h('a.nb-src', { href: s.url, target: '_blank', rel: 'noopener' }, ic('link', 12), s.title)),
          (m.crm || []).map(s => h('a.nb-src.crm', { href: `#/crm/scheda/${s.subject_id}` }, ic('link', 12), `CRM · ${s.name}`))) : null),
      opts.onApply ? proposeBox(m, opts) : null,
      h('div.nb-small.muted', ['Assistente', m.created_at ? day(m.created_at) : null, nSrc ? `${nSrc} fonti` : null, m.cost_eur ? eur2(m.cost_eur) : null].filter(Boolean).join(' · '))));
}
function proposeBox(m, { onApply, canEdit }) {
  const p = m.proposals || {};
  const used = m.used || {};
  const row = (what, kind, iconName, text, action, doneLabel) => h('div.nb-prop-r', h('span.nb-ki.sm', { class: kind }, ic(iconName, 14)), h('div.grow.nb-small', text),
    used[what] !== undefined ? h('span.nb-done', ic('check', 14), doneLabel) : canEdit ? btn(action, () => onApply(m, what), { small: true }) : null);
  const names = list => list.slice(0, 4).map(x => x.name || x.title).join(', ') + (list.length > 4 ? '…' : '');
  const rows = [
    p.targets?.length ? row('targets', 'chat', 'target', [h('b', `${p.targets.length} ${p.targets.length === 1 ? 'cliente target' : 'clienti target'}`), ` · ${names(p.targets)}`], 'Scegli e aggiungi', 'Aggiunti') : null,
    p.gaps?.length ? row('gaps', 'hyp', 'square-check', [h('b', `${p.gaps.length} ${p.gaps.length === 1 ? 'requisito' : 'requisiti'}`), ` · ${names(p.gaps)}`], 'Scegli e aggiungi', 'Aggiunti') : null,
    p.steps?.length ? row('steps', 'dec', 'clock', [h('b', p.steps.length === 1 ? 'Passo' : `${p.steps.length} passi`), ` · ${p.steps.map(s => s.title).slice(0, 2).join('; ')}`], p.steps.length === 1 ? 'Crea il passo' : 'Scegli e crea', 'Creati') : null,
    p.plan?.length ? row('plan', 'dec', 'gantt', [h('b', 'Piano d\'ingresso'), ` · ${p.plan.length} fasi con passi e gate`], 'Usa come piano', 'Usato') : null,
    row('note', 'nota', 'file-text', 'Salva la risposta nelle riflessioni', 'Salva', 'Salvata'),
  ].filter(Boolean);
  return h('div.nb-prop', h('div.nb-lbl', 'L\'assistente propone'), rows);
}

async function applyDialog(m, what, ctx) {
  const p = m.proposals || {};
  const list = what === 'targets' ? p.targets : what === 'gaps' ? p.gaps : what === 'steps' ? p.steps : null;
  if (!list || (list.length === 1 && what === 'steps')) {
    const out = await post(`/api/crm/business/messages/${m.id}/apply`, { what });
    toast(what === 'note' ? 'Salvata nelle riflessioni' : what === 'plan' ? `Piano usato: ${out.added} passi` : out.added ? `Aggiunti ${out.added}` : 'Erano già presenti');
    return ctx.refresh();
  }
  // quelle già presenti sono segnate e non si aggiungono due volte
  const have = what === 'targets' ? (await get(`/api/crm/business/${ctx.id}/targets`)).targets.map(t => t.name.toLowerCase())
    : what === 'gaps' ? (await get(`/api/crm/business/${ctx.id}/gaps`)).gaps.map(g => g.title.toLowerCase()) : [];
  const checks = list.map(x => { const dup = have.includes(String(x.name || x.title).toLowerCase()); return h('input', { type: 'checkbox', checked: !dup, disabled: dup }); });
  const okBtn = btn('', () => {}, { primary: true });
  const label = () => { const n = checks.filter(c => c.checked).length; okBtn.replaceChildren(`${what === 'steps' ? 'Crea' : 'Aggiungi'} ${n} ${what === 'targets' ? (n === 1 ? 'cliente' : 'clienti') : what === 'gaps' ? (n === 1 ? 'requisito' : 'requisiti') : (n === 1 ? 'passo' : 'passi')}`); };
  checks.forEach(c => c.addEventListener('change', label));
  label();
  const line = (x, k) => {
    const dup = checks[k].disabled;
    const sub = what === 'targets' ? [x.segment, x.why].filter(Boolean).join(' · ') : what === 'gaps' ? [GAP_STATUS[x.status], x.how, x.timing].filter(Boolean).join(' · ') : `entro ${x.days} giorni`;
    return h('label.nb-pick', { class: dup ? 'dup' : '' }, checks[k], h('div.grow', h('div.nb-t15', x.name || x.title), h('div.nb-small.muted', sub), dup ? h('div.nb-small.warn-t', 'c\'è già') : null));
  };
  const md = dlg(modal({
    title: { targets: 'Aggiungi ai clienti target', gaps: 'Aggiungi ai requisiti', steps: 'Crea i passi' }[what],
    body: h('div.nb-form', h('div.nb-small.muted', `Proposti dall'assistente nella risposta del ${day(m.created_at)}.`), h('div.nb-picks', list.map(line))),
    left: [btn('Annulla', () => md.close(), { ghost: true })],
    actions: [okBtn],
  }));
  okBtn.onclick = async () => {
    const indexes = checks.map((c, k) => (c.checked && !c.disabled ? k : null)).filter(x => x !== null);
    if (!indexes.length) return toast('Scegli almeno una voce', 'err');
    const out = await post(`/api/crm/business/messages/${m.id}/apply`, { what, indexes });
    md.close();
    toast(out.added ? `Aggiunti ${out.added}` : 'Erano già presenti');
    ctx.refresh();
  };
}

const CHIPS = ['Chi sono i concorrenti in zona?', 'Quanto costa la qualifica?', 'Prepara il piano d\'ingresso'];
async function chatTab(ctx) {
  const { i, id, body, crmData } = ctx;
  const d = await get(`/api/crm/business/${id}/messages`);
  const list = h('div.nb-msgs', d.messages.length ? d.messages.map(m => bubble(m, { canEdit: i.canEdit, onApply: (msg, what) => applyDialog(msg, what, ctx) }))
    : empty('Fai una domanda: clienti possibili, concorrenti, requisiti per qualificarsi, costi e tempi. Ogni risposta diventa clienti target, requisiti o passi con un clic.', 'lightbulb'));
  const q = textarea('', { rows: 2, placeholder: 'Fai una domanda all\'assistente: clienti, concorrenti, requisiti, costi, tempi…' });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  let busy = false;
  async function send(text = q.value) {
    if (!text.trim() || busy) return;
    busy = true;
    q.value = '';
    if (!d.messages.length) list.replaceChildren();
    list.append(bubble({ role: 'user', body: text, author_name: store.me.name }));
    const wait = h('div.nb-wait', loading(), h('span.nb-small.muted', 'L\'assistente sta cercando…'));
    list.append(wait);
    wait.scrollIntoView({ block: 'nearest' });
    try {
      await post(`/api/crm/business/${id}/messages`, { question: text });
      await ctx.refresh();
    } catch { wait.remove(); q.value = text; } finally { busy = false; }
  }
  const synergies = [];
  const seen = new Set();
  for (const m of d.messages) for (const s of m.crm || []) if (!seen.has(s.subject_id)) { seen.add(s.subject_id); synergies.push(s); }
  const pct = Number(i.budget_eur) ? d.monthCost / Number(i.budget_eur) * 100 : 0;
  fill(body, h('div.nb-chatgrid',
    h('section.nb-card.nb-chat', list,
      d.ai ? h('div.nb-comp.sticky', q, h('div.nb-row-sb', chips(CHIPS.map(c => [c, c]), null, send), btn('Invia', () => send(), { primary: true, ico: 'message' })))
        : h('div.nb-focus.soft', ic('alert-triangle'), h('div.grow', 'L\'assistente si accende quando su Railway c\'è OPENAI_API_KEY.'))),
    h('div.nb-side',
      card('Sinergie trovate', null, synergies.length ? synergies.map(s => h('div.nb-line', av(s.name, 'b'), h('div.grow',
        h('div.nb-row', h('a.nb-t', { href: `#/crm/scheda/${s.subject_id}` }, s.name), s.roles?.filter(r => r !== 'lead').map(r => h('span.nb-tag', r))),
        h('div.nb-small.muted', s.synergies.filter(x => !/^già nel CRM/.test(x)).join(' · ') || s.synergies[0] || ''))))
        : h('div.nb-small.muted', 'Quando l\'assistente cita aziende già nel CRM, qui trovi chi le conosce e come.')),
      card('L\'assistente usa', null, h('div.nb-chips.static', ['BU e SOA', 'Commesse', 'CRM', 'Questa iniziativa', 'Ricerca in rete'].map(c => h('span.nb-chip', c))),
        h('div.nb-small.muted.nb-mt12', 'Ogni risposta cita le fonti: in blu quelle in rete, in viola quelle del CRM.')),
      card(null, null, h('div.nb-row-sb', h('h3.nb-h3', 'Costo questo mese'), h('b', eur2(d.monthCost))), burn(Math.max(pct, d.monthCost ? 1 : 0)), h('div.nb-small.muted.nb-mt8', 'conta nel budget dell\'iniziativa')))));
  const stored = sessionStorage.getItem(`nb-ask-${id}`);
  if (stored) sessionStorage.removeItem(`nb-ask-${id}`);
  const ask = crmData.ask || stored;
  if (ask && d.ai) { delete crmData.ask; send(ask); }
}

// ── clienti target ───────────────────────────────────────────────────────────────────────────
const prio = p => h('span.nb-who.nb-small', dot(p === 'alta' ? 'r' : p === 'media' ? 'y' : 'n'), p);
function statusPill(t, canEdit, onChange) {
  if (!canEdit) return h('span.nb-sel', { class: TS_CLASS[t.status] }, TS[t.status]);
  return h('label.nb-sel', { class: TS_CLASS[t.status] }, h('select', { 'aria-label': 'Stato', on: { change: e => onChange(e.target.value) } }, TARGET_STATUS.map(([k, l]) => h('option', { value: k, selected: k === t.status }, l))), ic('chevron-down', 12));
}
function targetPanel(i, t, done) {
  const name = input({ value: t?.name || '' });
  const segment = input({ value: t?.segment || '', placeholder: 'Distributore, Industria, Comune…' });
  const why = textarea(t?.why, { rows: 3 });
  const pr = select([['alta', 'alta'], ['media', 'media'], ['bassa', 'bassa']], t?.priority || 'media');
  const status = select(TARGET_STATUS, t?.status || 'da_contattare');
  const note = textarea(t?.note, { rows: 2 });
  const syn = t?.synergies?.length ? h('div.nb-prop.violet', h('div.nb-lbl', 'Sinergie dal CRM'), t.synergies.map(x => h('div.nb-icn', ic(synIcon(x), 14), x))) : null;
  const m = dlg(modal({
    drawer: true,
    title: h('div', h('h2', t ? t.name : 'Aggiungi cliente target'), h('div.nb-small.muted', t ? (t.subject_id ? 'cliente target collegato al CRM' : 'cliente target non ancora nel CRM') : 'se è già nel CRM la collego da sola')),
    body: h('div.nb-form', t?.subject_id ? h('div.nb-prop', pathsBox(t.relation?.paths || [], { entity: t.name })) : null, syn, t ? null : field('Azienda o ente', name), h('div.nb-two', field('Segmento', segment), field('Priorità', pr)), field('Stato', status), field('Perché', why), field('Nota', note)),
    left: t ? [btn('Togli dai clienti target', async () => { if (!await confirmDialog(`Togliere «${t.name}» dai clienti target?`, { ok: 'Togli', danger: true })) return; await del(`/api/crm/business/targets/${t.id}`); m.close(); done(); }, { ghost: true, danger: true })] : [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [t?.subject_id ? btn('Apri nel CRM', () => { m.close(); location.hash = `#/crm/scheda/${t.subject_id}`; }) : null,
      btn('Salva', async () => {
        const b = { segment: segment.value, why: why.value, priority: pr.value, status: status.value, note: note.value };
        if (t) await patch(`/api/crm/business/targets/${t.id}`, b); else await post(`/api/crm/business/${i.id}/targets`, { ...b, name: name.value });
        m.close();
        done();
      }, { primary: true })].filter(Boolean),
  }), 'nb-panel');
}
async function targetsTab(ctx) {
  const { i, id, body, toolbar, refresh, ask } = ctx;
  const d = await get(`/api/crm/business/${id}/targets`);
  let view = 'elenco';
  let filter = '';
  const segs = {};
  for (const t of d.targets) segs[t.segment || 'Altro'] = (segs[t.segment || 'Altro'] || 0) + 1;
  const content = h('div');
  const setStatus = async (t, s) => { await patch(`/api/crm/business/targets/${t.id}`, { status: s }); refresh(); };
  const leadBtn = t => btn('Crea il lead', async () => { const out = await post(`/api/crm/business/targets/${t.id}/lead`, {}); toast(out.existed ? 'Collegata all\'azienda già nel CRM' : 'Lead creato nel CRM'); refresh(); }, { small: true });
  const bestPath = t => t.relation?.paths?.[0];
  const synLines = t => {
    const p0 = bestPath(t);
    const rest = t.synergies.filter(x => !/^nessun contatto|l'ha incontrata|email collegate/.test(x)).slice(0, p0 ? 1 : 2);
    if (!t.subject_id) return h('span.nb-small.muted', 'nessuna: non è nel CRM');
    return [h('div.nb-row', warmPill(t.relation?.level, { cooling: t.relation?.cooling }) || h('span.nb-small.muted', 'nessun rapporto')),
      p0 ? h('div.nb-icn', ic('users', 14), `${p0.us?.name || '—'} → ${p0.contact}${p0.why ? ` · ${p0.why}` : ''}`) : null,
      rest.map(x => h('div.nb-icn', ic(synIcon(x), 14), x))];
  };
  const draw = () => {
    const rows = d.targets.filter(t => !filter || (t.segment || 'Altro') === filter);
    if (!rows.length) return content.replaceChildren(h('section.nb-card', empty('Nessun cliente target. Chiedili all\'assistente nella chat o aggiungili a mano.', 'target', i.canEdit ? btn('Aggiungi cliente', () => targetPanel(i, null, refresh), { small: true }) : null)));
    if (view === 'elenco') {
      content.replaceChildren(h('section.nb-card.nb-tablecard', h('div.nb-scroll', h('table.nb-tbl', h('thead', h('tr', ['Azienda', 'Perché', 'Priorità', 'Stato', 'Chi conosciamo', ''].map(x => h('th', x)))),
        h('tbody', rows.map(t => h('tr', { class: t.status === 'scartato' ? 'off' : '', on: { click: e => { if (!e.target.closest('button,select,a,label') && i.canEdit) targetPanel(i, t, refresh); } } },
          h('td', h('div.nb-t', t.name), t.segment ? h('div.nb-small.muted', t.segment) : null),
          h('td.nb-small', t.why || '—'),
          h('td', prio(t.priority)),
          h('td', statusPill(t, i.canEdit, s => setStatus(t, s))),
          h('td', synLines(t)),
          h('td.nb-right', t.subject_id ? h('a.nb-via', { href: `#/crm/scheda/${t.subject_id}` }, ic('link', 14), 'scheda CRM') : i.canEdit ? leadBtn(t) : null))))))));
    } else {
      content.replaceChildren(h('div.nb-kb', TARGET_STATUS.filter(([k]) => k !== 'scartato').map(([k, l]) => {
        const col = rows.filter(t => t.status === k);
        return h('div.nb-kcol', h('h4', l, h('span', String(col.length))), col.map(t => h('button.nb-tc', { type: 'button', on: { click: () => i.canEdit && targetPanel(i, t, refresh) } },
          h('div.nb-t', t.name), t.segment ? h('div.nb-small.muted', t.segment) : null,
          h('div.nb-row-sb', prio(t.priority), t.subject_id ? warmPill(t.relation?.level, { cooling: t.relation?.cooling }) : null))));
      })));
    }
  };
  const segBar = h('div');
  const chipBar = h('div');
  const redraw = () => {
    segBar.replaceChildren(seg([['elenco', 'Elenco'], ['stato', 'Per stato']], view, x => { view = x; redraw(); }));
    chipBar.replaceChildren(chips([['', `Tutti ${d.targets.length}`], ...Object.entries(segs).map(([s, n]) => [s, `${s} ${n}`])], filter, x => { filter = x; redraw(); }));
    draw();
  };
  redraw();
  if (i.canEdit) toolbar.append(btn('Trova altri clienti', () => ask('Trova altri clienti possibili per questa iniziativa, diversi da quelli già nella lista.'), { ico: 'lightbulb' }), btn('Aggiungi cliente', () => targetPanel(i, null, refresh), { primary: true, ico: 'plus' }));
  const f = i.funnel;
  fill(body, h('div.nb-tb', h('div.nb-row.wrap', segBar, chipBar), h('span.nb-small.muted', `${f.contattati} contattati · ${f.incontrati} incontri · ${f.qualificati} qualificati · ${f.opportunita} opportunità`)),
    content,
    h('div.nb-note', ic('bell', 15), h('span', 'Quando un cliente target diventa lead del CRM ha come owner il responsabile dell\'iniziativa: email, incontri e note su di lui contano nell\'analisi.')));
}

// ── cosa ci manca ─────────────────────────────────────────────────────────────────────────────
function gapPanel(i, g, done) {
  const title = input({ value: g?.title || '' });
  const kind = select([['', '—'], ...GAP_KINDS.map(k => [k, k])], g?.kind || '');
  const status = select(Object.entries(GAP_STATUS), g?.status || 'manca');
  let howKind = g?.how_kind || '';
  const howChips = h('div');
  const drawHow = () => howChips.replaceChildren(chips(HOW_KINDS, howKind, k => { howKind = howKind === k ? '' : k; drawHow(); }));
  drawHow();
  const how = textarea(g?.how, { rows: 3 });
  const cost = input({ value: g?.cost_eur ? String(Number(g.cost_eur)) : '', inputmode: 'decimal' });
  const timing = input({ value: g?.timing || '', placeholder: '3 mesi' });
  const who = input({ value: g?.who || '', placeholder: 'Persona o ufficio' });
  const mkTask = h('input', { type: 'checkbox' });
  const m = dlg(modal({
    drawer: true,
    title: h('div', h('h2', g ? g.title : 'Aggiungi requisito'), h('div.nb-small.muted', 'cosa ci manca')),
    body: h('div.nb-form', g ? null : field('Requisito', title), h('div.nb-two', field('Tipo', kind), field('Stato', status)),
      h('div.nb-fl', h('span.nb-lbl', 'Come colmarlo'), howChips), field('Dettagli', how),
      h('div.nb-three', field('Costo', cost), field('Tempi', timing), field('Chi', who)),
      h('label.nb-prop.nb-checkrow', mkTask, h('div.grow.nb-small', 'Crea anche il passo collegato nel piano'))),
    left: g ? [btn('Togli', async () => { await del(`/api/crm/business/gaps/${g.id}`); m.close(); done(); }, { ghost: true, danger: true })] : [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva', async () => {
      const b = { kind: kind.value, status: status.value, how_kind: howKind, how: how.value, cost_eur: cost.value, timing: timing.value, who: who.value };
      const saved = g ? await patch(`/api/crm/business/gaps/${g.id}`, b) : await post(`/api/crm/business/${i.id}/gaps`, { ...b, title: title.value });
      if (mkTask.checked) await post(`/api/crm/business/${i.id}/tasks`, { title: `${HOW[howKind] ? `${HOW[howKind]}: ` : ''}${saved.title}`, gap_id: saved.id });
      m.close();
      done();
    }, { primary: true })],
  }), 'nb-panel');
}
async function gapsTab(ctx) {
  const { i, id, body, toolbar, refresh, ask } = ctx;
  const { gaps } = await get(`/api/crm/business/${id}/gaps`);
  const by = s => gaps.filter(g => g.status === s);
  const ok = by('ce').length, doing = by('in_corso').length, missing = by('manca').length, tot = gaps.length || 1;
  const cost = gaps.filter(g => g.status !== 'ce').reduce((s, g) => s + Number(g.cost_eur || 0), 0);
  if (i.canEdit) toolbar.append(btn('Rifai l\'analisi', () => ask('Rifai l\'analisi di cosa ci manca per entrare in questo business: requisiti, qualifiche, persone, mezzi, referenze, certificazioni, con come colmarli, costi e tempi.'), { ico: 'lightbulb' }),
    btn('Aggiungi requisito', () => gapPanel(i, null, refresh), { primary: true, ico: 'plus' }));
  let openCe = false;
  const row = g => h('button.nb-gc', { type: 'button', on: { click: () => i.canEdit && gapPanel(i, g, refresh) } },
    h('div', h('div.nb-t', g.title), g.kind ? h('div.nb-small.muted', g.kind) : null),
    h('div.nb-small', g.how_kind ? h('span.nb-pill.sol', HOW[g.how_kind]) : null, g.how || (g.how_kind ? '' : '—')),
    h('div.nb-small.nb-right', g.cost_eur ? eur(g.cost_eur) : ''), h('div.nb-small', g.timing || ''),
    h('div.nb-small.nb-who', g.who ? [av(g.who, 'b'), g.who] : null), h('span.muted', ic('more')));
  const sec = (title, cls, list, collapsible = false) => (list.length ? h('div.nb-gsec', h('div.nb-row', h('span.nb-sel', { class: cls }, title), h('span.nb-small.muted', String(list.length)),
    collapsible ? h('button.nb-link', { type: 'button', on: { click: () => { openCe = !openCe; draw(); } } }, openCe ? 'Chiudi' : 'Mostra') : null),
  collapsible && !openCe ? h('div.nb-small.muted.nb-pl16', list.map(g => g.title).join(' · ')) : list.map(row)) : null);
  const box = h('div.nb-gaps');
  const draw = () => box.replaceChildren(...(gaps.length ? [h('div.nb-gc.h', ['Requisito', 'Come colmarlo', 'Costo', 'Tempi', 'Chi', ''].map((x, k) => h('span', { class: k === 2 ? 'nb-right' : '' }, x))),
    sec('Mancano', 'red', by('manca')), sec('In corso', 's2', by('in_corso')), sec('C\'è già', 's3', by('ce'), true)].filter(Boolean)
    : [h('section.nb-card', empty('Nessun requisito. Chiedi all\'assistente «Cosa ci manca per qualificarci?» o aggiungili a mano.', 'square-check'))]));
  draw();
  fill(body,
    h('section.nb-card.nb-gapsum',
      h('div.nb-gapbar', h('div.nb-row-sb', h('span.nb-small.strong', 'Requisiti a posto'), h('b', `${ok} di ${gaps.length}`)),
        h('div.nb-tri', h('i.g', { style: { width: `${ok / tot * 100}%` } }), h('i.y', { style: { width: `${doing / tot * 100}%` } }), h('i.r', { style: { width: `${missing / tot * 100}%` } })),
        h('div.nb-row.nb-small.muted', h('span', `${ok} c'è`), h('span', `${doing} in corso`), h('span', `${missing} mancano`))),
      h('div', h('div.nb-lbl', 'Costo per colmarli'), h('div.nb-n20', eur(cost))),
      h('div', h('div.nb-lbl', 'Più lunghi'), h('div.nb-small.strong', by('manca').map(g => g.timing).filter(t => t && t !== '—').slice(0, 2).join(' · ') || '—'))),
    box,
    h('p.nb-small.muted', `Come colmarlo si sceglie tra: ${HOW_KINDS.map(([, l]) => l).join(' · ')}.`));
}

// ── piano d'ingresso ──────────────────────────────────────────────────────────────────────────
function taskPanel(i, t, done, { phase, targets = [], gaps = [] } = {}) {
  const title = input({ value: t?.title || '' });
  const ph = select(PHASES, t?.phase || phase || (PHASE_KEYS.includes(i.phase) ? i.phase : 'esplorazione'));
  const owner = select(userOptions(), t ? t.owner_id || '' : i.owner_id || '');
  const due = input({ type: 'date', value: t?.due_date || '' });
  const link = select([['', '—'], ...targets.map(x => [`t${x.id}`, `Cliente · ${x.name}`]), ...gaps.map(x => [`g${x.id}`, `Requisito · ${x.title}`])], t?.target_id ? `t${t.target_id}` : t?.gap_id ? `g${t.gap_id}` : '');
  const m = dlg(modal({
    title: t ? 'Passo' : 'Nuovo passo',
    body: h('div.nb-form', field('Cosa fare', title), h('div.nb-two', field('Fase', ph), field('Entro quando', due)),
      h('div.nb-two', field('Chi lo fa', owner), field('Collegato a', link, 'cliente target o requisito')),
      h('div.nb-small.muted', 'Compare in «La mia settimana» di chi lo fa; se scade, il «!» rosso.')),
    left: t ? [btn('Togli', async () => { await del(`/api/crm/business/tasks/${t.id}`); m.close(); done(); }, { ghost: true, danger: true })] : [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn(t ? 'Salva' : 'Crea il passo', async () => {
      const b = { title: title.value, phase: ph.value, owner_id: Number(owner.value) || null, due_date: due.value || null,
        target_id: link.value.startsWith('t') ? Number(link.value.slice(1)) : null, gap_id: link.value.startsWith('g') ? Number(link.value.slice(1)) : null };
      if (t) await patch(`/api/crm/business/tasks/${t.id}`, b); else await post(`/api/crm/business/${i.id}/tasks`, b);
      m.close();
      done();
    }, { primary: true })],
  }));
}
function taskRow(i, t, refresh, opts = {}) {
  return h('div.nb-step', { class: [t.late && 'late', t.done_at && 'done'].filter(Boolean).join(' ') },
    h('button.nb-check', { type: 'button', class: t.done_at ? 'on' : '', 'aria-label': t.done_at ? 'Riapri' : 'Fatto', disabled: !i.canEdit, on: { click: async () => { await patch(`/api/crm/business/tasks/${t.id}`, { done: !t.done_at }); refresh(); } } }, t.done_at ? ic('check', 13) : null),
    h('button.nb-step-t', { type: 'button', disabled: !i.canEdit, on: { click: () => opts.onEdit?.(t) } }, h('span.nb-t', t.title),
      (t.target_name || t.gap_title || opts.showPhase) ? h('span.nb-small.muted', [opts.showPhase ? PHASES.find(p => p[0] === t.phase)?.[1] : null, t.target_name, t.gap_title].filter(Boolean).join(' · ')) : null),
    t.owner_name ? av(t.owner_name, t.owner_id === i.owner_id ? '' : 'g') : null,
    h('span.nb-step-d', { class: t.late ? 'late' : '' }, t.done_at ? `fatto ${dm(t.done_at)}` : t.due_date ? (t.late ? `scaduto ${dm(t.due_date)}` : dm(t.due_date)) : 'senza data'));
}
function gateDialog(i, g, choice, tasks, done) {
  const today = todayIso();
  const lateT = tasks.filter(t => t.late);
  const note = textarea('', { rows: 2 });
  const due = input({ type: 'date' });
  let pick = choice;
  const okBtn = btn('', () => {}, { primary: true });
  const cards = h('div.nb-rcs');
  const label = () => okBtn.replaceChildren(pick === 'prosegui' ? `Conferma: prosegui${PHASES[g.n + 1] ? ` verso ${PHASES[g.n + 1][1]}` : ''}` : pick === 'rimanda' ? `Conferma: rimanda${due.value ? ` al ${dm(due.value)}` : ''}` : 'Conferma: abbandona');
  due.addEventListener('input', label);
  const drawCards = () => {
    cards.replaceChildren(...[['prosegui', 'Prosegui', PHASES[g.n + 1] ? `L'iniziativa passa alla fase ${PHASES[g.n + 1][1]}.` : 'L\'iniziativa diventa una BU.'],
      ['rimanda', 'Rimanda', 'Il gate prende una nuova data.'], ['abbandona', 'Abbandona', 'Resta nell\'elenco «Abbandonate» con il motivo.']].map(([k, l, d]) =>
      h('div.nb-rc', { class: k === pick ? 'on' : '', on: { click: e => { if (e.target.closest('input,textarea')) return; pick = k; drawCards(); label(); } } },
        h('div.nb-rc-t', h('span.nb-radio'), l),
        k === pick && k !== 'prosegui' ? h('div.nb-rc-b', k === 'rimanda' ? h('div.nb-two', field('Nuova data', due), field('Perché', note)) : field('Perché', note)) : h('div.nb-small.muted.nb-rc-b', d))));
  };
  drawCards();
  label();
  const m = dlg(modal({
    title: h('div', h('h2', `Decidi il gate G${g.n}`), h('div.nb-small.muted', 'decide lo sponsor o la direzione')),
    body: h('div.nb-form', h('div.nb-q', `«${g.question}»`),
      h('div.nb-prop', h('div.nb-lbl', 'Prima di decidere'),
        lateT.length ? lateT.map(t => h('div.nb-prop-r.nb-small', dot('r'), h('span.grow', `${t.title} · passo scaduto il ${dm(t.due_date)}`))) : h('div.nb-prop-r.nb-small', dot('g'), h('span.grow', 'Nessun passo scaduto')),
        i.openHypotheses ? h('div.nb-prop-r.nb-small', dot('y'), h('span.grow', `${i.openHypotheses} ${i.openHypotheses === 1 ? 'ipotesi' : 'ipotesi'} da verificare`)) : null,
        h('div.nb-prop-r.nb-small', dot('g'), h('span.grow', `${i.gaps.ok} requisiti su ${i.gaps.total} a posto · ${i.funnel.contattati} clienti contattati · spesa ${Number(i.budget_eur) ? Math.round(i.spent / Number(i.budget_eur) * 100) : 0}% del budget`))),
      cards,
      h('div.nb-small.muted', `La decisione va nelle riflessioni${i.owner_name ? ` e arriva a ${i.owner_name}` : ''}.`)),
    left: [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [okBtn],
  }));
  okBtn.onclick = async () => {
    if (pick === 'rimanda' && (!due.value || due.value <= today)) return toast('Scegli una nuova data futura', 'err');
    await post(`/api/crm/business/${i.id}/gates/${g.n}/decide`, { decision: pick, note: note.value, due_date: due.value || undefined });
    m.close();
    toast('Decisione salvata');
    done();
  };
}
function gateEdit(i, g, done) {
  const q = input({ value: g.question || '' });
  const due = input({ type: 'date', value: g.due_date || '' });
  const m = dlg(modal({ title: `Gate G${g.n}`, body: h('div.nb-form', field('Domanda per la direzione', q), field('Data', due)),
    left: [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva', async () => { await patch(`/api/crm/business/${i.id}/gates/${g.n}`, { question: q.value, due_date: due.value || null }); m.close(); done(); }, { primary: true })] }));
}
// fasi sui mesi: date scritte nella scheda, altrimenti dal gate precedente al gate della fase
function phaseSpans(i) {
  const when = g => (g?.decided_at ? String(g.decided_at).slice(0, 10) : g?.due_date || null);
  let prev = i.started_on;
  return PHASE_KEYS.map((k, n) => {
    const g = i.gates.find(x => x.n === n);
    const pd = i.phase_dates?.[k] || {};
    const from = pd.from || prev;
    const to = pd.to || when(g);
    if (to) prev = to;
    return { k, n, from, to: to && from && to < from ? from : to, gate: g };
  });
}
async function planTab(ctx) {
  const { i, id, body, toolbar, refresh, ask, tasks } = ctx;
  const [{ targets }, { gaps }] = await Promise.all([get(`/api/crm/business/${id}/targets`), get(`/api/crm/business/${id}/gaps`)]);
  const editTask = t => taskPanel(i, t, refresh, { targets, gaps });
  if (i.canEdit) toolbar.append(btn('Rigenera il piano', () => ask('Prepara il piano d\'ingresso per fasi (esplorazione, analisi, piano, ingresso, consolidamento) con periodi, passi e la domanda del gate alla fine di ogni fase.'), { ico: 'lightbulb' }),
    btn('Aggiungi passo', () => taskPanel(i, null, refresh, { targets, gaps }), { primary: true, ico: 'plus' }));
  const cur = PHASE_KEYS.indexOf(i.phase);
  const today = todayIso();
  const spans = phaseSpans(i);
  const dated = spans.flatMap(s => [s.from, s.to]).filter(Boolean).concat(today);
  const ym = d => { const [y, mo] = d.split('-').map(Number); return y * 12 + mo - 1; };
  const m0 = Math.min(...dated.map(ym));
  const m1 = Math.max(Math.max(...dated.map(ym)), m0 + 5);
  const nM = Math.min(24, m1 - m0 + 1);
  const col = d => Math.min(nM - 1, Math.max(0, ym(d) - m0));
  const gantt = h('div.nb-gantt', { style: { gridTemplateColumns: `170px repeat(${nM}, minmax(0, 1fr))` } },
    h('span'), Array.from({ length: nM }, (_, k) => h('span.nb-gm', MONTHS[(m0 + k) % 12] + ((m0 + k) % 12 === 0 ? ` ${String(Math.floor((m0 + k) / 12)).slice(2)}` : ''))),
    spans.map((s, r) => {
      const state = i.phase === 'abbandonata' ? 'next' : s.n < cur ? 'done' : s.n === cur ? 'on' : 'next';
      const open = tasks.filter(t => t.phase === s.k && !t.done_at);
      const lateN = open.filter(t => t.late).length;
      const lateGate = s.gate && !s.gate.decision && s.gate.due_date && s.gate.due_date < today && s.n === cur;
      const lane = h('span.nb-lane', { style: { gridRow: String(r + 2) } }, h('span.nb-ph', { class: state === 'done' ? 'done' : state === 'on' ? 'on' : '' }, h('span.nb-ph-c', state === 'done' ? ic('check', 12) : String(s.n + 1))), PHASES[s.n][1]);
      if (!s.from || !s.to) return [lane, h('span.nb-small.muted.nb-gnone', { style: { gridRow: String(r + 2), gridColumn: `2 / span ${nM}` } }, i.periods?.[s.k] ? `${i.periods[s.k]} · date da fissare (Modifica)` : 'date da fissare (Modifica o data del gate)')];
      const c0 = col(s.from), c1 = col(s.to);
      return [lane,
        h('div.nb-gbar', { class: state, style: { gridRow: String(r + 2), gridColumn: `${c0 + 2} / ${c1 + 3}` } }, state === 'done' ? 'fatta' : state === 'on' ? `${open.length} passi aperti${lateN ? ` · ${lateN} scaduto` : ''}` : i.periods?.[s.k] || ''),
        s.gate ? h('button.nb-gd', { type: 'button', class: s.gate.decision === 'prosegui' ? 'done' : lateGate ? 'late' : '', title: `G${s.n} · ${s.gate.question}`, disabled: !i.canEdit, style: { gridRow: String(r + 2), gridColumn: String(c1 + 2) }, on: { click: () => gateEdit(i, s.gate, refresh) } }) : null];
    }),
    ym(today) >= m0 && ym(today) - m0 < nM ? h('span.nb-today', { style: { left: `calc(170px + (100% - 170px) * ${((ym(today) - m0) + (Number(today.slice(8)) - 1) / 30) / nM})` } }) : null);
  let scope = 'fase';
  const listBox = h('div');
  const drawList = () => {
    const rows = scope === 'fase' ? tasks.filter(t => t.phase === i.phase) : tasks;
    listBox.replaceChildren(...(rows.length ? rows.map(t => taskRow(i, t, refresh, { onEdit: editTask, showPhase: scope !== 'fase' }))
      : [empty('Nessun passo. Aggiungili a mano o dalla chat («Crea il passo»).', 'clock')]),
    i.canEdit ? h('button.nb-addrow', { type: 'button', on: { click: () => taskPanel(i, null, refresh, { phase: PHASE_KEYS.includes(i.phase) ? i.phase : undefined, targets, gaps }) } }, ic('plus', 14), `Aggiungi un passo${scope === 'fase' && PHASES[cur] ? ` alla fase ${PHASES[cur][1]}` : ''}`) : null);
  };
  const segBox = h('div');
  const drawSeg = () => segBox.replaceChildren(seg([['fase', 'Questa fase'], ['tutte', 'Tutte']], scope, x => { scope = x; drawSeg(); drawList(); }));
  drawSeg();
  drawList();
  const g = i.gate;
  const lateT = tasks.filter(t => t.late);
  const pct = Number(i.budget_eur) ? Math.round(i.spent / Number(i.budget_eur) * 100) : 0;
  fill(body,
    h('div.nb-row.nb-lbl', `Piano d'ingresso${spans[0].from ? ` · ${MONTHS[m0 % 12]} ${Math.floor(m0 / 12)} – ${MONTHS[(m0 + nM - 1) % 12]} ${Math.floor((m0 + nM - 1) / 12)}` : ''}`),
    h('section.nb-card', gantt, h('div.nb-legend', h('span', h('span.nb-gd.done.static'), 'gate deciso'), h('span', h('span.nb-gd.late.static'), 'gate scaduto'), h('span', h('span.nb-gd.static'), 'gate da decidere'))),
    h('div.nb-g2',
      card(i.phase === 'abbandonata' ? 'I passi' : `Fase ${cur + 1} · ${PHASES[cur][1]} · i passi`, segBox, listBox),
      g && i.phase !== 'abbandonata' ? h('section.nb-card.nb-gatecard', { class: g.late ? 'late' : '' },
        h('div.nb-row', h('span.nb-gd.static', { class: g.late ? 'late' : '' }), h('span.nb-t', `Gate G${g.n} · ${g.late ? `scaduto il ${dm(g.due_date)}` : g.due_date ? `entro il ${dm(g.due_date)}` : 'data da fissare'}`)),
        h('div.nb-q', `«${g.question}»`),
        h('div', h('div.nb-lbl.nb-mb8', 'Per decidere'),
          lateT.length ? lateT.map(t => h('div.nb-line.tight', dot('r'), h('span.grow.nb-small', `${t.title}: `, h('b', 'passo scaduto')))) : h('div.nb-line.tight', dot('g'), h('span.grow.nb-small', 'Nessun passo scaduto')),
          i.openHypotheses ? h('div.nb-line.tight', dot('y'), h('span.grow.nb-small', `${i.openHypotheses} ipotesi da verificare`)) : null,
          h('div.nb-line.tight', dot(pct > 100 ? 'r' : pct >= 90 ? 'y' : 'g'), h('span.grow.nb-small', `Spesa al ${pct}% del budget`))),
        i.canDecide ? h('div.nb-actions', ['prosegui', 'rimanda', 'abbandona'].map(k => btn(k[0].toUpperCase() + k.slice(1), () => gateDialog(i, g, k, tasks, refresh))))
          : h('div.nb-small.muted', 'Lo decide lo sponsor o la direzione.'),
        h('div.nb-small.muted', 'La decisione resta nelle riflessioni.'))
        : i.phase === 'abbandonata' ? card('Iniziativa abbandonata', null, h('div.nb-small', i.abandoned_reason || '—')) : null));
}

// ── radar ─────────────────────────────────────────────────────────────────────────────────────
function profileDialog(i, p, done) {
  const desc = textarea(p.description || i.description, { rows: 2 });
  const listInput = (arr, ph) => input({ value: (arr || []).join(', '), placeholder: ph });
  const works = listInput(p.works, 'cabine MT, posa cavi, manutenzione reti');
  const kw = listInput(p.keywords, 'distributore, rete elettrica, cabina');
  const regions = listInput(p.regions, 'Abruzzo, Marche, Molise');
  const soa = listInput(p.soa, 'OG10, OS30');
  const split = el => el.value.split(',').map(x => x.trim()).filter(Boolean);
  const m = dlg(modal({
    title: 'Cosa cerca il radar',
    body: h('div.nb-form', field('Cosa cerchiamo', desc), field('Lavori tipici', works, 'separati da virgola'), field('Parole utili', kw), h('div.nb-two', field('Zone', regions), field('Categorie SOA', soa))),
    left: [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva', async () => { await put(`/api/crm/business/${i.id}/profile`, { description: desc.value, works: split(works), keywords: split(kw), regions: split(regions), soa: split(soa) }); m.close(); toast('Profilo salvato'); done(); }, { primary: true })],
  }));
}
async function radarTab(ctx, status = 'nuovo') {
  const { i, id, body, toolbar, refresh } = ctx;
  const d = await get(`/api/crm/business/${id}/radar?status=${status}`);
  const p = d.profile || {};
  const c = d.counts || {};
  toolbar.replaceChildren();
  if (i.canEdit) toolbar.append(btn('Cerca adesso', async () => {
    if (!(p.description || i.description)) return toast('Scrivi prima cosa cerca il radar', 'err');
    const r = await post(`/api/crm/business/${id}/radar/run`, {});
    toast(`${r.added} segnali nuovi (costo ${eur2(r.cost)})`);
    refresh();
  }, { primary: true, ico: 'crosshair', disabled: !d.ai }));
  const ring = s => h('span.nb-ring', { class: s >= 70 ? '' : s >= 50 ? 'mid' : 'low', style: { '--p': `${s}%` } }, h('span', String(s)));
  fill(body,
    h('div.nb-tb', h('div.nb-row.wrap', chips([['nuovo', `Da guardare ${c.nuovo || 0}`], ['target', `Diventati clienti target ${c.target || 0}`], ['scartato', `Scartati ${c.scartato || 0}`]], status, s => radarTab(ctx, s)),
      h('span.nb-small.muted', d.last?.at ? `Ultima ricerca ${day(d.last.at)} · ${eur2(d.last.cost)}` : 'Nessuna ricerca ancora'))),
    h('div.nb-g2r',
      h('div.nb-col24', d.signals.length ? d.signals.map(s => h('section.nb-card.nb-sig', ring(s.score),
        h('div.nb-min0', h('div.nb-t15', s.title), h('div.nb-small.muted.nb-mt4', [s.entity, s.region, s.amount ? eur(s.amount) : null, s.published_on ? day(s.published_on) : null].filter(Boolean).join(' · ')),
          s.why ? h('div.nb-small.nb-mt8', h('b', 'Perché: '), s.why) : null, s.url ? h('div.nb-mt8', h('a.nb-src', { href: s.url, target: '_blank', rel: 'noopener' }, ic('link', 12), 'fonte')) : null),
        i.canEdit && status === 'nuovo' ? h('div.nb-sig-a', btn('Cliente target', async () => { await post(`/api/crm/business/signals/${s.id}/target`, {}); toast('Aggiunto ai clienti target'); radarTab(ctx, status); }, { small: true, ico: 'plus' }),
          btn('Scarta', async () => { await post(`/api/crm/business/signals/${s.id}/scarta`, {}); radarTab(ctx, status); }, { small: true, ghost: true })) : null))
        : h('section.nb-card', empty(d.ai ? 'Nessun segnale qui. «Cerca adesso» legge le notizie degli ultimi giorni con il profilo a destra.' : 'Il radar si accende quando su Railway c\'è OPENAI_API_KEY.', 'crosshair'))),
      card('Cosa cerca il radar', i.canEdit ? h('span.nb-row', h('button.nb-link', { type: 'button', on: { click: () => soaDialog(i, ctx.crmData.meta || {}, () => radarTab(ctx, status)) } }, ic('plus', 14), 'Categorie SOA'), h('button.nb-link', { type: 'button', on: { click: () => profileDialog(i, p, () => radarTab(ctx, status)) } }, ic('pencil', 14), 'Modifica')) : null,
        h('div.nb-small.strong', p.description || i.description || 'Profilo da scrivere.'),
        [['Lavori tipici', p.works], ['Parole utili', p.keywords], ['Zone', p.regions], ['SOA', p.soa]].filter(([, xs]) => xs?.length).map(([l, xs]) => h('div.nb-mt12', h('div.nb-lbl.nb-mb8', l), h('div.nb-chips.static', xs.map(x => h('span.nb-chip.sm', x))))),
        h('div.nb-small.muted.nb-sepline', 'Stesso motore e stesso punteggio del radar delle BU; la spesa conta nel budget dell\'iniziativa.'))));
}

// ── riflessioni ───────────────────────────────────────────────────────────────────────────────
function noteDialog(i, n, done, presetKind = 'ipotesi') {
  let kind = n?.kind || presetKind;
  const kindBox = h('div');
  const title = input({ value: n?.title || '' });
  const text = textarea(n?.body, { rows: 4 });
  const level = select([['', '—'], ...LEVELS.map(l => [l, l])], n?.level || '');
  const prob = select([['', '—'], ...PROB], n?.probability || '');
  const mit = input({ value: n?.mitigation || '' });
  const gate = select([['', '—'], ...[0, 1, 2, 3, 4].map(g => [g, `gate G${g}`])], n?.before_gate ?? '');
  const extra = h('div');
  const drawKind = () => {
    kindBox.replaceChildren(n ? h('span.nb-pill', NOTE_KINDS[kind]) : chips([['ipotesi', 'Ipotesi'], ['rischio', 'Rischio'], ['nota', 'Nota']], kind, k => { kind = k; drawKind(); }));
    extra.replaceChildren(kind === 'rischio' ? h('div.nb-form', h('div.nb-two', field('Impatto', level), field('Probabilità', prob)), field('Mitigazione', mit))
      : kind === 'ipotesi' ? field('Da verificare prima del', gate) : '');
  };
  drawKind();
  const m = dlg(modal({
    title: n ? 'Riflessione' : 'Nuova riflessione',
    body: h('div.nb-form', h('div.nb-fl', h('span.nb-lbl', 'Tipo'), kindBox, h('small', 'Le ipotesi restano «da verificare» finché qualcuno non le conferma o le smentisce.')), field('Titolo', title), field('Testo', text), extra),
    left: n && n.kind !== 'decisione' ? [btn('Togli', async () => { await del(`/api/crm/business/riflessioni/${n.id}`); m.close(); done(); }, { ghost: true, danger: true })] : [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva', async () => {
      const b = { title: title.value, body: text.value, level: level.value, probability: prob.value, mitigation: mit.value, before_gate: gate.value === '' ? null : Number(gate.value) };
      if (n) await patch(`/api/crm/business/riflessioni/${n.id}`, b); else await post(`/api/crm/business/${i.id}/riflessioni`, { ...b, kind });
      m.close();
      done();
    }, { primary: true })],
  }));
}
function swotDialog(i, swot, done, ask) {
  const box = (k, cls) => textarea(swot?.[k], { rows: 4, class: `nb-sw ${cls}` });
  const f = { forze: box('forze', 'g'), debolezze: box('debolezze', 'r'), opportunita: box('opportunita', 'b'), minacce: box('minacce', 'y') };
  const m = dlg(modal({ title: 'SWOT dell\'iniziativa', wide: true,
    body: h('div.nb-two', field('Forze', f.forze), field('Debolezze', f.debolezze), field('Opportunità', f.opportunita), field('Minacce', f.minacce)),
    left: [btn('Proponi con l\'assistente', () => { m.close(); ask('Proponi la SWOT di questa iniziativa: forze, debolezze, opportunità, minacce, in poche parole per voce.'); }, { ico: 'lightbulb' })],
    actions: [btn('Annulla', () => m.close(), { ghost: true }), btn('Salva', async () => { await put(`/api/crm/business/${i.id}/swot`, Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]))); m.close(); done(); }, { primary: true })] }), 'nb-dlg-wide');
}
async function notesTab(ctx) {
  const { i, id, body, toolbar, refresh, ask } = ctx;
  const { notes, swot } = await get(`/api/crm/business/${id}/riflessioni`);
  if (i.canEdit) toolbar.append(btn('Nuova riflessione', () => noteDialog(i, null, refresh), { primary: true, ico: 'plus' }));
  let filter = '';
  const count = k => (k ? notes.filter(n => n.kind === k).length : notes.length);
  const listBox = h('section.nb-card');
  const kindLabel = n => (n.kind === 'ipotesi' ? `Ipotesi · ${CHECK[n.check_status] || 'nota'}` : n.kind === 'rischio' ? `Rischio${n.level ? ` ${n.level}` : ''}${n.probability ? ` · ${PROB.find(p => p[0] === n.probability)[1]}` : ''}`
    : n.kind === 'decisione' ? 'Decisione' : NOTE_KINDS[n.kind]);
  const entry = n => h('div.nb-ent', h('span.nb-ki', { class: NOTE_ICON[n.kind][0] }, ic(NOTE_ICON[n.kind][1])),
    h('div.nb-col4', h('div.nb-row-sb.nb-small', h('span.nb-lbl', kindLabel(n)), h('span.muted', [n.author_name, day(n.created_at)].filter(Boolean).join(' · '))),
      n.title ? h('div.nb-t15', n.title) : null,
      n.kind === 'chat' ? h('div.nb-small.nb-clip3', n.body.replace(/\*\*/g, '').replace(/^\s*[-•]\s+/gm, '· ')) : h('div.nb-small.nb-pre', n.body),
      n.mitigation ? h('div.nb-small.muted', `Mitigazione: ${n.mitigation}`) : null,
      n.kind === 'chat' && n.message_id ? h('button.nb-link', { type: 'button', on: { click: () => ctx.go('chat') } }, 'apri nella chat') : null,
      i.canEdit ? h('div.nb-actions.sm', n.kind === 'ipotesi' && n.check_status === 'da_verificare'
        ? [btn('Confermata', async () => { await patch(`/api/crm/business/riflessioni/${n.id}`, { check_status: 'confermata' }); refresh(); }, { small: true }), btn('Smentita', async () => { await patch(`/api/crm/business/riflessioni/${n.id}`, { check_status: 'smentita' }); refresh(); }, { small: true })] : null,
      n.kind !== 'decisione' && n.author_id === store.me.id ? btn('Modifica', () => noteDialog(i, n, refresh), { small: true, ghost: true }) : null) : null));
  const chipBox = h('div');
  const draw = () => {
    chipBox.replaceChildren(chips([['', `Tutte ${count('')}`], ['ipotesi', `Ipotesi ${count('ipotesi')}`], ['decisione', `Decisioni ${count('decisione')}`], ['chat', `Dalla chat ${count('chat')}`], ['rischio', `Rischi ${count('rischio')}`], ['nota', `Note ${count('nota')}`]], filter, k => { filter = k; draw(); }));
    const rows = notes.filter(n => !filter || n.kind === filter);
    listBox.replaceChildren(...(rows.length ? rows.map(entry) : [empty('Il diario è vuoto: ipotesi, decisioni dei gate e risposte salvate dalla chat compaiono qui.', 'file-text')]));
  };
  draw();
  const open = notes.filter(n => n.kind === 'ipotesi' && n.check_status === 'da_verificare');
  const sw = swot || {};
  const nextGate = i.gate?.n;
  fill(body, h('div.nb-tb', chipBox),
    h('div.nb-g2', listBox,
      h('div.nb-side',
        card('SWOT', i.canEdit ? h('div.nb-row', h('button.nb-link', { type: 'button', on: { click: () => ask('Proponi la SWOT di questa iniziativa: forze, debolezze, opportunità, minacce, in poche parole per voce.') } }, ic('lightbulb', 14), 'Proponi'),
          h('button.nb-link', { type: 'button', on: { click: () => swotDialog(i, sw, refresh, ask) } }, ic('pencil', 14), 'Modifica')) : null,
        h('div.nb-swot', [['forze', 'Forze', 'g'], ['debolezze', 'Debolezze', 'r'], ['opportunita', 'Opportunità', 'b'], ['minacce', 'Minacce', 'y']].map(([k, l, c]) => h('div', { class: c }, h('b', l), h('div', sw[k] || '—')))),
        sw.by ? h('div.nb-small.muted.nb-mt8', `${sw.by} · ${day(sw.at)}`) : null),
        card(nextGate !== undefined && nextGate !== null ? `Da verificare prima del gate G${nextGate}` : 'Da verificare', null,
          open.length ? open.map(n => h('div.nb-line', h('span.nb-ki.hyp.sm', ic('search', 14)), h('div.grow.nb-small', n.title || n.body.slice(0, 120), n.before_gate !== null && n.before_gate !== undefined ? h('div.muted', `prima del gate G${n.before_gate}`) : null)))
            : h('div.nb-small.muted', 'Nessuna ipotesi aperta.')))));
}

// ── analisi per la direzione ──────────────────────────────────────────────────────────────────
async function analysisTab(ctx) {
  const { i, id, body, toolbar, crmData, refresh } = ctx;
  const a = await get(`/api/crm/business/${id}/analisi`);
  toolbar.append(btn('Esporta per la riunione', () => window.print(), { ico: 'file-text' }));
  const cur = PHASE_KEYS.indexOf(i.phase);
  const f = a.funnel;
  const pct = a.budget ? Math.round(a.spent / a.budget * 100) : 0;
  const summaryBox = h('div.nb-min0');
  const drawSummary = (text, at) => summaryBox.replaceChildren(
    text ? h('div.nb-sum', richText(text)) : h('div.nb-sum.muted', i.ai ? 'Nessuna sintesi ancora: l\'assistente la scrive leggendo attività, gate, spesa e sinergie.' : 'La sintesi dell\'assistente si accende quando su Railway c\'è OPENAI_API_KEY.'),
    h('div.nb-small.muted.nb-mt8', text ? `Sintesi dell'assistente · aggiornata ${day(at)} ` : '', i.ai ? h('button.nb-link', { type: 'button', on: { click: async e => {
      const b0 = e.currentTarget; b0.disabled = true;
      summaryBox.append(loading());
      try { const m = await post(`/api/crm/business/${id}/sintesi`, {}); drawSummary(m.body, new Date().toISOString()); } finally { b0.disabled = false; }
    } } }, text ? 'rigenera' : 'Prepara la sintesi') : null));
  drawSummary(a.summary, a.summary_at);
  const maxH = Math.max(1, ...a.weeks.flatMap(w => [w.meetings, w.emails, w.notes, w.tasks]));
  const heatC = n => (n === 0 ? 'h0' : n / maxH < 0.34 ? 'h1' : n / maxH < 0.67 ? 'h2' : 'h3');
  const total2 = a.weeks.slice(2).reduce((s, w) => s + w.meetings + w.emails + w.notes + w.tasks, 0);
  const levels = { alto: 0, medio: 1, basso: 2 };
  const probs = { poco: 0, possibile: 1, probabile: 2 };
  const cellBg = (r, c) => (2 - r + c >= 3 ? 'r' : 2 - r + c >= 2 ? 'y' : 'n');
  const unplaced = a.risks.filter(r => !r.level || !r.probability);
  const matrix = h('div.nb-matrix', [0, 1, 2].map(r => [h('span.nb-ax', LEVELS[r]), [0, 1, 2].map(c => h('div.nb-mc', { class: cellBg(r, c) },
    a.risks.filter(x => levels[x.level] === r && probs[x.probability] === c).map(x => h('span.nb-chipx', { title: x.mitigation ? `mitigazione: ${x.mitigation}` : '' }, x.title || x.body.slice(0, 40)))))]),
  h('span'), PROB.map(([, l]) => h('span.nb-ax.c', l)));
  const fun = [['individuati', f.individuati], ['contattati', f.contattati], ['incontrati', f.incontrati], ['qualificati', f.qualificati], ['opportunità', f.opportunita]];
  const gl = a.gate;
  fill(body,
    h('section.nb-card.nb-sumcard', i.phase === 'abbandonata' ? pill('Abbandonata', 'off') : lightPill(a.light.color, LIGHT[a.light.color]), summaryBox),
    h('div.nb-fcs',
      counter('grid', `${cur >= 0 ? cur + 1 : '—'}/5`, `fase ${cur >= 0 ? PHASES[cur][1] : 'chiusa'}`, 'or'), counter('square-check', `${a.gaps.ok}/${a.gaps.total}`, 'requisiti a posto'),
      counter('users', `${f.contattati}/${f.individuati}`, 'clienti contattati'), counter('calculator', eur(a.spent), `su ${eur(a.budget)}`),
      counter('alert-triangle', a.lateTasks, a.lateTasks === 1 ? 'passo scaduto' : 'passi scaduti', a.lateTasks ? 'hot' : 'zero'), counter('search', a.openHypotheses, 'ipotesi da verificare', a.openHypotheses ? '' : 'zero')),
    h('div.nb-g3.nb-stretch',
      card('Clienti target', null, fun.map(([l, n]) => h('div.nb-hbar', h('span.nb-small', l), h('div.nb-bar', h('i', { style: { width: `${f.individuati ? n / f.individuati * 100 : 0}%` } })), h('b', String(n)))),
        h('div.nb-mfoot', h('button.nb-link', { type: 'button', on: { click: () => ctx.go('clienti') } }, 'Apri i clienti target', ic('chevron-right', 13)))),
      marketCard(i, a.market, ctx.go, crmData.meta || {}, refresh),
      card('Budget', null, h('div.nb-row-sb', h('b', eur(a.spent)), h('span.nb-small.muted', eur(a.budget))), burn(pct), h('div.nb-small.muted.nb-mt8', a.ai_eur ? `di cui assistente AI ${eur2(a.ai_eur)}` : 'spese scritte a mano e assistente AI'),
        h('div.nb-mt12', a.light.reasons.map(r => h('div.nb-line.tight', dot(r.c), h('div.nb-small.grow', r.t)))),
        i.canEdit ? h('div.nb-mfoot', h('button.nb-link', { type: 'button', on: { click: () => editForm(i, crmData.asa || [], refresh, crmData.meta || {}) } }, 'Cambia budget e spese', ic('chevron-right', 13))) : null)),
    h('div.nb-g2.eq',
      card(`${a.owner_name || 'Il responsabile'} · ultime 4 settimane`, null,
        h('div.nb-heat', h('span'), a.weeks.map(w => h('span.nb-small.muted.c', dm(w.from))),
          [['meetings', 'Incontri'], ['emails', 'Email'], ['notes', 'Note e riflessioni'], ['tasks', 'Passi fatti']].map(([k, l]) => [h('span.nb-small', l), a.weeks.map(w => h('i', { class: heatC(w[k]) }, w[k] ? String(w[k]) : ''))])),
        h('div.nb-small.muted.nb-mt12', `${total2} cose nelle ultime 2 settimane · da Outlook, CRM e passi`)),
      card('Prossimi passi', null, a.next.length ? a.next.map(t => taskRow({ ...i, canEdit: false }, t, () => {}, { showPhase: true })) : empty('Nessun passo aperto.', 'clock'))),
    h('div.nb-g2.eq.nb-stretch',
      card('Rischi', i.canEdit ? h('button.nb-link', { type: 'button', on: { click: () => noteDialog(i, null, refresh, 'rischio') } }, ic('plus', 14), 'Rischio') : null,
        a.risks.length ? [matrix, unplaced.length ? h('div.nb-small.muted.nb-mt12', `Senza impatto o probabilità: ${unplaced.map(r => r.title).join(' · ')}`) : null]
          : empty('Nessun rischio scritto. Si aggiungono dalle Riflessioni (tipo «Rischio»).', 'alert-triangle')),
      outcomesCard(i, a.outcomes, refresh)),
    printSheet(i, a, gl));
  if (crmData.print) { delete crmData.print; setTimeout(() => window.print(), 300); }
}

// gare vinte e perse dell'iniziativa (crm_outcomes, «Vinte e perse» del CRM): collegate all'iniziativa o con
// committente tra i clienti target dalla data di avvio
function outcomesCard(i, o, refresh) {
  const RES = { vinta: ['Vinta', 'ok'], persa: ['Persa', 'red'], non_partecipato: ['Non partecipato', 'off'] };
  const reg = i.canEdit ? h('button.nb-link', { type: 'button', on: { click: () => registraEsito({ initiative_id: i.id }, refresh) } }, ic('plus', 14), 'Registra un esito') : null;
  if (!o || !(o.won + o.lost + o.skipped)) {
    return card('Gare vinte e perse', reg, empty('Nessun esito ancora. Quando partecipiamo a una gara o a un\'offerta di questa iniziativa, registra se l\'abbiamo vinta o persa: serve a capire se l\'ingresso funziona.', 'trophy'));
  }
  return card('Gare vinte e perse', reg,
    h('div.nb-fcs',
      counter('trophy', o.ratio === null ? '—' : `${o.ratio}%`, 'win ratio', 'or'),
      counter('square-check', o.won, o.won === 1 ? 'vinta' : 'vinte', o.won ? '' : 'zero'),
      counter('x', o.lost, o.lost === 1 ? 'persa' : 'perse', o.lost ? '' : 'zero'),
      counter('calculator', eur(o.value_won), `vinti su ${eur(o.value_bid)}`)),
    o.last.map(x => h('div.nb-line', pill(RES[x.result][0], RES[x.result][1]),
      h('div.grow', h('div.nb-t', x.title), h('div.nb-small.muted', [x.subject_name, x.amount ? eur(x.amount) : null, day(x.decided_on), x.reason].filter(Boolean).join(' · '))))),
    o.winners.length ? h('div.nb-small.muted.nb-mt12', `Chi ci batte: ${o.winners.map(w => `${w.name} (${w.times})`).join(' · ')}`) : null,
    h('a.nb-via.nb-mt12', { href: '#/crm/esiti' }, ic('link', 14), 'Tutte le vinte e perse del CRM'));
}

// foglio A4 per la riunione (si vede solo in stampa)
function printSheet(i, a, gl) {
  const rows = (title, list) => h('div', h('div.nb-lbl', title), list.length ? list.map(([n, s]) => h('div.nb-pr', h('span', n), h('span.muted', s))) : h('div.nb-pr', h('span.muted', '—')));
  const sheet = h('div.nb-print', { 'aria-hidden': 'true' },
    h('div.nb-pr-head', h('div', h('div.en-eyebrow', 'Alma CRM · Nuovi business · riunione di direzione'), h('div.nb-pr-t', title2(i.name))),
      h('div.nb-small.muted.nb-right', day(todayIso()), h('br'), `${i.owner_name || '—'}${i.sponsor_name ? ` · sponsor ${i.sponsor_name}` : ''}`)),
    h('div.nb-row', lightPill(a.light.color, LIGHT[a.light.color]), h('div', a.summary ? a.summary.replace(/\*\*/g, '').split('\n')[0] : a.light.reasons.map(r => r.t).join(' · '))),
    h('div.nb-pr-k', [['Fase', i.phase === 'abbandonata' ? 'Abbandonata' : `${PHASES[PHASE_KEYS.indexOf(i.phase)][1]} (${PHASE_KEYS.indexOf(i.phase) + 1}/5)`], ['Requisiti', `${a.gaps.ok} di ${a.gaps.total}`], ['Clienti contattati', `${a.funnel.contattati} di ${a.funnel.individuati}`], ['Spesa', `${eur(a.spent)} / ${eur(a.budget)}`]]
      .map(([l, n]) => h('div', h('div.nb-lbl', l), h('b', n)))),
    gl ? h('div', h('div.nb-lbl', 'Da decidere'), h('div.nb-pr-dec', `Gate G${gl.n} «${gl.question}»${gl.due_date ? ` · entro il ${day(gl.due_date)}` : ''}${a.lateTasks ? ` · ${a.lateTasks} passi scaduti` : ''}${a.openHypotheses ? ` · ${a.openHypotheses} ipotesi da verificare` : ''}.`,
      h('div.nb-pr-box', '☐ Prosegui     ☐ Rimanda al ________     ☐ Abbandona'))) : null,
    h('div.nb-pr-2', rows('Prossimi passi', a.next.slice(0, 6).map(t => [t.title, `${t.owner_name ? initials(t.owner_name) : '—'} · ${t.late ? 'scaduto ' : ''}${dm(t.due_date)}`])),
      rows('Rischi', a.risks.slice(0, 6).map(r => [r.title || r.body.slice(0, 50), [r.level, r.mitigation].filter(Boolean).join(' · ')]))),
    h('div.nb-small.muted.nb-pr-foot', 'Generato da Alma Space · Nuovi business'));
  return sheet;
}
