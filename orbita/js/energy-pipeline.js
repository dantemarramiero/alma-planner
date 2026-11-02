// Alma Energy: pipeline a kanban (PPA on-site, Revamping, FV classico), import dei file Excel con anteprima,
// Database impianti in Conto Energia con «Porta in pipeline» e le parti della scheda che cambiano per tipo
// (dati dello screening, incassi GSE e dati tecnici del revamping, dati autorizzativi e scadenze del FV classico).
import { h, fill, modal, toast, loading, debounce, promptDialog, confirmDialog, fmtDate } from './ui.js';
import { get, post, patch, api, qs } from './api.js';
import { icon } from './icons.js';
import { meta, num, openOpportunity, opportunityForm, field, input, select } from './energy.js';
import { mapView } from './energy-map.js';

const eur = n => (n === null || n === undefined ? '—' : `${num(n)} €`);
// 46.637.000 → «46,6 M», 203.750 → «204 k»
const short = n => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1000).toLocaleString('it-IT')} k`);
const pct = n => (n === null || n === undefined ? '—' : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%`);
const SIGNAL_LABEL = {
  sottoperformance: 'Sottoperformance', acquisto_blocco: 'Acquisto in blocco', operatore_strutturato: 'Operatore strutturato',
  in_liquidazione: 'In liquidazione', acquistato_di_recente: 'Acquistato di recente', erogazioni_azzerate: 'Erogazioni quasi azzerate',
  piu_beneficiari: 'Più beneficiari', non_strategico: 'Non strategico', cambio_proprieta: 'Cambio di proprietà',
};
const signalPills = list => (list?.length ? h('div.en-signals', list.map(s => h('span.pill.en-signal', { class: `en-sig-${s}` }, SIGNAL_LABEL[s] || s))) : null);
const STRATEGIA = { rivendita: 'Rivendita', gestione: 'Gestione' };
const OFFERTA = { acquisto: 'Acquisto dell\'impianto', gestione_om: 'Gestione / O&M per il proprietario', revamping_terzi: 'Revamping per conto del proprietario' };
const prioPill = p => (p ? h('span.pill.en-prio', { class: `en-p-${String(p).charAt(0)}` }, p === 'Dati insufficienti' ? 'n.d.' : p) : null);

// ── kanban ───────────────────────────────────────────────────────────────────
const IMPORTS = {
  ppa_onsite: { label: 'Importa screening tetti', path: 'screening', hint: 'Il file «Screening_FV_tetti_Abruzzo.xlsx» (foglio «Edifici»). Rifarlo aggiorna i dati senza toccare stadi e note.' },
  revamping: { label: 'Aggiorna dal Database CE', path: 'database-ce', hint: 'Il file «Database impianti incentivati in Conto Energia.xlsx». In pipeline vanno i proprietari con almeno una convenzione A o B; gli altri restano nel Database CE.' },
};

