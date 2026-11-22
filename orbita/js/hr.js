// Alma HR, Fase 1 (canvas «Alma HR», 21/11/2026; decisioni di Dante dello stesso giorno).
// Per tutti: Il mio percorso, Salary grade (la griglia senza nomi), Mansionario.
// Solo team HR: Persone (da BOSS) e scheda con la retribuzione, Ruoli sugli incarichi, Mappatura, Pannello di controllo,
// Vista d'insieme (leve), Registro. Il server controlla il ruolo: qui si nascondono solo le voci.
import { h, fill, toast, modal, confirmDialog, loading, fmtDateTime } from './ui.js';
import { get, post, patch, api } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...kids.flat().filter(Boolean)); return el; };
const eur = n => (n == null ? '—' : `${Math.round(n).toLocaleString('it-IT')} €`);
const k1 = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const itDate = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const ZONE = { sotto: ['sotto il minimo', 'bad'], ingresso: ['ingresso', 'warn'], linea: ['in linea', 'ok'], alta: ['alta', 'hi'], sopra: ['sopra il massimo', 'bad'] };
const zoneChip = pos => (pos ? h('span.hr-chip', { class: `z-${ZONE[pos.zone][1]}` }, `${ZONE[pos.zone][0]} ${pos.pct}%`, pos.wrong ? ' · ruolo?' : '') : h('span.muted', '—'));
const AUT = { auto: ['●', 'autonomo'], sup: ['◐', 'con supervisione'], support: ['○', 'supporto'], none: ['–', 'fuori portata'] };
const EXCL = { operaio: 'Operaio (tabelle CCNL)', apprendista: 'Apprendista', tirocinio: 'Tirocinio', staff_leasing: 'Staff leasing', organo: 'Organo di controllo' };

const head = (title, sub, right) => h('div.page-head', h('div', h('div.hr-eyebrow', 'Alma HR'), h('h1', title), sub ? h('div.sub', sub) : null), right || null);
const howTo = (...txt) => h('div.hr-howto', h('b', 'Come si legge'), ' · ', ...txt);
const lockBar = txt => h('div.hr-lock', icon('lock', { size: 14 }), h('span', txt));
// ── Ambito delle analisi (Dante 22/11): tutta l'azienda, tutte le funzioni, tutte le BU, oppure una sola area ──
// Resta scelto passando da una pagina all'altra (memoria del browser).
const AMB_KEY = 'almahr.ambito';
export const getAmbito = () => { try { return localStorage.getItem(AMB_KEY) || ''; } catch { return ''; } };
const setAmbito = v => { try { localStorage.setItem(AMB_KEY, v); } catch { /* niente */ } };
let areeCache = null;
export async function ambitoSelect(onChange) {
  areeCache ||= (await get('/api/hr/aree')).aree;
  const cur = getAmbito();
  const opt = (v, l) => h('option', { value: v, selected: cur === v }, l);
  const sel = h('select.select.hr-ambito', { 'aria-label': 'Ambito' }, opt('', 'Tutta l\'azienda'), opt('funzioni', 'Tutte le funzioni'), opt('bu', 'Tutte le Business Unit'),
    h('optgroup', { label: 'Funzioni' }, areeCache.filter(a => a.tipo === 'funzionale').map(a => opt(String(a.id), a.nome))),
    h('optgroup', { label: 'Business Unit' }, areeCache.filter(a => a.tipo === 'operativa').map(a => opt(String(a.id), a.nome))));
  sel.addEventListener('change', () => { setAmbito(sel.value); onChange(sel.value); });
  return h('label.hr-ambito-wrap', h('span', 'Ambito'), sel);
}
export const inAmbito = (area, amb = getAmbito()) => !amb || (amb === 'funzioni' ? area?.tipo === 'funzionale' : amb === 'bu' ? area?.tipo === 'operativa' : String(area?.id ?? '') === amb);
export const ambQs = (amb = getAmbito()) => (amb ? `ambito=${encodeURIComponent(amb)}` : '');

const notHr = c => fill(c, head('Riservato al team HR'), h('div.card.empty', 'Questa pagina la vede solo chi ha il ruolo «Team HR» (Impostazioni › Ruoli).'));

export async function hrView(c, parts, params) {
  const page = parts[1] || 'percorso';
  const hrPages = ['persone', 'persona', 'ruoli', 'mappatura', 'pannello', 'insieme', 'registro', 'costo', 'scenari', 'cambi', 'strategia', 'preboarding-lista', 'recruitment'];
  if (hrPages.includes(page) && !store.me.hr) return notHr(c);
  fill(c, loading());
  try {
    switch (page) {
      case 'griglia': return await grigliaView(c);
      case 'mansionario': return await mansionarioView(c, params);
      case 'persone': return await personeView(c, params);
      case 'persona': return await personaView(c, decodeURIComponent(parts[2] || ''));
      case 'ruoli': return await ruoliView(c, params);
      case 'mappatura': return await mappaturaView(c);
      case 'pannello': return await pannelloView(c, params);
      case 'insieme': return await insiemeView(c);
      case 'registro': return await registroView(c);
      // Fase 2 (ALM2-52): organigramma in sola lettura e il resto in hr-org.js
      case 'organigramma': return (await import('./hr-org.js')).organigrammaView(c, params);
      case 'costo': return (await import('./hr-org.js')).costoView(c);
      case 'scenari': return (await import('./hr-org.js')).scenariView(c, Number(parts[2]) || null);
      case 'cambi': return (await import('./hr-org.js')).cambiView(c);
      case 'strategia': return (await import('./hr-org.js')).strategiaView(c);
      // Fase 3 (ALM2-53): recruitment in hr-rec.js (richieste: anche i responsabili; candidato: anche chi intervista o approva)
      case 'richieste': return parts[2] ? (await import('./hr-rec.js')).richiestaView(c, Number(parts[2])) : (await import('./hr-rec.js')).richiesteView(c, params);
      case 'candidato': return (await import('./hr-rec.js')).candidatoView(c, Number(parts[2]));
      case 'preboarding': return (await import('./hr-rec.js')).preboardingView(c, Number(parts[2]) || null);
      case 'recruitment': return (await import('./hr-rec.js')).numeriView(c, params);
      default: return await percorsoView(c);
    }
  } catch (err) {
    if (err.status === 403) return notHr(c);
    fill(c, head('Alma HR'), h('div.card.empty', err.message || 'Non è stato possibile caricare la pagina'));
  }
}

// ── barra di una fascia ─────────────────────────────────────────────────────────────────────────────────────
const SCALE = [20, 110];
const X = v => Math.max(0, Math.min(100, (v - SCALE[0]) / (SCALE[1] - SCALE[0]) * 100));
function bandBar(b, { marker, ccnl, market, dots = [] } = {}) {
  return h('div.hr-band', [
    h('div.hr-band-fill', { style: { left: `${X(b.min)}%`, width: `${X(b.max) - X(b.min)}%` } }),
    h('div.hr-band-mid', { style: { left: `${X(b.mid)}%` }, title: `riferimento ${k1(b.mid)} k€` }),
    ccnl ? h('div.hr-band-ccnl', { style: { left: `${X(ccnl)}%` }, title: `minimo CCNL ${k1(ccnl)} k€` }) : null,
    market ? h('div.hr-band-mkt', { style: { left: `${X(market)}%` }, title: `mercato ${k1(market)} k€` }) : null,
    ...dots.map((d, i) => h('div.hr-dot', { class: `z-${d.zone}`, style: { left: `${X(d.k)}%`, top: `${4 + (i % 4) * 7}px` }, title: d.title || '' })),
    marker != null ? h('div.hr-band-me', { style: { left: `${X(marker)}%` }, title: `${k1(marker)} k€` }) : null,
  ]);
}
const scaleRow = () => h('div.hr-scale', [20, 40, 60, 80, 100].map(v => h('span', { style: { left: `${X(v)}%` } }, `${v} k`)));
// la fascia di una persona: tre zone e il pallino
function zoneBar(band, k, zone = { low: 90, high: 110 }) {
  const lo = band.mid * zone.low / 100, hi = band.mid * zone.high / 100;
  const P = v => Math.max(0, Math.min(100, (v - band.min) / (band.max - band.min) * 100));
  return h('div.hr-zbar', [
    h('div.hr-zbar-track', [h('span.zi', { style: { width: `${P(lo)}%` } }), h('span.zl', { style: { width: `${P(hi) - P(lo)}%` } }), h('span.za', { style: { width: `${100 - P(hi)}%` } })]),
    h('div.hr-zbar-mid', { style: { left: '50%' } }),
    k != null ? h('div.hr-zbar-me', { style: { left: `${Math.max(-3, Math.min(103, P(k)))}%` } }, h('span', `${k1(k)} k`)) : null,
    h('div.hr-zbar-legend', h('span', `${k1(band.min)} k min · ingresso`), h('span', `${k1(band.mid)} k riferimento`), h('span', `alta · ${k1(band.max)} k max`)),
  ]);
}

