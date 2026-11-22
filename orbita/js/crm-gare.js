// «Concorrenza e gare» (canvas v11, approvato da Dante il 20/11/2026): Concorrenza e Prima del bando di nuovo nel menu,
// in una voce sola. Testata scura con i numeri dei dati ANAC e «Cerca un'impresa»; tre sezioni: Chi vince (al clic la
// scheda dell'impresa, la stessa di Nuovi business), Vinte da altri (subappalto o ATI), Prima del bando (opere per fase).
import { h, fill, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post } from './api.js';
import { ic, dots, pill, emptyState, cvModal } from './crm-v2.js';
import { bandBar, nice, crmCell } from './crm-concorrenza.js';
import { openImpresaMercato } from './crm-impresa-mercato.js';
import { regioniSection, partnerSection } from './crm-gare-regioni.js';
import { sourceLine, basedOn } from './crm-fonti.js';
import { regionPicker, regionsQuery } from './crm-regioni-pick.js';

const eur = n => (n === null || n === undefined || n === '' ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : Number(n) >= 1e4 ? `${Math.round(Number(n) / 1e3).toLocaleString('it-IT')} k€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const pct = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const num = n => Number(n || 0).toLocaleString('it-IT');
const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const month = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }) : '');
// v17 (Dante 22/11): Concorrenza e gare solo «a gara fatta»; Prima del bando e Opere finanziate vivono nel Radar
const SECTIONS = [['chi-vince', 'Chi vince', 'users'], ['regioni', 'Regioni', 'map-pin'], ['partner', 'Partner', 'handshake'], ['vinte-da-altri', 'Vinte da altri', 'package']];
const MOVED = { 'prima-del-bando': '#/crm/radar', 'opere-finanziate': '#/crm/radar/opere' };

let gState = null;
export async function gareHub(box, data, section, { openSignal } = {}) {
  fill(box, loading());
  const st = gState || (gState = { bu: null, months: 24, rsel: undefined, amount: '', top: 25 });
  if (MOVED[section]) { location.replace(MOVED[section]); return; } // link vecchi: ora nel Radar
  const sec = SECTIONS.some(([k]) => k === section) ? section : 'chi-vince';
  const again = (s = sec) => gareHub(box, data, s, { openSignal });
  const go = s => { history.replaceState(null, '', `#/crm/concorrenza/${s}`); again(s); };
  // Regioni e Partner (canvas v12): sezioni con i loro dati e la loro testata
  if (sec === 'regioni' || sec === 'partner') {
    const buLabel = x => data.asa.find(a => a.key === x)?.label || x;
    const tabs = h('div.cg-tabs', { role: 'tablist' }, SECTIONS.map(([key, l, i]) => h('button.cg-tab', { type: 'button', role: 'tab', 'aria-selected': String(key === sec), class: key === sec ? 'on' : '', on: { click: () => go(key) } },
      ic(i, 14), h('b', l), h('span', { regioni: 'dove conviene', partner: 'da contattare' }[key] || ''))));
    const opts = { st, buLabel, tabs, go, again: () => again(sec) };
    return sec === 'regioni' ? regioniSection(box, opts) : partnerSection(box, opts);
  }
  const qs = new URLSearchParams({ months: st.months, ...(st.bu !== null ? { bu: st.bu } : {}), ...(regionsQuery(st.rsel) !== undefined ? { regions: regionsQuery(st.rsel) } : {}), ...(st.amount ? { amount: 'tutte' } : {}) });
  const [r, pb] = await Promise.all([get(`/api/crm/concorrenza?${qs}`), get(`/api/crm/prima-del-bando${st.bu ? `?bu=${st.bu}` : ''}`).catch(() => ({ stages: {}, vinte_altri: [] }))]);
  if (st.bu === null) st.bu = r.scope.bu || '';
  const sc = r.scope;
  const k = r.kpi;
  const buLabel = x => data.asa.find(a => a.key === x)?.label || x;
  const openCo = w => openImpresaMercato(w.cf ? { cf: w.cf } : { name: w.name }, { cats: sc.categories, regions: sc.regions, months: st.months, onChange: () => again() })
    .catch(err => toast(err.message || 'Scheda non disponibile', 'error'));
  const counts = { regioni: 'dove conviene', partner: 'da contattare', 'chi-vince': `${num(r.winners.length)} imprese`, 'vinte-da-altri': `${pb.vinte_altri.length} dove entrare` };

  // ── testata: numeri dei dati ANAC e «Cerca un'impresa» ──
  const search = h('input', { type: 'search', placeholder: 'Cerca un\'impresa per nome o P.IVA: vedi tutte le gare che ha vinto', 'aria-label': 'Cerca un\'impresa' });
  const found = h('div.cg-found', { hidden: true });
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (q.length < 2) { found.hidden = true; return; }
    const res = await get(`/api/crm/concorrenza/cerca?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ imprese: [] }));
    fill(found, res.imprese.length ? res.imprese.map(w => h('button.cg-fr', { type: 'button', on: { click: () => { found.hidden = true; openCo(w); } } },
      h('span.cg-fr-ic', ic('building', 14)), h('span.cv-grow', h('b', nice(w.name)), h('small', dots([w.cf && `P.IVA ${w.cf}`, `${w.vinte} ${w.vinte === 1 ? 'gara vinta' : 'gare vinte'}`, eur(w.valore)]))), ic('chevron-right', 14)))
      : h('p.cg-none', 'Nessuna impresa con questo nome tra le gare caricate.'));
    found.hidden = false;
  }, 250));
  const admin = r.admin ? h('button.cg-ghost', { type: 'button', disabled: r.data.running || undefined, on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/concorrenza/aggiorna', {}); toast('Aggiornamento dai dati ANAC avviato: ci vuole qualche minuto'); } } }, ic('refresh-cw', 13), r.data.running ? 'Aggiornamento…' : 'Aggiorna da ANAC') : null;
  const hero = h('section.cg-hero',
    h('div.cg-top', h('div.cv-grow',
      h('div.cg-kicker', ic('trophy', 12), r.data.gare ? `Dati pubblici ANAC${r.data.at ? ` · aggiornati al ${day(r.data.at)}` : ''} · ${num(r.data.gare)} gare` : 'Dati pubblici ANAC non ancora caricati'),
      h('h1.cg-h1', 'Concorrenza e gare'),
      h('p.cg-sub', 'Chi vince le gare nelle nostre categorie e zone, con che ribasso, e dove possiamo entrare noi.')), admin),
    h('div.cg-kpis',
      [['Gare aggiudicate', num(k.gare), `per ${eur(k.valore)}`, ''], ['Ribasso tipico', pct(k.ribasso), k.p25 !== null && k.p25 !== undefined ? `metà delle gare tra ${pct(k.p25)} e ${pct(k.p75)}` : 'servono gare con più offerenti', 'or'],
        ['Imprese che vincono', num(r.winners.length), r.winners.length ? `la prima, ${nice(r.winners[0].name)}, ne vince ${r.winners[0].vinte}` : '—', ''],
        ['Vinte da noi', num(k.noi), k.gare ? `quota ${pct((100 * k.noi) / k.gare)} · ${eur(k.noi_valore)}` : '—', 'gr']]
        .map(([l, v, s, tone]) => h('div.cg-kpi', { class: tone }, h('span.cg-k', l), h('b', v), h('small', s),
          l === 'Ribasso tipico' && k.gare ? basedOn(k.con_ribasso, k.gare, 'lo dichiarano con almeno 2 offerenti') : null))),
    h('div.cg-search', ic('search', 15), search, found));

  // ── sezioni e filtri (uguali per tutte e tre) ──
  const tabs = h('div.cg-tabs', { role: 'tablist' }, SECTIONS.map(([key, l, i]) => h('button.cg-tab', { type: 'button', role: 'tab', 'aria-selected': String(key === sec), class: key === sec ? 'on' : '', on: { click: () => go(key) } },
    ic(i, 14), h('b', l), h('span', counts[key]))));
  const sel = (opts, value, label, onChange) => { const s = h('select.cg-sel', { 'aria-label': label, class: value ? 'on' : '' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const filters = h('div.cg-filters',
    sel([['', 'BU: tutte'], ...r.bus.map(b => [b, `BU: ${buLabel(b)}`])], st.bu, 'BU', v => { st.bu = v; st.rsel = undefined; again(); }),
    sel([['12', '12 mesi'], ['24', '24 mesi']], String(st.months), 'Periodo', v => { st.months = Number(v); again(); }),
    sc.categories.length || sc.cpv.length ? h('span.cg-chip', [...sc.categories, ...sc.cpv.map(c => `CPV ${c}…`)].slice(0, 6).join(' · ')) : null,
    // filtro Regioni (v17): una o più regioni, con quante gare ha ognuna
    regionPicker({ counts: r.region_counts || [], selected: st.rsel, profile: r.profile_regions || [], onChange: v => { st.rsel = v; again(); } }),
    st.bu && (sc.amount_min || sc.amount_max || st.amount) ? h('button.cg-chip.btn', { type: 'button', on: { click: () => { st.amount = st.amount ? '' : 'tutte'; again(); } } },
      st.amount ? 'tutti gli importi' : `${eur(sc.amount_min || 0)} – ${sc.amount_max ? eur(sc.amount_max) : 'senza limite'}`) : null);

  const body = h('div');
  if (!r.data.gare && sec === 'chi-vince') fill(body, h('section.pv-card', emptyState('scale', r.data.running ? 'Sto caricando i dati ANAC: ci vuole qualche minuto.' : 'I dati ANAC si caricano da soli ogni notte; la direzione può avviarli subito con «Aggiorna da ANAC».')));
  else if (sec === 'chi-vince') fill(body, chiVince(r, st, openCo, again));
  else if (sec === 'vinte-da-altri') fill(body, vinteAltri(pb, buLabel, g => openSignal?.(g.id, () => again(), data, pb.vinte_altri)));
  const source = sourceLine({ cats: sc.categories, regions: sc.regions, months: st.months }, { count: k.gare }); // «Da dove vengono i dati» (ALM2-49)
  fill(box, h('div.cg', hero, tabs, filters, source, body,
    h('p.cv-hint', 'Fonte: ANAC, dati aperti (licenza CC BY-SA 4.0). Categorie e zone dai profili delle BU.')));
}

function chiVince(r, st, openCo, again) {
  const w = r.winners;
  if (!w.length) return h('section.pv-card', emptyState('scale', 'Nessuna gara aggiudicata con questi filtri.'));
  const shown = w.slice(0, st.top);
  const rows = shown.map((x, i) => h('div.cg-row', { class: x.noi ? 'noi' : '', role: 'button', tabIndex: 0,
    on: { click: e => { if (!e.target.closest('a, button')) openCo(x); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openCo(x); } } },
    h('span.cg-n', String(i + 1)),
    h('div.cg-name', h('b', nice(x.name)), h('small', dots([x.cf && `P.IVA ${x.cf}`, (x.regioni || []).join(', ')]))),
    h('span.cg-vinte', String(x.vinte)), h('span.cg-val', eur(x.valore)),
    h('div.cg-rib', h('span', pct(x.ribasso)), h('i', h('span', { style: { width: `${Math.min(100, (Number(x.ribasso) || 0) * 3)}%` } }))),
    h('span.cg-ati', x.in_ati ? String(x.in_ati) : '—'),
    h('span.cg-crm', crmCell(x, () => again()))));
  const bands = [...r.bands, ...(r.criteria.length ? [{ sep: true }] : []), ...r.criteria];
  return h('div.cg-grid',
    h('section.cg-list',
      h('div.cg-head', h('span', '#'), h('span', 'Impresa'), h('span', 'Vinte'), h('span', 'Valore'), h('span', 'Ribasso medio'), h('span', 'In ATI'), h('span', 'Nel CRM')),
      rows,
      h('div.cg-foot', `Righe 1–${shown.length} di ${num(w.length)} · ordinate per gare vinte · tocca un'impresa per vedere tutte le gare che ha vinto`, h('span.cv-grow'),
        w.length > shown.length ? h('button.pv-lnk', { type: 'button', on: { click: () => { st.top += 50; again(); } } }, 'Mostra altre') : null)),
    h('div.cg-side',
      h('section.pv-card', h('b.pv-card-t', 'Ribasso per fascia d\'importo'),
        bands.length ? h('div.cv-bands', bands.map(b => (b.sep ? h('div.cv-sect', 'Per criterio') : h('div.cv-bandrow', h('span', b.label), bandBar(b.p25, b.med, b.p75), h('span.num', h('b', pct(b.med)), h('span.cv-small.cv-muted', ` ${b.n}`))))))
          : h('p.pv-empty', 'Servono gare con almeno 2 offerenti.')),
      h('section.pv-card', h('b.pv-card-t', 'Con chi fare ATI'),
        r.ati.length ? r.ati.slice(0, 6).map(x => h('div.cg-mini', { role: 'button', tabIndex: 0, on: { click: e => { if (!e.target.closest('a, button')) openCo(x); } } },
          h('span.cg-fr-ic.gr', ic('handshake', 13)), h('span.cv-grow', h('b', nice(x.name)), h('small', dots([(x.categorie || []).join(' · '), `${x.ati} ATI vinte`]))), crmCell(x, () => again(), 'partner')))
          : h('p.pv-empty', 'Nessuna impresa ha vinto più di una volta in ATI con questi filtri.')),
      r.ours.length ? h('section.pv-card', h('b.pv-card-t', 'Le nostre'), r.ours.slice(0, 5).map(a => h('div.cg-mini', h('span.cg-fr-ic.or', ic('trophy', 13)), h('span.cv-grow', h('b', nice(a.object)), h('small', dots([nice(a.sa_name), eur(a.amount), a.discount !== null ? `−${pct(a.discount)}` : '', day(a.awarded_on)])))))) : null));
}

