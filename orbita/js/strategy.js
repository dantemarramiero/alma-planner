// Alma Strategy: Hoshin Kanri. Tre pagine:
// - Hoshin Kanri (la vista d'insieme, a forma di X-Matrix): solo da guardare (fasce a L per area, pillar a L verso i KPI di livello 0, mesi calcolati dalle contromisure);
// - Gestione: tabelle da scrivere come in Excel (progetti, KPI, pillar e BU, aree), si salva cella per cella;
// - A3: la scheda del progetto con il format Almacis e le contromisure che fanno l'avanzamento.
import { a3Calendar } from './a3-calendar.js';
import { h, fill, toast, confirmDialog, modal, loading, avatar, isMobile } from './ui.js';
import { a3QuickBox } from './app2.js';
import { get, post, patch, del } from './api.js';
import { store, userById } from './store.js';
import { icon } from './icons.js';
import { projectDetail } from './projects.js';
import { openTicket } from './tickets.js';
import { performanceView } from './performance.js';

// l'anno dell'Hoshin Kanri che si guarda: si sceglie in testata e resta ricordato su questo computer
const YEAR_KEY = 'alma.hkYear';
let YEAR = (() => { try { return Number(localStorage.getItem(YEAR_KEY)) || new Date().getFullYear(); } catch { return new Date().getFullYear(); } })();
let YEARS = null;
let D = null; // tutto l'anno, da GET /api/strategy

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const CATEGORIES = [['macchine', 'Macchine / Strumenti'], ['persone', 'Persone'], ['ambiente', 'Ambiente'], ['materiali', 'Materiali'], ['metodo', 'Metodo'], ['misurazioni', 'Misurazioni']];
const STATUSES = [['attivo', 'Attivo'], ['in pausa', 'In pausa'], ['concluso', 'Concluso']];

