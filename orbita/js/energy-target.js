// Alma Energy · Progetti selezionati (ALM2-74, canvas «Alma Energy da capo» approvato da Dante il 24/11/2026).
// Pipeline a tre colonne: in valutazione → partiti (DD tecnica avviata) → scartati, con le schede da trascinare.
// Iter del progetto (tab «Iter» della pagina dell'opportunità): fasi dal modello del tipo, con i punti da spuntare,
// responsabile e scadenza; «Modifica iter» cambia le fasi solo per quel progetto. «Modelli di iter» cambia i modelli.
import { h, fill, modal, toast, loading, debounce, confirmDialog, promptDialog, fmtDate } from './ui.js';
import { get, post, patch, put, del, api, qs } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { meta, num, select, field, ensureMeta } from './energy.js';
import { mapView } from './energy-map.js';
import { newDialog, pickFreeDialog } from './energy-analisi.js';

const TYPE_CLASS = { fv_nuovo: 'fv', acquisizione: 'acq', revamping: 'rev', ppa_onsite: 'ppa' };
const typeLabel = t => meta?.projectTypes?.[t] || t;
const typePill = t => h('span.pill.en-pt', { class: `en-pt-${TYPE_CLASS[t] || 'fv'}` }, typeLabel(t));
const pct = n => (n === null || n === undefined ? null : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '');
const when = iso => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const daysTo = d => Math.round((Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 864e5);
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];

// Scadenza come pillola: rossa se passata o entro 3 giorni, ambra entro 7.
function duePill(d, prefix = '') {
  if (!d) return null;
  const n = daysTo(d);
  const cls = n <= 3 ? 'en-due-late' : n <= 7 ? 'en-due-soon' : '';
  return h('span.pill.en-due', { class: cls }, `${prefix}${day(d)}`);
}

// ── passaggi di colonna ──────────────────────────────────────────────────────
async function moveTo(id, to, title) {
  let reason = '';
  if (to === 'scartato') {
    reason = await promptDialog(`Scartare «${title}»?`, { label: 'Perché si scarta', ok: 'Scarta' });
    if (!reason) return false;
  }
  if (to === 'avviato' && !await confirmDialog(`Avviare la DD tecnica di «${title}»? Parte l'iter del suo tipo, con una riga per fase nel Gantt del progetto.`, { ok: 'Avvia la DD tecnica' })) return false;
  await post(`/api/energy/opportunities/${id}/selection`, { to, reason });
  toast(to === 'avviato' ? 'DD tecnica avviata' : to === 'scartato' ? 'Progetto scartato' : 'Di nuovo in valutazione');
  return true;
}

