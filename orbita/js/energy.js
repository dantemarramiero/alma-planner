// Alma Energy: modulo della BU Energy (business IPP), riservato ai suoi membri.
// Panoramica, pipeline a kanban (energy-pipeline.js), Database Conto Energia, tutte le opportunità con stadio e
// collegamenti, CRM con aziende (filtro per tipo) e persone, membri del modulo. Simulatore e Impianti target arrivano dopo.
import { h, clear, fill, modal, confirmDialog, toast, fmtDate, loading, debounce, isMobile } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { pipelineView, databaseView, kindDetails, deadlinesCard } from './energy-pipeline.js';
import { simulatorView, scenariosSection } from './energy-simulator.js';
import { targetsView, openTarget } from './energy-target.js';
import { paramsView } from './energy-params.js';
import { screeningView } from './energy-screening.js';
import { opportunityPage } from './energy-opportunity.js';

const TABS = [['panoramica', 'Panoramica'], ['ppa', 'PPA on-site'], ['revamping', 'Revamping'], ['fv', 'FV classico'], ['target', 'Impianti target'], ['database', 'Database CE'], ['simulatore', 'Simulatore'], ['parametri', 'Parametri dei tier'], ['screening', 'Screening per provincia'],
  ['opportunita', 'Tutte le opportunità'], ['aziende', 'Aziende'], ['persone', 'Persone'], ['membri', 'Membri']];
const PIPELINE_TABS = { ppa: 'ppa_onsite', revamping: 'revamping', fv: 'fv_classico' };

export let meta = null; // stadi, tipi di azienda, ruoli… dal server
// Per le parti di Alma Energy aperte da fuori (tab «Impianto» del progetto): legge gli elenchi se non ci sono ancora.
export async function ensureMeta() {
  if (!meta) meta = (await get('/api/energy')).meta;
  return meta;
}
export const num = (n, d = 0) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d }));
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
export const stageLabel = (kind, s) => (meta.stages[kind] || []).find(([k]) => k === s)?.[1] || s;
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
export const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('small.muted', hint) : null);
export const input = (attrs = {}) => h('input.input', attrs);
export const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
export const kindPill = kind => h('span.pill.en-kind', { class: `en-k-${kind}` }, meta.kinds[kind]);
export const stagePill = (kind, stage) => h('span.pill.en-stage', { class: meta.closedStages?.includes(stage) ? 'en-lost' : stage === 'target' ? 'en-target' : '' }, h('span.dot'), stageLabel(kind, stage));