async function load() {
  if (!YEARS) YEARS = await get('/api/strategy/years', { quiet: true }).then(r => r.years).catch(() => [{ year: 2026 }]);
  if (!YEARS.some(y => y.year === YEAR)) YEAR = (YEARS.filter(y => y.year <= new Date().getFullYear()).pop() || YEARS[YEARS.length - 1]).year;
  D = await get(`/api/strategy?year=${YEAR}`);
}
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
function yearPicker() {
  const list = YEARS || [{ year: YEAR }];
  const max = Math.max(...list.map(y => y.year));
  return h('select.hk-year', { 'aria-label': 'Anno dell’Hoshin Kanri', on: { change: async e => {
    if (e.target.value === 'new') { e.target.value = String(YEAR); return newYear(max + 1); }
    YEAR = Number(e.target.value);
    try { localStorage.setItem(YEAR_KEY, String(YEAR)); } catch { /* niente */ }
    rerender();
  } } },
  list.map(y => h('option', { value: String(y.year), selected: y.year === YEAR }, y.undecided && (y.year < new Date().getFullYear() || new Date().getMonth() === 11 || list.some(z => z.year === y.year + 1)) ? `${y.year} · ${y.undecided} da decidere` : String(y.year))),
  D?.can_admin ? h('option', { value: 'new' }, `+ Crea il ${max + 1}`) : null);
}
async function newYear(next) {
  if (!await confirmDialog(`Creare l’Hoshin Kanri ${next}? Si copiano dal ${next - 1} True North, pillar, BU e funzioni con le aree e i KPI (senza i valori mensili). Gli A3 entrano solo con la decisione di fine anno di ognuno.`, { ok: `Crea il ${next}` })) return;
  await post('/api/strategy/years', { year: next, from: next - 1 });
  YEARS = null; YEAR = next;
  try { localStorage.setItem(YEAR_KEY, String(YEAR)); } catch { /* niente */ }
  toast(`Hoshin Kanri ${next} creato`);
  rerender();
}
// fine anno: da dicembre, o quando l'anno dopo c'è già, ogni A3 aperto decide come prosegue
const yearEnding = () => D.next_year_exists || D.today >= `${YEAR}-12-01` || Number(D.today.slice(0, 4)) > YEAR;
const undecided = p => !p.carry && p.status !== 'concluso';
const svgEl = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val);
  el.append(...kids);
  return el;
};
const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (c, t) => `#${hex(c).map(x => Math.round(x + (255 - x) * t).toString(16).padStart(2, '0')).join('')}`;
const inkOn = c => { const [r, g, b] = hex(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? 'var(--ink, #2C2C2C)' : '#FFFFFF'; };

// Avanzamento a una data: reale = pesi delle contromisure chiuse entro quella data, atteso = pesi con scadenza entro quella data.
function progressAt(p, iso) {
  let act = 0, exp = 0;
  for (const t of p.tasks) {
    if (t.closed_date && t.closed_date <= iso) act += t.weight;
    if (t.due_date && t.due_date <= iso) exp += t.weight;
  }
  return { act, exp, ok: act >= exp };
}
const pillarOf = k => D.pillars.find(p => p.id === k.pillar_id);
const kpiById = id => D.kpis.find(k => k.id === id);
const areaById = id => D.areas.find(a => a.id === id);
const funcById = id => D.functions.find(f => f.id === id);
// Macro aree e sotto aree (11/11/2026): un'area senza parent_id è una macro area. Le colonne dell'Hoshin Kanri e le
// aree a cui si assegna un progetto sono le aree «finali»: le sotto aree, o la macro area quando non ne ha.
const byPos = (a, b) => a.position - b.position || a.id - b.id;
const childrenOf = id => D.areas.filter(x => x.parent_id === id).sort(byPos);
const macroOf = a => (a?.parent_id ? areaById(a.parent_id) : a);
const areaLabel = a => (!a ? '' : a.parent_id ? `${macroOf(a)?.name || ''} › ${a.name}` : a.name);
const hasSubAreas = () => D.areas.some(a => a.parent_id);
// macro aree nell'ordine delle fasce: prima le funzioni di staff, poi le BU
function orderedMacros() {
  const fpos = f => (f ? (f.kind === 'staff' ? 0 : 1000) + f.position : 9999);
  return D.areas.filter(a => !a.parent_id).sort((a, b) => fpos(funcById(a.function_id)) - fpos(funcById(b.function_id)) || byPos(a, b));
}
// Aree finali nell'ordine delle fasce: macro area per macro area, le sue sotto aree (o lei stessa).
function orderedAreas() {
  return orderedMacros().flatMap(m => { const kids = childrenOf(m.id); return kids.length ? kids : [m]; });
}
// tutti i progetti di un'area: di una macro area anche quelli delle sue sotto aree
const inArea = (p, id) => p.area_id === id || areaById(p.area_id)?.parent_id === id;
function areaColors() {
  const out = {}, byFunc = {};
  for (const a of orderedAreas()) (byFunc[a.function_id] ||= []).push(a);
  for (const [fid, list] of Object.entries(byFunc)) {
    const base = funcById(Number(fid)).color;
    list.forEach((a, j) => { out[a.id] = mix(base, list.length === 1 ? 0.25 : 0.62 - 0.62 * (j / (list.length - 1))); });
  }
  return out;
}
const projectsOf = areaId => D.projects.filter(p => p.area_id === areaId).sort((a, b) => a.position - b.position || a.id - b.id);
const surname = s => String(s || '').trim().split(/\s+/).pop().toLowerCase();
const isMine = p => surname(p.owner) && surname(p.owner) === surname(store.me?.name);

// Salvataggio di un campo, con l'aggiornamento della copia locale.
async function save(entity, row, changes, { quiet = true } = {}) {
  const updated = await patch(`/api/strategy/${entity}/${row.id}`, changes);
  Object.assign(row, updated);
  if (!quiet) toast('Salvato');
  flashSaved();
  return row;
}
function flashSaved() {
  const el = document.getElementById('hk-saved');
  if (!el) return;
  el.textContent = `Salvato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1200);
}

export async function strategyView(container, parts = []) {
  // performance management: pagine a parte (performance.js)
  if (['scheda', 'obiettivi', 'team', 'mansionario'].includes(parts[1])) return performanceView(container, parts[1], parts[2]);
  const page = parts[1] === 'matrix' ? 'hoshin' : ['hoshin', 'gestione', 'a3', 'dashboard'].includes(parts[1]) ? parts[1] : 'hoshin';
  if (parts[1] === 'invito') return invitePage(container, Number(parts[2]));
  fill(container, loading());
  const qy = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('y'));
  if (qy) YEAR = qy; // un link a un A3 di un altro anno
  await load();
  if (page === 'hoshin') return matrixPage(container);
  if (page === 'gestione') return gestionePage(container, parts[2]);
  if (page === 'a3') return Number(parts[2]) ? a3Page(container, Number(parts[2])) : a3List(container);
  if (page === 'dashboard') return dashboardPage(container);
}

const head = (title, right) => h('div.page-head.hk-head', h('div', h('div.hk-eyebrow', 'Alma Strategy · Hoshin Kanri ', yearPicker()), h('h1', title)), right || null);

// ═══ Hoshin Kanri: la vista d'insieme ════════════════════════════════════════════════════════════
// Le misure si calcolano sulla larghezza disponibile, così la vista sta sullo schermo senza scorrere di lato.
// «Adatta allo schermo» rimpicciolisce anche in altezza, per vederla intera (per esempio in riunione).
const FIT_KEY = 'alma.hoshinFit';

function geometry(W, nAreas) {
  const GAP = 2, X0 = 6, RH = 26;
  // colonne minime a destra; quello che avanza va prima alle fasce, poi al nome del progetto e al target
  const base = { owner: 92, month: 28, prog: 96, kpi: 80 };
  const minName = 210;
  const fixed = base.owner + 12 * base.month + base.prog + base.kpi + minName;
  const CW = Math.max(13, Math.min(22, Math.floor((W - fixed - X0 - 12) / nAreas) - GAP));
  const bands = X0 + nAreas * (CW + GAP) + 12;
  let rest = W - bands - fixed;
  if (rest < 0) {
    // schermo stretto: si stringono nome, owner e mesi fino a starci
    let need = -rest;
    const cut = (have, min) => { const c = Math.min(need, have - min); need -= c; return have - c; };
    const name = cut(minName, 160), owner = cut(base.owner, 70), month = base.month - Math.ceil(Math.min(need, 12 * 4) / 12);
    return { CW, GAP, X0, RH, COLS: { name, owner, target: 0, month, prog: base.prog, kpi: base.kpi }, small: true };
  }
  const month = Math.min(40, base.month + Math.max(0, Math.floor(Math.min(rest * 0.35, 12 * 12) / 12)));
  rest -= (month - base.month) * 12;
  const target = rest >= 150 ? Math.min(210, rest - Math.max(0, rest - 210 - 110)) : 0;
  rest -= target;
  const name = minName + Math.max(0, Math.min(110, rest));
  rest -= name - minName;
  const owner = base.owner + Math.max(0, Math.min(28, rest));
  return { CW, GAP, X0, RH, COLS: { name, owner, target, month, prog: base.prog, kpi: base.kpi }, small: CW < 17 };
}

function matrixPage(container) {
  let sel = null, filter = 'all';
  let fit = false;
  try { fit = localStorage.getItem(FIT_KEY) === '1'; } catch { /* niente */ }
  const today = D.today;
  const status = new Map(D.projects.map(p => [p.id, progressAt(p, today)]));
  const body = h('div.hk-matrix-wrap');
  const strip = h('div.hk-strip');
  const fitBtn = h('button.btn', { type: 'button', 'aria-pressed': String(fit), on: { click: () => { fit = !fit; try { localStorage.setItem(FIT_KEY, fit ? '1' : '0'); } catch { /* niente */ } fitBtn.setAttribute('aria-pressed', String(fit)); fitBtn.lastChild.textContent = fit ? 'Dimensione normale' : 'Adatta allo schermo'; draw(); } } },
    icon('expand'), h('span', fit ? 'Dimensione normale' : 'Adatta allo schermo'));
  fill(container,
    head('Hoshin Kanri', h('div.row', h('span.hk-saved#hk-saved'), fitBtn, D.can_admin ? h('a.btn', { href: '#/strategy/gestione' }, icon('pencil'), 'Modifica in Gestione') : null)),
    strip, body,
    // legenda sempre visibile: le lettere dei KPI di livello 0 con il loro nome
    h('div.kp-legend', h('span.kp-legend-t', 'KPI di livello 0'), D.kpis.map(k => {
      const edge = pillarOf(k)?.color || '#BEBEBC';
      return h('span.kp-legend-i', { title: `target ${k.target}` }, h('b', { style: { background: mix(edge, 0.78), borderColor: edge } }, k.letter), k.name);
    })));

  function drawStrip() {
    const ids = D.projects.map(p => p.id);
    const ok = ids.filter(id => status.get(id).ok).length;
    const covered = D.kpis.filter(k => D.projects.some(p => p.kpi_ids.includes(k.id))).length;
    const empty = orderedAreas().filter(a => !projectsOf(a.id).length);
    const stat = (label, value, cls) => h('div.hk-stat', h('span', label), h('strong', { class: cls || '' }, value));
    fill(strip,
      h('div.hk-stats', stat('Progetti', ids.length), stat('In linea', ok, 'ok'), stat('In ritardo', ids.length - ok, 'ko'),
        stat('KPI coperti da progetti', `${covered} su ${D.kpis.length}`), stat('Aree senza progetti', `${empty.length} su ${orderedAreas().length}`)),
      h('div.hk-filters', [['all', 'Tutto'], ['late', 'Solo in ritardo'], ['mine', 'I miei']].map(([k, l]) =>
        h('button.hk-chip', { type: 'button', class: filter === k ? 'on' : '', 'aria-pressed': String(filter === k), on: { click: () => { filter = k; sel = null; draw(); } } }, l))));
  }

  // sul telefono la matrice non si legge: elenco per funzione, con la matrice intera a richiesta
  let showMatrix = false;
  function phoneList() {
    const colors = areaColors();
    const keep = p => filter === 'all' || (filter === 'late' && !status.get(p.id).ok) || (filter === 'mine' && isMine(p));
    // per macro area (canvas 11/11): dentro, i progetti con la loro sotto area
    const groups = orderedMacros().map(m => ({ f: { name: m.name, color: funcById(m.function_id)?.color || '#8A8A8A' }, ps: D.projects.filter(p => inArea(p, m.id) && keep(p)) })).filter(g => g.ps.length);
    fill(body, h('div.hk-phone',
      h('button.btn.hk-phone-m', { type: 'button', on: { click: () => { showMatrix = true; draw(); } } }, icon('grid-3x3'), 'Vedi la matrice intera'),
      groups.length ? groups.map(({ f, ps }) => h('section.hk-card.hk-phone-g', { style: { borderTopColor: f.color } },
        h('div.hk-phone-h', h('strong', f.name), h('span.muted', ps.length === 1 ? '1 progetto' : `${ps.length} progetti`)),
        ps.map(p => {
          const st = status.get(p.id), a = areaById(p.area_id);
          return h('a.hk-phone-p', { href: `#/strategy/a3/${p.id}` },
            h('span.hk-phone-t', a?.parent_id ? h('span.hk-eyebrow', { style: { color: colors[a.id] } }, a.name) : null, h('strong', p.name), h('small', p.owner)),
            h('span.hk-phone-r', h('span.hk-status', { class: st.ok ? 'ok' : 'ko' }, st.ok ? 'in linea' : 'in ritardo'), h('span.hk-prog', progressBar(st.act, st.exp), `${st.act}%`)));
        }))) : h('div.card.empty', 'Nessun progetto con questo filtro.'),
      h('div.hk-card.hk-phone-tn', h('span.hk-eyebrow', 'True North'), h('p', D.true_north ? `“${D.true_north}”` : 'Ancora da scrivere.'))));
  }

  function draw() {
    drawStrip();
    if (window.matchMedia('(max-width: 760px)').matches && !showMatrix) return phoneList();
    const areas = orderedAreas();
    const staff = areas.filter(a => funcById(a.function_id).kind === 'staff');
    const bu = areas.filter(a => funcById(a.function_id).kind === 'bu');
    const avail = Math.max(1000, body.clientWidth - 52); // margine per la barra di scorrimento verticale
    const { CW, GAP, X0, RH, COLS, small } = geometry(avail, staff.length + bu.length);
    const colors = areaColors();
    const BUX = X0 + staff.length * (CW + GAP) + 12;
    const PX = BUX + bu.length * (CW + GAP) - GAP;
    const monthsX = PX + COLS.name + COLS.owner + COLS.target;
    const width = monthsX + 12 * COLS.month + COLS.prog + COLS.kpi;
    // le aree senza progetti restano una fascia sottile: si vedono, ma non rubano altezza
    const EMPTY_H = 10;
    const hOf = a => { const n = projectsOf(a.id).length; return n ? n * RH : EMPTY_H; };
    const heightOf = list => list.reduce((s, a) => s + hOf(a), 0);
    const LABEL_H = 128;
    const staffY = 30, buY = staffY + heightOf(staff) + 26, labelY = buY + heightOf(bu) + 8;
    const MACRO_H = hasSubAreas() ? 24 : 0; // riga delle macro aree
    const fY = labelY + LABEL_H + 4 + MACRO_H;
    const pTop = fY + 62;
    const kRows = D.pillars.map(p => Math.max(2, D.kpis.filter(k => k.pillar_id === p.id).length));
    const thisMonth = Number(today.slice(0, 4)) === YEAR ? Number(today.slice(5, 7)) - 1 : -1;

    let hotP = null, hotK = null;
    if (sel || filter !== 'all') {
      hotP = new Set(); hotK = new Set();
      if (sel?.t === 'p') { hotP.add(sel.id); D.projects.find(p => p.id === sel.id).kpi_ids.forEach(k => hotK.add(k)); }
      else if (sel?.t === 'k') { hotK.add(sel.id); D.projects.filter(p => p.kpi_ids.includes(sel.id)).forEach(p => hotP.add(p.id)); }
      else for (const p of D.projects) {
        if ((filter === 'late' && !status.get(p.id).ok) || (filter === 'mine' && isMine(p))) { hotP.add(p.id); p.kpi_ids.forEach(k => hotK.add(k)); }
      }
    }
    const dim = on => (hotP && !on ? 'hk-dim' : '');
    const els = [];
    const abs = (x, y, w, hh, extra = {}, ...kids) => h('div', { ...extra, style: { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: hh === null ? undefined : `${hh}px`, ...(extra.style || {}) } }, ...kids);
    const col = (w, extra = {}, ...kids) => h('span', { ...extra, style: { width: `${w}px`, ...(extra.style || {}) } }, ...kids);

    els.push(abs(PX, 0, width - PX, 26, { class: 'hk-colhead' },
      col(COLS.name, { style: { paddingLeft: '12px' } }, 'Progetto'), col(COLS.owner, {}, 'Owner'),
      COLS.target ? col(COLS.target, {}, 'Target') : null,
      MONTHS.map((m, i) => col(COLS.month, { class: `c ${i === thisMonth ? 'now' : ''}` }, COLS.month < 34 ? m.slice(0, 1) : m)),
      col(COLS.prog, { style: { paddingLeft: '8px' } }, 'Avanzamento'), col(COLS.kpi, {}, 'KPI')));
    els.push(abs(X0, 4, 300, 18, { class: 'hk-blocklabel' }, 'Funzioni di staff'));
    els.push(abs(X0, buY - 20, 300, 18, { class: 'hk-blocklabel' }, 'Business unit'));

    const prow = (p, y, color) => {
      const st = status.get(p.id);
      const on = !hotP || hotP.has(p.id);
      const area = areaById(p.area_id);
      const cells = MONTHS.map((_, m) => {
        const end = monthEnd(YEAR, m), start = `${YEAR}-${String(m + 1).padStart(2, '0')}-01`;
        const tappa = p.tasks.some(t => t.due_date && t.due_date >= start && t.due_date <= end);
        const future = start > today;
        const at = progressAt(p, future ? end : (end > today ? today : end));
        const expEnd = progressAt(p, end).exp;
        let cls = '', txt = '', tip = '';
        if (!expEnd && !tappa) { cls = 'none'; txt = '·'; }
        else if (future) { cls = tappa ? 'fut tappa' : 'fut'; txt = expEnd; tip = `atteso ${expEnd}%`; }
        else { cls = (at.act >= at.exp ? 'ok' : 'ko') + (tappa ? ' tappa' : ''); txt = at.act; tip = `${at.act}% su ${at.exp}%`; }
        return col(COLS.month, { class: 'hk-mc' }, h('span.hk-pill', { class: cls, title: `${MONTHS[m]}: ${tip || 'nessuna tappa'}` }, String(txt)));
      });
      return abs(PX, y, width - PX, RH, { class: `hk-prow ${dim(on)} ${sel?.t === 'p' && sel.id === p.id ? 'sel' : ''}` },
        h('span.hk-track', { style: { left: `${monthsX - PX}px`, width: `${12 * COLS.month}px` } }),
        h('button.hk-pname', { type: 'button', title: `${p.name}${area ? ` · ${areaLabel(area)}` : ''}${p.target ? ` · ${p.target}` : ''}`, style: { width: `${COLS.name}px`, borderLeftColor: color }, on: { click: () => { sel = sel?.t === 'p' && sel.id === p.id ? null : { t: 'p', id: p.id }; draw(); if (sel) openPanel(p); } } }, p.name),
        col(COLS.owner, { class: 'hk-cell', title: p.owner }, p.owner),
        COLS.target ? col(COLS.target, { class: 'hk-cell muted', title: p.target }, p.target) : null,
        cells,
        col(COLS.prog, { class: 'hk-prog', title: st.ok ? 'In linea con il piano' : `Sotto l’atteso di ${st.exp - st.act} punti` },
          h('span.hk-bar', h('span', { class: st.ok ? 'ok' : 'ko', style: { width: `${st.act}%` } }), h('i', { style: { left: `${st.exp}%` } })),
          h('span', { class: st.ok ? 'ok' : 'ko' }, `${st.act}%`)),
        col(COLS.kpi, { class: 'hk-refs' }, p.kpi_ids.map(kid => {
          const k = kpiById(kid); if (!k) return null; const pc = pillarOf(k)?.color || '#BEBEBC';
          return h('span.hk-ref', { tabindex: 0, 'aria-label': `${k.letter} · ${k.name}`, style: { background: mix(pc, 0.72), borderColor: pc },
            on: { mouseenter: e => showKpiTip(e.currentTarget, k), mouseleave: hideKpiTip, focus: e => showKpiTip(e.currentTarget, k), blur: hideKpiTip } }, k.letter);
        })));
    };

    const layout = (list, x0, y0) => {
      let y = y0;
      list.forEach((a, i) => {
        const x = x0 + i * (CW + GAP), ps = projectsOf(a.id), hh = hOf(a), c = colors[a.id];
        const on = !hotP || ps.some(p => hotP.has(p.id));
        els.push(abs(x, y, CW, labelY + LABEL_H - y, { class: `hk-band ${dim(on)}`, style: { background: c } }));
        els.push(abs(x, y, PX - x, hh - GAP, { class: `hk-band ${dim(on)}`, style: { background: c }, title: ps.length ? undefined : `${a.name}: nessun progetto` }));
        els.push(abs(x, labelY, CW, LABEL_H, { class: `hk-alabel ${small ? 'small' : ''} ${dim(on)}`, style: { color: inkOn(c) }, title: `${a.name} · sponsor ${a.sponsor}` }, h('span', a.name)));
        ps.forEach((p, j) => els.push(prow(p, y + j * RH, c)));
        y += hh;
      });
    };
    layout(staff, X0, staffY);
    layout(bu, BUX, buY);
    const fspan = (list, x0) => {
      const groups = [];
      list.forEach((a, i) => { const last = groups[groups.length - 1]; if (last && last.f === a.function_id) last.to = i; else groups.push({ f: a.function_id, from: i, to: i }); });
      for (const g of groups) {
        const f = funcById(g.f), x = x0 + g.from * (CW + GAP), w = (g.to - g.from + 1) * (CW + GAP) - GAP;
        els.push(abs(x, fY, w, 4, { class: 'hk-fbar', style: { background: f.color }, title: `${f.name} · sponsor ${f.sponsor}` }));
        if (w >= 56) els.push(abs(x, fY + 7, w, null, { class: 'hk-flabel', title: `${f.name} · sponsor ${f.sponsor}` }, h('strong', f.name), h('small', f.sponsor)));
      }
    };
    fspan(staff, X0); fspan(bu, BUX);
    // macro aree: una fascia sopra le sue colonne (sotto aree), con il nome se c'è spazio
    const mspan = (list, x0) => {
      const groups = [];
      list.forEach((a, i) => { const m = macroOf(a), last = groups[groups.length - 1]; if (last && last.m === m.id) last.to = i; else groups.push({ m: m.id, from: i, to: i }); });
      for (const g of groups.filter(x => childrenOf(x.m).length)) { // solo le macro aree con sotto aree: le altre hanno già il loro nome
        const m = areaById(g.m), x = x0 + g.from * (CW + GAP), w = (g.to - g.from + 1) * (CW + GAP) - GAP;
        const c = mix(funcById(m.function_id)?.color || '#8A8A8A', 0.45);
        els.push(abs(x, labelY + LABEL_H + 4, w, MACRO_H - 4, { class: 'hk-mbar', style: { background: c, color: inkOn(c) }, title: `Macro area ${m.name}${m.sponsor ? ` · sponsor ${m.sponsor}` : ''}` },
          w >= 24 ? h('span', m.name) : null));
      }
    };
    if (MACRO_H) { mspan(staff, X0); mspan(bu, BUX); }

    els.push(abs(PX, labelY + 4, monthsX + 12 * COLS.month - PX, LABEL_H + 50, { class: 'hk-tn' }, trueNorth()));

    const pillarBlocks = [];
    let y = pTop;
    D.pillars.forEach((p, i) => { pillarBlocks.push({ p, y, n: kRows[i] }); y += kRows[i] * RH + (i === 0 ? 10 : 0); });
    const yEnd = y;
    const kHot = p => !hotK || D.kpis.some(k => k.pillar_id === p.id && hotK.has(k.id));
    const third = Math.ceil(staff.length * 0.4);
    const shapes = [
      { x: BUX, w: PX - BUX },
      { x: X0 + third * (CW + GAP), w: (staff.length - third) * (CW + GAP) - GAP },
      { x: X0, w: third * (CW + GAP) - GAP },
    ];
    const PC = Math.round(COLS.name * 0.5); // cella del pillar
    const kNameW = COLS.name - PC + COLS.owner + COLS.target;
    pillarBlocks.forEach(({ p, y: py, n }, i) => {
      const s = shapes[Math.min(i, shapes.length - 1)];
      const tint = mix(p.color, 0.78), cls = `hk-band ${hotK && !kHot(p) ? 'hk-dim' : ''}`;
      els.push(abs(s.x, fY + 50, s.w, py + n * RH - fY - 50, { class: cls, style: { background: tint } }));
      els.push(abs(s.x, py, PX - s.x, n * RH, { class: cls, style: { background: tint, borderTopLeftRadius: '0' } }));
      els.push(abs(PX, py, PC, n * RH, { class: `hk-pcell ${hotK && !kHot(p) ? 'hk-dim' : ''}`, style: { background: tint, borderLeftColor: p.color }, title: p.description }, h('strong', p.name)));
      D.kpis.filter(k => k.pillar_id === p.id).forEach((k, j) => {
        const on = !hotK || hotK.has(k.id), dep = D.projects.filter(pr => pr.kpi_ids.includes(k.id)).length;
        const nums = (k.monthly || []).map(s => Number(String(s || '').replace(',', '.'))).filter(Number.isFinite);
        els.push(abs(PX + PC, py + j * RH, width - PX - PC, RH, { class: `hk-krow ${hotK && !on ? 'hk-dim' : ''} ${sel?.t === 'k' && sel.id === k.id ? 'sel' : ''}` },
          h('button.hk-kname', { type: 'button', title: `${k.name} · owner ${k.owner}`, style: { width: `${kNameW}px` }, on: { click: () => { sel = sel?.t === 'k' && sel.id === k.id ? null : { t: 'k', id: k.id }; draw(); if (sel) openKpiPanel(k); } } },
            h('span.hk-ref', { style: { background: tint, borderColor: p.color } }, k.letter), h('span.t', k.name), h('small', { class: dep ? '' : 'muted' }, dep ? ` · ${dep} pr.` : ' · ordinaria')),
          MONTHS.map((_, m) => col(COLS.month, { class: 'hk-kv' }, (k.monthly || [])[m] || '')),
          col(COLS.prog, { style: { paddingLeft: '8px' } }, spark(nums)),
          col(COLS.kpi, { class: `hk-cell ${k.target === 'da definire' ? 'warn' : ''}`, title: `Target ${k.target}` }, k.target)));
      });
    });
    els.push(abs(PX + PC, pTop - 22, width - PX - PC, 20, { class: 'hk-colhead small' },
      col(kNameW, {}, 'KPI di livello 0'), col(12 * COLS.month, { class: 'c' }, 'valori mensili'),
      col(COLS.prog, { style: { paddingLeft: '8px' } }, 'Trend'), col(COLS.kpi, {}, 'Target')));

    if (thisMonth >= 0) {
      const tx = monthsX + (thisMonth + Number(today.slice(8, 10)) / 31) * COLS.month;
      els.push(abs(tx, 26, 2, yEnd - 26, { class: 'hk-today' }), abs(tx - 22, -15, 46, 14, { class: 'hk-today-l' }, 'OGGI'));
    }
    els.push(abs(monthsX + 12 * COLS.month, 26, 0, yEnd - 26, { class: 'hk-yearend' }), abs(monthsX + 12 * COLS.month - 23, -15, 46, 14, { class: 'hk-today-l grey' }, '31/12'));

    const height = yEnd + 12;
    const matrix = h('div.hk-matrix', { style: { width: `${width}px`, height: `${height}px` } }, els);
    // sotto i 1000 px (tablet in verticale, telefono) le colonne non si stringono più: si rimpicciolisce tutto per stare in larghezza
    // sul telefono non sotto il 55%, se no non si legge: lì la vista scorre di lato dentro la sua scheda
    const phone = window.matchMedia('(max-width: 760px)').matches;
    const widthScale = Math.max(phone && !fit ? 0.55 : 0, Math.min(1, (body.clientWidth - 32) / width));
    if (fit || widthScale < 1) {
      // con «Adatta allo schermo» rimpicciolisce anche per stare nell'altezza della finestra
      const top = body.getBoundingClientRect().top;
      const availH = Math.max(420, window.innerHeight - Math.max(0, top) - 40);
      const scale = fit ? Math.min(widthScale, availH / height) : widthScale;
      matrix.style.transform = `scale(${scale})`;
      matrix.style.transformOrigin = 'top left';
      fill(body, h('div', { style: { width: `${width * scale}px`, height: `${height * scale}px` } }, matrix));
    } else fill(body, matrix);
    body.classList.toggle('fit', fit);
  }

  // True North al centro: gli amministratori lo cambiano qui con la matita (Salva o Invio, Esc annulla)
  function trueNorth() {
    const box = h('div.hk-tn-box');
    const show = () => fill(box,
      h('div.hk-tn-k', h('span', 'Ambition'), h('strong', 'True North'),
        D.can_admin ? h('button.hk-tn-edit', { type: 'button', title: 'Modifica il True North', 'aria-label': 'Modifica il True North', on: { click: edit } }, icon('pencil', { size: 14 }), 'Modifica') : null),
      h('p', D.true_north ? `“${D.true_north}”` : 'Ancora da scrivere.'));
    function edit() {
      const ta = h('textarea.hk-tn-ta', { rows: 3, 'aria-label': 'True North' }, D.true_north || '');
      const saveIt = async () => {
        const val = ta.value.trim();
        await patch('/api/strategy/year', { year: YEAR, true_north: val });
        D.true_north = val;
        flashSaved();
        show();
      };
      ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); show(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveIt(); }
      });
      fill(box,
        h('div.hk-tn-k', h('span', 'Ambition'), h('strong', 'True North')),
        h('div.hk-tn-form', ta, h('div.row', h('button.btn.btn-primary', { type: 'button', on: { click: saveIt } }, 'Salva'), h('button.btn', { type: 'button', on: { click: show } }, 'Annulla'), h('span.muted.small', 'Invio salva · Maiusc+Invio va a capo · Esc annulla'))));
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    }
    show();
    return box;
  }

  function openPanel(p) {
    const st = status.get(p.id);
    const area = areaById(p.area_id);
    modal({
      drawer: true,
      title: h('div', h('div.hk-eyebrow', `A3 · ${areaLabel(area)}`), h('h2', p.name)),
      body: h('div.hk-panel',
        h('p.muted', `Owner ${p.owner || '—'} · ${p.target || ''}`),
        h('div.hk-two', h('div.hk-box', h('span', 'Avanzamento reale'), h('strong', { class: st.ok ? 'ok' : 'ko' }, `${st.act}%`)), h('div.hk-box', h('span', 'Atteso a oggi'), h('strong', `${st.exp}%`))),
        h('h3', 'KPI che muove'),
        p.kpi_ids.length ? p.kpi_ids.map(id => { const k = kpiById(id); return k ? h('div.hk-line', h('span', `${k.letter} · ${k.name}`), h('span.muted', `target ${k.target}`)) : null; }) : h('p.muted', 'Nessun KPI collegato'),
        h('h3', 'Prossime contromisure'),
        p.tasks.filter(t => !t.closed_date).slice(0, 4).map(t => h('div.hk-line', h('span', t.activity), h('span.muted', itDate(t.due_date))))),
      actions: [h('a.btn', { href: '#/strategy/gestione' }, 'Modifica in Gestione'), h('a.btn.btn-primary', { href: `#/strategy/a3/${p.id}` }, 'Apri l’A3')],
      onClose: () => { sel = null; draw(); },
    });
  }
  function openKpiPanel(k) {
    const ps = D.projects.filter(p => p.kpi_ids.includes(k.id));
    modal({
      drawer: true,
      title: h('div', h('div.hk-eyebrow', `KPI di livello 0 · ${pillarOf(k)?.name || ''}`), h('h2', `${k.letter} · ${k.name}`)),
      body: h('div.hk-panel', h('p.muted', `Owner ${k.owner || '—'} · target ${k.target}`),
        h('h3', ps.length ? 'Progetti a supporto' : 'Nessun progetto: gestione ordinaria'),
        ps.map(p => { const st = status.get(p.id); return h('a.hk-line', { href: `#/strategy/a3/${p.id}` }, h('span', p.name), h('span', { class: st.ok ? 'ok' : 'ko' }, `${st.act}% / ${st.exp}%`)); })),
      actions: [h('a.btn', { href: '#/strategy/gestione/kpi' }, 'Modifica valori e target')],
      onClose: () => { sel = null; draw(); },
    });
  }
  draw();
  // ridisegna quando cambia la larghezza (barra laterale aperta, finestra ridimensionata)
  let lastW = body.clientWidth, timer = null;
  const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (!body.isConnected) { ro.disconnect(); return; } if (Math.abs(body.clientWidth - lastW) > 8) { lastW = body.clientWidth; draw(); } }, 120); });
  ro.observe(body);
}

