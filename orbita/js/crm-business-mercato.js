// Nuovi business · Mappa del mercato (canvas «Nuovi business · Mappa del mercato», approvato da Dante il 20/11/2026):
// tab «Mercato» (NB-Mercato), stati «le carico stanotte» / «sto caricando» (NB-Mercato-Stati), scheda di un'impresa
// (NB-Mercato-Impresa), selettore delle categorie SOA (NB-Mercato-Categorie), card «Mercato» dell'Analisi
// (NB-Mercato-Analisi); sul telefono le stesse parti una sotto l'altra (NB-Mercato-Telefono).
import { h, fill, modal, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post, put } from './api.js';
import { icon } from './icons.js';
import { sourceLine, basedOn, openSources } from './crm-fonti.js';
import { qualifiedSection, soaBox, openSoaPanel } from './crm-soa.js';

const ic = (name, size = 16) => icon(name, { size });
const pct = x => (x === null || x === undefined ? '—' : `${Number(x).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const num = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString('it-IT', { maximumFractionDigits: 0 }));
const meur = n => (n === null || n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : `${Math.round(n / 1000).toLocaleString('it-IT')} k€`);
const eur = n => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' })} €`);
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const monthLabel = m => (m ? `${['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][Number(String(m).slice(4, 6)) - 1]} ${String(m).slice(0, 4)}` : '');
const btn = (label, onClick, { primary = false, small = false, ghost = false, ico = null, disabled = false } = {}) =>
  h('button.nb-btn', { type: 'button', class: [primary && 'pri', small && 'sm', ghost && 'ghost'].filter(Boolean).join(' '), disabled, on: { click: onClick } }, ico ? ic(ico, small ? 14 : 16) : null, label);
const pill = (text, cls = '') => h('span.nb-pill', { class: cls }, text);
const listCats = cats => (cats.length <= 1 ? cats.join('') : `${cats.slice(0, -1).join(', ')} e ${cats.at(-1)}`);
// nome dell'impresa come lo scrive ANAC (tutto maiuscolo) → leggibile
const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'.(-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Srl|Spa|Snc|Sas|Scarl|Scrl)\b/g, x => x[0] + x.slice(1));
const ROLE = { partner: ['Partner', 'ok'], fornitore: ['Fornitore', 'blue'], concorrente: ['Concorrente', 'red'], cliente: ['Cliente', 'ok'], lead: ['Lead', 's4'] };
const rolePill = role => (role ? pill(...ROLE[role]) : pill('Non nel CRM', 'line'));
const dlg = (m, cls = '') => { m.box.classList.add('nb-dlg'); if (cls) m.box.classList.add(cls); return m; };

