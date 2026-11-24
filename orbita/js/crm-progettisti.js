// Progettisti (ALM2-70, tavola O del canvas approvata da Dante il 23/11/2026): chi progetta le opere degli enti, dagli
// incarichi di architettura e ingegneria di ANAC. Sezione di «Concorrenza e gare», scheda del progettista a cassetto,
// «Chi l'ha progettata» nella gara/segnale del Radar e «I suoi progettisti» nella scheda dell'ente.
import { h, fill, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { ic, dots, pill, emptyState, cvModal } from './crm-v2.js';
import { nice } from './crm-concorrenza.js';

const it1 = n => Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const eur = n => (!n ? '—' : n >= 1e6 ? `${it1(n / 1e6)} M€` : n >= 1e4 ? `${Math.round(n / 1e3).toLocaleString('it-IT')} k€` : `${Math.round(n).toLocaleString('it-IT')} €`);
const num = n => Number(n || 0).toLocaleString('it-IT');
const mese = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { month: '2-digit', year: 'numeric' }) : '');
const enc = encodeURIComponent;
const SORTS = [['incarichi', 'Incarichi'], ['valore', 'Valore'], ['enti', 'Enti diversi']];

// «nel CRM» oppure «Aggiungi al CRM» (come progettista)
async function toCrm(p) {
  const r = await post('/api/crm/progettisti/crm', { cf: p.cf, name: nice(p.name) });
  toast(r.created ? `${nice(p.name)} è nel CRM come progettista` : `${nice(p.name)} era già nel CRM: segnato come progettista`);
  return r;
}
function crmBadge(p, onDone) {
  if (p.subject) return h('a.pg-crm.in', { href: `#/crm/scheda/${p.subject.id}`, on: { click: e => e.stopPropagation() } }, ic('check', 12), 'nel CRM');
  return h('button.pg-crm', { type: 'button', on: { click: async e => { e.stopPropagation(); e.currentTarget.disabled = true; await toCrm(p); onDone?.(); } } }, ic('plus', 12), 'Aggiungi al CRM');
}

// ── sezione «Progettisti» (tavola O + tavola P di ALM2-80: area, committente, podio, mappa di calore) ──────────────
const initials = name => nice(name).replace(/^(ing|arch|geom|dott|studio|rtp)\.?\s+/i, '').split(/\s+/).filter(w => /^[A-Za-zÀ-ÿ]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
const AV_TONES = ['or', 'pe', 'bl', 'gy'];
// linea degli incarichi per trimestre (8 trimestri = 24 mesi)
function spark(serie, { w = 110, hgt = 34, up = true } = {}) {
  const max = Math.max(1, ...serie);
  const pts = serie.map((v, i) => [Math.round((i * w) / (serie.length - 1)), Math.round(hgt - 3 - ((hgt - 6) * v) / max)]);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', hgt); svg.setAttribute('viewBox', `-4 0 ${w + 8} ${hgt}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Incarichi per trimestre: ${serie.join(', ')}`);
  svg.classList.add('pg-spark', up ? 'up' : 'down');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.map(p => p.join(',')).join(' '));
  const dot = document.createElementNS(ns, 'circle');
  const [lx, ly] = pts[pts.length - 1];
  dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', 3);
  svg.append(line, dot);
  return svg;
}
// parametri iniziali dall'indirizzo: #/crm/concorrenza/progettisti?bu=impianti&sa=00347000721
function hashParams() {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}
// ricerca del committente: campo con i suggerimenti degli enti (nome, sigla o codice fiscale)
function enteSearch({ ente, onPick, onClear, placeholder, dark = false }) {
  const inp = h('input', { type: 'search', placeholder: ente ? 'cambia ente: nome, sigla o codice fiscale' : placeholder, 'aria-label': 'Committente: nome, sigla o codice fiscale' });
  const found = h('div.cg-found', { hidden: true });
  inp.addEventListener('input', debounce(async () => {
    const q = inp.value.trim();
    if (q.length < 2) { found.hidden = true; return; }
    const r = await get(`/api/crm/progettisti/enti?q=${enc(q)}`, { quiet: true }).catch(() => ({ enti: [] }));
    fill(found, r.enti.length ? r.enti.map(e => h('button.cg-fr', { type: 'button', on: { click: () => { found.hidden = true; inp.value = ''; onPick(e); } } },
      h('span.cg-fr-ic', ic('landmark', 14)), h('span.cv-grow', h('b', nice(e.name)), h('small', dots([e.region, `${num(e.incarichi)} incarichi`, `${num(e.progettisti)} progettisti`]))), ic('chevron-right', 14)))
      : h('p.cg-none', 'Nessun ente con incarichi di progettazione per questa ricerca. Prova con un\'altra parola del nome.'));
    found.hidden = false;
  }, 250));
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') found.hidden = true; });
  return h('div.pg-ente-q', { class: dark ? 'dark' : '' }, ic('landmark', 17), h('span.pg-ente-l', 'Committente'),
    ente ? h('span.pg-ente-chip', nice(ente.name), h('button', { type: 'button', 'aria-label': 'Togli il committente', on: { click: onClear } }, ic('x', 13))) : null,
    inp, ente?.incarichi != null ? h('span.pg-ente-n', `${num(ente.incarichi)} incarichi`) : null, found);
}