// ═══ KPI di livello 0 riconoscibili: etichetta con colore del pillar, lettera, nome e target ═════════
const projectsOnKpi = k => D.projects.filter(p => p.kpi_ids.includes(k.id)).length;
function kpiChip(k, { small = false, onRemove = null } = {}) {
  if (!k) return null;
  const p = pillarOf(k), edge = p?.color || '#8A8A8A';
  return h('span.kp-chip', { class: small ? 'small' : '', style: { background: mix(edge, 0.8), borderColor: edge }, title: `${k.letter} · ${k.name} · target ${k.target}${p ? ` · ${p.name}` : ''}` },
    h('b.kp-letter', { style: { background: edge, color: inkOn(edge) } }, k.letter),
    h('span.kp-text', h('span.kp-name', k.name), small ? null : h('span.kp-target', `target ${k.target}`)),
    onRemove ? h('button.kp-x', { type: 'button', 'aria-label': `Scollega ${k.name}`, on: { click: e => { e.stopPropagation(); onRemove(); } } }, '×') : null);
}
// Il campo «KPI collegati»: etichette (compatto = le prime due + «+N») e «Collega un KPI», che apre l'elenco.
function kpiField(p, { compact = false, editable = false, onChange } = {}) {
  const box = h('div.kp-field', { class: compact ? 'compact' : '' });
  const setIds = async ids => { await save('projects', p, { kpi_ids: ids }); draw(); onChange?.(); };
  function draw() {
    const ks = p.kpi_ids.map(kpiById).filter(Boolean);
    const shown = compact ? ks.slice(0, 2) : ks;
    fill(box,
      shown.map(k => kpiChip(k, { small: compact, onRemove: editable && !compact ? () => setIds(p.kpi_ids.filter(x => x !== k.id)) : null })),
      compact && ks.length > 2 ? h('span.kp-more', { title: ks.slice(2).map(k => `${k.letter} · ${k.name}`).join('\n') }, `+${ks.length - 2}`) : null,
      !ks.length && !editable ? h('span.muted.small', 'Nessun KPI collegato') : null,
      editable ? h('button.kp-add', { type: 'button', on: { click: () => openKpiPicker(p, setIds) } }, icon('plus', { size: 14 }), compact ? 'collega' : 'Collega un KPI') : null);
  }
  draw();
  return box;
}
// Elenco per scegliere: raggruppato per pillar, con ricerca per nome, lettera o owner.
function openKpiPicker(p, setIds) {
  let ids = [...p.kpi_ids];
  const search = h('input.kp-search', { type: 'search', placeholder: 'Cerca per nome, lettera o owner', 'aria-label': 'Cerca un KPI' });
  const list = h('div.kp-list');
  const count = h('span.muted.small');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    count.textContent = `${ids.length} ${ids.length === 1 ? 'scelto' : 'scelti'}`;
    const groups = D.pillars.map(pl => ({ pl, ks: D.kpis.filter(k => k.pillar_id === pl.id && (!q || `${k.letter} ${k.name} ${k.owner}`.toLowerCase().includes(q))) }))
      .concat([{ pl: null, ks: D.kpis.filter(k => !pillarOf(k) && (!q || `${k.letter} ${k.name} ${k.owner}`.toLowerCase().includes(q))) }]).filter(g => g.ks.length);
    fill(list, groups.length ? groups.map(({ pl, ks }) => [
      h('div.kp-group', h('i', { style: { background: pl?.color || '#BEBEBC' } }), pl?.name || 'Senza pillar'),
      ks.map(k => {
        const on = ids.includes(k.id), dep = projectsOnKpi(k), edge = pl?.color || '#BEBEBC';
        return h('button.kp-row', { type: 'button', 'aria-pressed': String(on), class: on ? 'on' : '', on: { click: async () => { ids = on ? ids.filter(x => x !== k.id) : [...ids, k.id]; draw(); await setIds(ids); } } },
          h('span.kp-box', on ? icon('check', { size: 12 }) : null),
          h('b.kp-letter', { style: { background: mix(edge, 0.8), borderColor: edge, color: '#2C2C2C' } }, k.letter),
          h('span.kp-rname', k.name), h('span.kp-rtarget', `target ${k.target}`), h('span.kp-rowner', k.owner || '—'),
          h('span.kp-rdep', { class: dep ? '' : 'muted' }, dep ? `${dep} ${dep === 1 ? 'progetto' : 'progetti'}` : 'ordinaria'));
      })]) : h('p.muted', { style: { padding: '16px' } }, `Nessun KPI con «${search.value}».`));
  };
  search.addEventListener('input', draw);
  const m = modal({
    title: 'Su quali KPI di livello 0 lavora questo progetto?', wide: true,
    body: h('div.kp-picker', h('div.row.spread', search, count), list),
    left: [h('span.muted.small', 'Il colore è quello del pillar. «ordinaria» = nessun progetto ci lavora ancora.')],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => m.close() } }, 'Fatto')],
  });
  draw();
  setTimeout(() => search.focus(), 0);
}
// Scheda del KPI al passaggio del mouse sulle letterine della vista Hoshin Kanri
let kpiTip = null;
function showKpiTip(el, k) {
  hideKpiTip();
  const pl = pillarOf(k), dep = projectsOnKpi(k), r = el.getBoundingClientRect();
  kpiTip = h('div.kp-tip', { role: 'tooltip' }, h('span.kp-tip-p', { style: { color: pl ? mix(pl.color, 0.45) : '#DCDCDA' } }, pl?.name || 'Senza pillar'),
    h('strong', `${k.letter} · ${k.name}`), h('span', `target ${k.target} · owner ${k.owner || '—'} · ${dep ? `${dep} ${dep === 1 ? 'progetto' : 'progetti'}` : 'gestione ordinaria'}`));
  document.body.append(kpiTip);
  const w = kpiTip.offsetWidth;
  kpiTip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  kpiTip.style.top = `${r.bottom + 8 + window.scrollY}px`;
}
function hideKpiTip() { kpiTip?.remove(); kpiTip = null; }

