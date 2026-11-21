// «Da dove vengono i dati» (ALM2-49, canvas CRM v13 · V13-Fonti, via di Dante 21/11/2026). Componente condiviso:
//   sourceLine(params)  → la riga «Dati ANAC · aggiornati il … · ultimi 24 mesi · N gare» con il pulsante che apre il riquadro
//   openSources(params) → il riquadro laterale (sul telefono foglio dal basso): fonti, quanto sono completi, cosa non c'è
// params = query di GET /api/crm/fonti: { iniziativa, months, province, cats } oppure { cats, regions, months }, più cf.
// Usato da Mercato (Nuovi business), Concorrenza e gare e scheda impresa.
import { h, fill, loading, fmtDateTime } from './ui.js';
import { get } from './api.js';
import { icon } from './icons.js';
import { cvModal } from './crm-v2.js';

const qs = p => new URLSearchParams(Object.entries(p || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
  .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString();
const num = n => Number(n || 0).toLocaleString('it-IT');
const SRC_ICON = { anac: 'building', ted: 'globe', opencup: 'calendar' };
const STATUS = { ok: ['aggiornata', 'gr'], vecchia: ['da aggiornare', 'or'], vuota: ['ancora vuota', 'or'], in_arrivo: ['in arrivo', 'gy'] };
const day = iso => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '');
const periodText = p => {
  if (!p?.from) return '';
  const f = d => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return `Da ${f(p.from)} a ${f(p.to)}.`;
};

async function load(params) { return get(`/api/crm/fonti?${qs(params)}`, { quiet: true }); }

// La riga sempre visibile. Restituisce subito l'elemento e lo riempie quando arrivano i dati.
export function sourceLine(params, { count = null } = {}) {
  const el = h('div.fd-line', { 'aria-live': 'polite' }, h('span.fd-dot.wait'), h('span.fd-txt', 'Fonte dei dati…'));
  let data = null;
  load(params).then(d => {
    data = d;
    const anac = d.sources.find(s => s.key === 'anac');
    const n = count ?? d.quality.n;
    fill(el,
      h('span.fd-dot', { class: anac?.status === 'ok' ? 'ok' : 'warn', title: anac?.status === 'ok' ? 'Ultimo caricamento riuscito' : 'Dati di più di 2 giorni fa' }),
      h('span.fd-txt', 'Dati ', h('b', 'ANAC'),
        anac?.updated_at ? [' · aggiornati il ', h('b', fmtDateTime(anac.updated_at))] : ' · non ancora caricati',
        ' · ultimi ', h('b', `${d.scope.months} mesi`), ` · ${num(n)} ${n === 1 ? 'gara aggiudicata' : 'gare aggiudicate'}`),
      h('button.fd-btn', { type: 'button', on: { click: () => openSources(params, data) } }, icon('info', { size: 15 }), 'Da dove vengono i dati'));
  }).catch(() => fill(el, h('span.fd-dot.warn'), h('span.fd-txt', 'Dati ANAC'), h('button.fd-btn', { type: 'button', on: { click: () => openSources(params) } }, icon('info', { size: 15 }), 'Da dove vengono i dati')));
  return el;
}

// Nota sotto un numero fragile: «su 142 gare su 236 che lo dichiarano»
export const basedOn = (n, total, what = 'lo dichiarano') => (total ? h('span.fd-q', { title: 'Molte stazioni appaltanti non dichiarano questo dato' }, h('i', 'i'), `su ${num(n)} ${n === 1 ? 'gara' : 'gare'} su ${num(total)} che ${what}`) : null);

export async function openSources(params, ready = null) {
  const body = h('div.fd-body', loading());
  const title = h('div.fd-head', h('h2', 'Da dove vengono i dati'), h('p.fd-sub', ''));
  const m = cvModal({ title, body, drawer: true, size: 'fd' });
  m.box.classList.add('fd-drawer');
  let d = ready;
  try { d = d || await load(params); } catch (err) { fill(body, h('p', err.message)); return; }
  const sc = d.scope;
  title.querySelector('.fd-sub').textContent = `Per le gare di questa pagina: ${[sc.categories.length ? sc.categories.join(' e ') : 'tutte le categorie', sc.regions.length ? sc.regions.join(', ') : 'tutta Italia', `${sc.months} mesi`].join(' · ')}`;
  const src = s => {
    const [label, tone] = STATUS[s.status] || STATUS.in_arrivo;
    return h('div.fd-src', h('span.fd-ic', { class: s.key }, icon(SRC_ICON[s.key] || 'database', { size: 18 })),
      h('div.fd-min0', h('b', s.name), h('small', s.what, s.period?.from ? ` ${periodText(s.period)}` : '')),
      h('span.fd-pill', { class: tone }, s.status === 'ok' || s.status === 'vecchia' ? `${label} ${day(s.updated_at)}` : label));
  };
  // i dati in più (partecipanti, categorie secondarie, CUP) arrivano con il giro di stanotte: finché sono zero, «in arrivo»
  const bar = f => (f.extra && !f.n
    ? h('div.fd-bar', h('span', f.label), h('span.fd-track'), h('b.fd-soon', 'in arrivo'))
    : h('div.fd-bar', h('span', f.label),
      h('span.fd-track', h('span.fd-fill', { class: f.info ? 'info' : f.pct >= 80 ? 'hi' : 'mid', style: { width: `${f.pct ?? 0}%` } })),
      h('b', f.pct === null ? '—' : `${f.pct}%`)));
  const q = d.quality;
  fill(body,
    h('div.fd-lbl', 'Fonti'),
    h('div.fd-srcs', d.sources.map(src)),
    h('div.fd-lbl', q.n ? `Quanto sono completi i dati di queste ${num(q.n)} gare` : 'Quanto sono completi i dati'),
    q.n ? h('div.fd-bars', q.fields.map(bar)) : h('p.fd-none', 'Nessuna gara in questo perimetro: prova un periodo più lungo o altre zone.'),
    q.n ? h('p.fd-note', `Il ribasso tipico si calcola solo sulle gare con almeno 2 offerenti e un ribasso vero: qui ${num(q.discount_real)} su ${num(q.n)}.`,
      q.subcontracts ? ` Subappalti autorizzati su queste gare: ${num(q.subcontracts)}.` : '', ' In blu i dati che non tutte le gare hanno per natura (non mancano).') : null,
    h('div.fd-lbl', 'Cosa non c\'è'),
    h('ul.fd-lim', d.limits.map(t => h('li', t))));
  const anac = d.sources.find(s => s.key === 'anac');
  m.box.append(h('div.modal-foot.fd-foot', h('span.fd-next', `Prossimo aggiornamento: stanotte alle ${d.next_update}`),
    h('a.btn', { href: anac?.url || 'https://dati.anticorruzione.it/opendata', target: '_blank', rel: 'noopener' }, icon('globe', { size: 15 }), 'Vai agli open data ANAC')));
}
