// Alma Energy · Analisi economico-finanziarie (ALM2-74 tappa 2, tavole «Analisi» e «Scheda analisi» del canvas
// «Alma Energy da capo», approvate da Dante il 24/11/2026). Un'analisi nasce libera; ha versioni (scenario del
// simulatore o file Excel/PDF con i numeri scritti a mano); si allega a un progetto e una per progetto è «di riferimento».
import { h, fill, modal, toast, loading, debounce, confirmDialog, promptDialog, fmtDate } from './ui.js';
import { get, post, patch, del, api, qs } from './api.js';
import { icon } from './icons.js';
import { meta, num, select, field, ensureMeta } from './energy.js';
import { FIELDS, FINANCE, simDefaults } from './energy-simulator.js';

const TYPE_CLASS = { fv_nuovo: 'fv', acquisizione: 'acq', revamping: 'rev', ppa_onsite: 'ppa' };
const MODELS = [['ppa_onsite', 'PPA on-site'], ['revamping', 'Revamping / acquisizione'], ['fv_classico', 'FV classico (piano di sviluppo)']];
const MODEL_OF_TYPE = { fv_nuovo: 'fv_classico', acquisizione: 'revamping', revamping: 'revamping', ppa_onsite: 'ppa_onsite' };
const SENS = { prezzo: 'Prezzo dell\'energia', capex: 'Capex', producibilita: 'Produzione' };
const typePill = t => h('span.pill.en-pt', { class: `en-pt-${TYPE_CLASS[t] || 'fv'}` }, meta.projectTypes?.[t] || t);
const pct = (n, d = 1) => (n === null || n === undefined ? null : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: d })}%`);
const eurM = n => (n === null || n === undefined ? null : Math.abs(n) >= 1e6 ? `${num(n / 1e6, 2)} M€` : `${num(Math.round(n))} €`);
const years = n => (n === null || n === undefined ? null : `${n.toLocaleString('it-IT', { maximumFractionDigits: 1 })} anni`);
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '');
const when = iso => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
const mancante = () => h('span.pill.en-due-soon', 'Da completare');

// Dove sta l'analisi: libera, opportunità del CRM, progetto selezionato (di riferimento o no).
function linkPill(a) {
  if (!a.opportunity_id) return h('span.muted', 'libera');
  const isProject = Boolean(a.selection);
  const label = `${isProject ? 'Progetto' : 'Opportunità'} · ${a.opportunity_title || ''}${a.reference ? ' · di riferimento' : ''}`;
  return h('a.pill', { class: isProject ? 'en-link-pill on' : 'en-link-pill', href: `#/energy/opportunita/${a.opportunity_id}/${isProject ? 'iter' : 'opportunita'}`,
    on: { click: e => e.stopPropagation() } }, label);
}