function spark(nums) {
  if (nums.length < 2) return h('span.muted', '—');
  const mx = Math.max(...nums), mn = Math.min(...nums);
  const d = nums.map((x, i) => `${i ? 'L' : 'M'}${(2 + i * 96 / 11).toFixed(1)},${(17 - (x - mn) / ((mx - mn) || 1) * 14).toFixed(1)}`).join(' ');
  return svgEl('svg', { width: 100, height: 20, viewBox: '0 0 100 20', 'aria-hidden': 'true' }, svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }));
}

// ═══ Gestione ═══════════════════════════════════════════════════════════════════════════════════
const GTABS = [['progetti', 'Progetti'], ['kpi', 'KPI di livello 0'], ['struttura', 'Pillar, True North e BU'], ['aree', 'Aree']];

function gestionePage(container, tabKey) {
  let tab = GTABS.some(([k]) => k === tabKey) ? tabKey : 'progetti';
  const body = h('div.hk-gbody');
  const tabs = h('div.hk-tabs');
  fill(container,
    head('Gestione', h('div.row', h('span.hk-saved#hk-saved'), h('a.btn', { href: '#/strategy/hoshin' }, icon('grid-3x3'), 'Vedi l’Hoshin Kanri'))),
    h('p.muted.hk-intro', 'Scrivi direttamente nelle celle: Tab passa alla cella dopo, ogni cella si salva da sola quando la lasci.'),
    tabs, body);
  const drawTabs = () => fill(tabs, GTABS.map(([k, l]) => h('button.hk-tab', { type: 'button', class: tab === k ? 'on' : '', on: { click: () => { tab = k; history.replaceState(null, '', `#/strategy/gestione/${k}`); drawTabs(); draw(); } } }, l,
    h('span.n', String(k === 'progetti' ? D.projects.length : k === 'kpi' ? D.kpis.length : k === 'aree' ? D.areas.length : D.pillars.length)))));
  const reload = async () => { await load(); drawTabs(); draw(); };
  // controllo che salva quando cambia
  const cell = (entity, row, field, { type = 'text', cls = '', parse = x => x, placeholder = '' } = {}) => h(`input.hk-in${cls ? `.${cls}` : ''}`, {
    type, value: row[field] ?? '', placeholder, 'aria-label': field,
    on: { change: e => save(entity, row, { [field]: parse(e.target.value) }).catch(() => { e.target.value = row[field] ?? ''; }) },
  });
  const choose = (entity, row, field, options, { parse = Number } = {}) => h('select.hk-in', {
    'aria-label': field, on: { change: e => save(entity, row, { [field]: e.target.value === '' ? null : parse(e.target.value) }).then(draw) },
  }, options.map(([val, label]) => h('option', { value: String(val ?? ''), selected: String(val ?? '') === String(row[field] ?? '') }, label)));
  const add = (label, fn) => h('button.hk-addrow', { type: 'button', on: { click: async () => { await fn(); await reload(); } } }, icon('plus', { size: 16 }), label);
  const remove = (entity, row, what) => h('button.hk-icon', { type: 'button', 'aria-label': `Elimina ${what}`, title: 'Elimina', on: { click: async () => {
    if (!await confirmDialog(`Eliminare ${what}?`, { ok: 'Elimina', danger: true })) return;
    await del(`/api/strategy/${entity}/${row.id}`); await reload();
  } } }, icon('trash', { size: 16 }));

  function draw() {
    if (tab === 'progetti') {
      const areas = orderedAreas();
      fill(body, h('div.hk-gcard', h('table.hk-grid',
        h('thead', h('tr', ['Progetto', 'Area', 'Owner', 'KPI collegati', 'Target', 'Contromisure', 'Avanzamento', ''].map(t => h('th', t)))),
        h('tbody', areas.flatMap(a => projectsOf(a.id)).concat(D.projects.filter(p => !p.area_id || !areas.some(a => a.id === p.area_id))).map(p => {
          const st = progressAt(p, D.today);
          const sum = p.tasks.reduce((s, t) => s + t.weight, 0);
          return h('tr',
            h('td', { style: { minWidth: '260px' } }, cell('projects', p, 'name', { cls: 'strong' })),
            h('td', choose('projects', p, 'area_id', [['', '—'], ...areas.map(x => [x.id, `${funcById(x.function_id)?.name || ''} · ${areaLabel(x)}`])])),
            h('td', cell('projects', p, 'owner')),
            h('td', { style: { minWidth: '280px' } }, kpiField(p, { compact: true, editable: D.can_admin, onChange: draw })),
            h('td', { style: { minWidth: '200px' } }, cell('projects', p, 'target')),
            h('td', h('a.hk-link', { href: `#/strategy/a3/${p.id}` }, `${p.tasks.length} · pesi ${sum}%`)),
            h('td', h('span.hk-status', { class: st.ok ? 'ok' : 'ko' }, `${st.act}% / ${st.exp}%`)),
            h('td.hk-actions', h('a.hk-icon', { href: `#/strategy/a3/${p.id}`, title: 'Apri l’A3', 'aria-label': 'Apri l’A3' }, icon('file-text', { size: 16 })), remove('projects', p, `il progetto «${p.name}»`)));
        }))),
      add('Nuovo progetto', () => post('/api/strategy/projects', { year: YEAR, area_id: areas[0]?.id ?? null }))));
    } else if (tab === 'kpi') {
      fill(body, h('div.hk-gcard', h('table.hk-grid',
        h('thead', h('tr', ['Rif.', 'Pillar', 'KPI', 'Owner', 'Target', ...MONTHS, ''].map(t => h('th', t)))),
        h('tbody', D.kpis.map(k => h('tr',
          h('td', { style: { width: '54px' } }, cell('kpis', k, 'letter', { cls: 'center' })),
          h('td', choose('kpis', k, 'pillar_id', [['', '—'], ...D.pillars.map(p => [p.id, p.name])])),
          h('td', { style: { minWidth: '240px' } }, cell('kpis', k, 'name', { cls: 'strong' })),
          h('td', cell('kpis', k, 'owner')),
          h('td', cell('kpis', k, 'target')),
          MONTHS.map((m, i) => h('td.num', h('input.hk-in.center', { value: (k.monthly || [])[i] || '', 'aria-label': `${k.name}, ${m}`, placeholder: '·',
            on: { change: e => { const arr = Array.from({ length: 12 }, (_, j) => (k.monthly || [])[j] || ''); arr[i] = e.target.value.trim(); save('kpis', k, { monthly: arr }); } } }))),
          h('td.hk-actions', remove('kpis', k, `il KPI «${k.letter} · ${k.name}»`)))))),
      add('Nuovo KPI', () => post('/api/strategy/kpis', { year: YEAR, pillar_id: D.pillars[0]?.id ?? null, letter: nextLetter() }))));
    } else if (tab === 'struttura') {
      const tn = h('textarea.hk-in.hk-tn-in', { rows: 3, 'aria-label': 'True North', on: { change: async e => { await patch('/api/strategy/year', { year: YEAR, true_north: e.target.value }); D.true_north = e.target.value; flashSaved(); } } }, D.true_north);
      fill(body, h('div.hk-gcols',
        h('div.hk-gcard', h('h3', 'Ambition · True North'), tn,
          h('h3', 'Pillar aziendali (da 3 a 5)'),
          D.pillars.map(p => h('div.hk-prow-edit',
            h('input.hk-color', { type: 'color', value: p.color, 'aria-label': 'Colore', on: { change: e => save('pillars', p, { color: e.target.value }) } }),
            h('div.grow', cell('pillars', p, 'name', { cls: 'strong' }), cell('pillars', p, 'description', { placeholder: 'Descrizione breve' })),
            remove('pillars', p, `il pillar «${p.name}»`))),
          D.pillars.length < 5 ? add('Nuovo pillar', () => post('/api/strategy/pillars', { year: YEAR })) : h('p.muted', 'Massimo 5 pillar.')),
        h('div.hk-gcard', h('h3', 'BU e funzioni · sponsor e colore'),
          D.functions.map(f => h('div.hk-prow-edit',
            h('input.hk-color', { type: 'color', value: f.color, 'aria-label': 'Colore', on: { change: e => save('functions', f, { color: e.target.value }) } }),
            h('div.grow', cell('functions', f, 'name', { cls: 'strong' })),
            h('div', { style: { width: '160px' } }, cell('functions', f, 'sponsor', { placeholder: 'Sponsor' })),
            h('div', { style: { width: '150px' } }, choose('functions', f, 'kind', [['staff', 'Funzione di staff'], ['bu', 'Business unit']], { parse: x => x })),
            remove('functions', f, `«${f.name}» con le sue aree`))),
          add('Nuova BU o funzione', () => post('/api/strategy/functions', { year: YEAR })))));
    } else {
      // macro aree e sotto aree, BU per BU (canvas 11/11): i progetti stanno sulla sotto area o, se non ce ne sono, sulla macro area
      const colors = areaColors();
      const move = (a, dir) => async () => {
        const same = (a.parent_id ? childrenOf(a.parent_id) : orderedMacros().filter(x => x.function_id === a.function_id));
        const i = same.indexOf(a), other = same[i + dir];
        if (!other) return;
        const [pa, pb] = [a.position, other.position === a.position ? a.position + dir : other.position];
        await Promise.all([save('areas', a, { position: pb }), save('areas', other, { position: pa })]);
        draw();
      };
      const arrows = a => h('div.row', h('button.hk-icon', { type: 'button', 'aria-label': 'Sposta su', on: { click: move(a, -1) } }, '↑'), h('button.hk-icon', { type: 'button', 'aria-label': 'Sposta giù', on: { click: move(a, 1) } }, '↓'));
      const nProj = id => D.projects.filter(p => inArea(p, id)).length;
      const addSub = m => h('button.hk-link-btn', { type: 'button', on: { click: async () => {
        const n = D.projects.filter(p => p.area_id === m.id).length;
        if (!childrenOf(m.id).length && n && !await confirmDialog(`«${m.name}» ha ${n === 1 ? '1 progetto' : `${n} progetti`}: passeranno alla nuova sotto area (poi puoi spostarli).`, { ok: 'Aggiungi la sotto area' })) return;
        const r = await post('/api/strategy/areas', { year: YEAR, parent_id: m.id });
        if (r.moved) toast(`${r.moved === 1 ? '1 progetto spostato' : `${r.moved} progetti spostati`} nella nuova sotto area`);
        await reload();
      } } }, '+ Sotto area');
      const funcs = [...D.functions].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === 'staff' ? -1 : 1));
      fill(body, h('div.hk-areas',
        h('p.muted', 'Ogni BU o funzione ha le sue macro aree; una macro area può avere sotto aree. I progetti vanno su una sotto area oppure, se la macro area non ne ha, direttamente sulla macro area. L’ordine è quello delle colonne dell’Hoshin Kanri.'),
        funcs.map(f => h('section.hk-gcard.hk-afunc',
          h('div.hk-afunc-h', h('span.row', h('span.hk-swatch', { style: { background: f.color } }), h('strong', f.name), f.sponsor ? h('span.muted.small', `sponsor ${f.sponsor}`) : null),
            add('Macro area', () => post('/api/strategy/areas', { year: YEAR, function_id: f.id, name: 'Nuova macro area' }))),
          orderedMacros().filter(m => m.function_id === f.id).map(m => {
            const kids = childrenOf(m.id);
            return h('div.hk-amacro',
              h('div.hk-arow.macro',
                arrows(m),
                h('div.hk-aname', h('span.hk-akind', kids.length ? 'Macro area' : 'Macro area · senza sotto aree'), h('div.row', kids.length ? null : h('span.hk-swatch', { style: { background: colors[m.id] } }), cell('areas', m, 'name', { cls: 'strong' }))),
                h('div.hk-asp', cell('areas', m, 'sponsor', { placeholder: 'Sponsor' })),
                h('div.hk-afn', choose('areas', m, 'function_id', D.functions.map(x => [x.id, x.name]))),
                h('span.muted.small.hk-an', nProj(m.id) === 1 ? '1 progetto' : `${nProj(m.id)} progetti`),
                h('div.hk-actions', addSub(m), remove('areas', m, kids.length ? `la macro area «${m.name}» con le sue sotto aree` : `la macro area «${m.name}»`))),
              kids.map(a => h('div.hk-arow.sub',
                arrows(a),
                h('div.hk-aname', h('div.row', h('span.hk-atree', { 'aria-hidden': 'true' }, '└'), h('span.hk-swatch', { style: { background: colors[a.id] } }), cell('areas', a, 'name'))),
                h('div.hk-asp', cell('areas', a, 'sponsor', { placeholder: 'Sponsor' })),
                h('div.hk-afn'),
                h('span.muted.small.hk-an', nProj(a.id) === 1 ? '1 progetto' : `${nProj(a.id)} progetti`),
                h('div.hk-actions', remove('areas', a, `la sotto area «${a.name}»`)))));
          })))));
    }
  }
  drawTabs();
  draw();
  // chi non è amministratore vede la Gestione in sola lettura (i suoi A3 li modifica dalla loro pagina)
  if (!D.can_admin) {
    container.querySelector('.hk-intro').replaceWith(h('p.hk-ro-note', icon('key-round', { size: 16 }), 'Sola lettura: la struttura dell’Hoshin Kanri la modificano gli amministratori. I tuoi A3 li modifichi dalla loro pagina.'));
    const lock = () => { body.classList.add('hk-ro'); body.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; }); };
    lock();
    new MutationObserver(lock).observe(body, { childList: true });
  }
}
function nextLetter() {
  const used = new Set(D.kpis.map(k => k.letter));
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(l => !used.has(l)) || '';
}

