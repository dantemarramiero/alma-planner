// Alma Energy · Clienti e contatti (ALM2-83, tavola «A · CRM centrale filtrato» approvata da Dante il 24/11/2026).
// È il CRM centrale visto da Energy: sei tessere, ognuna un filtro sulle stesse schede del CRM centrale; sotto,
// l'elenco della tessera scelta. Le aziende di Energy si aprono nella loro scheda (con i dati dell'energia), il resto
// nella scheda del CRM centrale.
import { h, fill, loading, debounce, toast, fmtDate } from './ui.js';
import { get, post, qs } from './api.js';
import { icon } from './icons.js';
import { num, ensureMeta } from './energy.js';
import { progettistiView } from './crm-progettisti.js';

const TILE_STYLE = {
  proprietari: ['sun', '#E9F1FB', '#23598A'], sviluppatori: ['building', '#E7F5EC', '#1F6A40'], fondi: ['trending-up', '#FFF1E5', '#B35300'],
  energivori: ['zap', '#FDF3DC', '#8A5A00'], progettisti: ['pencil', '#F3ECFA', '#6A3E99'], altri: ['users', '#F1EFEB', '#515151'],
};
const STAGE = { da_contattare: 'Da contattare', contattato: 'Contattato', incontro: 'Incontro', opportunita: 'Opportunità', non_interessato: 'Non interessato' };
const RELATION = { da_contattare: 'Da contattare', in_contatto: 'In contatto', attivo: 'Attivo', non_interessato: 'Non interessato' };
const initials = s => String(s || '?').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const AV_COLORS = ['#FF8A26', '#2F6FA3', '#2E7D4F', '#6A3E99', '#C98A00', '#515151'];
const avColor = s => AV_COLORS[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];

export async function clientiView(box, params) {
  await ensureMeta();
  const state = { filtro: params?.get('f') || 'proprietari', q: '' };
  const tiles = h('section.en-cl-tiles', { 'aria-label': 'Filtri' }, loading());
  const list = h('section.card.sw-card.en-cl-list', loading());
  fill(box,
    h('p.muted.en-lead', 'È il CRM centrale, visto da Alma Energy: quello che scrivi qui lo vedono tutte le BU, e viceversa. Ogni tessera è un filtro.'),
    h('div.toolbar.en-sel-toolbar', h('span.grow'),
      h('a.btn', { href: '#/crm' }, 'Apri nel CRM centrale'),
      h('a.btn.btn-primary', { href: '#/energy/aziende' }, icon('plus', { size: 15 }), 'Nuova azienda')),
    tiles, list);

  async function loadTiles() {
    const { tiles: t } = await get('/api/energy/crm/tessere');
    fill(tiles, t.map(x => {
      const [ic, bg, fg] = TILE_STYLE[x.key];
      return h('button.en-cl-tile', { type: 'button', class: x.key === state.filtro ? 'on' : '', 'aria-pressed': String(x.key === state.filtro), on: { click: () => {
        state.filtro = x.key; history.replaceState(null, '', `#/energy/clienti?f=${x.key}`); loadTiles(); loadList();
      } } },
      h('div.en-cl-top', h('span.en-cl-ico', { style: { background: bg, color: fg } }, icon(ic, { size: 20 })), h('strong', num(x.count))),
      h('b', x.label), h('span.muted', x.todo || x.hint));
    }));
  }

  const search = h('input.input', { type: 'search', placeholder: 'Nome, P.IVA, città…', 'aria-label': 'Cerca', on: { input: debounce(e => { state.q = e.target.value; loadList(); }) } });
  async function loadList() {
    // tavole B e C (ALM2-83 tappa 2): fondi che cercano un EPC, energivori da chiamare, progettisti della vista CRM
    if (state.filtro === 'fondi') return fondiView(list, () => { loadTiles(); loadList(); });
    if (state.filtro === 'energivori') return energivoriView(list, () => { loadTiles(); loadList(); });
    if (state.filtro === 'progettisti') { list.classList.remove('card', 'sw-card'); return progettistiView(list, { bu: 'energy' }); }
    list.classList.add('card', 'sw-card');
    const d = await get(`/api/energy/crm/elenco${qs({ filtro: state.filtro, q: state.q })}`);
    const extra = state.filtro === 'progettisti'
      ? h('a.btn.btn-sm', { href: '#/crm/concorrenza/progettisti?bu=energy' }, 'Chi vince le gare nel settore')
      : state.filtro === 'energivori' ? h('a.btn.btn-sm', { href: '#/impianti/energivori' }, 'Carica o aggiorna l\'elenco') : null;
    fill(list,
      h('div.en-cl-head', h('h2', d.label), extra, search),
      d.rows.length ? d.rows.map(r => row(r)) : h('p.muted', state.q ? 'Nessuno con questa ricerca.' : 'Nessuno ancora in questo filtro.'));
    search.focus({ preventScroll: true });
  }

  function row(r) {
    const href = r.energy_id ? `#/energy/aziende/${r.energy_id}` : r.subject_id ? `#/crm/scheda/${r.subject_id}` : null;
    const sub = state.filtro === 'fondi'
      ? [r.city, r.techs?.join(', '),r.ticket_min || r.ticket_max ? `${num((r.ticket_min || 0) / 1e6, 1)}–${num((r.ticket_max || 0) / 1e6, 1)} M€` : null, r.mandate_regions?.join(', ') || (r.techs ? 'Tutta Italia' : null), r.seeks_epc ? 'cerca un EPC' : null]
      : state.filtro === 'energivori' ? [r.city, r.sector, r.consumption_gwh ? `${num(r.consumption_gwh, 1)} GWh` : null, r.roof_m2 ? `${num(r.roof_m2)} m² di tetto` : null]
        : [r.city || r.region, r.last_opportunity, r.opportunities > 1 ? `${r.opportunities} opportunità` : null];
    const status = r.relation ? RELATION[r.relation] : r.lead_stage ? STAGE[r.lead_stage] : state.filtro === 'energivori' && !r.subject_id ? 'Non nel CRM' : '';
    const other = (r.asa || []).filter(a => a !== 'energy');
    return h(href ? 'a.en-cl-row' : 'div.en-cl-row', href ? { href } : {},
      h('span.en-cl-av', { style: { background: avColor(r.name) } }, initials(r.name)),
      h('div.en-cl-main', h('b', r.name), h('span.muted', sub.filter(Boolean).join(' · ') || '—')),
      other.length ? h('span.pill.en-cl-bu', `anche ${other.join(', ')}`) : null,
      status ? h('span.pill', { class: status === 'In contatto' || status === 'Contattato' ? 'en-cl-in' : status === 'Attivo' || status === 'Opportunità' ? 'en-cl-ok' : '' }, status) : null);
  }

  await Promise.all([loadTiles(), loadList()]);
}