export async function pipelineView(box, kind) {
  const state = { q: '', priority: '', province: '', signal: '', strategia: '' };
  let view = 'kanban'; // oppure 'mappa' (ALM2-11)
  const board = h('div.en-board-wrap', loading());
  const viewSeg = h('div.seg.en-filter', [['kanban', 'Kanban'], ['mappa', 'Mappa']].map(([k, label]) => h('button', { type: 'button', class: k === view ? 'on' : '', on: { click: e => {
    view = k;
    viewSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
    load();
  } } }, label)));
  const provinceSel = select([['', 'Tutte le province']], '', { on: { change: e => { state.province = e.target.value; load(); } } });
  const imp = IMPORTS[kind];
  fill(box,
    h('div.toolbar',
      viewSeg,
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, comune o azienda…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      select([['', 'Tutte le priorità'], ['A', 'Priorità A'], ['B', 'Priorità B'], ['C', 'Priorità C'], ...(kind === 'revamping' ? [['D', 'Priorità D']] : [])], '',
        { on: { change: e => { state.priority = e.target.value; load(); } } }),
      provinceSel,
      kind === 'revamping' ? select([['', 'Tutti i segnali'], ...Object.entries(SIGNAL_LABEL)], '', { on: { change: e => { state.signal = e.target.value; load(); } } }) : null,
      kind === 'revamping' ? select([['', 'Ogni strategia'], ...Object.entries(STRATEGIA)], '', { on: { change: e => { state.strategia = e.target.value; load(); } } }) : null,
      imp ? h('button.btn', { type: 'button', on: { click: () => importDialog(imp, load) } }, icon('upload', { size: 16 }), imp.label) : null,
      h('button.btn.btn-primary', { type: 'button', on: { click: () => opportunityForm({ kind, onSaved: o => { load(); openOpportunity(o.id, load); } }) } }, icon('plus', { size: 16 }), 'Nuova opportunità')),
    board);

  let provincesFilled = false;
  async function load() {
    if (view === 'mappa' && provincesFilled) return mapView(board, kind, state, p => openOpportunity(p.id, load));
    const data = await get(`/api/energy/pipeline/${kind}${qs(state)}`);
    if (!provincesFilled) {
      provinceSel.append(...data.provinces.map(p => h('option', { value: p }, p)));
      provincesFilled = true;
    }
    const total = data.stages.reduce((s, x) => s + x.count, 0);
    if (!total && !state.q && !state.priority && !state.province && !state.signal && !state.strategia) {
      return fill(board, h('div.card.empty', imp ? `Nessuna opportunità. Usa «${imp.label}» o «Nuova opportunità».` : 'Nessuna opportunità. Creane una con «Nuova opportunità».'));
    }
    if (view === 'mappa') return mapView(board, kind, state, p => openOpportunity(p.id, load));
    fill(board, h('div.en-board', data.stages.map(st => column(kind, st, data.perStage, load))));
  }
  await load();
}

function column(kind, st, perStage, reload) {
  const sub = kind === 'revamping' ? (st.lost ? `${eur(Math.round(st.lost))} persi/anno` : '') : st.mw ? `${num(st.mw, 1)} MW` : '';
  const col = h('section.en-col', { class: meta.closedStages.includes(st.key) ? 'lost' : st.key === 'target' ? 'target' : '', 'data-stage': st.key },
    h('header.en-col-head', h('span.en-col-name', st.label), h('span.en-col-n', num(st.count))),
    sub ? h('div.en-col-sub', sub) : null,
    h('div.en-cards', st.cards.map(c => card(kind, c, reload))),
    st.count > st.cards.length ? h('div.en-col-more', `altre ${num(st.count - st.cards.length)}: restringi con i filtri`) : null);
  // trascina una scheda su un'altra colonna per cambiare stadio (sul telefono si cambia dalla scheda)
  col.addEventListener('dragover', e => {
    if (st.key === 'target') return;
    e.preventDefault();
    col.classList.add('drop');
  });
  col.addEventListener('dragleave', () => col.classList.remove('drop'));
  col.addEventListener('drop', async e => {
    e.preventDefault();
    col.classList.remove('drop');
    const id = Number(e.dataTransfer.getData('text/plain'));
    const from = e.dataTransfer.getData('application/x-stage');
    if (!id || from === st.key || st.key === 'target') return;
    let lost_reason;
    let note;
    if (st.key === 'perso' || st.key === 'scartato') {
      lost_reason = await promptDialog(st.key === 'perso' ? 'Perché è persa?' : 'Perché la scarti?', { label: 'Motivo', ok: st.label });
      if (!lost_reason) return;
    } else if (meta.closedStages.includes(from) && !meta.closedStages.includes(st.key)) {
      // come in BOSS: riaprire da persa, scartata o standby chiede la motivazione
      note = await promptDialog('Riapri l\'opportunità', { label: 'Perché la riapri', ok: 'Riapri' });
      if (!note) return;
    }
    await post(`/api/energy/opportunities/${id}/stage`, { stage: st.key, lost_reason, note });
    toast(`Spostata in «${st.label}»`);
    reload();
  });
  return col;
}

