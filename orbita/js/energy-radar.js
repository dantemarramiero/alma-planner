// Alma Energy · Radar energia (ALM2-74 tappa 3, tavola «CRM verticale · Radar energia» del canvas approvato da Dante il
// 24/11/2026). Solo segnali per un IPP: cessioni, autorizzazioni, revamping e Conto Energia dal Database CE, aste FER.
// Elenco per punteggio a sinistra, il segnale aperto a destra; «Prendi» crea azienda, opportunità e bozza di analisi.
import { h, fill, modal, toast, loading, debounce, promptDialog, fmtDate } from './ui.js';
import { get, post, put, qs } from './api.js';
import { icon } from './icons.js';
import { num, field, select, ensureMeta } from './energy.js';

const KIND_CLASS = { cessione: 'acq', autorizzazione: 'fv', revamping: 'rev', conto_energia: 'rev', asta_fer: 'ppa', notizia: '', fondo: 'acq', energivoro: 'ppa' };
const PARTS = [['coerenza', 'Coerenza', 30], ['valore', 'Valore', 25], ['tempi', 'Tempi', 20], ['rapporto', 'Rapporto', 15], ['zona', 'Zona', 10]];
const TAKE_TEXT = {
  cessione: 'il venditore entra nel CRM, nasce un\'opportunità nella pipeline Revamping (acquisizione) e una bozza di analisi «Acquisizione» con i MW',
  revamping: 'il proprietario entra nel CRM con le sue convenzioni, nasce un\'opportunità Revamping e una bozza di analisi «Revamping»',
  conto_energia: 'il proprietario entra nel CRM con le sue convenzioni, nasce un\'opportunità Revamping e una bozza di analisi «Acquisizione»',
  autorizzazione: 'lo sviluppatore entra nel CRM, nasce un\'opportunità FV classico e una bozza di analisi «FV nuovo» con i MW',
  asta_fer: 'lo sviluppatore entra nel CRM, nasce un\'opportunità FV classico e una bozza di analisi «FV nuovo»',
  notizia: 'l\'azienda entra nel CRM, nasce un\'opportunità FV classico e una bozza di analisi',
  fondo: 'il fondo entra nel CRM centrale come «Fondo o investitore», con un primo mandato letto dalla notizia, e compare in Clienti e contatti → Fondi',
  energivoro: 'l\'azienda entra nel CRM centrale come energivora, nasce un\'opportunità PPA on-site e una bozza di analisi col tetto',
};
// ALM2-93: il radar IPP filtra per pipeline e «In pipeline» chiede solo dove metterla (proposta quella del tipo)
const PIPE_FILTERS = [['', 'Tutti', ''], ['revamping', 'Revamping', 'revamping,conto_energia,cessione'], ['fv', 'FV classico', 'autorizzazione,notizia'],
  ['ppa', 'PPA on-site', 'energivoro'], ['aste', 'Aste e bandi', 'asta_fer']];
const PIPE_OF = { cessione: 'revamping', revamping: 'revamping', conto_energia: 'revamping', autorizzazione: 'fv_classico', asta_fer: 'fv_classico', notizia: 'fv_classico', energivoro: 'ppa_onsite' };
const PIPE_LABEL = { revamping: 'Revamping', fv_classico: 'FV classico', ppa_onsite: 'PPA on-site' };
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '');
const when = iso => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');

