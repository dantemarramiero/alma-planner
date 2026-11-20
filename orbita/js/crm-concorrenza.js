// Concorrenza dai dati ANAC e «Prima del bando» (Dante 17/11/2026, canvas «v4 · Concorrenza», «v4 · Prima del bando»,
// «v4 · Gara»): chi vince nelle nostre categorie e zone, con che ribasso e con chi in ATI; le opere che diventeranno
// gare divise per fase; nella gara il ribasso tipico e i probabili concorrenti.
import { h, fill, toast, fmtDate, loading } from './ui.js';
import { get, post } from './api.js';
import { ic, dots, pill, pageTop, title, card, listRow, emptyState, seg, cvModal } from './crm-v2.js';
import { warmPill, registraEsito } from './crm-esiti.js';

const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const pct = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const num = n => Number(n || 0).toLocaleString('it-IT');
const month = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'short', year: 'numeric' }) : '');
const kpi = (l, n, sub, tone = '') => h('div.cv-kpi', h('span.cv-kpi-l', l), h('span.cv-kpi-n', n), sub ? h('span.cv-kpi-d', { class: tone }, sub) : null);
export const nice = s => String(s || '').toLowerCase().replace(/(^|[\s'’(.-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(S\.?r\.?l|S\.?p\.?a|S\.?c\.?a\.?r\.?l|S\.?n\.?c)\b\.?/gi, x => x.toUpperCase());
// barra del ribasso: fascia centrale (25–75%) chiara, tacca = tipico; scala 0–50%
export function bandBar(p25, med, p75) {
  const x = v => `${Math.max(0, Math.min(100, (Number(v) || 0) * 2))}%`;
  return h('span.cv-band', { role: 'img', 'aria-label': `ribasso tipico ${pct(med)}, metà delle gare tra ${pct(p25)} e ${pct(p75)}` },
    h('i', { style: { left: x(p25), right: `calc(100% - ${x(p75)})` } }), h('b', { style: { left: x(med) } }));
}

// impresa → scheda del CRM (concorrente o partner)
async function toCrm(w, role, onDone) {
  const r = await post('/api/crm/concorrenza/scheda', { name: nice(w.name), cf: w.cf, role });
  toast(r.created ? `${nice(w.name)} è nel CRM come ${role}` : `${nice(w.name)} era già nel CRM: aggiunto il ruolo ${role}`);
  onDone?.();
}
export const crmCell = (w, onDone, role = 'concorrente') => (w.noi ? pill('Almacis', 'or')
  : w.subject ? h('a', { href: `#/crm/scheda/${w.subject.id}` }, pill(w.subject.roles.includes('partner') ? 'Partner' : w.subject.roles.includes('cliente') ? 'Cliente' : 'Concorrente', w.subject.roles.includes('partner') || w.subject.roles.includes('cliente') ? 'gr' : 'rd'))
    : h('button.btn.btn-sm.btn-ghost', { type: 'button', title: role === 'partner' ? 'Aggiungi al CRM come partner' : 'Aggiungi al CRM come concorrente', on: { click: e => { e.currentTarget.disabled = true; toCrm(w, role, onDone); } } }, ic('plus', 14), 'Aggiungi'));

// ── pagina «Concorrenza» ──────────────────────────────────────────────────────────────────────
export async function concorrenzaTab(box, data, state = { bu: null, months: 12, regions: '', amount: '' }) {
  fill(box, loading());
  const again = () => concorrenzaTab(box, data, state);
  const qs = new URLSearchParams({ months: state.months, ...(state.bu !== null ? { bu: state.bu } : {}), ...(state.regions ? { regions: 'tutte' } : {}), ...(state.amount ? { amount: 'tutte' } : {}) });
  const r = await get(`/api/crm/concorrenza?${qs}`);
  if (state.bu === null) state.bu = r.scope.bu || '';
  const buLabel = k => data.asa.find(a => a.key === k)?.label || k;
  const sc = r.scope;
  const k = r.kpi;
  const admin = r.admin ? h('button.btn', { type: 'button', disabled: r.data.running || undefined, on: { click: async e => { e.currentTarget.disabled = true; await post('/api/crm/concorrenza/aggiorna', {}); toast('Aggiornamento dai dati ANAC avviato: ci vuole qualche minuto'); } } }, ic('refresh-cw', 15), r.data.running ? 'Aggiornamento in corso…' : 'Aggiorna da ANAC') : null;
  const head = pageTop({ eyebrow: 'Alma CRM · ufficio gare', heading: title('', 'Concorrenza'), sub: 'Gare aggiudicate nelle nostre categorie e zone, dai dati pubblici ANAC.',
    actions: [h('span.cv-small.cv-muted', r.data.gare ? `aggiornato ${r.data.at ? `al ${day(r.data.at)}` : ''} · ${num(r.data.gare)} gare` : 'dati ANAC non ancora caricati'), admin] });
  if (!r.data.gare) {
    fill(box, head, emptyState('scale', r.data.running ? 'Sto caricando i dati ANAC degli ultimi mesi: ci vuole qualche minuto, poi qui vedi chi vince nelle nostre gare.' : 'I dati ANAC non sono ancora stati caricati. Si caricano da soli ogni notte; la direzione può avviarli subito con «Aggiorna da ANAC».'));
    return;
  }
  const filters = h('div.cv-row.cv-wrap', { style: { gap: '10px', marginBottom: '20px' } },
    seg([['', 'Tutte'], ...r.bus.map(b => [b, buLabel(b)])], state.bu, x => { state.bu = x; again(); }, { label: 'BU' }),
    seg([['12', '12 mesi'], ['24', '24 mesi']], String(state.months), x => { state.months = Number(x); again(); }, { label: 'Periodo' }),
    sc.categories.length || sc.cpv.length ? pill([...sc.categories, ...sc.cpv.map(c => `CPV ${c}…`)].join(' · '), 'line') : null,
    state.bu ? h('button.cv-pill.line', { type: 'button', title: 'Zone del profilo BU', on: { click: () => { state.regions = state.regions ? '' : 'tutte'; again(); } } }, ic('map-pin', 13), sc.regions.length ? sc.regions.join(', ') : 'tutta Italia', state.regions || !sc.regions.length ? '' : ' ×') : null,
    state.bu && (sc.amount_min || sc.amount_max || state.amount) ? h('button.cv-pill.line', { type: 'button', title: 'Fascia d\'importo del profilo BU', on: { click: () => { state.amount = state.amount ? '' : 'tutte'; again(); } } },
      state.amount ? 'tutti gli importi' : `${eur(sc.amount_min || 0)} – ${sc.amount_max ? eur(sc.amount_max) : 'senza limite'} ×`) : null);
  const winners = r.winners.length ? h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Impresa'), h('th.num', 'Vinte'), h('th.num', 'Valore'), h('th.num', 'Ribasso medio'), h('th', 'Nel CRM'))),
    h('tbody', r.winners.slice(0, 25).map(w => h('tr', { style: w.noi ? { background: 'var(--cv-or-soft, #FFFAF5)' } : null },
      h('td', h('div.cv-t5', nice(w.name)), h('div.cv-small.cv-muted', dots([w.cf, (w.regioni || []).join(', '), w.in_ati ? `${w.in_ati} in ATI` : '']))),
      h('td.num.cv-t5', String(w.vinte)), h('td.num', eur(w.valore)), h('td.num', pct(w.ribasso)), h('td', crmCell(w, again)))))))
    : emptyState('scale', 'Nessuna gara aggiudicata con questi filtri.');
  const bands = [...r.bands, ...(r.criteria.length ? [{ sep: true }] : []), ...r.criteria];
  fill(box, head, filters,
    h('div.cv-kpis',
      kpi('Gare aggiudicate', h('b', num(k.gare)), `per ${eur(k.valore)}`),
      kpi('Ribasso tipico di chi vince', h('b', pct(k.ribasso)), k.p25 !== null ? `metà delle gare tra ${pct(k.p25)} e ${pct(k.p75)}` : 'servono gare con più offerenti'),
      kpi('Offerenti per gara', h('b', k.offerenti === null ? '—' : num(Math.round(k.offerenti))), 'tipico'),
      kpi('Almacis', h('span', h('b', String(k.noi)), k.noi === 1 ? ' vinta' : ' vinte'), k.gare ? `${pct((100 * k.noi) / k.gare)} delle gare · ${pct(k.valore ? (100 * k.noi_valore) / k.valore : 0)} del valore` : '')),
    h('div.cv-cols.w400', { style: { marginTop: '24px' } },
      card({ title: 'Chi vince', count: r.winners.length, right: h('span.cv-small.cv-muted', 'ordinati per gare vinte') }, winners),
      h('div', { style: { display: 'grid', gap: '24px', alignContent: 'start' } },
        card({ title: 'Ribasso per fascia d\'importo', right: h('span.cv-small.cv-muted', 'tacca = tipico') },
          bands.length ? h('div.cv-bands', bands.map(b => (b.sep ? h('div.cv-sect', 'Per criterio') : h('div.cv-bandrow', h('span', b.label), bandBar(b.p25, b.med, b.p75), h('span.num', h('b', pct(b.med)), h('span.cv-small.cv-muted', ` ${b.n}`))))),
            h('p.cv-hint', 'Con l\'offerta economicamente più vantaggiosa il ribasso pesa meno: conta l\'offerta tecnica.')) : emptyState('scale', 'Servono gare con almeno 2 offerenti.')),
        card({ title: 'Con chi fare ATI', right: h('span.cv-small.cv-muted', 'vincono in ATI qui') },
          r.ati.length ? r.ati.slice(0, 8).map(w => listRow({ icon: 'handshake', tone: 'gr', title: nice(w.name), meta: dots([(w.categorie || []).join(' · '), `${w.ati} ATI vinte`]), actions: [crmCell(w, again, 'partner')] }))
            : emptyState('handshake', 'Nessuna impresa ha vinto più di una volta in ATI con questi filtri.')),
        r.ours.length ? card({ title: 'Le nostre', count: k.noi }, r.ours.slice(0, 8).map(a => listRow({ icon: 'trophy', tone: 'gr', title: nice(a.object), meta: dots([nice(a.sa_name), eur(a.amount), a.discount !== null ? `ribasso ${pct(a.discount)}` : '', day(a.awarded_on)]) }))) : null)),
    h('p.cv-hint', { style: { marginTop: '16px' } }, `Fonte: ANAC, dati aperti (licenza CC BY-SA 4.0). Le categorie vengono dai profili BU${r.admin ? '; CPV, codici fiscali di Almacis e mesi in Impostazioni → Concorrenza' : ''}.`));
}

// ── pagina «Prima del bando» ──────────────────────────────────────────────────────────────────
const STAGES = [['programmata', 'Programmata', 'list', 'nel programma triennale o nel piano investimenti'], ['finanziata', 'Finanziata', 'coins', 'PNRR, Regione, mutuo, contributo'],
  ['progetto', 'Progetto approvato', 'check', 'delibera, PFTE, autorizzazioni'], ['determina', 'Determina o avviso', 'alarm-clock', 'la gara esce a giorni']];
export async function primaBandoTab(box, data, state = { bu: '', within: '12' }, { openSignal } = {}) {
  fill(box, loading());
  const again = () => primaBandoTab(box, data, state, { openSignal });
  const r = await get(`/api/crm/prima-del-bando?within=${state.within}${state.bu ? `&bu=${state.bu}` : ''}`);
  const buLabel = k => data.asa.find(a => a.key === k)?.label || k;
  const list = [...STAGES.flatMap(([s]) => r.stages[s]), ...r.vinte_altri];
  const open = g => openSignal?.(g.id, again, data, list);
  const cardOf = g => h('button.cv-pc', { type: 'button', on: { click: () => open(g) } },
    h('div.cv-pc-t', g.title),
    h('div.cv-small.cv-muted', dots([g.subject_name || g.entity, eur(g.amount)])),
    h('div.cv-row.cv-wrap', { style: { gap: '6px' } },
      g.expected_on ? h('span.cv-when', ic('hourglass', 12), `bando atteso ${month(g.expected_on)}`) : null,
      g.level === 'forte' || g.level === 'media' ? warmPill(g.level) : null,
      g.status === 'interessa' ? pill('Interessa', 'gr') : null,
      g.bu ? pill(buLabel(g.bu), 'line') : null));
  const total = STAGES.reduce((n, [s]) => n + r.stages[s].length, 0);
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · radar', heading: title('Prima del', 'bando'), sub: 'Opere che diventeranno gare: chi arriva prima, vince più spesso.', actions: [] }),
    h('div.cv-row.cv-wrap', { style: { gap: '10px', marginBottom: '20px' } },
      r.bus.length > 1 ? seg([['', 'Tutte le BU'], ...r.bus.map(b => [b, buLabel(b)])], state.bu, x => { state.bu = x; again(); }, { label: 'BU' }) : null,
      seg([['6', 'Bando entro 6 mesi'], ['12', 'entro 12'], ['', 'tutto']], state.within, x => { state.within = x; again(); }, { label: 'Quando' })),
    total ? h('div.cv-board4', STAGES.map(([s, l, i, hint]) => h('section.cv-col',
      h('div.cv-col-h', ic(i, 15), h('span', l), h('span.cv-col-n', String(r.stages[s].length))),
      h('div.cv-small.cv-muted', { style: { padding: '0 6px' } }, hint),
      r.stages[s].map(cardOf))))
      : emptyState('hourglass', r.on?.on ? 'Ancora niente: il radar cerca ogni notte programmi triennali, finanziamenti, delibere e determine nelle categorie di ogni BU.' : 'Il giro «Prima del bando» del radar è spento (Impostazioni → Prima del bando).'),
    h('div', { style: { marginTop: '24px' } },
      card({ title: 'Vinte da altri: proponi subappalto o ATI', icon: 'handshake', count: r.vinte_altri.length, right: h('span.cv-small.cv-muted', `dati ANAC · ultimi ${r.on?.days || 60} giorni · nelle nostre categorie`) },
        r.vinte_altri.length ? h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', 'Gara'), h('th', 'Ha vinto'), h('th.num', 'Importo'), h('th'))),
          h('tbody', r.vinte_altri.map(g => h('tr.cv-click', { tabindex: 0, on: { click: () => open(g), keydown: e => { if (e.key === 'Enter') open(g); } } },
            h('td', h('div.cv-t5.cv-ell', { style: { maxWidth: '420px' } }, nice(g.title.replace(/^.*? ha vinto: /, ''))), h('div.cv-small.cv-muted.cv-ell', { style: { maxWidth: '420px' } }, dots([nice(g.place), g.region, g.bu ? buLabel(g.bu) : '']))),
            h('td', h('div.cv-t5', nice(g.entity)), h('div.cv-small.cv-muted.cv-ell', { style: { maxWidth: '300px' } }, g.summary.split(' · ').slice(1).join(' · '))),
            h('td.num', eur(g.amount)),
            h('td', { style: { textAlign: 'right' } }, g.status === 'interessa' ? pill('Interessa', 'gr') : h('span.btn.btn-sm', ic('sparkles', 14), 'Proponi subappalto')))))))
          : emptyState('handshake', 'Nessuna gara delle nostre categorie vinta da altri di recente (si aggiorna quando escono i dati ANAC del mese).'))));
}

