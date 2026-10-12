// Censimento dei software (solo amministratori): cruscotto dei costi, catalogo con le tipologie di licenza,
// chi ha cosa persona per persona, pacchetti per ruolo. Microsoft 365 e i software esterni di Entra si
// aggiornano da soli con «Aggiorna»; tutto il resto si compila qui.
import { h, clear, fill, modal, confirmDialog, toast, fmtDate, fmtDateTime, loading, debounce } from './ui.js';
import { get, post, patch, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

const TABS = [['cruscotto', 'Cruscotto'], ['catalogo', 'Fornitori e software'], ['persone', 'Persone'], ['pacchetti', 'Pacchetti per ruolo']];
const STATUS = { attivo: 'In uso', da_verificare: 'Da verificare', archiviato: 'Archiviato' };
const BILLING = { mese: 'al mese', anno: 'all\'anno', una_tantum: 'una tantum' };
const SOURCE = { manuale: 'A mano', microsoft: 'Microsoft 365', entra: 'Entra', pacchetto: 'Pacchetto' };

const eur = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }));
const num = n => Number(n || 0).toLocaleString('it-IT');
const statusPill = s => h('span.pill', { class: `sw-st-${s}` }, h('span.dot'), STATUS[s] || s);
const lc = s => String(s || '').toLowerCase();

let peopleCache = null;
async function orgPeople() {
  if (!peopleCache) peopleCache = (await get('/api/org')).people;
  return peopleCache;
}

export async function softwareView(container, parts = []) {
  if (!store.me.is_admin) return fill(container, h('div.card.empty', 'Il censimento dei software è riservato agli amministratori.'));
  if (parts[1] && /^\d+$/.test(parts[1])) return softwareDetail(container, Number(parts[1]));
  if (parts[1] === 'fornitore' && parts[2]) return vendorView(container, decodeURIComponent(parts[2]));
  const tab = TABS.some(([k]) => k === parts[1]) ? parts[1] : 'cruscotto';
  const body = h('div.sw-body', loading());
  clear(container).append(
    h('div.page-head', h('div', h('h1', 'Software e licenze'),
      h('div.sub', 'Quali software usa Almacis, quante licenze ci sono, a chi sono assegnate e quanto costano.'))),
    h('div.seg.sw-tabs', TABS.map(([k, label]) => h('button', { type: 'button', class: k === tab ? 'on' : '', on: { click: () => { location.hash = `#/software/${k}`; } } }, label))),
    body);
  const data = await get('/api/software');
  if (tab === 'cruscotto') {
    dashboard(body, data);
    if (location.hash.includes('?libere')) document.getElementById('sw-libere')?.scrollIntoView({ block: 'start' });
  }
  else if (tab === 'catalogo') catalog(body, data);
  else if (tab === 'persone') await peopleTab(body);
  else await packagesTab(body);
}