// Legge i campi di un form: { nome: valore } dai controlli con data-k.
function read(form) {
  const out = {};
  for (const el of form.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    out[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return out;
}

export async function energyView(container, parts = []) {
  if (!store.me.energy) return fill(container, h('div.card.empty', 'Alma Energy è riservato alla BU Energy.'));
  const tab = TABS.some(([k]) => k === parts[1]) ? parts[1] : 'panoramica';
  // la pagina di un'opportunità ha la sua intestazione, come i progetti (ALM2-24)
  if (tab === 'opportunita' && Number(parts[2])) {
    await ensureMeta();
    return opportunityPage(container, Number(parts[2]));
  }
  const body = h('div.en-body', loading());
  fill(container,
    // le sezioni sono nel menu laterale del modulo (selettore «Modulo» come in MyWinery): qui il titolo della sezione
    h('div.page-head', h('div', h('div.en-eyebrow', 'Alma Energy'), h('h1', TABS.find(([k]) => k === tab)[1]))),
    body);
  const data = await get('/api/energy');
  meta = data.meta;
  if (tab === 'panoramica') await overview(body, data);
  else if (PIPELINE_TABS[tab]) await pipelineView(body, PIPELINE_TABS[tab]);
  else if (tab === 'target') await targetsView(body);
  else if (tab === 'database') await databaseView(body);
  else if (tab === 'parametri') await paramsView(body);
  else if (tab === 'screening') await screeningView(body);
  else if (tab === 'simulatore') await simulatorView(body, new URLSearchParams(location.hash.split('?')[1] || ''));
  else if (tab === 'opportunita') await opportunitiesTab(body, parts[2]);
  else if (tab === 'aziende') await companiesTab(body, parts[2]);
  else if (tab === 'persone') await peopleTab(body, parts[2]);
  else membersTab(body, data);
}

// ── panoramica = cruscotto (ALM2-18) ─────────────────────────────────────────
// MW e capex aperti e pesati con la probabilità della fase, IRR medio degli scenari scelti, Impianti target; per ogni
// tipo le fasi (stadi della pipeline, poi step ed esiti dei target) con MW o numero; opportunità ferme, step in
// scadenza, scadenze del FV classico e ultimi cambi. Export in Excel.
const eurShort = n => (Math.abs(n) >= 1e6 ? `${num(n / 1e6, 1)} M€` : `${num(Math.round(n / 1000))} k€`);
const ago = iso => { const d = Math.round((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? 'oggi' : d === 1 ? 'ieri' : `${d} giorni fa`; };

async function overview(box, data, days = 30) {
  const d = await get(`/api/energy/cruscotto?days=${days}`);
  const kpi = (label, value, sub, href) => h(href ? 'a.sw-kpi' : 'div.sw-kpi', { href }, h('span.lab', label), h('strong.big', value), sub ? h('span.sub', sub) : null);
  const phaseLabel = (kind, key) => (key.startsWith('target:')
    ? `Target · ${meta.targetSteps.find(s => s.key === key.slice(7))?.label || meta.targetOutcomes[key.slice(7)] || key.slice(7)}`
    : stageLabel(kind, key));
  const phasesOf = kind => [...meta.stages[kind].filter(([k]) => k !== 'target').map(([k]) => k),
    ...meta.targetSteps.map(s => `target:${s.key}`), ...Object.keys(meta.targetOutcomes).map(k => `target:${k}`)];
  const exportBtn = h('button.btn', { type: 'button', on: { click: async () => {
    const res = await fetch('/api/energy/cruscotto/excel', { credentials: 'same-origin' });
    if (!res.ok) return toast('Export non riuscito', 'err');
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: `Alma Energy ${new Date().toISOString().slice(0, 10)}.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } } }, icon('sheet', { size: 16 }), 'Esporta Excel');
  const daysSel = select([['30', 'ferme da 30 giorni'], ['60', 'da 60 giorni'], ['90', 'da 90 giorni']], String(days),
    { on: { change: e => overview(box, data, Number(e.target.value)) } });

  fill(box,
    h('div.toolbar', h('span.grow.small.muted', 'Valori pesati con la probabilità della fase (la probabilità scritta sull\'opportunità prevale).'), exportBtn),
    h('div.sw-kpis',
      kpi('MW in pipeline', `${num(d.totals.mw, 1)} MW`, `${num(d.totals.mwWeighted, 1)} MW pesati · ${num(d.totals.count)} opportunità aperte`),
      kpi('Capex in pipeline', eurShort(d.totals.capex), `${eurShort(d.totals.capexWeighted)} pesato`),
      kpi('IRR medio', d.irr.avg === null ? '—' : `${num(d.irr.avg * 100, 1)}%`, d.irr.count ? `su ${num(d.irr.count)} scenari scelti` : 'nessuno scenario scelto'),
      kpi('Impianti target', num(d.targets.active), `${num(d.targets.mwActive, 1)} MW · ${num(d.targets.acquired)} acquisiti · ${num(d.targets.lost)} persi`, '#/energy/target'),
      kpi('CRM', num(data.crm.companies), `aziende · ${num(data.crm.people)} persone`, '#/energy/aziende')),
    h('div.sw-grid',
      Object.keys(meta.kinds).map(kind => {
        const k = d.kinds[kind];
        const phases = phasesOf(kind).map(key => [key, k.phases[key]]).filter(([key, p]) => p || !key.startsWith('target:'));
        // barre sul numero di opportunità (i MW mancano finché non c'è la due diligence, es. il Database CE), MW accanto se noti
        const val = p => p?.count || 0;
        const max = Math.max(1, ...phases.map(([, p]) => val(p)));
        const tabKey = Object.entries(PIPELINE_TABS).find(([, x]) => x === kind)[0];
        return h('section.card.sw-card',
          h('div.en-sec-head', h('h3', h('a', { href: `#/energy/${tabKey}` }, meta.kinds[kind])),
            h('span.small.muted', `${num(k.count)} aperte · ${num(k.mw, 1)} MW · ${num(k.mwWeighted, 1)} pesati`)),
          h('div.sw-bars', phases.map(([key, p]) => h('div.sw-bar', { title: p ? `${num(p.count)} · ${num(p.mw, 2)} MW · capex ${eurShort(p.capex)} · pesati ${num(p.mwWeighted, 2)} MW` : '' },
            h('span.sw-bar-name', phaseLabel(kind, key)), h('span.sw-bar-track', h('i', { style: { width: `${val(p) ? Math.max(3, (val(p) / max) * 100) : 0}%` } })),
            h('span.sw-bar-val', `${num(p?.count || 0)}${p?.mw ? ` · ${num(p.mw, 1)} MW` : ''}`)))));
      }),
      h('section.card.sw-card',
        h('div.en-sec-head', h('h3', `Opportunità ferme (${num(d.stale.count)})`), daysSel),
        d.stale.list.length ? h('div.en-links', d.stale.list.map(o => h('button.en-link', { type: 'button', on: { click: () => openOpportunity(o.id, () => overview(box, data, days)) } },
          h('div.grow', h('strong', o.title), h('div.t-meta', `${meta.kinds[o.kind]} · ${stageLabel(o.kind, o.stage)}${o.owner_name ? ` · ${o.owner_name}` : ''}`)),
          h('span.small.muted', ago(o.stage_changed_at)))))
          : h('p.muted.small', `Nessuna opportunità ferma da più di ${days} giorni oltre il primo stadio.`)),
      h('section.card.sw-card', h('h3', 'Step dei target in scadenza (14 giorni)'),
        d.dueSteps.length ? h('div.en-links', d.dueSteps.map(t => h('button.en-link', { type: 'button', on: { click: () => openTarget(t.id, () => overview(box, data, days)) } },
          h('div.grow', h('strong', t.target_title), h('div.t-meta', t.title)),
          h('span', { class: t.due_date < new Date().toISOString().slice(0, 10) ? 'due-late' : '' }, fmtDate(t.due_date, { year: true })))))
          : h('p.muted.small', 'Nessuno step in scadenza.')),
      await deadlinesCard(),
      h('section.card.sw-card', h('h3', 'Ultimi cambi'),
        d.recent.length ? h('ul.en-history', d.recent.map(x => h('li',
          h('button.en-linklike', { type: 'button', on: { click: () => openOpportunity(x.id, () => overview(box, data, days)) } }, x.title),
          h('span.muted', ` → ${historyText(x)}`),
          h('div.t-meta', [new Date(x.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }), x.user_name, x.note].filter(Boolean).join(' · ')))))
          : h('p.muted.small', 'Ancora nessun cambio.'))));
}

// «Primo contatto», «Target · Due diligence», «Acquisito»… da una riga dello storico.
function historyText(x) {
  const s = x.to_stage;
  if (s === 'target') return 'Impianto target';
  if (s.startsWith('step:')) return `Target · ${meta.targetSteps.find(t => t.key === s.slice(5))?.label || s.slice(5)}`;
  if (s === 'esito:riaperto') return 'Iter riaperto';
  if (s.startsWith('esito:')) return meta.targetOutcomes[s.slice(6)] || s;
  return stageLabel(x.kind, s);
}

// ── opportunità ─────────────────────────────────────────────────────────────
async function opportunitiesTab(box, openId) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = { kind: params.get('kind') || '', q: '' };
  const list = h('div', loading());
  const kindSeg = h('div.seg.en-filter', [['', 'Tutte'], ...Object.entries(meta.kinds)].map(([k, label]) =>
    h('button', { type: 'button', class: k === state.kind ? 'on' : '', on: { click: e => {
      state.kind = k;
      kindSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      load();
    } } }, label)));
  fill(box,
    h('div.toolbar', kindSeg, h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => opportunityForm({ kind: state.kind || 'ppa_onsite', onSaved: o => { load(); openOpportunity(o.id, load); } }) } },
        icon('plus', { size: 16 }), 'Nuova opportunità')),
    list);
  async function load() {
    const { opportunities } = await get(`/api/energy/opportunities${qs({ kind: state.kind, q: state.q })}`);
    if (!opportunities.length) return fill(list, h('div.card.empty', state.q || state.kind ? 'Nessuna opportunità con questi filtri.' : 'Nessuna opportunità. Creane una con «Nuova opportunità»; gli import dello screening tetti e del Database Conto Energia le porteranno in blocco.'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Opportunità', 'Tipo', 'Stadio', 'Priorità', 'MW', 'Luogo', 'Responsabile'].map(t => h('th', t)))),
      h('tbody', opportunities.map(o => h('tr', { on: { click: () => openOpportunity(o.id, load) } },
        h('td', h('div.t-title', o.title), o.company_name ? h('div.t-meta', o.company_name) : null),
        h('td', kindPill(o.kind)), h('td', stagePill(o.kind, o.stage)), h('td', o.priority || '—'),
        h('td.num', num(o.mw, 2)), h('td', [o.city, o.province].filter(Boolean).join(', ') || '—'), h('td', o.owner_name || '—')))))));
  }
  await load();
}