// ── elenco ───────────────────────────────────────────────────────────────────
export async function analysesView(box) {
  await ensureMeta();
  const state = { stato: '', type: '', q: '' };
  const states = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Stato' });
  const types = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Tipo' });
  const list = h('div', loading());
  fill(box,
    h('p.muted.en-lead', 'Ogni analisi nasce libera: un\'idea, un\'opportunità del CRM, un impianto in vendita. Quando il progetto viene selezionato, la alleghi e la segni come analisi di riferimento.'),
    h('div.toolbar.en-sel-toolbar', states, types,
      h('input.input.grow', { type: 'search', placeholder: 'Nome, progetto…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn', { type: 'button', on: { click: () => newDialog({ source: 'file' }) } }, icon('upload', { size: 15 }), 'Carica Excel o PDF esterno'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => newDialog({ source: 'simulatore' }) } }, icon('plus', { size: 15 }), 'Nuova analisi')),
    list,
    h('p.muted.en-iter-note', 'I numeri di un file esterno li scrive chi lo carica; quelli del simulatore si calcolano da soli. Gli scenari salvati nel simulatore compaiono qui come analisi.'));

  async function load() {
    const d = await get(`/api/energy/analyses${qs(state)}`);
    fill(states, [['', `Tutte ${d.counts.tutte}`], ['libere', `Libere ${d.counts.libere}`], ['allegate', `Allegate ${d.counts.allegate}`]].map(([k, label]) =>
      h('button', { type: 'button', class: state.stato === k ? 'on' : '', on: { click: () => { state.stato = k; load(); } } }, label)));
    fill(types, [['', 'Ogni tipo'], ...Object.entries(d.types)].map(([k, label]) =>
      h('button', { type: 'button', class: state.type === k ? 'on' : '', on: { click: () => { state.type = k; load(); } } }, label)));
    if (!d.analyses.length) {
      return fill(list, h('div.card.empty', state.q || state.stato || state.type ? 'Nessuna analisi con questi filtri.' : 'Nessuna analisi. Creane una con «Nuova analisi» o carica il file di un consulente.'));
    }
    const open = id => { location.hash = `#/energy/analisi/${id}`; };
    fill(list, h('div.card.table-wrap', h('table.list.en-an-table',
      h('thead', h('tr', ['Analisi', 'Tipo', 'Versione', 'MW', 'Capex', 'IRR equity', 'VAN', 'Payback', 'Collegata a'].map((t, i) => h('th', { class: i >= 3 && i <= 7 ? 'num' : '' }, t)))),
      h('tbody', d.analyses.map(a => h('tr', { tabindex: 0, on: { click: () => open(a.id), keydown: e => { if (e.key === 'Enter') open(a.id); } } },
        h('td', h('div.t-title', a.title), h('div.t-meta', [a.created_by_name, day(a.updated_at)].filter(Boolean).join(' · '))),
        h('td', typePill(a.project_type)),
        h('td', `v${a.n || 1}${a.label ? ` · ${a.label}` : ''}`, a.source === 'file' ? h('div.t-meta', a.file_name || 'file esterno') : null),
        h('td.num', a.kpi.mw ? num(a.kpi.mw, 2) : '—'),
        h('td.num', eurM(a.kpi.capex) || h('span.muted', 'manca')),
        h('td.num', a.kpi.irr !== null && a.kpi.irr !== undefined ? h('strong', pct(a.kpi.irr)) : mancante()),
        h('td.num', eurM(a.kpi.npv) || '—'),
        h('td.num', years(a.kpi.payback) || '—'),
        h('td', linkPill(a))))))));
  }
  await load();
}

// ── nuova analisi ────────────────────────────────────────────────────────────
// Per il simulatore si sceglie il modello di calcolo; per un file si scrivono i numeri e si carica il file.
const KPI_FIELDS = [['irr', 'IRR equity', '%'], ['irrProject', 'IRR di progetto', '%'], ['npv', 'VAN', '€'], ['payback', 'Payback', 'anni'],
  ['dscrMin', 'DSCR minimo', ''], ['capex', 'Capex', '€'], ['mw', 'Potenza', 'MW']];