// ── Il mio percorso ─────────────────────────────────────────────────────────────────────────────────────────
async function percorsoView(c) {
  const d = await get('/api/hr/percorso');
  if (!d.role) {
    return fill(c, head('Il mio percorso'), h('div.card.empty', h('p', 'Il tuo ruolo non è ancora stato collegato al mansionario.'), h('p.muted', 'Lo fa il team HR assegnando un ruolo al tuo incarico. Intanto puoi vedere la griglia e le schede dei ruoli.'),
      h('div.hr-row', h('a.btn', { href: '#/hr/griglia' }, 'Salary grade'), h('a.btn', { href: '#/hr/mansionario' }, 'Mansionario'))));
  }
  const r = d.role;
  const fams = new Set([r.hr_family, ...(r.hr_family === 'gestione' ? ['field'] : r.hr_family === 'field' ? ['gestione'] : [])]);
  const cols = d.families.filter(f => fams.has(f.key));
  const maxG = Math.max(...d.ladder.filter(x => fams.has(x.family)).map(x => x.grade));
  const ladder = h('div.hr-ladder', { style: { gridTemplateColumns: `56px repeat(${cols.length}, minmax(0, 1fr))` } },
    h('span'), cols.map(f => h('span.hr-ladder-h', f.label)),
    ...Array.from({ length: maxG }, (_, i) => maxG - i).flatMap(g => [h('span.hr-ladder-g', `G${g}`),
      ...cols.map(f => h('div.hr-ladder-cell', d.ladder.filter(x => x.family === f.key && x.grade === g).map(x =>
        h('a.hr-rb', { href: `#/hr/mansionario?ruolo=${x.id}`, class: x.id === r.id ? 'on' : d.next?.id === x.id ? 'next' : '' }, x.title,
          x.id === r.id ? h('small', 'sei qui') : d.next?.id === x.id ? h('small', 'prossimo passo') : null))))]));
  const sign = r.signed_at ? h('span.hr-chip.z-ok', `presa visione v${r.version} firmata il ${itDate(r.signed_at.slice(0, 10))}`)
    : h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/hr/mansionario/${r.id}/presa-visione`); toast('Presa visione firmata'); percorsoView(c); } } }, `Firma la presa visione (v${r.version})`);
  fill(c, head('Il mio percorso', 'Il tuo ruolo, il tuo grade e cosa serve per il passo dopo. La RAL non è qui: è sul cedolino.'),
    h('div.hr-grid2',
      h('div.card.hr-pad', h('div.hr-label', 'Il mio ruolo'), h('div.hr-big', r.title), h('div.muted', `Grade G${r.grade} · fascia ${k1(r.band.min)} – ${k1(r.band.mid)} – ${k1(r.band.max)} k€`),
        h('p', r.description), h('div.hr-row', h('a.btn.btn-sm', { href: `#/hr/mansionario?ruolo=${r.id}` }, 'Scheda del ruolo'), sign)),
      h('div.card.hr-pad', h('div.hr-label', 'Prossimo passo'), d.next ? [h('div.hr-big', `${d.next.title} (G${d.next.grade})`),
        h('div.muted', `fascia ${k1(d.next.band.min)} – ${k1(d.next.band.mid)} – ${k1(d.next.band.max)} k€`),
        d.next.criteria ? h('ul.hr-check', d.next.criteria.split(/\n|(?<=\.)\s+(?=[A-ZÀ-Ý])/).map(x => x.trim()).filter(Boolean).map(x => h('li', h('span.hr-box', { 'aria-hidden': 'true' }), x)))
          : h('p', 'I criteri per il passaggio sono nella scheda del ruolo.'),
        h('p.small.muted', 'Oggi la spunta la mette il tuo responsabile nel colloquio; quando BOSS passerà i dati delle commesse (complessità chiuse in autonomia), i criteri misurabili si spunteranno da soli.')] : h('p.muted', 'Sei al vertice del tuo binario.'))),
    h('div.card.hr-pad', h('div.hr-label', 'Le mie scadenze'), h('p.small.muted', 'Formazione sulla sicurezza, patentini e visite mediche compariranno qui quando BOSS li passerà ad Alma: oggi non arrivano.')),
    h('div.card.hr-pad', h('div.hr-label', 'Il mio binario'), ladder,
      h('p.muted.small', 'Si vedono il tuo binario e quello vicino: cambiare binario è una strada possibile, non solo salire.')));
}

// ── Salary grade per tutti ──────────────────────────────────────────────────────────────────────────────────
async function grigliaView(c) {
  const d = await get('/api/hr/griglia');
  const fam = new Map(d.families.map(f => [f.key, f.label]));
  const rows = [...d.bands].reverse().map(b => h('div.hr-grow', { class: b.grade === d.my_grade ? 'me' : '' },
    h('div.hr-grow-g', `G${b.grade}`, b.grade === d.my_grade ? h('small', 'il tuo') : null),
    h('div', bandBar(b), h('div.small.muted', `${k1(b.min)} · `, h('b', k1(b.mid)), ` · ${k1(b.max)} k€`)),
    h('div.small', b.roles.length ? b.roles.map((r, i) => [i ? ' · ' : '', h('a', { href: `#/hr/mansionario?ruolo=${r.id}`, title: fam.get(r.family) }, r.title)]) : h('span.muted', '—'))));
  fill(c, head('Salary grade', `${d.label} · in vigore dal ${itDate(d.valid_from)}`, d.is_hr ? h('a.btn', { href: '#/hr/pannello' }, icon('sliders-horizontal', { size: 16 }), ' Pannello di controllo') : null),
    h('div.card.hr-pad',
      howTo('Ogni riga è un grade, dal più alto (G8) al più basso (G1). La barra va dalla RAL ', h('b', 'minima'), ' alla ', h('b', 'massima'),
        ' di quel grade, sulla scala da 20 a 110 mila euro; la stanghetta scura è il ', h('b', 'riferimento'), '. Le barre di grade vicini si sovrappongono apposta: chi è molto esperto nel suo grade può guadagnare quanto chi è appena entrato in quello sopra. A destra i ruoli di quel grade.'),
      h('div.hr-grow.hr-grow-head', h('span', 'Grade'), h('span', 'Fascia RAL (min · riferimento · max)'), h('span', 'Ruoli')),
      rows, h('div.hr-grow.hr-grow-scale', h('span'), scaleRow(), h('span'))),
    h('div.hr-grid3',
      h('div.card.hr-pad', h('div.hr-label', 'Le tre zone della fascia'), h('div.hr-zones', h('span.zi'), h('span.zl'), h('span.za')),
        h('p.small.muted', `Ingresso (sotto il ${d.zone.low}% del riferimento) · In linea (${d.zone.low}–${d.zone.high}%) · Alta (sopra il ${d.zone.high}%)`)),
      h('div.card.hr-pad', h('div.hr-label', 'Come si sale'), h('p.small.muted', 'Dentro la fascia: con la revisione annuale, in base alla valutazione. Al grade dopo: quando si raggiungono i criteri del ruolo, scritti nel mansionario.')),
      h('div.card.hr-pad', h('div.hr-label', 'Doppio binario'), h('p.small.muted', 'Gestione commessa fino a G7, Engineering fino a G6, Field fino a G4. Crescere non vuol dire per forza diventare capo.'))));
}

// ── Mansionario ─────────────────────────────────────────────────────────────────────────────────────────────
async function mansionarioView(c, params) {
  const d = await get('/api/hr/mansionario');
  const sel = Number(params.get('ruolo')) || d.roles[0]?.id;
  const list = h('div.hr-mlist', d.families.map(f => [h('div.hr-fam', f.label),
    d.roles.filter(r => r.hr_family === f.key).map(r => h('a', { href: `#/hr/mansionario?ruolo=${r.id}`, class: r.id === sel ? 'on' : '' }, h('span', r.title), h('small', `G${r.grade || '?'}`)))]),
    d.is_hr ? h('button.btn.btn-sm', { type: 'button', on: { click: () => editRole(null, d.families, () => mansionarioView(c, params)) } }, icon('plus', { size: 14 }), ' Nuovo ruolo') : null);
  const detail = h('div.hr-mdetail', loading());
  fill(c, head('Mansionario', 'Le schede dei ruoli: le leggono tutti. Solo il team HR le modifica; ogni modifica crea una versione nuova e chiede la presa visione.'),
    h('div.card.hr-mwrap', list, detail));
  if (!sel) return fill(detail, h('div.empty', 'Nessun ruolo'));
  const r = await get(`/api/hr/mansionario/${sel}`);
  const isMine = (await get('/api/hr/percorso', { quiet: true }).catch(() => null))?.role?.id === r.id;
  fill(detail,
    h('div.hr-row.hr-between', h('div', h('h2', r.title), h('div.small.muted', `${d.families.find(f => f.key === r.hr_family)?.label} · v${r.version}${r.version_at ? ` in vigore dal ${itDate(String(r.version_at).slice(0, 10))}` : ''}`)),
      h('div.hr-row', r.band ? h('span.hr-chip', `G${r.grade} · ${k1(r.band.min)} – ${k1(r.band.mid)} – ${k1(r.band.max)} k€`) : null,
        d.is_hr ? h('button.btn.btn-sm', { type: 'button', on: { click: () => editRole(r, d.families, () => mansionarioView(c, params)) } }, icon('pencil', { size: 14 }), ' Modifica') : null)),
    h('div.hr-grid2',
      h('div', h('div.hr-label', 'Scopo del ruolo'), h('p', r.description || '—'),
        r.responsibilities?.length ? [h('div.hr-label', 'Responsabilità chiave'), h('ul', r.responsibilities.map(x => h('li', x)))] : null,
        r.hard_skills?.length ? [h('div.hr-label', 'Competenze richieste'), h('div.hr-row', r.hard_skills.map(x => h('span.hr-chip', x)))] : null,
        r.requirements?.length ? [h('div.hr-label', 'Requisiti di sicurezza e formazione'), h('div.hr-row', r.requirements.map(x => h('span.hr-chip.z-warn', x)))] : null),
      h('div',
        Object.keys(r.autonomy || {}).length ? [h('div.hr-label', 'Autonomia per complessità di commessa'),
          h('table.hr-t', h('tr', ['C1', 'C2', 'C3', 'C4', 'C5'].map(x => h('th', x))), h('tr', ['C1', 'C2', 'C3', 'C4', 'C5'].map(x => h('td', { title: AUT[r.autonomy[x] || 'none'][1] }, AUT[r.autonomy[x] || 'none'][0])))),
          h('div.small.muted', '● autonomo · ◐ con supervisione · ○ supporto · – fuori portata')] : null,
        h('div.hr-label', 'Per passare al livello successivo'), h('p', r.next_criteria || '—'),
        h('div.hr-label', 'Fascia'), h('p.small.muted', 'Arriva dalla griglia in vigore: non si modifica qui (Pannello di controllo › Ruoli → grade).'),
        isMine ? (r.my_ack ? h('span.hr-chip.z-ok', 'Hai firmato la presa visione di questa versione')
          : h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/hr/mansionario/${r.id}/presa-visione`); toast('Presa visione firmata'); mansionarioView(c, params); } } }, 'Firma la presa visione')) : null,
        r.people ? [h('div.hr-label', `Persone con questo ruolo (${r.people.length}) · solo team HR`),
          r.people.length ? h('div.small', r.people.map((p, i) => [i ? ', ' : '', h('a', { href: `#/hr/persona/${encodeURIComponent(p.key)}` }, p.nome), p.signed ? ' ✓' : ''])) : h('p.small.muted', 'Nessuno'),
          r.people.length ? h('div.small.muted', `Presa visione v${r.version}: ${r.people.filter(p => p.signed).length} di ${r.people.length}`) : null] : null)));
}

