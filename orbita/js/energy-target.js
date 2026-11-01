// Alma Energy: Impianti target (ALM2-15 … ALM2-17). Kanban per step dell'iter commerciale (contatto del venditore,
// due diligence tecnica e legale, approvazione dell'investimento, offerta) con gli esiti; iter con checklist nella
// scheda del target e nel tab «Impianto» del progetto di Alma Planet; «Seleziona come target» dalle pipeline.
import { h, fill, modal, toast, loading, debounce, confirmDialog, promptDialog } from './ui.js';
import { get, post, patch, api, qs } from './api.js';
import { icon } from './icons.js';
import { meta, num, select, openOpportunity, ensureMeta } from './energy.js';

const KIND_SHORT = { ppa_onsite: 'PPA on-site', revamping: 'Revamping', fv_classico: 'FV classico' };
const kindPill = kind => h('span.pill.en-tk', { class: `en-tk-${kind}` }, KIND_SHORT[kind] || kind);
const pct = n => (n === null || n === undefined ? null : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const when = iso => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');

// ── kanban dei target ────────────────────────────────────────────────────────
export async function targetsView(box) {
  const state = { q: '', kind: '' };
  const board = h('div.en-board-wrap', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome o azienda…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      select([['', 'Tutti i tipi'], ...Object.entries(KIND_SHORT)], '', { on: { change: e => { state.kind = e.target.value; load(); } } })),
    board);
  async function load() {
    const { columns } = await get(`/api/energy/targets${qs(state)}`);
    if (!columns.some(c => c.count) && !state.q && !state.kind) {
      return fill(board, h('div.card.empty', 'Nessun Impianto target. Si sceglie dalla scheda di un\'opportunità con «Seleziona come target» (per il FV classico da RTB).'));
    }
    fill(board, h('div.en-board', columns.map(c => h('section.en-col', { class: c.key === 'perso' ? 'lost' : c.key === 'acquisito' ? 'target' : '' },
      h('header.en-col-head', h('span.en-col-name', c.label), h('span.en-col-n', num(c.count))),
      c.mw ? h('div.en-col-sub', `${num(c.mw, 1)} MW`) : null,
      h('div.en-cards', c.cards.map(t => h('article.en-card', { tabindex: 0, on: {
        click: () => openTarget(t.id, load), keydown: e => { if (e.key === 'Enter') openTarget(t.id, load); },
      } },
      h('div.en-card-top', kindPill(t.kind), h('span.en-card-title', t.title)),
      t.company_name && !t.title.startsWith(t.company_name) ? h('div.t-meta', t.company_name) : null,
      h('div.en-card-meta', [t.mw ? `${num(t.mw, 2)} MW` : null, t.irr !== null ? `IRR ${pct(t.irr)}` : null].filter(Boolean).join(' · ') || null),
      t.target_outcome ? null : h('div.en-progress', { title: 'Checklist dello step' },
        h('i', { style: { width: `${t.checklist_total ? (t.checklist_done / t.checklist_total) * 100 : 0}%` } }),
        h('span', `${t.checklist_done}/${t.checklist_total}`)),
      h('div.t-meta', t.owner_name || ''))))))));
  }
  await load();
}