async function companyOptions() {
  const { companies } = await get('/api/energy/companies');
  return [['', '—'], ...companies.map(c => [c.id, c.name])];
}

export async function opportunityForm({ kind, opp = null, onSaved }) {
  const companies = await companyOptions();
  const k = opp?.kind || kind;
  const form = h('div.en-form',
    opp ? null : field('Tipo', select(Object.entries(meta.kinds), k, { 'data-k': 'kind' })),
    field('Nome', input({ 'data-k': 'title', value: opp?.title || '', autofocus: true, maxlength: 200 })),
    field('Azienda principale', select(companies, opp?.company_id, { 'data-k': 'company_id' })),
    h('div.en-row3',
      field('MW', input({ 'data-k': 'mw', value: opp?.mw ?? '', inputmode: 'decimal' })),
      field('Capex (€)', input({ 'data-k': 'capex', value: opp?.capex ?? '', inputmode: 'decimal' })),
      field('Probabilità (%)', input({ 'data-k': 'probability', value: opp?.probability ?? '', inputmode: 'numeric' }))),
    h('div.en-row3',
      field('Comune', input({ 'data-k': 'city', value: opp?.city || '' })),
      field('Provincia', input({ 'data-k': 'province', value: opp?.province || '' })),
      field('Regione', input({ 'data-k': 'region', value: opp?.region || '' }))),
    h('div.en-row3',
      field('Priorità', input({ 'data-k': 'priority', value: opp?.priority || '', placeholder: 'A, B, C…' })),
      field('Responsabile', select(userOptions(), opp ? opp.owner_id : store.me.id, { 'data-k': 'owner_id' }))),
    field('Note', textarea(opp?.notes, { 'data-k': 'notes' })));
  const m = modal({
    title: opp ? 'Modifica opportunità' : 'Nuova opportunità', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      f.company_id = f.company_id ? Number(f.company_id) : null;
      f.owner_id = f.owner_id ? Number(f.owner_id) : null;
      const saved = opp ? await patch(`/api/energy/opportunities/${opp.id}`, f) : await post('/api/energy/opportunities', f);
      m.close();
      toast(opp ? 'Opportunità aggiornata' : 'Opportunità creata');
      onSaved?.(saved);
    } } }, opp ? 'Salva' : 'Crea opportunità')],
  });
}

// La pagina dell'opportunità (ALM2-24) si apre all'indirizzo #/energy/opportunita/<id>: da pipeline, mappa, elenchi.
export function openOpportunity(id) {
  location.hash = `#/energy/opportunita/${id}`;
}