function editRole(r, families, done) {
  const f = {
    hr_family: h('select.select', families.map(x => h('option', { value: x.key, selected: r?.hr_family === x.key }, x.label))),
    hr_name: h('input.input', { value: r?.hr_name || '' }), hr_level: h('input.input', { value: r?.hr_level || '', placeholder: 'Junior, Senior… (anche vuoto)' }),
    grade: h('select.select', [1, 2, 3, 4, 5, 6, 7, 8].map(g => h('option', { value: g, selected: r?.grade === g }, `G${g}`))),
    description: h('textarea.input', { rows: 3 }, r?.description || ''),
    responsibilities: h('textarea.input', { rows: 4, placeholder: 'una per riga' }, (r?.responsibilities || []).join('\n')),
    hard_skills: h('input.input', { value: (r?.hard_skills || []).join(', '), placeholder: 'separate da virgola' }),
    requirements: h('input.input', { value: (r?.requirements || []).join(', '), placeholder: 'Preposto, PES…' }),
    next_criteria: h('textarea.input', { rows: 2 }, r?.next_criteria || ''),
  };
  const aut = Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5'].map(cx => [cx, h('select.select', Object.entries(AUT).map(([k, [s, l]]) => h('option', { value: k, selected: (r?.autonomy?.[cx] || 'none') === k }, `${s} ${l}`)))]));
  const fld = (label, el) => h('label.field', h('span', label), el);
  const m = modal({
    title: r ? `Modifica · ${r.title}` : 'Nuovo ruolo', wide: true,
    body: h('div.hr-form', h('div.hr-grid3', fld('Famiglia', f.hr_family), fld('Nome del ruolo', f.hr_name), fld('Livello', f.hr_level)),
      r ? null : fld('Grade', f.grade), fld('Scopo del ruolo', f.description), fld('Responsabilità chiave', f.responsibilities),
      h('div.hr-grid2', fld('Competenze', f.hard_skills), fld('Requisiti di sicurezza e formazione', f.requirements)),
      h('div.hr-label', 'Autonomia per complessità di commessa'), h('div.hr-grid5', Object.entries(aut).map(([k, el]) => fld(k, el))),
      fld('Per passare al livello successivo', f.next_criteria),
      r ? h('p.small.muted', `Salvando nasce la versione ${r.version + 1}: chi ha questo ruolo dovrà firmare di nuovo la presa visione.`) : null),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { hr_family: f.hr_family.value, hr_name: f.hr_name.value, hr_level: f.hr_level.value, description: f.description.value,
          responsibilities: f.responsibilities.value.split('\n').map(s => s.trim()).filter(Boolean), hard_skills: f.hard_skills.value.split(',').map(s => s.trim()).filter(Boolean),
          requirements: f.requirements.value.split(',').map(s => s.trim()).filter(Boolean), next_criteria: f.next_criteria.value,
          autonomy: Object.fromEntries(Object.entries(aut).map(([k, el]) => [k, el.value])) };
        if (r) await patch(`/api/hr/mansionario/${r.id}`, body); else await post('/api/hr/mansionario', { ...body, grade: Number(f.grade.value) });
        m.close(); toast(r ? `Salvata la versione ${r.version + 1}` : 'Ruolo creato'); done();
      } } }, r ? `Salva come v${r.version + 1}` : 'Crea')],
  });
}

// ── Persone (team HR) ───────────────────────────────────────────────────────────────────────────────────────
async function personeView(c, params) {
  const d = await get('/api/hr/persone');
  const q = h('input.input', { type: 'search', placeholder: 'Cerca…', value: params.get('q') || '' });
  const bu = await ambitoSelect(() => draw());
  const filt = h('select.select', [['', 'Tutti'], ['senza', 'Senza ruolo'], ['fuori', 'Fuori fascia'], ['esclusi', 'Fuori dalla griglia']].map(([k, l]) => h('option', { value: k, selected: params.get('f') === k }, l)));
  const body = h('tbody');
  const picked = new Set();
  const roleList = (await get('/api/hr/incarichi')).roles;
  const bulkRole = h('select.select', h('option', { value: '' }, 'Scegli il ruolo…'), roleList.map(r => h('option', { value: r.id }, `${r.title} · G${r.grade}`)));
  const bulkCount = h('b');
  const assign = async (keys, roleId) => {
    const r = await post('/api/hr/persone/ruolo', { keys, role_id: roleId });
    toast(`Ruolo assegnato a ${r.n} ${r.n === 1 ? 'persona' : 'persone'}${r.sugli_incarichi ? ` (${r.sugli_incarichi} sul loro incarico)` : ''}`);
    personeView(c, params);
  };
  const bulk = h('div.hr-bulk', { hidden: true }, bulkCount, bulkRole,
    h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => { if (!bulkRole.value) return toast('Scegli il ruolo', 'err'); assign([...picked], Number(bulkRole.value)); } } }, 'Assegna ruolo alle selezionate'),
    h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
      const groups = new Map();
      for (const k of picked) { const p = d.people.find(x => x.key === k); if (p?.proposed) (groups.get(p.proposed.id) || groups.set(p.proposed.id, []).get(p.proposed.id)).push(k); }
      if (!groups.size) return toast('Nessuna proposta ✦ fra le selezionate', 'err');
      for (const [roleId, keys] of groups) await post('/api/hr/persone/ruolo', { keys, role_id: roleId });
      toast('Proposte confermate'); personeView(c, params);
    } } }, 'Conferma le proposte ✦'));
  const syncBulk = () => { bulk.hidden = !picked.size; bulkCount.textContent = `${picked.size} selezionate`; };
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const rows = d.people.filter(p => (!t || `${p.nome} ${p.cognome} ${p.incarico?.nome || ''} ${p.qualifica || ''}`.toLowerCase().includes(t)) && inAmbito(p.area)
      && (filt.value !== 'senza' || (!p.role && !p.esclusione)) && (filt.value !== 'fuori' || ['sotto', 'sopra'].includes(p.position?.zone)) && (filt.value !== 'esclusi' || p.esclusione));
    fill(body, rows.length ? rows.map(p => h('tr', { on: { click: () => { location.hash = `#/hr/persona/${encodeURIComponent(p.key)}`; } } },
      h('td', { on: { click: e => e.stopPropagation() } }, p.esclusione ? null : h('input', { type: 'checkbox', checked: picked.has(p.key), 'aria-label': `Seleziona ${p.nome} ${p.cognome}`, on: { change: e => { if (e.target.checked) picked.add(p.key); else picked.delete(p.key); syncBulk(); } } })),
      h('td', h('b', `${p.cognome} ${p.nome}`)), h('td', p.incarico?.nome || h('span.muted', p.qualifica || '—')), h('td', p.bu || '—'),
      h('td.small', [p.ccnl, p.livello].filter(Boolean).join(' · ') || '—'), h('td.small', [p.contratto, p.part_time_pct < 100 ? `part-time ${p.part_time_pct}%` : null, p.scadenza ? `→ ${itDate(p.scadenza)}` : null].filter(Boolean).join(' · ') || '—'),
      h('td', p.esclusione ? h('span.hr-chip', EXCL[p.esclusione]) : p.role ? p.role.title : p.proposed
        ? h('span.hr-row', { on: { click: e => e.stopPropagation() } }, h('span.hr-chip.z-ai', { title: p.proposed.why }, `✦ ${p.proposed.title}?`),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => assign([p.key], p.proposed.id) } }, 'Conferma'))
        : h('span.hr-chip.z-warn', 'senza ruolo')),
      h('td', p.role && !p.esclusione ? `G${p.role.grade}` : '—'), h('td', p.esclusione ? '—' : zoneChip(p.position))))
      : h('tr', h('td.empty', { colSpan: 9 }, d.people.length ? 'Nessuno con questi filtri' : 'Ancora nessuna persona: carica l\'export mensile di BOSS')));
    count.textContent = `${rows.length} di ${d.people.length}`;
  };
  const count = h('span.muted');
  [q, filt].forEach(el => el.addEventListener('input', draw));
  const senza = d.people.filter(p => !p.role && !p.esclusione).length;
  fill(c, head('Persone', 'Anagrafica da BOSS (sola lettura) con il ruolo del mansionario e la posizione in fascia.',
    h('div.hr-row', h('button.btn', { type: 'button', on: { click: () => importPeople(() => personeView(c, params)) } }, icon('upload', { size: 16 }), ' Carica export BOSS'),
      d.boss_api ? h('button.btn', { type: 'button', on: { click: async () => { const r = await post('/api/hr/boss/sync'); toast(r.ok ? `${r.n} persone da BOSS` : r.reason, r.ok ? 'ok' : 'err'); personeView(c, params); } } }, icon('refresh-cw', { size: 16 }), ' Aggiorna da BOSS') : null)),
    lockBar('Vista del team HR: la posizione in fascia non arriva a nessun altro.'),
    bulk,
    h('div.hr-row.hr-filters', q, bu, filt, count, h('span.hr-chip', d.synced_at ? `ultimo aggiornamento ${fmtDateTime(d.synced_at)}` : 'mai caricato'),
      senza ? h('a.hr-chip.z-warn', { href: '#/hr/ruoli' }, `${senza} senza ruolo → assegna`) : null),
    h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['', 'Persona', 'Incarico ⟳', 'BU ⟳', 'CCNL · livello ⟳', 'Contratto ⟳', 'Ruolo', 'Grade', 'Posizione in fascia'].map(x => h('th', x)))), body)),
    h('p.small.muted', '⟳ = arriva da BOSS: oggi con l\'export mensile, poi via API ogni notte. Part-time riportati a tempo pieno per il confronto con la fascia.'));
  draw();
}