export async function progettistiSection(box, { st, tabs, again, bu: fixedBu } = {}) {
  fill(box, loading());
  if (!st.pg) {
    const p = hashParams();
    st.pg = { sort: 'incarichi', type: '', q: '', italia: false, bu: p.get('bu') ?? null, sa: p.get('sa') || '', ente: null };
    if (p.get('sa')) st.pg.italia = true; // un ente scelto da fuori: tutta Italia, l'ente è già il filtro
  }
  const f = st.pg;
  const hp = hashParams();
  if (hp.has('sa') || hp.has('bu')) { // arrivo da un link (scheda dell'ente, Anagrafiche): ente e area dell'indirizzo, poi si toglie
    if (hp.has('sa')) { f.sa = hp.get('sa'); f.italia = true; }
    if (hp.has('bu')) f.bu = hp.get('bu');
    history.replaceState(null, '', location.hash.split('?')[0]);
  }
  if (fixedBu) f.bu = fixedBu;
  const qs = new URLSearchParams({ months: st.months, sort: f.sort, ...(f.type ? { type: f.type } : {}), ...(f.q ? { q: f.q } : {}), ...(f.italia || f.sa ? { regions: 'tutte' } : {}),
    ...(f.bu ? { bu: f.bu } : {}), ...(f.sa ? { sa: f.sa } : {}) });
  const r = await get(`/api/crm/progettisti?${qs}`);
  if (f.bu === null) { f.bu = r.my_bus[0] || ''; if (f.bu) return progettistiSection(box, { st, tabs, again, bu: fixedBu }); } // parte dalla tua area
  const k = r.kpi;
  const reload = () => again();
  const label = key => (key === 'nessuna' ? 'Senza area' : r.area_labels.find(a => a.key === key)?.label || key);
  const enteName = r.ente ? nice(r.ente.name) : '';
  const shortEnte = enteName.length > 28 ? `${enteName.slice(0, 26)}…` : enteName;

  // ── testata ──
  const admin = r.admin ? h('button.cg-ghost', { type: 'button', disabled: r.data.running || undefined, on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/concorrenza/aggiorna', {}); toast('Aggiornamento dai dati ANAC avviato: i progettisti arrivano dopo le gare'); } } },
    ic('refresh-cw', 13), r.data.running ? 'Aggiornamento…' : 'Aggiorna da ANAC') : null;
  const months = h('select.pg-dark-sel', { 'aria-label': 'Periodo' }, [['24', 'Ultimi 24 mesi'], ['12', 'Ultimi 12 mesi']].map(([v, l]) => h('option', { value: v, selected: String(st.months) === v }, l)));
  months.addEventListener('change', () => { st.months = Number(months.value); reload(); });
  const zone = r.zone.length ? r.zone.join(', ') : 'Tutta Italia';
  const areaBtns = [['', 'Tutte le aree'], ...r.area_labels.map(a => [a.key, a.label]), ['nessuna', 'Senza area']]
    .filter(([key]) => !fixedBu || key === fixedBu)
    .map(([key, l]) => h('button.pg-area', { type: 'button', class: (f.bu || '') === key ? 'on' : '', 'aria-pressed': String((f.bu || '') === key),
      on: { click: () => { f.bu = key; reload(); } } }, l, h('em', num(key ? r.aree[key] || 0 : r.aree.tutte || 0))));
  const tot = r.quota.total || 0;
  const pct = n => (tot ? Math.round((100 * n) / tot) : 0);
  const restN = tot - r.quota.top.reduce((a, x) => a + x.n, 0);
  const quota = tot && r.quota.top.length > 1 ? h('div.pg-quota',
    h('div.pg-quota-t', h('span.cg-kicker', ic('bar-chart-3', 12), `Chi si prende gli incarichi${r.ente ? ` di ${shortEnte}` : ''}${f.bu ? ` · ${label(f.bu)}` : ''}`), h('span.cv-grow'),
      h('span.pg-quota-s', 'i primi ', String(r.quota.top.length), ' hanno il ', h('b', `${pct(tot - restN)}%`))),
    h('div.pg-quota-bar', r.quota.top.map((p, i) => h('button', { type: 'button', class: `q${i + 1}`, style: { flexGrow: String(p.n) }, title: `${nice(p.name)}: ${p.n} incarichi (${pct(p.n)}%)`,
      on: { click: () => openProgettista(p.key, { onChange: reload }) } }, h('span', `${nice(p.name).split(' ').slice(0, 2).join(' ')} ${pct(p.n)}%`))),
    restN > 0 ? h('span.rest', { style: { flexGrow: String(restN) } }, `altri ${num(r.quota.altri)} · ${pct(restN)}%`) : null)) : null;
  const kpi = (l, v, s, c = '') => h('div.pg-k', { class: c }, h('span', l), h('b', v), h('small', s));
  const hero = h('section.cg-hero.pg-hero',
    h('div.cg-top', h('div.cv-grow',
      h('div.cg-kicker', ic('pencil-ruler', 12), r.data.incarichi ? `Fonte ANAC${r.data.at ? ` · aggiornato al ${fmtDate(String(r.data.at).slice(0, 10))}` : ''} · ${num(r.data.incarichi)} incarichi` : 'Dati ANAC dei progettisti non ancora caricati'),
      r.ente ? h('h1.cg-h1', 'Chi vince per ', h('b.pg-or', shortEnte)) : h('h1.cg-h1', 'Chi ', h('b', 'progetta'), ' le opere'),
      h('p.cg-sub', r.ente ? dots([r.ente.region, `incarichi di progettazione e direzione lavori negli ultimi ${st.months} mesi`]) : `Incarichi di progettazione e direzione lavori (servizi di architettura e ingegneria) negli ultimi ${st.months} mesi, collegati alle gare dei lavori con il CUP.`)),
      h('div.pg-top-r', months, admin)),
    enteSearch({ ente: r.ente ? { ...r.ente, incarichi: k.incarichi } : null, placeholder: 'Per quale ente vincono? Nome, sigla (AQP, ANAS…) o codice fiscale',
      onPick: e => { f.sa = e.cf; reload(); }, onClear: () => { f.sa = ''; reload(); } }),
    h('div.pg-areas', { role: 'group', 'aria-label': 'Area' }, areaBtns,
      r.zone.length && !f.sa ? h('span.pg-zone', h('button.pg-z', { type: 'button', class: f.italia ? '' : 'on', 'aria-pressed': String(!f.italia), on: { click: () => { f.italia = false; reload(); } } }, zone),
        h('button.pg-z', { type: 'button', class: f.italia ? 'on' : '', 'aria-pressed': String(f.italia), on: { click: () => { f.italia = true; reload(); } } }, 'Tutta Italia')) : null),
    quota,
    h('div.pg-kpis',
      kpi('Incarichi', num(k.incarichi), `${eur(k.valore)} di onorari`),
      kpi('Progettisti', num(k.progettisti), k.nel_crm != null ? `${num(k.nel_crm)} già nel nostro CRM` : 'studi e professionisti'),
      kpi('Opere già in gara', num(k.in_gara), 'progettate e poi bandite (stesso CUP)'),
      kpi('Lavori da bandire', num(k.da_bandire), k.da_contattare ? `${num(k.da_contattare)} progettisti di opere nel nostro Radar` : 'i progettisti da chiamare adesso', 'or')));

  // ── filtri della classifica ──
  const search = h('input', { type: 'search', value: f.q, placeholder: 'Cerca un progettista per nome o codice fiscale', 'aria-label': 'Cerca un progettista' });
  search.addEventListener('input', debounce(() => { f.q = search.value.trim(); reload(); }, 400));
  const typeSel = h('select.cg-sel', { 'aria-label': 'Tipo d\'incarico', class: f.type ? 'on' : '' }, [['', 'Incarico: tutti'], ...r.types.map(t => [t, `Incarico: ${t}`])].map(([v, l]) => h('option', { value: v, selected: v === f.type }, l)));
  typeSel.addEventListener('change', () => { f.type = typeSel.value; reload(); });
  const SORTS2 = [...SORTS, ['crescita', 'In crescita']];
  const filters = h('div.cg-filters', h('div.pg-find', ic('search', 14), search), typeSel, h('span.cv-grow'), h('span.pg-lbl', 'Ordina per'),
    h('div.pg-seg', SORTS2.map(([v, l]) => h('button', { type: 'button', class: f.sort === v ? 'on' : '', 'aria-pressed': String(f.sort === v), on: { click: () => { f.sort = v; reload(); } } }, l))));

  let body;
  if (!r.data.incarichi) body = [h('section.pv-card', emptyState('pencil-ruler', r.data.running ? 'Sto caricando gli incarichi di progettazione da ANAC: ci vuole qualche minuto.' : 'Gli incarichi di progettazione si caricano da soli dopo i dati ANAC della notte; la direzione può avviarli subito con «Aggiorna da ANAC».'))];
  else if (!r.progettisti.length) body = [h('section.pv-card', emptyState('search', f.q ? 'Nessun progettista con questo nome con questi filtri.' : f.sa ? 'Nessun incarico di questo ente con questi filtri: prova «Tutte le aree».' : 'Nessun incarico con questi filtri: prova «Tutta Italia», «Tutte le aree» o un altro tipo d\'incarico.'))];
  else {
    const con = r.ente ? ` con ${shortEnte}` : '';
    // podio: i primi tre (senza ricerca per nome)
    const podio = !f.q && r.progettisti.length >= 2 ? r.progettisti.slice(0, 3) : [];
    const podCard = (p, i) => {
      const first = i === 0;
      const up = p.trend >= 0;
      return h('article.pg-pod', { class: first ? 'first' : '', tabIndex: 0, role: 'button', 'aria-label': `${i + 1}°: ${nice(p.name)}`,
        on: { click: () => openProgettista(p.key, { onChange: reload }), keydown: e => { if (e.key === 'Enter') openProgettista(p.key, { onChange: reload }); } } },
        first ? h('span.pg-pod-badge', r.ente ? `N. 1 per ${shortEnte}` : f.bu ? `N. 1 in ${label(f.bu)}` : 'N. 1') : null,
        h('div.pg-pod-top', h('span.pg-ini', { class: first ? 'or' : AV_TONES[i % AV_TONES.length] }, initials(p.name)),
          h('div.cv-grow', h('b', nice(p.name)), h('small', dots([p.regioni.filter(x => x !== '—')[0], p.tipi[0], p.rtp ? 'in RTP' : '']))), h('span.pg-rank', String(i + 1))),
        h('div.pg-pod-n', h('div', h('b', String(p.incarichi)), h('small', ` incarichi${con} · ${eur(p.valore)}`)), h('span.cv-grow'), spark(p.serie, { w: first ? 140 : 110, hgt: first ? 44 : 34, up })),
        p.tutti ? h('div.pg-pod-x', `${num(p.tutti.incarichi)} incarichi su ${num(p.tutti.enti)} enti in tutto`) : null,
        first ? h('div.pg-pod-boxes',
          h('div', h('small', p.conosce?.us ? `${p.conosce.us.name} lo conosce` : 'Chi di noi lo conosce'), h('b', p.conosce?.us ? dots([p.conosce.emails ? `${p.conosce.emails} email` : '', p.conosce.meetings ? `${p.conosce.meetings} incontri` : '']) || 'rapporto ' + (p.conosce.level || 'debole') : p.subject ? 'nessuno, per ora' : 'aggiungilo al CRM')),
          h('div', h('small', 'Ha in mano'), h('b.pg-or', p.da_bandire ? `${p.da_bandire} ${p.da_bandire === 1 ? 'opera' : 'opere'} da bandire` : p.in_gara ? `${p.in_gara} opere già in gara` : '—')))
          : h('div.pg-pod-x', p.imprese.length ? ['Le sue opere le vince ', h('b', nice(p.imprese[0].name)), ` (${p.imprese[0].n})`] : p.da_bandire ? `${p.da_bandire} opere ancora da bandire` : (p.enti[0] ? ['Lavora soprattutto per ', h('b', nice(p.enti[0].name))] : '')),
        h('div.pg-pod-act', first && p.conosce?.us?.id && p.subject ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => { e.stopPropagation(); e.currentTarget.disabled = true; await post('/api/crm/progettisti/presentaci', { subject_id: p.subject.id, user_id: p.conosce.us.id }); toast(`Chiesto a ${p.conosce.us.name} di presentarci: è nei suoi passi della settimana`); } } }, `Chiedi a ${String(p.conosce.us.name).split(' ')[0]} di presentarci`) : null,
          crmBadge(p, reload)));
    };
    const podium = podio.length ? [h('div.pg-sh', h('h2', 'Il podio'), h('span', r.ente ? `chi vince di più con ${shortEnte}, e come sta andando` : 'chi vince di più, e come sta andando')),
      h('div.pg-podium', { class: `n${podio.length}` }, podio.length === 3 ? [podCard(podio[1], 1), podCard(podio[0], 0), podCard(podio[2], 2)] : podio.map(podCard))] : [];
    // mappa di calore progettista × area
    const aree = r.area_labels.filter(a => Object.values(r.heat.leaders).length && (r.aree[a.key] || 0) > 0);
    const maxCell = Math.max(1, ...r.heat.rows.flatMap(x => aree.map(a => x.by[a.key] || 0)));
    const lvl = n => (!n ? 0 : Math.min(5, Math.ceil((5 * n) / maxCell)));
    const heat = !f.q && aree.length >= 2 && r.heat.rows.length >= 2 ? h('section.cv-card.pg-heat',
      h('div.pg-sh', h('h2', 'Chi domina ogni area'), h('span', `incarichi${con} per area · clic su un'area per la sua classifica`), h('span.cv-grow'),
        h('span.pg-legend', 'meno', [1, 2, 3, 4, 5].map(i => h('i', { class: `c${i}` })), 'più')),
      h('div.pg-heat-scroll', h('table.pg-hm',
        h('thead', h('tr', h('th.l', 'Progettista'), aree.map(a => h('th', h('button', { type: 'button', class: f.bu === a.key ? 'on' : '', on: { click: () => { f.bu = a.key; reload(); } } }, a.label))), h('th', 'Totale'))),
        h('tbody',
          r.heat.rows.map(x => h('tr', h('td.l', h('button.pg-link', { type: 'button', on: { click: () => openProgettista(x.key, { onChange: reload }) } }, nice(x.name))),
            aree.map(a => h('td', { class: `c${lvl(x.by[a.key] || 0)}` }, String(x.by[a.key] || 0))), h('td.tot', String(x.tot)))),
          h('tr.lead', h('td.l', 'Il n. 1 di ogni area'), aree.map(a => { const l = r.heat.leaders[a.key]; return h('td', { class: l ? 'on' : '' }, l ? nice(l.name).split(' ').slice(0, 2).join(' ') : '—'); }), h('td'))))) ) : null;
    // il resto della classifica
    const rest = r.progettisti.slice(podio.length);
    const head = h('div.pg-head', ['#', 'Progettista', r.ente ? 'Con l\'ente' : 'Incarichi', 'Valore', 'Enti principali', 'Andamento', ''].map(t => h('span', t)));
    const rows = rest.map((p, i) => h('div.pg-row', { role: 'button', tabIndex: 0,
      on: { click: () => openProgettista(p.key, { onChange: reload }), keydown: e => { if (e.key === 'Enter') openProgettista(p.key, { onChange: reload }); } } },
      h('span.cg-n', String(i + 1 + podio.length)),
      h('div.cg-name', h('b', nice(p.name)), h('small', dots([p.regioni.filter(x => x !== '—').join(', '), p.aree.map(label).join(', ') || p.tipi.join(', '), p.rtp ? `${p.rtp} in RTP` : '']))),
      h('div.pg-num', h('b', String(p.incarichi)), p.tutti ? h('small', `${p.tutti.incarichi} in tutto`) : p.enti_n > 1 ? h('small', `${p.enti_n} enti`) : null),
      h('span.cg-val', eur(p.valore)),
      h('div.pg-enti', p.enti.map(e => h('span', h('em', nice(e.name)), ` · ${e.n}`))),
      h('div', spark(p.serie, { w: 90, hgt: 26, up: p.trend >= 0 })),
      crmBadge(p, reload)));
    body = [...podium, heat,
      rest.length ? h('section.cg-list', head, rows, h('div.cg-foot', `${r.progettisti.length} di ${num(r.total)} progettisti · RTP contati per tutti i componenti; nomi uniti per codice fiscale. L'area viene dalla gara dei lavori collegata col CUP o, senza, dalle parole dell'oggetto.`)) : null];
  }
  fill(box, h('div.cg', hero, tabs, filters, ...body,
    h('p.cv-hint', 'Il nome del singolo ingegnere dentro uno studio o un RTP ANAC non lo dà: aggiungilo nel CRM come contatto dello studio. Fonte: ANAC, dati aperti (CC BY-SA 4.0).')));
}