// ── pipeline ─────────────────────────────────────────────────────────────────
export async function targetsView(box) {
  await ensureMeta();
  const state = { q: '', type: '' };
  let view = 'pipeline';
  const board = h('div.en-board-wrap', loading());
  const types = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Tipo di progetto' });
  const viewSeg = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Vista' }, [['pipeline', 'Pipeline'], ['mappa', 'Mappa']].map(([k, label]) =>
    h('button', { type: 'button', class: k === view ? 'on' : '', on: { click: e => {
      view = k;
      viewSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      load();
    } } }, label)));
  fill(box,
    h('p.muted.en-lead', 'Un progetto entra qui quando decidi di portarlo avanti. Si valuta, poi con «Avvia la DD tecnica» parte il suo iter; gli scartati restano con il motivo.'),
    h('div.toolbar.en-sel-toolbar',
      viewSeg, types,
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome o azienda…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => pickDialog(load) } }, icon('plus', { size: 15 }), 'Seleziona un progetto')),
    board);

  async function load() {
    if (view === 'mappa') return mapView(board, 'target', { q: state.q }, p => openTarget(p.id));
    const d = await get(`/api/energy/selected${qs(state)}`);
    const total = d.columns.reduce((s, c) => s + c.count, 0);
    fill(types, [['', 'Tutti'], ...Object.entries(d.types)].map(([k, label]) => h('button', { type: 'button', class: state.type === k ? 'on' : '', on: { click: () => { state.type = k; load(); } } }, label)));
    if (!total && !state.q && !state.type) {
      return fill(board, h('div.card.empty', 'Nessun progetto selezionato. Si sceglie con «Seleziona un progetto» o dalla scheda di un\'opportunità.'));
    }
    fill(board, h('div.en-sel-board', d.columns.map(c => column(c))));
  }

  function column(c) {
    const col = h('section.en-sel-col', { class: `en-sel-${c.key}`, 'aria-label': c.label, on: {
      dragover: e => { e.preventDefault(); col.classList.add('drop'); },
      dragleave: () => col.classList.remove('drop'),
      drop: async e => {
        e.preventDefault();
        col.classList.remove('drop');
        const [id, from, title] = (e.dataTransfer.getData('text/plain') || '').split('|');
        if (!id || from === c.key) return;
        if (await moveTo(Number(id), c.key, title)) load();
      },
    } },
    h('header.en-sel-head', h('strong', c.label), h('span.pill.en-sel-n', c.mw ? `${num(c.count)} · ${num(c.mw, 1)} MW` : num(c.count))),
    h('p.en-sel-sub', c.key === 'valutazione' ? 'Si fa l\'analisi e si decide se partire.'
      : c.key === 'avviato' ? 'Dalla DD tecnica in poi il progetto segue il suo iter.' : 'Con il motivo; si possono rimettere in valutazione.'),
    c.cards.length ? c.cards.map(card) : h('div.en-sel-empty', 'Nessuno'));
    return col;
  }

  function card(t) {
    const open = () => openTarget(t.id);
    const act = (label, to, primary) => h(primary ? 'button.btn.btn-sm.btn-primary' : 'button.btn.btn-sm', { type: 'button', on: { click: async e => {
      e.stopPropagation();
      if (await moveTo(t.id, to, t.title)) load();
    } } }, label);
    return h('article.en-sel-card', {
      tabindex: 0, draggable: 'true', class: t.selection === 'scartato' ? 'off' : '',
      on: {
        click: open, keydown: e => { if (e.key === 'Enter') open(); },
        dragstart: e => { e.dataTransfer.setData('text/plain', `${t.id}|${t.selection}|${t.title}`); e.currentTarget.classList.add('dragging'); },
        dragend: e => e.currentTarget.classList.remove('dragging'),
      },
    },
    h('div.en-sel-top', typePill(t.project_type),
      t.selection === 'scartato' ? h('span.pill', `scartato ${day(t.selection_changed_at)}`)
        : t.done ? h('span.pill.en-ok', 'Iter completato')
          : t.phase?.due_date ? duePill(t.phase.due_date, 'scade ') : t.selection === 'valutazione' ? h('span.pill', `dal ${day(t.selection_changed_at)}`) : null),
    h('strong.en-sel-title', t.title),
    t.company_name && !t.title.startsWith(t.company_name) ? h('div.t-meta', t.company_name) : null,
    t.selection === 'avviato' && t.phase ? h('div.t-meta', `Fase ${t.phase.n} di ${t.phase.total} · ${t.phase.label}${t.phase.owner_name ? ` · ${t.phase.owner_name}` : ''}`) : null,
    t.selection === 'avviato' && t.phases.length ? h('div.en-sel-steps', { 'aria-hidden': 'true' }, t.phases.map(s => h('i', { class: s === 'fatta' ? 'd' : s === 'attuale' ? 'c' : '' }))) : null,
    t.selection === 'scartato' && t.selection_reason ? h('div.t-meta', `Motivo: ${t.selection_reason}`) : null,
    t.selection !== 'scartato' ? h('div.en-sel-facts',
      h('span', h('small', 'IRR equity'), h('b', t.irr !== null && t.irr !== undefined ? pct(t.irr) : 'manca')),
      h('span', h('small', 'MW'), h('b', t.mw ? num(t.mw, 2) : '—')),
      h('span', h('small', 'Capex'), h('b', t.capex ? `${num(t.capex / 1e6, 2)} M€` : '—'))) : null,
    t.selection === 'valutazione' ? h('div.en-sel-actions', act('Scarta', 'scartato'), act('Avvia la DD tecnica', 'avviato', true)) : null,
    t.selection === 'scartato' ? h('div.en-sel-actions', act('Rimetti in valutazione', 'valutazione')) : null);
  }
  await load();
}