// ── cruscotto ─────────────────────────────────────────────────────────────
function dashboard(box, data) {
  const t = data.totals;
  // licenze pagate e non assegnate, le più costose prima
  const free = data.software.filter(s => s.status !== 'archiviato').flatMap(s => s.plans.filter(p => p.free > 0 && p.unit_cost !== 0)
    .map(p => ({ s, p, cost: p.monthly_unit === null ? null : p.free * p.monthly_unit })))
    .sort((a, b) => ((b.cost || 0) - (a.cost || 0)) || b.p.free - a.p.free);
  const kpi = (label, value, sub, warn = false, href = null) => h(href ? 'a.sw-kpi' : 'div.sw-kpi', { class: warn ? 'warn' : '', href },
    h('span.lab', label), h('strong.big', value), sub ? h('span.sub', sub) : null);
  const soon = data.software.filter(s => s.status !== 'archiviato' && s.renewal_date)
    .map(s => ({ s, date: s.renewal_date })).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const spend = new Map();
  for (const s of data.software.filter(x => x.status !== 'archiviato' && x.monthly_cost)) {
    const k = vendorKey(s);
    const cur = spend.get(k) || { v: k, monthly_cost: 0, estimated: false };
    cur.monthly_cost += s.monthly_cost;
    cur.estimated ||= s.estimated;
    spend.set(k, cur);
  }
  const top = [...spend.values()].sort((a, b) => b.monthly_cost - a.monthly_cost).slice(0, 8);
  const max = top[0]?.monthly_cost || 1;

  fill(box,
    h('div.sw-kpis',
      kpi('Spesa al mese', eur(t.monthly_cost), `circa ${eur(t.monthly_cost * 12)} all'anno`),
      kpi('Software in uso', num(t.software), t.to_check ? `${num(t.to_check)} scoperti da verificare` : 'tutti verificati', t.to_check > 0, '#/software/catalogo'),
      kpi('Licenze da assegnare', num(t.free_seats), t.free_cost ? `pagate e libere, ${eur(t.free_cost)} al mese` : 'nessuna', t.free_seats > 0, t.free_seats ? '#/software/cruscotto?libere' : null),
      kpi('Licenze da recuperare', num(t.departed), t.departed ? 'account disattivati o persone uscite' : 'nessuna', t.departed > 0),
      kpi('Prezzi da completare', num(t.missing_cost + t.estimated), t.estimated ? `${num(t.estimated)} software con prezzo di listino stimato` : 'tutti inseriti', t.missing_cost + t.estimated > 0)),
    h('div.sw-grid',
      free.length ? h('section.card.sw-card#sw-libere', h('h3', 'Licenze da assegnare'),
        h('p.small.muted', 'Licenze già pagate che nessuno ha: assegnale a chi entra o riducile al prossimo rinnovo.'),
        h('div.sw-list', free.map(({ s, p, cost }) => h('a.sw-line', { href: `#/software/${s.id}` },
          h('span.grow', h('strong', p.name), h('span.small.muted', ` ${vendorKey(s)}${s.name !== vendorKey(s) ? ` · ${s.name}` : ''}`)),
          h('span.sw-free-n', `${num(p.free)} ${p.free === 1 ? 'libera' : 'libere'}`),
          h('span.small.muted.num', cost === null ? 'prezzo da inserire' : `${eur(cost)}/mese`),
          p.renewal_date ? h('span.small.muted', `rinnovo ${fmtDate(p.renewal_date, { year: true })}`) : null)))) : null,
      sourcesCard(data),
      h('section.card.sw-card', h('h3', 'Dove va la spesa, per fornitore'),
        top.length ? h('div.sw-bars', top.map(s => h('a.sw-bar', { href: vendorHref(s.v) },
          h('span.sw-bar-name', s.v), h('span.sw-bar-track', h('i', { style: { width: `${Math.max(2, (s.monthly_cost / max) * 100)}%` } })),
          h('span.sw-bar-val', eur(s.monthly_cost), s.estimated ? h('small', ' stimato') : null))))
          : h('p.muted', 'Nessun costo ancora: aggiorna Microsoft 365 o inserisci i prezzi dei software.')),
      h('section.card.sw-card', h('h3', 'Prossimi rinnovi'),
        soon.length ? h('div.sw-list', soon.map(({ s, date }) => h('a.sw-line', { href: `#/software/${s.id}` }, h('span.grow', s.name), h('span.muted', fmtDate(date, { year: true })))))
          : h('p.muted', 'Nessuna data di rinnovo inserita.')),
      data.departed.length ? h('section.card.sw-card', h('h3', 'Licenze da recuperare'),
        h('p.small.muted', 'Persone che non sono più nell\'organigramma di Microsoft ma hanno ancora licenze qui.'),
        h('div.sw-list', data.departed.map(a => h('a.sw-line', { href: `#/software/${a.software_id}` },
          h('span.grow', h('strong', a.person_name), ` · ${a.software_name} (${a.plan_name})`), h('span.muted.small', a.person_email))))) : null));
}

function sourcesCard(data) {
  const row = src => {
    const s = data.sync[src.key];
    const btn = h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
      btn.disabled = true;
      btn.textContent = 'Lettura in corso…';
      try {
        const r = await post(`/api/software/sync/${src.key}`, {}, { quiet: true });
        toast(`${src.label}: ${num(r.software)} software, ${num(r.assignments)} licenze assegnate${r.created ? `, ${num(r.created)} nuovi` : ''}`);
        location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.replaceChildren(icon('refresh', { size: 15 }), 'Aggiorna');
        note.replaceChildren(h('div.banner', err.message));
      }
    } } }, icon('refresh', { size: 15 }), 'Aggiorna');
    const note = h('div');
    return h('div.sw-source', h('div.grow', h('strong', src.label),
      h('div.small.muted', s ? `Aggiornato ${fmtDateTime(s.synced_at)}${s.synced_by_name ? ` da ${s.synced_by_name}` : ''}` : 'Mai aggiornato'), note), btn);
  };
  return h('section.card.sw-card', h('h3', 'Collegamenti'),
    h('p.small.muted', 'Leggono da soli software, licenze e assegnazioni. Gli altri software si inseriscono a mano; i prossimi collegamenti (Claude, Zoho…) si aggiungeranno qui.'),
    data.sources.map(row));
}

// ── fornitori ─────────────────────────────────────────────────────────────
// Prima i fornitori (Microsoft, Autodesk, Zoho…) con licenze e costo per Almacis; dentro, i loro software e licenze.
const vendorKey = s => (s.vendor || '').trim() || s.name;
const vendorHref = v => `#/software/fornitore/${encodeURIComponent(v)}`;
const STATUS_ORDER = { attivo: 0, da_verificare: 1, archiviato: 2 };