// Tab «Opportunità» della pagina: dati, parti del tipo (screening, incassi GSE, dati autorizzativi), scenari del
// simulatore, aziende e persone collegate, storico degli stadi. refresh() ridisegna la pagina.
export function opportunitySheet(o, refresh) {
  const id = o.id;
  const scenariosBox = h('div');
  scenariosSection(o).then(el => scenariosBox.replaceChildren(el)); // scenari del simulatore, caricati a parte
  const links = h('div.en-links');
  const drawLinks = data => fill(links, data.links.length ? data.links.map(l => h('div.en-link',
    h('div.grow', h('strong', l.company_id ? l.company_name : personName(l)), h('div.t-meta', meta.linkRoles[l.role] || l.role,
      l.person_id && l.email ? ` · ${l.email}` : '', l.opt_out ? ' · non vuole essere contattato' : '')),
    h('a.btn.btn-ghost.btn-sm', { href: l.company_id ? `#/energy/aziende/${l.company_id}` : `#/energy/persone/${l.person_id}` }, 'Apri'),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Scollega', on: { click: async () => {
      await del(`/api/energy/links/${l.id}`);
      drawLinks(await get(`/api/energy/opportunities/${id}`));
    } } }, icon('x', { size: 15 })))) : h('p.muted.small', 'Nessuna azienda o persona collegata.'));
  drawLinks(o);
  const historyLabel = s => (s.startsWith('step:') ? meta.targetSteps.find(x => x.key === s.slice(5))?.label || s
    : s.startsWith('esito:') ? meta.targetOutcomes[s.slice(6)] || 'Iter riaperto' : stageLabel(o.kind, s));
  // telefono: chiama, scrivi o apri la mappa con un tocco (canvas 11/11)
  const tel = (o.links || []).find(l => l.phone)?.phone, mail = (o.links || []).find(l => l.email && !l.opt_out)?.email;
  const place = [o.address, o.city, o.province].filter(Boolean).join(', ');
  const quick = isMobile() && (tel || mail || place) ? h('div.en-quick',
    tel ? h('a.btn', { href: `tel:${String(tel).replace(/\s+/g, '')}` }, icon('phone', { size: 16 }), 'Chiama') : null,
    mail ? h('a.btn', { href: `mailto:${mail}` }, icon('mail', { size: 16 }), 'Email') : null,
    place ? h('a.btn', { href: `https://maps.apple.com/?q=${encodeURIComponent(place)}`, target: '_blank', rel: 'noopener' }, icon('map', { size: 16 }), 'Mappa') : null) : null;
  return h('div.en-sheet',
    quick,
    h('div.en-sheet-main',
      h('section.card.sw-card.en-sec', h('div.en-sec-head', h('h3', 'Dati'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => opportunityForm({ opp: o, onSaved: () => refresh() }) } }, icon('pencil', { size: 15 }), 'Modifica')),
      dl([
        ['Tipo', meta.kinds[o.kind]], ['Azienda', o.company_name || '—'], ['MW', num(o.mw, 3)], ['Capex', o.capex ? `${num(o.capex)} €` : '—'],
        ['Probabilità', o.probability !== null ? `${o.probability}%` : '—'], ['Priorità', o.priority || '—'],
        ['Luogo', [o.city, o.province, o.region].filter(Boolean).join(', ') || '—'], ['Responsabile', o.owner_name || '—'],
        ...(o.lost_reason && meta.closedStages.includes(o.stage) ? [['Motivo', o.lost_reason]] : []),
      ]), o.notes ? h('p.en-notes', o.notes) : null),
      h('div.card.sw-card', kindDetails(o, refresh)),
      scenariosBox),
    h('div.en-sheet-side',
      h('section.card.sw-card.en-sec', h('div.en-sec-head', h('h3', 'Aziende e persone collegate'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => linkForm(id, async () => drawLinks(await get(`/api/energy/opportunities/${id}`))) } }, icon('plus', { size: 15 }), 'Collega')),
      links),
      h('section.card.sw-card.en-sec', h('h3', 'Storico'), h('ul.en-history', o.history.map(x => h('li',
        h('strong', historyLabel(x.to_stage)), x.from_stage ? h('span.muted', ` da ${historyLabel(x.from_stage)}`) : h('span.muted', ' (creata)'),
        h('div.t-meta', [new Date(x.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }), x.user_name, x.note].filter(Boolean).join(' · ')))))),
      o.project_id ? null : h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Cancellare l'opportunità «${o.title}»?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/energy/opportunities/${id}`);
        history.back();
      } } }, 'Cancella l\'opportunità')));
}

function dl(pairs) {
  return h('dl.en-dl', pairs.flatMap(([k, val]) => [h('dt', k), h('dd', val)]));
}

// Collega un'azienda o una persona a un'opportunità, con il ruolo.
async function linkForm(oppId, onDone) {
  const [{ companies }, { people }] = await Promise.all([get('/api/energy/companies'), get('/api/energy/people')]);
  const what = select([['company', 'Azienda'], ['person', 'Persona']], 'company');
  const companySel = select([['', 'Scegli…'], ...companies.map(c => [c.id, c.name])], '');
  const personSel = select([['', 'Scegli…'], ...people.map(p => [p.id, `${personName(p)}${p.companies[0] ? ` (${p.companies[0].name})` : ''}`])], '', { hidden: true });
  what.addEventListener('change', () => { companySel.hidden = what.value !== 'company'; personSel.hidden = what.value !== 'person'; });
  const role = select(Object.entries(meta.linkRoles), 'referente');
  const m = modal({
    title: 'Collega all\'opportunità',
    body: h('div.en-form', field('Cosa', what), field('Chi', h('div', companySel, personSel), 'Se non c\'è, crealo prima in Aziende o Persone.'), field('Ruolo', role)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const body = { role: role.value };
      if (what.value === 'company') body.company_id = Number(companySel.value) || null; else body.person_id = Number(personSel.value) || null;
      await post(`/api/energy/opportunities/${oppId}/links`, body);
      m.close();
      onDone?.();
    } } }, 'Collega')],
  });
}