function kpiInputs(kpi = {}) {
  const els = {};
  const grid = h('div.en-an-kpi-form', KPI_FIELDS.map(([k, label, unit]) => {
    const raw = kpi[k];
    const shown = raw === null || raw === undefined ? '' : unit === '%' ? String(Math.round(raw * 10000) / 100).replace('.', ',') : String(raw).replace('.', ',');
    els[k] = h('input.input', { inputmode: 'decimal', value: shown, 'aria-label': label });
    return field(`${label}${unit ? ` (${unit})` : ''}`, els[k]);
  }));
  const read = () => Object.fromEntries(Object.entries(els).map(([k, el]) => {
    const s = el.value.trim();
    if (!s) return [k, null];
    const n = Number(s.replace(/\s|€|%/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    const unit = KPI_FIELDS.find(f => f[0] === k)[2];
    return [k, Number.isFinite(n) ? (unit === '%' ? n / 100 : n) : s];
  }).filter(([, val]) => val !== null));
  return { grid, read };
}

async function uploadFile(versionId, file) {
  await api('POST', `/api/energy/analysis-versions/${versionId}/file?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, file, { raw: true });
}

export function newDialog({ source = 'simulatore', opportunity = null, reference = false, onDone } = {}) {
  const title = h('input.input', { maxlength: 160, autofocus: true, value: opportunity ? `${opportunity.title} · analisi` : '' });
  const proposedType = opportunity?.project_type || (opportunity?.kind === 'revamping' ? 'revamping' : opportunity?.kind === 'ppa_onsite' ? 'ppa_onsite' : 'fv_nuovo');
  const type = select(Object.entries(meta.projectTypes), proposedType);
  const model = select(MODELS, MODEL_OF_TYPE[proposedType]);
  type.addEventListener('change', () => { model.value = MODEL_OF_TYPE[type.value]; });
  const label = h('input.input', { maxlength: 80, placeholder: 'es. preliminare' });
  const file = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv,.pdf' });
  const kpi = kpiInputs();
  const go = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!title.value.trim()) return toast('Dai un nome all\'analisi', 'err');
    if (source === 'file' && !file.files[0]) return toast('Scegli il file', 'err');
    go.disabled = true;
    try {
      const a = await post('/api/energy/analyses', {
        title: title.value.trim(), project_type: type.value, source, model: model.value, label: label.value.trim(),
        opportunity_id: opportunity?.id || null, reference, kpi: source === 'file' ? kpi.read() : undefined,
      });
      if (source === 'file') await uploadFile(a.versions[0].id, file.files[0]);
      m.close();
      toast('Analisi creata');
      if (onDone) onDone(a);
      else location.hash = `#/energy/analisi/${a.id}`;
    } finally { go.disabled = false; }
  } } }, 'Crea l\'analisi');
  const m = modal({
    title: source === 'file' ? 'Carica un\'analisi esterna' : 'Nuova analisi', wide: source === 'file',
    body: h('div.en-form',
      field('Nome', title),
      h('div.en-row2', field('Tipo', type), field('Etichetta della versione', label)),
      source === 'simulatore' ? field('Modello di calcolo', model, 'Le ipotesi si cambiano nel simulatore; i numeri si aggiornano da soli.') : null,
      source === 'file' ? [field('File (Excel o PDF)', file), h('p.muted', 'Scrivi i numeri del file: servono per l\'elenco, il progetto e il cruscotto.'), kpi.grid] : null,
      opportunity ? h('p.banner', `Allegata a «${opportunity.title}»${reference ? ' come analisi di riferimento' : ''}.`) : null),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go],
  });
}

