// Alma Energy · Clienti e contatti (ALM2-83, tavola «A · CRM centrale filtrato» approvata da Dante il 24/11/2026).
// È il CRM centrale visto da Energy: sei tessere, ognuna un filtro sulle stesse schede del CRM centrale; sotto,
// l'elenco della tessera scelta. Le aziende di Energy si aprono nella loro scheda (con i dati dell'energia), il resto
// nella scheda del CRM centrale.
import { h, fill, loading, debounce } from './ui.js';
import { get, qs } from './api.js';
import { icon } from './icons.js';
import { num, ensureMeta } from './energy.js';

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