// ── aziende ─────────────────────────────────────────────────────────────────
async function companiesTab(box, openId) {
  const state = { type: '', q: '' };
  const chips = h('div.en-chips');
  const list = h('div', loading());
  fill(box,
    h('div.toolbar', h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, P.IVA o comune…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => companyForm({ onSaved: c => { load(); openCompany(c.id, load); } }) } }, icon('plus', { size: 16 }), 'Nuova azienda')),
    chips, list);
  async function load() {
    const { companies, byType } = await get(`/api/energy/companies${qs({ type: state.type, q: state.q })}`);
    fill(chips, [['', 'Tutte'], ...Object.entries(meta.companyTypes).map(([k, t]) => [k, t.short])].map(([k, label]) =>
      h('button.pill.en-chip', { type: 'button', class: state.type === k ? 'on' : '', on: { click: () => { state.type = k; load(); } } },
        label, k && byType[k] ? h('span.en-chip-n', num(byType[k])) : null)));
    if (!companies.length) return fill(list, h('div.card.empty', state.q || state.type ? 'Nessuna azienda con questi filtri.' : 'Il CRM è vuoto. Aggiungi la prima azienda con «Nuova azienda».'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Azienda', 'Tipi', 'Luogo', 'Relazione', 'Persone', 'Opportunità', 'Prossima azione'].map(t => h('th', t)))),
      h('tbody', companies.map(c => h('tr', { on: { click: () => openCompany(c.id, load) } },
        h('td', h('div.t-title', c.name), h('div.t-meta', [c.vat && `P.IVA ${c.vat}`, c.group_name && `gruppo ${c.group_name}`].filter(Boolean).join(' · '))),
        h('td', h('div.en-types', c.types.map(t => h('span.pill', meta.companyTypes[t]?.short || t)))),
        h('td', [c.city, c.province].filter(Boolean).join(', ') || '—'),
        h('td', meta.relations[c.relation]), h('td.num', num(c.people)), h('td.num', num(c.opportunities)),
        h('td', c.next_action ? h('div', c.next_action, h('div.t-meta', day(c.next_action_date))) : '—')))))));
  }
  await load();
  if (openId) openCompany(Number(openId), load);
}

// Campi del tipo di azienda (clienti: consumi, POD…; sviluppatori: MW in sviluppo…).
function extraFields(types, extra) {
  return types.flatMap(t => {
    const def = meta.companyTypes[t];
    if (!def?.fields.length) return [];
    return [h('div.en-type-block', h('div.en-type-title', def.label), h('div.en-row2', def.fields.map(([key, label, kind, choices]) => {
      const val = extra?.[key];
      const ctrl = kind === 'choice' ? select([['', '—'], ...choices.map(c => [c, c])], val, { 'data-x': key })
        : kind === 'bool' ? h('input', { type: 'checkbox', checked: Boolean(val), 'data-x': key, 'data-bool': '1' })
          : input({ 'data-x': key, value: val ?? '', type: kind === 'date' ? 'date' : 'text', inputmode: kind === 'number' ? 'decimal' : undefined });
      return field(label, ctrl);
    })))];
  });
}