// ═══ A3 ═════════════════════════════════════════════════════════════════════════════════════════
// A3 dei progetti: prima le funzioni (staff e BU) con i loro numeri, poi con un clic gli A3 di quella funzione,
// filtrabili per area. La scelta resta nell'indirizzo (#/strategy/a3?f=…&a=…), così «indietro» funziona.
const progressBar = (act, exp) => h('span.hk-bar', h('span', { class: act >= exp ? 'ok' : 'ko', style: { width: `${act}%` } }), h('i', { style: { left: `${exp}%` } }));
function funcStats(f) {
  const ps = D.projects.filter(p => areaById(p.area_id)?.function_id === f.id);
  const st = ps.map(p => progressAt(p, D.today));
  const avg = key => (st.length ? Math.round(st.reduce((s, x) => s + x[key], 0) / st.length) : 0);
  return { ps, n: ps.length, ok: st.filter(x => x.ok).length, act: avg('act'), exp: avg('exp') };
}
function a3List(container) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const sel = D.functions.find(f => f.id === Number(params.get('f')));
  const areaSel = Number(params.get('a')) || null;
  const go = (f, a) => { location.hash = `#/strategy/a3${f ? `?f=${f}${a ? `&a=${a}` : ''}` : ''}`; };
  const colors = areaColors();
  const card = f => {
    const s = funcStats(f);
    return h('button.a3f-card', { type: 'button', class: s.n ? '' : 'empty', style: { borderTopColor: f.color }, on: { click: () => go(f.id) } },
      h('span.a3f-top', h('strong', f.name), h('span.a3f-n', String(s.n))),
      h('span.a3f-sub', `sponsor ${f.sponsor || '—'} · ${s.n === 1 ? '1 A3' : `${s.n} A3`}`),
      h('span.a3f-pills', h('span.hk-status.ok', `${s.ok} in linea`), h('span.hk-status', { class: s.n - s.ok ? 'ko' : 'muted' }, `${s.n - s.ok} in ritardo`)),
      h('span.hk-prog', progressBar(s.act, s.exp), s.n ? `${s.act}% / ${s.exp}%` : '—'));
  };
  const crumb = h('nav.a3f-crumb', { 'aria-label': 'Percorso' },
    sel ? h('a', { href: '#/strategy/a3' }, 'Tutte le funzioni') : h('b', 'Tutte le funzioni'),
    sel ? [h('span', '/'), h('b', sel.name)] : null);
  if (!sel) {
    const kind = k => D.functions.filter(f => f.kind === k).sort((a, b) => a.position - b.position);
    return fill(container, head('A3 dei progetti', D.can_admin ? h('a.btn', { href: '#/strategy/gestione' }, icon('plus'), 'Nuovo progetto') : null), crumb,
      h('div.a3f-label', 'Funzioni di staff'), h('div.a3f-grid', kind('staff').map(card)),
      h('div.a3f-label', 'Business unit'), h('div.a3f-grid', kind('bu').map(card)),
      yearEnding() && D.projects.some(undecided) ? h('section.hk-card.hk-carry-list',
        h('strong', `Fine ${YEAR}: ${D.projects.filter(undecided).length} A3 da decidere`), h('span.muted.small', 'Per ognuno: si chiude, prosegue fuori dall’Hoshin Kanri o entra nel nuovo anno. Si decide dalla pagina dell’A3.'),
        h('div.hk-carry-links', D.projects.filter(undecided).map(p => h('a.pill', { href: `#/strategy/a3/${p.id}` }, p.name)))) : null,
      D.outside?.length ? [h('div.a3f-label', `Proseguono nel ${YEAR} fuori dall’Hoshin Kanri`),
        h('div.hk-carry-links', D.outside.map(p => h('a.pill', { href: `#/strategy/a3/${p.id}?y=${p.year}` }, `${p.name} · ${p.owner || ''}`)))] : null,
      h('p.muted.small', 'La barra è l’avanzamento medio degli A3 della funzione, la tacca l’atteso a oggi. Le funzioni senza A3 sono sbiadite.'));
  }
  const s = funcStats(sel);
  const areas = orderedMacros().filter(a => a.function_id === sel.id);
  const list = s.ps.filter(p => !areaSel || inArea(p, areaSel));
  fill(container, head(`A3 · ${sel.name}`, D.can_admin ? h('a.btn', { href: '#/strategy/gestione' }, icon('plus'), 'Nuovo progetto') : null), crumb,
    h('div.row.wrap.a3f-areas', [{ id: null, name: 'Tutte le aree' }, ...areas].map(a => {
      const n = a.id ? s.ps.filter(p => inArea(p, a.id)).length : s.n;
      return h('button.hk-chip', { type: 'button', class: areaSel === a.id ? 'on' : '', 'aria-pressed': String(areaSel === a.id), on: { click: () => go(sel.id, a.id) } }, a.name, h('span.a3f-cn', ` ${n}`));
    })),
    list.length ? h('div.hk-a3grid', list.map(p => {
      const st = progressAt(p, D.today), a = areaById(p.area_id);
      return h('a.hk-a3card', { href: `#/strategy/a3/${p.id}`, style: { borderTopColor: colors[a?.id] } },
        h('span.hk-eyebrow', areaLabel(a)), h('strong', p.name), h('span.muted', p.owner),
        h('div.kp-chips', p.kpi_ids.map(kid => kpiChip(kpiById(kid), { small: true }))),
        h('span.hk-prog', progressBar(st.act, st.exp), `${st.act}% / ${st.exp}%`));
    })) : h('div.card.empty', 'Nessun A3 per questa funzione.'));
}