// Da montare in un'altra pagina (es. Alma Energy / Alma Impianti, ALM2-83): la stessa vista con l'area già scelta,
// senza le schede di «Concorrenza e gare». opts: { bu, sa, months }
export function progettistiView(box, { bu = '', sa = '', months = 24 } = {}) {
  const st = { months, pg: { sort: 'incarichi', type: '', q: '', italia: true, bu, sa, ente: null } };
  const again = () => progettistiSection(box, { st, tabs: null, again, bu });
  return again();
}


// ── scheda del progettista (cassetto) ──────────────────────────────────────────────────────────────
export async function openProgettista(key, { onChange } = {}) {
  const body = h('div.pg-dr', loading());
  const m = cvModal({ title: 'Progettista', body, drawer: true, size: 'lg', onClose: () => onChange?.() });
  const draw = async () => {
    let d;
    try { d = await get(`/api/crm/progettisti/scheda/${enc(key)}`); } catch (err) { fill(body, emptyState('pencil-ruler', err.message || 'Scheda non disponibile')); return; }
    const head = h('div.pg-dr-top',
      h('span.pg-av', ic('pencil-ruler', 18)),
      h('div.cv-grow', h('h3', nice(d.name)), h('small', dots([d.cf ? `C.F. ${d.cf}` : '', d.tipi.join(', '), d.subject ? 'nel CRM come progettista' : '']))),
      d.subject ? h('a.btn.btn-sm', { href: `#/crm/scheda/${d.subject.id}`, on: { click: () => m.close() } }, 'Apri la scheda')
        : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await toCrm(d); draw(); } } }, ic('plus', 14), 'Aggiungi al CRM'));
    const nums = h('div.pg-nums', [['Incarichi', num(d.incarichi)], ['Onorari', eur(d.valore)], ['Opere già in gara', num(d.in_gara)], ['Da bandire', num(d.da_bandire)]].map(([l, v]) => h('div', h('b', v), h('small', l))));
    const max = Math.max(1, ...d.enti.map(e => e.n));
    const enti = h('section.pg-sec', h('div.pg-lbl', 'Per quali enti lavora'),
      d.enti.map(e => h('div.pg-bar', h('span.cv-ell', nice(e.name)), h('i', h('span', { style: { width: `${(100 * e.n) / max}%` } })), h('b', String(e.n)))));
    const opere = h('section.pg-sec', h('div.pg-lbl', 'Opere progettate · cosa è successo dopo'),
      d.opere.map(o => h('div.pg-op',
        h('div.cv-grow', h('b', nice(o.object)), h('small', dots([nice(o.sa_name), `${o.tipo} ${mese(o.awarded_on)}`, eur(o.amount), o.rtp ? 'in RTP' : '']))),
        o.dopo?.stato === 'aggiudicata' ? h('span.pg-after.ok', ic('trophy', 12), `gara lavori a ${nice(o.dopo.impresa?.name || '—')}, ${eur(o.dopo.amount)}`)
          : o.dopo?.stato === 'da_bandire' ? h(o.dopo.signal_id ? 'button.pg-after.or' : 'span.pg-after.or', o.dopo.signal_id ? { type: 'button', on: { click: async () => { m.close(); (await import('./crm-radar.js')).openSignal(o.dopo.signal_id, null, null); } } } : {},
            ic('hourglass', 12), `lavori non ancora banditi${o.dopo.amount ? ` · stima ${eur(o.dopo.amount)}` : ''}${o.dopo.signal_id ? ' · Prima del bando ›' : ''}`)
            : o.cup ? h('span.pg-after', `CUP ${o.cup}`) : null)));
    const who = (list, label) => (list.length ? h('section.pg-sec', h('div.pg-lbl', label), h('div.pg-chips', list.map(x => h('span.pg-chip', nice(x.name), h('em', ` · ${x.n}`), x.subject ? h('a', { href: `#/crm/scheda/${x.subject.id}`, on: { click: () => m.close() } }, ' nel CRM') : null)))) : null);
    const conosce = h('section.pg-sec', h('div.pg-lbl', 'Chi di noi lo conosce'),
      d.conosce.length ? d.conosce.map(c => h('div.pg-know', h('span.pg-av.sm', ic('user', 14)),
        h('div.cv-grow', h('b', c.us?.name || '—'), h('small', dots([c.name ? `conosce ${c.name}` : '', c.emails ? `${c.emails} email` : '', c.meetings ? `${c.meetings} incontri` : '', c.last_at ? `ultimo ${fmtDate(String(c.last_at).slice(0, 10))}` : '']))),
        d.subject && c.us?.id ? h('button.btn.btn-sm', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/progettisti/presentaci', { subject_id: d.subject.id, user_id: c.us.id }); toast(`Chiesto a ${c.us.name} di presentarci: è nei suoi passi della settimana`); } } }, `Chiedi a ${String(c.us.name).split(' ')[0]} di presentarci`) : null))
        : h('p.pv-muted', d.subject ? 'Nessuno di noi ha ancora email o incontri con questo progettista.' : 'Aggiungilo al CRM: vediamo chi di noi lo conosce dalle email e dagli incontri.'));
    fill(body, head, nums, enti, opere, who(d.imprese, 'Imprese che vincono le opere che progetta'), who(d.soci, 'Con chi lavora in RTP'), conosce,
      h('p.cv-hint', 'Il singolo ingegnere di uno studio o di un RTP non è nei dati ANAC: aggiungilo come contatto dello studio.'));
  };
  draw();
  return m;
}

// ── «Chi l'ha progettata» nel riquadro della gara o del segnale ────────────────────────────────────
export function garaProgettisti(signalId) {
  const box = h('div');
  get(`/api/crm/progettisti/gara?signal_id=${signalId}`, { quiet: true }).then(r => {
    if (!r.progettisti.length) return;
    const line = p => h('div.pg-gara-r', h('span.pg-av.sm', ic('pencil-ruler', 14)),
      h('div.cv-grow', h('b', nice(p.name)),
        h('small', r.how === 'cup' ? dots([`${p.incarico.tipo} ${mese(p.incarico.awarded_on)}`, eur(p.incarico.amount), `${p.incarichi} incarichi in 24 mesi`, p.con_ente > 1 ? `${p.con_ente} con ${nice(p.ente)}` : '', p.conosce[0]?.us ? `${String(p.conosce[0].us.name).split(' ')[0]} lo conosce` : ''])
          : dots([`${p.n} incarichi con questo ente`, eur(p.valore)]))),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => openProgettista(p.key) } }, r.how === 'cup' ? 'Contatta' : 'Apri'));
    fill(box, h('section.cv-box.pg-gara',
      h('div.cv-row', h('div.cv-lbl.cv-grow.cv-row', { style: { gap: '6px' } }, ic('pencil-ruler', 14), r.how === 'cup' ? 'Chi l\'ha progettata' : 'Progettisti più forti con questo ente'),
        h('span.cv-small.cv-muted', r.how === 'cup' ? 'ANAC · stesso CUP' : `ANAC · ${r.incarichi} incarichi dell'ente`)),
      r.progettisti.map(line)));
  }).catch(() => {});
  return box;
}

