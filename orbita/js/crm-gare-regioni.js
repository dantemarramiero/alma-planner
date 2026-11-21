// «Concorrenza e gare» · Regioni e Partner (canvas v12, approvato da Dante il 21/11/2026).
// Regioni: per una BU le regioni con «Conviene» da 0 a 100 (volume, ribasso sotto la media, concorrenza, vicinanza),
// mappa a tessere, tabella e a destra la regione scelta (perché conviene, ribasso per fascia, enti, chi vince).
// Partner: mappa regione × BU con il partner migliore e sotto i partner da contattare della casella scelta.
import { h, fill, toast, loading } from './ui.js';
import { get, post } from './api.js';
import { ic, dots, pill, emptyState } from './crm-v2.js';
import { bandBar, nice, crmCell } from './crm-concorrenza.js';
import { openImpresaMercato } from './crm-impresa-mercato.js';

const it1 = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 }));
const pct = n => (n === null || n === undefined ? '—' : `${it1(n)}%`);
const eur = n => (!n ? '—' : n >= 1e6 ? `${it1(n / 1e6)} M€` : `${Math.round(n / 1e3).toLocaleString('it-IT')} k€`);
const TILES = { 'Valle d\'Aosta': [0, 0, 'VdA'], Piemonte: [1, 0, 'Pie'], Lombardia: [2, 0, 'Lom'], 'Trentino-Alto Adige': [3, 0, 'TAA'], Veneto: [4, 0, 'Ven'], 'Friuli-Venezia Giulia': [5, 0, 'FVG'],
  Liguria: [1, 1, 'Lig'], 'Emilia-Romagna': [3, 1, 'EmR'], Toscana: [2, 2, 'Tos'], Umbria: [3, 2, 'Umb'], Marche: [4, 2, 'Mar'], Lazio: [3, 3, 'Laz'], Abruzzo: [4, 3, 'Abr'],
  Molise: [5, 3, 'Mol'], Campania: [4, 4, 'Cam'], Puglia: [5, 4, 'Pug'], Basilicata: [5, 5, 'Bas'], Calabria: [5, 6, 'Cal'], Sicilia: [4, 7, 'Sic'], Sardegna: [1, 5, 'Sar'] };
const tone = n => (n === null || n === undefined ? '' : n >= 75 ? 'hi' : n >= 55 ? 'mid' : 'lo');
const conv = n => h('span.rg-conv', { class: tone(n), title: n === null ? 'Troppe poche gare per un punteggio' : `Conviene ${n} su 100` }, n === null ? '—' : String(n));

// pillole delle BU e periodo, uguali nelle due sezioni
function buBar(bus, on, buLabel, onBu, st, again, extra = null) {
  const months = h('select.cg-sel', { 'aria-label': 'Periodo' }, [['24', '24 mesi'], ['12', '12 mesi']].map(([v, l]) => h('option', { value: v, selected: String(st.months) === v }, l)));
  months.addEventListener('change', () => { st.months = Number(months.value); again(); });
  return h('div.rg-bus', h('span.rg-lbl', 'BU'),
    bus.map(b => h('button.rg-bu', { type: 'button', class: b === on ? 'on' : '', 'aria-pressed': String(b === on), on: { click: () => onBu(b) } }, buLabel(b))),
    h('span.rg-gap'), months, extra);
}