// «Seleziona un progetto»: cerca un'opportunità non ancora selezionata e sceglie il tipo di progetto.
function pickDialog(onDone) {
  const list = h('div.en-pick-list', loading());
  const q = h('input.input', { type: 'search', placeholder: 'Cerca un\'opportunità…', autofocus: true });
  const search = async () => {
    const { opportunities } = await get(`/api/energy/opportunities${qs({ q: q.value.trim(), limit: 30 })}`);
    const free = opportunities.filter(o => o.stage !== 'target' && !meta.closedStages.includes(o.stage));
    fill(list, free.length ? free.map(o => h('button.en-pick', { type: 'button', on: { click: () => { m.close(); selectDialog(o, onDone); } } },
      h('strong', o.title), h('span.t-meta', [meta.kinds[o.kind], o.company_name, o.mw ? `${num(o.mw, 2)} MW` : null].filter(Boolean).join(' · '))))
      : h('div.muted', 'Nessuna opportunità da selezionare con questa ricerca.'));
  };
  q.addEventListener('input', debounce(search));
  const m = modal({ title: 'Seleziona un progetto', body: h('div.en-form', q, list), actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')] });
  search();
}

// Conferma la selezione con il tipo di progetto (il modello dell'iter).
export function selectDialog(o, onDone) {
  const proposed = o.kind === 'revamping' ? 'revamping' : o.kind === 'ppa_onsite' ? 'ppa_onsite' : 'fv_nuovo';
  const type = select(Object.entries(meta.projectTypes), proposed);
  const m = modal({
    title: `Seleziona «${o.title}»`,
    body: h('div.en-form',
      h('p', 'Il progetto entra fra i Progetti selezionati, colonna «In valutazione». L\'iter del tipo parte con «Avvia la DD tecnica».'),
      field('Tipo di progetto', type, 'Sceglie il modello delle fasi; si può cambiare dopo.')),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await post(`/api/energy/opportunities/${o.id}/target`, { project_type: type.value });
        m.close();
        toast('Progetto selezionato: in valutazione');
        onDone?.(o.id);
      } } }, 'Seleziona')],
  });
}

// Pulsante «Seleziona come progetto» per la scheda dell'opportunità.
export function selectAsTargetButton(o, onDone) {
  return h('button.btn', {
    type: 'button', disabled: meta.closedStages.includes(o.stage),
    title: 'Entra fra i Progetti selezionati, in valutazione',
    on: { click: () => selectDialog(o, onDone) },
  }, icon('folder', { size: 15 }), 'Seleziona come progetto');
}

// La scheda del progetto selezionato è la pagina dell'opportunità, tab «Iter».
export function openTarget(id) {
  location.hash = `#/energy/opportunita/${id}/iter`;
}

// ── iter del progetto ────────────────────────────────────────────────────────
export async function targetTab(box, projectId, oppId) {
  fill(box, loading());
  try {
    await ensureMeta();
    const id = oppId || (await get(`/api/energy/projects/${projectId}/opportunity`, { quiet: true })).id;
    const d = await get(`/api/energy/opportunities/${id}/iter`, { quiet: true });
    renderIter(box, d, { selected: null, editing: false });
  } catch (err) {
    fill(box, h('div.card.empty', err.status === 403 ? 'Il progetto lo vedono solo i membri di Alma Energy.' : err.message));
  }
}