// ── tab Mercato ──────────────────────────────────────────────────────────────────────────────
export async function mercatoTab(ctx, f = {}) {
  const { i, id, body, toolbar, crmData } = ctx;
  f = { months: 12, province: '', cats: null, ...f };
  const again = (patch = {}) => mercatoTab(ctx, { ...f, ...patch });
  toolbar.replaceChildren(btn('Aggiorna', () => again(), { ico: 'refresh-cw' }));
  body.replaceChildren(loading());
  const qs = new URLSearchParams({ months: f.months, ...(f.province ? { province: f.province } : {}), ...(f.cats ? { cats: f.cats.join(',') } : {}) });
  const m = await get(`/api/crm/business/${id}/mercato?${qs}`);
  const st = m.state;
  const canEdit = m.canEdit;
  const editCats = () => soaDialog(i, crmData.meta || {}, () => again({ cats: null }));
  // niente categorie nel profilo
  if (!st.categories.length) {
    return fill(body, h('section.nb-card.nb-mstate', h('span.nb-mstate-i', ic('target', 22)),
      h('div.nb-min0', h('div.nb-mstate-t', 'Scegli le categorie SOA dell\'iniziativa'),
        h('div.nb-mstate-s', 'Il mercato si legge dalle gare pubbliche ANAC nelle categorie SOA e nelle zone dell\'iniziativa: chi vince, con che ribasso, chi compra.'),
        canEdit ? h('div.nb-mstate-a', btn('Scegli le categorie', editCats, { primary: true, ico: 'plus' })) : null)));
  }
  // nessuna categoria ancora caricata: «le carico stanotte» o «sto caricando»
  if (!st.loaded.length) return fill(body, stateCard(i, m, { again, editCats }));

  const active = m.scope.categories;
  const where = m.where || [];
  const provinces = where.flatMap(r => r.provinces.map(p => p.province));
  const place = f.province ? ` a ${f.province}` : '';
  // ── filtri ──
  const search = searchBox(i, id, m, crmData);
  const catPill = c => {
    const missing = st.missing.includes(c);
    const on = active.includes(c);
    return h('button.nb-mcat', { type: 'button', class: missing ? 'wait' : on ? 'on' : '', title: missing ? 'Le gare di questa categoria arrivano stanotte' : on ? 'Togli dal filtro' : 'Aggiungi al filtro',
      disabled: missing, on: { click: () => {
        const next = on ? active.filter(x => x !== c) : [...active, c];
        if (!next.length) return toast('Lascia almeno una categoria', 'err');
        again({ cats: next.length === st.loaded.length ? null : next });
      } } }, missing ? ic('hourglass', 13) : on ? ic('check', 13) : null, c, missing ? h('small', 'in arrivo') : null);
  };
  const provSel = h('label.nb-mprov', { class: f.province ? 'on' : '' }, h('select', { 'aria-label': 'Provincia', on: { change: e => again({ province: e.target.value }) } },
    h('option', { value: '' }, 'Tutte le province'), provinces.map(p => h('option', { value: p, selected: p === f.province }, `Provincia: ${p}`))), ic('chevron-down', 13));
  const months = h('div.nb-seg', [12, 24].map(n => h('button', { type: 'button', class: f.months === n ? 'on' : '', on: { click: () => again({ months: n }) } }, `${n} mesi`)));
  const filters = h('div.nb-mfilters', search.el,
    h('div.nb-mcats', st.categories.map(catPill), canEdit ? h('button.nb-link', { type: 'button', on: { click: editCats } }, ic('plus', 14), 'Categoria') : null),
    h('span.nb-mdiv'),
    h('span.nb-mreg', ic('map-pin', 14), m.scope.regions.length ? m.scope.regions.join(' · ') : 'Tutta Italia'),
    provinces.length ? provSel : null, months);
  const seeing = h('div.nb-mseeing', ic('sliders', 15),
    h('span.nb-min0', 'Stai vedendo: ', h('b', [f.province ? `provincia di ${f.province}` : m.scope.regions.length ? m.scope.regions.join(', ') : 'tutta Italia', `${listCats(active)}`, `ultimi ${f.months} mesi`].join(' · '))),
    f.province ? h('button.nb-mx', { type: 'button', on: { click: () => again({ province: '' }) } }, f.province, ic('x', 12)) : null,
    h('span.grow'),
    f.province ? h('button.nb-link', { type: 'button', on: { click: () => again({ province: '' }) } }, 'Mostra tutte le province') : null);
  // «Da dove vengono i dati» (ALM2-49, canvas v13): fonte, aggiornamento e periodo sempre visibili
  const source = sourceLine({ iniziativa: id, months: f.months, province: f.province, cats: f.cats }, { count: m.kpi?.gare });
  const partial = st.missing.length ? h('div.nb-focus.soft', ic('hourglass'), h('div.grow', h('b', `${listCats(st.missing)}: `), `le gare di ${st.missing.length === 1 ? 'questa categoria' : 'queste categorie'} le carico stanotte dai dati ANAC. Intanto vedi ${listCats(st.loaded)}.`)) : null;

  // ── numeri ──
  const k = m.kpi;
  const counter = (name, n, label, cls = '') => h('div.nb-fc', { class: cls }, h('span.nb-fc-i', ic(name)), h('span.nb-fc-n', n), h('span.nb-fc-l', label));
  const counterNote = (el, note) => { if (note) el.append(note); return el; };
  const counters = h('div.nb-fcs.six',
    counter('trophy', num(k.gare), 'gare aggiudicate', 'or'), counter('euro', meur(k.valore), 'valore totale'), counterNote(counter('scale', pct(k.ribasso), 'ribasso tipico'), k.ribasso_n !== undefined ? basedOn(k.ribasso_n, k.gare, 'lo dichiarano con almeno 2 offerenti') : null),
    counter('users', k.offerenti ? num(k.offerenti) : '—', 'offerenti per gara'), counter('building', num(k.imprese), 'imprese vincitrici'),
    counter('handshake', num(k.noi), 'vinte da Almacis', k.noi ? '' : 'zero'));

  if (!k.gare) {
    return fill(body, h('div.nb-col24', filters, seeing, source, partial, counters,
      h('section.nb-card', h('div.nb-empty-s', h('span.nb-ki.nota', ic('search')), h('span', `Nessuna gara aggiudicata${place} in ${listCats(active)} negli ultimi ${f.months} mesi. Prova 24 mesi o un'altra provincia.`)))));
  }

  // ── chi vince ──
  let showAll = false;
  const winBox = h('div.nb-mwin');
  const doAction = async w => {
    if (w.role === 'partner' || w.role === 'fornitore') {
      const title = w.role === 'partner' ? `Proporre un'ATI a ${nice(w.name)}` : `Chiedere a ${nice(w.name)} di lavorare in subappalto`;
      await post(`/api/crm/business/${id}/tasks`, { title });
      return toast('Passo creato nel piano');
    }
    const out = await post('/api/crm/concorrenza/scheda', { name: nice(w.name), cf: w.cf, role: 'concorrente' });
    toast(out.created ? 'Aggiunta al CRM come concorrente' : 'È già nel CRM: segnata come concorrente');
    again();
  };
  const action = w => (w.role === 'partner' ? h('button.nb-link', { type: 'button', on: { click: () => doAction(w) } }, ic('handshake', 14), 'Proponi ATI')
    : w.role === 'fornitore' ? h('button.nb-link', { type: 'button', on: { click: () => doAction(w) } }, ic('handshake', 14), 'Chiedi subappalto')
      : w.role ? (w.subject ? h('a.nb-link', { href: `#/crm/scheda/${w.subject.id}` }, ic('link', 14), 'Apri nel CRM') : h('span.muted', '—'))
        : h('button.nb-link', { type: 'button', on: { click: () => doAction(w) } }, ic('plus', 14), 'Aggiungi come concorrente'));
  const sub = w => [w.province?.length ? w.province.join(', ') : '', (w.categorie || []).join(' · '),
    w.in_ati ? (w.mandataria ? 'mandataria' : 'in ATI') + (w.partners?.length ? `, con ${w.partners.map(nice).join(' e ')}` : '') : 'da sola'].filter(Boolean).join(' · ');
  const drawWinners = () => {
    const list = showAll ? m.winners : m.winners.slice(0, 6);
    const ours = m.ours;
    winBox.replaceChildren(h('div.nb-scroll', h('table.nb-mtbl',
      h('thead', h('tr', ['Impresa', 'Gare vinte', 'Valore', 'Ribasso tipico', 'Nel CRM', 'Cosa fare'].map((x, n) => h('th', { class: n >= 1 && n <= 3 ? 'r' : '' }, x)))),
      h('tbody',
        list.map((w, n) => h('tr', { on: { click: e => { if (!e.target.closest('button,a')) companyPanel(i, id, { cf: w.cf, name: w.name }, f, crmData, again); } } },
          h('td', h('div.nb-mimp', h('span.nb-rank', String(n + 1)), h('div.nb-min0', h('div.nb-t', nice(w.name)), h('div.nb-small.muted', sub(w))))),
          h('td.r', num(w.vinte)), h('td.r', meur(w.valore)), h('td.r', pct(w.ribasso)), h('td', rolePill(w.role)), h('td', action(w)))),
        h('tr.ours', h('td', h('div.nb-mimp', h('span.nb-rank', '–'), h('div.nb-min0', h('div.nb-t', 'Almacis'),
          h('div.nb-small.muted', ours ? sub(ours) : `nessuna gara in ${listCats(active)}${place}`)))),
        h('td.r', ours ? num(ours.vinte) : '0'), h('td.r', ours ? meur(ours.valore) : '—'), h('td.r', ours ? pct(ours.ribasso) : '—'), h('td', pill('Almacis', 's4')), h('td', ''))))),
    // sul telefono: righe semplici (nome, gare e ribasso, ruolo nel CRM); il resto nella scheda dell'impresa
    h('div.nb-mwin-m', list.map(w => h('button.nb-mwin-r', { type: 'button', on: { click: () => companyPanel(i, id, { cf: w.cf, name: w.name }, f, crmData, again) } },
      h('div.nb-min0', h('div.nb-t', nice(w.name)), h('div.nb-small.muted', `${w.vinte} ${w.vinte === 1 ? 'gara' : 'gare'} · ${pct(w.ribasso)}`)), rolePill(w.role)))),
    m.winners.length > 6 || m.more ? h('div.nb-small.muted.nb-mt12', m.winners.length > 6 && !showAll ? [`e altre ${m.winners.length - 6 + m.more} imprese · `, h('button.nb-link', { type: 'button', on: { click: () => { showAll = true; drawWinners(); } } }, 'Vedi le prime 12')]
      : m.more ? `e altre ${m.more} imprese con meno gare` : null) : null);
  };
  drawWinners();
  const winCard = h('section.nb-card.nb-mcard', h('div.nb-card-h', h('h3', `Chi vince${place}`, h('span.nb-cnt', String(m.winners.length + m.more))), h('span.nb-small.muted', 'clic su un nome per la sua scheda di mercato')), winBox);

  // ── chi compra ──
  const buyCard = h('section.nb-card.nb-mcard', h('div.nb-card-h', h('h3', `Chi compra${place}`, h('span.nb-cnt', String(m.buyers.length))), h('span.nb-small.muted', 'possibili clienti target')),
    m.buyers.map(b => h('div.nb-mrow', h('div.nb-min0', h('div.nb-t', b.name), h('div.nb-small.muted', `${b.gare} ${b.gare === 1 ? 'gara' : 'gare'} · ${meur(b.valore)}${b.ultima ? ` · ultima ${day(b.ultima)}` : ''}`)),
      b.target ? pill('cliente target', 'ok') : canEdit ? btn('Cliente target', async () => { await post(`/api/crm/business/${id}/mercato/stazione`, { name: b.name, gare: b.gare }); toast('Aggiunta ai clienti target'); again(); }, { small: true, ico: 'plus' }) : null)));

  // ── dove ──
  const maxP = Math.max(1, ...where.flatMap(r => r.provinces.map(p => p.gare)));
  const whereCard = h('section.nb-card.nb-mcard', h('div.nb-card-h', h('h3', h('span.nb-who', ic('map', 15), 'Dove')), h('span.nb-small.muted', 'clic su una barra per filtrare')),
    h('div.nb-mwhere', where.map(r => h('div.nb-mreg-b', h('div.nb-lbl', r.region), r.provinces.map(p => {
      const on = p.province === f.province;
      return h('button.nb-mbar', { type: 'button', class: on ? 'on' : f.province ? 'dim' : '', on: { click: () => again({ province: on ? '' : p.province }) } },
        h('span.nb-mbar-l', p.province, on ? ic('x', 11) : null), h('span.nb-mbar-t', h('i', { style: { width: `${Math.max(4, p.gare / maxP * 100)}%` } })), h('b', String(p.gare)));
    })))));

  // ── ribasso per fascia ──
  const scale = Math.max(30, ...m.bands.map(b => b.p75 || 0)) * 1.15;
  const bandCard = h('section.nb-card.nb-mcard', h('div.nb-card-h', h('h3', 'Ribasso per fascia d\'importo'), h('span.nb-small.muted', 'barra = metà delle gare · tacca = tipico')),
    m.bands.map(b => h('div.nb-mband', h('div', h('div.nb-t', b.label), h('div.nb-small.muted', `${b.n} ${b.n === 1 ? 'gara' : 'gare'}`)),
      h('div.nb-mband-t', b.n ? [h('span.r', { style: { left: `${(b.p25 || b.med) / scale * 100}%`, width: `${Math.max(2, ((b.p75 || b.med) - (b.p25 || b.med)) / scale * 100)}%` } }), h('span.k', { style: { left: `${b.med / scale * 100}%` } })] : null),
      h('div.nb-right', h('b', b.n ? pct(b.med).replace(',0', '') : '—'), h('div.nb-small.muted', b.n && b.p25 != null ? `${Math.round(b.p25)}–${Math.round(b.p75)}%` : 'poche gare')))),
    h('div.nb-small.muted.nb-mt12', `${f.province ? `A ${f.province}` : 'Nelle tue zone'} in media ${k.offerenti ? num(k.offerenti) : '—'} offerenti per gara.`));

  // ── sinergie ──
  const synCard = h('section.nb-card.nb-mcard', h('div.nb-card-h', h('h3', 'Sinergie dal mercato'), h('span.nb-small.muted', 'vincitori già nel CRM')),
    m.synergies.length ? m.synergies.map(w => h('div.nb-msyn', h('span.nb-msyn-i', { class: w.role }, ic(w.role === 'partner' ? 'handshake' : 'users', 16)),
      h('div.nb-min0', h('div', h('span.nb-t', nice(w.name)), ' · ', h('b', ROLE[w.role][0].toLowerCase())),
        h('div.nb-small.muted', `${w.vinte} ${w.vinte === 1 ? 'gara vinta' : 'gare vinte'} in ${(w.categorie || []).join(' e ')}${place}${w.in_ati ? ` · ${w.in_ati} in ATI` : ''}`),
        canEdit && w.role !== 'cliente' ? h('div.nb-mt8', btn(w.role === 'partner' ? 'Crea passo: proponi ATI' : 'Crea passo: chiedi subappalto', () => doAction(w), { small: true })) : null)))
      : h('div.nb-empty-s', h('span.nb-ki.nota', ic('handshake')), h('span', 'Nessun vincitore è ancora nel CRM come partner o fornitore. Dalla tabella «Chi vince» puoi aggiungerli.')));

  // «Chi è qualificato in zona» (attestazioni SOA, canvas v13 · V13-SOA): si carica da sola, dopo il resto
  const qualCard = qualifiedSection({ id, months: f.months, cats: f.cats, regions: m.scope.regions,
    openCompany: c => (c.won ? companyPanel(i, id, { cf: c.cf, name: c.name }, f, crmData, again) : openSoaPanel(c, active)), onChange: again });
  fill(body, h('div.nb-col24', filters, seeing, source, partial, counters, winCard, qualCard, h('div.nb-g2.eq.nb-stretch', buyCard, whereCard), h('div.nb-g2.eq.nb-stretch', bandCard, synCard)));
}