// ── B · Fondi: chi cerca un EPC adesso ─────────────────────────────────────────────────────────────────────
const eurShort = n => (!n ? '—' : n >= 1e9 ? `${num(n / 1e9, 1)} mld€` : n >= 1e6 ? `${num(n / 1e6, 1)} M€` : `${num(n / 1e3)} k€`);
const kpi = (label, value, hi) => h('div.en-cl-kpi', { class: hi ? 'hi' : '' }, h('span', label), h('strong', value));
const techPills = list => (list || []).map(t => h('span.pill.en-cl-tag', t));
const pctBox = m => (m && m.pct ? h('div.en-cl-match', { class: m.pct >= 80 ? 'hi' : m.pct >= 60 ? 'ok' : '' },
  h('span.en-cl-pct', `${m.pct}%`), h('span', 'combacia con ', h('a', { href: `#/energy/opportunita/${m.project_id}/iter` }, m.project_title)))
  : h('div.en-cl-match', h('span.muted', 'Nessun nostro progetto con il mandato giusto, per ora.')));

async function fondiView(box, reload) {
  fill(box, loading());
  box.classList.remove('card', 'sw-card');
  const d = await get('/api/energy/crm/fondi');
  const n = d.kpi.da_chiamare;
  // in alto: prima le notizie nuove, poi i fondi del CRM che cercano un EPC e non abbiamo ancora contattato
  const cards = [
    ...d.nuovi.map(x => ({ kind: 'nuovo', x })),
    ...d.fondi.filter(f => f.seeks_epc && f.lead_stage === 'da_contattare').map(x => ({ kind: 'crm', x })),
  ].slice(0, 3);
  const newsCard = x => h('article.card.sw-card.en-cl-card',
    h('div.en-cl-who', h('span.en-cl-av.lg', { style: { background: avColor(x.entity || x.title) } }, initials(x.entity || x.title)),
      h('div', h('b', x.entity || 'Fondo da identificare'), h('span.muted', `notizia del ${fmtDate(String(x.published_on || x.created_at).slice(0, 10))}`))),
    h('p', x.title), pctBox(x.match), h('div.en-cl-tags', techPills(x.techs), techPills(x.regions)),
    h('div.en-sel-actions',
      x.url ? h('a.btn.btn-sm', { href: x.url, target: '_blank', rel: 'noopener' }, 'Fonte') : null,
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => {
        await post(`/api/energy/crm/fondi/segnali/${x.id}/aggiungi`); toast('Fondo aggiunto al CRM centrale'); reload();
      } } }, 'Aggiungi al CRM')));
  const crmCard = x => h('article.card.sw-card.en-cl-card',
    h('div.en-cl-who', h('span.en-cl-av.lg', { style: { background: avColor(x.name) } }, initials(x.name)),
      h('div', h('b', x.name), h('span.muted', [x.city, 'nel CRM · cerca un EPC'].filter(Boolean).join(' · ')))),
    pctBox(x.match), h('div.en-cl-tags', techPills(x.techs), x.ticket_max ? h('span.pill.en-cl-tag', `${eurShort(x.ticket_min)}–${eurShort(x.ticket_max)}`) : null, techPills(x.regions)),
    h('div.en-sel-actions', h('a.btn.btn-sm', { href: `#/crm/scheda/${x.subject_id}` }, 'Scheda'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => {
        await post(`/api/energy/crm/fondi/${x.subject_id}/proponi`, { project: x.match?.pct >= 60 ? x.match.project_title : '' });
        toast('Passato a «contattato», con il prossimo passo nella scheda'); reload();
      } } }, 'Proponi Almacis come EPC')));
  fill(box,
    h('div.en-cl-hero', h('h2', h('b', n === 1 ? '1 fondo' : `${num(n)} fondi`), ' cercano un EPC adesso'),
      h('p.muted', 'Alma li trova nelle notizie (ogni notte, nel radar energia) e li confronta con i nostri progetti. Sono gli stessi fondi del CRM centrale e di Alma Impianti.')),
    h('div.en-cl-kpis', kpi('Da chiamare', num(n), true), kpi('Fondi nel CRM', num(d.kpi.fondi)), kpi('In contatto', num(d.kpi.in_contatto)), kpi('Capitale da investire', eurShort(d.kpi.capitale))),
    cards.length ? h('div.en-cl-cards', cards.map(({ kind, x }) => (kind === 'nuovo' ? newsCard(x) : crmCard(x))))
      : h('div.card.empty', 'Nessun fondo nuovo da chiamare: il radar energia ne cerca ogni notte.'),
    h('section.card.sw-card', h('h2', 'Tutti i fondi'),
      d.fondi.length ? d.fondi.map(f => h('a.en-cl-row', { href: `#/crm/scheda/${f.subject_id}` },
        h('span.en-cl-av', { style: { background: avColor(f.name) } }, initials(f.name)),
        h('div.en-cl-main', h('b', f.name), h('span.muted', [f.techs.join(', '), f.ticket_max ? `${eurShort(f.ticket_min)}–${eurShort(f.ticket_max)}` : null,
          f.regions.join(', ') || null, f.bus.length ? `segue ${f.bus.join(', ')}` : null].filter(Boolean).join(' · ') || f.city || '—')),
        f.match?.pct >= 60 ? h('span.pill.en-cl-ok', `${f.match.pct}% con ${f.match.project_title}`) : null,
        h('span.pill', { class: ['contattato', 'incontro', 'opportunita'].includes(f.lead_stage) ? 'en-cl-in' : '' }, STAGE[f.lead_stage] || '—')))
        : h('p.muted', 'Nessun fondo nel CRM centrale.')));
}