async function companyForm({ company = null, onSaved }) {
  const groups = await companyOptions();
  const types = new Set(company?.types || []);
  const extraBox = h('div');
  const drawExtra = () => {
    const cur = {};
    for (const el of extraBox.querySelectorAll('[data-x]')) cur[el.dataset.x] = el.dataset.bool ? el.checked : el.value;
    fill(extraBox, extraFields([...types], { ...(company?.extra || {}), ...cur }));
  };
  const typeBox = h('div.en-chips', Object.entries(meta.companyTypes).map(([k, t]) => h('button.pill.en-chip', {
    type: 'button', class: types.has(k) ? 'on' : '', 'aria-pressed': String(types.has(k)),
    on: { click: e => { types.has(k) ? types.delete(k) : types.add(k); e.currentTarget.classList.toggle('on', types.has(k)); drawExtra(); } },
  }, t.label)));
  drawExtra();
  const dup = h('div');
  const nameIn = input({ 'data-k': 'name', value: company?.name || '', autofocus: true, maxlength: 200 });
  const vatIn = input({ 'data-k': 'vat', value: company?.vat || '', maxlength: 20 });
  const check = debounce(async () => {
    const { matches } = await get(`/api/energy/companies/check${qs({ vat: vatIn.value, name: nameIn.value })}`, { quiet: true });
    const other = matches.filter(x => x.id !== company?.id);
    fill(dup, other.length ? h('div.banner', 'Attenzione, sembra già presente: ', other.map((x, i) => [i ? ', ' : '', h('a', { href: `#/energy/aziende/${x.id}` }, x.name)])) : null);
  }, 400);
  nameIn.addEventListener('input', check);
  vatIn.addEventListener('input', check);
  const c = company || {};
  const form = h('div.en-form',
    h('div.en-row2', field('Ragione sociale', nameIn), field('P.IVA', vatIn)), dup,
    field('Tipi', typeBox),
    h('div.en-row3', field('Codice fiscale', input({ 'data-k': 'tax_code', value: c.tax_code || '' })), field('Forma giuridica', input({ 'data-k': 'legal_form', value: c.legal_form || '', placeholder: 'S.r.l., S.p.A.…' })),
      field('ATECO', input({ 'data-k': 'ateco', value: c.ateco || '' }))),
    h('div.en-row3', field('Stato', select(Object.entries(meta.companyStatus), c.status || 'attiva', { 'data-k': 'status' })),
      field('Gruppo / controllante', select(groups.filter(([id]) => String(id) !== String(c.id)), c.group_id, { 'data-k': 'group_id' })),
      field('Responsabile interno', select(userOptions(), company ? c.owner_id : store.me.id, { 'data-k': 'owner_id' }))),
    field('Indirizzo', input({ 'data-k': 'address', value: c.address || '' })),
    h('div.en-row3', field('Comune', input({ 'data-k': 'city', value: c.city || '' })), field('Provincia', input({ 'data-k': 'province', value: c.province || '' })),
      field('Regione', input({ 'data-k': 'region', value: c.region || '' }))),
    h('div.en-row3', field('PEC', input({ 'data-k': 'pec', value: c.pec || '', type: 'email' })), field('Telefono', input({ 'data-k': 'phone', value: c.phone || '' })),
      field('Sito web', input({ 'data-k': 'website', value: c.website || '' }))),
    h('div.en-row3', field('Fatturato (€)', input({ 'data-k': 'revenue', value: c.revenue ?? '', inputmode: 'decimal' })),
      field('Dipendenti', input({ 'data-k': 'employees', value: c.employees ?? '', inputmode: 'numeric' })),
      field('Anno del bilancio', input({ 'data-k': 'balance_year', value: c.balance_year ?? '', inputmode: 'numeric' }))),
    h('div.en-row3', field('Fonte', input({ 'data-k': 'source', value: c.source || '', placeholder: 'Screening tetti, segnalazione…' })),
      field('Relazione', select(Object.entries(meta.relations), c.relation || 'da_contattare', { 'data-k': 'relation' })),
      field('Ultimo contatto', input({ 'data-k': 'last_contact', type: 'date', value: c.last_contact || '' }))),
    h('div.en-row2', field('Prossima azione', input({ 'data-k': 'next_action', value: c.next_action || '' })),
      field('Entro il', input({ 'data-k': 'next_action_date', type: 'date', value: c.next_action_date || '' }))),
    extraBox,
    field('Note', textarea(c.notes, { 'data-k': 'notes' })));
  const m = modal({
    wide: true, title: company ? `Modifica ${company.name}` : 'Nuova azienda', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      for (const k of ['group_id', 'owner_id']) f[k] = f[k] ? Number(f[k]) : null;
      f.types = [...types];
      f.extra = {};
      for (const el of extraBox.querySelectorAll('[data-x]')) f.extra[el.dataset.x] = el.dataset.bool ? el.checked : el.value.trim();
      const saved = company ? await patch(`/api/energy/companies/${company.id}`, f) : await post('/api/energy/companies', f);
      m.close();
      toast(company ? 'Azienda aggiornata' : 'Azienda creata');
      onSaved?.(saved);
    } } }, company ? 'Salva' : 'Crea azienda')],
  });
}

async function openCompany(id, onChange) {
  const c = await get(`/api/energy/companies/${id}`);
  const extras = c.types.flatMap(t => (meta.companyTypes[t]?.fields || []).filter(([k]) => c.extra?.[k] !== undefined)
    .map(([k, label, kind]) => [label, kind === 'bool' ? (c.extra[k] ? 'Sì' : 'No') : kind === 'number' ? num(c.extra[k], 2) : kind === 'date' ? day(c.extra[k]) : c.extra[k]]));
  const m = modal({
    drawer: true,
    title: h('div', h('h2', c.name), h('div.en-head-pills', c.types.map(t => h('span.pill', meta.companyTypes[t]?.label || t)))),
    body: h('div.en-detail',
      h('section.en-sec', dl([
        ['P.IVA', c.vat || '—'], ['Stato', meta.companyStatus[c.status]], ['Gruppo', c.group_id ? h('a', { href: `#/energy/aziende/${c.group_id}` }, c.group_name) : '—'],
        ['Sede', [c.address, c.city, c.province, c.region].filter(Boolean).join(', ') || '—'],
        ['Contatti', [c.pec, c.phone, c.website].filter(Boolean).join(' · ') || '—'],
        ['Responsabile', c.owner_name || '—'], ['Relazione', meta.relations[c.relation]], ['Fonte', c.source || '—'],
        ['Ultimo contatto', day(c.last_contact)], ['Prossima azione', c.next_action ? `${c.next_action} (${day(c.next_action_date)})` : '—'],
        ...extras,
      ]), c.notes ? h('p.en-notes', c.notes) : null),
      c.controlled.length ? h('section.en-sec', h('h3', 'Società del gruppo'), h('div.en-links', c.controlled.map(x => h('a.en-link', { href: `#/energy/aziende/${x.id}` }, x.name)))) : null,
      h('section.en-sec', h('div.en-sec-head', h('h3', 'Persone'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => { m.close(); personForm({ preset: { company_id: c.id }, onSaved: () => openCompany(id, onChange) }); } } }, icon('plus', { size: 15 }), 'Nuova persona')),
      c.people.length ? h('div.en-links', c.people.map(p => h('a.en-link', { href: `#/energy/persone/${p.id}` },
        h('div.grow', h('strong', personName(p)), h('div.t-meta', [p.role, p.email, p.phone || p.mobile, p.opt_out && 'non vuole essere contattato'].filter(Boolean).join(' · '))))))
        : h('p.muted.small', 'Nessuna persona.')),
      h('section.en-sec', h('h3', 'Opportunità e target'), c.opportunities.length ? h('div.en-links', c.opportunities.map(o => h('a.en-link', { href: `#/energy/opportunita/${o.id}` },
        h('div.grow', h('strong', o.title), h('div.t-meta', `${meta.kinds[o.kind]} · ${stageLabel(o.kind, o.stage)} · ${o.roles.map(r => meta.linkRoles[r] || r).join(', ')}`)))))
        : h('p.muted.small', 'Non è collegata a nessuna opportunità.'))),
    left: [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare «${c.name}» dal CRM? Le persone restano, i collegamenti alle opportunità si tolgono.`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/energy/companies/${id}`);
      m.close();
      onChange?.();
    } } }, 'Cancella')],
    actions: [h('button.btn', { type: 'button', on: { click: () => { m.close(); companyForm({ company: c, onSaved: () => { onChange?.(); openCompany(id, onChange); } }); } } }, icon('pencil', { size: 15 }), 'Modifica')],
  });
}