// ── «I suoi progettisti» nella scheda dell'ente; «Incarichi da ANAC» nella scheda del progettista ───────────────
export function enteProgettistiCard(s) {
  const box = h('div');
  get(`/api/crm/progettisti/ente/${s.id}`, { quiet: true }).then(r => {
    if (!r.progettisti.length) return;
    const again = () => fill(box, enteProgettistiCard(s));
    const cf = String(s.tax_code || s.vat || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, '');
    fill(box, h('section.cv-card.pad.pg-ente',
      h('div.cv-row', h('div.cv-grow', h('div.cv-lbl', 'I suoi progettisti'), h('div.cv-small.cv-muted', `${r.incarichi} incarichi di progettazione in 24 mesi · ANAC`)),
        cf ? h('a.pg-link', { href: `#/crm/concorrenza/progettisti?sa=${enc(cf)}` }, 'Tutti ›') : null), // ALM2-80: classifica per questo ente
      r.progettisti.map((p, i) => h('div.pg-ente-r', h('span.cg-n', `${i + 1}.`),
        h('button.pg-link', { type: 'button', on: { click: () => openProgettista(p.key) } }, nice(p.name)), h('span.pv-muted', ` · ${p.n}`), h('span.cv-grow'), crmBadge(p, again)))));
  }).catch(() => {});
  return box;
}
export function progettistaCard(s) {
  const cf = String(s.tax_code || s.vat || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, '');
  const box = h('div');
  if (!cf) return box;
  get(`/api/crm/progettisti/scheda/${enc(cf)}`, { quiet: true }).then(d => {
    fill(box, h('section.cv-card.pad.pg-ente',
      h('div.cv-row', h('div.cv-lbl.cv-grow', 'Incarichi da ANAC'), h('button.pg-link', { type: 'button', on: { click: () => openProgettista(d.key) } }, 'Tutto ›')),
      h('div.pg-nums', [['Incarichi', num(d.incarichi)], ['Onorari', eur(d.valore)], ['Enti', num(d.enti.length)], ['Opere in gara', num(d.in_gara)]].map(([l, v]) => h('div', h('b', v), h('small', l)))),
      d.enti.slice(0, 3).map(e => h('div.pg-ente-r', h('span', nice(e.name)), h('span.cv-grow'), h('span.pv-muted', `${e.n} incarichi`)))));
  }).catch(() => {});
  return box;
}