// ── iter del target: step, checklist, avanzamento ed esito ───────────────────
function iterPanel(d, refresh, { inProject = false } = {}) {
  const cur = d.steps.find(s => s.state === 'attuale');
  const next = cur ? d.steps[d.steps.indexOf(cur) + 1] : null;
  const advance = async step => {
    try {
      await api('POST', `/api/energy/opportunities/${d.id}/target/step`, { step: step.key }, { quiet: true });
    } catch (err) {
      if (err.code !== 'checklist') return toast(err.message, 'err');
      const reason = await promptDialog('La checklist non è completa', { label: `${err.message.split('.')[0]}. Perché si va avanti lo stesso?`, ok: 'Vai avanti' });
      if (!reason) return;
      await post(`/api/energy/opportunities/${d.id}/target/step`, { step: step.key, reason });
    }
    toast(`Step: ${step.label}`);
    refresh();
  };
  const outcome = async value => {
    if (value === 'acquisito' && !await confirmDialog(`Segnare «${d.title}» come acquisito? Il progetto passa a concluso.`, { ok: 'Acquisito' })) return;
    let note = '';
    if (value === 'perso') {
      note = await promptDialog('Perché è perso?', { label: 'Motivo', ok: 'Segna come perso' });
      if (!note) return;
    }
    await post(`/api/energy/opportunities/${d.id}/target/esito`, { outcome: value, note });
    toast(value ? meta.targetOutcomes[value] : 'Iter riaperto');
    refresh();
  };
  return h('div.en-detail',
    h('ol.en-steps', d.steps.map((s, i) => h('li', { class: `en-step-${s.state}` },
      h('span.en-step-n', s.state === 'fatto' ? icon('check', { size: 14 }) : String(i + 1)), h('span', s.label)))),
    d.target_outcome ? h('div.banner', { class: d.target_outcome === 'acquisito' ? 'en-ok' : '' }, `Esito: ${meta.targetOutcomes[d.target_outcome]}`) : null,
    d.steps.filter(s => s.state === 'attuale' || s.checklist.some(c => c.done)).map(s => h('section.en-sec',
      h('h3', s.state === 'attuale' ? `Checklist · ${s.label}` : s.label),
      h('div.en-checklist', s.checklist.map(c => h('label.en-check', h('input', { type: 'checkbox', checked: c.done, disabled: Boolean(d.target_outcome), on: { change: async e => {
        await patch(`/api/energy/opportunities/${d.id}/target/checklist`, { step: s.key, item: c.key, done: e.target.checked });
        refresh();
      } } }), c.label))))),
    h('div.en-stage-row',
      !d.target_outcome && next ? h('button.btn.btn-primary', { type: 'button', on: { click: () => advance(next) } }, `Passa a «${next.label}»`) : null,
      !d.target_outcome ? h('button.btn', { type: 'button', on: { click: () => outcome('acquisito') } }, icon('check', { size: 15 }), 'Acquisito') : null,
      !d.target_outcome ? h('button.btn.btn-ghost', { type: 'button', on: { click: () => outcome('perso') } }, 'Perso') : null,
      d.target_outcome ? h('button.btn', { type: 'button', on: { click: () => outcome(null) } }, 'Riapri l\'iter') : null,
      !d.target_outcome && cur && d.steps.indexOf(cur) > 0 ? h('button.btn.btn-ghost', { type: 'button', on: { click: () => advance(d.steps[d.steps.indexOf(cur) - 1]) } }, 'Torna indietro') : null),
    h('section.en-sec', h('h3', 'Impianto'), h('dl.en-dl',
      h('dt', 'Tipo'), h('dd', KIND_SHORT[d.kind]), h('dt', 'Azienda'), h('dd', d.company_name || '—'),
      h('dt', 'MW'), h('dd', d.mw ? num(d.mw, 3) : '—'), h('dt', 'Capex'), h('dd', d.capex ? `${num(d.capex)} €` : '—'),
      h('dt', 'Scenario scelto'), h('dd', d.scenario ? `${d.scenario.name}${d.scenario.irr !== undefined ? ` · IRR ${pct(d.scenario.irr)}` : ''}` : '—'),
      h('dt', 'Responsabile'), h('dd', d.owner_name || '—')),
    h('div.en-stage-row',
      h('button.btn.btn-sm', { type: 'button', on: { click: () => openOpportunity(d.id, refresh) } }, 'Scheda dell\'impianto (aziende, persone, scenari)'),
      inProject ? null : h('a.btn.btn-sm', { href: `#/projects/${d.project_id}/gantt` }, icon('folder', { size: 15 }), 'Apri il progetto'))),
    d.history.length ? h('section.en-sec', h('h3', 'Storico dell\'iter'), h('ul.en-history', d.history.map(x => h('li',
      h('strong', historyLabel(x.to_stage)), x.note ? h('span.muted', ` · ${x.note}`) : null,
      h('div.t-meta', [when(x.at), x.user_name].filter(Boolean).join(' · ')))))) : null);
}

function historyLabel(s) {
  if (s === 'target') return 'Selezionato come Impianto target';
  if (s.startsWith('step:')) return meta.targetSteps.find(x => x.key === s.slice(5))?.label || s;
  if (s === 'esito:riaperto') return 'Iter riaperto';
  if (s.startsWith('esito:')) return meta.targetOutcomes[s.slice(6)] || s;
  return s;
}

export async function openTarget(id, onChange) {
  const d = await get(`/api/energy/opportunities/${id}/target`);
  const m = modal({
    drawer: true,
    title: h('div', h('h2', d.title), h('div.en-head-pills', kindPill(d.kind), h('span.pill.en-stage', h('span.dot'),
      d.target_outcome ? meta.targetOutcomes[d.target_outcome] : d.steps.find(s => s.state === 'attuale')?.label))),
    body: iterPanel(d, () => { m.close(); onChange?.(); openTarget(id, onChange); }),
  });
}

// Tab «Impianto» nella scheda del progetto di Alma Planet.
export async function targetTab(box, projectId) {
  fill(box, loading());
  let d;
  try {
    await ensureMeta(); // dal progetto la pagina di Alma Energy potrebbe non essere ancora stata aperta
    d = await get(`/api/energy/projects/${projectId}/target`, { quiet: true });
  } catch (err) {
    return fill(box, h('div.card.empty', err.status === 403 ? 'L\'impianto lo vedono solo i membri di Alma Energy.' : err.message));
  }
  fill(box, h('section.card.sw-card.en-target-tab', h('div.en-sec-head', h('h3', d.title), kindPill(d.kind)), iterPanel(d, () => targetTab(box, projectId), { inProject: true })));
}

// Pulsante «Seleziona come target» per la scheda dell'opportunità.
export function selectAsTargetButton(o, onDone) {
  const ready = o.kind !== 'fv_classico' || o.stage === 'rtb';
  return h('button.btn', {
    type: 'button', disabled: !ready || o.stage === 'perso',
    title: ready ? 'Crea il progetto dell\'impianto con l\'iter commerciale' : 'Il FV classico diventa target quando è RTB',
    on: { click: async () => {
      if (!await confirmDialog(`Fare di «${o.title}» un Impianto target? Nasce un progetto di Alma Planet riservato alla BU Energy, con Gantt, ticket, documenti, note e incontri, e l'iter: contatto del venditore, due diligence, approvazione, offerta.`, { ok: 'Seleziona come target' })) return;
      const r = await post(`/api/energy/opportunities/${o.id}/target`, {});
      toast('Impianto target creato');
      onDone?.(r.project_id);
    } },
  }, icon('folder', { size: 15 }), 'Seleziona come target');
}