// ── B · Energivori: chi chiamare questa settimana ──────────────────────────────────────────────────────────
async function energivoriView(box, reload) {
  fill(box, loading());
  box.classList.remove('card', 'sw-card');
  const d = await get('/api/energy/crm/energivori');
  const act = (e, path, msg) => async () => {
    const r = await post(`/api/energy/crm/energivori/${e.id}/${path}`);
    toast(msg);
    if (r.analysis_id) location.hash = `#/energy/analisi/${r.analysis_id}`; else reload();
  };
  const card = e => h('article.card.sw-card.en-cl-card',
    h('div.en-cl-who', h('span.en-cl-av.lg', { style: { background: avColor(e.name) } }, initials(e.name)),
      h('div', h('b', e.name), h('span.muted', [e.city, e.sector].filter(Boolean).join(' · ')))),
    h('div.en-cl-facts', h('div', h('span', 'Consumo'), h('b', e.consumption_gwh ? `${num(e.consumption_gwh, 1)} GWh` : '—')),
      h('div', h('span', 'Tetto libero'), h('b', e.roof_m2 ? `${num(e.roof_m2)} m²` : '—'))),
    e.reason ? h('div.en-cl-why', h('b', 'Perché adesso: '), e.reason, e.reason_url ? [' ', h('a', { href: e.reason_url, target: '_blank', rel: 'noopener' }, 'fonte')] : null)
      : h('div.en-cl-why.quiet', 'Tra i primi per consumo e tetto.'),
    h('div.en-cl-saving', h('strong', eurShort(e.saving)), h('span.muted', 'risparmio stimato all\'anno con un PPA sul tetto')),
    h('div.en-sel-actions', h('button.btn.btn-sm', { type: 'button', on: { click: act(e, 'non-ora', 'Rimandato di un mese') } }, 'Non ora'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: act(e, 'approccia', 'Opportunità PPA e bozza di analisi create') } }, 'Approccia')));
  const status = e => (e.snoozed ? 'Più avanti' : e.status === 'in_contatto' ? 'In contatto' : e.status === 'non_interessato' ? 'Non interessato' : 'Da chiamare');
  // energivoro trovato nelle notizie, non ancora nell'elenco: «Approccia» lo aggiunge e apre l'opportunità PPA
  const newsCard = x => h('article.card.sw-card.en-cl-card',
    h('div.en-cl-who', h('span.en-cl-av.lg', { style: { background: avColor(x.entity || x.title) } }, initials(x.entity || x.title)),
      h('div', h('b', x.entity || 'Azienda da identificare'), h('span.muted', [x.place, x.region, `notizia del ${fmtDate(String(x.published_on || x.created_at).slice(0, 10))}`].filter(Boolean).join(' · ')))),
    h('div.en-cl-why', h('b', 'Perché adesso: '), x.title),
    x.why || x.summary ? h('p.muted', x.why || x.summary) : null,
    h('div.en-sel-actions',
      x.url ? h('a.btn.btn-sm', { href: x.url, target: '_blank', rel: 'noopener' }, 'Fonte') : null,
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => {
        const r = await post(`/api/energy/radar/${x.id}/prendi`);
        toast('Opportunità PPA e bozza di analisi create');
        if (r.analysis_id) location.hash = `#/energy/analisi/${r.analysis_id}`; else reload();
      } } }, 'Approccia')));
  const cards = [...d.top.map(card), ...(d.nuovi || []).map(newsCard)].slice(0, 6);
  fill(box,
    h('div.en-cl-hero', h('h2', 'Chi chiamare ', h('b', 'questa settimana')),
      h('p.muted', 'Aziende che consumano molta energia e che possiamo efficientare. Alma mette in alto chi ha un motivo per essere chiamato adesso.')),
    h('div.en-cl-kpis', kpi('Da chiamare adesso', num(d.kpi.da_chiamare), true), kpi('Energivori nel CRM', num(d.kpi.totale)),
      kpi('In contatto', num(d.kpi.in_contatto)), kpi('Risparmio possibile', `${eurShort(d.kpi.risparmio)}/anno`)),
    cards.length ? h('div.en-cl-cards', cards)
      : h('div.card.empty', d.kpi.totale ? 'Nessuno da chiamare adesso: chi c\'è è già in contatto o rimandato.'
        : 'Ancora nessun energivoro: il radar energia li cerca ogni giorno nelle notizie, e l\'elenco completo si carica da Alma Impianti → Energivori.'),
    h('section.card.sw-card', h('div.en-cl-head', h('h2', 'Tutti gli energivori'), h('a.btn.btn-sm', { href: '#/impianti/energivori' }, 'Carica o aggiorna l\'elenco')),
      d.elenco.length ? d.elenco.map(e => h(e.subject_id ? 'a.en-cl-row' : 'div.en-cl-row', e.subject_id ? { href: `#/crm/scheda/${e.subject_id}` } : {},
        h('span.en-cl-av', { style: { background: avColor(e.name) } }, initials(e.name)),
        h('div.en-cl-main', h('b', e.name), h('span.muted', [e.city, e.sector, e.consumption_gwh ? `${num(e.consumption_gwh, 1)} GWh` : null, e.roof_m2 ? `${num(e.roof_m2)} m²` : null].filter(Boolean).join(' · '))),
        h('span.en-cl-score', String(e.score)),
        h('span.pill', { class: e.status === 'in_contatto' ? 'en-cl-in' : e.snoozed ? '' : 'en-cl-todo' }, status(e))))
        : h('p.muted', 'Nessun energivoro.')));
}