// Totali di un gruppo di software: licenze acquistate (con un numero), assegnate, libere, persone collegate
// (software scoperti in Entra, che non hanno licenze vere), costo al mese e primo rinnovo.
function totalsOf(list) {
  const plans = list.flatMap(s => s.plans);
  // licenze vere: con un numero e non gratuite; le prove e le gratuite a parte
  const counted = plans.filter(p => p.seats !== null && p.unit_cost !== 0);
  const linked = plans.filter(p => p.external_id === 'collegati');
  const other = plans.filter(p => !counted.includes(p) && p.external_id !== 'collegati');
  const costs = list.map(s => s.monthly_cost).filter(c => c !== null);
  return {
    seats: counted.reduce((n, p) => n + p.seats, 0),
    assigned: counted.reduce((n, p) => n + p.assigned, 0),
    unlimited: other.reduce((n, p) => n + p.assigned, 0),
    free: counted.reduce((n, p) => n + (p.free || 0), 0),
    linked: linked.reduce((n, p) => n + p.assigned, 0),
    monthly: costs.length ? costs.reduce((x, y) => x + y, 0) : null,
    estimated: list.some(s => s.estimated),
    missing: list.reduce((n, s) => n + (s.missing_cost || 0), 0),
    renewal: list.map(s => s.renewal_date).filter(Boolean).sort()[0] || null,
  };
}
const licLine = t => [
  t.seats ? `${num(t.assigned)} assegnate di ${num(t.seats)}` : null,
  t.unlimited ? `${num(t.unlimited)} gratuite o senza limite` : null,
  t.linked && !t.seats && !t.unlimited ? 'accesso con l\'account Microsoft' : null,
].filter(Boolean).join(' · ') || '—';
// Sigla colorata del fornitore nei riquadri: due lettere, colore fisso per nome.
const MONO_COLORS = ['#FF8A26', '#0057B8', '#1B7A45', '#8A1538', '#4A3082', '#009260', '#B84207', '#5B6770', '#C2185B', '#00838F'];
const monogram = v => { const w = v.match(/[A-Za-z0-9]+/g) || ['?']; return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase(); };
const monoColor = v => MONO_COLORS[[...v].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % MONO_COLORS.length];
const costCell = t => (t.monthly === null ? h('span.muted', t.missing ? 'prezzo mancante' : '—') : [eur(t.monthly), t.estimated ? h('small.muted', ' stimato') : null]);

function catalog(box, data) {
  let filter = data.totals.to_check && !data.software.some(s => s.status === 'attivo') ? 'da_verificare' : 'attivo';
  let q = '';
  // riquadri o elenco: la scelta resta per la prossima volta
  const VIEW_KEY = 'alma.swVendorView';
  let view = 'riquadri';
  try { view = localStorage.getItem(VIEW_KEY) === 'elenco' ? 'elenco' : 'riquadri'; } catch { /* niente */ }
  const table = h('div');
  const viewSeg = h('div.seg.sw-view', { role: 'group', 'aria-label': 'Vista' }, [['riquadri', 'Riquadri'], ['elenco', 'Elenco']].map(([k, label]) =>
    h('button', { type: 'button', 'data-v': k, 'aria-pressed': String(k === view), on: { click: () => {
      view = k;
      try { localStorage.setItem(VIEW_KEY, k); } catch { /* niente */ }
      draw();
    } } }, icon(k === 'riquadri' ? 'grid' : 'list', { size: 15 }), label)));
  const groups = st => [...new Set(data.software.filter(s => s.status === st).map(vendorKey))];
  const seg = h('div.seg', Object.entries(STATUS).map(([k, label]) => h('button', { type: 'button', 'data-k': k, class: k === filter ? 'on' : '', on: { click: () => { filter = k; draw(); } } },
    label, ` ${num(groups(k).length)}`)));
  const search = h('input.input', { type: 'search', placeholder: 'Cerca un fornitore, un software o una licenza', 'aria-label': 'Cerca', on: { input: debounce(e => { q = lc(e.target.value.trim()); draw(); }, 150) } });
  fill(box,
    h('div.sw-tools', seg, search, viewSeg, h('button.btn.btn-primary', { type: 'button', on: { click: () => editSoftware(null) } }, icon('plus', { size: 16 }), 'Aggiungi software')),
    table);
  draw();

  function draw() {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === filter));
    viewSeg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === view); b.setAttribute('aria-pressed', String(b.dataset.v === view)); });
    const by = new Map();
    for (const s of data.software.filter(x => x.status === filter)) {
      const k = vendorKey(s);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(s);
    }
    const rows = [...by.entries()]
      .filter(([v, list]) => !q || lc(`${v} ${list.map(s => `${s.name} ${s.category} ${s.plans.map(p => p.name).join(' ')}`).join(' ')}`).includes(q))
      .map(([v, list]) => ({ v, list, t: totalsOf(list) }))
      .sort((x, y) => ((y.t.monthly || 0) - (x.t.monthly || 0)) || x.v.localeCompare(y.v, 'it'));
    const people = (v, list) => data.vendor_people?.[v] ?? list.reduce((n, s) => n + s.people_count, 0);
    const products = (v, list) => (list.length === 1 && list[0].name === v
      ? [list[0].category, `${list[0].plans.length} ${list[0].plans.length === 1 ? 'tipo di licenza' : 'tipi di licenza'}`].filter(Boolean).join(' · ')
      : list.map(s => s.name).join(', '));
    const empty = h('div.card.empty', filter === 'da_verificare' ? 'Nessun software da verificare.' : 'Nessun fornitore qui.');
    if (view === 'riquadri') {
      fill(table, rows.length ? h('div.sw-tiles', rows.map(({ v, list, t }) => h('a.sw-tile', { href: vendorHref(v) },
        h('div.sw-tile-head', h('span.sw-mono', { style: { '--c': monoColor(v) }, 'aria-hidden': 'true' }, monogram(v)),
          h('div.grow', h('strong.sw-tile-name', v), h('div.small.muted.sw-tile-sub', products(v, list)))),
        h('div.sw-tile-cost', t.monthly === null ? h('span.muted', t.missing ? 'prezzo mancante' : 'nessun costo') : [h('strong', eur(t.monthly)), h('span.muted', ' al mese'), t.estimated ? h('small.muted', ' stimato') : null]),
        t.seats ? h('div.sw-tile-use', { title: `${num(t.assigned)} assegnate di ${num(t.seats)}` }, h('i', { style: { width: `${Math.min(100, (t.assigned / t.seats) * 100)}%` } })) : null,
        h('dl.sw-tile-facts',
          h('div', h('dt', 'Licenze'), h('dd', licLine(t))),
          h('div', h('dt', 'Persone'), h('dd', num(people(v, list)))),
          h('div', h('dt', 'Rinnovo'), h('dd', t.renewal ? fmtDate(t.renewal, { year: true }) : '—'))))))
        : empty);
    } else fill(table, rows.length ? h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Fornitore', 'Licenze', 'Persone', 'Al mese', 'All\'anno', 'Rinnovo'].map(t => h('th', t)))),
      h('tbody', rows.map(({ v, list, t }) => h('tr', { on: { click: () => { location.hash = vendorHref(v); } } },
        h('td', h('strong', v), h('div.small.muted', products(v, list))),
        h('td', licLine(t)),
        h('td.num', num(people(v, list))),
        h('td.num', costCell(t)),
        h('td.num', t.monthly === null ? h('span.muted', '—') : eur(t.monthly * 12)),
        h('td', t.renewal ? fmtDate(t.renewal, { year: true }) : h('span.muted', '—')))))))
      : empty);
    if (filter === 'da_verificare' && rows.length) {
      table.prepend(h('p.small.muted.sw-pad', 'Scoperti da Microsoft: software in cui qualcuno entra con l\'account aziendale. Aprili per confermarli (con prezzi e licenze) o archiviarli.'));
    }
  }
}