// ═══ Dashboard degli A3: tutto calcolato dalle contromisure ════════════════════════════════════════
function dashboardPage(container) {
  let fsel = null;
  const today = D.today, todayD = new Date(`${today}T00:00:00Z`);
  const in30 = new Date(todayD.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const funcOfP = p => funcById(areaById(p.area_id)?.function_id);
  const st = new Map(D.projects.map(p => [p.id, progressAt(p, today)]));
  const body = h('div');
  fill(container, head('Dashboard degli A3', h('span.muted.small', 'Calcolata dalle contromisure degli A3')), body);
  function draw() {
    const ps = D.projects.filter(p => !fsel || funcOfP(p)?.id === fsel);
    const avg = key => (ps.length ? Math.round(ps.reduce((s, p) => s + st.get(p.id)[key], 0) / ps.length) : 0);
    const ok = ps.filter(p => st.get(p.id).ok).length;
    const tasks = ps.flatMap(p => p.tasks.map(t => ({ ...t, p })));
    const overdue = tasks.filter(t => !t.closed_date && t.due_date && t.due_date < today);
    const soon = tasks.filter(t => !t.closed_date && t.due_date && t.due_date >= today && t.due_date <= in30);
    const lateClosed = tasks.filter(t => t.closed_date && t.due_date && t.closed_date > t.due_date).length;
    const badWeights = ps.filter(p => p.tasks.reduce((s, t) => s + t.weight, 0) !== 100).length;
    const covered = D.kpis.filter(k => ps.some(p => p.kpi_ids.includes(k.id))).length;
    const stat = (label, value, cls) => h('div.hk-stat', h('span', label), h('strong', { class: cls || '' }, value));
    // per funzione
    const funcs = D.functions.map(f => ({ f, s: funcStats(f) })).filter(x => x.s.n);
    // andamento dell'anno: media di reale e atteso a fine mese
    const months = Array.from({ length: 12 }, (_, m) => monthEnd(YEAR, m));
    const series = months.map(end => {
      const at = end > today ? today : end;
      return { act: ps.length ? ps.reduce((s, p) => s + progressAt(p, at).act, 0) / ps.length : 0, exp: ps.length ? ps.reduce((s, p) => s + progressAt(p, end).exp, 0) / ps.length : 0, past: end <= today || end.slice(0, 7) === today.slice(0, 7) };
    });
    const W = 720, H = 150, x = i => 30 + i * (W - 50) / 11, y = v => H - 18 - v / 100 * (H - 34);
    const line = pts => pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
    const actPts = series.map((s2, i) => [x(i), y(s2.act), s2.past]).filter(pt => pt[2]);
    const chart = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Avanzamento medio mese per mese, reale e atteso' },
      ...[0, 50, 100].map(v => svgEl('path', { d: `M30,${y(v)} H${W - 20}`, stroke: v ? '#F1F0EC' : '#DCDCDA' })),
      svgEl('path', { d: line(series.map((s2, i) => [x(i), y(s2.exp)])), fill: 'none', stroke: '#8A8A8A', 'stroke-width': 2, 'stroke-dasharray': '5 4' }),
      actPts.length ? svgEl('path', { d: line(actPts), fill: 'none', stroke: '#FF8A26', 'stroke-width': 3 }) : svgEl('g'),
      ...MONTHS.map((m, i) => svgEl('text', { x: x(i) - 8, y: H - 2, 'font-size': 10, fill: '#6B6B6B' }, m)));
    const late = ps.map(p => ({ p, s: st.get(p.id) })).filter(x => !x.s.ok).sort((a, b) => (b.s.exp - b.s.act) - (a.s.exp - a.s.act)).slice(0, 6);
    const due = [...overdue, ...soon].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);
    fill(body,
      h('div.hk-stats.pm-tiles', stat('A3 attivi', String(ps.length)), stat('In linea con il piano', `${ok}${ps.length ? ` · ${Math.round(ok / ps.length * 100)}%` : ''}`, 'ok'),
        stat('Avanzamento medio', `${avg('act')}% su ${avg('exp')}% atteso`), stat('Contromisure scadute e aperte', String(overdue.length), overdue.length ? 'ko' : ''),
        stat('In scadenza nei prossimi 30 giorni', String(soon.length))),
      h('div.a3d-grid',
        h('section.hk-card',
          h('div.row.spread', h('h2.pm-h', 'Avanzamento per funzione'), fsel ? h('button.btn.btn-ghost', { type: 'button', on: { click: () => { fsel = null; draw(); } } }, 'Tutte le funzioni') : h('span.muted.small', 'clicca una funzione per filtrare')),
          funcs.map(({ f, s }) => h('button.a3d-func', { type: 'button', class: fsel === f.id ? 'on' : '', on: { click: () => { fsel = fsel === f.id ? null : f.id; draw(); } } },
            h('span.a3d-fn', h('i', { style: { background: f.color } }), f.name), h('span.a3d-bar', progressBar(s.act, s.exp)),
            h('b', { class: s.act >= s.exp ? 'ok' : 'ko' }, `${s.act}%`, h('small', ` / ${s.exp}`)), h('span.muted.small', `${s.n} A3`))),
          h('h3.a3d-h3', 'Andamento dell’anno · media degli A3', fsel ? ` di ${funcById(fsel).name}` : ''),
          chart,
          h('div.a3d-legend', h('span', h('i.act'), 'reale'), h('span', h('i.exp'), 'atteso'))),
        h('div.a3d-side',
          h('section.hk-card', h('h2.pm-h', 'A3 più indietro'),
            late.length ? late.map(x => h('a.a3d-line', { href: `#/strategy/a3/${x.p.id}` }, h('span', h('strong', x.p.name), h('small', `${funcOfP(x.p)?.name || ''} · ${x.p.owner}`)), h('span.hk-status.ko', `−${x.s.exp - x.s.act} punti`)))
              : h('p.muted', 'Tutti gli A3 sono in linea.')),
          h('section.hk-card', h('h2.pm-h', 'Contromisure in scadenza'),
            due.length ? due.map(t => h('a.a3d-line.due', { href: `#/strategy/a3/${t.p.id}` }, h('span.a3d-date', { class: t.due_date < today ? 'ko' : '' }, t.due_date < today ? 'scaduta' : itDate(t.due_date).slice(0, 5)),
              h('span', h('span', t.activity), h('small', t.p.name)))) : h('p.muted', 'Niente in scadenza nei prossimi 30 giorni.')),
          h('section.hk-card.a3d-mini', h('div', h('span', 'KPI coperti da A3'), h('b', `${covered} su ${D.kpis.length}`)), h('div', h('span', 'Chiuse in ritardo'), h('b', String(lateClosed))), h('div', h('span', 'Pesi non a 100%'), h('b', { class: badWeights ? 'ko' : '' }, String(badWeights)))))));
  }
  draw();
}

// L'A3 è la scheda di un progetto di Alma Planner (come un'opportunità di Alma Energy): il tab «A3» con il format
// Almacis, e poi Gantt, Ticket (le contromisure), Documenti, Email, Incontri, Note e Membri del progetto.
async function a3Page(container, id) {
  let p = D.projects.find(x => x.id === id);
  if (!p) return fill(container, h('div.card.empty', 'A3 non trovato. ', h('a', { href: '#/strategy/a3' }, 'Torna agli A3')));
  if (!p.project_id && p.can_edit) {
    // la prima volta: il progetto e un ticket per contromisura (lo crea chi può lavorare sull'A3)
    await post(`/api/strategy/projects/${p.id}/link`);
    await load();
    p = D.projects.find(x => x.id === id);
  }
  const area = areaById(p.area_id), func = area ? funcById(area.function_id) : null;
  // chi non è nel progetto vede l'A3 da solo, in sola lettura (il progetto e i suoi ticket sono del team)
  if (!p.project_visible) {
    const box = h('div.pj-pane');
    fill(container, h('div.pj',
      h('header.pj-head', { style: { '--c': func?.color || '#8A8A8A' } },
        h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: '#/strategy/hoshin' }, icon('chevron-left', { size: 16 }), 'Hoshin Kanri')),
        h('div.pj-row', h('div.pj-title', h('div.pj-name', h('span.pj-swatch'), h('h1', p.name)), h('div.pj-meta', `Proprietario ${p.owner || '—'}  ·  ${area?.name || ''}`)),
          h('div.pj-actions', h('button.btn', { type: 'button', on: { click: () => window.print() } }, icon('file-text', { size: 16 }), 'Esporta A3 in PDF'))),
        a3Strip(p, func)),
      h('div.pj-content', box)));
    return a3Tab(box, p, () => a3Page(container, id));
  }
  return projectDetail(container, p.project_id, {
    base: `#/strategy/a3/${p.id}`,
    crumb: { href: '#/strategy/hoshin', label: 'Hoshin Kanri' },
    defaultTab: 'a3',
    head: [carryBox(p, () => a3Page(container, id)), a3Strip(p, func)],
    actions: () => [
      p.can_edit ? null : h('span.pill', { title: 'Per modificare l’A3, i ticket o il Gantt chiedi al responsabile di aggiungerti al progetto' }, 'Sola lettura'),
      h('button.btn', { type: 'button', on: { click: () => window.print() } }, icon('file-text', { size: 16 }), 'Esporta A3 in PDF')],
    membersActions: p.can_edit ? reload => [
      h('button.btn', { type: 'button', on: { click: () => addMembers(p, reload) } }, icon('plus', { size: 16 }), 'Aggiungi un membro'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => openInvite(p, reload) } }, icon('mail', { size: 16 }), 'Chiedi di partecipare')] : null,
    extraTabs: [['a3', 'A3', (box, reload) => a3Tab(box, p, reload)], ['calendario', 'Calendario', box => a3Calendar(box, { id: p.project_id, name: p.name, my_role: p.can_edit ? 'member' : 'viewer' }, { color: func?.color || '#FF8A26' })]],
  });
}

// La richiesta di partecipare a un A3, dalla email o dalla notifica: si legge l'A3 e si risponde sì o no.
async function invitePage(container, id) {
  fill(container, loading());
  let d;
  try { d = await get(`/api/strategy/invites/${id}`); } catch { return fill(container, h('div.card.empty', 'Richiesta non trovata.')); }
  const { invite: i, a3, func } = d;
  const color = func?.color || '#FF8A26';
  const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('r');
  const reply = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: pre === 'no' ? 'Se vuoi, spiega perché (lo legge chi ti ha invitato)' : 'Due righe per chi ti ha invitato (facoltative)' });
  const answer = accept => async () => {
    const r = await post(`/api/strategy/invites/${id}/answer`, { accept, reply: reply.value.trim() });
    toast(accept ? 'Benvenuto nel team!' : 'Risposta mandata');
    if (r.status === 'accepted') location.hash = `#/strategy/a3/${r.a3_id}`; else invitePage(container, id);
  };
  const done = i.done = i.status !== 'pending';
  const tasks = a3.tasks || [];
  fill(container, h('div.a3r',
    h('section.a3r-card',
      h('div.a3r-band', { style: { background: color } },
        h('span.a3r-k', 'Alma Strategy · richiesta di partecipare'),
        h('h1', i.mine ? (done ? (i.status === 'accepted' ? 'Sei nel team di questo A3' : 'Hai risposto di no') : `${i.invited_by_name || 'Un collega'} ti chiede di entrare nel team`) : `Richiesta a ${i.user_name}`)),
      h('div.a3r-body',
        h('span.a3r-func', [func?.name, d.area].filter(Boolean).join(' · ')),
        h('h2', a3.name),
        h('span.muted.small', `Proprietario ${a3.owner || '—'} · team ${a3.team || '—'}`),
        i.note ? h('div.a3r-note', h('span.a3r-av', avatar(userById(i.invited_by) || { name: i.invited_by_name || '?' }, 40)), h('div', h('p', i.note), h('small', `— ${i.invited_by_name || ''}`))) : null,
        a3.target_conditions ? h('div.a3r-target', h('span.hk-lbl', 'Dove vogliamo arrivare'), h('p', a3.target_conditions)) : null,
        tasks.length ? h('div.a3r-tasks', h('span.hk-lbl', `Contromisure · ${tasks.filter(t => t.closed_date).length} chiuse su ${tasks.length}`),
          tasks.slice(0, 6).map((t, n) => h('div.a3r-task', h('b', { style: { color } }, String(n + 1)), h('span', t.activity), h('small.muted', t.due_date ? itDate(t.due_date) : '')))) : null,
        i.mine && !done ? h('div.a3r-answer',
          h('label.field', h('span', 'La tua risposta'), reply),
          h('div.a3r-btns',
            h('button.btn.a3r-yes', { type: 'button', on: { click: answer(true) } }, icon('check', { size: 16 }), 'Sì, partecipo'),
            h('button.btn', { type: 'button', on: { click: answer(false) } }, 'No, grazie')),
          h('small.muted', 'Se accetti entri nel team del progetto: ticket, Gantt, incontri e note dell’A3.')) : null,
        done ? h('div.a3r-done', { class: i.status },
          i.status === 'accepted' ? [icon('check', { size: 16 }), ` Accettata il ${itDate(String(i.answered_at).slice(0, 10))}`] : `Rifiutata il ${itDate(String(i.answered_at).slice(0, 10))}`,
          i.reply ? h('span', ` · «${i.reply}»`) : null) : null,
        !i.mine && !done ? h('div.a3r-done', 'In attesa di risposta') : null,
        h('a.small', { href: `#/strategy/a3/${a3.id}?y=${a3.year}` }, 'Apri l’A3 →')))));
  if (pre === 'si' && i.mine && !done) reply.focus();
}