function pickFile() {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.click();
  });
}
async function importPeople(done) {
  const file = await pickFile();
  if (!file) return;
  const buf = await file.arrayBuffer();
  const pre = (await api('POST', '/api/hr/import/persone', buf, { raw: true })).preview;
  const m = modal({
    title: 'Export mensile di BOSS · anteprima',
    body: h('div', h('p', `Foglio «${pre.sheet}» · ${pre.total} persone`), h('ul',
      h('li', `${pre.nuove} nuove, ${pre.aggiornate} aggiornate, ${pre.non_piu_presenti} non più nell'elenco (passano a non attive)`),
      h('li', `${pre.con_ral} con RAL · ${pre.part_time} part-time · ${pre.escluse} fuori dalla griglia (operai, apprendisti, tirocini, staff leasing)`)),
      h('p.small.muted', `Colonne riconosciute: ${pre.columns.join(', ')}`),
      pre.problems.length ? h('div', h('div.hr-label', 'Da controllare'), h('ul', pre.problems.slice(0, 10).map(p => h('li', `riga ${p.riga}: ${p.problema}`)))) : null),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await api('POST', '/api/hr/import/persone?applica=1', buf, { raw: true }); m.close(); toast('Persone caricate'); done(); } } }, 'Carica')],
  });
}

// ── Scheda persona (team HR) ────────────────────────────────────────────────────────────────────────────────
async function personaView(c, key) {
  const [d, roles] = await Promise.all([get(`/api/hr/persone/${encodeURIComponent(key)}`), get('/api/hr/incarichi').then(x => x.roles)]);
  const p = d.person;
  const k = p.ral ? (p.part_time_pct < 100 ? p.ral / (p.part_time_pct / 100) : p.ral) / 1000 : null;
  const roleSel = h('select.select', h('option', { value: '' }, '— nessuno —'), roles.map(r => h('option', { value: r.id, selected: d.role?.id === r.id }, `${r.title} · G${r.grade}`)));
  const exclSel = h('select.select', h('option', { value: '' }, 'Nella griglia'), Object.entries(EXCL).map(([kx, l]) => h('option', { value: kx, selected: p.esclusione === kx }, l)));
  roleSel.addEventListener('change', async () => { await patch(`/api/hr/persone/${encodeURIComponent(key)}`, { role_id: roleSel.value ? Number(roleSel.value) : null }); toast('Ruolo salvato'); personaView(c, key); });
  exclSel.addEventListener('change', async () => { await patch(`/api/hr/persone/${encodeURIComponent(key)}`, { esclusione: exclSel.value || null }); toast('Salvato'); personaView(c, key); });
  fill(c, h('a.hr-back', { href: '#/hr/persone' }, '‹ Persone'),
    head(`${p.nome} ${p.cognome}`, [p.incarico?.nome || p.qualifica, p.incarico?.area || p.bu, p.societa, p.data_assunzione ? `in azienda dal ${itDate(p.data_assunzione)}` : null].filter(Boolean).join(' · ')),
    p.boss_url ? h('div.hr-row', { style: { marginBottom: '8px' } }, h('a.btn.btn-sm', { href: p.boss_url, target: '_blank', rel: 'noopener' }, 'Modifica su BOSS ↗')) : null,
    lockBar('Retribuzione visibile solo al team HR · questa apertura è registrata nel Registro.'),
    h('div.hr-grid3',
      h('div.hr-kpi', h('div.l', 'RAL attuale ⟳'), h('div.v', eur(p.ral)), h('div.small.muted', p.ral_dal ? `da BOSS · valida dal ${itDate(p.ral_dal)}` : 'nessuna RAL da BOSS'),
        p.part_time_pct < 100 ? h('div.small', `part-time ${p.part_time_pct}% → a tempo pieno ${eur(k * 1000)}`) : null),
      h('div.hr-kpi', h('div.l', 'Ruolo · grade'), h('div.v.v-s', d.role ? `${d.role.title} · G${d.role.grade}` : 'senza ruolo'), d.band ? h('div.small.muted', `fascia ${k1(d.band.min)} – ${k1(d.band.mid)} – ${k1(d.band.max)} k€`) : null),
      h('div.hr-kpi', h('div.l', 'Posizione in fascia'), h('div.v', d.position ? `${d.position.pct}%` : '—'), zoneChip(d.position))),
    h('div.hr-grid32',
      h('div.card.hr-pad',
        d.band ? [h('div.hr-label', `Dove sta nella fascia G${d.role.grade}`), zoneBar(d.band, k),
          howTo('La barra è la fascia del grade, dal minimo (sinistra) al massimo (destra). La riga scura al centro è il ', h('b', 'riferimento'), ': la RAL giusta per chi fa bene quel ruolo. Il pallino è la RAL della persona (a tempo pieno). Giallo = ', h('b', 'ingresso'), ' (sotto il 90%), verde = ', h('b', 'in linea'), ' (90–110%), arancio = ', h('b', 'alta'), ' (sopra il 110%). Fuori dalla barra = anomalia.')] : h('p.muted', 'Senza ruolo non c\'è una fascia: assegnalo qui sotto o sull\'incarico.'),
        d.peers ? [h('div.hr-label', 'Confronto con chi ha lo stesso ruolo'), h('p.small', `${d.peers.n} persone · mediana ${eur(d.peers.median)}${d.peers.percentile != null ? ` · è al ${d.peers.percentile}° percentile` : ''} (solo statistiche, nessun nome)`)] : null,
        h('div.hr-grid2', h('label.field', h('span', p.incarico ? 'Ruolo (viene dall\'incarico: cambialo in Ruoli sugli incarichi)' : 'Ruolo della persona'), p.incarico ? h('div', d.role?.title || '—') : roleSel),
          h('label.field', h('span', 'Griglia'), exclSel))),
      h('div.card.hr-pad', h('div.hr-label', 'Storico ⟳ (da BOSS)'),
        d.history.length ? h('table.hr-t', h('tr', h('th', 'Dal'), h('th', 'RAL'), h('th', 'Ad personam')), d.history.map(x => h('tr', h('td', itDate(x.valid_from)), h('td', eur(x.ral)), h('td', x.ad_personam ? eur(x.ad_personam) : '—')))) : h('p.muted', 'Nessuna retribuzione'),
        d.totale ? [h('div.hr-label', 'Retribuzione totale (stima)'), h('table.hr-t',
          h('tr', h('td', 'RAL ⟳'), h('td', eur(d.totale.ral))), h('tr', h('td', 'Ad personam ⟳'), h('td', d.totale.ad_personam ? eur(d.totale.ad_personam) : '—')),
          h('tr', h('td', `Premio variabile target (${d.variabile.pct[0]}–${d.variabile.pct[1]}%)`), h('td', eur(d.totale.variabile_target))), h('tr', h('td', h('b', 'Totale')), h('td', h('b', eur(d.totale.totale))))),
          h('p.small.muted', `Premio su: ${d.variabile.su}. Welfare, auto e indennità di trasferta compariranno quando BOSS li passerà ad Alma.`)] : null,
        d.promotion ? [h('div.hr-label', `Se diventasse ${d.promotion.title} (G${d.promotion.grade})`), h('p.small', `Regola delle promozioni: il valore più alto tra il minimo del nuovo grade (${k1(d.promotion.band.min)} k€) e la RAL attuale + la % del pannello → `, h('b', eur(d.promotion.ral)))] : null,
        d.ccnl_link ? h('p.small.muted', `Livello CCNL collegato al grade: ${d.ccnl_link.link} · minimo ${k1(d.ccnl_link.minimo)} k€`) : null)));
}