function renderIter(box, d, ui) {
  const redraw = next => renderIter(box, next || d, ui);
  const call = async (method, path, body) => redraw(await api(method, path, body));
  const phases = d.phases;
  const curIdx = d.current;
  if (ui.selected === null || !phases.some(p => p.id === ui.selected)) ui.selected = phases[curIdx >= 0 ? curIdx : phases.length - 1]?.id ?? null;
  const shown = phases.find(p => p.id === ui.selected);

  // intestazione: colonna della pipeline, tipo, azioni
  const go = async to => { if (await moveTo(d.id, to, d.title)) redraw(await get(`/api/energy/opportunities/${d.id}/iter`)); };
  const typeSel = select(Object.entries(meta.projectTypes), d.project_type, { 'aria-label': 'Tipo di progetto', on: { change: async e => {
    await call('PATCH', `/api/energy/opportunities/${d.id}/iter`, { project_type: e.target.value });
    toast(phases.length ? 'Tipo cambiato: le fasi già create restano' : 'Tipo cambiato');
  } } });
  const head = h('section.card.sw-card.en-iter-head',
    h('div.en-iter-head-row',
      h('div', h('div.en-eyebrow', 'Progetto selezionato'),
        h('div.en-iter-pills', h('span.pill.en-sel-pill', { class: `en-sel-${d.selection}` }, meta.selection[d.selection]), typeSel)),
      h('div.en-stage-row',
        d.selection === 'valutazione' ? [h('button.btn', { type: 'button', on: { click: () => go('scartato') } }, 'Scarta'),
          h('button.btn.btn-primary', { type: 'button', on: { click: () => go('avviato') } }, 'Avvia la DD tecnica')] : null,
        d.selection === 'avviato' ? [
          h('button.btn', { type: 'button', 'aria-pressed': String(ui.editing), class: ui.editing ? 'on' : '', on: { click: () => { ui.editing = !ui.editing; redraw(); } } },
            icon('pencil', { size: 15 }), ui.editing ? 'Fine modifiche' : 'Modifica iter'),
          h('button.btn.btn-ghost', { type: 'button', on: { click: () => go('scartato') } }, 'Scarta')] : null,
        d.selection === 'scartato' ? h('button.btn.btn-primary', { type: 'button', on: { click: () => go('valutazione') } }, icon('refresh', { size: 15 }), 'Rimetti in valutazione') : null)),
    d.selection === 'scartato' ? h('div.banner', `Scartato il ${day(d.selection_changed_at)}${d.selection_reason ? `: ${d.selection_reason}` : ''}`) : null,
    analysisBox(d, async () => redraw(await get(`/api/energy/opportunities/${d.id}/iter`))));

  if (d.selection === 'valutazione' && !phases.length) {
    return fill(box, head, h('section.card.sw-card.en-iter-empty',
      h('h3', 'Iter non ancora partito'),
      h('p.muted', `Con «Avvia la DD tecnica» nascono le fasi del modello «${typeLabel(d.project_type)}», con i punti da spuntare e una riga per fase nel Gantt. Le fasi si possono cambiare per questo progetto.`)),
    historyBox(d));
  }

  const stepper = h('ol.en-iter-steps', { 'aria-label': 'Fasi dell\'iter' }, phases.map((p, i) => h('li',
    h('button.en-iter-step', { type: 'button', class: `${p.state}${p.id === ui.selected ? ' sel' : ''}`, 'aria-current': p.state === 'attuale' ? 'step' : null,
      on: { click: () => { ui.selected = p.id; redraw(); } } },
    h('span.en-iter-dot', p.state === 'fatta' ? icon('check', { size: 13 }) : String(i + 1)),
    h('b', p.label),
    h('span.en-iter-step-sub', p.state === 'fatta' ? `chiusa · ${p.items_done}/${p.items.length}` : p.state === 'attuale' ? `in corso · ${p.items_done}/${p.items.length}` : p.due_date ? day(p.due_date) : '—')))));

  fill(box, head,
    d.done ? h('div.banner.en-ok', 'Tutte le fasi sono chiuse: iter completato.') : null,
    stepper,
    phases.some(p => p.added) ? h('p.muted.en-iter-note', `Partito dal modello «${typeLabel(d.project_type)}». Aggiunte a mano: ${phases.filter(p => p.added).map(p => `«${p.label}»`).join(', ')}.`) : null,
    ui.editing ? editBox(d, call) : null,
    shown ? phaseBox(d, shown, call, ui) : null,
    historyBox(d));
}