export async function radarView(box, opts = {}) {
  await ensureMeta();
  const state = { status: 'nuovo', kind: opts.kinds || '', pipe: '', q: '', open: null };
  const kinds = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Tipo di segnale' });
  const statuses = h('div.seg.en-filter', { role: 'group', 'aria-label': 'Stato' });
  const body = h('div', loading());
  const foot = h('p.muted.en-iter-note');
  const searchBtn = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    searchBtn.disabled = true;
    try {
      const r = await post('/api/energy/radar/cerca', {});
      const n = Object.values(r.added).reduce((a, b) => a + b, 0);
      toast(n ? `${n} segnali nuovi (Database CE ${r.added.database_ce}, Alma Impianti ${r.added.impianti}, web ${r.added.web})` : 'Nessun segnale nuovo');
      if (r.errors.length) toast(r.errors.join(' · '), 'err');
      load();
    } finally { searchBtn.disabled = false; }
  } } }, icon('radar', { size: 15 }), 'Cerca segnali nuovi');
  fill(box,
    opts.note ? h('p.muted.en-lead', opts.note) : opts.pipes ? null : h('p.muted.en-lead', 'Solo segnali per chi possiede e sviluppa impianti: cessioni, autorizzazioni da comprare, convenzioni in calo, aste. Il radar del CRM edilizia resta separato.'),
    h('div.toolbar.en-sel-toolbar', kinds, statuses,
      h('input.input.grow', { type: 'search', placeholder: 'Cerca nel titolo o per azienda…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      opts.pipes ? null : h('button.btn', { type: 'button', on: { click: () => addDialog(load) } }, icon('plus', { size: 15 }), 'Aggiungi un segnale'),
      opts.pipes ? null : h('button.btn.btn-ghost', { type: 'button', 'aria-label': 'Impostazioni del radar', on: { click: () => settingsDialog(load) } }, icon('settings', { size: 16 })),
      searchBtn),
    body, foot);

  async function load() {
    const d = await get(`/api/energy/radar${qs({ status: state.status, kind: state.kind, q: state.q })}`);
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
    if (opts.kinds) kinds.hidden = true;
    else if (opts.pipes) {
      // i conteggi per pipeline arrivano dal giro senza filtro
      const all = state.kind ? (await get(`/api/energy/radar${qs({ status: state.status })}`)).counts : d.counts;
      fill(kinds, PIPE_FILTERS.map(([k, label, ks]) => h('button', { type: 'button', class: state.pipe === k ? 'on' : '',
        on: { click: () => { state.pipe = k; state.kind = ks; state.open = null; load(); } } },
        `${label} ${ks ? ks.split(',').reduce((a, x) => a + (all[x] || 0), 0) : Object.values(all).reduce((a, b) => a + b, 0)}`)));
    } else fill(kinds, [['', `Tutti ${total}`], ...Object.entries(d.kinds).filter(([k]) => d.counts[k] || k === state.kind).map(([k, l]) => [k, `${l} ${d.counts[k] || 0}`])].map(([k, label]) =>
      h('button', { type: 'button', class: state.kind === k ? 'on' : '', on: { click: () => { state.kind = k; state.open = null; load(); } } }, label)));
    fill(statuses, [['nuovo', 'Da decidere'], ['preso', 'Presi'], ['scartato', 'Scartati']].map(([k, label]) =>
      h('button', { type: 'button', class: state.status === k ? 'on' : '', on: { click: () => { state.status = k; state.open = null; load(); } } }, `${label}${d.byStatus[k] ? ` ${d.byStatus[k]}` : ''}`)));
    fill(foot, d.last_run ? `Ultimo giro ${when(d.last_run.at)}: Database CE ${d.last_run.added.database_ce || 0}, Alma Impianti ${d.last_run.added.impianti || 0}, web ${d.last_run.added.web || 0}. ` : 'Nessun giro ancora: «Cerca segnali nuovi» ne fa uno adesso. ',
      d.web ? `Ricerca web ${d.settings.web ? 'accesa' : 'spenta'}: spesi ${num(d.spent, 2)} € su ${num(d.settings.quota_eur)} € del mese.` : 'Ricerca web non disponibile (manca la chiave OpenAI): il radar usa Database CE e Alma Impianti.');
    if (!d.signals.length) {
      state.open = null;
      return fill(body, h('div.card.empty', state.status === 'nuovo' ? 'Nessun segnale da decidere. «Cerca segnali nuovi» legge Database CE, Alma Impianti e il web.' : 'Nessun segnale qui.'));
    }
    if (!d.signals.some(s => s.id === state.open)) state.open = d.signals[0].id;
    const open = d.signals.find(s => s.id === state.open);
    fill(body, h('div.en-rd',
      h('div.card.en-rd-list', d.signals.map(s => h('article.en-rd-sig', { class: s.id === state.open ? 'on' : '', tabindex: 0,
        on: { click: () => { state.open = s.id; load(); }, keydown: e => { if (e.key === 'Enter') { state.open = s.id; load(); } } } },
      h('div.en-rd-score', { class: s.score >= 70 ? 'hi' : '' }, String(s.score)),
      h('div.en-rd-main',
        h('div.en-rd-title', h('strong', s.title), h('span.pill.en-pt', { class: `en-pt-${KIND_CLASS[s.kind] || ''}` }, PIPE_OF[s.kind] ? `${d.kinds[s.kind]} → ${PIPE_LABEL[PIPE_OF[s.kind]]}` : d.kinds[s.kind])),
        h('div.t-meta', [s.region, s.place, s.mw ? `${num(s.mw, 2)} MW` : null, d.sources[s.source], s.published_on ? day(s.published_on) : day(s.created_at)].filter(Boolean).join(' · ')),
        s.status === 'scartato' && s.discard_reason ? h('div.t-meta', `Scartato: ${s.discard_reason}`) : null,
        s.status === 'preso' && s.opportunity_id ? h('div.t-meta', 'Preso: ', h('a', { href: `#/energy/opportunita/${s.opportunity_id}`, on: { click: e => e.stopPropagation() } }, s.opportunity_title || 'opportunità')) : null),
      s.status === 'nuovo' ? h('div.en-sel-actions',
        h('button.btn.btn-sm', { type: 'button', on: { click: e => { e.stopPropagation(); discard(s); } } }, 'Scarta'),
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: e => { e.stopPropagation(); take(s); } } }, opts.pipes || opts.kinds ? 'In pipeline' : 'Prendi')) : null))),
      open ? panel(open, d) : null));
  }

  function panel(s, d) {
    return h('aside.card.sw-card.en-rd-panel', { 'aria-label': 'Segnale aperto' },
      h('div', h('span.pill.en-pt', { class: `en-pt-${KIND_CLASS[s.kind] || ''}` }, d.kinds[s.kind]), h('h2', s.title)),
      s.summary ? h('p', s.summary) : null,
      s.why ? h('p.muted', s.why) : null,
      h('div.en-rd-parts', PARTS.map(([k, label, max]) => h('div', h('span.muted', label),
        h('div.en-rd-bar', h('i', { style: { width: `${Math.round(((s.score_parts?.[k] || 0) / max) * 100)}%` } })), h('b', `${s.score_parts?.[k] || 0}/${max}`)))),
      h('dl.en-dl',
        h('dt', 'Chi'), h('dd', s.entity || '—'), h('dt', 'Dove'), h('dd', [s.place, s.region].filter(Boolean).join(', ') || '—'),
        h('dt', 'Potenza'), h('dd', s.mw ? `${num(s.mw, 2)} MW` : '—'), h('dt', 'Entro'), h('dd', s.deadline ? day(s.deadline) : '—'),
        h('dt', 'Fonte'), h('dd', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, d.sources[s.source], ' ', icon('external', { size: 13 })) : d.sources[s.source])),
      s.status === 'nuovo' ? [
        h('div.en-rd-take', h('b', 'Cosa succede con «Prendi»'), h('p', TAKE_TEXT[s.kind] || TAKE_TEXT.notizia, '.')),
        h('div.en-stage-row', h('button.btn', { type: 'button', on: { click: () => discard(s) } }, 'Scarta con motivo'),
          h('button.btn.btn-primary', { type: 'button', on: { click: () => take(s) } }, 'In pipeline e crea l\'analisi'))] : null,
      s.status === 'preso' ? h('div.en-stage-row',
        s.opportunity_id ? h('a.btn', { href: `#/energy/opportunita/${s.opportunity_id}` }, 'Apri l\'opportunità') : null,
        s.analysis_id ? h('a.btn.btn-primary', { href: `#/energy/analisi/${s.analysis_id}` }, 'Apri l\'analisi') : null) : null,
      s.status === 'scartato' ? h('div.en-stage-row', h('button.btn', { type: 'button', on: { click: async () => { await post(`/api/energy/radar/${s.id}/riapri`); toast('Di nuovo da decidere'); load(); } } }, 'Riapri')) : null,
      s.source === 'impianti' ? h('p.muted.en-iter-note', 'Letto dal radar di Alma Impianti: la ricerca la fa lì una volta sola.') : null);
  }

  async function discard(s) {
    const reason = await promptDialog('Perché si scarta?', { label: 'Motivo', ok: 'Scarta' });
    if (!reason) return;
    await post(`/api/energy/radar/${s.id}/scarta`, { reason });
    toast('Segnale scartato');
    load();
  }
  async function take(s) {
    const kind = PIPE_OF[s.kind] && s.kind !== 'energivoro' && s.source !== 'database_ce' ? await pickPipe(s) : null;
    if (kind === false) return;
    const r = await post(`/api/energy/radar/${s.id}/prendi`, kind ? { kind } : {});
    if (!r.analysis_id) { toast('Fondo aggiunto al CRM centrale'); location.hash = r.subject_id ? `#/energy/crm/scheda/${r.subject_id}` : '#/energy/crm/lead'; return; }
    toast('Preso: opportunità e bozza di analisi create');
    location.hash = `#/energy/analisi/${r.analysis_id}`;
  }
  await load();
}

