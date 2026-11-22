// «Concorrenza e gare» · Opere finanziate (canvas v16, approvato da Dante il 22/11/2026).
// Le opere pubbliche finanziate di OpenCUP per BU: una scheda per BU con le opere ancora senza gara nel suo perimetro
// (tipi di lavoro delle categorie SOA, regioni e importi del profilo), poi filtri e la tabella del Mercato con
// «Segnala al radar» nella BU scelta (colonna «Finanziata» di Prima del bando).
import { h, fill, toast, loading, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { ic, emptyState } from './crm-v2.js';
import { openImpresaMercato } from './crm-impresa-mercato.js';
import { worksTable, sendToRadar, cupMoney as money, cupNum as num } from './crm-cup.js';

const range = (a, b) => (a && b ? `da ${money(a)} a ${money(b)}` : a ? `da ${money(a)} in su` : b ? `fino a ${money(b)}` : 'ogni importo');

export async function opereSection(box, { st, buLabel, tabs, again }) {
  fill(box, loading());
  const f = st.opere || (st.opere = { bu: '', view: 'senza', all: false, since: null, province: '', limit: 25 });
  const qs = new URLSearchParams({ vista: f.view, limit: f.limit, ...(f.bu ? { bu: f.bu } : {}), ...(f.all ? { tutta: '1' } : {}), ...(f.since ? { dal: f.since } : {}), ...(f.province ? { province: f.province } : {}) });
  let d, cards;
  try {
    [d, cards] = await Promise.all([get(`/api/crm/concorrenza/opere?${qs}`), get(`/api/crm/concorrenza/opere/bu${f.since ? `?dal=${f.since}` : ''}`)]);
  } catch (err) { fill(box, h('div.cg', tabs, h('section.pv-card', emptyState('calendar', err.message)))); return; }
  f.bu = d.bu; f.since = d.since;
  const set = patch => { Object.assign(f, patch); again(); };
  const sc = d.scope;

  const hero = h('section.cg-hero',
    h('div.cg-top', h('div.cv-grow',
      h('div.cg-kicker', ic('calendar', 12), d.source.updated_at ? `OpenCUP · opere pubbliche finanziate · aggiornate al ${fmtDate(d.source.updated_at.slice(0, 10))} · ${num(d.source.works)} opere` : 'OpenCUP · opere finanziate non ancora caricate'),
      h('h1.cg-h1', 'Opere finanziate'),
      h('p.cg-sub', 'I lavori pubblici già decisi e finanziati nei tipi di lavoro e nelle zone di ogni BU. Quelli ancora senza gara sono le gare dei prossimi mesi: segnalali al radar e contatta l\'ente prima del bando.')),
    d.admin && !d.source.running ? h('button.cg-ghost', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/cup/aggiorna', {}); toast('Caricamento da OpenCUP avviato: ci vuole un quarto d\'ora'); } } }, ic('refresh-cw', 13), 'Carica da OpenCUP') : null));

  if (!d.source.updated_at) {
    return fill(box, h('div.cg', hero, tabs, h('section.pv-card', emptyState('calendar', d.source.running ? 'Sto caricando le opere da OpenCUP: ci vuole un quarto d\'ora, poi la sezione si riempie.' : 'Le opere finanziate si caricano da OpenCUP una volta al mese; la prima volta poco dopo la pubblicazione.'))));
  }

  // una scheda per BU
  const buCards = h('div.ob-bus', cards.cards.map(c => h('button.ob-bu', { type: 'button', class: c.bu === f.bu ? 'on' : '', 'aria-pressed': String(c.bu === f.bu), on: { click: () => set({ bu: c.bu, province: '', limit: 25 }) } },
    h('span.ob-t', buLabel(c.bu)), h('b', num(c.without)), h('small', c.no_types ? 'nessun tipo di lavoro CUP' : `opere senza gara · ${money(c.cost)}`),
    h('small.ob-s', [c.cats.join(' · '), c.regions.length ? c.regions.join(', ') : 'tutta Italia'].filter(Boolean).join(' · ')))));

  const seg = items => h('div.te-seg', { role: 'group' }, items.map(([label, on, click, badge]) => h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), on: { click } }, label, badge !== undefined ? h('em', num(badge)) : null)));
  const select = (label, value, options, onChange) => h('label.cu-sel', h('span.sr-only', label),
    h('select', { 'aria-label': label, on: { change: e => onChange(e.target.value) } }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))), ic('chevron-down', 14));
  const k = d.kpi;
  const bar = h('div.te-bar',
    seg([['Senza gara', f.view === 'senza', () => set({ view: 'senza', limit: 25 }), k.without], ['Con gara aggiudicata', f.view === 'con', () => set({ view: 'con', limit: 25 }), k.with], ['Tutte', f.view === 'tutte', () => set({ view: 'tutte', limit: 25 })]]),
    d.bus.length > 1 ? select('BU', f.bu, d.bus.map(b => [b, `BU: ${buLabel(b)}`]), v => set({ bu: v, province: '', limit: 25 })) : null,
    sc.profile_regions.length ? h('button.ob-chip', { type: 'button', title: 'Zone del profilo BU: tocca per tutta Italia', on: { click: () => set({ all: !f.all, province: '', limit: 25 }) } }, ic('map-pin', 12), f.all ? 'tutta Italia · tocca per le zone della BU' : `${sc.profile_regions.join(', ')} · tocca per tutta Italia`)
      : h('span.ob-chip', ic('map-pin', 12), 'tutta Italia (il profilo della BU non ha zone)'),
    h('span.ob-chip', range(sc.amount_min, sc.amount_max)),
    select('Anno della decisione', d.since, d.years.map(y => [y, `Decise dal ${y}`]), v => set({ since: Number(v), limit: 25 })),
    d.provinces.length > 1 ? select('Provincia', f.province, [['', 'Provincia: tutte'], ...d.provinces.map(p => [p, `Provincia: ${p}`])], v => set({ province: v, limit: 25 })) : null);

  const openCompany = w => openImpresaMercato(w.cf ? { cf: w.cf } : { name: w.name }, { cats: sc.categories, regions: sc.regions, months: 24 }).catch(err => toast(err.message || 'Scheda non disponibile', 'error'));
  const where = sc.regions.length ? sc.regions.join(', ') : 'tutta Italia';
  const table = !d.types.length ? h('p.te-none', 'Questa BU non ha categorie SOA con tipi di lavoro CUP: aggiungili in Impostazioni del CRM → Concorrenza.')
    : d.rows.length ? worksTable(d.rows, { canEdit: true, openCompany, signal: (r, btn) => sendToRadar(r, { soa: sc.categories, bu: f.bu, btn, done: again }) })
      : h('p.te-none', f.view === 'senza' ? `Nessuna opera finanziata ancora senza gara per ${buLabel(f.bu)} in ${where}.` : 'Nessuna opera con questi filtri.');
  const more = d.shown > d.rows.length ? h('button.te-more', { type: 'button', on: { click: () => set({ limit: 200 }) } }, `Mostro le prime ${d.rows.length} per costo · `, h('b', `Vedi tutte le ${num(d.shown)}`)) : null;

  fill(box, h('div.cg', hero, tabs, buCards, h('section.te.cu.ob', h('div.te-card', bar, table, more))));
}