// ── stati: «le carico stanotte» e «sto caricando» ─────────────────────────────────────────────
function stateCard(i, m, { again, editCats }) {
  const st = m.state;
  const cats = listCats(st.missing);
  if (st.running) {
    return h('section.nb-card.nb-mstate', h('span.nb-mstate-i.or', ic('refresh-cw', 22)),
      h('div.nb-min0.grow', h('div.nb-mstate-t', `Sto caricando le gare ${cats}`), h('div.nb-mstate-s', 'Puoi chiudere la pagina: ti avviso quando ho finito.'),
        h('div.nb-mprog', h('i')),
        h('div.nb-mstate-k', h('div', h('b', String(st.months || 0)), h('small', 'mesi ANAC già scaricati')), h('div', h('b', '12'), h('small', 'mesi da leggere')), h('div', h('b', '10–20 min'), h('small', 'tempo tipico')))));
  }
  const watch = async e => {
    e.currentTarget.disabled = true;
    const r = await post(`/api/crm/business/${i.id}/mercato/avvisami`, {});
    toast(r.ready ? 'Le gare ci sono già' : 'Ti avviso quando sono pronte');
    again();
  };
  return h('section.nb-card.nb-mstate', h('span.nb-mstate-i', ic('hourglass', 22)),
    h('div.nb-min0.grow', h('div.nb-mstate-t', `Le gare ${cats} non sono ancora nel CRM`), h('div.nb-mstate-s', 'Le carico stanotte dai dati pubblici ANAC. Domattina qui trovi chi vince, i ribassi e chi compra.'),
      h('ol.nb-msteps', [['Stanotte alle 5', `scarico gli ultimi 12 mesi di gare ${cats} da ${eur(m.min_amount)} in su`], ['Domattina', 'la tab si riempie: chi vince, ribassi, stazioni appaltanti, sinergie'], ['Poi ogni giorno', 'le gare nuove si aggiungono da sole, come per le BU']]
        .map(([t, s], n) => h('li', h('span.nb-msteps-n', String(n + 1)), h('div', h('div.nb-t', t), h('div.nb-small.muted', s))))),
      h('div.nb-mstate-a',
        m.watching ? btn('Ti avviso quando è pronto', null, { ico: 'check', disabled: true }) : btn('Avvisami quando è pronto', watch, { primary: true, ico: 'bell' }),
        m.admin ? btn('Carica adesso', async () => { await post('/api/crm/concorrenza/aggiorna', {}); toast('Caricamento partito: ci vogliono 10–20 minuti'); again(); }) : null,
        h('span.grow'), m.canEdit ? h('button.nb-link', { type: 'button', on: { click: editCats } }, 'Cambia categorie') : null),
      m.admin ? h('div.nb-small.muted', '«Carica adesso» c\'è solo per la direzione: ci vogliono 10–20 minuti.') : null));
}