// ── Regioni ──────────────────────────────────────────────────────────────────────────────────────
export async function regioniSection(box, { st, buLabel, tabs, go, again }) {
  fill(box, loading());
  const r = await get(`/api/crm/concorrenza/regioni?months=${st.months}${st.rbu ? `&bu=${st.rbu}` : ''}`);
  st.rbu = r.scope.bu || r.bus[0] || '';
  const rows = r.regioni;
  if (!st.region || !rows.some(x => x.region === st.region)) st.region = rows[0]?.region || '';
  const byName = new Map(rows.map(x => [x.region, x]));
  const m = r.migliori;
  const kpi = (l, v, s, c) => h('div.cg-kpi', { class: c || '' }, h('span.cg-k', l), h('b', v || '—'), h('small', s || ''));
  const map = h('div.rg-map', { role: 'img', 'aria-label': 'Conviene per regione' }, Object.entries(TILES).map(([name, [c, row, s]]) => {
    const x = byName.get(name);
    return h('button.rg-tile', { type: 'button', class: `${tone(x?.conviene)}${name === st.region ? ' sel' : ''}`, style: { gridColumn: String(c + 1), gridRow: String(row + 1) },
      title: x ? `${name}: ${x.conviene === null ? 'poche gare' : `conviene ${x.conviene}`} · ${x.gare} gare` : `${name}: nessuna gara`, disabled: !x || undefined,
      on: { click: () => { st.region = name; again(); } } }, s);
  }));
  const hero = h('section.cg-hero.rg-hero',
    h('div.rg-hero-l',
      h('div.cg-kicker', ic('map-pin', 12), `Regioni · BU ${buLabel(st.rbu)} · ultimi ${r.scope.months} mesi · ${r.italia.gare.toLocaleString('it-IT')} gare`),
      h('h1.cg-h1', 'Dove conviene concentrarsi'),
      h('p.cg-sub', 'Le regioni con più lavori nelle nostre categorie, ribassi più bassi e meno concorrenza.'),
      h('div.cg-kpis.rg-kpis',
        kpi('Regione migliore', m.conviene?.region, m.conviene ? `${m.conviene.conviene} su 100 · ribasso ${pct(m.conviene.ribasso)}` : 'servono più gare'),
        kpi('Ribasso più basso', m.ribasso?.region, m.ribasso ? `${pct(m.ribasso.ribasso)} contro ${pct(r.italia.ribasso)} in Italia` : '', 'gr'),
        kpi('Meno concorrenza', m.concorrenza?.region, m.concorrenza ? `${it1(m.concorrenza.offerenti)} offerenti a gara` : ''))),
    h('div.rg-hero-r', h('span.cg-k', '«Conviene» per regione'), map));
  const bar = buBar(r.bus, st.rbu, buLabel, b => { st.rbu = b; st.region = ''; again(); }, st, again,
    r.scope.categories.length || r.scope.cpv.length ? h('span.cg-chip', [...r.scope.categories, ...r.scope.cpv.map(c => `CPV ${c}…`)].slice(0, 6).join(' · ')) : null);

  let body;
  if (!rows.length) body = h('section.pv-card', emptyState('map-pin', 'Nessuna gara aggiudicata per questa BU: controlla le categorie del profilo BU o aspetta il caricamento dei dati ANAC.'));
  else {
    const shown = st.allRegions ? rows : rows.slice(0, 10);
    const head = h('div.rg-head', ['Regione', 'Gare · valore', 'Ribasso tipico', 'Offerenti', 'Primi 3', 'Noi', 'Conviene'].map(t => h('span', t)));
    const list = shown.map(x => {
      const d = x.ribasso !== null && r.italia.ribasso !== null ? r.italia.ribasso - x.ribasso : 0;
      const ribTone = d >= 1 ? 'gr' : d <= -1 ? 'rd' : '';
      return h('div.rg-row', { class: x.region === st.region ? 'sel' : '', role: 'button', tabIndex: 0,
        on: { click: () => { st.region = x.region; again(); }, keydown: e => { if (e.key === 'Enter') { st.region = x.region; again(); } } } },
        h('b.rg-reg', x.region),
        h('div.rg-two', h('b', `${x.gare} ${x.gare === 1 ? 'gara' : 'gare'}`), h('small', eur(x.valore))),
        h('div.rg-rib', { class: ribTone }, h('b', pct(x.ribasso)), h('i', h('span', { style: { width: `${Math.min(100, (Number(x.ribasso) || 0) * 3)}%` } }))),
        h('span', it1(x.offerenti)),
        h('span.rg-muted', x.top3 === null ? '—' : `${Math.round(x.top3 * 100)}% del valore`),
        h('span', dots([x.noi ? `${x.noi} ${x.noi === 1 ? 'vinta' : 'vinte'}` : '', x.enti ? `${x.enti} enti nel CRM` : '']) || '—'),
        conv(x.conviene));
    });
    const table = h('section.cg-list.rg-list', head, list,
      h('div.cg-foot', `${shown.length} di ${rows.length} regioni · media Italia della BU: ribasso ${pct(r.italia.ribasso)}, ${it1(r.italia.offerenti)} offerenti`, h('span.cv-grow'),
        rows.length > shown.length ? h('button.pv-lnk', { type: 'button', on: { click: () => { st.allRegions = true; again(); } } }, 'Mostra tutte') : null));
    const side = h('aside.rg-side', loading());
    body = h('div.rg-grid', table, side);
    regionAside(side, { st, r, buLabel, go });
  }
  fill(box, h('div.cg', hero, tabs, bar, body,
    h('p.cv-hint', `«Conviene» = volume ${r.pesi.volume}% · margine ${r.pesi.margine}% · concorrenza ${r.pesi.concorrenza}% · vicinanza ${r.pesi.vicinanza}%. Fonte: ANAC, dati aperti (CC BY-SA 4.0).`)));
}