// In testa al progetto: l'analisi di riferimento (ALM2-74 tappa 2) con i suoi numeri, le altre analisi allegate e i
// pulsanti per allegarne una libera o farne una nuova per il progetto.
function analysisBox(d, reload) {
  const s = d.scenario;
  const ref = (d.analyses || []).find(x => x.reference);
  const others = (d.analyses || []).filter(x => !x.reference);
  const opp = { id: d.id, title: d.title, kind: d.kind, project_type: d.project_type };
  return h('div.en-iter-analysis',
    h('div', h('div.en-eyebrow', 'Analisi di riferimento'),
      ref ? h('a.en-iter-ref', { href: `#/energy/analisi/${ref.id}` }, `${ref.title} · v${ref.n || 1}`)
        : s ? h('strong', s.name || 'Scenario scelto') : h('span.pill.en-due-soon', 'Da completare'),
      others.length ? h('div.t-meta', 'Altre: ', others.map((x, i) => [i ? ', ' : '', h('a', { href: `#/energy/analisi/${x.id}` }, `${x.title} v${x.n || 1}`)])) : null,
      h('div.en-iter-ref-actions',
        h('button.btn.btn-sm', { type: 'button', on: { click: () => pickFreeDialog(opp, reload) } }, ref ? 'Allega un\'altra analisi' : 'Allega un\'analisi'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => newDialog({ source: 'simulatore', opportunity: opp, reference: !ref }) } }, icon('plus', { size: 14 }), 'Nuova analisi'))),
    h('div.en-iter-facts',
      h('span', h('small', 'IRR equity'), h('b', s?.irr !== undefined && s?.irr !== null ? pct(s.irr) : 'manca')),
      h('span', h('small', 'VAN'), h('b', s?.npv !== undefined && s?.npv !== null ? `${num(s.npv / 1e6, 2)} M€` : '—')),
      h('span', h('small', 'Payback'), h('b', s?.payback ? `${num(s.payback, 1)} anni` : '—')),
      h('span', h('small', 'MW'), h('b', d.mw ? num(d.mw, 2) : '—')),
      h('span', h('small', 'Capex'), h('b', d.capex ? `${num(d.capex / 1e6, 2)} M€` : '—')),
      h('span', h('small', 'Responsabile'), h('b', d.owner_name || '—'))));
}

// La fase scelta: responsabile, scadenza, punti da spuntare, chiudi o riapri.
function phaseBox(d, p, call, ui) {
  const base = `/api/energy/iter/phases/${p.id}`;
  const locked = d.selection !== 'avviato';
  const owner = select(userOptions(), p.owner_id || '', { disabled: locked, 'aria-label': 'Responsabile della fase', on: { change: e => call('PATCH', base, { owner_id: e.target.value || null }) } });
  const due = h('input.input', { type: 'date', value: p.due_date || '', disabled: locked, 'aria-label': 'Scadenza della fase', on: { change: e => call('PATCH', base, { due_date: e.target.value || null }) } });
  const newItem = h('input.input.grow', { placeholder: 'Nuovo punto…', disabled: locked, maxlength: 200, on: { keydown: e => { if (e.key === 'Enter') addItem(); } } });
  const addItem = () => { const label = newItem.value.trim(); if (label) call('POST', `${base}/items`, { label }); };
  const close = async () => {
    try {
      return renderClose(await api('POST', `${base}/close`, {}, { quiet: true }));
    } catch (err) {
      if (err.code !== 'checklist') return toast(err.message, 'err');
      const reason = await promptDialog('Ci sono punti ancora aperti', { label: 'Perché si chiude lo stesso?', ok: 'Chiudi la fase' });
      if (reason) renderClose(await post(`${base}/close`, { reason }));
    }
  };
  const renderClose = next => { toast(`Fase chiusa: ${p.label}`); ui.selected = null; call('GET', `/api/energy/opportunities/${d.id}/iter`); return next; };
  return h('section.card.sw-card.en-iter-phase',
    h('div.en-iter-phase-head',
      h('div', h('h2', `Fase ${p.position} · ${p.label}`),
        h('div.t-meta', p.state === 'fatta' ? `Chiusa il ${when(p.done_at)}` : p.state === 'attuale' ? 'In corso' : 'Da fare')),
      h('div.en-stage-row',
        p.state === 'attuale' ? h('button.btn.btn-primary', { type: 'button', on: { click: close } }, icon('check', { size: 15 }), 'Chiudi la fase') : null,
        p.state === 'fatta' && !locked ? h('button.btn', { type: 'button', on: { click: async () => {
          if (await confirmDialog(`Riaprire «${p.label}»? Si riaprono anche le fasi dopo.`, { ok: 'Riapri' })) call('POST', `${base}/reopen`);
        } } }, icon('rotate-ccw', { size: 15 }), 'Riapri') : null)),
    h('div.en-iter-phase-fields', field('Responsabile', owner), field('Scadenza', due)),
    h('div.en-iter-items', p.items.length ? p.items.map(it => h('div.en-iter-item',
      h('label.en-check', h('input', { type: 'checkbox', checked: Boolean(it.done), disabled: locked, on: { change: e => call('PATCH', `${base}/items/${encodeURIComponent(it.key)}`, { done: e.target.checked }) } }),
        h('span', it.label)),
      it.added ? h('span.pill', 'aggiunto') : null,
      it.due_date ? duePill(it.due_date) : null,
      !locked ? h('button.btn.btn-ghost.btn-sm.en-iter-x', { type: 'button', 'aria-label': `Togli «${it.label}»`, on: { click: async () => {
        if (await confirmDialog(`Togliere «${it.label}» da questa fase?`, { ok: 'Togli', danger: true })) call('DELETE', `${base}/items/${encodeURIComponent(it.key)}`);
      } } }, icon('x', { size: 14 })) : null))
      : h('p.muted', 'Nessun punto in questa fase.')),
    !locked ? h('div.en-iter-add', newItem, h('button.btn.btn-sm', { type: 'button', on: { click: addItem } }, icon('plus', { size: 14 }), 'Aggiungi un punto')) : null,
    h('p.muted.en-iter-note', 'I documenti della fase si caricano nel tab «Documenti» del progetto.'));
}