// ── «Cerca un'impresa» ──────────────────────────────────────────────────────────────────────────
function searchBox(i, id, m, crmData) {
  const list = h('div.nb-mdrop', { hidden: true });
  const inputEl = h('input', { type: 'search', placeholder: 'Cerca un\'impresa…', 'aria-label': 'Cerca un\'impresa', autocomplete: 'off' });
  const run = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    const { companies } = await get(`/api/crm/business/${id}/mercato/imprese?q=${encodeURIComponent(q)}`);
    list.replaceChildren(h('div.nb-mdrop-h', `Imprese che vincono in ${listCats(m.scope.all)} nelle tue zone`),
      ...(companies.length ? companies.map(c =>h('button.nb-mdrop-i', { type: 'button', on: { click: () => { list.hidden = true; companyPanel(i, id, { cf: c.cf, name: c.name }, {}, crmData); } } },
        h('div.nb-min0', h('div.nb-t', nice(c.name)), h('div.nb-small.muted', [c.province?.join(', '), `${c.vinte} ${c.vinte === 1 ? 'gara vinta' : 'gare vinte'}${c.in_ati ? ` (${c.in_ati} in ATI)` : ''}`].filter(Boolean).join(' · '))), rolePill(c.role)))
        : [h('div.nb-mdrop-e', 'Nessuna impresa con questo nome vince nelle categorie e zone dell\'iniziativa.')]));
    list.hidden = false;
  }, 250);
  inputEl.addEventListener('input', run);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Escape') list.hidden = true; });
  document.addEventListener('click', e => { if (!el.contains(e.target)) list.hidden = true; });
  const el = h('div.nb-msearch', h('label.nb-search', ic('search'), inputEl), list);
  return { el };
}

