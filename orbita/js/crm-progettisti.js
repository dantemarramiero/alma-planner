// Progettisti (ALM2-70, tavola O del canvas approvata da Dante il 23/11/2026): chi progetta le opere degli enti, dagli
// incarichi di architettura e ingegneria di ANAC. Sezione di «Concorrenza e gare», scheda del progettista a cassetto,
// «Chi l'ha progettata» nella gara/segnale del Radar e «I suoi progettisti» nella scheda dell'ente.
import { h, fill, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post } from './api.js';
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

// ── sezione «Progettisti» ─────────────────────────────────────────────────────────────────────────
export async function progettistiSection(box, { st, tabs, again }) {
  fill(box, loading());
  st.pg = st.pg || { sort: 'incarichi', type: '', q: '', italia: false };
  const f = st.pg;
  const qs = new URLSearchParams({ months: st.months, sort: f.sort, ...(f.type ? { type: f.type } : {}), ...(f.q ? { q: f.q } : {}), ...(f.italia ? { regions: 'tutte' } : {}) });
  const r = await get(`/api/crm/progettisti?${qs}`);
  const k = r.kpi;
  const reload = () => again();
  const kpi = (l, v, s, c = '') => h('div.cg-kpi', { class: c }, h('span.cg-k', l), h('b', v), h('small', s));
  const search = h('input', { type: 'search', value: f.q, placeholder: 'Cerca un progettista o uno studio, per nome o codice fiscale', 'aria-label': 'Cerca un progettista' });
  search.addEventListener('input', debounce(() => { f.q = search.value.trim(); reload(); }, 400));
  const admin = r.admin ? h('button.cg-ghost', { type: 'button', disabled: r.data.running || undefined, on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/concorrenza/aggiorna', {}); toast('Aggiornamento dai dati ANAC avviato: i progettisti arrivano dopo le gare'); } } },
    ic('refresh-cw', 13), r.data.running ? 'Aggiornamento…' : 'Aggiorna da ANAC') : null;
  const zone = r.zone.length ? r.zone.join(', ') : 'Tutta Italia';
  const hero = h('section.cg-hero',
    h('div.cg-top', h('div.cv-grow',
      h('div.cg-kicker', ic('pencil-ruler', 12), r.data.incarichi ? `Fonte ANAC${r.data.at ? ` · aggiornato al ${fmtDate(String(r.data.at).slice(0, 10))}` : ''} · ${num(r.data.incarichi)} incarichi` : 'Dati ANAC dei progettisti non ancora caricati'),
      h('h1.cg-h1', 'Chi progetta le opere'),
      h('p.cg-sub', `Incarichi di progettazione e direzione lavori (servizi di architettura e ingegneria) negli ultimi ${st.months} mesi, collegati alle gare dei lavori con il CUP.`)), admin),
    !r.zone.length ? null : h('div.pg-zone', h('button.pg-z', { type: 'button', class: f.italia ? '' : 'on', 'aria-pressed': String(!f.italia), on: { click: () => { f.italia = false; reload(); } } }, zone),
      h('button.pg-z', { type: 'button', class: f.italia ? 'on' : '', 'aria-pressed': String(f.italia), on: { click: () => { f.italia = true; reload(); } } }, 'Tutta Italia')),
    h('div.cg-kpis',
      kpi('Progettisti attivi', num(k.progettisti), 'studi e professionisti con incarichi'),
      kpi('Incarichi', num(k.incarichi), `per ${eur(k.valore)} di onorari`, 'or'),
      kpi('Opere già in gara', num(k.in_gara), 'progettate e poi bandite (stesso CUP)'),
      kpi('Da contattare ora', num(k.da_contattare), 'progettisti di opere nel nostro Radar', 'gr')),
    h('div.cg-search', ic('search', 15), search));

  const typeSel = h('select.cg-sel', { 'aria-label': 'Tipo d\'incarico', class: f.type ? 'on' : '' }, [['', 'Incarico: tutti'], ...r.types.map(t => [t, `Incarico: ${t}`])].map(([v, l]) => h('option', { value: v, selected: v === f.type }, l)));
  typeSel.addEventListener('change', () => { f.type = typeSel.value; reload(); });
  const months = h('select.cg-sel', { 'aria-label': 'Periodo' }, [['24', 'Ultimi 24 mesi'], ['12', 'Ultimi 12 mesi']].map(([v, l]) => h('option', { value: v, selected: String(st.months) === v }, l)));
  months.addEventListener('change', () => { st.months = Number(months.value); reload(); });
  const filters = h('div.cg-filters', typeSel, months, h('span.cv-grow'), h('span.pg-lbl', 'Chi vince di più'),
    h('div.pg-seg', SORTS.map(([v, l]) => h('button', { type: 'button', class: f.sort === v ? 'on' : '', 'aria-pressed': String(f.sort === v), on: { click: () => { f.sort = v; reload(); } } }, l))));

  let body;
  if (!r.data.incarichi) body = h('section.pv-card', emptyState('pencil-ruler', r.data.running ? 'Sto caricando gli incarichi di progettazione da ANAC: ci vuole qualche minuto.' : 'Gli incarichi di progettazione si caricano da soli dopo i dati ANAC della notte; la direzione può avviarli subito con «Aggiorna da ANAC».'));
  else if (!r.progettisti.length) body = h('section.pv-card', emptyState('search', f.q ? 'Nessun progettista con questo nome negli incarichi caricati.' : 'Nessun incarico con questi filtri: prova «Tutta Italia» o un altro tipo d\'incarico.'));
  else {
    const head = h('div.pg-head', ['#', 'Progettista', 'Incarichi', 'Valore', 'Enti principali', 'Con chi va in gara', ''].map(t => h('span', t)));
    const rows = r.progettisti.map((p, i) => h('div.pg-row', { role: 'button', tabIndex: 0,
      on: { click: () => openProgettista(p.key, { onChange: reload }), keydown: e => { if (e.key === 'Enter') openProgettista(p.key, { onChange: reload }); } } },
      h('span.cg-n', String(i + 1)),
      h('div.cg-name', h('b', nice(p.name)), h('small', dots([p.regioni.filter(x => x !== '—').join(', '), p.tipi.join(', '), p.rtp ? `${p.rtp} in RTP` : '']))),
      h('div.pg-num', h('b', String(p.incarichi)), p.enti_n > 1 ? h('small', `${p.enti_n} enti`) : null),
      h('span.cg-val', eur(p.valore)),
      h('div.pg-enti', p.enti.map(e => h('span', h('em', nice(e.name)), ` · ${e.n}`))),
      h('div.pg-enti', p.imprese.length ? p.imprese.map(x => h('span', h('em', nice(x.name)), ` (${x.n})`)) : h('span.pv-muted', p.da_bandire ? `${p.da_bandire} opere ancora da bandire` : '—')),
      crmBadge(p, reload)));
    body = h('section.cg-list', head, rows,
      h('div.cg-foot', `${r.progettisti.length} di ${num(r.total)} progettisti · RTP contati per tutti i componenti; nomi uniti per codice fiscale, non per come sono scritti.`));
  }
  fill(box, h('div.cg', hero, tabs, filters, body,
    h('p.cv-hint', 'Il nome del singolo ingegnere dentro uno studio o un RTP ANAC non lo dà: aggiungilo nel CRM come contatto dello studio. Fonte: ANAC, dati aperti (CC BY-SA 4.0).')));
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
    fill(box, h('section.cv-card.pad.pg-ente',
      h('div', h('div.cv-lbl', 'I suoi progettisti'), h('div.cv-small.cv-muted', `${r.incarichi} incarichi di progettazione in 24 mesi · ANAC`)),
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