// ── Il progettista di un'opportunità (ALM2-76, canvas «Radar · dalla progettazione ai lavori», tavola 4) ─────────────
// In cima alla scheda del progettista, a tutta larghezza: perché ci interessa (l'opera che progetta) e il raggruppamento;
// i dati trovati su internet da spuntare e le persone da conoscere; chi lo conosce in Almacis e il prossimo passo.
export function progettistaOpportunita(s, refresh) {
  const box = h('div');
  get(`/api/crm/progettisti/opportunita/${s.id}`, { quiet: true }).then(r => {
    const g = r.opportunita[0];
    if (!g) return;
    const d = g.designer || {};
    const draw = () => {
      const col = (...x) => h('section.cv-card.pad.pg-why', ...x);
      const lbl = t => h('div.cv-lbl', t);
      const why = col(lbl('Perché ci interessa'),
        h('div', 'Progetta ', h('a', { href: '#/crm/radar' }, g.title), ' · ', dots([g.amount ? `intervento ${eur(g.amount)}` : '', g.expected_on ? `gara attesa ${fmtDate(String(g.expected_on).slice(0, 10))}` : 'gara dei lavori attesa: da capire'])),
        r.opportunita.length > 1 ? h('div.cv-small.cv-muted', `e altre ${r.opportunita.length - 1} opportunità`) : null,
        lbl('Il raggruppamento'),
        (d.team || []).map(w => h('div.pg-row', w.subject_id === s.id ? h('span', h('b', w.name)) : h('span', h('a', { href: `#/crm/scheda/${w.subject_id}` }, w.name)), h('span.cv-small.cv-muted', w.role || 'studio'))),
        h('div.cv-small.cv-muted', d.confirmed ? `Da ANAC${d.awarded_on ? `, aggiudicata il ${fmtDate(String(d.awarded_on).slice(0, 10))}` : ''}.` : 'Dal web: da confermare con ANAC.'));
      // dati da internet: si spuntano e si salvano come «da internet» (come «Cerca su internet»)
      const fields = (d.web?.fields || []).filter(f => !f.saved);
      const checks = fields.map(f => ({ f, inp: h('input', { type: 'checkbox', checked: !f.current }) }));
      const web = fields.length ? [h('div.cv-row', h('div.cv-lbl.cv-grow', 'Dati trovati su internet'), pill('da confermare', 'or')),
        checks.map(({ f, inp }) => h('label.pg-row', inp, h('span', h('span.cv-small.cv-muted', f.label), h('br'), f.value, f.current ? h('span.cv-small.cv-muted', ` (ora: ${f.current})`) : null))),
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => {
          const pick = checks.filter(c => c.inp.checked);
          if (!pick.length) return toast('Spunta almeno un dato', 'err');
          e.currentTarget.disabled = true;
          await post(`/api/crm/subjects/${s.id}/da-web`, { fields: Object.fromEntries(pick.map(c => [c.f.key, c.f.value])), sources: Object.fromEntries(pick.map(c => [c.f.key, c.f.source])) });
          toast('Dati salvati: restano «da internet» finché non li confermi'); refresh?.();
        } } }, 'Salva i dati spuntati')] : [lbl('Dati trovati su internet'), h('div.cv-small.cv-muted', 'Niente di nuovo: usa «Cerca su internet» nell\'anagrafica.')];
      const people = (d.people || []).map((p, n) => ({ ...p, n }));
      const ppl = col(...web, lbl('Persone da conoscere'),
        people.length ? people.map(p => h('div.pg-row', h('span', h('b', p.name), h('br'), h('span.cv-small.cv-muted', dots([p.role, p.company]))),
          p.contact_id ? h('a.btn.btn-sm.btn-ghost', { href: `#/crm/contatti/${p.contact_id}` }, 'Nel CRM')
            : h('button.btn.btn-sm', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; const x = await post(`/api/crm/radar/signals/${g.id}/progettista/persona`, { n: p.n }); d.people[p.n].contact_id = x.contact_id; toast(`${p.name} è nei contatti`); draw(); } } }, 'Aggiungi')))
          : h('div.cv-small.cv-muted', 'Alma non ha trovato nomi: li cerca di nuovo ogni settimana.'));
      const knows = col(lbl('Chi lo conosce in Almacis'),
        (d.knows || []).length ? d.knows.map(k => h('div.pg-row', h('span', h('b', k.user_name), h('br'), h('span.cv-small.cv-muted', k.why || (k.contact ? `conosce ${k.contact}` : ''))), k.level ? pill(k.level, k.level === 'forte' ? 'gr' : 'line') : null))
          : h('div.cv-small.cv-muted', 'Nessuno ancora: si parte con un contatto diretto.'),
        lbl('Prossimo passo'),
        d.step ? h('div.pg-row', h('span', d.step.title, h('br'), h('span.cv-small.cv-muted', d.step_id ? 'approvato: è nei prossimi passi' : `entro ${d.step.within_days || 7} giorni`)),
          d.step_id ? null : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post(`/api/crm/radar/signals/${g.id}/progettista/passo`, {}); d.step_id = 1; toast('Passo creato'); draw(); refresh?.(); } } }, 'Approva')) : null);
      fill(box, h('div.pg-opp', why, ppl, knows));
    };
    draw();
  }).catch(() => {});
  return box;
}