// Pagina del fornitore: totali per Almacis e, software per software, tutte le sue licenze.
async function vendorView(container, vendor) {
  clear(container).append(loading());
  const data = await get('/api/software');
  const list = data.software.filter(s => vendorKey(s) === vendor)
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.name.localeCompare(b.name, 'it'));
  if (!list.length) return fill(container, h('div.card.empty', 'Fornitore non trovato. ', h('a', { href: '#/software/catalogo' }, 'Torna ai fornitori')));
  const t = totalsOf(list.filter(s => s.status !== 'archiviato'));
  const kpi = (label, value, sub) => h('div.sw-kpi', h('span.lab', label), h('strong.big', value), sub ? h('span.sub', sub) : null);
  fill(container,
    h('div.page-head',
      h('div', h('a.pj-crumb', { href: '#/software/catalogo' }, '← Fornitori'), h('h1', vendor),
        h('div.sub', `${num(list.length)} software`, t.renewal ? ` · primo rinnovo ${fmtDate(t.renewal, { year: true })}` : '')),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => editSoftware(null, null, { vendor }) } }, icon('plus', { size: 16 }), `Software di ${vendor}`)),
    h('div.sw-kpis',
      kpi('Costo al mese', costCell(t), t.monthly === null ? null : `circa ${eur(t.monthly * 12)} all'anno`),
      t.seats ? kpi('Licenze acquistate', num(t.seats), `${num(t.assigned)} assegnate`) : null,
      t.seats ? kpi('Licenze libere', num(t.free), t.free ? 'pagate e non assegnate' : 'tutte assegnate') : null,
      t.unlimited ? kpi('Gratuite o senza limite', num(t.unlimited), 'assegnate') : null,
      t.linked ? kpi('Persone collegate', num(data.vendor_people?.[vendor] ?? t.linked),'entrano con l\'account Microsoft') : null),
    list.map(s => h('section.card.sw-vendor-sw',
      h('div.sw-plan-head',
        h('div.grow', h('h3', h('a', { href: `#/software/${s.id}` }, s.name), ' ', s.status !== 'attivo' ? statusPill(s.status) : null),
          h('div.small.muted', [s.category, SOURCE[s.source] && s.source !== 'manuale' ? `da ${SOURCE[s.source]}` : null, s.monthly_cost !== null ? `${eur(s.monthly_cost)} al mese` : null].filter(Boolean).join(' · '))),
        h('a.btn.btn-sm', { href: `#/software/${s.id}` }, 'Apri: persone e prezzi')),
      s.plans.length ? h('div.table-wrap', h('table.list.sw-plan-table',
        h('thead', h('tr', ['Licenza', 'Acquistate', 'Assegnate', 'Libere', 'Prezzo', 'Al mese', 'Rinnovo'].map(x => h('th', x)))),
        h('tbody', [...s.plans].sort((x, y) => ((y.monthly_cost || 0) - (x.monthly_cost || 0)) || x.name.localeCompare(y.name, 'it')).map(p => h('tr', { on: { click: () => { location.hash = `#/software/${s.id}`; } } },
          h('td', h('strong', p.name)),
          h('td.num', p.seats === null ? h('span.muted', p.external_id === 'collegati' ? '—' : 'senza limite') : num(p.seats)),
          h('td.num', num(p.assigned)),
          h('td.num', p.free ? num(p.free) : h('span.muted', '—')),
          h('td.num', p.unit_cost === null ? h('span.muted', '—') : [eur(p.unit_cost), h('small.muted', p.billing === 'anno' ? ' /anno' : p.billing === 'una_tantum' ? ' una tantum' : ' /mese'), p.cost_estimated ? h('small.muted', ' stimato') : null]),
          h('td.num', p.monthly_cost === null ? h('span.muted', '—') : eur(p.monthly_cost)),
          h('td', p.renewal_date ? fmtDate(p.renewal_date, { year: true }) : h('span.muted', '—')))))))
        : h('p.small.muted', 'Nessuna licenza inserita.'))));
}

