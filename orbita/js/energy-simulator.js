// Alma Energy: simulatore dei rendimenti (ALM2-6 … ALM2-9). Si sceglie lo scenario (FV classico, revamping, PPA on-site),
// si cambiano le ipotesi a sinistra e i risultati si ricalcolano a destra; lo scenario si salva su un'opportunità (o in
// bozza), si confronta con gli altri e si esporta in Excel. Aperto da un'opportunità, parte dai suoi dati.
import { h, fill, toast, loading, debounce, confirmDialog } from './ui.js';
import { get, post, patch, del, api, qs } from './api.js';
import { icon } from './icons.js';
import { num, field, input, select } from './energy.js';

const MODELS = [['ppa_onsite', 'PPA on-site'], ['revamping', 'Revamping / Repowering'], ['fv_classico', 'FV classico']];
const KIND_MODEL = { ppa_onsite: 'ppa_onsite', revamping: 'revamping', fv_classico: 'fv_classico' };

// Campi delle ipotesi: [chiave, etichetta, unità, tipo]. «pct» si scrive in percentuale e si manda come frazione.
const FIELDS = {
  ppa_onsite: [
    ['Impianto', [['roofArea', 'Superficie del tetto', 'm²'], ['usableShare', 'Quota utilizzabile', '%', 'pct'], ['kwpPerM2', 'Densità', 'kWp/m²'],
      ['kwhPerKwp', 'Producibilità', 'kWh/kWp'], ['epcPerKwp', 'Costo EPC', '€/kWp']]],
    ['Contratto PPA', [['ppaPrice', 'Prezzo PPA', '€/MWh'], ['ppaIndexation', 'Indicizzazione annua', '%', 'pct'], ['selfConsumption', 'Consumata dal cliente', '%', 'pct'],
      ['exportPrice', 'Prezzo dell\'energia immessa', '€/MWh'], ['years', 'Durata', 'anni'], ['roofRent', 'Canone del tetto', '€/anno'],
      ['omPerKwp', 'O&M e assicurazione', '€/kWp/anno'], ['residualValue', 'Cessione a fine contratto', '€'], ['billPrice', 'Prezzo in bolletta oggi', '€/MWh']]],
  ],
  revamping: [
    ['Impianto', [['sizeMw', 'Taglia attuale', 'MW'], ['purchasePerMw', 'Prezzo d\'acquisto', '€/MW'], ['revampPerMw', 'Costo del revamping', '€/MW'],
      ['sizeIncreaseMw', 'Aumento di taglia', 'MW']]],
    ['Incentivo Conto Energia', [['incentiveAnnual', 'Incasso GSE annuo', '€/anno'], ['incentivePerKwh', 'Oppure tariffa', '€/kWh'], ['incentiveYearsLeft', 'Anni di incentivo residui', 'anni']]],
    ['Rivendita', [['resalePerMw', 'Prezzo di rivendita', '€/MW'], ['cycleMonths', 'Durata del ciclo', 'mesi']]],
  ],
  fv_classico: [
    ['Pipeline', [['projectsYear1', 'Progetti avviati nel primo anno', 'n.'], ['mwpPerProject', 'MWp medi per progetto', 'MWp'], ['growthYear2', 'Crescita anno 2', '%', 'pct'],
      ['growthYear3', 'Crescita anno 3', '%', 'pct'], ['rtbRate', 'Tasso di successo verso RTB', '%', 'pct'], ['share', 'Quota Almacis nella SPV', '%', 'pct']]],
    ['Costi di sviluppo', [['devFundPerMwp', 'Fondo spese', '€/MWp'], ['connectionPerMwp', 'Connessione', '€/MWp'], ['landDepositPerMwp', 'Caparra terreni', '€/MWp']]],
    ['Prezzi', [['callPricePerMwp', 'Call option Almacis', '€/MWp'], ['thirdPartyPricePerMwp', 'Cessione a terzi', '€/MWp'], ['thirdPartyShare', 'Quota ceduta a terzi', '%', 'pct']]],
    ['B · Costruisci e vendi', [['buildShareB', 'Quota da costruire', '%', 'pct'], ['epcPerMwpB', 'EPC', '€/MWp'], ['salePerMwpB', 'Prezzo di vendita', '€/MWp']]],
    ['C · Costruisci e gestisci', [['buildShareC', 'Quota da costruire', '%', 'pct'], ['epcPerMwpC', 'EPC', '€/MWp'], ['revenuePerMwpC', 'Ricavi energia e incentivi', '€/MWp/anno'],
      ['omPerMwpC', 'O&M e costi fissi', '€/MWp/anno'], ['holdYearsC', 'Anni di gestione', 'anni']]],
  ],
};
// Ipotesi finanziarie comuni (motore dei flussi), non per il FV classico che segue il BusinessPlan.
const FINANCE = ['Ipotesi finanziarie', [['hours', 'Ore equivalenti (primo anno)', 'h'], ['decalage', 'Decalage', '%', 'pct'], ['inflation', 'Inflazione', '%', 'pct'],
  ['opexPerMw', 'OPEX', '€/MW/anno'], ['price', 'Prezzo dell\'energia fisso (vuoto = curva)', '€/MWh'], ['leverage', 'Leva', '%', 'pct'], ['kd', 'Costo del debito', '%', 'pct'],
  ['ke', 'Costo dell\'equity', '%', 'pct'], ['debtYears', 'Durata del debito', 'anni'], ['depreciationYears', 'Ammortamento', 'anni'], ['ires', 'IRES', '%', 'pct'], ['irap', 'IRAP', '%', 'pct']]];

