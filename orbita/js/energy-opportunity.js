// Alma Energy: pagina dell'opportunità (ALM2-24). È la pagina di un progetto di Alma Planet (Panoramica, Gantt, Ticket,
// Documenti, Email, Incontri, Note, Membri) con in più lo stadio nell'intestazione, il tab «Opportunità» con i dati
// e, per gli Impianti target, il tab «Iter». Il progetto nasce quando l'opportunità supera il primo stadio (deciso da
// Dante il 02/11): prima la pagina ha la stessa forma, con il solo tab «Opportunità».
// Lo stadio funziona come nelle opportunità di BOSS: pulsante avanti con il nome dell'azione e la finestra di quello che
// serve, «Indietro», menu con persa, scartata, standby e «Riapri» con la motivazione.
import { h, fill, modal, toast, loading } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';
import { meta, num, field, select, kindPill, stagePill, stageLabel, opportunitySheet } from './energy.js';
import { projectDetail } from './projects.js';
import { targetTab, selectAsTargetButton } from './energy-target.js';

const PIPELINE_TAB = { ppa_onsite: 'ppa', revamping: 'revamping', fv_classico: 'fv' };
const PROJECT_TABS = ['Panoramica', 'Gantt', 'Ticket', 'Documenti', 'Email', 'Incontri', 'Note', 'Membri'];

export async function opportunityPage(container, id) {
  fill(container, loading());
  let o;
  try {
    o = await get(`/api/energy/opportunities/${id}`, { quiet: true });
  } catch (err) {
    return fill(container, h('div.card.empty', err.status === 404 ? 'Opportunità non trovata.' : err.message, ' ', h('a', { href: '#/energy/opportunita' }, 'Tutte le opportunità')));
  }
  const refresh = () => opportunityPage(container, id);
  const base = `#/energy/opportunita/${id}`;
  const crumb = { href: `#/energy/${PIPELINE_TAB[o.kind]}`, label: meta.kinds[o.kind] };
  const sheetTab = box => box.append(opportunitySheet(o, refresh));
  if (o.project_id) {
    return projectDetail(container, o.project_id, {
      base, crumb, defaultTab: 'opportunita', head: stageBar(o, refresh),
      actions: () => null, // nome e responsabile si cambiano dal tab «Opportunità»
      extraTabs: [
        ['opportunita', 'Opportunità', sheetTab],
        ...(o.target_step ? [['iter', 'Iter del target', box => targetTab(box, o.project_id)]] : []),
      ],
    });
  }
  // ancora al primo stadio: la stessa intestazione dei progetti, senza progetto
  history.replaceState(null, '', `${base}/opportunita`);
  const content = h('div.pj-content');
  fill(container, h('div.pj',
    h('header.pj-head', { style: { '--c': '#F2A900' } },
      h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: crumb.href }, icon('chevron-left', { size: 16 }), crumb.label)),
      h('div.pj-row', h('div.pj-title',
        h('div.pj-name', h('span.pj-swatch'), h('h1', o.title), kindPill(o.kind)),
        h('div.pj-meta', [o.owner_name ? `Responsabile ${o.owner_name}` : 'Senza responsabile', o.company_name].filter(Boolean).join('  ·  ')))),
      h('div.pj-facts',
        fact('Priorità', o.priority || '—'), fact('Potenza', o.mw ? `${num(o.mw, 2)} MW` : '—'),
        fact('Capex', o.capex ? `${num(Math.round(o.capex / 1000))} k€` : '—'), fact('Luogo', [o.city, o.province].filter(Boolean).join(', ') || '—')),
      stageBar(o, refresh)),
    h('nav.pj-nav', { role: 'tablist', 'aria-label': 'Sezioni dell\'opportunità' },
      h('button.pj-tab.on', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Opportunità'),
      PROJECT_TABS.map(label => h('button.pj-tab', { type: 'button', role: 'tab', disabled: true, title: 'Arriva quando l\'opportunità supera il primo stadio' }, label))),
    content));
  sheetTab(content);
}

const fact = (label, value) => h('div.pj-fact', h('span.pj-fact-label', label), h('span.pj-fact-value', value));

