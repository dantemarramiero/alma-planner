// Alma Energy: parametri dei tier (ALM2-22). Screening dei tetti (gli stessi del foglio «Ipotesi» del file) e Database
// Conto Energia (priorità del file o regole di Alma Energy). A sinistra i parametri, a destra l'anteprima che si
// aggiorna mentre si scrive: quante opportunità finiscono in A, B, C (e D) prima e dopo. «Applica» ricalcola.
import { h, fill, toast, loading, debounce, confirmDialog, fmtDateTime } from './ui.js';
import { get, post } from './api.js';
import { num, field, input } from './energy.js';

const PRIORITIES = ['A', 'B', 'C', 'D', 'Dati insufficienti'];
const PROFILE_HINTS = {
  D1: 'Diurni 7 giorni su 7 o ciclo continuo', D2: 'Energivori su 2-3 turni', D3: 'Cinque giorni, un turno', D4: 'Consumi bassi o nulli',
  ND: 'Azienda non identificata', X: 'Escluso (infrastrutture elettriche): resta C',
};

// Campi: [chiave, etichetta, unità, tipo]. «pct» si scrive in percentuale e si salva come frazione.
const SCREENING_GROUPS = [
  ['Taglia', [['areaMin', 'Superficie a cui la taglia vale 0', 'm²'], ['areaMax', 'Superficie a cui vale il massimo', 'm²'], ['sizePoints', 'Punti massimi della taglia', 'punti']]],
  ['Soglie', [['thresholdA', 'Priorità A da', 'punti'], ['thresholdB', 'Priorità B da', 'punti']]],
  ['Impianto ed economics', [['usableShare', 'Quota del tetto utilizzabile', '%', 'pct'], ['kwpPerM2', 'Densità di potenza', 'kWp/m²'],
    ['energyPrice', 'Prezzo dell\'energia indicativo', '€/MWh'], ['epcPerKwp', 'Costo EPC indicativo', '€/kWp']]],
];
const CE_GROUPS = [
  ['Calo degli incassi', [['minDrop', 'Calo minimo (sotto è D)', '%', 'pct'], ['dropMax', 'Calo a cui vale il massimo', '%', 'pct'], ['dropPoints', 'Punti massimi', 'punti']]],
  ['Incassi persi', [['lostMin', 'Incassi persi a 0 punti', '€/anno'], ['lostMax', 'Incassi persi al massimo', '€/anno'], ['lostPoints', 'Punti massimi', 'punti']]],
  ['Soglie', [['thresholdA', 'Priorità A da', 'punti'], ['thresholdB', 'Priorità B da', 'punti'], ['thresholdC', 'Priorità C da', 'punti']]],
];

const shown = (v, kind) => (v === undefined || v === null ? '' : kind === 'pct' ? Math.round(v * 100 * 1000) / 1000 : v);
const parse = (raw, kind) => {
  const n = Number(String(raw).trim().replace(',', '.'));
  return raw.trim() === '' || !Number.isFinite(n) ? undefined : kind === 'pct' ? n / 100 : n;
};

function numField(obj, key, label, unit, kind, onChange) {
  const el = input({ value: shown(obj[key], kind), inputmode: 'decimal' });
  el.addEventListener('input', () => {
    const v = parse(el.value, kind);
    if (v === undefined) return;
    obj[key] = v;
    onChange();
  });
  return field(`${label} (${unit})`, el);
}

const group = (title, children, open = true) => h('details.en-sim-group', { open }, h('summary', title), h('div.en-row2', children));