const eur = n => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `${num(Math.round(n))} €`);
const pct = (n, d = 1) => (n === null || n === undefined ? '—' : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: d })}%`);
const yrs = n => (n === null || n === undefined ? '—' : `${n.toLocaleString('it-IT', { maximumFractionDigits: 1 })} anni`);
const x2 = n => (n === null || n === undefined ? '—' : `${n.toLocaleString('it-IT', { maximumFractionDigits: 2 })}×`);
const kpi = (label, value, sub, cls = '') => h('div.sw-kpi', { class: cls }, h('span.lab', label), h('strong.big', value), sub ? h('span.sub', sub) : null);

let defaultsCache = null;

export async function simulatorView(box, params) {
  defaultsCache ??= await get('/api/energy/simulate/defaults');
  const state = { model: 'ppa_onsite', input: {}, scenarioId: null, opportunityId: null, name: '', compare: new Set() };
  const oppId = Number(params.get('opp')) || null;
  const scenId = Number(params.get('s')) || null;

  // da uno scenario salvato o da un'opportunità: modello e ipotesi di partenza
  if (scenId) {
    const s = await get(`/api/energy/scenarios/${scenId}`);
    Object.assign(state, { model: s.model, input: { ...s.input }, scenarioId: s.id, opportunityId: s.opportunity_id, name: s.name });
  } else if (oppId) {
    const o = await get(`/api/energy/opportunities/${oppId}`);
    state.opportunityId = o.id;
    state.model = KIND_MODEL[o.kind] || 'ppa_onsite';
    state.input = prefillFrom(o);
    if (o.kind === 'revamping' && !o.data?.tecnici?.kwp && o.data?.incasso_recente) {
      state.note = 'Taglia e anni di incentivo sono stimati dall\'incasso GSE del Database CE: inserisci i dati veri nella scheda (dati tecnici da due diligence).';
    }
    state.name = `${o.title} – scenario`;
  }

  const { opportunities } = await get('/api/energy/opportunities?limit=5000');
  const modelSeg = h('div.seg.en-filter');
  const nameIn = input({ value: state.name, placeholder: 'Nome dello scenario', maxlength: 120 });
  const oppSel = select([['', 'Bozza (senza opportunità)'], ...opportunities.map(o => [o.id, o.title])], state.opportunityId || '');
  const form = h('div.en-sim-form');
  const results = h('div.en-sim-results', loading());
  const saved = h('div');

  const recompute = debounce(async () => {
    try {
      const r = await api('POST', '/api/energy/scenarios/calcola', { model: state.model, input: state.input }, { quiet: true });
      drawResults(results, state.model, r);
    } catch (err) {
      fill(results, h('div.banner', err.message));
    }
  }, 300);

  const drawModel = () => {
    fill(modelSeg, MODELS.map(([k, label]) => h('button', { type: 'button', class: k === state.model ? 'on' : '', on: { click: () => {
      if (k === state.model) return;
      state.model = k;
      state.input = {};
      state.scenarioId = null;
      drawModel();
    } } }, label)));
    drawForm(form, state, recompute);
    recompute();
  };

  async function drawSaved() {
    const list = await get(`/api/energy/scenarios${qs({ opportunity: state.opportunityId || 'bozze' })}`);
    const cmp = list.filter(s => state.compare.has(s.id));
    fill(saved, h('section.card.sw-card',
      h('div.en-sec-head', h('h3', state.opportunityId ? 'Scenari dell\'opportunità' : 'Bozze'),
        state.opportunityId ? h('a.btn.btn-ghost.btn-sm', { href: `#/energy/opportunita/${state.opportunityId}` }, 'Apri l\'opportunità') : null),
      list.length ? h('div.en-links', list.map(s => h('div.en-link', { class: s.id === state.scenarioId ? 'en-current' : '' },
        h('input', { type: 'checkbox', checked: state.compare.has(s.id), 'aria-label': `Confronta ${s.name}`, on: { change: e => {
          e.target.checked ? state.compare.add(s.id) : state.compare.delete(s.id);
          drawSaved();
        } } }),
        h('div.grow', h('strong', s.name, s.chosen ? h('span.pill.en-stage.en-target', ' scelto') : null),
          h('div.t-meta', `${MODELS.find(([k]) => k === s.model)?.[1]} · ${summaryLine(s.model, s.summary)}`)),
        h('a.btn.btn-ghost.btn-sm', { href: `#/energy/simulatore?s=${s.id}` }, 'Apri'),
        s.opportunity_id && !s.chosen ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
          await post(`/api/energy/scenarios/${s.id}/scegli`);
          toast('Scenario scelto: MW, capex e rendimento passano sull\'opportunità');
          drawSaved();
        } } }, 'Scegli') : null,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': `Cancella ${s.name}`, on: { click: async () => {
          if (!await confirmDialog(`Cancellare lo scenario «${s.name}»?`, { ok: 'Cancella', danger: true })) return;
          await del(`/api/energy/scenarios/${s.id}`);
          state.compare.delete(s.id);
          if (state.scenarioId === s.id) state.scenarioId = null;
          drawSaved();
        } } }, icon('trash', { size: 15 })))))
        : h('p.muted.small', 'Nessuno scenario salvato. Scegli le ipotesi e premi «Salva scenario».'),
      cmp.length >= 2 ? compareTable(cmp) : list.length >= 2 ? h('p.small.muted', 'Spunta due o tre scenari per confrontarli.') : null));
  }

  const saveBtn = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    const body = { name: nameIn.value.trim() || 'Scenario', model: state.model, input: state.input, opportunity_id: Number(oppSel.value) || null };
    if (state.scenarioId && Number(oppSel.value || 0) === Number(state.opportunityId || 0)) {
      await patch(`/api/energy/scenarios/${state.scenarioId}`, { name: body.name, input: body.input });
      toast('Scenario aggiornato');
    } else {
      const s = await post('/api/energy/scenarios', body);
      state.scenarioId = s.id;
      toast('Scenario salvato');
    }
    state.opportunityId = Number(oppSel.value) || null;
    drawSaved();
  } } }, 'Salva scenario');
  const asNew = h('button.btn', { type: 'button', on: { click: () => { state.scenarioId = null; saveBtn.click(); } } }, 'Salva come nuovo');
  const exportBtn = h('button.btn', { type: 'button', on: { click: async () => {
    const res = await fetch('/api/energy/scenarios/excel', {
      method: 'POST', credentials: 'same-origin', headers: { 'X-Alma': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: state.model, input: state.input, name: nameIn.value.trim() || 'Scenario' }),
    });
    if (!res.ok) return toast('Export non riuscito', 'err');
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: `${(nameIn.value.trim() || 'Scenario').replace(/[\\/:*?"<>|]/g, ' ')}.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } } }, icon('sheet', { size: 16 }), 'Esporta Excel');
  oppSel.addEventListener('change', () => { state.opportunityId = Number(oppSel.value) || null; state.compare.clear(); drawSaved(); });

  fill(box,
    h('div.toolbar', modelSeg),
    h('div.toolbar', nameIn, oppSel, saveBtn, state.scenarioId ? asNew : null, exportBtn),
    state.note ? h('div.banner', state.note) : null,
    h('div.en-sim', form, results),
    saved);
  drawModel();
  await drawSaved();
}

// Dati dell'opportunità che fanno da ipotesi di partenza.
function prefillFrom(o) {
  const d = o.data || {};
  if (o.kind === 'ppa_onsite') return Object.fromEntries(Object.entries({ roofArea: d.superficie, kwhPerKwp: d.kwh_kwp }).filter(([, val]) => val));
  if (o.kind === 'revamping') {
    const kwp = Number(String(d.tecnici?.kwp || '').replace(',', '.'));
    const tariff = Number(String(d.tecnici?.tariffa || '').replace(',', '.'));
    const yearly = d.incasso_recente ? Math.round(d.incasso_recente) : undefined;
    // senza i dati tecnici: taglia stimata dall'incasso GSE (circa 0,30 €/kWh per 1.300 h) e 6 anni di incentivo
    // (Conto Energia 2011-2013 + 20 anni). Stime da confermare in due diligence: la pagina lo dice.
    const estimated = !kwp && yearly;
    return Object.fromEntries(Object.entries({
      incentiveAnnual: tariff ? undefined : yearly,
      incentivePerKwh: tariff || undefined,
      sizeMw: kwp ? kwp / 1000 : estimated ? Math.round((yearly / (0.3 * 1300 * 1000)) * 100) / 100 : undefined,
      incentiveYearsLeft: d.tecnici?.scadenza_incentivo
        ? Math.max(0, Math.round((Date.parse(d.tecnici.scadenza_incentivo) - Date.now()) / (365.25 * 86400000)))
        : yearly ? 6 : undefined,
      sizeIncreaseMw: estimated ? Math.round((yearly / (0.3 * 1300 * 1000)) * 0.3 * 100) / 100 : undefined,
    }).filter(([, val]) => val !== undefined));
  }
  return o.mw ? { projectsYear1: 1, mwpPerProject: Number(o.mw), growthYear2: 0, growthYear3: 0 } : {};
}

function defaultsFor(model) {
  const d = defaultsCache;
  return model === 'ppa_onsite' ? { ...d.defaults, ...d.ppa } : model === 'revamping' ? { ...d.defaults, ...d.revamping } : { ...d.fv };
}

function drawForm(form, state, onChange) {
  const defs = defaultsFor(state.model);
  const groups = [...FIELDS[state.model], ...(state.model === 'fv_classico' ? [] : [FINANCE])];
  fill(form, groups.map(([title, fields], gi) => h('details.en-sim-group', { open: gi < 2 },
    h('summary', title),
    h('div.en-row2', fields.map(([key, label, unit, kind]) => {
      const base = state.input[key] ?? defs[key];
      const shown = base === undefined || base === null ? '' : kind === 'pct' ? Math.round(base * 100 * 1000) / 1000 : base;
      const el = input({ value: shown, inputmode: 'decimal', placeholder: key === 'price' ? 'curva del Modello' : '' });
      el.addEventListener('input', () => {
        const raw = el.value.trim().replace(',', '.');
        if (raw === '') delete state.input[key];
        else if (Number.isFinite(Number(raw))) state.input[key] = kind === 'pct' ? Number(raw) / 100 : Number(raw);
        else return;
        onChange();
      });
      return field(`${label} (${unit})`, el);
    })))));
}

// ── risultati ────────────────────────────────────────────────────────────────
function drawResults(box, model, r) {
  if (model === 'fv_classico') return fill(box, fvResults(r));
  if (model === 'revamping') return fill(box, revampingResults(r));
  return fill(box, ppaResults(r));
}

function flowKpis(k) {
  return [
    kpi('IRR di progetto', pct(k.irrUnlevered), `WACC ${pct(k.wacc, 2)}`, k.irrUnlevered !== null && k.irrUnlevered < k.wacc ? 'warn' : ''),
    kpi('IRR dell\'equity', pct(k.irrLevered), `equity ${eur(k.equity)}`),
    kpi('VAN al WACC', eur(k.npvUnlevered), `VAN equity ${eur(k.npvLevered)}`, k.npvUnlevered < 0 ? 'warn' : ''),
    kpi('Payback', yrs(k.paybackUnlevered), `con il debito ${yrs(k.paybackLevered)}`),
    kpi('DSCR minimo', x2(k.dscrMin), k.dscrMin !== null ? `medio ${x2(k.dscrAvg)} · bancabile sopra 1,2×` : 'senza debito', k.dscrMin !== null && k.dscrMin < 1.2 ? 'warn' : ''),
    kpi('LCOE', k.lcoe ? `${num(k.lcoe, 1)} €/MWh` : '—', `capex ${eur(k.capex)}`),
  ];
}

// Cassa cumulata (levered) anno per anno: barre sotto lo zero finché l'investimento non torna.
function cashChart(rows) {
  let cum = 0;
  const vals = rows.map(r => (cum += r.fcfLevered));
  const max = Math.max(...vals.map(Math.abs), 1);
  return h('section.en-sec', h('h3', 'Cassa cumulata per l\'equity'),
    h('div.en-cash', { role: 'img', 'aria-label': 'Cassa cumulata anno per anno' }, vals.map((val, i) => h('div.en-cash-col', { title: `${rows[i].year}: ${eur(val)}` },
      h('i', { class: val < 0 ? 'neg' : '', style: { height: `${Math.max(1, (Math.abs(val) / max) * 50)}%`, [val < 0 ? 'top' : 'bottom']: '50%' } })))),
    h('div.en-cash-axis', h('span', String(rows[0].year)), h('span', String(rows[rows.length - 1].year))));
}

function sensitivityTable(s) {
  if (!s) return null;
  const label = { prezzo: 'Prezzo dell\'energia', capex: 'Capex', producibilita: 'Producibilità' };
  return h('section.en-sec', h('h3', 'Sensitività: IRR dell\'equity'), h('div.table-wrap', h('table.list.en-small',
    h('thead', h('tr', h('th', ''), s.prezzo.map(x => h('th.num', x.delta === 0 ? 'base' : `${x.delta > 0 ? '+' : ''}${x.delta * 100}%`)))),
    h('tbody', Object.entries(s).map(([k, list]) => h('tr', h('td', label[k] || k), list.map(x => h('td.num', { class: x.delta === 0 ? 'en-base' : '' }, pct(x.irrLevered)))))))));
}

function flowsTable(rows) {
  const cols = [['year', 'Anno'], ['energy', 'MWh'], ['revenue', 'Ricavi'], ['extraRevenue', 'Altri ricavi'], ['opex', 'OPEX'], ['ebitda', 'EBITDA'],
    ['interest', 'Interessi'], ['taxes', 'Imposte'], ['netIncome', 'Utile'], ['fcfLevered', 'Cassa equity']];
  return h('details.en-sec', h('summary', 'Flussi anno per anno'), h('div.table-wrap', h('table.list.en-small',
    h('thead', h('tr', cols.map(([, l]) => h('th.num', l)))),
    h('tbody', rows.map(r => h('tr', cols.map(([k]) => h('td.num', k === 'year' ? String(r.year) : num(Math.round(r[k] || 0))))))))));
}

function ppaResults(r) {
  return [
    h('div.sw-kpis',
      kpi('Potenza', `${num(r.plant.kwp)} kWp`, `${num(r.plant.energy1)} MWh il primo anno`),
      kpi('Capex', eur(r.plant.capex), `ricavi anno 1 ${eur(r.plant.revenue1)}`),
      ...flowKpis(r.flows.kpi),
      kpi('Risparmio del cliente', eur(r.customer.saving1), `il primo anno · ${eur(r.customer.savingTotal)} sul contratto`, r.customer.saving1 <= 0 ? 'warn' : '')),
    cashChart(r.flows.rows), sensitivityTable(r.sensitivity), flowsTable(r.flows.rows),
  ];
}

function revampingResults(r) {
  const k = r.rivendita.kpi;
  const best = r.confronto.meglio;
  return [
    h('div.en-versus',
      h('section.card.sw-card', { class: best === 'rivendita' ? 'en-best' : '' }, h('h3', 'Rivendita dopo il revamping', best === 'rivendita' ? h('span.pill.en-stage.en-target', ' conviene') : null),
        h('div.sw-kpis.sm',
          kpi('Utile del ciclo', eur(k.netIncome), `ricavo ${eur(k.resale)} · ${num(r.inputs.cycleMonths)} mesi`),
          kpi('ROE del ciclo', pct(k.roe), `equity ${eur(k.equity)}`),
          kpi('Margine per MW', eur(k.marginPerMw), `${num(r.sizeAfter, 2)} MW dopo il repowering`))),
      h('section.card.sw-card', { class: best === 'gestione' ? 'en-best' : '' }, h('h3', 'Gestione in portafoglio', best === 'gestione' ? h('span.pill.en-stage.en-target', ' conviene') : null),
        h('div.sw-kpis.sm',
          kpi('VAN dell\'equity', eur(r.gestione.kpi.npvLevered), `al Ke ${pct(r.inputs.ke, 1)}`),
          kpi('IRR dell\'equity', pct(r.gestione.kpi.irrLevered), `di progetto ${pct(r.gestione.kpi.irrUnlevered)}`),
          kpi('DSCR minimo', x2(r.gestione.kpi.dscrMin), `payback ${yrs(r.gestione.kpi.paybackUnlevered)}`)))),
    h('p.small.muted', 'Il confronto mette l\'utile della rivendita accanto al valore attuale della cassa in gestione, sulla stessa equity. L\'incentivo vale solo sulla produzione dell\'impianto di partenza e fino agli anni residui.'),
    cashChart(r.gestione.rows), sensitivityTable(r.sensitivity), flowsTable(r.gestione.rows),
  ];
}

function fvResults(r) {
  const { A, B, C } = r.variants;
  const rows = [['Esborsi Almacis', 'outflow', eur], ['Ricavi Almacis', 'revenue', eur], ['Risultato netto', 'net', eur], ['ROI sugli esborsi', 'roi', x => pct(x, 0)],
    ['MWp costruiti', 'built', x => num(x, 1)], ['Capitale a rischio', 'atRisk', eur]];
  return [
    h('section.en-sec', h('h3', `Quota Almacis sui tre anni · ${num(A.totals.mwp, 0)} MWp sviluppati, ${num(A.totals.rtb, 0)} a RTB`),
      h('div.table-wrap', h('table.list.en-small',
        h('thead', h('tr', h('th', ''), h('th.num', 'A · Solo sviluppo'), h('th.num', 'B · Costruisci e vendi'), h('th.num', 'C · Costruisci e gestisci'))),
        h('tbody', rows.map(([label, key, fmt]) => h('tr', h('td', label), [A, B, C].map(v => h('td.num', fmt(v.totals[key]))))))))),
    h('div.sw-kpis',
      kpi('IRR a 25 anni (C)', pct(C.longTerm.irr), `impianti costruiti il primo anno · payback ${yrs(C.longTerm.payback)}`),
      kpi('Cassa a 25 anni (C)', eur(C.longTerm.cashTotal), 'quota Almacis, senza debito')),
    h('p.small.muted', 'Su tre anni la gestione (C) sembra in perdita perché l\'EPC si paga subito e i ricavi arrivano negli anni dopo: per questo c\'è anche l\'IRR a 25 anni.'),
    h('details.en-sec', h('summary', 'Anno per anno'), [A, B, C].map(v => h('div.table-wrap', h('table.list.en-small',
      h('thead', h('tr', h('th', `Variante ${v.key}`), h('th.num', 'MWp'), h('th.num', 'A RTB'), h('th.num', 'Costruiti'), h('th.num', 'Esborsi'), h('th.num', 'Ricavi'), h('th.num', 'Risultato'))),
      h('tbody', v.years.map(y => h('tr', h('td', `Anno ${y.year}`), h('td.num', num(y.mwp, 1)), h('td.num', num(y.rtb, 1)), h('td.num', num(y.built, 1)),
        h('td.num', eur(y.outflow)), h('td.num', eur(y.revenue)), h('td.num', eur(y.net))))))))),
  ];
}

function summaryLine(model, s = {}) {
  if (model === 'fv_classico') return `ROI A ${pct(s.roiA, 0)} · B ${pct(s.roiB, 0)} · IRR C 25 anni ${pct(s.irrC25)}`;
  if (model === 'revamping') return `${num(s.mw, 2)} MW · IRR gestione ${pct(s.irr)} · ROE rivendita ${pct(s.roeRivendita, 0)}`;
  return `${num(s.mw, 2)} MW · capex ${eur(s.capex)} · IRR ${pct(s.irr)}`;
}

function compareTable(list) {
  const keys = [...new Set(list.flatMap(s => Object.keys(s.summary || {})))].filter(k => k !== 'meglio');
  const LABELS = { mw: 'MW', capex: 'Capex', irr: 'IRR equity', irrUnlevered: 'IRR progetto', npv: 'VAN equity', payback: 'Payback', dscrMin: 'DSCR minimo',
    lcoe: 'LCOE', saving1: 'Risparmio cliente anno 1', roeRivendita: 'ROE rivendita', utileRivendita: 'Utile rivendita', roiA: 'ROI A', roiB: 'ROI B', roiC: 'ROI C',
    netA: 'Risultato A', netB: 'Risultato B', netC: 'Risultato C', irrC25: 'IRR C 25 anni', atRisk: 'Capitale a rischio' };
  const fmt = (k, val) => (val === null || val === undefined ? '—'
    : /^(irr|roe|roi)/i.test(k) ? pct(val) : k === 'dscrMin' ? x2(val) : k === 'payback' ? yrs(val) : k === 'mw' ? num(val, 2) : k === 'lcoe' ? `${num(val, 1)} €/MWh` : eur(val));
  return h('div.table-wrap', h('table.list.en-small',
    h('thead', h('tr', h('th', 'Confronto'), list.map(s => h('th.num', s.name)))),
    h('tbody', keys.map(k => h('tr', h('td', LABELS[k] || k), list.map(s => h('td.num', fmt(k, s.summary?.[k]))))))));
}

// Riquadro «Scenari» nella scheda dell'opportunità.
export async function scenariosSection(o) {
  const list = await get(`/api/energy/scenarios?opportunity=${o.id}`, { quiet: true }).catch(() => []);
  return h('section.en-sec', h('div.en-sec-head', h('h3', 'Scenari del simulatore'),
    h('a.btn.btn-sm', { href: `#/energy/simulatore?opp=${o.id}` }, icon('plus', { size: 15 }), 'Nuovo scenario')),
  list.length ? h('div.en-links', list.map(s => h('a.en-link', { href: `#/energy/simulatore?s=${s.id}` },
    h('div.grow', h('strong', s.name, s.chosen ? h('span.pill.en-stage.en-target', ' scelto') : null), h('div.t-meta', summaryLine(s.model, s.summary))))))
    : h('p.muted.small', o.kind === 'ppa_onsite' ? 'Nessuno scenario: serve per passare alla «Proposta PPA».' : 'Nessuno scenario salvato.'));
}