// «Modifica iter»: rinomina, sposta, togli e aggiungi fasi solo per questo progetto.
function editBox(d, call) {
  const newPhase = h('input.input.grow', { placeholder: 'Nome della nuova fase…', maxlength: 120 });
  const after = select([['', 'in fondo'], ...d.phases.map(p => [p.id, `dopo «${p.label}»`])], '', { 'aria-label': 'Dove' });
  return h('section.card.sw-card.en-iter-edit',
    h('div.en-iter-phase-head', h('div', h('h2', 'Modifica iter'),
      h('div.t-meta', 'Vale solo per questo progetto. Il modello del tipo si cambia da «Modelli di iter».'))),
    h('ol.en-iter-edit-list', d.phases.map((p, i) => {
      const name = h('input.input.grow', { value: p.label, maxlength: 120, 'aria-label': `Nome della fase ${i + 1}`, on: { change: e => {
        if (e.target.value.trim() && e.target.value.trim() !== p.label) call('PATCH', `/api/energy/iter/phases/${p.id}`, { label: e.target.value.trim() });
      } } });
      return h('li', h('span.en-iter-dot', { class: p.state }, String(i + 1)), name,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: i === 0, 'aria-label': 'Sposta su', on: { click: () => call('POST', `/api/energy/iter/phases/${p.id}/move`, { dir: -1 }) } }, icon('chevron-up', { size: 15 })),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: i === d.phases.length - 1, 'aria-label': 'Sposta giù', on: { click: () => call('POST', `/api/energy/iter/phases/${p.id}/move`, { dir: 1 }) } }, icon('chevron-down', { size: 15 })),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: d.phases.length <= 1, 'aria-label': `Togli «${p.label}»`, on: { click: async () => {
          if (await confirmDialog(`Togliere la fase «${p.label}» e la sua riga del Gantt?`, { ok: 'Togli', danger: true })) call('DELETE', `/api/energy/iter/phases/${p.id}`);
        } } }, icon('trash', { size: 15 })));
    })),
    h('div.en-iter-add', newPhase, after, h('button.btn.btn-sm', { type: 'button', on: { click: () => {
      const label = newPhase.value.trim();
      if (label) call('POST', `/api/energy/opportunities/${d.id}/iter/phases`, { label, after: after.value ? Number(after.value) : null });
    } } }, icon('plus', { size: 14 }), 'Aggiungi la fase')));
}

const HISTORY = { 'sel:valutazione': 'In valutazione', 'sel:avviato': 'DD tecnica avviata', 'sel:scartato': 'Scartato', target: 'Selezionato',
  'fase:chiusa': 'Fase chiusa', 'fase:riaperta': 'Fase riaperta', 'fase:aggiunta': 'Fase aggiunta', 'fase:tolta': 'Fase tolta' };