// ── scheda software ───────────────────────────────────────────────────────
async function softwareDetail(container, id) {
  clear(container).append(loading());
  const s = await get(`/api/software/${id}`);
  const reload = () => softwareDetail(container, id);
  const fromSource = Boolean(s.external_id);
  const statusBtns = [
    s.status !== 'attivo' ? h('button.btn', { type: 'button', on: { click: async () => { await patch(`/api/software/${id}`, { status: 'attivo' }); toast('Confermato come software in uso'); reload(); } } }, icon('check', { size: 16 }), 'Conferma in uso') : null,
    s.status !== 'archiviato' ? h('button.btn.btn-ghost', { type: 'button', on: { click: async () => { await patch(`/api/software/${id}`, { status: 'archiviato' }); toast('Archiviato'); reload(); } } }, 'Archivia') : null,
  ];
  const plans = h('div.sw-plans');
  fill(container,
    h('div.page-head',
      h('div', h('a.pj-crumb', { href: vendorHref(vendorKey(s)) }, `← ${vendorKey(s)}`),
        h('h1', s.name, ' ', statusPill(s.status)),
        h('div.sub', [s.vendor, s.category, s.source === 'manuale' ? 'inserito a mano' : SOURCE[s.source] ? `da ${SOURCE[s.source]}` : null, s.owner_name ? `referente ${s.owner_name}` : null].filter(Boolean).join(' · ')),
        s.website ? h('a.small', { href: s.website, target: '_blank', rel: 'noopener' }, s.website.replace(/^https?:\/\//, ''), ' ', icon('external', { size: 13 })) : null),
      h('div.row', statusBtns,
        h('button.btn', { type: 'button', on: { click: () => editSoftware(s, reload) } }, 'Modifica'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => editPlan(s, null, reload) } }, icon('plus', { size: 16 }), 'Tipo di licenza'))),
    s.notes ? h('p.sw-notes', s.notes) : null,
    fromSource ? h('p.small.muted', `Quantità e assegnazioni arrivano da ${SOURCE[s.source]}: si aggiornano con «Aggiorna» nel cruscotto. Qui si inseriscono prezzi, rinnovi e note.`) : null,
    plans);

  if (!s.plans.length) plans.append(h('div.card.empty', 'Nessuna licenza ancora. Aggiungi il primo tipo di licenza (per esempio «Standard», 10 licenze a 14 € al mese).'));
  for (const p of s.plans) {
    const people = s.assignments.filter(a => a.plan_id === p.id);
    const managed = Boolean(p.external_id);
    plans.append(h('section.card.sw-plan',
      h('div.sw-plan-head',
        h('div.grow', h('h3', p.name),
          h('div.small.muted', [
            p.seats === null ? `${num(p.assigned)} assegnate` : `${num(p.assigned)} assegnate di ${num(p.seats)} acquistate`,
            p.free ? `${num(p.free)} libere` : null,
            p.over ? `${num(p.over)} oltre il limite` : null,
            p.unit_cost === null ? 'prezzo da inserire' : `${eur(p.unit_cost)} ${BILLING[p.billing]}${p.cost_estimated ? ' (listino stimato)' : ''}`,
            p.monthly_cost !== null ? `${eur(p.monthly_cost)} al mese in tutto` : null,
            p.renewal_date ? `rinnovo ${fmtDate(p.renewal_date, { year: true })}` : null,
          ].filter(Boolean).join(' · '))),
        h('div.row',
          managed ? null : h('button.btn.btn-sm', { type: 'button', on: { click: () => pickPeople({ title: `Assegna «${p.name}»`, exclude: people.map(a => a.person_oid), onPick: async oids => {
            const r = await post(`/api/software/plans/${p.id}/assignments`, { oids });
            toast(`Assegnata a ${num(r.added)} ${r.added === 1 ? 'persona' : 'persone'}`);
            reload();
          } }) } }, icon('plus', { size: 15 }), 'Assegna'),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => editPlan(s, p, reload) } }, 'Modifica'))),
      p.notes ? h('p.small', p.notes) : null,
      people.length ? h('div.sw-people', people.map(a => h('div.sw-person', { class: a.departed ? 'departed' : '' },
        h('span.grow', h('strong', a.person_name), h('span.small.muted', ` ${[a.job_title, a.department].filter(Boolean).join(' · ') || a.person_email}`),
          a.departed ? h('span.pill.sw-st-da_verificare', 'non è più in Microsoft') : null,
          a.package_name ? h('span.small.muted', ` · pacchetto ${a.package_name}`) : null),
        h('span.small.muted', SOURCE[a.source] || a.source),
        (!SOURCE[a.source] || ['manuale', 'pacchetto'].includes(a.source) || a.departed) ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Togli la licenza', on: { click: async () => {
          if (!await confirmDialog(`Togliere «${p.name}» a ${a.person_name}?`, { ok: 'Togli', danger: true })) return;
          await del(`/api/software/assignments/${a.id}`);
          reload();
        } } }, '×') : null)))
        : h('p.small.muted', managed ? 'Nessuno ce l\'ha.' : 'Nessuno ce l\'ha ancora: usa «Assegna».')));
  }
  if (!fromSource) {
    container.append(h('div.sw-danger', h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare «${s.name}» con tutte le sue licenze e assegnazioni?`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/software/${id}`);
      toast('Software cancellato');
      location.hash = '#/software/catalogo';
    } } }, 'Cancella questo software')));
  }
}