// ── Ruoli sugli incarichi (team HR) ─────────────────────────────────────────────────────────────────────────
async function ruoliView(c, params) {
  const d = await get('/api/hr/incarichi');
  const areas = [...new Set(d.incarichi.map(i => i.area).filter(Boolean))].sort();
  const area = h('select.select', h('option', { value: '' }, 'Tutte le aree'), areas.map(a => h('option', { value: a, selected: params.get('area') === a }, a)));
  const only = h('select.select', h('option', { value: 'todo' }, 'Solo da fare'), h('option', { value: '' }, 'Tutti'));
  const body = h('tbody');
  const roleOpts = sel => [h('option', { value: '' }, 'Scegli ruolo…'), ...d.roles.map(r => h('option', { value: r.id, selected: sel === r.id }, `${r.title} · G${r.grade}`))];
  const confirm = async items => { await post('/api/hr/incarichi/conferma', { items }); toast(items.length === 1 ? 'Ruolo confermato' : `${items.length} ruoli confermati`); ruoliView(c, params); };
  const draw = () => {
    const rows = d.incarichi.filter(i => (!area.value || i.area === area.value) && (only.value !== 'todo' || !i.role_id));
    fill(body, rows.length ? rows.map(i => {
      const s = h('select.select.select-sm', roleOpts(i.role_id || i.proposed_id));
      s.addEventListener('change', () => { if (s.value) confirm([{ incarico_id: i.id, role_id: Number(s.value) }]); });
      return h('tr', h('td', h('b', i.nome)), h('td', i.persona || h('span.hr-chip.z-warn', 'vacante')), h('td.small.muted', i.qualifica || i.area || '—'),
        h('td', i.role ? h('span.hr-chip.z-ok', `${i.role} ✓`) : i.proposed ? h('span.hr-chip.z-ai', { title: i.proposed_why || '' }, `✦ ${i.proposed}`) : h('span.muted', '—'),
          i.proposed_why && !i.role ? h('div.small.muted', i.proposed_why) : null),
        h('td.hr-row', i.proposed && !i.role ? h('button.btn.btn-sm', { type: 'button', on: { click: () => confirm([{ incarico_id: i.id, role_id: i.proposed_id }]) } }, '✓') : null, s));
    }) : h('tr', h('td.empty', { colSpan: 5 }, d.total ? 'Tutto fatto con questi filtri' : 'Nessun incarico: l\'organigramma a incarichi è vuoto (Impostazioni › Organigramma).')));
  };
  [area, only].forEach(el => el.addEventListener('input', draw));
  const props = d.incarichi.filter(i => !i.role_id && i.proposed_id);
  fill(c, head('Ruoli sugli incarichi', 'Ogni incarico riceve un ruolo del mansionario: il ruolo sta sull\'incarico, non sulla persona. Le proposte ✦ non si applicano senza il tuo ✓.',
    h('div.hr-row', h('button.btn', { type: 'button', on: { click: () => importV11(() => ruoliView(c, params)) } }, icon('upload', { size: 16 }), ' Importa mappatura v11'),
      props.length ? h('button.btn.btn-primary', { type: 'button', on: { click: async () => { if (await confirmDialog(`Confermare le ${props.length} proposte?`)) confirm(props.map(i => ({ incarico_id: i.id, role_id: i.proposed_id }))); } } }, `Conferma le ${props.length} proposte ✦`) : null)),
    h('div.hr-row.hr-filters', h('b', `${d.done} di ${d.total} incarichi`), h('div.hr-prog', h('span', { style: { width: `${d.total ? d.done / d.total * 100 : 0}%` } })), area, only),
    h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Incarico (BOSS)', 'Chi lo ricopre', 'Qualifica / area', 'Ruolo', ''].map(x => h('th', x)))), body)),
    h('p.small.muted', 'Le proposte vengono dalla mappatura v11 importata, tradotta nella griglia nuova (capi zona → Capo zona reti, capi funzione → Responsabile di Funzione…), e dagli incarichi con lo stesso nome già confermati.'));
  draw();
}
async function importV11(done) {
  const file = await pickFile();
  if (!file) return;
  const buf = await file.arrayBuffer();
  const pre = await api('POST', '/api/hr/import/v11', buf, { raw: true });
  const s = pre.summary;
  const m = modal({
    title: 'Mappatura v11 · anteprima', wide: true,
    body: h('div', h('p', `${s.righe} righe · ${s.trovate} persone trovate tra quelle di BOSS · ${s.con_incarico} con un incarico · ${s.senza_ruolo} senza traduzione`),
      h('div.hr-scroll', { style: { maxHeight: '50vh' } }, h('table.hr-t', h('tr', ['Persona', 'Foglio', 'Nella v11', 'Diventa', 'Perché', ''].map(x => h('th', x))),
        pre.rows.map(r => h('tr', h('td', r.persona), h('td.small', r.foglio), h('td.small', r.inquadramento_v11 || '—'), h('td', r.ruolo || h('span.muted', '—')), h('td.small.muted', r.perche || ''),
          h('td.small', !r.trovata ? h('span.hr-chip.z-warn', 'non trovata') : r.gia_confermato ? 'già confermato' : r.incarico ? 'proposta sull\'incarico' : 'sulla persona')))))),
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => { await api('POST', '/api/hr/import/v11?applica=1', buf, { raw: true }); m.close(); toast('Proposte caricate: confermale una per una o tutte insieme'); done(); } } }, 'Carica le proposte')],
  });
}

// ── Mappatura (team HR) ─────────────────────────────────────────────────────────────────────────────────────
function scatter(people, onPick) {
  const W = 760, H = 320, L = 44, B = 26, T = 8;
  const y = pct => T + (1 - (Math.max(55, Math.min(150, pct)) - 55) / 95) * (H - B - T);
  const x = g => L + (g - 0.5) / 8 * (W - L - 8);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hr-scatter', role: 'img', 'aria-label': 'Posizione in fascia di ogni persona per grade' });
  s.append(svg('rect', { x: L, y: y(110), width: W - L - 8, height: y(90) - y(110), class: 'hr-sc-band' }));
  for (const v of [60, 80, 100, 120, 140]) s.append(svg('line', { x1: L, x2: W - 8, y1: y(v), y2: y(v), class: 'hr-sc-grid' }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'hr-sc-t' }, `${v}%`));
  for (let g = 1; g <= 8; g++) s.append(svg('text', { x: x(g), y: H - 6, 'text-anchor': 'middle', class: 'hr-sc-t' }, `G${g}`));
  s.append(svg('text', { x: W - 10, y: y(110) - 5, 'text-anchor': 'end', class: 'hr-sc-t hr-sc-ok' }, 'in linea 90–110%'));
  people.forEach((p, i) => {
    const jitter = ((i * 37) % 21 - 10) * 2.2;
    const z = p.zone === 'sotto' ? 'bad' : p.zone === 'sopra' ? 'hi' : 'ok';
    const dot = svg('circle', { cx: x(p.grade) + jitter, cy: y(p.pct), r: 5, class: `hr-sc-dot z-${z}`, tabindex: 0, role: 'button', 'aria-label': `${p.nome}, ${p.pct}%` }, svg('title', {}, `${p.nome} · ${p.role} · ${p.pct}%`));
    dot.addEventListener('click', () => onPick(p));
    dot.addEventListener('keydown', e => { if (e.key === 'Enter') onPick(p); });
    s.append(dot);
  });
  return s;
}
async function mappaturaView(c) {
  const d = await get(`/api/hr/mappatura?${ambQs()}`);
  const amb = await ambitoSelect(() => mappaturaView(c));
  const st = d.stats;
  const tbody = h('tbody');
  const filt = h('select.select', [['fuori', 'Fuori fascia'], ['sotto', 'Sotto il minimo'], ['sopra', 'Sopra il massimo'], ['ruolo', 'Ruolo forse sbagliato'], ['', 'Tutti']].map(([kx, l]) => h('option', { value: kx }, l)));
  const draw = () => {
    const rows = d.people.filter(p => filt.value === '' || (filt.value === 'fuori' ? ['sotto', 'sopra'].includes(p.zone) : filt.value === 'ruolo' ? p.wrong : p.zone === filt.value)).sort((a, b) => a.pct - b.pct);
    const anno = new Date().getFullYear() + 1;
    const planSel = p => {
      const sel = h('select.select.select-sm', { 'aria-label': `Piano di rientro di ${p.nome}` }, h('option', { value: '' }, 'Nessun piano'),
        [anno, anno + 1, anno + 2].flatMap(y => [h('option', { value: `${y}|tutto`, selected: p.rientro?.anno === y && p.rientro.quota === 'tutto' }, `${y} · tutto`),
          h('option', { value: `${y}|meta`, selected: p.rientro?.anno === y && p.rientro.quota === 'meta' }, `${y} e ${y + 1} · metà e metà`)]));
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', async () => {
        const [y, qq] = sel.value.split('|');
        await api('PUT', `/api/hr/rientro/${encodeURIComponent(p.key)}`, sel.value ? { anno: Number(y), quota: qq } : { anno: null });
        toast('Piano salvato'); mappaturaView(c);
      });
      return sel;
    };
    fill(tbody, rows.length ? rows.map(p => h('tr', { on: { click: () => { location.hash = `#/hr/persona/${encodeURIComponent(p.key)}`; } } },
      h('td', h('b', p.nome)), h('td', `${p.role} · G${p.grade}`), h('td', eur(p.ralFte)), h('td.small', `${k1(p.band.min)} – ${k1(p.band.mid)} – ${k1(p.band.max)}`), h('td', zoneChip(p)), h('td', p.toMin ? `+${eur(p.toMin)}` : '—'),
      h('td', p.toMin ? planSel(p) : null)))
      : h('tr', h('td.empty', { colSpan: 7 }, 'Nessuno')));
  };
  filt.addEventListener('input', draw);
  const eq = st.equity.filter(e => e.gap !== null);
  fill(c, head('Mappatura', `Dove sta ognuno nella sua fascia, chi è fuori e quanto costa sistemare. ${d.senza_ruolo ? `${d.senza_ruolo} persone senza ruolo non sono contate.` : ''}`),
    lockBar('Vista del team HR · registrata.'),
    h('div.hr-row.hr-filters', amb, h('span.small.muted', 'Numeri, grafico, anomalie, equità e piano di rientro si ricalcolano sull\'ambito.')),
    h('div.hr-grid32',
      h('div.card.hr-pad', scatter(d.people, p => { location.hash = `#/hr/persona/${encodeURIComponent(p.key)}`; }),
        howTo('Ogni pallino è una persona. In orizzontale il suo grade, in verticale quanto guadagna (a tempo pieno) rispetto al riferimento del grade: 100% = esattamente il riferimento. La fascia verde è la zona «in linea» (90–110%). ',
          h('span.z-bad-t', 'Rosso'), ' = sotto il minimo, da far crescere; ', h('span.z-ok-t', 'verde'), ' = dentro la fascia; ', h('span.z-hi-t', 'ambra'), ' = sopra il massimo, vicino al tetto. Clic su un pallino: si apre la scheda.')),
      h('div',
        h('div.hr-grid2',
          h('div.hr-kpi', h('div.l', 'Sotto il minimo'), h('div.v', st.below), h('div.small.muted', `rientro: ${eur(st.cost)} l'anno`)),
          h('div.hr-kpi', h('div.l', 'Sopra il massimo'), h('div.v', st.above), h('div.small.muted', 'solo premi, niente aumenti di base')),
          h('div.hr-kpi', h('div.l', 'Dentro la fascia'), h('div.v', `${st.inPct}%`), h('div.small.muted', `${st.counted} persone contate`)),
          h('div.hr-kpi', h('div.l', 'Divario donne/uomini'), h('div.v', st.gap == null ? '—' : `${st.gap > 0 ? '+' : ''}${k1(st.gap)}%`), h('div.small.muted', `a parità di grade · allarme oltre ${d.rules.equityAlarm}%`))),
        h('div.card.hr-pad', h('div.hr-label', 'Equità per grade'), eq.length ? h('table.hr-t', h('tr', h('th', 'Grade'), h('th', 'Donne'), h('th', 'Uomini'), h('th', 'Divario')),
          eq.map(e => h('tr', h('td', `G${e.grade}`), h('td', e.f), h('td', e.m), h('td', Math.abs(e.gap) > d.rules.equityAlarm ? h('span.hr-chip.z-bad', `${k1(e.gap)}%`) : `${k1(e.gap)}%`)))) : h('p.small.muted', 'Servono donne e uomini nello stesso grade per calcolarlo.'),
          h('p.small.muted', `${d.esclusi} fuori dalla griglia · ${d.senza_ral} senza RAL da BOSS`)))),
    h('div.hr-row.hr-filters', h('b', 'Anomalie'), filt),
    h('div.card.hr-pad', h('div.hr-label', 'Piano di rientro per anno'),
      Object.keys(d.rientro_per_anno || {}).length ? h('div.hr-row', Object.entries(d.rientro_per_anno).sort().map(([y, v]) => h('span.hr-chip.z-hi', `${y}: +${eur(v)}`))) : h('p.small.muted', 'Ancora nessun piano: sceglilo nella tabella qui sotto, persona per persona.'),
      d.rientro_senza_piano ? h('p.small', `${d.rientro_senza_piano} persone sotto il minimo non hanno ancora un piano.`) : null,
      h('p.small.muted', 'Il costo per anno entra nel budget della revisione retributiva (Fase 5).')),
    h('div.card.hr-scroll', h('table.list', h('thead', h('tr', ['Persona', 'Ruolo · grade', 'RAL a tempo pieno', 'Fascia k€', 'Posizione', 'Per arrivare al minimo', 'Piano di rientro'].map(x => h('th', x)))), tbody)));
  draw();
}