async function regionAside(side, { st, r, buLabel, go }) {
  const d = await get(`/api/crm/concorrenza/regioni/${encodeURIComponent(st.region)}?months=${st.months}&bu=${st.rbu}`).catch(() => null);
  if (!d) return fill(side, h('p.pv-empty', 'Regione non disponibile.'));
  const kpi = (l, v) => h('div.rg-sk', h('span', l), h('b', v));
  const level = s => (s?.level === 'forte' || s?.level === 'media' ? h('b.rg-warm', ' · ci conoscono') : s ? h('a.rg-crm', { href: `#/crm/scheda/${s.id}` }, ' · nel CRM') : null);
  const newInitiative = () => {
    try {
      sessionStorage.setItem('nb.preset', JSON.stringify({ name: `${buLabel(st.rbu)} in ${d.region}`,
        description: `Dai dati ANAC (ultimi ${d.scope.months} mesi): ${d.gare} gare per ${eur(d.valore)}, ribasso tipico ${pct(d.ribasso)} (Italia ${pct(d.italia.ribasso)}), ${it1(d.offerenti)} offerenti a gara. ${d.perche.map(p => p.text).join(' ')}` }));
    } catch { /* niente */ }
    location.hash = '#/crm/business/nuova';
  };
  fill(side,
    h('div.rg-side-top',
      h('div.pv-row', h('span.cg-k.cv-grow', `Regione · BU ${buLabel(st.rbu)}`)),
      h('div.pv-row', h('h2.cv-grow', d.region), h('b.rg-big', { class: tone(d.conviene) }, d.conviene === null ? '—' : String(d.conviene))),
      h('div.rg-sks', kpi('Gare', String(d.gare)), kpi('Valore', eur(d.valore)), kpi('Ribasso', pct(d.ribasso)), kpi('Offerenti', it1(d.offerenti)))),
    h('div.rg-sec', h('b.pv-card-t', d.conviene === null ? 'Com\'è' : 'Perché conviene'), d.perche.map(p => h('div.rg-why', { class: p.tone }, h('i'), h('span', p.text)))),
    h('div.rg-sec', h('div.pv-row', h('b.pv-card-t.cv-grow', 'Ribasso per fascia d\'importo'), h('small.rg-muted', 'barra = metà centrale · tacca = tipico')),
      d.bands.length ? h('div.cv-bands', d.bands.map(b => h('div.cv-bandrow', h('span', b.label), bandBar(b.p25, b.med, b.p75), h('span.num', h('b', pct(b.med)), h('span.cv-small.cv-muted', ` ${b.n}`)))))
        : h('p.pv-empty', 'Servono gare con almeno 2 offerenti.')),
    h('div.rg-sec', h('b.pv-card-t', 'Enti che bandiscono di più'),
      d.enti.length ? d.enti.map(e => h('div.rg-ente', h('span.cv-grow', nice(e.name), level(e.subject)), h('small', `${e.gare} gare`), h('b', eur(e.valore)))) : h('p.pv-empty', 'Nessun ente.')),
    h('div.rg-foot',
      d.winners.length ? h('p.rg-muted', 'Chi vince qui: ', d.winners.slice(0, 3).map((w, i) => [i ? ', ' : '', h('b', `${nice(w.name)} (${w.vinte})`)]),
        ' · ', h('button.pv-lnk', { type: 'button', on: { click: () => { st.pregion = d.region; st.pbu = st.rbu; go('partner'); } } }, 'partner possibili →')) : null,
      h('div.pv-row.rg-acts',
        h('button.btn.btn-sm', { type: 'button', on: { click: () => { st.pregion = d.region; st.pbu = st.rbu; go('partner'); } } }, ic('handshake', 14), 'Partner qui'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => go('prima-del-bando') } }, ic('hourglass', 14), 'Prima del bando'),
        h('span.cv-grow'),
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: newInitiative } }, ic('sprout', 14), 'Crea iniziativa'))));
}