function field(label, input, hint) {
  return h('label.field', h('span', label), input, hint ? h('small.muted', hint) : null);
}

async function editSoftware(s, onSaved, defaults = {}) {
  const [people, all] = await Promise.all([orgPeople(), get('/api/software')]);
  const name = h('input.input', { value: s?.name || '', maxlength: 120, required: true });
  const vendor = h('input.input', { value: s?.vendor ?? defaults.vendor ?? '', maxlength: 120, list: 'sw-vendors', placeholder: 'es. Microsoft, Autodesk, Zoho' });
  const vendors = h('datalist#sw-vendors', [...new Set(all.software.map(x => x.vendor).filter(Boolean))].sort().map(v => h('option', { value: v })));
  const category = h('input.input', { value: s?.category || '', maxlength: 80, list: 'sw-categories', placeholder: 'es. CRM e vendite' });
  const website = h('input.input', { value: s?.website || '', type: 'url', placeholder: 'https://' });
  const owner = h('select.select', h('option', { value: '' }, 'Nessuno'),
    people.map(p => h('option', { value: p.oid, selected: s?.owner_oid === p.oid }, p.name)));
  const notes = h('textarea.input', { rows: 3, maxlength: 2000 }, s?.notes || '');
  const cats = h('datalist#sw-categories', ['CRM e vendite', 'Intelligenza artificiale', 'Progetti e collaborazione', 'Produttività e posta', 'Progettazione e disegno', 'Contabilità e paghe', 'Assistenza e sicurezza IT', 'Documenti e firma', 'Agenda e appuntamenti', 'Viaggi e spese'].map(c => h('option', { value: c })));
  const m = modal({
    title: s ? `Modifica «${s.name}»` : 'Nuovo software',
    body: h('div.sw-form', field('Nome', name, 'Il prodotto, es. AutoCAD o Zoho CRM. Le versioni (Standard, Pro…) si aggiungono dopo come tipi di licenza.'), h('div.grid-2', field('Fornitore', vendor), field('Tipo', category)), cats, vendors,
      h('div.grid-2', field('Sito', website), field('Referente interno', owner)), field('Note', notes, 'Contratto, chi lo amministra, come si accede…')),
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { name: name.value, vendor: vendor.value, category: category.value, website: website.value, owner_oid: owner.value || null, notes: notes.value };
        if (s) await patch(`/api/software/${s.id}`, body);
        const r = s ? null : await post('/api/software', body);
        m.close();
        toast(s ? 'Salvato' : 'Software aggiunto');
        if (r) location.hash = `#/software/${r.id}`; else onSaved?.();
      } } }, s ? 'Salva' : 'Aggiungi'),
    ],
  });
}

function editPlan(s, p, onSaved) {
  const managed = Boolean(p?.external_id);
  const name = h('input.input', { value: p?.name || '', maxlength: 120, disabled: managed, placeholder: 'es. Standard, Pro, Business' });
  const seats = h('input.input', { type: 'number', min: 0, value: p?.seats ?? '', disabled: managed, placeholder: 'vuoto = senza limite' });
  const cost = h('input.input', { inputmode: 'decimal', value: p?.unit_cost ?? '', placeholder: 'es. 14,00' });
  const billing = h('select.select', Object.entries(BILLING).map(([k, label]) => h('option', { value: k, selected: (p?.billing || 'mese') === k }, `Per licenza ${label}`)));
  const renewal = h('input.input', { type: 'date', value: p?.renewal_date?.slice(0, 10) || '' });
  const notes = h('textarea.input', { rows: 2, maxlength: 1000 }, p?.notes || '');
  const m = modal({
    title: p ? `Licenza «${p.name}»` : `Nuovo tipo di licenza di ${s.name}`,
    body: h('div.sw-form',
      managed ? h('p.small.muted', `Nome e quantità arrivano da ${SOURCE[s.source]}.`) : null,
      field('Nome', name), h('div.grid-2', field('Licenze acquistate', seats), field('Rinnovo', renewal)),
      h('div.grid-2', field('Prezzo di una licenza (€, IVA esclusa)', cost, p?.cost_estimated ? 'Ora è il listino stimato: metti quello della fattura.' : null), field('Si paga', billing)),
      field('Note', notes)),
    left: p && !managed ? [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare «${p.name}» e le sue assegnazioni?`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/software/plans/${p.id}`);
      m.close();
      onSaved();
    } } }, 'Cancella')] : [],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { unit_cost: cost.value, billing: billing.value, renewal_date: renewal.value || null, notes: notes.value };
        if (!managed) Object.assign(body, { name: name.value, seats: seats.value === '' ? null : Number(seats.value) });
        if (p) await patch(`/api/software/plans/${p.id}`, body); else await post(`/api/software/${s.id}/plans`, body);
        m.close();
        toast('Salvato');
        onSaved();
      } } }, 'Salva'),
    ],
  });
}