// Aggiungere colleghi al team dell'A3 subito, senza chiedere (ricevono solo una notifica).
function addMembers(p, onDone) {
  const chosen = new Set();
  const search = h('input.input', { type: 'search', placeholder: 'Cerca un collega', 'aria-label': 'Cerca un collega' });
  const list = h('div.a3i-list');
  const others = store.users.filter(u => u.active !== false && u.id !== store.me.id);
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    fill(list, others.filter(u => !q || u.name.toLowerCase().includes(q)).slice(0, 40).map(u => h('label.a3i-person', { class: chosen.has(u.id) ? 'on' : '' },
      h('input', { type: 'checkbox', checked: chosen.has(u.id), on: { change: e => { e.target.checked ? chosen.add(u.id) : chosen.delete(u.id); draw(); } } }),
      avatar(u, 28), h('span', h('strong', u.name), u.job_title ? h('small', u.job_title) : null))));
  };
  search.addEventListener('input', draw);
  draw();
  const m = modal({
    title: `Aggiungi al team dell’A3 «${p.name}»`,
    body: [h('p.muted.small', 'Entrano subito nel team (ticket, Gantt, incontri) e ricevono una notifica. Per chiedere prima se vogliono partecipare usa «Chiedi di partecipare».'), search, list],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!chosen.size) { toast('Scegli almeno una persona', 'err'); return; }
        const r = await post(`/api/strategy/projects/${p.id}/members`, { user_ids: [...chosen] });
        m.close();
        toast(r.added === 1 ? '1 persona aggiunta al team' : `${r.added} persone aggiunte al team`);
        await load(); onDone?.();
      } } }, 'Aggiungi')],
  });
}

// Invitare colleghi nell'A3: entrano nel team e ricevono una email allegra con l'A3 e la nota di chi invita.
async function openInvite(p, onDone) {
  const chosen = new Set();
  const others = store.users.filter(u => u.active !== false && u.id !== store.me.id);
  const search = h('input.input', { type: 'search', placeholder: 'Cerca un collega', 'aria-label': 'Cerca un collega' });
  const list = h('div.a3i-list');
  const chips = h('div.a3i-chips');
  const note = h('textarea.input', { rows: 4, maxlength: 2000, placeholder: 'Perché vorresti proprio questa persona nel team? Due righe per convincerla: finiscono nella email.' });
  const past = h('div.a3i-past');
  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    fill(list, others.filter(u => !q || u.name.toLowerCase().includes(q)).slice(0, 40).map(u => h('label.a3i-person', { class: chosen.has(u.id) ? 'on' : '' },
      h('input', { type: 'checkbox', checked: chosen.has(u.id), on: { change: e => { e.target.checked ? chosen.add(u.id) : chosen.delete(u.id); drawList(); drawChips(); } } }),
      avatar(u, 28), h('span', h('strong', u.name), u.job_title ? h('small', u.job_title) : null))));
  };
  const drawChips = () => fill(chips, chosen.size ? [...chosen].map(id => h('span.pill.a3i-chip', userById(id)?.name || '', h('button', { type: 'button', 'aria-label': 'Togli', on: { click: () => { chosen.delete(id); drawList(); drawChips(); } } }, '×'))) : h('span.muted.small', 'Nessuno scelto'));
  search.addEventListener('input', drawList);
  drawList(); drawChips();
  get(`/api/strategy/projects/${p.id}/invites`, { quiet: true }).then(rows => {
    if (rows?.length) fill(past, h('div.hk-lbl', 'Richieste già mandate'), rows.slice(0, 8).map(r => h('div.a3i-pastrow', h('span', `${r.name} · da ${r.invited_by_name || '—'} il ${itDate(String(r.created_at).slice(0, 10))}`),
      h('span.pill', { class: `a3i-${r.status}`, title: r.reply || '' }, r.status === 'accepted' ? 'ha accettato' : r.status === 'declined' ? 'ha detto di no' : 'in attesa'))));
  }).catch(() => {});
  const preview = async () => {
    const r = await post(`/api/strategy/projects/${p.id}/invite/preview`, { note: note.value, user_id: [...chosen][0] || null });
    const frame = h('iframe.a3i-frame', { title: 'Anteprima della email', sandbox: 'allow-same-origin' }); // niente script nella email
    frame.srcdoc = r.html;
    const pm = modal({ title: r.subject, wide: true, body: frame, actions: [h('button.btn', { type: 'button', on: { click: () => pm.close() } }, 'Chiudi')] });
  };
  const m = modal({
    title: `Chiedi di partecipare all’A3 «${p.name}»`,
    wide: true,
    body: [h('div.a3i-grid',
      h('div', h('div.hk-lbl', 'Chi vuoi nel team'), search, list),
      h('div', h('div.hk-lbl', 'Invitati'), chips, h('label.field', h('span', 'La tua nota per convincerli (facoltativa)'), note),
        h('p.muted.small', 'Ricevono dalla tua casella una richiesta con l’A3 e la tua nota: entrano nel team (ticket, Gantt, incontri) solo se accettano. Ti arriva una notifica con la risposta.'), past))],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn', { type: 'button', on: { click: preview } }, 'Anteprima email'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!chosen.size) { toast('Scegli almeno una persona', 'err'); return; }
        const r = await post(`/api/strategy/projects/${p.id}/invite`, { user_ids: [...chosen], note: note.value.trim() });
        m.close();
        toast(r.invited ? `Richiesta mandata a ${r.invited === 1 ? '1 persona' : `${r.invited} persone`}${r.already ? ` · ${r.already} già nel team o in attesa` : ''}` : 'Sono già tutti nel team o hanno già una richiesta in attesa');
        await load(); onDone?.();
      } } }, icon('mail', { size: 16 }), 'Chiedi di partecipare')],
  });
}

// Fine anno: chiudere l'A3, farlo proseguire fuori dall'Hoshin Kanri dell'anno dopo, o farlo entrare nell'anno dopo.
function carryBox(p, reload) {
  const decide = decision => async () => {
    const r = await post(`/api/strategy/projects/${p.id}/carry`, { decision });
    toast(decision === 'inserito' ? `L’A3 è nell’Hoshin Kanri ${YEAR + 1}${r.area_found === false ? ': scegli la sua area' : ''}` : decision === 'annulla' ? 'Decisione annullata' : 'Decisione salvata');
    await load(); reload();
  };
  const undo = p.can_edit ? h('button.link-btn.small', { type: 'button', on: { click: decide('annulla') } }, 'annulla') : null;
  const from = p.from_year ? h('span.hk-carry-from', icon('arrows', { size: 14 }), `Arriva dall’Hoshin Kanri ${p.from_year}`) : null;
  if (p.carry === 'inserito') return h('div.hk-carry.done', icon('check', { size: 16 }), h('span', `Prosegue nell’Hoshin Kanri ${YEAR + 1}`), p.next_id ? h('a', { href: `#/strategy/a3/${p.next_id}?y=${YEAR + 1}` }, 'Aprilo →') : null);
  if (p.carry === 'fuori') return h('div.hk-carry.done', icon('arrows', { size: 16 }), h('span', `Prosegue nel ${YEAR + 1} fuori dall’Hoshin Kanri`), undo);
  if (p.carry === 'chiuso') return h('div.hk-carry.done', icon('check', { size: 16 }), h('span', `Chiuso a fine ${YEAR}`), undo);
  if (!p.can_edit || !undecided(p) || !yearEnding()) return from;
  const open = p.tasks.filter(t => !t.closed_date).length;
  const choice = (cls, ic, title, text, decision, extra = {}) => h('button.hk-choice', { type: 'button', class: cls, on: { click: decide(decision) }, ...extra },
    h('span.hk-choice-ico', icon(ic, { size: 20 })), h('strong', title), h('span', text));
  return h('section.hk-carry.big',
    h('div.hk-carry-top', h('span.hk-carry-cal', icon('calendar', { size: 22 })),
      h('div', h('h2', `Fine ${YEAR}: come prosegue questo A3?`),
        h('span', `Un A3 può durare più anni.${p.tasks.length ? ` Restano aperte ${open} contromisure su ${p.tasks.length}:` : ''} scegli tu cosa succede dal 1° gennaio.`), from)),
    h('div.hk-choices',
      choice('ok', 'check', 'Chiudilo', `L’A3 si conclude nel ${YEAR}. Le contromisure aperte restano come sono, il progetto resta consultabile.`, 'chiuso'),
      choice('out', 'arrows', `Prosegue nel ${YEAR + 1}, fuori dall’Hoshin`, `Si continua a lavorarci, ma non entra nella X-Matrix ${YEAR + 1}. Lo trovi tra gli A3 che proseguono per conto loro.`, 'fuori'),
      choice('in', 'plus', `Entra nell’Hoshin Kanri ${YEAR + 1}`, D.next_year_exists ? `Lo stesso A3 passa nel ${YEAR + 1}, nella stessa funzione, con le stesse contromisure e gli stessi ticket.` : `Serve prima l’Hoshin Kanri ${YEAR + 1}: lo crea un amministratore dal selettore dell’anno.`, 'inserito')));
}