// ── persone ─────────────────────────────────────────────────────────────────
async function peopleTab(box, openId) {
  const state = { q: '', type: '' };
  const list = h('div', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome o email…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      select([['', 'Tutti i tipi di azienda'], ...Object.entries(meta.companyTypes).map(([k, t]) => [k, t.short])], '', { on: { change: e => { state.type = e.target.value; load(); } } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => personForm({ onSaved: p => { load(); openPerson(p.id, load); } }) } }, icon('plus', { size: 16 }), 'Nuova persona')),
    list);
  async function load() {
    const { people } = await get(`/api/energy/people${qs({ q: state.q, type: state.type })}`);
    if (!people.length) return fill(list, h('div.card.empty', state.q || state.type ? 'Nessuna persona con questi filtri.' : 'Nessuna persona. Aggiungila con «Nuova persona».'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Persona', 'Aziende', 'Contatti', 'Peso', 'Prossima azione'].map(t => h('th', t)))),
      h('tbody', people.map(p => h('tr', { on: { click: () => openPerson(p.id, load) } },
        h('td', h('div.t-title', personName(p)), p.opt_out ? h('div.t-meta', 'Non vuole essere contattato') : null),
        h('td', p.companies.map(c => h('div', c.name, c.role ? h('span.t-meta', ` · ${c.role}`) : null))),
        h('td', h('div', p.email || '—'), h('div.t-meta', p.mobile || p.phone || '')),
        h('td', meta.influence[p.influence] || '—'),
        h('td', p.next_action ? h('div', p.next_action, h('div.t-meta', day(p.next_action_date))) : '—')))))));
  }
  await load();
  if (openId) openPerson(Number(openId), load);
}

async function personForm({ person = null, preset = {}, onSaved }) {
  const companies = await companyOptions();
  const rows = h('div.en-pc');
  const addRow = (companyId = '', role = '') => rows.append(h('div.en-pc-row',
    select(companies, companyId, { 'data-pc': 'company' }), input({ 'data-pc': 'role', value: role, placeholder: 'Qualifica (AD, energy manager…)' }),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: e => e.currentTarget.parentElement.remove() } }, icon('x', { size: 15 }))));
  (person?.companies || (preset.company_id ? [{ id: preset.company_id, role: '' }] : [])).forEach(c => addRow(c.id, c.role));
  if (!rows.childElementCount) addRow();
  const p = person || {};
  const form = h('div.en-form',
    h('div.en-row3', field('Titolo', input({ 'data-k': 'title', value: p.title || '', placeholder: 'Ing., Dott.…' })),
      field('Nome', input({ 'data-k': 'first_name', value: p.first_name || '', autofocus: true })), field('Cognome', input({ 'data-k': 'last_name', value: p.last_name || '' }))),
    field('Aziende e qualifica', h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addRow() } }, icon('plus', { size: 15 }), 'Un\'altra azienda'))),
    h('div.en-row3', field('Email', input({ 'data-k': 'email', value: p.email || '', type: 'email' })), field('Telefono', input({ 'data-k': 'phone', value: p.phone || '' })),
      field('Cellulare', input({ 'data-k': 'mobile', value: p.mobile || '' }))),
    h('div.en-row3', field('LinkedIn', input({ 'data-k': 'linkedin', value: p.linkedin || '' })),
      field('Canale preferito', select([['', '—'], ...Object.entries(meta.channels)], p.channel, { 'data-k': 'channel' })),
      field('Peso nella decisione', select([['', '—'], ...Object.entries(meta.influence)], p.influence, { 'data-k': 'influence' }))),
    h('div.en-row3', field('Responsabile interno', select(userOptions(), person ? p.owner_id : store.me.id, { 'data-k': 'owner_id' })),
      field('Fonte', input({ 'data-k': 'source', value: p.source || '' })), field('Ultimo contatto', input({ 'data-k': 'last_contact', type: 'date', value: p.last_contact || '' }))),
    h('div.en-row2', field('Prossima azione', input({ 'data-k': 'next_action', value: p.next_action || '' })),
      field('Entro il', input({ 'data-k': 'next_action_date', type: 'date', value: p.next_action_date || '' }))),
    h('div.en-type-block', h('div.en-type-title', 'Privacy (GDPR)'), h('div.en-row3',
      field('Base giuridica', select([['legittimo_interesse', 'Legittimo interesse (B2B)'], ['consenso', 'Consenso']], p.legal_basis || 'legittimo_interesse', { 'data-k': 'legal_basis' })),
      field('Fonte del dato', input({ 'data-k': 'data_source', value: p.data_source || '', placeholder: 'Biglietto da visita, sito…' })),
      field('Data del dato', input({ 'data-k': 'data_date', type: 'date', value: p.data_date || '' }))),
    h('label.en-check', h('input', { type: 'checkbox', 'data-k': 'opt_out', checked: Boolean(p.opt_out) }), 'Si è opposta al contatto: non compare negli elenchi da contattare')),
    field('Note', textarea(p.notes, { 'data-k': 'notes' })));
  const m = modal({
    wide: true, title: person ? `Modifica ${personName(person)}` : 'Nuova persona', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      f.owner_id = f.owner_id ? Number(f.owner_id) : null;
      f.companies = [...rows.children].map(r => ({ company_id: Number(r.querySelector('[data-pc="company"]').value) || null, role: r.querySelector('[data-pc="role"]').value.trim() }))
        .filter(x => x.company_id);
      const saved = person ? await patch(`/api/energy/people/${person.id}`, f) : await post('/api/energy/people', f);
      m.close();
      toast(person ? 'Persona aggiornata' : 'Persona creata');
      onSaved?.(saved);
    } } }, person ? 'Salva' : 'Crea persona')],
  });
}