// Scelta di persone dall'organigramma di Microsoft (più d'una).
async function pickPeople({ title, exclude = [], onPick }) {
  const people = (await orgPeople()).filter(p => !exclude.includes(p.oid));
  const chosen = new Set();
  const list = h('div.sw-pick');
  const count = h('span.small.muted');
  const search = h('input.input', { type: 'search', placeholder: 'Cerca per nome, ruolo o reparto', autofocus: true, on: { input: () => draw() } });
  const m = modal({
    title,
    body: h('div.sw-form', search, list),
    left: [count],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!chosen.size) return toast('Scegli almeno una persona', 'err');
        await onPick([...chosen]);
        m.close();
      } } }, 'Conferma'),
    ],
  });
  draw();
  function draw() {
    const q = lc(search.value.trim());
    const rows = people.filter(p => !q || lc(`${p.name} ${p.job_title} ${p.department} ${p.email}`).includes(q)).slice(0, 200);
    fill(list, rows.map(p => h('label.sw-pick-row', h('input', { type: 'checkbox', checked: chosen.has(p.oid), on: { change: e => { if (e.target.checked) chosen.add(p.oid); else chosen.delete(p.oid); count.textContent = chosen.size ? `${chosen.size} scelte` : ''; } } }),
      h('span.grow', h('strong', p.name), h('span.small.muted', ` ${[p.job_title, p.department].filter(Boolean).join(' · ')}`)))));
    if (!rows.length) list.append(h('p.muted', 'Nessuno trovato.'));
  }
}

// ── persone ───────────────────────────────────────────────────────────────
async function peopleTab(box) {
  const people = await get('/api/software/people');
  let q = '';
  let onlyNone = false;
  const table = h('div.card.table-wrap');
  fill(box,
    h('div.sw-tools',
      h('input.input', { type: 'search', placeholder: 'Cerca una persona, un ruolo o un software', on: { input: debounce(e => { q = lc(e.target.value.trim()); draw(); }, 150) } }),
      h('label.small', h('input', { type: 'checkbox', on: { change: e => { onlyNone = e.target.checked; draw(); } } }), ' solo chi non ha nessun software')),
    table);
  draw();
  function draw() {
    const rows = people.filter(p => (!q || lc(`${p.name} ${p.job_title} ${p.department} ${p.software.join(' ')}`).includes(q)) && (!onlyNone || !p.licenses));
    fill(table, rows.length ? h('table.list',
      h('thead', h('tr', ['Persona', 'Ruolo', 'Reparto', 'Software', 'Al mese'].map(t => h('th', t)))),
      h('tbody', rows.map(p => h('tr', { on: { click: () => personDrawer(p.oid) } },
        h('td', h('strong', p.name), h('div.small.muted', p.email), p.not_in_org ? h('span.pill.sw-st-da_verificare', p.account_disabled ? 'account disattivato' : 'non in organigramma') : null),
        h('td', p.job_title || h('span.muted', '—')),
        h('td', p.department || h('span.muted', '—')),
        h('td.sw-wrap', p.software.length ? p.software.join(', ') : h('span.muted', 'nessuno')),
        h('td.num', p.monthly_cost ? eur(p.monthly_cost) : h('span.muted', '—'))))))
      : h('div.empty', 'Nessuno trovato.'));
  }
}

async function personDrawer(oid) {
  const body = h('div', loading());
  const m = modal({ title: 'Software della persona', body, drawer: true });
  await draw();
  async function draw() {
    const d = await get(`/api/software/people/${encodeURIComponent(oid)}`);
    m.head.querySelector('h2').textContent = d.person.name || 'Persona';
    const bySw = new Map();
    for (const i of d.items) {
      if (!bySw.has(i.software_id)) bySw.set(i.software_id, { name: i.software_name, items: [] });
      bySw.get(i.software_id).items.push(i);
    }
    fill(body,
      h('p.muted', [d.person.job_title, d.person.department, d.person.email].filter(Boolean).join(' · ') || (d.person.departed ? 'Non è nell\'organigramma: casella senza posta, account disattivato o persona uscita.' : '')),
      h('div.sw-kpis.sm', h('div.sw-kpi', h('span.lab', 'Licenze'), h('strong.big', num(d.items.length))), h('div.sw-kpi', h('span.lab', 'Costo al mese'), h('strong.big', eur(d.monthly_cost)))),
      d.suggested_packages.length ? h('div.sw-suggest', h('span.small.muted', 'Pacchetti per il suo ruolo:'),
        d.suggested_packages.map(k => h('button.btn.btn-sm', { type: 'button', on: { click: () => applyPackage(k, [oid], draw) } }, icon('plus', { size: 14 }), k.name))) : null,
      bySw.size ? h('div.sw-list', [...bySw.entries()].map(([swId, g]) => h('a.sw-line', { href: `#/software/${swId}`, on: { click: () => m.close() } },
        h('span.grow', h('strong', g.name), h('span.small.muted', ` ${g.items.map(i => i.plan_name).join(', ')}`)),
        h('span.small.muted', g.items.map(i => SOURCE[i.source] || i.source).join(', ')),
        h('span.num', eur(g.items.reduce((a, i) => a + (i.monthly_cost || 0), 0))))))
        : h('p.muted', 'Nessun software assegnato.'));
  }
}