function card(kind, c, reload) {
  const meta2 = kind === 'revamping'
    ? [c.convenzioni > 1 ? `${c.convenzioni} convenzioni` : '1 convenzione', c.incassi_persi ? `${eur(Math.round(c.incassi_persi))} persi/anno` : null, STRATEGIA[c.strategia]]
    : [c.mw ? `${num(c.mw, 2)} MW` : null, c.profilo && kind === 'ppa_onsite' ? `profilo ${c.profilo}` : null, c.regime];
  const el = h('article.en-card', { draggable: c.stage !== 'target', tabindex: 0, on: {
    click: () => openOpportunity(c.id, reload),
    keydown: e => { if (e.key === 'Enter') openOpportunity(c.id, reload); },
    dragstart: e => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.setData('application/x-stage', c.stage); el.classList.add('dragging'); },
    dragend: () => el.classList.remove('dragging'),
  } },
  h('div.en-card-top', prioPill(c.priority), h('span.en-card-title', c.title)),
  c.company_name && !c.title.startsWith(c.company_name) ? h('div.t-meta', c.company_name) : null,
  h('div.en-card-meta', meta2.filter(Boolean).join(' · ') || null),
  h('div.t-meta', [c.city, c.province].filter(Boolean).join(', ')),
  kind === 'revamping' ? signalPills((c.segnali || []).slice(0, 3)) : null);
  return el;
}

// ── import con anteprima ─────────────────────────────────────────────────────
function importDialog(imp, onDone) {
  const fileIn = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const preview = h('div');
  const go = h('button.btn.btn-primary', { type: 'button', disabled: true }, 'Importa');
  const send = (path, file) => api('POST', `/api/energy/import/${path}`, file, { raw: true, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    go.disabled = true;
    if (!file) return;
    fill(preview, loading());
    try {
      const s = await send(`${imp.path}/anteprima`, file);
      const prios = Object.entries(s.byPriority || {}).map(([p, n]) => `${p}: ${num(n)}`).join(' · ');
      fill(preview, h('div.en-preview', h('dl.en-dl',
        h('dt', 'Righe nel file'), h('dd', num(s.total)),
        h('dt', 'Nuove'), h('dd', num(s.new)), h('dt', 'Da aggiornare'), h('dd', num(s.updated)),
        s.owners !== undefined ? [h('dt', 'Proprietari'), h('dd', num(s.owners)), h('dt', 'In pipeline (A o B)'), h('dd', num(s.ownersToPipeline))] : null,
        s.withCompany !== undefined ? [h('dt', 'Con azienda identificata'), h('dd', num(s.withCompany))] : null,
        h('dt', 'Per priorità'), h('dd', prios))));
      go.disabled = false;
    } catch (err) {
      fill(preview, h('div.banner', err.message));
    }
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Import in corso…';
    fill(preview, h('div', loading(), h('p.small.muted', 'Il Database CE ha più di 12.000 righe: ci vuole circa mezzo minuto.')));
    try {
      const r = await send(imp.path, fileIn.files[0]);
      m.close();
      toast(r.created !== undefined
        ? `Import fatto: ${num(r.created)} nuove, ${num(r.updated)} aggiornate, ${num(r.companiesCreated)} aziende nuove nel CRM`
        : `Import fatto: ${num(r.summary.total)} convenzioni, ${num(r.opportunities)} proprietari nuovi in pipeline, ${num(r.companiesCreated)} aziende nuove nel CRM`);
      onDone?.();
    } catch (err) {
      go.disabled = false;
      go.textContent = 'Importa';
      fill(preview, h('div.banner', err.message));
    }
  });
  const m = modal({ title: imp.label, body: h('div.en-form', h('p.small.muted', imp.hint), fileIn, preview), actions: [go] });
}