// ── scheda ───────────────────────────────────────────────────────────────────
export async function analysisPage(container, id, params) {
  fill(container, loading());
  let a;
  try {
    a = await get(`/api/energy/analyses/${id}`, { quiet: true });
  } catch (err) {
    return fill(container, h('div.card.empty', err.status === 404 ? 'Analisi non trovata.' : err.message, ' ', h('a', { href: '#/energy/analisi' }, 'Tutte le analisi')));
  }
  const n = Number(params?.get('v')) || a.versions[a.versions.length - 1].n;
  const ver = a.versions.find(x => x.n === n) || a.versions[a.versions.length - 1];
  const d = await get(`/api/energy/analysis-versions/${ver.id}`);
  const refresh = (v = ver.n) => { history.replaceState(null, '', `#/energy/analisi/${id}?v=${v}`); analysisPage(container, id, new URLSearchParams(`v=${v}`)); };
  const first = a.versions[0];

  const verSeg = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Versione' }, a.versions.map(x =>
    h('button', { type: 'button', class: x.n === ver.n ? 'on' : '', on: { click: () => refresh(x.n) } }, `v${x.n}${x.label ? ` ${x.label}` : ''}`)));
  const more = h('details.en-more',
    h('summary.btn.btn-ghost', { 'aria-label': 'Altre azioni' }, icon('more', { size: 16 })),
    h('div.en-more-menu', { role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', on: { click: async () => {
        const t = await promptDialog('Rinomina l\'analisi', { label: 'Nome', value: a.title });
        if (t) { await patch(`/api/energy/analyses/${id}`, { title: t }); refresh(); }
      } } }, 'Rinomina'),
      h('button', { type: 'button', role: 'menuitem', on: { click: () => editVersionDialog(ver, refresh) } }, 'Etichetta e nota della versione'),
      a.opportunity_id ? h('button', { type: 'button', role: 'menuitem', on: { click: async () => {
        if (!await confirmDialog(`Staccare l'analisi da «${a.opportunity_title}»? Torna libera.`, { ok: 'Stacca' })) return;
        await patch(`/api/energy/analyses/${id}`, { opportunity_id: null });
        refresh();
      } } }, 'Stacca dal progetto') : null,
      a.versions.length > 1 ? h('button', { type: 'button', role: 'menuitem', on: { click: async () => {
        if (!await confirmDialog(`Cancellare la versione v${ver.n}?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/energy/analysis-versions/${ver.id}`);
        refresh(a.versions.filter(x => x.id !== ver.id).pop().n);
      } } }, `Cancella la versione v${ver.n}`) : null,
      h('button', { type: 'button', role: 'menuitem', on: { click: async () => {
        if (!await confirmDialog(`Cancellare l'analisi «${a.title}» con tutte le versioni?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/energy/analyses/${id}`);
        location.hash = '#/energy/analisi';
      } } }, 'Cancella l\'analisi')));

  const k = d.kpi || {};
  const pk = d.previous?.kpi || null;
  const delta = pk && k.irr !== null && k.irr !== undefined && pk.irr !== null && pk.irr !== undefined ? (k.irr - pk.irr) * 100 : null;
  const tile = (label, value, sub, hi) => h('div.sw-kpi.en-an-kpi', { class: hi ? 'hi' : '' }, h('span.lab', label), h('strong.big', value ?? '—'), sub ? h('span.sub', sub) : null);

  fill(container, h('div.en-an',
    h('a.en-an-back', { href: '#/energy/analisi' }, icon('chevron-left', { size: 15 }), 'Analisi economico-finanziarie'),
    h('header.en-an-head',
      h('div',
        h('div.en-iter-pills', typePill(a.project_type), a.opportunity_id ? linkPill(a) : h('span.pill', 'libera')),
        h('h1', a.title),
        h('p.muted', `Versione ${ver.n} di ${ver.created_by_name || '—'} · ${when(ver.created_at)}${a.versions.length > 1 ? ` · prima versione del ${day(first.created_at)}` : ''}${ver.source === 'simulatore' && ver.scenario_updated_at ? ` · ultimo calcolo ${when(ver.scenario_updated_at)}` : ''}`)),
      h('div.en-stage-row', verSeg,
        h('button.btn', { type: 'button', on: { click: () => newVersionDialog(a, refresh) } }, icon('plus', { size: 15 }), 'Nuova versione'),
        ver.source === 'simulatore' && ver.scenario_id ? [
          h('a.btn', { href: `#/energy/simulatore?s=${ver.scenario_id}` }, icon('calculator', { size: 15 }), 'Modifica nel simulatore'),
          h('a.btn', { href: `/api/energy/scenarios/${ver.scenario_id}/excel` }, icon('sheet', { size: 15 }), 'Esporta Excel')] : null,
        ver.source === 'file' && ver.file_name ? h('a.btn', { href: `/api/energy/analysis-versions/${ver.id}/file` }, icon('download', { size: 15 }), 'Scarica il file') : null,
        a.opportunity_id && !a.reference ? h('button.btn', { type: 'button', on: { click: async () => {
          await patch(`/api/energy/analyses/${id}`, { reference: true }); toast('Analisi di riferimento del progetto'); refresh();
        } } }, 'Rendi di riferimento') : null,
        h('button.btn.btn-primary', { type: 'button', on: { click: () => attachDialog(a, refresh) } }, a.opportunity_id ? 'Cambia progetto' : 'Allega a un progetto'),
        more)),
    h('section.en-an-kpis', { 'aria-label': 'Risultati' },
      tile('IRR equity', pct(k.irr) || mancante(), delta === null ? null : `${delta >= 0 ? '+' : ''}${delta.toLocaleString('it-IT', { maximumFractionDigits: 1 })} pt rispetto a v${d.previous.n}`, true),
      tile('IRR di progetto', pct(k.irrProject)),
      tile('VAN', eurM(k.npv)),
      tile('Payback', years(k.payback)),
      tile('DSCR minimo', k.dscrMin ? k.dscrMin.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : null),
      tile('Capex', eurM(k.capex), k.capex && k.mw ? `${num(k.capex / (k.mw * 1000))} €/kW` : null)),
    h('section.en-an-cols',
      h('div.card.sw-card.en-an-left', await hypotheses(d, ver, refresh)),
      h('div.en-an-right', flowsCard(d), sensitivityCard(d), changesCard(d, ver, refresh)))));
}