// ── Pannello di controllo (team HR) ─────────────────────────────────────────────────────────────────────────
async function pannelloView(c, params) {
  const d = await get('/api/hr/pannello');
  const tab = params.get('tab') || 'fasce';
  const draft = d.versions.find(v => !v.applied_at);
  const base = draft || d.current;
  const tabs = [['fasce', 'Grade e fasce'], ['ruoli', 'Ruoli → grade'], ['regole', 'Zone, soglie, offerte'], ['merito', 'Merito e promozioni'], ['variabile', 'Premio variabile'], ['ccnl', 'Minimi CCNL e mercato'], ['versioni', 'Versioni']];
  const body = h('div');
  fill(c, head('Pannello di controllo del salary grade', 'Un solo posto per tutti i numeri: griglia, schede, mappatura, mansionario e offerte li leggono da qui. Cambi un numero una volta, cambia ovunque. Le RAL restano su BOSS.',
    h('a.btn', { href: '#/hr/insieme' }, icon('grid-3x3', { size: 16 }), ' Vista d\'insieme')),
    h('div.hr-row.hr-filters', h('span.hr-chip.z-ok', `In vigore: ${d.current.label} dal ${itDate(d.current.valid_from)}`), draft ? h('span.hr-chip.z-warn', `Bozza aperta: ${draft.label}`) : null,
      d.check.warnings.length ? h('span.hr-chip.z-warn', `${d.check.warnings.length} avvisi sulla griglia in vigore`) : null,
      await ambitoSelect(() => pannelloView(c, params)), h('span.small.muted', 'L\'impatto si calcola sulle persone dell\'ambito; la griglia vale per tutta l\'azienda.')),
    h('div.hr-tabs', tabs.map(([kx, l]) => h('a', { href: `#/hr/pannello?tab=${kx}`, class: kx === tab ? 'on' : '' }, l))), body);
  if (tab === 'ruoli') return panRoles(body, d, c, params);
  if (tab === 'versioni') return panVersions(body, d, c, params);
  return panEdit(body, d, base, tab, c, params);
}