// ── Partner ──────────────────────────────────────────────────────────────────────────────────────
export async function partnerSection(box, { st, buLabel, tabs, again }) {
  fill(box, loading());
  const q = new URLSearchParams({ months: st.months, ...(st.pbu ? { bu: st.pbu } : {}), ...(st.pregion ? { region: st.pregion } : {}) });
  const r = await get(`/api/crm/concorrenza/partner?${q}`);
  st.pbu = r.bu;
  st.pregion = r.region;
  const bar = buBar(r.bus, r.bu, buLabel, b => { st.pbu = b; st.pregion = ''; again(); }, st, again);
  const openCo = p => openImpresaMercato(p.cf ? { cf: p.cf } : { name: p.name }, { regions: [p.region], months: st.months, onChange: () => again() })
    .catch(err => toast(err.message || 'Scheda non disponibile', 'error'));
  const cell = (reg, b) => {
    const c = reg.cells[b];
    const sel = reg.region === r.region && b === r.bu;
    return h('button.pt-cell', { type: 'button', class: `${sel ? 'sel' : ''}${c.n ? '' : ' none'}`, disabled: !c.n || undefined, on: { click: () => { st.pbu = b; st.pregion = reg.region; again(); } } },
      h('b', c.n ? nice(c.best.name) : '—'), h('small', c.n ? dots([`${c.n} ${c.n === 1 ? 'partner' : 'partner'}`, c.crm ? `${c.crm} nel CRM` : '']) : 'nessuno'));
  };
  const matrix = r.regions.length ? h('section.pv-card.pt-matrix',
    h('div.pv-row', h('b.pv-grow', 'Partner migliori per regione e BU ', h('span.rg-muted', `· ${r.totale} da valutare, ${r.nel_crm} già nel CRM`)), h('small.rg-muted', 'le regioni con più partner possibili')),
    h('div.pt-grid', { style: { gridTemplateColumns: `130px repeat(${r.bus.length}, minmax(130px, 1fr))` } },
      h('span'), r.bus.map(b => h('span.pt-h', buLabel(b))),
      r.matrix.map(reg => [h('b.pt-reg', reg.region), r.bus.map(b => cell(reg, b))]))) : null;
  const card = p => h('div.pt-card', { class: p.subject?.roles?.includes('partner') ? 'crm' : '' },
    h('div.pv-row.top', h('span.cg-fr-ic.bl', ic('handshake', 16)),
      h('div.cv-grow', h('button.pt-name', { type: 'button', on: { click: () => openCo(p) } }, nice(p.name)), h('small.rg-muted', p.cf ? `P.IVA ${p.cf}` : '')),
      p.subject ? (p.subject.level === 'forte' || p.subject.level === 'media' ? pill('Ci conosciamo', 'gr') : crmCell(p, () => again(), 'partner')) : h('small.rg-muted', 'non nel CRM')),
    h('div.pt-why', p.perche.map(t => h('div', h('i'), h('span', t)))),
    h('div.pv-row.pt-foot', (p.categorie || []).slice(0, 3).map(c => h('span.pt-tag', c)), p.ribasso !== null ? h('span.pt-tag', `ribasso medio ${pct(p.ribasso)}`) : null, h('span.cv-grow'),
      p.subject ? null : crmCell(p, () => again(), 'partner'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => {
        e.currentTarget.disabled = true;
        const res = await post('/api/crm/concorrenza/incontro', { name: nice(p.name), cf: p.cf, bu: buLabel(r.bu), region: p.region }).catch(() => null);
        if (res) { toast(`Passo «Incontro» creato su ${nice(p.name)} entro il ${res.due_date.split('-').reverse().join('/')}`); again(); }
      } } }, ic('calendar', 14), 'Proponi un incontro')));
  const list = r.partners.length ? h('div.pt-cards', r.partners.map(card))
    : h('section.pv-card', emptyState('handshake', r.region ? `Nessun partner possibile per ${buLabel(r.bu)} in ${r.region}: nessuna impresa ha vinto in ATI qui.` : 'Nessuna impresa ha vinto in ATI nelle categorie di questa BU.'));
  fill(box, h('div.cg', tabs, bar, matrix,
    r.region ? h('div.pv-row.pt-title', h('b.cv-grow', `${r.region} · ${buLabel(r.bu)} `, h('span.rg-muted', `· ${r.partners.length} partner possibili`)), h('small.rg-muted', 'più gare in ATI prima')) : null,
    list,
    h('p.cv-hint', 'Partner possibile = impresa che vince nella regione nelle categorie della BU andando in ATI; non compaiono Almacis e le imprese segnate come concorrenti nel CRM. Fonte: ANAC, dati aperti (CC BY-SA 4.0).')));
}