// ── Database impianti in Conto Energia ───────────────────────────────────────
export async function databaseView(box) {
  const state = { q: '', priority: '', owner_type: '', region: '', signal: '', in_pipeline: '', sort: 'incassi_persi', page: 0 };
  const selected = new Map(); // owner_key → nome
  const list = h('div', loading());
  const filters = h('div.toolbar');
  const head = h('div.en-db-head');
  const moveBtn = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: async () => {
    const r = await post('/api/energy/conventions/pipeline', { owners: [...selected.keys()] });
    toast(r.opportunities === 1 ? 'Un proprietario portato nella pipeline Revamping' : `${num(r.opportunities)} proprietari portati nella pipeline Revamping`);
    selected.clear();
    load();
  } } }, 'Porta in pipeline');
  fill(box, filters, head, list);

  let facetsDrawn = false;
  const set = k => e => { state[k] = e.target.value; state.page = 0; load(); };
  async function load() {
    const d = await get(`/api/energy/conventions${qs(state)}`);
    if (!facetsDrawn) {
      fill(filters,
        h('input.input.grow', { type: 'search', placeholder: 'Proprietario, P.IVA o convenzione…', on: { input: debounce(set('q')) } }),
        select([['', 'Tutte le priorità'], ...d.facets.priority.map(([p, n]) => [p, `${p} (${num(n)})`])], '', { on: { change: set('priority') } }),
        select([['', 'Tutti i proprietari'], ...d.facets.owner_type.map(([t, n]) => [t, `${t} (${num(n)})`])], '', { on: { change: set('owner_type') } }),
        select([['', 'Tutte le regioni'], ...d.facets.region.map(([r]) => [r, r])], '', { on: { change: set('region') } }),
        select([['', 'Tutti i segnali'], ...d.signals], '', { on: { change: set('signal') } }),
        select([['', 'In pipeline o no'], ['0', 'Non in pipeline'], ['1', 'Già in pipeline']], '', { on: { change: set('in_pipeline') } }),
        select([['incassi_persi', 'Più incassi persi'], ['variazione', 'Calo maggiore'], ['rank', 'Ordine del file'], ['proprietario', 'Proprietario A-Z']], state.sort, { on: { change: set('sort') } }));
      facetsDrawn = true;
    }
    const drawHead = () => fill(head,
      h('span', `${num(d.total)} convenzioni di ${num(d.owners)} proprietari · ${eur(Math.round(d.lost))} di incassi persi all'anno · ${num(d.inPipeline)} già in pipeline`),
      h('span.grow'),
      selected.size ? h('span.small', `${num(selected.size)} proprietari scelti`) : null,
      (moveBtn.disabled = !selected.size, moveBtn));
    drawHead();
    if (!d.total) return fill(list, h('div.card.empty', 'Nessuna convenzione. Carica il Database CE dalla pipeline Revamping con «Aggiorna dal Database CE».'));
    const pages = Math.ceil(d.total / d.pageSize);
    fill(list, h('div.card.table-wrap', h('table.list.en-db',
      h('thead', h('tr', ['', 'Proprietario', 'Prio.', 'Convenzione', 'Tipo', 'Sede', 'Incasso 2023-25', 'Variazione', 'Persi/anno', 'Andamento', 'Segnali'].map(t => h('th', t)))),
      h('tbody', d.conventions.map(c => {
        const box2 = h('input', { type: 'checkbox', checked: selected.has(c.owner_key), disabled: Boolean(c.opportunity_id), 'aria-label': `Scegli ${c.owner_name}`,
          on: { click: e => e.stopPropagation(), change: e => { e.target.checked ? selected.set(c.owner_key, c.owner_name) : selected.delete(c.owner_key); drawHead(); } } });
        return h('tr', { on: { click: () => (c.opportunity_id ? openOpportunity(c.opportunity_id, load) : box2.click()) } },
          h('td', box2),
          h('td', h('div.t-title', c.owner_name), h('div.t-meta', [c.owner_vat && `P.IVA ${c.owner_vat}`, c.opportunity_id && 'in pipeline'].filter(Boolean).join(' · '))),
          h('td', prioPill(c.priority)), h('td', c.convention), h('td', c.owner_type), h('td', [c.province, c.region].filter(Boolean).join(', ')),
          h('td.num', eur(c.avg_recent === null ? null : Math.round(c.avg_recent))), h('td.num', { class: c.variation < 0 ? 'en-neg' : '' }, pct(c.variation)),
          h('td.num', eur(c.lost_per_year === null ? null : Math.round(c.lost_per_year))), h('td', c.trend), h('td', signalPills(c.signals)));
      })))),
    pages > 1 ? h('div.en-pager',
      h('button.btn.btn-sm', { type: 'button', disabled: state.page === 0, on: { click: () => { state.page--; load(); } } }, '‹ Precedenti'),
      h('span.small.muted', `Pagina ${state.page + 1} di ${num(pages)}`),
      h('button.btn.btn-sm', { type: 'button', disabled: state.page >= pages - 1, on: { click: () => { state.page++; load(); } } }, 'Successive ›')) : null);
  }
  await load();
}