// ── Anagrafiche › Progettisti (ALM2-80, tavola Q) ─────────────────────────────────────────────────────────
// Accanto a Partner e Concorrenti: i progettisti del CRM (anche fornitori, Professionisti › Progettista) come schede,
// con «Vincono per…» (un committente) e l'area; sotto, chi vince con quell'ente ma non è ancora nel CRM.
const pqState = { q: '', sa: '', ente: null, bu: '', tile: '' };
function ring(n, total) {
  const ns = 'http://www.w3.org/2000/svg';
  const C = 2 * Math.PI * 23;
  const part = total ? Math.max(2, (C * n) / total) : 0;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', 58); svg.setAttribute('height', 58); svg.setAttribute('viewBox', '0 0 58 58');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', total ? `${n} incarichi su ${total}, il ${Math.round((100 * n) / total)}%` : `${n} incarichi`);
  svg.classList.add('pq-ring');
  const bg = document.createElementNS(ns, 'circle');
  for (const [k, v] of [['cx', 29], ['cy', 29], ['r', 23]]) bg.setAttribute(k, v);
  bg.classList.add('bg');
  const fg = bg.cloneNode(); fg.setAttribute('class', 'fg');
  fg.setAttribute('stroke-dasharray', `${part} ${C}`); fg.setAttribute('transform', 'rotate(-90 29 29)');
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', 29); t.setAttribute('y', 33); t.setAttribute('text-anchor', 'middle'); t.textContent = String(n);
  svg.append(bg, ...(total ? [fg] : []), t);
  return svg;
}
const LEVEL_DOTS = { forte: 4, media: 2, debole: 1 };