// ── scheda di mercato di un'impresa (riquadro laterale 600 px) ─────────────────────────────────
// Comune: la usa anche la pagina Concorrenza del CRM tramite orbita/js/crm-impresa-mercato.js.
// openImpresaMercato({ cf } | { name }, { cats, regions, months, onChange }): categorie e regioni vuote = tutte le
// categorie caricate da ANAC e tutta Italia.
export function openImpresaMercato(who, { cats = [], regions = [], months = 12, onChange } = {}) {
  return companyPanel({ profile: { soa: cats, regions } }, null, who, { months }, {}, onChange);
}
async function companyPanel(i, id, who, f = {}, crmData = {}, onChange) {
  const list = x => (Array.isArray(x) ? x : String(x || '').split(',')).map(t => String(t).trim()).filter(Boolean).join(',');
  const qs = new URLSearchParams({ ...(who.cf ? { cf: who.cf } : { name: who.name }), months: f.months || 12,
    cats: list(f.cats?.length ? f.cats : i.profile?.soa || []), regions: list(i.profile?.regions || []) });
  const c = await get(`/api/crm/mercato/impresa?${qs}`);
  const box = (label, val) => h('div', h('small', label), h('b', val));
  const atiText = () => {
    const ati = c.kpi.vinte - c.kpi.sola;
    if (!ati) return `Vince sempre da sola (${c.kpi.vinte} ${c.kpi.vinte === 1 ? 'gara' : 'gare'}).`;
    return [`Da sola in ${c.kpi.sola} ${c.kpi.sola === 1 ? 'gara' : 'gare'}, in ATI in ${ati}`, c.partners.length ? ` con ${c.partners.map(p => `${nice(p.name)} (${p.n})`).join(', ')}` : '', '.'].join('');
  };
  const m = dlg(modal({
    drawer: true,
    title: h('div', h('div.en-eyebrow', `Scheda di mercato · ${c.scope.categories.join(' · ')} · ${c.scope.months} mesi`), h('h2', nice(c.name)),
      h('div.nb-small.muted', [c.province.join(', '), c.cf ? `C.F./P.IVA ${c.cf}` : '', `vince in ${c.categorie.join(', ')}`].filter(Boolean).join(' · '))),
    body: h('div.nb-form.nb-mco',
      h('div.nb-row', c.ours ? pill('Almacis', 's4') : rolePill(c.role), h('span.nb-small.muted', c.subject ? `nel CRM come «${c.subject.name}»` : c.ours ? 'è una nostra impresa' : 'non è ancora nel CRM')),
      h('div.nb-mkpi', box('Gare vinte', num(c.kpi.vinte)), box('Valore', meur(c.kpi.valore)), box('Ribasso medio', pct(c.kpi.ribasso)), box('Offerenti medi', c.kpi.offerenti ? num(c.kpi.offerenti) : '—')),
      h('div', h('div.nb-lbl.nb-mb8', 'Con chi va in ATI'), h('div.nb-small', atiText())),
      c.buyers.length ? h('div', h('div.nb-lbl.nb-mb8', 'Per quali stazioni appaltanti'), c.buyers.map(b => h('div.nb-mrow.tight', h('span', b.name), h('span.nb-small.muted', `${b.gare} ${b.gare === 1 ? 'gara' : 'gare'} · ${meur(b.valore)}`)))) : null,
      h('div', h('div.nb-lbl.nb-mb8', 'Ultime gare vinte'), h('div.nb-scroll', h('table.nb-mtbl.small', h('thead', h('tr', ['CIG', 'Oggetto', 'Data', 'Importo', 'Ribasso'].map((x, n) => h('th', { class: n >= 3 ? 'r' : '' }, x)))),
        h('tbody', c.tenders.map(t => h('tr.static', h('td.mono', t.cig), h('td', h('div', t.object || '—'), h('div.nb-small.muted', [t.sa_name, t.ati ? 'in ATI' : ''].filter(Boolean).join(' · '))), h('td', day(t.awarded_on)), h('td.r', eur(t.amount)), h('td.r', pct(t.discount)))))))),
      c.cf ? soaBox(c.cf, c.scope.categories) : null,
      c.hint ? h('div.nb-mhint', ic('lightbulb', 15), h('span', c.hint)) : null,
      h('button.fd-btn.fd-inline', { type: 'button', on: { click: () => openSources({ cats: c.scope.categories, regions: i.profile?.regions || [], months: c.scope.months, cf: c.cf }) } }, icon('info', { size: 15 }), 'Da dove vengono i dati')),
    left: [h('a.nb-btn.ghost', { href: '#/crm/concorrenza', on: { click: () => m.close() } }, 'Vedi in Concorrenza')],
    actions: c.ours ? [] : c.subject ? [btn('Apri nel CRM', () => { m.close(); location.hash = `#/crm/scheda/${c.subject.id}`; }, { primary: true })]
      : [btn('Come partner', () => add('partner')), btn('Aggiungi come concorrente', () => add('concorrente'), { primary: true, ico: 'plus' })],
  }), 'nb-panel');
  async function add(role) {
    const out = await post('/api/crm/concorrenza/scheda', { name: nice(c.name), cf: c.cf, role });
    toast(out.created ? `Aggiunta al CRM come ${role}` : `Era già nel CRM: segnata come ${role}`);
    m.close();
    onChange?.();
  }
}