// ── parti della scheda dell'opportunità che cambiano per tipo ────────────────
export function kindDetails(o, refresh) {
  if (o.kind === 'ppa_onsite') return screeningSection(o, refresh);
  if (o.kind === 'revamping') return revampingSections(o, refresh);
  if (o.kind === 'fv_classico') return fvSections(o, refresh);
  return [];
}

const pairs = list => h('dl.en-dl', list.filter(([, val]) => val !== null && val !== undefined && val !== '').flatMap(([k, val]) => [h('dt', k), h('dd', val)]));

const PROFILES = [['D1', 'D1 · diurni 7 su 7 o continui'], ['D2', 'D2 · energivori su 2-3 turni'], ['D3', 'D3 · cinque giorni, un turno'],
  ['D4', 'D4 · consumi bassi o nulli'], ['ND', 'ND · da verificare'], ['X', 'X · escluso']];

function screeningSection(o, refresh) {
  const d = o.data || {};
  if (d.fonte !== 'Screening tetti') return [];
  const sat = o.lat && o.lon ? h('a', { href: `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}`, target: '_blank', rel: 'noopener' }, 'Apri la vista satellite') : null;
  // il profilo si corregge qui: punteggio e priorità si ricalcolano con i parametri dei tier
  const profile = select(PROFILES, d.profilo || 'ND', { on: { change: async e => {
    await patch(`/api/energy/opportunities/${o.id}`, { data: { profilo: e.target.value } });
    toast('Profilo cambiato: punteggio e priorità ricalcolati');
    refresh?.();
  } } });
  return [h('section.en-sec', h('h3', 'Dallo screening dei tetti'),
    field('Profilo di consumo', profile, 'Punti e soglie in «Parametri dei tier».'),
    pairs([
    ['Punteggio', d.punteggio !== null ? `${num(d.punteggio)} (taglia ${num(d.punti_taglia)} + profilo ${num(d.punti_profilo)})` : null],
    ['Attività', d.attivita], ['Giorni e turni', [d.giorni && `${d.giorni} giorni/sett.`, d.turni].filter(Boolean).join(' · ')],
    ['Perché', d.motivazione], ['Confidenza', d.confidenza], ['Area', d.area_produttiva],
    ['Tetto', d.superficie ? `${num(d.superficie)} m²` : null], ['Potenza stimata', d.kwp ? `${num(d.kwp)} kWp` : null],
    ['Produzione', d.mwh ? `${num(d.mwh)} MWh/anno (${num(d.kwh_kwp)} kWh/kWp)` : null], ['Ricavi lordi', d.ricavi_k ? `${num(d.ricavi_k)} k€/anno` : null],
    ['FV già sul tetto (OSM)', d.fv_osm], ['Vista satellite', sat],
  ]))];
}

// Incassi GSE anno per anno: barre, in rosso gli anni sotto la media 2016-2019.
function paymentsChart(payments, before) {
  const years = Object.keys(payments || {}).sort();
  if (!years.length) return null;
  const max = Math.max(...years.map(y => payments[y]), 1);
  return h('div.en-chart', { role: 'img', 'aria-label': `Incassi GSE dal ${years[0]} al ${years[years.length - 1]}` }, years.map(y => h('div.en-chart-col',
    h('span.en-chart-val', short(payments[y])),
    h('i', { class: before && payments[y] < before * 0.9 ? 'low' : '', style: { height: `${Math.max(2, (payments[y] / max) * 100)}%` } }),
    h('span.en-chart-year', `'${y.slice(2)}`))));
}