// Ipotesi: per il simulatore i campi del modello con il valore della versione; per un file i numeri scritti a mano.
async function hypotheses(d, ver, refresh) {
  if (d.source === 'file') {
    const kpi = kpiInputs(d.kpi);
    return [h('div.en-iter-phase-head', h('h2', 'File esterno')),
      d.file_name ? h('p', h('a', { href: `/api/energy/analysis-versions/${d.id}/file` }, icon('file', { size: 15 }), ' ', d.file_name), h('span.muted', ` · ${num((d.file_size || 0) / 1024)} kB`))
        : h('p', mancante(), ' Il file non è ancora caricato.'),
      h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv,.pdf', 'aria-label': 'Carica o sostituisci il file', on: { change: async e => {
        if (!e.target.files[0]) return;
        await uploadFile(d.id, e.target.files[0]); toast('File caricato'); refresh();
      } } }),
      h('p.muted', 'Numeri del file, scritti a mano:'), kpi.grid,
      h('div.en-stage-row', h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await patch(`/api/energy/analysis-versions/${d.id}`, { kpi: kpi.read() }); toast('Numeri salvati'); refresh();
      } } }, 'Salva i numeri'))];
  }
  if (!d.model) return [h('h2', 'Ipotesi'), h('p.muted', 'Lo scenario di questa versione non c\'è più.')];
  const defs = await simDefaults(d.model);
  const groups = [...FIELDS[d.model], ...(d.model === 'fv_classico' ? [] : [FINANCE])];
  const shown = (key, unit, kind) => {
    const val = d.input?.[key] ?? defs[key];
    if (val === null || val === undefined || val === '') return '—';
    return kind === 'pct' ? pct(val) : `${num(val, 2)}${unit ? ` ${unit}` : ''}`;
  };
  return [h('div.en-iter-phase-head', h('h2', 'Ipotesi'), h('a.btn.btn-sm', { href: `#/energy/simulatore?s=${ver.scenario_id}` }, 'Modifica')),
    groups.map(([g, fields]) => h('div.en-an-group', h('p.en-an-h3', g), fields.map(([key, label, unit, kind]) =>
      h('div.en-an-row', { class: d.input && key in d.input ? 'set' : '' }, h('span', label), h('b', shown(key, unit, kind)))))),
    h('p.muted.en-iter-note', 'In grassetto i valori della versione; gli altri sono quelli di partenza del simulatore.')];
}

function flowsCard(d) {
  if (!d.flows?.length) return null;
  const max = Math.max(...d.flows.map(f => Math.abs(f.fcf || 0)), 1);
  return h('div.card.sw-card',
    h('div.en-iter-phase-head', h('h2', 'Flussi di cassa per l\'equity'), h('span.muted', `€ per anno, ${d.flows.length - 1} anni`)),
    h('div.en-an-bars', { role: 'img', 'aria-label': `Flussi annui: investimento all'anno 0 di ${eurM(d.flows[0].fcf)}, poi da ${eurM(d.flows[1]?.fcf)} all'anno 1` },
      d.flows.map(f => h('i', { class: f.fcf < 0 ? 'neg' : f.incentive ? 'inc' : '', title: `${f.year}: ${eurM(f.fcf)}`, style: { height: `${Math.max(2, (Math.abs(f.fcf || 0) / max) * 100)}%` } }))),
    h('div.en-an-legend.muted', h('span', h('i.inc'), 'con incentivo'), h('span', h('i'), 'mercato'), h('span', h('i.neg'), 'investimento')));
}