export async function paramsView(box) {
  fill(box, loading());
  const data = await get('/api/energy/parametri');
  let tab = 'screening';
  const state = { screening: structuredClone(data.screening), database_ce: structuredClone(data.database_ce) };
  const form = h('div.en-sim-form');
  const preview = h('div.en-sim-results');
  const tabs = h('div.seg.en-filter', [['screening', 'Screening tetti (PPA)'], ['database_ce', 'Database CE (revamping)']].map(([k, label]) =>
    h('button', { type: 'button', class: k === tab ? 'on' : '', on: { click: e => {
      tab = k;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      draw();
    } } }, label)));
  fill(box, h('div.toolbar', tabs), h('div.en-sim', form, preview), h('div.en-params-log'));

  const refresh = debounce(async () => {
    try {
      const r = await post(`/api/energy/parametri/${tab}/anteprima`, { params: state[tab] }, { quiet: true });
      drawPreview(r);
    } catch (err) {
      fill(preview, h('div.card.empty', err.message));
    }
  }, 300);

  function draw() {
    fill(form, tab === 'screening' ? screeningForm() : ceForm());
    fill(preview, loading());
    refresh();
    drawLog();
  }

  function screeningForm() {
    const p = state.screening;
    return [
      h('p.muted', 'Punteggio da 0 a 100 = punti della taglia (scala logaritmica fra le due superfici) + punti del profilo di consumo. Con i valori del file i punteggi sono uguali a quelli dello screening.'),
      ...SCREENING_GROUPS.slice(0, 1).map(([t, f]) => group(t, f.map(([k, l, u, kind]) => numField(p, k, l, u, kind, refresh)))),
      group('Profilo di consumo', data.profiles.map(k => numField(p.profilePoints, k, `${k} · ${PROFILE_HINTS[k]}`, 'punti', null, refresh))),
      ...SCREENING_GROUPS.slice(1).map(([t, f]) => group(t, f.map(([k, l, u, kind]) => numField(p, k, l, u, kind, refresh)))),
      resetButton(),
    ];
  }

  function ceForm() {
    const p = state.database_ce;
    const mode = h('div.seg', [['file', 'Priorità del file'], ['regole', 'Regole di Alma Energy']].map(([k, label]) =>
      h('button', { type: 'button', class: p.mode === k ? 'on' : '', on: { click: () => { p.mode = k; draw(); } } }, label)));
    const rules = p.mode === 'regole';
    return [
      field('Priorità usata', mode, rules
        ? 'Punteggio = calo + incassi persi + andamento + tipo di proprietario + segnali. Sotto il calo minimo la convenzione è D, senza dati «Dati insufficienti».'
        : 'Le priorità A–D scritte nel file. Passa alle regole per pesare tu i criteri.'),
      ...(rules ? [
        ...CE_GROUPS.slice(0, 2).map(([t, f]) => group(t, f.map(([k, l, u, kind]) => numField(p, k, l, u, kind, refresh)))),
        group('Andamento', Object.keys(p.trendPoints).map(k => numField(p.trendPoints, k, k, 'punti', null, refresh)), false),
        group('Tipo di proprietario', Object.keys(p.ownerPoints).map(k => numField(p.ownerPoints, k, k, 'punti', null, refresh)), false),
        group('Segnali dalle note', data.signals.map(([k, label]) => numField(p.signalPoints, k, label, 'punti', null, refresh)), false),
        group(CE_GROUPS[2][0], CE_GROUPS[2][1].map(([k, l, u, kind]) => numField(p, k, l, u, kind, refresh))),
      ] : []),
      resetButton(),
    ];
  }

  function resetButton() {
    return h('div.en-stage-row', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => {
      state[tab] = { ...structuredClone(data.defaults[tab]), ...(tab === 'database_ce' ? { mode: state.database_ce.mode } : {}) };
      draw();
    } } }, tab === 'screening' ? 'Torna ai valori del file' : 'Torna ai pesi proposti'));
  }

  function drawPreview(r) {
    const keys = PRIORITIES.filter(k => r.before[k] || r.after[k]);
    const updated = data.updated[tab];
    const apply = async toPipeline => {
      const what = tab === 'screening' ? 'tetti dello screening' : 'convenzioni del Database CE';
      if (!await confirmDialog(`Applicare i parametri? Cambia la priorità di ${num(r.changed)} ${what}; stadi, note e responsabili restano come sono.`, { ok: 'Applica' })) return;
      const done = await post(`/api/energy/parametri/${tab}`, { params: state[tab], to_pipeline: toPipeline });
      toast(`Priorità ricalcolate: ${num(done.changed)} cambiate${done.opportunities ? `, ${num(done.opportunities)} proprietari portati in pipeline` : ''}`);
      return paramsView(box).then(() => {}); // rilegge parametri e registro
    };
    fill(preview,
      h('section.card.sw-card',
        h('h3', 'Anteprima'),
        r.total ? h('table.en-params-table',
          h('thead', h('tr', h('th', 'Priorità'), h('th', 'Ora'), h('th', 'Con questi parametri'))),
          h('tbody', keys.map(k => h('tr', h('td', k), h('td', num(r.before[k] || 0)), h('td', { class: (r.after[k] || 0) !== (r.before[k] || 0) ? 'en-changed' : '' }, num(r.after[k] || 0))))))
          : h('p.muted', tab === 'screening' ? 'Nessun tetto dello screening in Alma Energy: importalo dalla pipeline PPA on-site (o fai uno screening per provincia).' : 'Il Database CE è vuoto: importalo dalla pipeline Revamping.'),
        r.total ? h('p', `${num(r.changed)} di ${num(r.total)} cambiano priorità.`) : null,
        r.ownersToPipeline ? h('p.muted', `${num(r.ownersToPipeline)} proprietari avrebbero una convenzione A o B ma non sono in pipeline.`) : null,
        h('div.en-stage-row',
          h('button.btn.btn-primary', { type: 'button', disabled: !r.total, on: { click: () => apply(false) } }, 'Applica'),
          r.ownersToPipeline ? h('button.btn', { type: 'button', on: { click: () => apply(true) } }, `Applica e porta in pipeline ${num(r.ownersToPipeline)} proprietari`) : null),
        updated ? h('p.t-meta', `Ultima modifica: ${fmtDateTime(updated.at)}${updated.by ? ` · ${updated.by}` : ''}`) : h('p.t-meta', 'Ancora i valori di partenza.')));
  }

  function drawLog() {
    const rows = data.log.filter(l => l.key === tab);
    fill(box.querySelector('.en-params-log'), rows.length ? h('section.card.sw-card',
      h('h3', 'Modifiche'),
      h('ul.en-history', rows.map(l => h('li',
        h('strong', `${num(l.summary.changed || 0)} priorità cambiate`),
        l.summary.opportunities ? h('span.muted', ` · ${num(l.summary.opportunities)} proprietari in pipeline`) : null,
        h('div.t-meta', [fmtDateTime(l.at), l.user_name].filter(Boolean).join(' · ')))))) : null);
  }

  draw();
}