export async function progettistiAnagrafica(box, { switcher } = {}) {
  fill(box, loading());
  const s = pqState;
  const qs = new URLSearchParams({ ...(s.q ? { q: s.q } : {}), ...(s.sa ? { sa: s.sa } : {}), ...(s.bu ? { bu: s.bu } : {}) });
  const r = await get(`/api/crm/progettisti/anagrafica?${qs}`);
  const reload = () => progettistiAnagrafica(box, { switcher });
  const label = k => r.area_labels.find(a => a.key === k)?.label || k;
  const enteName = r.ente ? nice(r.ente.name) : '';
  const shortEnte = enteName.length > 30 ? `${enteName.slice(0, 28)}…` : enteName;

  // ricerca: chi (nome, P.IVA) e «vincono per» (committente)
  const qIn = h('input', { type: 'search', value: s.q, placeholder: 'nome, P.IVA o codice fiscale', 'aria-label': 'Cerca un progettista' });
  qIn.addEventListener('input', debounce(() => { s.q = qIn.value.trim(); reload(); }, 400));
  const found = h('div.cg-found', { hidden: true });
  const vpIn = h('input', { type: 'search', placeholder: 'un ente: nome, sigla (AQP, ANAS…) o codice fiscale', 'aria-label': 'Vincono per: committente' });
  vpIn.addEventListener('input', debounce(async () => {
    const q = vpIn.value.trim();
    if (q.length < 2) { found.hidden = true; return; }
    const res = await get(`/api/crm/progettisti/enti?q=${enc(q)}`, { quiet: true }).catch(() => ({ enti: [] }));
    fill(found, res.enti.length ? res.enti.map(e => h('button.cg-fr', { type: 'button', on: { click: () => { s.sa = e.cf; reload(); } } },
      h('span.cg-fr-ic', ic('landmark', 14)), h('span.cv-grow', h('b', nice(e.name)), h('small', dots([e.region, `${num(e.incarichi)} incarichi`, `${num(e.progettisti)} progettisti`]))), ic('chevron-right', 14)))
      : h('p.cg-none', 'Nessun ente con incarichi di progettazione per questa ricerca.'));
    found.hidden = false;
  }, 250));
  const search = h('div.pq-search',
    h('label', ic('search', 17), h('span.pq-l', h('small', 'Chi'), qIn)),
    h('div.pq-vp', ic('landmark', 17), h('span.pq-l', h('small', 'Vincono per'), r.ente ? h('b', enteName) : vpIn),
      r.ente ? h('button.pq-x', { type: 'button', 'aria-label': 'Togli il committente', on: { click: () => { s.sa = ''; reload(); } } }, ic('x', 14)) : null),
    found);

  // riquadri per area + «da conoscere»
  const tops = r.area_labels.filter(a => r.tiles.aree[a.key]).sort((a, b) => r.tiles.aree[b.key] - r.tiles.aree[a.key]).slice(0, 3);
  const tile = (key, l, n, sub) => h('button.pq-tile', { type: 'button', class: (key === 'conoscere' ? s.tile === key : s.bu === key) ? 'on' : '', 'aria-pressed': String(key === 'conoscere' ? s.tile === key : s.bu === key),
    on: { click: () => { if (key === 'conoscere') s.tile = s.tile === key ? '' : key; else s.bu = s.bu === key ? '' : key; reload(); } } }, h('span', l), h('b', num(n)), h('small', sub));
  const tiles = h('div.pq-tiles', tops.map(a => tile(a.key, a.label, r.tiles.aree[a.key], 'progettisti nel CRM')),
    tops.length < 3 ? h('div') : null, tile('conoscere', 'Da conoscere', r.tiles.da_conoscere, 'nessuno di noi ci ha scritto'));
  const areaSel = h('select.cg-sel', { 'aria-label': 'Area', class: s.bu ? 'on' : '' }, [['', 'Area: tutte'], ...r.area_labels.map(a => [a.key, a.label])].map(([v, l]) => h('option', { value: v, selected: v === s.bu }, l)));
  areaSel.addEventListener('change', () => { s.bu = areaSel.value; reload(); });

  const hero = h('section.pq-hero.pg-hero',
    h('div.pq-top', h('div.cv-grow', h('div.cg-kicker', ic('pencil-ruler', 12), 'Alma CRM · anagrafiche'), h('h1', 'I nostri ', h('b', 'progettisti')),
      h('p', 'Chi progetta le opere che poi andiamo a costruire. Sono anche ', h('b', 'fornitori'), ' (Professionisti › Progettista).')),
      h('button.btn.btn-primary.pq-new', { type: 'button', on: { click: () => nuovoProgettista({ ente: r.ente, onSaved: x => { location.hash = `#/crm/scheda/${x.id}`; } }) } }, ic('plus', 16), 'Nuovo progettista')),
    switcher ? h('div.pq-sw', switcher) : null,
    search,
    h('div.cv-row', { style: { gap: '10px', flexWrap: 'wrap' } }, areaSel, h('span.cv-grow'),
      h('span.pq-sum', r.ente ? [`${num(r.progettisti.length)} nel CRM vincono con ${shortEnte}`, r.suggeriti ? [' · ', h('b', `${num(r.suggeriti.list.length + r.suggeriti.altri)} ancora da conoscere`)] : null]
        : `${num(r.tiles.tutti)} progettisti nel CRM`)),
    tiles);

  let list = r.progettisti;
  if (s.tile === 'conoscere') list = list.filter(p => !p.rapporto.level);
  const card = (p, i) => {
    const dotsN = LEVEL_DOTS[p.rapporto.level] || 0;
    const enti = p.enti;
    const maxE = Math.max(1, ...enti.map(e => e.n));
    const who = p.rapporto.who?.name ? `${p.rapporto.who.name.split(' ')[0]} ${p.rapporto.who.name.split(' ')[1]?.[0] ? `${p.rapporto.who.name.split(' ')[1][0]}.` : ''}`.trim() : '';
    return h('a.pq-card', { href: `#/crm/scheda/${p.id}` },
      h('div.pq-head', h('span.pg-ini', { class: AV_TONES[i % AV_TONES.length] }, initials(p.name)),
        h('div.cv-grow', h('b', p.name), h('small', dots([p.legal_form || (p.kind === 'professionista' ? 'professionista' : p.kind === 'altro' ? 'raggruppamento' : 'studio'), p.city, p.origin === 'ANAC' ? '' : p.incarichi ? '' : 'aggiunto a mano']))),
        r.ente ? ring(p.con_sa, r.ente.incarichi) : ring(p.incarichi, 0)),
      h('div.pq-tags', p.roles.includes('fornitore') ? pill('fornitore', 'bl') : null, p.roles.includes('partner') ? pill('partner', 'pu') : null, p.aree.map(a => h('span.pq-tag', label(a)))),
      enti.length ? h('div.pq-eb', h('span.pg-lbl', r.ente ? 'Vince per' : 'Lavora per'),
        enti.map(e => h('div', h('span', nice(e.name)), h('i', h('span', { style: { width: `${(100 * e.n) / maxE}%` } })), h('b', String(e.n)))))
        : h('div.pv-muted.cv-small', p.cf ? 'Nessun incarico ANAC negli ultimi 24 mesi.' : 'Senza P.IVA o codice fiscale: gli incarichi ANAC si collegano quando li aggiungi.'),
      h('div.pq-foot', h('span.pq-dots', { 'aria-label': `rapporto ${p.rapporto.level || 'assente'}` }, [1, 2, 3, 4, 5].map(n => h('i', { class: n <= dotsN ? 'y' : '' }))),
        h('span', { class: p.rapporto.level ? '' : 'warn' }, p.rapporto.level ? (who ? `${who} lo conosce${p.rapporto.level === 'forte' ? ' bene' : ''}` : `rapporto ${p.rapporto.level}`) : 'nessuno di noi ci ha scritto'),
        p.owner_name ? h('small', `resp. ${p.owner_name}`) : null));
  };
  const sugg = r.suggeriti && (r.suggeriti.list.length || r.suggeriti.altri) ? h('article.pq-sugg',
    h('div.pq-sugg-t', ic('sparkles', 16), h('b', `Vincono per ${shortEnte}, non li conosciamo`), pill('da ANAC', 'or')),
    r.suggeriti.list.map(p => h('div.pq-sugg-r', h('span.pg-ini.gy', initials(p.name)), h('span', h('b', nice(p.name)), h('small', `${p.n} con ${shortEnte} · n. ${p.rank}`)),
      h('button.btn.btn-sm', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await toCrm(p); reload(); } } }, ic('plus', 13), 'Aggiungi'))),
    h('a', { href: `#/crm/concorrenza/progettisti?sa=${enc(r.ente.cf)}${s.bu ? `&bu=${s.bu}` : ''}` },
      r.suggeriti.altri ? `e altri ${num(r.suggeriti.altri)} · classifica completa per ${shortEnte} ›` : `Classifica completa per ${shortEnte} ›`)) : null;
  const body = list.length || sugg ? h('div.pq-grid', list.map(card), sugg)
    : h('section.pv-card', emptyState('pencil-ruler', r.ente ? `Nessun progettista del CRM ha incarichi con ${shortEnte}.` : s.q || s.bu || s.tile ? 'Nessun progettista con questi filtri.' : 'Ancora nessun progettista nel CRM: aggiungine uno con «Nuovo progettista» o dalla classifica di Concorrenza e gare.',
      h('a.btn.btn-sm', { href: '#/crm/concorrenza/progettisti' }, 'Chi vince di più')));
  fill(box, h('div.pq', hero, body,
    h('p.cv-hint', 'Le aree sono quelle scelte nella scheda più quelle dei suoi incarichi ANAC; il cerchio è la sua quota degli incarichi dell\'ente scelto. Fonte degli incarichi: ANAC, dati aperti.')));
}