function historyBox(d) {
  if (!d.history.length) return null;
  return h('section.card.sw-card.en-iter-history', h('h3', 'Storico'), h('ul.en-history', d.history.map(x => h('li',
    h('strong', HISTORY[x.to_stage] || x.to_stage), x.note ? h('span.muted', ` · ${x.note}`) : null,
    h('div.t-meta', [when(x.at), x.user_name].filter(Boolean).join(' · '))))));
}

// ── modelli di iter (Strumenti) ──────────────────────────────────────────────
export async function templatesView(box) {
  await ensureMeta();
  let data = await get('/api/energy/iter/templates');
  let type = Object.keys(data.types)[0];
  const seg = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Tipo di progetto' });
  const body = h('div');
  fill(box, h('p.muted.en-lead', 'Il modello è l\'iter da cui parte ogni progetto del tipo quando si avvia la DD tecnica. Cambiarlo non tocca i progetti già partiti.'),
    h('div.toolbar', seg), body);
  const draw = () => {
    fill(seg, Object.entries(data.types).map(([k, label]) => h('button', { type: 'button', class: k === type ? 'on' : '', on: { click: () => { type = k; draw(); } } }, label)));
    const t = data.templates[type];
    let phases = t.phases.map(p => ({ ...p, items: p.items.map(([k, l]) => [k, l]) }));
    const list = h('div.en-tpl-list');
    const render = () => fill(list, phases.map((p, i) => {
      const name = h('input.input.grow', { value: p.label, maxlength: 120, 'aria-label': `Nome della fase ${i + 1}`, on: { input: e => { p.label = e.target.value; } } });
      const days = h('input.input.en-tpl-days', { type: 'number', min: 1, max: 730, value: p.days, 'aria-label': 'Giorni lavorativi', on: { input: e => { p.days = Number(e.target.value); } } });
      const items = h('textarea.input', { rows: Math.max(3, p.items.length), 'aria-label': `Punti della fase ${i + 1}, uno per riga`, on: { input: e => {
        const old = Object.fromEntries(p.items.map(([k, l]) => [l, k]));
        p.items = e.target.value.split('\n').map(x => x.trim()).filter(Boolean).map((l, j) => [old[l] || `p${j + 1}_${Date.now().toString(36)}`, l]);
      } } }, p.items.map(([, l]) => l).join('\n'));
      return h('section.card.sw-card.en-tpl-phase',
        h('div.en-tpl-row', h('span.en-iter-dot', String(i + 1)), name, field('Giorni', days),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: i === 0, 'aria-label': 'Sposta su', on: { click: () => { [phases[i - 1], phases[i]] = [phases[i], phases[i - 1]]; render(); } } }, icon('chevron-up', { size: 15 })),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: i === phases.length - 1, 'aria-label': 'Sposta giù', on: { click: () => { [phases[i + 1], phases[i]] = [phases[i], phases[i + 1]]; render(); } } }, icon('chevron-down', { size: 15 })),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', disabled: phases.length <= 1, 'aria-label': `Togli «${p.label}»`, on: { click: () => { phases.splice(i, 1); render(); } } }, icon('trash', { size: 15 }))),
        field('Punti da spuntare, uno per riga', items));
    }));
    render();
    fill(body,
      h('div.en-tpl-meta.muted', t.custom ? `Modello cambiato${t.updated_by ? ` da ${t.updated_by}` : ''} il ${when(t.updated_at)}.` : 'Modello di partenza.'),
      list,
      h('div.en-stage-row',
        h('button.btn', { type: 'button', on: { click: () => { phases.push({ key: '', label: 'Nuova fase', days: 10, items: [] }); render(); } } }, icon('plus', { size: 15 }), 'Aggiungi una fase'),
        t.custom ? h('button.btn.btn-ghost', { type: 'button', on: { click: async () => {
          if (!await confirmDialog(`Tornare al modello di partenza per «${data.types[type]}»?`, { ok: 'Ripristina' })) return;
          await del(`/api/energy/iter/templates/${type}`);
          data = await get('/api/energy/iter/templates');
          toast('Modello ripristinato');
          draw();
        } } }, 'Torna al modello di partenza') : null,
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          await put(`/api/energy/iter/templates/${type}`, { phases });
          data = await get('/api/energy/iter/templates');
          toast('Modello salvato');
          draw();
        } } }, 'Salva il modello')));
  };
  draw();
}