function sensitivityCard(d) {
  const keys = Object.keys(d.sensitivity || {});
  if (!keys.length) return null;
  const at = (list, delta) => list.find(x => Math.abs(x.delta - delta) < 1e-9)?.irr;
  return h('div.card.sw-card',
    h('h2', 'Sensitività sull\'IRR equity'),
    h('table.en-an-sens', h('thead', h('tr', h('th', 'Variabile'), h('th', '−10%'), h('th', 'base'), h('th', '+10%'))),
      h('tbody', keys.map(key => h('tr', h('td', SENS[key] || key), [-0.1, 0, 0.1].map(x => h('td', pct(at(d.sensitivity[key], x)) || '—')))))));
}

// Cosa è cambiato rispetto alla versione prima: la nota e, per il simulatore, le ipotesi diverse.
function changesCard(d, ver, refresh) {
  if (!d.previous) return h('div.card.sw-card', h('h2', 'Versioni'), h('p.muted', 'È la prima versione. Con «Nuova versione» la copi e la cambi: qui vedrai cosa è cambiato.'));
  const rows = [];
  if (d.model && d.previous.model === d.model) {
    const labels = Object.fromEntries([...FIELDS[d.model], FINANCE].flatMap(([, fields]) => fields.map(([key, label, unit, kind]) => [key, [label, unit, kind]])));
    const keys = new Set([...Object.keys(d.input || {}), ...Object.keys(d.previous.input || {})]);
    for (const key of keys) {
      const a = d.previous.input?.[key];
      const b = d.input?.[key];
      if (JSON.stringify(a) === JSON.stringify(b) || !labels[key]) continue;
      const [label, unit, kind] = labels[key];
      const f = val => (val === undefined || val === null || val === '' ? 'di partenza' : kind === 'pct' ? pct(val) : `${num(val, 2)}${unit ? ` ${unit}` : ''}`);
      rows.push(h('div.en-an-row', h('span', label), h('b', `${f(a)} → ${f(b)}`)));
    }
  }
  return h('div.card.sw-card',
    h('div.en-iter-phase-head', h('h2', `Cosa è cambiato da v${d.previous.n}`), h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => editVersionDialog(ver, refresh) } }, 'Scrivi la nota')),
    d.note ? h('p', d.note) : null,
    rows.length ? rows : !d.note ? h('p.muted', d.source === 'file' ? 'Scrivi nella nota cosa è cambiato nel file.' : 'Nessuna ipotesi diversa dalla versione prima.') : null);
}

function editVersionDialog(ver, refresh) {
  const label = h('input.input', { value: ver.label || '', maxlength: 80 });
  const note = h('textarea.input', { rows: 4, maxlength: 2000 }, ver.note || '');
  const m = modal({
    title: `Versione v${ver.n}`,
    body: h('div.en-form', field('Etichetta', label, 'es. preliminare, dopo la DD, offerta finale'), field('Cosa è cambiato', note)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await patch(`/api/energy/analysis-versions/${ver.id}`, { label: label.value.trim(), note: note.value.trim() });
        m.close(); refresh(ver.n);
      } } }, 'Salva')],
  });
}

function newVersionDialog(a, refresh) {
  let source = 'simulatore';
  const label = h('input.input', { maxlength: 80, placeholder: 'es. dopo la DD' });
  const note = h('textarea.input', { rows: 3, maxlength: 2000, placeholder: 'Cosa cambia rispetto alla versione prima' });
  const file = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv,.pdf' });
  const kpi = kpiInputs();
  const fileBox = h('div.en-form', { hidden: true }, field('File (Excel o PDF)', file), kpi.grid);
  const seg = h('div.seg.en-filter', [['simulatore', 'Dal simulatore'], ['file', 'Da un file esterno']].map(([k, l]) => h('button', { type: 'button', class: k === source ? 'on' : '', on: { click: e => {
    source = k;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
    fileBox.hidden = k !== 'file';
  } } }, l)));
  const m = modal({
    title: `Nuova versione di «${a.title}»`, wide: true,
    body: h('div.en-form', seg, h('p.muted', 'Dal simulatore la versione riparte dalle ipotesi dell\'ultima: poi la cambi con «Modifica nel simulatore».'),
      h('div.en-row2', field('Etichetta', label), field('Cosa è cambiato', note)), fileBox),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (source === 'file' && !file.files[0]) return toast('Scegli il file', 'err');
        const r = await post(`/api/energy/analyses/${a.id}/versions`, { source, label: label.value.trim(), note: note.value.trim(), kpi: source === 'file' ? kpi.read() : undefined });
        if (source === 'file') await uploadFile(r.version_id, file.files[0]);
        m.close();
        toast('Nuova versione creata');
        refresh(r.versions[r.versions.length - 1].n);
      } } }, 'Crea la versione')],
  });
}