// «Nuovo progettista»: mentre si scrive il nome cerca negli incarichi ANAC e propone codice fiscale, enti e aree
export function nuovoProgettista({ ente = null, onSaved } = {}) {
  const f = { name: '', cf: '', tipo: 'societa', aree: new Set(), owner_id: store.me?.id || '', from_anac: false };
  const name = h('input', { id: 'pq-n1', autocomplete: 'off', placeholder: 'es. Studio Ingegneria Rossi' });
  const cf = h('input', { id: 'pq-n2', autocomplete: 'off', placeholder: '11 cifre o 16 caratteri' });
  const tipo = h('select', { id: 'pq-n3' }, [['societa', 'Società di ingegneria'], ['studio', 'Studio associato'], ['libero', 'Libero professionista'], ['rtp', 'Raggruppamento (RTP)']].map(([v, l]) => h('option', { value: v }, l)));
  const owner = h('select', { id: 'pq-n4' }, (store.users || []).filter(u => u.active !== false).map(u => h('option', { value: u.id, selected: u.id === f.owner_id }, u.name)));
  const match = h('div');
  const areeBox = h('div.pq-chipsel');
  let labels = [];
  const drawAree = () => fill(areeBox, labels.map(a => h('button', { type: 'button', class: f.aree.has(a.key) ? 'on' : '', 'aria-pressed': String(f.aree.has(a.key)),
    on: { click: () => { if (f.aree.has(a.key)) f.aree.delete(a.key); else f.aree.add(a.key); drawAree(); } } }, a.label)));
  get('/api/crm/progettisti/anagrafica?q=%E2%80%94', { quiet: true }).then(r => { labels = r.area_labels; drawAree(); }).catch(() => {});
  const use = t => {
    name.value = nice(t.name); cf.value = t.cf || ''; f.from_anac = true;
    for (const a of t.aree || []) f.aree.add(a);
    drawAree();
    fill(match, h('div.pq-note', ic('check', 14), `Dati da ANAC: ${num(t.incarichi)} incarichi${t.subject ? ' · è già nel CRM: lo completo come progettista e fornitore' : ''}`));
  };
  name.addEventListener('input', debounce(async () => {
    f.from_anac = false;
    const q = name.value.trim();
    if (q.length < 3) { fill(match); return; }
    const r = await get(`/api/crm/progettisti/cerca?q=${enc(q)}${ente ? `&sa=${enc(ente.cf)}` : ''}`, { quiet: true }).catch(() => ({ trovati: [] }));
    const [t, ...alt] = r.trovati;
    if (!t) { fill(match, h('p.cv-small.cv-muted', 'Non è negli incarichi ANAC degli ultimi 24 mesi: lo crei a mano.')); return; }
    fill(match, h('div.pq-match',
      h('div.pq-match-t', ic('sparkles', 15), h('span', 'Trovato in ANAC'), t.cf ? h('small', `C.F. ${t.cf}`) : null),
      h('b', nice(t.name)),
      h('div.pq-match-n', h('div', h('b', num(t.incarichi)), h('small', 'incarichi')), h('div', h('b', num(t.enti)), h('small', 'enti')),
        h('div', h('b.or', ente ? num(t.con_sa) : t.aree.length ? String(t.aree.length) : '—'), h('small', ente ? `con ${nice(ente.name).split(' ').slice(0, 2).join(' ')}` : 'aree'))),
      t.subject ? h('p.cv-small', { style: { margin: 0, color: '#FFB066' } }, 'È già nel CRM: salvando lo segno come progettista e fornitore.') : null,
      h('div.cv-row', { style: { gap: '8px', flexWrap: 'wrap' } }, h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => use(t) } }, 'Usa questi dati'),
        alt.length ? h('div.pq-match-alt', alt.slice(0, 3).map(a => h('button', { type: 'button', on: { click: () => use(a) } }, `${nice(a.name).slice(0, 28)} · ${a.incarichi}`))) : null)));
  }, 350));
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    if (!name.value.trim()) { toast('Scrivi il nome dello studio o del professionista', 'err'); name.focus(); return; }
    save.disabled = true;
    try {
      const x = await post('/api/crm/progettisti/nuovo', { name: name.value.trim(), cf: cf.value.trim(), tipo: tipo.value, aree: [...f.aree], owner_id: Number(owner.value) || undefined, from_anac: f.from_anac });
      toast(x.created ? `${x.name} è nel CRM come progettista e fornitore` : `${x.name} era già nel CRM: ora è anche progettista e fornitore`);
      m.close();
      onSaved?.(x);
    } catch (err) { save.disabled = false; toast(err.message || 'Non salvato', 'err'); }
  } } }, 'Crea progettista');
  const body = h('div.pq-form',
    h('label.pq-f', { for: 'pq-n1' }, 'Nome dello studio o del professionista', name),
    match,
    h('div.pq-2', h('label.pq-f', { for: 'pq-n2' }, 'P.IVA o codice fiscale', cf), h('label.pq-f', { for: 'pq-n3' }, 'Tipo', tipo)),
    h('div.pq-f', h('span', 'Aree in cui lavora'), areeBox),
    h('label.pq-f', { for: 'pq-n4' }, 'Responsabile', owner),
    h('div.pq-note', pill('fornitore', 'bl'), h('span', 'Salvato come Progettista e fra i Fornitori · Professionisti › Progettista; gli incarichi ANAC si collegano da soli col codice fiscale.')));
  const m = cvModal({ title: 'Nuovo progettista', body, drawer: true, actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), save] });
  setTimeout(() => name.focus(), 50);
  return m;
}