// «In pipeline»: una domanda sola, la pipeline; proposta quella del tipo di segnale
function pickPipe(s) {
  return new Promise(resolve => {
    let done = false;
    const choice = { v: PIPE_OF[s.kind] };
    const opts = Object.entries(PIPE_LABEL).map(([k, label]) => h('label.en-check', h('input', { type: 'radio', name: 'rx-pipe', value: k, checked: k === choice.v, on: { change: () => { choice.v = k; } } }), label));
    const m = modal({
      title: 'In quale pipeline?',
      body: h('div.en-form', h('p.muted', s.title), h('div.en-rx-pick', opts), h('p.muted.en-iter-note', 'Nasce l\'opportunità con l\'azienda nel CRM centrale e una bozza di analisi.')),
      actions: [h('button.btn', { type: 'button', on: { click: () => { done = true; m.close(); resolve(false); } } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => { done = true; m.close(); resolve(choice.v); } } }, 'Metti in pipeline')],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function addDialog(onDone) {
  const title = h('input.input', { maxlength: 500, autofocus: true, placeholder: 'es. Impianto 3,4 MW in vendita a Brindisi' });
  const kind = select([['cessione', 'Cessione'], ['autorizzazione', 'Autorizzazione'], ['revamping', 'Revamping'], ['conto_energia', 'Conto Energia'], ['asta_fer', 'Asta FER'], ['notizia', 'Notizia']], 'cessione');
  const entity = h('input.input', { maxlength: 300 });
  const region = h('input.input', { maxlength: 60 });
  const place = h('input.input', { maxlength: 120 });
  const mw = h('input.input', { inputmode: 'decimal' });
  const deadline = h('input.input', { type: 'date' });
  const url = h('input.input', { type: 'url', maxlength: 500 });
  const summary = h('textarea.input', { rows: 3, maxlength: 1500 });
  const m = modal({
    title: 'Aggiungi un segnale', wide: true,
    body: h('div.en-form', field('Cosa è successo', title), h('div.en-row2', field('Tipo', kind), field('Chi vende o ha il progetto', entity)),
      h('div.en-row2', field('Regione', region), field('Comune', place)), h('div.en-row2', field('MW', mw, 'Se vuoto, li leggo dal titolo'), field('Entro quando', deadline)),
      field('Link alla fonte', url), field('Note', summary)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await post('/api/energy/radar', { title: title.value.trim(), kind: kind.value, entity: entity.value.trim(), region: region.value.trim(), place: place.value.trim(),
          mw: mw.value.trim(), deadline: deadline.value || null, url: url.value.trim(), summary: summary.value.trim() });
        m.close(); toast('Segnale aggiunto'); onDone();
      } } }, 'Aggiungi')],
  });
}