async function applyPackage(k, oids, onDone) {
  const r = await post(`/api/software/packages/${k.id}/apply`, { oids });
  toast(`Pacchetto «${k.name}»: ${num(r.added)} licenze assegnate`);
  if (r.todo.length) {
    const names = new Map((await orgPeople()).map(p => [p.oid, p.name]));
    modal({
      title: 'Da assegnare a mano',
      body: h('div', h('p', 'Queste licenze si assegnano nel sistema di origine; al prossimo aggiornamento compaiono anche qui:'),
        h('ul', r.todo.map(t => h('li', h('strong', names.get(t.oid) || t.oid), ` · ${t.software} — ${t.plan} (in ${t.where})`))),
        h('a.btn', { href: 'https://admin.microsoft.com/#/users', target: '_blank', rel: 'noopener' }, 'Apri l\'interfaccia di amministrazione di Microsoft 365 ', icon('external', { size: 14 }))),
    });
  }
  onDone?.();
}

// ── pacchetti per ruolo ───────────────────────────────────────────────────
async function packagesTab(box) {
  const packages = await get('/api/software/packages');
  fill(box,
    h('div.sw-tools', h('p.muted.grow', 'Un pacchetto è l\'insieme di licenze che spetta a un ruolo. Si propone alle persone con quel ruolo o reparto e si assegna in un colpo.'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => editPackage(null) } }, icon('plus', { size: 16 }), 'Nuovo pacchetto')),
    packages.length ? h('div.sw-packs', packages.map(k => h('section.card.sw-card',
      h('div.spread', h('h3', k.name), h('strong', `${eur(k.monthly_cost)} al mese`)),
      k.description ? h('p.small', k.description) : null,
      h('div.small.muted', [k.job_titles.length ? `Ruoli: ${k.job_titles.join(', ')}` : null, k.departments.length ? `Reparti: ${k.departments.join(', ')}` : null].filter(Boolean).join(' · ') || 'Nessun ruolo o reparto: si applica a mano'),
      h('div.sw-chips', k.plans.map(p => h('span.pill', `${p.software_name} · ${p.plan_name}`))),
      h('div.row',
        h('button.btn.btn-sm', { type: 'button', on: { click: () => pickPeople({ title: `Applica «${k.name}»`, onPick: oids => applyPackage(k, oids) }) } }, 'Applica a persone'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => editPackage(k) } }, 'Modifica')))))
      : h('div.card.empty', 'Nessun pacchetto ancora. Creane uno per ruolo, per esempio «Commerciale» o «Tecnico di cantiere».'));
}

async function editPackage(k) {
  const [data, people] = await Promise.all([get('/api/software'), orgPeople()]);
  const titles = [...new Set(people.map(p => p.job_title).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const depts = [...new Set(people.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const name = h('input.input', { value: k?.name || '', maxlength: 120, placeholder: 'es. Commerciale' });
  const desc = h('textarea.input', { rows: 2, maxlength: 1000 }, k?.description || '');
  const chosen = new Set((k?.plans || []).map(p => p.plan_id));
  const checks = (values, selected) => h('div.sw-checks', values.map(v => h('label', h('input', { type: 'checkbox', value: v, checked: selected.includes(v) }), ` ${v}`)));
  const titleBox = checks(titles, k?.job_titles || []);
  const deptBox = checks(depts, k?.departments || []);
  const plans = h('div.sw-checks.plans', data.software.filter(s => s.status === 'attivo' && s.plans.length).map(s => h('div',
    h('strong.small', s.name),
    s.plans.map(p => h('label', h('input', { type: 'checkbox', checked: chosen.has(p.id), on: { change: e => { if (e.target.checked) chosen.add(p.id); else chosen.delete(p.id); } } }),
      ` ${p.name}${p.monthly_unit !== null ? ` · ${eur(p.monthly_unit)}/mese` : ''}`)))));
  const values = box => [...box.querySelectorAll('input:checked')].map(i => i.value);
  const m = modal({
    title: k ? `Pacchetto «${k.name}»` : 'Nuovo pacchetto',
    wide: true,
    body: h('div.sw-form', field('Nome', name), field('Descrizione', desc),
      h('div.grid-2', h('div.field', h('span', 'Si propone a questi ruoli'), titleBox), h('div.field', h('span', 'e a questi reparti'), deptBox)),
      h('div.field', h('span', 'Licenze del pacchetto'), plans)),
    left: k ? [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare il pacchetto «${k.name}»? Le licenze già assegnate restano.`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/software/packages/${k.id}`);
      m.close();
      location.reload();
    } } }, 'Cancella')] : [],
    actions: [
      h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const body = { name: name.value, description: desc.value, job_titles: values(titleBox), departments: values(deptBox), plan_ids: [...chosen] };
        if (k) await patch(`/api/software/packages/${k.id}`, body); else await post('/api/software/packages', body);
        m.close();
        toast('Pacchetto salvato');
        location.reload();
      } } }, 'Salva'),
    ],
  });
}
