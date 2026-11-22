// Opere finanziate da OpenCUP (ALM2-49, canvas CRM v14 · V14-OpenCUP, via di Dante 22/11/2026).
//   cupSection(ctx) → la sezione «Opere finanziate» del Mercato: fascia scura con tre numeri, filtri (senza gara / con gara /
//                     tutte, anno della decisione, provincia), tabella con ente titolare, costo, finanziamento e stato della gara
// Usa gli stili della sezione «Gare europee» (crm-ted.css) più crm-cup.css.
import { h, fill, toast, loading, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { icon } from './icons.js';

const ic = (n, s = 16) => icon(n, { size: s });
const num = n => Number(n || 0).toLocaleString('it-IT');
const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'.(-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Srl|Spa|Snc|Sas|Scarl|Scrl)\b/g, x => x[0] + x.slice(1));
const ownerName = s => nice(String(s || '').replace(/\s+-\s+[^-]{1,40}-\s*$/, '')); // «COMUNE DI VASTO - CH -» → «Comune Di Vasto»
const sentence = s => { const t = String(s || '').trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const money = n => (!n ? '—' : n >= 1e9 ? `${(n / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 })} mld €` : n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : `${Math.round(n / 1000).toLocaleString('it-IT')} mila €`);
const ROLE = { partner: ['partner', 'gr'], fornitore: ['fornitore', 'gr'], cliente: ['cliente', 'gr'], lead: ['lead', 'bl'], concorrente: ['concorrente', 'or'] };
const roleOf = s => ['cliente', 'lead', 'partner', 'fornitore', 'concorrente'].find(r => s.roles?.includes(r)) || '';

// «Segnala al radar»: un segnale «opera finanziata» con ente, costo e CUP (bu: nella BU scelta, se c'è)
export async function sendToRadar(r, { soa = [], bu = null, btn = null, done = null } = {}) {
  if (r.signal_id) { location.hash = '#/crm/radar'; return; }
  if (btn) btn.disabled = true;
  try {
    const s = await post('/api/crm/radar/signals', { kind: 'opera_finanziata', stage: 'finanziata', ...(bu ? { bu } : {}), title: sentence(r.title).slice(0, 500), entity: ownerName(r.owner), amount: r.cost ? Math.round(r.cost) : null,
      url: r.url, region: r.region, soa, summary: `Opera finanziata (CUP ${r.cup}), decisa nel ${r.year}. ${r.comune ? `Comune: ${r.comune}. ` : ''}Finanziamento: ${r.coverage || 'non indicato'}. Fonte: OpenCUP.` });
    if (s?.id) { await post(`/api/crm/cup/${encodeURIComponent(r.cup)}/segnale`, { signal_id: s.id }); toast('Segnalata al radar: la trovi in Prima del bando, colonna «Finanziata»'); done?.(); }
    else toast('Era già nel radar');
  } catch (err) { toast(err.message); if (btn) btn.disabled = false; }
}

// La tabella delle opere (Mercato di Nuovi business e Concorrenza e gare → Opere finanziate)
export function worksTable(rows, { canEdit = false, openCompany, signal }) {
  return h('div.te-wrap', h('table.te-t.no-cards', h('thead', h('tr', h('th', 'Opera'), h('th', { style: { width: '240px' } }, 'Ente titolare'), h('th', { style: { width: '130px' } }, 'Costo · anno'),
    h('th', { style: { width: '140px' } }, 'Finanziamento'), h('th', { style: { width: '190px' } }, 'Gara'), h('th', { style: { width: '220px' } }, ''))),
  h('tbody', rows.map(r => {
    const role = r.subject ? roleOf(r.subject) : '';
    const w = r.award?.winners?.[0];
    return h('tr',
      h('td', h('b.te-title', { title: r.title }, sentence(r.title)), h('div', r.type_label ? h('span.te-cpv', r.type_label) : null),
        h('small', [r.comune ? `${r.comune}${r.province ? ` (${r.province})` : ''}${r.places > 1 ? ` e altri ${r.places - 1} comuni` : ''}` : r.places > 1 ? `${r.places} comuni` : `tutta la regione (${r.region})`, `CUP ${r.cup}`].join(' · '))),
      h('td', h('b', ownerName(r.owner)), h('small', r.subject ? h('span.te-pill', { class: ROLE[role]?.[1] || 'gr' }, ROLE[role]?.[0] || 'nel CRM') : h('span.te-pill.bl', 'non nel CRM'))),
      h('td', h('b', money(r.cost)), h('small', r.year ? `decisa nel ${r.year}` : '')),
      h('td', h('b', r.coverage || '—'), r.program ? h('small', r.program) : null),
      h('td', r.award
        ? [h('span.cu-gara.si', h('i'), w ? `aggiudicata a ${nice(w.name)}` : 'aggiudicata'), h('small', [r.award.awarded_on ? fmtDate(r.award.awarded_on, { year: true }) : '', r.award.discount ? `ribasso ${Number(r.award.discount).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%` : ''].filter(Boolean).join(' · '))]
        : h('span.cu-gara.no', h('i'), 'ancora senza gara')),
      h('td.te-act',
        r.award && w?.cf ? h('button.nb-btn', { type: 'button', on: { click: () => openCompany?.({ cf: w.cf, name: w.name }) } }, 'Scheda impresa')
          : r.signal_id ? h('a.cu-sent', { href: '#/crm/radar' }, ic('check', 13), 'Segnalata')
            : canEdit && !r.award ? h('button.nb-btn.pri', { type: 'button', on: { click: e => signal(r, e.currentTarget) } }, ic('radar', 14), 'Segnala al radar') : null,
        h('a.nb-btn', { href: r.url, target: '_blank', rel: 'noopener' }, 'OpenCUP')));
  }))));
}
export { money as cupMoney, num as cupNum };

export function cupSection({ id, cats, canEdit = false, openCompany }) {
  const el = h('section.te.cu', loading());
  const f = { view: 'senza', since: null, province: '', limit: 10 };
  async function load() {
    const qs = new URLSearchParams({ vista: f.view, limit: f.limit, ...(f.since ? { dal: f.since } : {}), ...(f.province ? { province: f.province } : {}), ...(cats ? { cats: cats.join(',') } : {}) });
    let d;
    try { d = await get(`/api/crm/business/${id}/mercato/opere?${qs}`, { quiet: true }); } catch (err) { fill(el, h('p.nb-small.muted', err.message)); return; }
    draw(d);
  }
  const setF = patch => { Object.assign(f, patch); load(); };

  const signal = (r, d, btn) => sendToRadar(r, { soa: d.categories, btn, done: load });

  function draw(d) {
    if (!d.source.updated_at) {
      return fill(el, h('div.te-empty', h('span.te-empty-i', ic('calendar', 22)), h('div',
        h('b', d.source.running ? 'Sto caricando le opere finanziate da OpenCUP' : 'Le opere finanziate arrivano presto'),
        h('p', d.source.running ? 'OpenCUP pubblica file molto grandi: ci vuole una decina di minuti, la sezione si riempie da sola.' : 'Le carico da OpenCUP una volta al mese; la prima volta poco dopo la pubblicazione.')),
        d.admin && !d.source.running ? h('button.nb-btn', { type: 'button', on: { click: async () => { await post('/api/crm/cup/aggiorna', {}); toast('Caricamento partito: ci vuole una decina di minuti'); setTimeout(load, 5000); } } }, 'Carica adesso') : null));
    }
    if (!d.types.length) {
      return fill(el, h('div.te-empty', h('span.te-empty-i', ic('calendar', 22)), h('div', h('b', 'Opere finanziate: nessun tipo di lavoro CUP per queste categorie'),
        h('p', `Il CUP non usa le categorie SOA. Per ${d.missing.join(', ') || 'queste categorie'} aggiungi i tipi di lavoro in Impostazioni del CRM → Concorrenza.`))));
    }
    f.since = d.since;
    const k = d.kpi;
    const where = d.regions.length ? d.regions.join(', ') : 'tutta Italia';
    const bigN = (n, label, v, hot = false) => h('button.te-n', { type: 'button', class: [hot ? 'hot' : '', f.view === v ? 'sel' : ''].join(' '), 'aria-pressed': String(f.view === v), on: { click: () => setF({ view: v, limit: 10 }) } }, h('b', n), h('span', label));
    const head = h('div.te-h',
      h('div.te-ttl', h('div.te-eb', ic('calendar', 14), 'OpenCUP · opere pubbliche finanziate'),
        h('h3', 'Opere ', h('b', 'finanziate'), ', prima del bando'),
        h('p', `Lavori pubblici decisi e finanziati in ${where} per ${d.categories.join(' e ')}${d.type_labels.length ? ` (${d.type_labels.slice(0, 4).join(', ')}${d.type_labels.length > 4 ? '…' : ''})` : ''}. Quelli ancora senza gara aggiudicata sono le gare dei prossimi mesi.`)),
      h('div.te-k',
        bigN(num(k.without), ['opere ancora senza gara', h('br'), 'da preparare adesso'], 'senza', true),
        bigN(money(k.cost), ['finanziati', h('br'), `decise dal ${d.since}`], 'tutte'),
        h('div.te-n.static', h('b', num(k.owners_in_crm)), h('span', ['enti titolari', h('br'), 'già nel nostro CRM']))));
    const seg = items => h('div.te-seg', { role: 'group' }, items.map(([label, on, click, badge]) => h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), on: { click } }, label, badge !== undefined ? h('em', num(badge)) : null)));
    const select = (label, value, options, onChange) => h('label.cu-sel', h('span.sr-only', label),
      h('select', { 'aria-label': label, on: { change: e => onChange(e.target.value) } }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))), ic('chevron-down', 14));
    const bar = h('div.te-bar',
      seg([['Senza gara', f.view === 'senza', () => setF({ view: 'senza', limit: 10 }), k.without], ['Con gara aggiudicata', f.view === 'con', () => setF({ view: 'con', limit: 10 }), k.with], ['Tutte', f.view === 'tutte', () => setF({ view: 'tutte', limit: 10 })]]),
      select('Anno della decisione', d.since, d.years.map(y => [y, `Decise dal ${y}`]), v => setF({ since: Number(v), limit: 10 })),
      d.provinces.length > 1 ? select('Provincia', f.province, [['', 'Provincia: tutte'], ...d.provinces.map(p => [p, `Provincia: ${p}`])], v => setF({ province: v, limit: 10 })) : null,
      h('span.te-src', h('span.te-dot'), `OpenCUP · aggiornata il ${fmtDate(d.source.updated_at.slice(0, 10))} · ${num(d.types.length)} tipi di lavoro`));

    const table = d.rows.length ? worksTable(d.rows, { canEdit, openCompany, signal: (r, btn) => signal(r, d, btn) })
      : h('p.te-none', f.view === 'senza' ? `Nessuna opera finanziata ancora senza gara in ${where} per questi tipi di lavoro.` : 'Nessuna opera con questi filtri.');
    const more = d.shown > d.rows.length ? h('button.te-more', { type: 'button', on: { click: () => setF({ limit: 100 }) } }, `Mostro le prime ${d.rows.length} per costo · `, h('b', `Vedi tutte le ${num(d.shown)}`)) : null;
    fill(el, h('div.te-card', head, bar, table, more));
  }
  load();
  return el;
}