export async function settingsDialog(onDone) {
  const { settings: s, spent } = await get('/api/energy/radar/impostazioni');
  const web = h('input', { type: 'checkbox', checked: s.web });
  const quota = h('input.input', { type: 'number', min: 0, max: 500, value: s.quota_eur });
  const regions = h('input.input', { value: s.regions.join(', '), placeholder: 'vuoto = tutta Italia' });
  const mwMin = h('input.input', { type: 'number', step: '0.1', value: s.mw_min });
  const mwMax = h('input.input', { type: 'number', step: '0.1', value: s.mw_max });
  const ce = h('input.input', { type: 'number', min: 0, max: 500, value: s.ce_limit });
  const m = modal({
    title: 'Impostazioni del radar energia',
    body: h('div.en-form',
      h('label.en-check', web, 'Ricerca web ogni notte (cessioni e aste FER)'),
      field('Spesa massima al mese (€)', quota, `Spesi questo mese: ${num(spent, 2)} €`),
      field('Regioni preferite', regions, 'Separate da virgola: valgono per il punteggio «Zona»'),
      h('div.en-row2', field('MW da', mwMin), field('MW a', mwMax)),
      field('Proprietari dal Database CE per giro', ce)),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await put('/api/energy/radar/impostazioni', { web: web.checked, quota_eur: quota.value, regions: regions.value.split(',').map(x => x.trim()).filter(Boolean),
          mw_min: mwMin.value, mw_max: mwMax.value, ce_limit: ce.value });
        m.close(); toast('Impostazioni salvate'); onDone();
      } } }, 'Salva')],
  });
}