function numInput(val, on, step = 0.5) {
  const i = h('input.input.hr-num', { type: 'number', step, value: val });
  i.addEventListener('input', () => on(Number(i.value)));
  return i;
}
// Fasce e regole: si modifica una copia, l'impatto si ricalcola sulle persone vere, poi si salva come bozza.
function panEdit(body, d, base, tab, c, params) {
  const draft = d.versions.find(v => !v.applied_at);
  const state = { bands: base.bands.map(b => ({ ...b })), rules: JSON.parse(JSON.stringify({ ...d.defaults.rules, ...base.rules })), params: base.params || {} };
  const impact = h('div.card.hr-pad', loading());
  const warn = h('div');
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const r = await post('/api/hr/pannello/impatto', { bands: state.bands, rules: state.rules, ambito: getAmbito() }, { quiet: true }).catch(e => ({ error: e.message }));
    if (r.error) return fill(impact, h('p', r.error));
    fill(warn, [...r.check.errors.map(e => h('div.hr-alert.bad', icon('alert-triangle', { size: 14 }), h('span', e, ' — non si può salvare'))), ...r.check.warnings.map(w => h('div.hr-alert.warn', icon('alert-triangle', { size: 14 }), h('span', w)))]);
    const row = (l, a, b, fmt = x => x) => h('tr', h('td', l), h('td', fmt(a)), h('td', h('b', fmt(b))));
    fill(impact, h('div.hr-label', 'Impatto rispetto alla griglia in vigore'),
      h('table.hr-t', h('tr', h('th', ''), h('th', 'In vigore'), h('th', 'Così')),
        row('Persone che cambiano zona', '—', r.moved), row('Sotto il minimo', r.before.below, r.after.below), row('Sopra il massimo', r.before.above, r.after.above),
        row('Dentro la fascia', `${r.before.inPct}%`, `${r.after.inPct}%`), row('Costo di rientro / anno', r.before.cost, r.after.cost, eur), row('Sovrapposizione media', `${r.before.overlapAvg}%`, `${r.after.overlapAvg}%`)),
      h('div.hr-label', 'Quando applichi, si aggiorna'),
      h('ul.hr-where', ['Salary grade per tutti', 'Persone e schede (posizione in fascia)', 'Mappatura e anomalie', 'Mansionario (fascia dei ruoli)', 'Il mio percorso', 'Recruitment (Fase 3): fascia negli annunci e controlli sulle offerte', 'Organigramma (Fase 2): costo dei vacanti', 'Revisione retributiva (Fase 5): budget e merito'].map(x => h('li', icon('check', { size: 14 }), x))));
  }, 250); };
  let editor;
  if (tab === 'fasce') {
    editor = h('table.hr-t.hr-edit', h('tr', ['Grade', 'Min k€', 'Riferimento k€', 'Max k€', 'Ampiezza', 'Salto'].map(x => h('th', x))),
      state.bands.map((b, i) => {
        const amp = h('td.small.muted'); const step = h('td.small.muted');
        const upd = () => { amp.textContent = `${Math.round((b.max - b.min) / b.min * 100)}%`; step.textContent = i ? `+${Math.round((b.mid / state.bands[i - 1].mid - 1) * 100)}%` : '—'; };
        upd();
        const set = kx => v => { b[kx] = v; upd(); refresh(); };
        return h('tr', h('td', h('b', `G${b.grade}`)), h('td', numInput(b.min, set('min'))), h('td', numInput(b.mid, set('mid'))), h('td', numInput(b.max, set('max'))), amp, step);
      }));
  } else if (tab === 'regole') {
    const r = state.rules;
    const pair = (obj, kx, label) => h('label.field', h('span', label), numInput(obj[kx], v => { obj[kx] = v; refresh(); }, 1));
    editor = h('div.hr-form',
      h('div.hr-label', 'Zone della fascia (% del riferimento)'), h('div.hr-grid2', pair(r.zone, 'low', 'Ingresso sotto il'), pair(r.zone, 'high', 'Alta sopra il')),
      h('div.hr-label', '«Ruolo forse sbagliato»'), h('div.hr-grid2', pair(r.wrongRole, 'low', 'sotto il'), pair(r.wrongRole, 'high', 'sopra il')),
      h('div.hr-grid2', pair(r, 'equityAlarm', 'Allarme divario donne/uomini (%)'),
        h('label.field', h('span', 'Costo azienda = RAL × (contributi, TFR, INAIL)'), numInput(r.costCoeff ?? 1.38, v => { r.costCoeff = v; refresh(); }, 0.01))),
      h('div.hr-label', 'Regole della griglia (avvisi)'), h('div.hr-grid2',
        h('label.field', h('span', 'Salto tra grade min–max %'), h('div.hr-row', numInput(r.stepRange[0], v => { r.stepRange[0] = v; refresh(); }, 1), numInput(r.stepRange[1], v => { r.stepRange[1] = v; refresh(); }, 1))),
        h('label.field', h('span', 'Sovrapposizione min–max %'), h('div.hr-row', numInput(r.overlapRange[0], v => { r.overlapRange[0] = v; refresh(); }, 1), numInput(r.overlapRange[1], v => { r.overlapRange[1] = v; refresh(); }, 1)))),
      h('div.hr-label', 'Chi approva un\'offerta'), h('table.hr-t', h('tr', h('td', 'Fino al riferimento'), h('td', 'Team HR')), h('tr', h('td', 'Fino al massimo'), h('td', 'Team HR + Responsabile di BU')), h('tr', h('td', 'Fuori fascia'), h('td', 'Direzione, con motivo scritto'))),
      h('div.hr-label', 'Fuori dalla griglia'), h('p.small', Object.values(EXCL).join(' · ')),
      h('div.hr-label', 'Chi decide'), h('p.small', 'Il team HR propone, la Direzione approva. Ottobre: bozza della griglia · novembre: approvazione · dicembre: calibrazione · gennaio: in vigore e aumenti.'));
  } else if (tab === 'merito') {
    const r = state.rules;
    editor = h('div.hr-form', h('div.hr-label', 'Matrice di merito: aumento % per voto (1–10) e zona'),
      h('table.hr-t.hr-edit', h('tr', h('th', 'Voto'), h('th', 'Ingresso'), h('th', 'In linea'), h('th', 'Alta')),
        Object.keys(r.merit).map(row => h('tr', h('td', h('b', row)), r.merit[row].map((v, i) => h('td', numInput(v, x => { r.merit[row][i] = x; refresh(); }, 0.5)))))),
      h('div.hr-grid2', h('label.field', h('span', 'Promozione: RAL attuale + %'), numInput(r.promoPct, v => { r.promoPct = v; refresh(); }, 0.5)),
        h('label.field', h('span', 'Budget aumenti (% del monte salari)'), numInput(r.budgetPct, v => { r.budgetPct = v; refresh(); }, 0.1))),
      h('p.small.muted', 'Promozione: il valore più alto tra il minimo del nuovo grade e la RAL attuale + questa %. La matrice e il budget servono alla revisione retributiva (Fase 5).'));
  } else if (tab === 'variabile') {
    const r = state.rules;
    r.variabile ||= {}; r.variabileSu ||= {};
    editor = h('div.hr-form', h('div.hr-label', 'Premio variabile target, in % della RAL'),
      h('table.hr-t.hr-edit', h('tr', h('th', 'Grade'), h('th', 'Da %'), h('th', 'A %'), h('th', 'Su cosa si misura')),
        [1, 2, 3, 4, 5, 6, 7, 8].map(g => {
          r.variabile[g] ||= [0, 0];
          const su = h('input.input', { value: r.variabileSu[g] || '' });
          su.addEventListener('input', () => { r.variabileSu[g] = su.value; });
          return h('tr', h('td', h('b', `G${g}`)), h('td', numInput(r.variabile[g][0], v => { r.variabile[g][0] = v; }, 1)), h('td', numInput(r.variabile[g][1], v => { r.variabile[g][1] = v; }, 1)), h('td', su));
        })),
      h('p.small.muted', 'La sicurezza è un cancello: con un infortunio grave per colpa organizzativa il premio legato alla commessa non scatta. Valutate anche il premio di risultato detassato e la conversione in welfare. Nella scheda persona la retribuzione totale usa la metà della forchetta.'));
  } else {
    const r = state.rules;
    editor = h('div.hr-form', h('p.small.muted', 'Il minimo di fascia non può scendere sotto il minimo tabellare del livello CCNL collegato (blocca il salvataggio). I minimi arriveranno da BOSS (ParametroLivello); il mercato da una fonte annuale.'),
      h('table.hr-t.hr-edit', h('tr', h('th', 'Grade'), h('th', 'Livello CCNL collegato'), h('th', 'Minimo CCNL k€'), h('th', 'Mercato (mediana) k€')),
        [1, 2, 3, 4, 5, 6, 7, 8].map(g => {
          r.ccnl[g] ||= { minimo: 0, link: '' };
          const link = h('input.input', { value: r.ccnl[g].link || '' });
          link.addEventListener('input', () => { r.ccnl[g].link = link.value; });
          return h('tr', h('td', h('b', `G${g}`)), h('td', link), h('td', numInput(r.ccnl[g].minimo, v => { r.ccnl[g].minimo = v; refresh(); }, 0.1)), h('td', numInput(r.market[g], v => { r.market[g] = v; }, 0.5)));
        })));
  }
  const label = h('input.input', { value: draft?.label || `Griglia ${new Date().getFullYear() + 1}` });
  const save = async () => {
    const r = await post('/api/hr/pannello/bozza', { id: draft?.id, label: label.value, bands: state.bands, rules: state.rules, params: state.params });
    toast(r.warnings?.length ? `Bozza salvata con ${r.warnings.length} avvisi` : 'Bozza salvata');
    location.hash = '#/hr/pannello?tab=versioni';
  };
  fill(body, h('div.hr-grid32', h('div.card.hr-pad', editor, warn,
    h('div.hr-row.hr-savebar', h('label.field', h('span', 'Nome della bozza'), label), h('button.btn.btn-primary', { type: 'button', on: { click: save } }, draft ? 'Aggiorna la bozza' : 'Salva come bozza'),
      h('span.small.muted', 'Applicarla (subito o da una data) si fa in Versioni.'))), impact));
  refresh();
}

function panRoles(body, d, c, params) {
  const fams = [...new Set(d.roles.map(r => r.family))];
  fill(body, h('div.card.hr-pad', h('p.small.muted', 'Spostare un ruolo di grade sposta tutte le persone di quel ruolo, subito. Il vertice del binario Field deve restare sotto il PM Senior.'),
    h('table.hr-t.hr-edit', h('tr', h('th', 'Ruolo'), h('th', 'Famiglia'), h('th', 'Persone'), h('th', 'Grade')),
      fams.flatMap(f => d.roles.filter(r => r.family === f).map(r => {
        const s = h('select.select.select-sm', [1, 2, 3, 4, 5, 6, 7, 8].map(g => h('option', { value: g, selected: r.grade === g }, `G${g}`)));
        s.addEventListener('change', async () => {
          if (!(await confirmDialog(`Spostare «${r.title}» in G${s.value}? ${r.people ? `Cambia la fascia di ${r.people} persone.` : ''}`))) { s.value = r.grade; return; }
          try { await patch(`/api/hr/mansionario/${r.id}/grade`, { grade: Number(s.value) }); toast('Grade cambiato'); pannelloView(c, params); } catch { s.value = r.grade; }
        });
        return h('tr', h('td', r.title), h('td.small.muted', f), h('td', r.people), h('td', s));
      })))));
}

function panVersions(body, d, c, params) {
  fill(body, h('div.card.hr-pad', h('table.hr-t', h('tr', ['Griglia', 'Stato', 'Dal', 'Applicata', ''].map(x => h('th', x))),
    d.versions.map(v => {
      const isCur = v.id === d.current.id;
      const date = h('input.input', { type: 'date', value: `${new Date().getFullYear() + 1}-01-01` });
      return h('tr', h('td', h('b', v.label)), h('td', isCur ? h('span.hr-chip.z-ok', 'in vigore') : v.applied_at ? (v.valid_from > new Date().toISOString().slice(0, 10) ? h('span.hr-chip', 'programmata') : h('span.hr-chip', 'passata')) : h('span.hr-chip.z-warn', 'bozza')),
        h('td', v.valid_from ? itDate(v.valid_from) : '—'), h('td.small', v.applied_at ? `${fmtDateTime(v.applied_at)}${v.applied_by ? ` · ${v.applied_by}` : ''}` : '—'),
        h('td.hr-row', v.applied_at ? null : [
          h('a.btn.btn-sm', { href: '#/hr/pannello?tab=fasce' }, 'Modifica'),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => apply(v, 'now') } }, 'Applica subito'), date,
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => apply(v, date.value) } }, 'Applica da questa data')]));
    })),
    h('p.small.muted', 'Ogni applicazione crea una versione: le posizioni passate restano calcolate sulla griglia di allora. «Subito» = correzione dell\'anno in corso.')));
  async function apply(v, from) {
    if (!(await confirmDialog(`Applicare «${v.label}» ${from === 'now' ? 'da oggi' : `dal ${itDate(from)}`}? Si aggiornano griglia, schede, mappatura e mansionario per tutti.`))) return;
    await post('/api/hr/pannello/applica', { id: v.id, from });
    toast('Griglia applicata'); pannelloView(c, params);
  }
}