const TECH_FIELDS = [
  ['comune_impianto', 'Comune dell\'impianto'], ['coordinate', 'Coordinate (lat, lon)'], ['kwp', 'Potenza (kWp)'], ['conto_energia', 'Conto Energia (I–V)'],
  ['tariffa', 'Tariffa incentivante (€/kWh)'], ['entrata_esercizio', 'Entrata in esercizio', 'date'], ['scadenza_incentivo', 'Scadenza dell\'incentivo', 'date'],
  ['moduli', 'Moduli'], ['inverter', 'Inverter'], ['pr', 'Performance ratio'],
];

function revampingSections(o, refresh) {
  const d = o.data || {};
  const tech = d.tecnici || {};
  const form = h('div.en-row2', TECH_FIELDS.map(([k, label, type]) => field(label, input({ 'data-t': k, value: tech[k] ?? '', type: type || 'text' }))));
  const strategia = select([['', 'Da decidere'], ...Object.entries(STRATEGIA)], d.strategia || '');
  const offerta = select([['', 'Da decidere'], ...Object.entries(OFFERTA)], d.tipo_offerta || '');
  const several = (o.conventions?.length || 0) > 1;
  return [
    h('section.en-sec', h('div.en-sec-head', h('h3', 'Strategia'),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        await patch(`/api/energy/opportunities/${o.id}`, { data: { strategia: strategia.value, tipo_offerta: offerta.value } });
        toast('Strategia salvata');
        refresh?.();
      } } }, 'Salva')),
    h('div.en-row2', field('Dopo l\'acquisto', strategia, 'Rivendere dopo il revamping o tenere in gestione: si confrontano nel simulatore.'), field('Tipo di offerta', offerta))),
    d.fonte === 'Database Conto Energia' ? h('section.en-sec', h('h3', 'Dal Database Conto Energia'),
      h('div.sw-kpis.sm',
        h('div.sw-kpi', h('span.lab', 'Incassi persi'), h('strong.big', eur(Math.round(d.incassi_persi || 0))), h('span.sub', 'all\'anno, rispetto al 2016-2019')),
        h('div.sw-kpi', h('span.lab', 'Incasso 2023-2025'), h('strong.big', eur(Math.round(d.incasso_recente || 0))), h('span.sub', `prima ${eur(Math.round(d.incasso_prima || 0))}`))),
      paymentsChart(d.incassi, d.incasso_prima),
      pairs([['Convenzioni', num(d.convenzioni)], ['Tipo di proprietario', d.tipo_proprietario], ['Classe di incasso', d.classe_incasso],
        ['Andamento', (d.andamenti || []).join(', ')], ['Ultimo cambio di proprietà', d.ultimo_cambio]]),
      signalPills(d.segnali)) : null,
    o.conventions?.length ? h('section.en-sec', h('h3', `Convenzioni GSE (${o.conventions.length})`), h('div.table-wrap', h('table.list.en-small',
      h('thead', h('tr', ['Convenzione', 'Prio.', 'Incasso 23-25', 'Variazione', 'Persi/anno', 'Andamento'].map(t => h('th', t)))),
      h('tbody', o.conventions.map(c => h('tr', { title: [c.notes, c.notes2].filter(Boolean).join(' · ') },
        // «Stacca» accanto al numero, così si vede anche quando la tabella scorre
        h('td', h('div.en-conv', c.convention, several ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Trattala in un\'opportunità sua', on: { click: async e => {
          e.stopPropagation();
          if (!await confirmDialog(`Staccare la convenzione ${c.convention} in un'opportunità sua? Parte dallo stesso stadio, con le stesse aziende e persone collegate.`, { ok: 'Stacca' })) return;
          const r = await post(`/api/energy/conventions/${encodeURIComponent(c.convention)}/stacca`, {});
          toast('Convenzione staccata');
          refresh?.();
          openOpportunity(r.id, refresh);
        } } }, 'Stacca') : null)),
        h('td', prioPill(c.priority)), h('td.num', eur(c.avg_recent === null ? null : Math.round(c.avg_recent))),
        h('td.num', { class: c.variation < 0 ? 'en-neg' : '' }, pct(c.variation)), h('td.num', eur(c.lost_per_year === null ? null : Math.round(c.lost_per_year))), h('td', c.trend))))))) : null,
    h('section.en-sec', h('div.en-sec-head', h('h3', 'Dati tecnici (da due diligence)'),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        const t = {};
        for (const el of form.querySelectorAll('[data-t]')) if (el.value.trim()) t[el.dataset.t] = el.value.trim();
        await patch(`/api/energy/opportunities/${o.id}`, { data: { tecnici: t } });
        toast('Dati tecnici salvati');
        refresh?.();
      } } }, 'Salva')),
    h('p.small.muted', 'Il Database CE non ha potenza, tariffa né posizione dell\'impianto: si completano qui.'), form),
  ];
}