// ── categorie SOA del profilo (riquadro laterale) ───────────────────────────────────────────────
export async function soaDialog(i, meta, done) {
  const all = meta.soaCategories || [];
  const classes = meta.soaClasses || [];
  const start = (i.profile?.soa || []).map(c => String(c).toUpperCase().replace(/\s+/g, ''));
  const chosen = new Map(start.map(c => [c, i.profile?.soa_classes?.[c] || '']));
  const loaded = new Set((await get(`/api/crm/business/${i.id}/mercato?months=12`).catch(() => ({ state: { loaded: [] } }))).state?.loaded || []);
  let q = '';
  const label = code => all.find(([k]) => k === code)?.[1] || '';
  const classSel = code => h('select.nb-mclass', { 'aria-label': `Classifica ${code}`, on: { change: e => { chosen.set(code, e.target.value); draw(); } } },
    h('option', { value: '' }, 'classifica: qualsiasi'), classes.map(([k, l]) => h('option', { value: k, selected: chosen.get(code) === k, title: l }, `classifica ${k}`)));
  const picked = h('div.nb-mpicked');
  const listEl = h('div.nb-msoa');
  const note = h('div');
  const toggle = code => { if (chosen.has(code)) chosen.delete(code); else chosen.set(code, ''); draw(); };
  const draw = () => {
    picked.replaceChildren(...(chosen.size ? [...chosen.keys()].map(code => h('span.nb-mpick', { class: loaded.has(code) ? '' : 'wait' }, h('b', code), h('span.nb-mpick-l', label(code)), classSel(code),
      h('button', { type: 'button', 'aria-label': `Togli ${code}`, on: { click: () => toggle(code) } }, ic('x', 12)))) : [h('span.nb-small.muted', 'Nessuna categoria scelta.')]));
    const norm = s => s.toLowerCase();
    const rows = all.filter(([k, l]) => !q || norm(`${k} ${l}`).includes(norm(q)));
    listEl.replaceChildren(h('div.nb-lbl.nb-msoa-h', 'Opere generali (OG1–OG13) · Opere specializzate (OS1–OS35)'),
      ...(rows.length ? rows.map(([k, l]) => h('label.nb-msoa-r', { class: chosen.has(k) ? 'on' : '' }, h('input', { type: 'checkbox', checked: chosen.has(k), on: { change: () => toggle(k) } }), h('b', k), h('span', l),
        chosen.has(k) ? classSel(k) : null)) : [h('div.nb-small.muted', 'Nessuna categoria con queste parole.')]));
    const fresh = [...chosen.keys()].filter(c => !loaded.has(c));
    note.replaceChildren(fresh.length ? h('div.nb-mhint', ic('hourglass', 15), h('span', h('b', listCats(fresh)), `: le sue gare le carico stanotte alle 5 (12 mesi da ANAC). Fino ad allora nella tab Mercato ${fresh.length === 1 ? 'la pillola resta tratteggiata' : 'le pillole restano tratteggiate'}, «in arrivo».`)) : '');
  };
  // l'assistente propone (solo su richiesta)
  const propBox = h('div.nb-mprop', h('div.nb-row-sb', h('span.nb-who', ic('sparkles', 15), h('b', 'L\'assistente propone')), btn('Proponi dalla descrizione', async e => {
    e.currentTarget.disabled = true;
    const r = await post(`/api/crm/business/${i.id}/soa/proponi`, {});
    propList.replaceChildren(...(r.proposals.length ? r.proposals.map(p => h('button.nb-mprop-p', { type: 'button', class: chosen.has(p.code) ? 'on' : '',
      on: { click: ev => { if (!chosen.has(p.code)) { chosen.set(p.code, ''); ev.currentTarget.classList.add('on'); draw(); } } } }, chosen.has(p.code) ? ic('check', 13) : ic('plus', 13), h('b', p.code), ` · ${p.why || p.label}`))
      : [h('span.nb-small.muted', 'Nessuna proposta: scegli dall\'elenco.')]));
  }, { small: true })), h('div.nb-small.muted', `dalla descrizione: «${String(i.description || i.profile?.description || '').slice(0, 90)}${String(i.description || '').length > 90 ? '…' : ''}»`));
  const propList = h('div.nb-mprop-l');
  propBox.append(propList);
  const search = h('label.nb-search.wide', ic('search'), h('input', { type: 'search', placeholder: 'Cerca per codice o nome: «elettric»', on: { input: e => { q = e.target.value.trim(); draw(); } } }));
  draw();
  const m = dlg(modal({
    drawer: true,
    title: h('div', h('div.en-eyebrow', 'Modifica l\'iniziativa · profilo per radar e mercato'), h('h2', 'Categorie SOA'), h('div.nb-small.muted', `${i.name} · servono al Radar e alla tab Mercato`)),
    body: h('div.nb-form', propBox, h('div', h('div.nb-lbl.nb-mb8', 'Scelte'), picked), search, listEl, note,
      h('div', h('div.nb-lbl.nb-mb8', 'Classifica (facoltativa)'), h('div.nb-small.muted', `${classes.map(([k, l]) => `${k} ${l.replace('fino a ', '')}`).join(' · ')}. Serve a ricordare fino a che importo si può partecipare.`))),
    left: [btn('Annulla', () => m.close(), { ghost: true })],
    actions: [btn('Salva categorie', async () => {
      const r = await put(`/api/crm/business/${i.id}/soa`, { soa: [...chosen.keys()], classes: Object.fromEntries([...chosen].filter(([, c]) => c)) });
      m.close();
      toast(r.missing?.length ? `Salvate. ${listCats(r.missing)}: le gare arrivano stanotte` : 'Categorie salvate');
      done?.();
    }, { primary: true })],
  }), 'nb-panel');
}