// ── Vista d'insieme (team HR) ───────────────────────────────────────────────────────────────────────────────
function genBands({ g1, lo, hi, w, plus = 0, overrides = {} }) {
  const out = []; let ref = g1;
  const k = 1 + (plus || 0) / 100;
  for (let g = 1; g <= 8; g++) {
    if (g > 1) ref *= 1 + (g <= 4 ? lo : hi) / 100;
    const auto = { grade: g, min: Math.round(ref * (1 - w / 100) * k * 10) / 10, mid: Math.round(ref * k * 10) / 10, max: Math.round(ref * (1 + w / 100) * k * 10) / 10 };
    out.push(overrides[g] ? { ...auto, ...overrides[g], grade: g, manual: true } : auto); // le eccezioni fatte a mano restano anche se si muovono le leve
  }
  return out;
}
async function insiemeView(c) {
  const d = await get('/api/hr/pannello');
  const p = { ...d.defaults.params, ...(d.current.params || {}) };
  p.overrides = { ...(p.overrides || {}) };
  p.plus = p.plus || 0;
  const rules = { ...d.defaults.rules, ...d.current.rules };
  const slider = (kx, label, min, max, step, fmt) => {
    const out = h('b', fmt(p[kx]));
    const inp = h('input', { type: 'range', min, max, step, value: p[kx], 'aria-label': label });
    inp.addEventListener('input', () => { p[kx] = Number(inp.value); out.textContent = fmt(p[kx]); redraw(); });
    return h('label.hr-lever', h('span', label, out), inp);
  };
  const chart = h('div'); const totals = h('div.card.hr-pad'); const warns = h('div.card.hr-pad');
  let dots = [];
  let timer;
  const redraw = () => {
    const bands = genBands(p);
    const pos = (k, b) => (k < b.min ? 'bad' : k > b.max ? 'hi' : 'ok');
    fill(chart, [...bands].reverse().map(b => h('div.hr-grow', h('button.hr-grow-g.hr-gbtn', { type: 'button', title: 'Ritocca a mano questa fascia', on: { click: () => ritocca(b) } }, `G${b.grade}`, b.manual ? h('small', 'a mano') : h('small', 'ritocca')),
      bandBar(b, { ccnl: rules.ccnl?.[b.grade]?.minimo, market: rules.market?.[b.grade], dots: dots.filter(x => x.grade === b.grade).map(x => ({ k: x.k, zone: pos(x.k, b) })) }),
      h('div.small', h('b', `${k1(b.min)} · ${k1(b.mid)} · ${k1(b.max)}`), ' k€'))), h('div.hr-grow.hr-grow-scale', h('span'), scaleRow(), h('span')));
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const r = await post('/api/hr/pannello/impatto', { bands, ambito: getAmbito() }, { quiet: true }).catch(() => null);
      if (!r) return;
      if (!dots.length && r.dots.length) { dots = r.dots; redraw(); return; }
      const row = (l, a, b2, fmt = x => x) => h('tr', h('td', l), h('td', fmt(a)), h('td', h('b', fmt(b2))));
      fill(totals, h('div.hr-label', 'In vigore → scenario'), h('table.hr-t', h('tr', h('th', ''), h('th', 'In vigore'), h('th', 'Scenario')),
        row('Sotto il minimo', r.before.below, r.after.below), row('Sopra il massimo', r.before.above, r.after.above), row('Dentro la fascia', `${r.before.inPct}%`, `${r.after.inPct}%`),
        row('Costo di rientro / anno', r.before.cost, r.after.cost, eur), row('Sovrapposizione media', `${r.before.overlapAvg}%`, `${r.after.overlapAvg}%`),
        row('Riferimento G8', `${k1(d.current.bands[7].mid)} k€`, `${k1(bands[7].mid)} k€`)));
      fill(warns, h('div.hr-label', 'Avvisi dello scenario'), !r.check.errors.length && !r.check.warnings.length ? h('p.small.z-ok-t', 'Nessun avviso: tutte le fasce sopra il minimo CCNL, salti e sovrapposizioni nelle regole.')
        : [...r.check.errors.map(e => h('div.hr-alert.bad', icon('alert-triangle', { size: 14 }), h('span', e))), ...r.check.warnings.map(w => h('div.hr-alert.warn', icon('alert-triangle', { size: 14 }), h('span', w)))]);
    }, 200);
  };
  function ritocca(b) {
    const mk = v => h('input.input.hr-num', { type: 'number', step: 0.5, value: v });
    const mn = mk(b.min), md = mk(b.mid), mx = mk(b.max);
    const m = modal({ title: `Ritocca a mano la fascia G${b.grade}`, body: h('div.hr-form', h('div.hr-grid3', h('label.field', h('span', 'Min k€'), mn), h('label.field', h('span', 'Riferimento k€'), md), h('label.field', h('span', 'Max k€'), mx)),
      h('p.small.muted', 'Il ritocco resta anche se muovi le leve. «Togli il ritocco» torna al valore calcolato.')),
      actions: [h('button.btn', { type: 'button', on: { click: () => { delete p.overrides[b.grade]; m.close(); redraw(); } } }, 'Togli il ritocco'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => { p.overrides[b.grade] = { min: Number(mn.value), mid: Number(md.value), max: Number(mx.value) }; m.close(); redraw(); } } }, 'Applica')] });
  }
  const saveDraft = async () => {
    const draft = d.versions.find(v => !v.applied_at);
    const r = await post('/api/hr/pannello/bozza', { id: draft?.id, label: draft?.label || `Griglia ${new Date().getFullYear() + 1}`, bands: genBands(p), rules, params: p });
    toast(r.warnings?.length ? `Bozza salvata con ${r.warnings.length} avvisi` : 'Bozza salvata');
    location.hash = '#/hr/pannello?tab=versioni';
  };
  fill(c, head('Vista d\'insieme', 'Quattro leve generano tutta la griglia; il grafico mostra fasce, persone vere, minimi CCNL e mercato, e i totali si aggiornano mentre muovi.',
    h('div.hr-row', h('button.btn', { type: 'button', on: { click: () => { Object.assign(p, d.defaults.params, d.current.params || {}); insiemeView(c); } } }, 'Torna alla griglia in vigore'),
      h('button.btn', { type: 'button', on: { click: () => { p.plus = Math.round(((1 + (p.plus || 0) / 100) * 1.03 - 1) * 1000) / 10; toast(`Tutte le fasce +${k1(p.plus)}% rispetto alle leve`); redraw(); } } }, 'Tutte +3%'),
      h('button.btn.btn-primary', { type: 'button', on: { click: saveDraft } }, 'Salva come bozza'))),
    lockBar('Solo team HR · RAL da BOSS riportate a tempo pieno · operai, apprendisti, tirocini e staff leasing esclusi.'),
    h('div.hr-row.hr-filters', await ambitoSelect(() => insiemeView(c)), h('span.small.muted', 'Pallini e totali sono delle persone dell\'ambito; la griglia resta una per tutta l\'azienda.')),
    h('div.card.hr-pad', h('div.hr-levers',
      slider('g1', 'RAL di riferimento di G1', 22, 30, 0.5, v => `${k1(v)} k€`), slider('lo', 'Salto tra grade · G1–G4', 10, 30, 1, v => `+${v}%`),
      slider('hi', 'Salto tra grade · G5–G8', 10, 30, 1, v => `+${v}%`), slider('w', 'Ampiezza delle fasce (±)', 6, 20, 1, v => `±${v}%`))),
    h('div.hr-grid32', h('div.card.hr-pad', chart,
      howTo('Ogni riga è un grade. La barra va dal minimo al massimo, la stanghetta scura è il riferimento. I pallini sono le persone: ', h('span.z-bad-t', 'rossi'), ' sotto il minimo, ', h('span.z-ok-t', 'verdi'), ' dentro, ', h('span.z-hi-t', 'ambra'), ' sopra il massimo. La linea rossa tratteggiata è il ', h('b', 'minimo CCNL'), ' del livello collegato: la fascia non deve partire a sinistra di quella linea. Il rombo blu è il ', h('b', 'mercato'), '.')),
      h('div', totals, warns)));
  redraw();
}

// ── Registro (team HR) ──────────────────────────────────────────────────────────────────────────────────────
async function registroView(c) {
  const d = await get('/api/hr/registro');
  fill(c, head('Registro', 'Chi ha aperto una retribuzione o un export, e ogni modifica del pannello, del mansionario e dei ruoli (prima e dopo).'),
    h('div.card.hr-scroll', h('table.list.hr-nohover', h('thead', h('tr', ['Quando', 'Chi', 'Tipo', 'Cosa', 'Persona'].map(x => h('th', x)))),
      h('tbody', d.log.length ? d.log.map(l => h('tr', h('td.small', fmtDateTime(l.at)), h('td', l.who || '—'), h('td', h('span.hr-chip', { class: l.kind === 'accesso' ? '' : 'z-warn' }, l.kind)), h('td', l.action), h('td', l.persona || '—')))
        : h('tr', h('td.empty', { colSpan: 5 }, 'Ancora niente'))))));
}