// Riga dell'A3 nell'intestazione del progetto: avanzamento pesato sulle contromisure, stato, KPI, prossima scadenza.
function a3Strip(p, func) {
  const st = progressAt(p, D.today);
  const open = p.tasks.filter(t => !t.closed_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const r = 22, c = 2 * Math.PI * r;
  const ring = svgEl('svg', { width: 56, height: 56, viewBox: '0 0 56 56', role: 'img', 'aria-label': `Avanzamento A3 ${st.act} per cento` },
    svgEl('circle', { cx: 28, cy: 28, r, fill: 'none', stroke: '#F1F0EC', 'stroke-width': 6 }),
    svgEl('circle', { cx: 28, cy: 28, r, fill: 'none', stroke: st.ok ? '#4CA36B' : '#D9534F', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': `${(c * st.act / 100).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 28 28)' }),
    svgEl('text', { x: 28, y: 32, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 500, fill: '#2C2C2C' }, `${st.act}%`));
  return h('div.hk-strip3', { style: { '--accent': func?.color || '#8A8A8A' } },
    ring,
    h('div.hk-s3', h('span', 'Avanzamento A3 (pesi delle contromisure)'), h('strong', `${st.act}% su ${st.exp}% atteso`), h('span.hk-status', { class: st.ok ? 'ok' : 'ko' }, st.ok ? 'In linea con il piano' : `Sotto l’atteso di ${st.exp - st.act} punti`)),
    h('div.hk-s3', h('span', 'Contromisure chiuse'), h('strong', `${p.tasks.filter(t => t.closed_date).length} di ${p.tasks.length}`)),
    h('div.hk-s3', h('span', 'Prossima scadenza'), h('strong', open[0] ? itDate(open[0].due_date) : '—'), open[0] ? h('small', open[0].activity) : null),
    h('div.hk-s3.wide', h('span', 'KPI di livello 0'), h('div.kp-chips', p.kpi_ids.map(kid => kpiChip(kpiById(kid), { small: true })))));
}

function a3Tab(box, p, reload) {
  const text = (field, { rows = 4, placeholder = '' } = {}) => h('textarea.hk-text', { rows: Math.max(rows, Math.ceil(String(p[field] || '').length / 46) + 1), placeholder, 'aria-label': field, on: { change: e => save('projects', p, { [field]: e.target.value }) } }, p[field] || '');
  // dopo una modifica che cambia l'avanzamento si ridisegna tutta la scheda (intestazione compresa)
  const refresh = async () => { await load(); reload(); };

  function draw() {
    const sum = p.tasks.reduce((s, t) => s + t.weight, 0);
    const causes = p.causes || {};
    const step = (n, title, dark) => h('div.hk-step', h('span.hk-num', { class: dark ? 'acc' : '' }, String(n)), h('h2', title));
    const dues = p.tasks.flatMap(t => [t.start_date, t.due_date]).filter(Boolean).sort();
    const startIso = [`${p.start_year || YEAR}-01-01`, dues[0] ? `${dues[0].slice(0, 7)}-01` : null].filter(Boolean).sort()[0];
    const sy = Number(startIso.slice(0, 4)), sm = Number(startIso.slice(5, 7)) - 1;
    const lastIso = [dues[dues.length - 1] || '', `${YEAR}-12-31`].sort().pop();
    const nM = Math.max(12, (Number(lastIso.slice(0, 4)) - sy) * 12 + Number(lastIso.slice(5, 7)) - sm);
    const GW = 620, colW = GW / nM;
    const pos = iso => ((Number(iso.slice(0, 4)) - sy) * 12 + Number(iso.slice(5, 7)) - 1 - sm + (Number(iso.slice(8, 10)) - 1) / 30) * colW;
    const months = Array.from({ length: nM }, (_, i) => { const m = (sm + i) % 12, y = sy + Math.floor((sm + i) / 12); return { l: MONTHS[m] + (m === 0 || i === 0 ? ` ${String(y).slice(2)}` : ''), now: D.today.slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}` }; });

    const taskRow = (t, i) => {
      const prev = t.start_date || (i === 0 ? startIso : (p.tasks[i - 1].due_date || startIso));
      const late = !t.closed_date && t.due_date && t.due_date < D.today;
      const lateClose = t.closed_date && t.due_date && t.closed_date > t.due_date;
      const x0 = Math.max(0, pos(prev)), x1 = t.due_date ? pos(t.due_date) + colW / 30 : x0 + colW;
      const field = (f, attrs = {}) => h('input.hk-in', { value: t[f] ?? '', ...attrs, on: { change: async e => { await save('tasks', t, { [f]: attrs.type === 'number' ? Number(e.target.value || 0) : e.target.value || (attrs.type === 'date' ? null : '') }); f === 'weight' || f === 'due_date' || f === 'start_date' || f === 'closed_date' ? refresh() : draw(); } } });
      return h('div.hk-cm',
        h('span.hk-num', { class: t.closed_date ? 'done' : '' }, String(i + 1)),
        h('div', h('textarea.hk-in.hk-act', { rows: 2, 'aria-label': 'Attività di dettaglio', on: { change: e => save('tasks', t, { activity: e.target.value }) } }, t.activity),
          h('div.row', h('input.hk-in.small', { value: t.area, placeholder: 'Area di intervento', on: { change: e => save('tasks', t, { area: e.target.value }) } }),
            t.ticket_id ? h('button.hk-ticketlink', { type: 'button', title: 'Apri il ticket di questa contromisura', on: { click: () => openTicket(t.ticket_id, { onSaved: refresh }) } }, icon('square-check', { size: 14 }), `Ticket #${t.ticket_id}`) : null)),
        field('weight', { type: 'number', min: 0, max: 100, class: 'center' }),
        field('owner'),
        field('start_date', { type: 'date', 'aria-label': 'Inizio' }),
        field('due_date', { type: 'date', 'aria-label': 'Scadenza' }),
        h('div.hk-close',
          t.closed_date ? field('closed_date', { type: 'date' }) : null,
          h('button.hk-closebtn', { type: 'button', class: t.closed_date ? (lateClose ? 'late' : 'done') : late ? 'over' : '',
            on: { click: async () => { await save('tasks', t, { closed_date: t.closed_date ? null : D.today }); refresh(); } } },
          t.closed_date ? (lateClose ? 'Chiusa in ritardo · riapri' : 'Chiusa · riapri') : late ? 'Scaduta · chiudi oggi' : 'Chiudi oggi')),
        h('div.hk-gantt', { style: { width: `${GW}px` } },
          months.map((_, j) => h('i.hk-gl', { style: { left: `${j * colW}px` } })),
          h('i.hk-gtoday', { style: { left: `${pos(D.today)}px` } }),
          h('span.hk-gbar', { class: t.closed_date ? 'done' : late ? 'over' : 'todo', style: { left: `${x0 + 1}px`, width: `${Math.max(8, x1 - x0 - 2)}px` }, title: `scadenza ${itDate(t.due_date)}` }),
          lateClose ? h('span.hk-gbar.late', { style: { left: `${x1}px`, width: `${Math.max(4, pos(t.closed_date) - x1 + colW / 30)}px` } }) : null),
        h('button.hk-icon', { type: 'button', 'aria-label': 'Elimina contromisura', on: { click: async () => {
          if (!await confirmDialog('Eliminare questa contromisura? Si cancella anche il suo ticket.', { ok: 'Elimina', danger: true })) return;
          await del(`/api/strategy/tasks/${t.id}`); refresh();
        } } }, icon('trash', { size: 16 })));
    };
    let doneUpTo = 0;
    for (const t of p.tasks) { if (t.closed_date) doneUpTo++; else break; }
    const areas = orderedAreas();

    fill(box,
      // telefono (app 2.0, 13/11): l'A3 in dieci secondi in cima; il foglio intero si apre sotto
      isMobile() ? a3QuickBox(p, refresh, D.today, box) : null,
      // intestazione dell'A3 (i campi del format), modificabile qui
      h('section.hk-card.hk-a3head',
        h('div.hk-a3fields',
          h('label.hk-fact.wide', h('span', 'Titolo del progetto A3'), h('input.hk-in.strong', { value: p.name, on: { change: e => save('projects', p, { name: e.target.value }) } })),
          h('label.hk-fact', h('span', 'Proprietario di A3'), h('input.hk-in', { value: p.owner, on: { change: e => save('projects', p, { owner: e.target.value }) } })),
          h('label.hk-fact', h('span', 'Team di progetto'), h('input.hk-in', { value: p.team, placeholder: 'Nomi separati da virgola', on: { change: e => save('projects', p, { team: e.target.value }) } })),
          h('label.hk-fact', h('span', 'Funzione / BU da HK'), h('select.hk-in', { on: { change: e => save('projects', p, { area_id: Number(e.target.value) }).then(refresh) } },
            areas.map(a => h('option', { value: a.id, selected: a.id === p.area_id }, `${funcById(a.function_id)?.name || ''} · ${areaLabel(a)}`)))),
          h('label.hk-fact', h('span', 'Stato'), h('select.hk-in', { on: { change: e => save('projects', p, { status: e.target.value }) } }, STATUSES.map(([k, l]) => h('option', { value: k, selected: p.status === k }, l)))),
          h('label.hk-fact', h('span', 'Anno di partenza'), h('input.hk-in', { value: p.start_year || '', inputmode: 'numeric', on: { change: e => save('projects', p, { start_year: e.target.value ? Number(e.target.value) : null }) } })),
          h('label.hk-fact', h('span', 'Tag'), h('input.hk-in', { value: p.tags || '', placeholder: 'Separati da virgola', on: { change: e => save('projects', p, { tags: e.target.value }) } })),
          h('div.hk-fact.wide4', h('span', 'KPI di livello 0 su cui lavora'), kpiField(p, { editable: p.can_edit, onChange: refresh })))),
      h('div.hk-row3',
        h('section.hk-card', step(1, 'Background'), h('span.hk-lbl', 'Descrizione del progetto'), text('background', { placeholder: 'Perché questo progetto' })),
        h('section.hk-card', step(2, 'Current conditions'), h('span.hk-lbl', 'Situazione di partenza'), text('current_conditions', { placeholder: 'Come stanno le cose oggi' })),
        h('section.hk-card.dark', step(3, 'Target conditions', true), h('span.hk-lbl', 'Obiettivi del progetto'), text('target_conditions', { placeholder: 'Dove si vuole arrivare' }))),
      h('section.hk-card',
        h('div.row.spread', h('div.row', step(4, 'Analysis'), h('span.muted', 'Le cause, con le 6 M di Ishikawa'))),
        h('div.hk-fish',
          h('div.hk-spine'),
          h('div.hk-effect', h('span.hk-lbl', 'Effetto'), h('input.hk-in', { value: p.effect || '', placeholder: 'Il problema da risolvere', on: { change: e => save('projects', p, { effect: e.target.value }) } })),
          CATEGORIES.map(([key, label], i) => {
            const list = causes[key] || [];
            const input = h('input.hk-in.small', { placeholder: '+ aggiungi causa', on: { keydown: async e => {
              if (e.key !== 'Enter' || !e.target.value.trim()) return;
              await save('projects', p, { causes: { ...causes, [key]: [...list, e.target.value.trim()] } }); draw();
            } } });
            return h('div.hk-bone', { class: i < 3 ? 'top' : 'bottom', style: { left: `${(i % 3) * 25 + 1}%` } },
              h('strong', label),
              list.length ? list.map((c, j) => h('div.hk-cause', h('span', c), h('button.hk-x', { type: 'button', 'aria-label': 'Togli', on: { click: async () => { await save('projects', p, { causes: { ...causes, [key]: list.filter((_, x) => x !== j) } }); draw(); } } }, '×'))) : h('span.muted.small', 'Nessuna causa'),
              input);
          }))),
      h('section.hk-card.cmcard',
        h('div.row.spread', h('div.row', step(5, 'Countermeasures', true), h('span.muted', 'ogni contromisura è un ticket del progetto: date e chiusura sono le stesse nel Gantt e nei ticket')), h('div.row', p.project_visible ? h('a.small', { href: `#/strategy/a3/${p.id}/gantt` }, 'Lo stesso Gantt nel tab Gantt →') : null, h('span', { class: sum === 100 ? 'ok' : 'ko' }, `Pesi ${sum}% su 100%`))),
        h('div.hk-cm.head', h('span', 'Rif.'), h('span', 'Attività di dettaglio · area di intervento'), h('span', 'Peso %'), h('span', 'Owner'), h('span', 'Inizio'), h('span', 'Scadenza'), h('span', 'Chiusura reale'),
          h('div.hk-gantt.head', { style: { width: `${GW}px` } }, months.map((m, j) => h('span', { class: m.now ? 'now' : '', style: { left: `${j * colW}px`, width: `${colW}px` } }, m.l))), h('span')),
        p.tasks.map(taskRow),
        h('button.hk-addrow', { type: 'button', on: { click: async () => {
          await post('/api/strategy/tasks', { project_id: p.id, owner: p.owner, weight: Math.max(0, 100 - sum) });
          refresh();
        } } }, icon('plus', { size: 16 }), 'Aggiungi contromisura'),
        h('div.hk-legend', h('span', h('i.done'), 'chiusa'), h('span', h('i.late'), 'chiusa in ritardo'), h('span', h('i.over'), 'scaduta e aperta'), h('span', h('i.todo'), 'da fare'), h('span', h('i.today'), 'oggi'))),
      h('section.hk-card',
        step(6, 'Follow up (KPIs)'),
        h('div.hk-row2',
          h('div', h('span.hk-lbl', 'Avanzamento quantitativo · si calcola dalle contromisure'),
            h('div.hk-big', doneUpTo ? `Completato fino al riferimento ${doneUpTo}` : 'Nessuna contromisura chiusa'),
            h('div.hk-steps', p.tasks.map((t, i) => [i ? h('span.hk-sline', { class: i < doneUpTo ? 'on' : '' }) : null, h('span.hk-num', { class: i < doneUpTo ? 'done' : '' }, String(i + 1))]))),
          h('label', h('span.hk-lbl', 'Avanzamento qualitativo'), text('follow_up_quality', { placeholder: 'Com’è andata finora, cosa si è imparato' })))));
    // sola lettura per chi non è nel team dell'A3 (il server lo rifiuta comunque)
    if (!p.can_edit) {
      box.classList.add('hk-ro');
      box.prepend(h('p.hk-ro-note', icon('key-round', { size: 16 }), 'Sola lettura: questo A3 lo modificano il suo team e gli amministratori.'));
      box.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
    }
  }
  draw();
}

const fact = (label, ...kids) => h('div.hk-fact', h('span', label), ...kids);