function vinteAltri(pb, buLabel, open) {
  const list = pb.vinte_altri;
  if (!list.length) return h('section.pv-card', emptyState('handshake', 'Nessuna gara delle nostre categorie vinta da altri di recente: si aggiorna quando escono i dati ANAC del mese.'));
  return h('div.cg-cards', list.map(g => {
    const parts = String(g.summary || '').split(' · ');
    return h('div.cg-card', { role: 'button', tabIndex: 0, on: { click: () => open(g), keydown: e => { if (e.key === 'Enter') open(g); } } },
      h('div.pv-row.top', h('span.cg-fr-ic.bl', ic('handshake', 15)),
        h('div.cv-grow', h('b', nice(String(g.title).replace(/^.*? ha vinto: /, ''))), h('small', dots([nice(g.place) || g.region, `vinta da ${nice(g.entity)}`, g.created_at ? day(g.created_at) : '']))),
        h('b.cg-amt', eur(g.amount))),
      h('div.pv-row', h('small.cg-muted', parts.slice(1, 3).join(' · ') || (g.bu ? buLabel(g.bu) : '')), h('span.cv-grow'),
        g.status === 'interessa' ? h('span.cg-in', '● nel Radar') : h('span.cg-go', 'Proponiti in subappalto')));
  }));
}