// ── card «Mercato» dell'Analisi ───────────────────────────────────────────────────────────────
export function marketCard(i, mk, go, meta, refresh) {
  const head = h('div.nb-card-h', h('h3', 'Mercato'));
  const foot = h('div.nb-mfoot', h('button.nb-link', { type: 'button', on: { click: () => go('mercato') } }, 'Apri il mercato', ic('chevron-right', 13)));
  if (!mk || !mk.state?.loaded?.length) {
    const cats = (i.profile?.soa || []);
    return h('section.nb-card.nb-acard', head,
      h('div.nb-small.muted.grow', cats.length ? `Le gare ${cats.join(' e ')} arrivano con il caricamento ANAC della notte: domattina qui trovi la dimensione del mercato e chi vince.` : 'Scegli le categorie SOA dell\'iniziativa per vedere quanto vale il mercato e chi vince.'),
      i.canEdit && !cats.length ? h('div.nb-mt12', h('button.nb-link', { type: 'button', on: { click: () => soaDialog(i, meta, refresh) } }, ic('plus', 14), 'Scegli le categorie')) : null, foot);
  }
  const k = mk.kpi;
  return h('section.nb-card.nb-acard', head,
    h('div.nb-abig', h('b', meur(k.valore)), h('span', `in ${num(k.gare)} gare · 12 mesi`)),
    h('div.nb-abox', h('div', h('small', 'ribasso tipico'), h('b', pct(k.ribasso))), h('div', h('small', 'offerenti per gara'), h('b', k.offerenti ? num(k.offerenti) : '—'))),
    h('div.nb-lbl.nb-mt16', 'Chi vince di più'),
    h('div.nb-atop', mk.top.map((w, n) => h('div.nb-mrow.tight', h('span.nb-who', h('span.nb-rank', String(n + 1)), h('span.nb-t', nice(w.name))), h('span.nb-who', rolePill(w.role), h('span.nb-small.muted', `${w.vinte} gare`))))),
    foot);
}