async function openPerson(id, onChange) {
  const p = await get(`/api/energy/people/${id}`);
  const m = modal({
    drawer: true,
    title: h('div', h('h2', personName(p)), p.opt_out ? h('div.en-head-pills', h('span.pill.en-lost', 'Non vuole essere contattato')) : null),
    body: h('div.en-detail',
      h('section.en-sec', dl([
        ['Email', p.email ? h('a', { href: `mailto:${p.email}` }, p.email) : '—'], ['Telefono', p.phone || '—'], ['Cellulare', p.mobile || '—'],
        ['LinkedIn', p.linkedin || '—'], ['Canale preferito', meta.channels[p.channel] || '—'], ['Peso nella decisione', meta.influence[p.influence] || '—'],
        ['Responsabile', p.owner_name || '—'], ['Ultimo contatto', day(p.last_contact)], ['Prossima azione', p.next_action ? `${p.next_action} (${day(p.next_action_date)})` : '—'],
        ['Privacy', `${p.legal_basis === 'consenso' ? 'Consenso' : 'Legittimo interesse'}${p.data_source ? ` · fonte: ${p.data_source}` : ''}${p.data_date ? ` · ${day(p.data_date)}` : ''}`],
      ]), p.notes ? h('p.en-notes', p.notes) : null),
      h('section.en-sec', h('h3', 'Aziende'), p.companies.length ? h('div.en-links', p.companies.map(c => h('a.en-link', { href: `#/energy/aziende/${c.id}` },
        h('div.grow', h('strong', c.name), h('div.t-meta', [c.role, c.types.map(t => meta.companyTypes[t]?.short || t).join(', ')].filter(Boolean).join(' · '))))))
        : h('p.muted.small', 'Non è collegata a nessuna azienda.')),
      h('section.en-sec', h('h3', 'Opportunità e target'), p.opportunities.length ? h('div.en-links', p.opportunities.map(o => h('a.en-link', { href: `#/energy/opportunita/${o.id}` },
        h('div.grow', h('strong', o.title), h('div.t-meta', `${meta.kinds[o.kind]} · ${stageLabel(o.kind, o.stage)} · ${o.roles.map(r => meta.linkRoles[r] || r).join(', ')}`)))))
        : h('p.muted.small', 'Non è collegata a nessuna opportunità.'))),
    left: [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare ${personName(p)} dal CRM?`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/energy/people/${id}`);
      m.close();
      onChange?.();
    } } }, 'Cancella')],
    actions: [h('button.btn', { type: 'button', on: { click: () => { m.close(); personForm({ person: p, onSaved: () => { onChange?.(); openPerson(id, onChange); } }); } } }, icon('pencil', { size: 15 }), 'Modifica')],
  });
}

// ── membri del modulo ───────────────────────────────────────────────────────
function membersTab(box, data) {
  const email = input({ type: 'email', placeholder: 'email dell\'account di Alma Planet' });
  fill(box, h('section.card.sw-card.en-members',
    h('h3', 'Chi entra in Alma Energy'),
    h('p.small.muted', 'Solo queste persone vedono il modulo e i suoi dati. Si entra con l\'account Microsoft di Almacis.'),
    h('div.en-links', data.members.map(mb => h('div.en-link',
      h('div.grow', h('strong', mb.name || mb.email), h('div.t-meta', mb.name ? mb.email : 'Non ha ancora fatto l\'accesso ad Alma Planet')),
      mb.email === String(store.me.email).toLowerCase() ? h('span.t-meta', 'tu') : h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Togliere ${mb.name || mb.email} da Alma Energy?`, { ok: 'Togli', danger: true })) return;
        await del(`/api/energy/members/${encodeURIComponent(mb.email)}`);
        location.reload();
      } } }, 'Togli')))),
    h('div.en-stage-row', email, h('button.btn', { type: 'button', on: { click: async () => {
      if (!email.value.trim()) return;
      await post('/api/energy/members', { email: email.value });
      toast('Aggiunto ad Alma Energy');
      location.reload();
    } } }, icon('plus', { size: 15 }), 'Aggiungi'))));
}