// ── stadio ───────────────────────────────────────────────────────────────────
function stageBar(o, refresh) {
  const open = meta.stages[o.kind].map(([k]) => k).filter(k => k !== 'target' && !meta.closedStages.includes(k));
  const closed = meta.closedStages.includes(o.stage);
  const isTarget = Boolean(o.target_step);
  const cur = open.indexOf(o.stage);
  // da uno stadio chiuso si torna (di solito) dove si era: l'ultimo stadio aperto dello storico
  const lastOpen = o.history.map(x => x.from_stage).find(s => open.includes(s)) || open[0];
  const steps = h('ol.en-stagebar-steps', open.map((k, i) => h('li', {
    class: isTarget || (!closed && i < cur) ? 'done' : !closed && i === cur ? 'now' : '',
  }, h('span.en-stagebar-dot', isTarget || (!closed && i < cur) ? icon('check', { size: 12 }) : String(i + 1)), h('span', stageLabel(o.kind, k)))));

  const next = !closed && !isTarget && cur >= 0 ? open[cur + 1] : null;
  const prev = !closed && !isTarget && cur > 0 ? open[cur - 1] : null;
  const actions = [];
  if (isTarget) {
    actions.push(h('span.pill.en-stage.en-target', h('span.dot'),
      o.target_outcome ? meta.targetOutcomes[o.target_outcome] : `Target · ${meta.targetSteps.find(s => s.key === o.target_step)?.label}`),
    h('a.btn.btn-primary', { href: `#/energy/opportunita/${o.id}/iter` }, 'Apri l\'iter'));
  } else if (closed) {
    actions.push(stagePill(o.kind, o.stage),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => reopenDialog(o, open, lastOpen, refresh) } }, icon('refresh', { size: 15 }), 'Riapri'));
  } else {
    if (prev) actions.push(h('button.btn.btn-ghost', { type: 'button', on: { click: () => moveDialog(o, prev, refresh, { back: true }) } }, icon('chevron-left', { size: 15 }), 'Indietro'));
    if (next) actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: () => moveDialog(o, next, refresh) } },
      meta.forwardActions[o.kind]?.[next] || `Passa a «${stageLabel(o.kind, next)}»`));
    actions.push(selectAsTargetButton(o, () => { location.hash = `#/energy/opportunita/${o.id}/iter`; refresh(); }));
    actions.push(h('details.en-more',
      h('summary.btn.btn-ghost', { 'aria-label': 'Altri passaggi' }, icon('more', { size: 16 })),
      h('div.en-more-menu', { role: 'menu' },
        h('button', { type: 'button', role: 'menuitem', on: { click: () => closeDialog(o, 'perso', refresh) } }, 'Segna come persa'),
        h('button', { type: 'button', role: 'menuitem', on: { click: () => closeDialog(o, 'scartato', refresh) } }, 'Scarta'),
        h('button', { type: 'button', role: 'menuitem', on: { click: () => closeDialog(o, 'standby', refresh) } }, 'Metti in standby'))));
  }
  return h('div.en-stagebar', steps, h('div.en-stagebar-actions', actions));
}

// Avanti o indietro: la finestra mostra cosa serve (come i campi richiesti del blueprint di BOSS) e se nasce il progetto.
async function moveDialog(o, stage, refresh, { back = false } = {}) {
  const info = await get(`/api/energy/opportunities/${o.id}/stage/${stage}`);
  const missing = info.requirements.filter(r => !r.ok);
  const note = h('textarea.input', { rows: 2, placeholder: 'Facoltativa' });
  const go = h('button.btn.btn-primary', { type: 'button', disabled: missing.length > 0, on: { click: async () => {
    await post(`/api/energy/opportunities/${o.id}/stage`, { stage, note: note.value.trim() });
    m.close();
    toast(`Stadio: ${stageLabel(o.kind, stage)}`);
    refresh();
  } } }, back ? 'Torna indietro' : meta.forwardActions[o.kind]?.[stage] || 'Conferma');
  const m = modal({
    title: back ? `Torna a «${stageLabel(o.kind, stage)}»` : `Passa a «${stageLabel(o.kind, stage)}»`,
    body: h('div.en-form',
      info.requirements.length ? h('ul.en-reqs', info.requirements.map(r => h('li', { class: r.ok ? 'ok' : 'ko' },
        icon(r.ok ? 'check' : 'x', { size: 15 }), h('div', h('span', r.label), r.ok ? null : h('div.t-meta', r.hint))))) : null,
      info.creates_project ? h('p.banner', 'Nasce il progetto dell\'opportunità in Alma Planet: Gantt, ticket, documenti, email, incontri, note e membri (i membri di Alma Energy).') : null,
      field('Nota sul passaggio', note)),
    actions: [go],
  });
}

// Persa e scartata chiedono il motivo; lo standby una nota facoltativa.
function closeDialog(o, stage, refresh) {
  const reason = h('textarea.input', { rows: 2 });
  const titles = { perso: 'Segna come persa', scartato: 'Scarta l\'opportunità', standby: 'Metti in standby' };
  const m = modal({
    title: titles[stage],
    body: h('div.en-form',
      stage === 'scartato' ? h('p.muted', 'Scartata: non ci interessa (o non è fattibile) senza esserci arrivati a una trattativa.') : null,
      stage === 'standby' ? h('p.muted', 'Ferma per ora: si riapre da qui con «Riapri».') : null,
      field(stage === 'standby' ? 'Nota (facoltativa)' : 'Motivo', reason)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const text = reason.value.trim();
      if (stage !== 'standby' && !text) return toast('Scrivi il motivo', 'err');
      await post(`/api/energy/opportunities/${o.id}/stage`, stage === 'standby' ? { stage, note: text } : { stage, lost_reason: text });
      m.close();
      toast(titles[stage]);
      refresh();
    } } }, titles[stage])],
  });
}

// Riapri da persa, scartata o standby: si sceglie lo stadio e si scrive perché.
function reopenDialog(o, open, suggested, refresh) {
  const to = select(open.map(k => [k, stageLabel(o.kind, k)]), suggested);
  const why = h('textarea.input', { rows: 2 });
  const m = modal({
    title: 'Riapri l\'opportunità',
    body: h('div.en-form', field('Riparte da', to), field('Perché la riapri', why)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!why.value.trim()) return toast('Scrivi perché la riapri', 'err');
      await post(`/api/energy/opportunities/${o.id}/stage`, { stage: to.value, note: why.value.trim() });
      m.close();
      toast('Opportunità riaperta');
      refresh();
    } } }, 'Riapri')],
  });
}