const FV_FIELDS = [
  ['mw_immissione', 'MW in immissione'], ['tecnologia', 'Tecnologia', ['', 'fisso', 'tracker', 'agrivoltaico']], ['particelle', 'Particelle catastali'],
  ['ettari', 'Ettari'], ['regime', 'Regime autorizzativo', ['', 'attività libera', 'PAS', 'Autorizzazione Unica', 'PAUR (VIA regionale)', 'VIA statale']],
  ['ente', 'Ente'], ['pratica', 'Numero di pratica'], ['data_deposito', 'Data di deposito', 'date'], ['gestore_rete', 'Gestore di rete', ['', 'e-distribuzione', 'Terna', 'altro']],
  ['codice_rete', 'Codice pratica di connessione'], ['punto_connessione', 'Punto di connessione (CP/SE)'], ['costo_connessione', 'Costo della connessione (€)'],
];

function fvSections(o, refresh) {
  const d = o.data || {};
  const form = h('div.en-row2', FV_FIELDS.map(([k, label, opt]) => field(label, Array.isArray(opt)
    ? select(opt.map(x => [x, x || '—']), d[k] ?? '', { 'data-f': k })
    : input({ 'data-f': k, value: d[k] ?? '', type: opt === 'date' ? 'date' : 'text' }))));
  const rows = h('div.en-pc');
  const addRow = (s = {}) => rows.append(h('div.en-pc-row.en-dl-row',
    input({ 'data-s': 'label', value: s.label || '', placeholder: 'Scadenza (opzione sul terreno, STMG…)' }),
    input({ 'data-s': 'date', type: 'date', value: s.date || '' }),
    h('label.en-check', h('input', { type: 'checkbox', 'data-s': 'done', checked: Boolean(s.done) }), 'fatta'),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: e => e.currentTarget.parentElement.remove() } }, icon('x', { size: 15 }))));
  (d.scadenze || []).forEach(addRow);
  return [h('section.en-sec', h('div.en-sec-head', h('h3', 'Dati autorizzativi e connessione'),
    h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
      const data = {};
      for (const el of form.querySelectorAll('[data-f]')) data[el.dataset.f] = el.value.trim();
      data.scadenze = [...rows.children].map(r => ({
        label: r.querySelector('[data-s="label"]').value.trim(), date: r.querySelector('[data-s="date"]').value, done: r.querySelector('[data-s="done"]').checked,
      })).filter(s => s.label && s.date);
      await patch(`/api/energy/opportunities/${o.id}`, { data });
      toast('Dati salvati');
      refresh?.();
    } } }, 'Salva')),
  form,
  h('div.en-type-block', h('div.en-type-title', 'Scadenze'), rows,
    h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addRow() } }, icon('plus', { size: 15 }), 'Aggiungi scadenza')))];
}

// Scadenze in arrivo (FV classico), per la panoramica.
export async function deadlinesCard() {
  const list = await get('/api/energy/scadenze?days=60', { quiet: true }).catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  return h('section.card.sw-card', h('h3', 'Scadenze nei prossimi 60 giorni'),
    list.length ? h('div.en-links', list.map(s => h('a.en-link', { href: `#/energy/opportunita/${s.id}` },
      h('div.grow', h('strong', s.label), h('div.t-meta', s.title)),
      h('span', { class: s.date < today ? 'due-late' : '' }, fmtDate(s.date, { year: true })))))
      : h('p.muted.small', 'Nessuna scadenza. Si inseriscono nella scheda delle opportunità del FV classico.'));
}