// ── nel riquadro della gara: prezzo e concorrenti, esito pubblicato da ANAC ──────────────────
export function garaBox(g, { onDone, close } = {}) {
  const box = h('div', { style: { display: 'grid', gap: '12px' } });
  get(`/api/crm/concorrenza/stima?signal_id=${g.id}`).then(r => {
    if (!box.isConnected && !box.parentNode) return;
    const e = r.estimate;
    const parts = [];
    if (r.award && !g.status?.startsWith('gara_scartata')) {
      const a = r.award;
      const lead = a.winners.find(w => w.role === 'mandataria') || a.winners[0];
      parts.push(h('div.cv-box.cv-ok', h('div.cv-row', { style: { gap: '10px' } }, h('span.cv-ib.gr', ic('trophy', 15)),
        h('div.cv-grow', h('div.cv-t5', a.ours ? 'ANAC: l\'abbiamo vinta noi' : 'ANAC ha pubblicato l\'esito'),
          h('div.cv-small.cv-muted', dots([a.ours ? '' : lead ? `vince ${nice(lead.name)}` : '', a.discount !== null ? `ribasso ${pct(a.discount)}` : '', a.bidders ? `${a.bidders} offerenti` : '', day(a.awarded_on)]))),
        g.status !== 'nuovo' ? h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => { close?.(); registraEsito({ signal_id: g.id }, onDone); } } }, ic('check', 14), 'Registra esito') : null)));
    }
    if (e?.n) {
      parts.push(h('section.cv-box', { style: { display: 'grid', gap: '10px' } },
        h('div.cv-row', h('div.cv-lbl.cv-grow.cv-row', { style: { gap: '6px' } }, ic('scale', 14), 'Prezzo e concorrenti'), h('span.cv-small.cv-muted', `${e.n} gare simili · ANAC`)),
        h('div.cv-row', { style: { gap: '18px', alignItems: 'flex-end' } },
          h('div', h('div', { style: { fontSize: '28px', fontWeight: 700, lineHeight: '32px' } }, pct(e.med)), h('div.cv-small.cv-muted', 'ribasso tipico di chi vince')),
          h('div.cv-grow', bandBar(e.p25, e.med, e.p75), h('div.cv-small.cv-muted', { style: { marginTop: '6px' } }, `metà delle gare tra ${pct(e.p25)} e ${pct(e.p75)}`))),
        h('div.cv-small.cv-muted', dots([e.label, e.offerenti ? `${Math.round(e.offerenti)} offerenti tipici` : ''])),
        (e.competitors || []).map(w => h('div.cv-row', { style: { padding: '8px 0', borderTop: '1px solid var(--cv-line-2)', gap: '10px' } }, h('span.cv-ib.rd', ic('handshake', 14)),
          h('div.cv-grow', h('div.cv-t5', w.subject ? h('a', { href: `#/crm/scheda/${w.subject.id}` }, nice(w.name)) : nice(w.name)), h('div.cv-small.cv-muted', `${w.vinte} ${w.vinte === 1 ? 'vinta' : 'vinte'} in gare così`)),
          h('b', pct(w.ribasso))))));
    }
    fill(box, ...parts);
  }).catch(() => fill(box));
  return box;
}