// «Allega a un progetto»: prima i progetti selezionati, poi la ricerca fra tutte le opportunità.
function attachDialog(a, refresh) {
  const ref = h('input', { type: 'checkbox', checked: true });
  const q = h('input.input', { type: 'search', placeholder: 'Cerca un progetto o un\'opportunità…', autofocus: true });
  const list = h('div.en-pick-list', loading());
  const pick = async o => {
    await patch(`/api/energy/analyses/${a.id}`, { opportunity_id: o.id, reference: ref.checked });
    m.close();
    toast(ref.checked ? 'Allegata come analisi di riferimento' : 'Analisi allegata');
    refresh();
  };
  const row = (o, sub) => h('button.en-pick', { type: 'button', on: { click: () => pick(o) } }, h('strong', o.title), h('span.t-meta', sub));
  const search = async () => {
    const term = q.value.trim();
    const [sel, all] = await Promise.all([get(`/api/energy/selected${qs({ q: term })}`), term ? get(`/api/energy/opportunities${qs({ q: term, limit: 20 })}`) : { opportunities: [] }]);
    const selected = sel.columns.flatMap(c => c.cards.map(x => ({ ...x, column: c.label })));
    const ids = new Set(selected.map(x => x.id));
    const others = all.opportunities.filter(o => !ids.has(o.id));
    fill(list,
      selected.length ? [h('p.en-an-h3', 'Progetti selezionati'), selected.map(o => row(o, `${meta.projectTypes[o.project_type]} · ${o.column}`))] : null,
      others.length ? [h('p.en-an-h3', 'Opportunità del CRM'), others.map(o => row(o, [meta.kinds[o.kind], o.company_name].filter(Boolean).join(' · ')))] : null,
      !selected.length && !others.length ? h('p.muted', 'Nessun risultato.') : null);
  };
  q.addEventListener('input', debounce(search));
  const m = modal({
    title: `Allega «${a.title}»`,
    body: h('div.en-form', q, h('label.en-check', ref, 'Analisi di riferimento del progetto (i suoi numeri vanno in testa all\'iter e sulla scheda)'), list),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
  });
  search();
}

// Dall'iter del progetto: allega un'analisi libera come analisi di riferimento.
export function pickFreeDialog(o, onDone) {
  const list = h('div.en-pick-list', loading());
  const m = modal({
    title: `Allega un'analisi a «${o.title}»`,
    body: h('div.en-form', h('p.muted', 'Analisi libere: quella scelta diventa l\'analisi di riferimento del progetto.'), list),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => { m.close(); newDialog({ source: 'simulatore', opportunity: o, reference: true }); } } }, 'Nuova analisi per questo progetto')],
  });
  get('/api/energy/analyses?stato=libere').then(d => fill(list, d.analyses.length ? d.analyses.map(x => h('button.en-pick', { type: 'button', on: { click: async () => {
    await patch(`/api/energy/analyses/${x.id}`, { opportunity_id: o.id, reference: true });
    m.close();
    toast('Analisi di riferimento allegata');
    onDone?.();
  } } }, h('strong', x.title), h('span.t-meta', [`v${x.n}`, meta.projectTypes[x.project_type], x.kpi.irr ? `IRR ${pct(x.kpi.irr)}` : null].filter(Boolean).join(' · '))))
    : h('p.muted', 'Nessuna analisi libera: creane una per questo progetto.')));
}
