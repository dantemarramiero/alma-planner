// Mezzi aziendali. Per tutti: quanti mezzi sono liberi per categoria, richiesta di una categoria (con note), le proprie
// prenotazioni, ritiro e riconsegna dal QR code del mezzo, segnalazione di un problema. Per i gestori del parco:
// cruscotto, richieste da approvare (con la scelta del mezzo), planner, anagrafica con etichette QR, scadenze,
// manutenzioni, costi, storico di chi ha usato ogni mezzo, impostazioni (categorie e gestori).
import { h, clear, fill, modal, confirmDialog, toast, fmtDate, loading, debounce, avatar } from './ui.js';
import { api, get, post, patch, del } from './api.js';
import { store, userById } from './store.js';
import { icon } from './icons.js';
import { peoplePicker } from './people.js';
import { mediaUrl, pickImages, uploadImage } from './media.js';

const TABS = [['cruscotto', 'Disponibilità'], ['richieste', 'Richieste'], ['planner', 'Planner'], ['elenco', 'Mezzi'], ['scadenze', 'Scadenze'], ['storico', 'Storico'], ['impostazioni', 'Impostazioni']];
const STATE = {
  libero: 'Libero', in_uso: 'In uso', prenotato: 'Prenotato', manutenzione: 'In manutenzione',
  fuori_servizio: 'Fuori servizio', dismesso: 'Dismesso', assegnato: 'Assegnato',
};
const BOOKING = { richiesta: 'Da approvare', approvata: 'Approvata', rifiutata: 'Rifiutata', annullata: 'Annullata', in_corso: 'In corso', conclusa: 'Conclusa' };
const OWNERSHIP = { proprieta: 'Proprietà', noleggio: 'Noleggio', leasing: 'Leasing', comodato: 'Comodato' };
const DEADLINE = { assicurazione: 'Assicurazione', bollo: 'Bollo', revisione: 'Revisione', tagliando: 'Tagliando', gomme: 'Cambio gomme', noleggio: 'Fine noleggio', tachigrafo: 'Tachigrafo', altro: 'Altro' };
const MAINT = { tagliando: 'Tagliando', riparazione: 'Riparazione', gomme: 'Gomme', carrozzeria: 'Carrozzeria', revisione: 'Revisione', altro: 'Altro' };
const COST = { carburante: 'Carburante', pedaggio: 'Pedaggio', multa: 'Multa', assicurazione: 'Assicurazione', bollo: 'Bollo', noleggio: 'Noleggio', lavaggio: 'Lavaggio', parcheggio: 'Parcheggio', altro: 'Altro' };
const FUELS = ['Benzina', 'Diesel', 'Ibrido', 'Elettrico', 'GPL', 'Metano'];

// ── formati ──────────────────────────────────────────────────────────────────
const num = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('it-IT'));
const eur = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
const dt = iso => (iso ? new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
const vName = x => [x.code, x.plate].filter(Boolean).join(' · ');
const vModel = x => [x.make, x.model].filter(Boolean).join(' ');
const statePill = s => h('span.pill.fl-st', { class: `fl-${s}` }, h('span.dot'), STATE[s] || s);
const bookingPill = s => h('span.pill.fl-bk', { class: `fl-bk-${s}` }, h('span.dot'), BOOKING[s] || s);
// datetime-local ↔ ISO
const pad = n => String(n).padStart(2, '0');
const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromLocal = s => (s ? new Date(s).toISOString() : '');
const daysLeft = due => Math.round((Date.parse(`${String(due).slice(0, 10)}T12:00:00`) - Date.parse(`${toLocal(new Date()).slice(0, 10)}T12:00:00`)) / 86400000);

const field = (label, input, hint) => h('label.field', h('span', label), input, hint ? h('small.muted', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));

let categoriesCache = null;
async function categories(force = false) {
  if (!categoriesCache || force) categoriesCache = await get('/api/mezzi/categorie');
  return categoriesCache;
}

// ── ingresso ─────────────────────────────────────────────────────────────────
export async function fleetView(container, parts = []) {
  const sub = parts[1];
  if (sub === 'qr' && parts[2]) return qrView(container, parts[2]);
  if (sub === 'v' && parts[2]) return vehicleView(container, Number(parts[2]));
  if (sub === 'prenotazioni' && parts[2]) return bookingView(container, Number(parts[2]));
  if (sub === 'etichette') return labelsView(container);
  const manager = store.me.fleet_manager;
  if (!manager) return userHome(container, { openForm: sub === 'prenota' });
  const tab = TABS.some(([k]) => k === sub) ? sub : 'cruscotto';
  const body = h('div.fl-body', loading());
  const tabs = h('div.seg.fl-tabs', TABS.map(([k, label]) => h('button', { type: 'button', 'data-k': k, class: k === tab ? 'on' : '', on: { click: () => { location.hash = `#/mezzi/${k}`; } } }, label)));
  fill(container,
    h('div.page-head', h('div', h('h1', 'Mezzi aziendali'), h('div.sub', 'Disponibilità, prenotazioni, scadenze e manutenzioni del parco mezzi.')),
      h('div.row', h('button.btn', { type: 'button', on: { click: () => bookingForm() } }, icon('plus', { size: 16 }), 'Prenota per te'))),
    tabs, body);
  const data = await get('/api/mezzi');
  if (data.counts?.pending) tabs.querySelector('[data-k="richieste"]').append(h('span.sw-count-badge', num(data.counts.pending)));
  if (tab === 'cruscotto') dashboard(body, data);
  else if (tab === 'richieste') await requestsTab(body);
  else if (tab === 'planner') await plannerTab(body);
  else if (tab === 'elenco') await listTab(body);
  else if (tab === 'scadenze') await deadlinesTab(body);
  else if (tab === 'storico') await historyTab(body);
  else await settingsTab(body);
  if (sub === 'prenota') bookingForm();
}

// ── chi prenota ──────────────────────────────────────────────────────────────
async function userHome(container, { openForm }) {
  fill(container, loading());
  const data = await get('/api/mezzi');
  fill(container,
    h('div.page-head', h('div', h('h1', 'Mezzi aziendali'), h('div.sub', 'Chiedi un mezzo per categoria: il gestore del parco approva e ti assegna quello giusto.')),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => bookingForm({ onDone: () => userHome(container, {}) }) } }, icon('plus', { size: 16 }), 'Prenota un mezzo')),
    h('section.fl-section', h('div.fl-label', 'Disponibili adesso'), categoryCards(data.categories, false)),
    h('section.fl-section', h('div.fl-label', 'Le mie prenotazioni'), myBookings(data.mine, () => userHome(container, {}))),
    h('p.small.muted.fl-hint', icon('crosshair', { size: 14 }), ' Su ogni mezzo c\'è un QR code: inquadralo col telefono per ritirarlo, riconsegnarlo o segnalare un problema.'));
  if (openForm) bookingForm({ onDone: () => userHome(container, {}) });
}

function categoryCards(cats, manager) {
  if (!cats.length) return h('div.card.empty', manager ? 'Nessuna categoria: creale in Impostazioni.' : 'Il parco mezzi non è ancora stato caricato.');
  return h('div.fl-cats', cats.map(c => {
    // chi prenota conta solo i mezzi prenotabili: quelli in assegnazione fissa a una persona non lo sono
    const total = manager ? c.total : c.total - (c.assegnato || 0);
    const pct = total ? Math.round((c.libero / total) * 100) : 0;
    return h('div.card.fl-cat',
      h('div.spread', h('strong', c.name), h('span.fl-free', { class: c.libero ? '' : 'none' }, `${c.libero} ${c.libero === 1 ? 'libero' : 'liberi'}`)),
      h('div.fl-bar', h('i', { style: { width: `${pct}%` } })),
      h('div.small.muted', [`${total} in tutto`, c.in_uso && `${c.in_uso} in uso`, c.prenotato && `${c.prenotato} prenotati ora`,
        c.manutenzione && `${c.manutenzione} in manutenzione`, c.fuori_servizio && `${c.fuori_servizio} fuori servizio`, manager && c.assegnato && `${c.assegnato} assegnati`].filter(Boolean).join(' · ')),
      c.description ? h('div.small.muted', c.description) : null);
  }));
}

function myBookings(list, reload) {
  if (!list.length) return h('div.card.empty', 'Nessuna prenotazione. Con «Prenota un mezzo» chiedi la categoria che ti serve.');
  return h('div.card.fl-list', list.map(b => h('a.fl-row', { href: `#/mezzi/prenotazioni/${b.id}` },
    h('div.grow',
      h('div', h('strong', b.vehicle_id ? `${vName(b)}` : b.category_name), b.vehicle_id ? h('span.muted', ` ${vModel(b)}`) : h('span.muted', ' · mezzo da assegnare')),
      h('div.small.muted', `${dt(b.start_at)} → ${dt(b.end_at)} · ${b.purpose}`)),
    bookingPill(b.status),
    b.status === 'approvata' || b.status === 'in_corso' ? h('span.small.fl-act', b.status === 'approvata' ? 'Ritira' : 'Riconsegna') : null)));
}

// Richiesta: categoria, date, motivo, destinazione, progetto, note. Mentre si sceglie, quanti mezzi sono liberi.
export async function bookingForm({ onDone } = {}) {
  const cats = (await categories(true)).filter(c => !c.archived);
  if (!cats.length) return toast('Non ci sono ancora categorie di mezzi', 'err');
  const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
  const end = new Date(start); end.setHours(start.getHours() + 4);
  const cat = select(cats.map(c => [c.id, c.name]), cats[0].id);
  const from = input({ type: 'datetime-local', value: toLocal(start), step: 900 });
  const to = input({ type: 'datetime-local', value: toLocal(end), step: 900 });
  const purpose = input({ placeholder: 'Es. sopralluogo cantiere, riunione dal cliente', maxLength: 300 });
  const dest = input({ placeholder: 'Città o indirizzo', maxLength: 300 });
  const project = select([['', 'Nessuno'], ...store.projects.filter(p => p.status !== 'archived').map(p => [p.id, p.name])], '');
  const notes = h('textarea.input', { rows: 3, maxLength: 2000, placeholder: 'Es. serve il gancio traino, 7 posti, carico ingombrante…' });
  const avail = h('div.fl-avail');
  const check = debounce(async () => {
    if (!from.value || !to.value || to.value <= from.value) return fill(avail, h('span.muted', 'Scegli le date'));
    try {
      const r = await get(`/api/mezzi/disponibilita?category_id=${cat.value}&start=${encodeURIComponent(fromLocal(from.value))}&end=${encodeURIComponent(fromLocal(to.value))}`, { quiet: true });
      fill(avail, r.free
        ? [icon('check', { size: 16 }), ` ${r.free} ${r.free === 1 ? 'mezzo libero' : 'mezzi liberi'} in queste date`]
        : [icon('alarm-clock', { size: 16 }), ' Nessun mezzo libero in queste date: puoi chiedere lo stesso, il gestore ti risponde']);
      avail.classList.toggle('none', !r.free);
    } catch { clear(avail); }
  }, 300);
  for (const el of [cat, from, to]) el.addEventListener('change', check);
  check();
  const send = h('button.btn.btn-primary', { type: 'button' }, 'Invia la richiesta');
  const m = modal({
    title: 'Prenota un mezzo',
    body: [
      field('Categoria', cat, 'Chiedi il tipo di mezzo: quello preciso lo sceglie il gestore.'),
      h('div.grid-2', field('Ritiro', from), field('Riconsegna', to)),
      avail,
      field('Motivo', purpose),
      h('div.grid-2', field('Destinazione', dest), field('Progetto (facoltativo)', project)),
      field('Note per il gestore', notes),
    ],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send],
  });
  send.addEventListener('click', async () => {
    if (!purpose.value.trim()) return toast('Scrivi il motivo', 'err');
    send.disabled = true;
    try {
      const b = await post('/api/mezzi/prenotazioni', {
        category_id: Number(cat.value), start_at: fromLocal(from.value), end_at: fromLocal(to.value),
        purpose: purpose.value, destination: dest.value, notes: notes.value, project_id: project.value ? Number(project.value) : null,
      });
      m.close();
      toast('Richiesta inviata: ti avvisiamo quando il gestore risponde');
      onDone ? onDone(b) : (location.hash = `#/mezzi/prenotazioni/${b.id}`);
    } catch { send.disabled = false; }
  });
}

// ── una prenotazione ─────────────────────────────────────────────────────────
async function bookingView(container, id) {
  fill(container, loading());
  let b;
  try { b = await get(`/api/mezzi/prenotazioni/${id}`); } catch { return fill(container, h('div.card.empty', 'Prenotazione non trovata.')); }
  const reload = () => bookingView(container, id);
  const mine = b.requester_id === store.me.id;
  const actions = [];
  if (b.manager && b.status === 'richiesta') actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: () => approveDialog(b, reload) } }, icon('check', { size: 16 }), 'Approva e assegna'),
    h('button.btn', { type: 'button', on: { click: () => rejectDialog(b, reload) } }, 'Rifiuta'));
  const pickupOpen = new Date(b.start_at) - Date.now() <= 12 * 3600000;
  if ((mine || b.manager) && b.status === 'approvata' && pickupOpen) actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: () => pickupDialog(b, reload) } }, 'Ritira il mezzo'));
  if ((mine || b.manager) && b.status === 'in_corso') actions.push(h('button.btn.btn-primary', { type: 'button', on: { click: () => returnDialog(b, reload) } }, 'Riconsegna il mezzo'));
  if (b.manager && ['richiesta', 'approvata', 'in_corso'].includes(b.status)) actions.push(h('button.btn', { type: 'button', on: { click: () => editBookingDialog(b, reload) } }, b.status === 'in_corso' ? 'Prolunga' : 'Cambia date o mezzo'));
  if ((mine || b.manager) && ['richiesta', 'approvata'].includes(b.status)) actions.push(h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
    if (!await confirmDialog('Annullare la prenotazione?', { ok: 'Annulla la prenotazione', danger: true })) return;
    await post(`/api/mezzi/prenotazioni/${id}/annulla`);
    toast('Prenotazione annullata');
    document.dispatchEvent(new Event('badges-changed'));
    reload();
  } } }, 'Annulla'));
  const late = b.status === 'in_corso' && new Date(b.end_at) < new Date();
  const row = (k, val) => (val === null || val === undefined || val === '' ? null : h('div.fl-kv', h('span', k), h('div', val)));
  fill(container,
    h('div.page-head', h('div', h('h1', b.vehicle_id ? vName(b) : `Richiesta: ${b.category_name}`), h('div.sub', b.vehicle_id ? `${vModel(b)} · ${b.category_name}` : 'Il mezzo lo sceglie il gestore all\'approvazione')),
      bookingPill(b.status)),
    late ? h('div.banner', 'Riconsegna in ritardo: doveva rientrare ', dt(b.end_at), '. Riconsegnalo o chiedi al gestore di prolungare.') : null,
    h('div.card.fl-detail',
      row('Chi', b.requester_name),
      row('Ritiro previsto', dt(b.start_at)), row('Riconsegna prevista', dt(b.end_at)),
      row('Motivo', b.purpose), row('Destinazione', b.destination), row('Note', b.notes ? h('span.pre', b.notes) : null),
      row('Progetto', b.project_id ? h('a', { href: `#/projects/${b.project_id}` }, store.projects.find(p => p.id === b.project_id)?.name || 'Apri il progetto') : null),
      b.decided_at ? row(b.status === 'rifiutata' ? 'Rifiutata da' : 'Decisa da', `${b.decided_by_name || '—'}, ${dt(b.decided_at)}${b.decision_note ? ` · ${b.decision_note}` : ''}`) : null,
      b.picked_up_at ? row('Ritirato', `${dt(b.picked_up_at)}${b.pickup_km !== null ? ` · ${num(b.pickup_km)} km` : ''}`) : null,
      b.returned_at ? row('Riconsegnato', `${dt(b.returned_at)}${b.return_km !== null ? ` · ${num(b.return_km)} km` : ''}${b.return_fuel ? ` · carburante ${b.return_fuel}` : ''}`) : null,
      b.return_km !== null && b.pickup_km !== null ? row('Km percorsi', num(b.return_km - b.pickup_km)) : null,
      row('Note alla riconsegna', b.return_notes)),
    actions.length ? h('div.row.fl-actions', actions) : null,
    b.manager && b.vehicle_id ? h('p', h('a', { href: `#/mezzi/v/${b.vehicle_id}` }, 'Apri la scheda del mezzo')) : null);
}

async function approveDialog(b, done) {
  const free = b.free || [];
  const same = free.filter(x => x.category_id === b.category_id);
  const other = free.filter(x => x.category_id !== b.category_id);
  if (!free.length) return toast('Nessun mezzo libero in quelle date: cambia le date o rifiuta la richiesta', 'err');
  const cats = await categories();
  const catName = id => cats.find(c => c.id === id)?.name || '';
  const pick = select([
    ...same.map(x => [x.id, `${vName(x)} · ${vModel(x)}`]),
    ...other.map(x => [x.id, `${vName(x)} · ${vModel(x)} (${catName(x.category_id)})`]),
  ], (same[0] || other[0]).id);
  const note = input({ placeholder: 'Es. le chiavi sono in portineria', maxLength: 1000 });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Approva');
  const m = modal({
    title: 'Approva e assegna il mezzo',
    body: [
      h('p.muted', `${b.requester_name} chiede «${b.category_name}» dal ${dt(b.start_at)} al ${dt(b.end_at)}.`),
      b.notes ? h('div.banner', `Note: ${b.notes}`) : null,
      field('Mezzo', pick, same.length ? `${same.length} liberi della categoria richiesta${other.length ? `, ${other.length} di altre categorie` : ''}` : 'Nessun mezzo libero della categoria richiesta: ne puoi dare uno di un\'altra'),
      field('Nota per chi ha chiesto (facoltativa)', note),
    ],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await post(`/api/mezzi/prenotazioni/${b.id}/approva`, { vehicle_id: Number(pick.value), note: note.value });
      m.close();
      toast('Approvata: chi ha chiesto riceve la notifica');
      document.dispatchEvent(new Event('badges-changed'));
      done();
    } catch { ok.disabled = false; }
  });
}

function rejectDialog(b, done) {
  const reason = h('textarea.input', { rows: 3, maxLength: 1000, placeholder: 'Es. nessun mezzo libero, usa il furgone del cantiere' });
  const ok = h('button.btn.btn-danger', { type: 'button' }, 'Rifiuta');
  const m = modal({ title: 'Rifiuta la richiesta', body: [field('Motivo (lo legge chi ha chiesto)', reason)], actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok] });
  ok.addEventListener('click', async () => {
    if (!reason.value.trim()) return toast('Scrivi il motivo', 'err');
    await post(`/api/mezzi/prenotazioni/${b.id}/rifiuta`, { note: reason.value });
    m.close();
    document.dispatchEvent(new Event('badges-changed'));
    done();
  });
}

function pickupDialog(b, done) {
  const km = input({ type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Km sul cruscotto' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Ritiro il mezzo');
  const m = modal({ title: `Ritiro di ${vName(b)}`, body: [field('Km sul cruscotto', km, 'Servono per lo storico e per le scadenze a km (tagliando).')], actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok] });
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await post(`/api/mezzi/prenotazioni/${b.id}/ritiro`, { km: km.value === '' ? null : Number(km.value) });
      m.close();
      toast(`Buon viaggio: riconsegna entro ${dt(b.end_at)}`);
      done();
    } catch { ok.disabled = false; }
  });
}

function returnDialog(b, done) {
  const km = input({ type: 'number', min: b.pickup_km || 0, inputmode: 'numeric', placeholder: b.pickup_km !== null ? `Al ritiro: ${num(b.pickup_km)}` : 'Km sul cruscotto' });
  const fuel = select([['', '—'], ['vuoto', 'Riserva'], ['1/4', '1/4'], ['1/2', '1/2'], ['3/4', '3/4'], ['pieno', 'Pieno']], '');
  const notes = h('textarea.input', { rows: 3, maxLength: 2000, placeholder: 'Es. da lavare, spia accesa, graffio sul paraurti…' });
  const damage = h('input', { type: 'checkbox' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Riconsegno il mezzo');
  const m = modal({
    title: `Riconsegna di ${vName(b)}`,
    body: [h('div.grid-2', field('Km sul cruscotto', km), field('Carburante o carica', fuel)), field('Note', notes),
      h('label.check', damage, 'C\'è un danno o un guasto: avvisa i gestori con un ticket')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    if (damage.checked && !notes.value.trim()) return toast('Descrivi il danno nelle note', 'err');
    ok.disabled = true;
    try {
      await post(`/api/mezzi/prenotazioni/${b.id}/riconsegna`, { km: km.value === '' ? null : Number(km.value), fuel: fuel.value, notes: notes.value, damage: damage.checked });
      m.close();
      toast('Mezzo riconsegnato, grazie');
      done();
    } catch { ok.disabled = false; }
  });
}

async function editBookingDialog(b, done) {
  const running = b.status === 'in_corso';
  const from = input({ type: 'datetime-local', value: toLocal(new Date(b.start_at)), step: 900, disabled: running });
  const to = input({ type: 'datetime-local', value: toLocal(new Date(b.end_at)), step: 900 });
  let vehicle = null;
  if (b.status === 'approvata') {
    const all = await get('/api/mezzi/elenco');
    vehicle = select(all.filter(x => x.status === 'attivo').map(x => [x.id, `${vName(x)} · ${vModel(x)}`]), b.vehicle_id);
  }
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Salva');
  const m = modal({
    title: running ? 'Prolunga la prenotazione' : 'Cambia date o mezzo',
    body: [h('div.grid-2', field('Ritiro', from), field('Riconsegna', to)), vehicle ? field('Mezzo', vehicle) : null, h('p.small.muted', 'Chi ha prenotato riceve una notifica.')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await patch(`/api/mezzi/prenotazioni/${b.id}`, { start_at: running ? undefined : fromLocal(from.value), end_at: fromLocal(to.value), vehicle_id: vehicle ? Number(vehicle.value) : undefined });
      m.close();
      done();
    } catch { ok.disabled = false; }
  });
}

// ── QR code: cosa si vede inquadrando l'etichetta ────────────────────────────
async function qrView(container, token) {
  fill(container, loading());
  let d;
  try { d = await get(`/api/mezzi/qr/${encodeURIComponent(token)}`); } catch (err) { return fill(container, h('div.card.empty', err.message)); }
  const x = d.vehicle, b = d.booking;
  const reload = () => qrView(container, token);
  const big = (label, ico, onClick, primary = false) => h(primary ? 'button.btn.btn-primary.fl-big' : 'button.btn.fl-big', { type: 'button', on: { click: onClick } }, icon(ico, { size: 22 }), label);
  const actions = [];
  if (b?.status === 'approvata') actions.push(big('Ritira il mezzo', 'check', () => pickupDialog({ ...b, ...x, id: b.id, end_at: b.end_at }, reload), true));
  if (b?.status === 'in_corso') actions.push(big('Riconsegna il mezzo', 'check', () => returnDialog({ ...b, ...x, id: b.id }, reload), true));
  actions.push(big('Segnala un problema', 'bell', () => reportDialog(x, reload)));
  if (!b) actions.push(big('Prenota un mezzo', 'calendar', () => bookingForm()));
  if (d.manager) actions.push(big('Apri la scheda', 'file-text', () => { location.hash = `#/mezzi/v/${x.id}`; }));
  const where = {
    libero: x.next_start ? `Libero, prenotato dal ${dt(x.next_start)}` : 'Libero',
    in_uso: `In uso fino a ${dt(x.current_end)}`,
    prenotato: `Prenotato fino a ${dt(x.current_end)}`,
    manutenzione: x.maintenance_end ? `In manutenzione fino al ${day(x.maintenance_end)}` : 'In manutenzione',
    fuori_servizio: x.status_note || 'Fuori servizio: non usarlo',
  }[x.state] || STATE[x.state];
  fill(container,
    h('div.fl-qr',
      h('div.card.fl-qr-head',
        x.photo_media_id ? h('img.fl-photo', { src: mediaUrl(x.photo_media_id), alt: '' }) : h('span.fl-photo.ph', icon('car', { size: 34 })),
        h('div', h('div.fl-label', x.category_name), h('h1', vName(x)), h('div.muted', [vModel(x), x.km !== null ? `${num(x.km)} km` : null].filter(Boolean).join(' · ')),
          h('div.fl-qr-state', statePill(x.state), h('span.small', where)))),
      b ? h('div.card.fl-qr-mine', h('strong', b.status === 'in_corso' ? 'Lo stai usando tu' : 'È prenotato per te'),
        h('div.small.muted', `${dt(b.start_at)} → ${dt(b.end_at)} · ${b.purpose}`)) : null,
      h('div.fl-qr-actions', actions)));
}

function reportDialog(x, done) {
  const title = input({ placeholder: 'Es. spia olio accesa, gomma a terra, graffio', maxLength: 200 });
  const desc = h('textarea.input', { rows: 4, maxLength: 5000, placeholder: 'Cosa è successo, dove si trova il mezzo…' });
  const blocking = h('input', { type: 'checkbox' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Invia la segnalazione');
  const m = modal({
    title: `Segnala un problema su ${vName(x)}`,
    body: [field('Problema', title), field('Descrizione', desc),
      h('label.check', blocking, 'Il mezzo non è utilizzabile (va subito fuori servizio)')],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    if (!title.value.trim()) return toast('Scrivi qual è il problema', 'err');
    ok.disabled = true;
    try {
      await post(`/api/mezzi/${x.id}/segnala`, { title: title.value, description: desc.value, blocking: blocking.checked });
      m.close();
      toast('Segnalazione inviata ai gestori del parco');
      done?.();
    } catch { ok.disabled = false; }
  });
}

// ── gestori: cruscotto ───────────────────────────────────────────────────────
function dashboard(box, data) {
  const vs = data.vehicles || [];
  const by = s => vs.filter(x => x.state === s);
  const kpi = (label, value, sub, warn, href) => h(href ? 'a.sw-kpi' : 'div.sw-kpi', { class: warn ? 'warn' : '', href }, h('span.lab', label), h('strong.big', num(value)), sub ? h('span.sub', sub) : null);
  fill(box,
    h('div.sw-kpis',
      kpi('Liberi adesso', by('libero').length, `su ${vs.filter(x => x.status === 'attivo').length} attivi`),
      kpi('In uso', by('in_uso').length, data.counts.late ? `${data.counts.late} in ritardo sulla riconsegna` : 'nessun ritardo', data.counts.late > 0),
      kpi('Richieste da approvare', data.counts.pending, null, data.counts.pending > 0, '#/mezzi/richieste'),
      kpi('Scadenze entro 30 giorni', data.deadlines.length, null, data.deadlines.length > 0, '#/mezzi/scadenze'),
      kpi('Segnalazioni aperte', data.counts.reports, null, data.counts.reports > 0)),
    h('div.fl-label', 'Per categoria'),
    categoryCards(data.categories, true),
    h('div.fl-label', 'I mezzi adesso'),
    vs.length ? h('div.fl-grid', vs.map(vehicleCard)) : h('div.card.empty', 'Nessun mezzo: aggiungili dal tab «Mezzi».'),
    data.deadlines.length ? [h('div.fl-label', 'Scadenze da guardare'), deadlineList(data.deadlines, () => location.reload())] : null);
}

function vehicleCard(x) {
  const line = {
    in_uso: `${x.current_user_name} · fino a ${dt(x.current_end)}`,
    prenotato: `${x.current_user_name} · fino a ${dt(x.current_end)}`,
    manutenzione: `${x.maintenance_supplier || 'Officina'}${x.maintenance_end ? ` · fino al ${day(x.maintenance_end)}` : ''}`,
    fuori_servizio: x.status_note || '',
    assegnato: `Assegnato a ${x.assigned_name}`,
    libero: x.next_start ? `Prossima: ${dt(x.next_start)}, ${x.next_user_name}` : (x.location || ''),
  }[x.state] || '';
  const late = x.state === 'in_uso' && new Date(x.current_end) < new Date();
  return h('a.card.fl-vcard', { href: `#/mezzi/v/${x.id}`, class: late ? 'late' : '' },
    h('div.spread', h('strong', vName(x)), statePill(x.state)),
    h('div.small.muted', `${vModel(x) || '—'} · ${x.category_name}`),
    h('div.small', late ? `In ritardo: doveva rientrare ${dt(x.current_end)} (${x.current_user_name})` : line),
    x.open_reports ? h('div.small.fl-warn', icon('bell', { size: 14 }), ` ${x.open_reports} ${x.open_reports === 1 ? 'segnalazione aperta' : 'segnalazioni aperte'}`) : null);
}

// ── gestori: richieste ───────────────────────────────────────────────────────
async function requestsTab(box) {
  const filters = [['richiesta', 'Da approvare'], ['approvata,in_corso', 'Approvate e in corso'], ['conclusa,rifiutata,annullata', 'Chiuse']];
  let current = 'richiesta';
  const seg = h('div.seg', filters.map(([k, l]) => h('button', { type: 'button', class: k === current ? 'on' : '', on: { click: e => { current = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); draw(); } } }, l)));
  const list = h('div');
  fill(box, h('div.toolbar', seg, h('span.grow'), h('button.btn', { type: 'button', on: { click: () => directUseDialog(() => draw()) } }, 'Consegna senza prenotazione')), list);
  async function draw() {
    fill(list, loading());
    const rows = await get(`/api/mezzi/prenotazioni?status=${current}`);
    if (!rows.length) return fill(list, h('div.card.empty', current === 'richiesta' ? 'Nessuna richiesta da approvare.' : 'Niente qui.'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Chi', 'Categoria / mezzo', 'Dal', 'Al', 'Motivo', 'Stato'].map(t => h('th', t)))),
      h('tbody', rows.map(b => h('tr', { on: { click: () => { location.hash = `#/mezzi/prenotazioni/${b.id}`; } } },
        h('td', h('strong', b.requester_name)),
        h('td', b.vehicle_id ? `${vName(b)}` : h('span', b.category_name, h('span.muted', ' · da assegnare'))),
        h('td', dt(b.start_at)), h('td', dt(b.end_at)),
        h('td', h('div', b.purpose), b.notes ? h('div.small.muted', b.notes) : null),
        h('td', bookingPill(b.status))))))));
  }
  draw();
}

async function directUseDialog(done) {
  const all = (await get('/api/mezzi/elenco')).filter(x => x.state === 'libero');
  if (!all.length) return toast('Nessun mezzo libero adesso', 'err');
  const veh = select(all.map(x => [x.id, `${vName(x)} · ${vModel(x)}`]), all[0].id);
  let userId = null;
  const person = peoplePicker({ selected: [], label: '+ Persona', onChange: ids => { userId = ids[ids.length - 1] || null; } });
  const end = new Date(); end.setHours(end.getHours() + 4, 0, 0, 0);
  const to = input({ type: 'datetime-local', value: toLocal(end), step: 900 });
  const km = input({ type: 'number', min: 0, placeholder: 'Km sul cruscotto' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Registra la consegna');
  const m = modal({
    title: 'Consegna senza prenotazione',
    body: [h('p.small.muted', 'Per chi prende un mezzo senza averlo chiesto in Alma Planet: finisce nello storico come gli altri.'),
      field('Mezzo', veh), field('A chi', person.el), h('div.grid-2', field('Riconsegna prevista', to), field('Km', km))],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    if (!userId) return toast('Scegli la persona', 'err');
    ok.disabled = true;
    try {
      await post('/api/mezzi/uso-diretto', { vehicle_id: Number(veh.value), user_id: userId, end_at: fromLocal(to.value), km: km.value === '' ? null : Number(km.value) });
      m.close();
      toast('Consegna registrata');
      done?.();
    } catch { ok.disabled = false; }
  });
}

// ── gestori: planner (due settimane, una riga per mezzo) ─────────────────────
async function plannerTab(box) {
  let start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lunedì
  const DAYS = 14;
  const grid = h('div.fl-plan-wrap');
  const label = h('strong');
  const move = n => { start = new Date(start); start.setDate(start.getDate() + n); draw(); };
  fill(box, h('div.toolbar', h('button.btn.btn-sm', { type: 'button', on: { click: () => move(-7) } }, '‹ Settimana prima'), label,
    h('button.btn.btn-sm', { type: 'button', on: { click: () => move(7) } }, 'Settimana dopo ›'),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => { start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); draw(); } } }, 'Oggi'),
    h('span.grow'), h('span.small.muted.fl-legend', h('i.fl-lg.app'), 'approvata', h('i.fl-lg.run'), 'in corso', h('i.fl-lg.done'), 'conclusa', h('i.fl-lg.mnt'), 'manutenzione')), grid);
  async function draw() {
    const end = new Date(start); end.setDate(end.getDate() + DAYS);
    label.textContent = `${fmtDate(toLocal(start).slice(0, 10))} – ${fmtDate(toLocal(new Date(end - 1)).slice(0, 10), { year: true })}`;
    fill(grid, loading());
    const d = await get(`/api/mezzi/planner?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
    const span = end - start;
    const pos = (a, b) => {
      const l = Math.max(0, (new Date(a) - start) / span), r = Math.min(1, (new Date(b) - start) / span);
      return { left: `${l * 100}%`, width: `${Math.max(0.6, (r - l) * 100)}%` };
    };
    const days = [...Array(DAYS)].map((_, i) => { const x = new Date(start); x.setDate(x.getDate() + i); return x; });
    const todayKey = toLocal(new Date()).slice(0, 10);
    fill(grid, h('div.fl-plan',
      h('div.fl-plan-row.head', h('div.fl-plan-name'), h('div.fl-plan-days', days.map(x => h('span', { class: [x.getDay() % 6 === 0 ? 'we' : '', toLocal(x).slice(0, 10) === todayKey ? 'today' : ''].join(' ') },
        x.toLocaleDateString('it-IT', { weekday: 'short' }), h('b', String(x.getDate())))))),
      d.vehicles.map(x => h('div.fl-plan-row',
        h('a.fl-plan-name', { href: `#/mezzi/v/${x.id}` }, h('strong', x.code), h('small', vModel(x) || x.category_name)),
        h('div.fl-plan-days.track', days.map(dd => h('span', { class: dd.getDay() % 6 === 0 ? 'we' : '' })),
          d.maintenance.filter(m => m.vehicle_id === x.id).map(m => h('i.fl-bar-m', { style: pos(`${m.start_date}T00:00`, m.end_date ? `${String(m.end_date).slice(0, 10)}T23:59` : end), title: `${MAINT[m.kind]}${m.supplier ? ` · ${m.supplier}` : ''}` }, MAINT[m.kind])),
          d.bookings.filter(b => b.vehicle_id === x.id).map(b => h('a.fl-bar-b', {
            class: b.status === 'in_corso' ? 'run' : b.status === 'conclusa' ? 'done' : 'app',
            href: `#/mezzi/prenotazioni/${b.id}`,
            style: pos(b.picked_up_at || b.start_at, b.returned_at || (b.status === 'in_corso' && new Date(b.end_at) < new Date() ? new Date() : b.end_at)),
            title: `${b.requester_name}: ${dt(b.start_at)} → ${dt(b.end_at)} · ${b.purpose}`,
          }, b.requester_name)))))));
  }
  draw();
}

// ── gestori: anagrafica ──────────────────────────────────────────────────────
async function listTab(box) {
  const all = await get('/api/mezzi/elenco?dismessi=1');
  const cats = await categories(true);
  let q = '', showOld = false, cat = '';
  const table = h('div');
  const search = input({ type: 'search', placeholder: 'Cerca codice, targa, modello…' });
  search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); draw(); }, 150));
  const catSel = select([['', 'Tutte le categorie'], ...cats.map(c => [c.id, c.name])], '', { on: { change: e => { cat = e.target.value; draw(); } } });
  fill(box,
    h('div.toolbar', search, catSel, h('label.check', h('input', { type: 'checkbox', on: { change: e => { showOld = e.target.checked; draw(); } } }), 'Mostra dismessi'),
      h('span.grow'),
      h('a.btn', { href: '#/mezzi/etichette' }, icon('crosshair', { size: 16 }), 'Stampa etichette QR'),
      h('a.btn', { href: '/api/mezzi/esporta/mezzi.csv' }, icon('sheet', { size: 16 }), 'Esporta'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => vehicleForm(null, () => listTab(box)) } }, icon('plus', { size: 16 }), 'Nuovo mezzo')),
    table);
  function draw() {
    const rows = all.filter(x => (showOld || x.status !== 'dismesso') && (!cat || String(x.category_id) === cat)
      && (!q || [x.code, x.plate, x.make, x.model, x.location, x.assigned_name].some(s => String(s || '').toLowerCase().includes(q))));
    if (!rows.length) return fill(table, h('div.card.empty', all.length ? 'Nessun mezzo con questi filtri.' : 'Nessun mezzo. Aggiungi il primo con «Nuovo mezzo».'));
    fill(table, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Mezzo', 'Categoria', 'Modello', 'Km', 'Stato', 'Prossima scadenza', 'Sede'].map(t => h('th', t)))),
      h('tbody', rows.map(x => h('tr', { on: { click: () => { location.hash = `#/mezzi/v/${x.id}`; } } },
        h('td', h('strong', x.code), x.plate ? h('div.small.muted', x.plate) : null),
        h('td', x.category_name), h('td', vModel(x) || '—'), h('td.num', num(x.km)),
        h('td', statePill(x.state), x.open_reports ? h('div.small.fl-warn', `${x.open_reports} segnalazioni`) : null),
        h('td', x.next_deadline ? deadlineDate(x.next_deadline) : '—'), h('td', x.location || '—')))))));
  }
  draw();
}

const deadlineDate = due => {
  const n = daysLeft(due);
  return h('span', { class: n < 0 ? 'fl-late' : n <= 30 ? 'fl-soon' : '' }, day(due), n < 0 ? ' (scaduta)' : n <= 30 ? ` (tra ${n} gg)` : '');
};

async function vehicleForm(x, done) {
  const cats = (await categories(true)).filter(c => !c.archived || c.id === x?.category_id);
  if (!cats.length) return toast('Crea prima una categoria in Impostazioni', 'err');
  const f = {
    category_id: select(cats.map(c => [c.id, c.name]), x?.category_id ?? cats[0].id),
    code: input({ value: x?.code || '', maxLength: 30, placeholder: 'Es. AUTO-01' }),
    plate: input({ value: x?.plate || '', maxLength: 20, placeholder: 'Es. AB123CD' }),
    make: input({ value: x?.make || '', maxLength: 60 }),
    model: input({ value: x?.model || '', maxLength: 80 }),
    year: input({ type: 'number', value: x?.year ?? '', min: 1950, max: 2100 }),
    fuel: h('input.input', { value: x?.fuel || '', list: 'fl-fuels', maxLength: 30 }),
    seats: input({ type: 'number', value: x?.seats ?? '', min: 1, max: 99 }),
    km: input({ type: 'number', value: x?.km ?? '', min: 0 }),
    ownership: select(Object.entries(OWNERSHIP), x?.ownership || 'proprieta'),
    lessor: input({ value: x?.lessor || '', maxLength: 120 }),
    contract_end: input({ type: 'date', value: x?.contract_end ? String(x.contract_end).slice(0, 10) : '' }),
    location: input({ value: x?.location || '', maxLength: 120, placeholder: 'Es. sede di Pescara' }),
    vin: input({ value: x?.vin || '', maxLength: 40 }),
    fuel_card: input({ value: x?.fuel_card || '', maxLength: 60 }),
    telepass: input({ value: x?.telepass || '', maxLength: 60 }),
    status: select([['attivo', 'Attivo'], ['fuori_servizio', 'Fuori servizio'], ['dismesso', 'Dismesso']], x?.status || 'attivo'),
    status_note: input({ value: x?.status_note || '', maxLength: 500 }),
    notes: h('textarea.input', { rows: 3, maxLength: 5000 }, x?.notes || ''),
  };
  let assigned = x?.assigned_user_id || null;
  const assign = peoplePicker({ selected: assigned ? [assigned] : [], label: '+ Persona', onChange: ids => { assigned = ids[ids.length - 1] || null; } });
  let photoId;
  const photo = h('div.fl-photo-edit', x?.photo_media_id ? h('img.fl-photo', { src: mediaUrl(x.photo_media_id), alt: '' }) : h('span.fl-photo.ph', icon('image', { size: 26 })),
    h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
      const [file] = await pickImages();
      if (!file) return;
      try {
        const m = await uploadImage(file, { max: 1200 });
        photoId = m.id;
        photo.firstChild.replaceWith(h('img.fl-photo', { src: mediaUrl(m.id), alt: '' }));
      } catch (err) { if (!err.status) toast(err.message, 'err'); }
    } } }, 'Foto'));
  const leasing = h('div.grid-2', field('Società di noleggio/leasing', f.lessor), field('Fine contratto', f.contract_end, 'Crea anche la scadenza «Fine noleggio» per avere il promemoria'));
  const toggleLease = () => { leasing.hidden = f.ownership.value === 'proprieta'; };
  f.ownership.addEventListener('change', toggleLease);
  toggleLease();
  const ok = h('button.btn.btn-primary', { type: 'button' }, x ? 'Salva' : 'Aggiungi il mezzo');
  const m = modal({
    title: x ? `Modifica ${vName(x)}` : 'Nuovo mezzo',
    wide: true,
    body: [
      h('datalist#fl-fuels', FUELS.map(s => h('option', { value: s }))),
      h('div.fl-form-top', photo, h('div.grow', h('div.grid-2', field('Categoria', f.category_id), field('Codice interno', f.code, 'Stampato sull\'etichetta con il QR')),
        h('div.grid-2', field('Targa', f.plate), field('Km attuali', f.km)))),
      h('div.grid-2', field('Marca', f.make), field('Modello', f.model)),
      h('div.fl-grid-4', field('Anno', f.year), field('Alimentazione', f.fuel), field('Posti', f.seats), field('Possesso', f.ownership)),
      leasing,
      h('div.grid-2', field('Sede o parcheggio', f.location), field('Numero di telaio', f.vin)),
      h('div.grid-2', field('Carta carburante', f.fuel_card), field('Telepass', f.telepass)),
      field('Assegnazione fissa (facoltativa)', assign.el, 'Un mezzo assegnato a una persona non entra nelle prenotazioni.'),
      x ? h('div.grid-2', field('Stato', f.status), field('Nota sullo stato', f.status_note)) : null,
      field('Note', f.notes),
    ],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    const val = k => f[k].value;
    const intOrNull = k => (val(k) === '' ? null : Number(val(k)));
    const body = {
      category_id: Number(val('category_id')), code: val('code'), plate: val('plate'), make: val('make'), model: val('model'),
      year: intOrNull('year'), fuel: val('fuel'), seats: intOrNull('seats'), km: intOrNull('km'), ownership: val('ownership'),
      lessor: val('lessor'), contract_end: val('contract_end') || null, location: val('location'), vin: val('vin'),
      fuel_card: val('fuel_card'), telepass: val('telepass'), notes: val('notes'), assigned_user_id: assigned,
      ...(x ? { status: val('status'), status_note: val('status_note') } : {}),
      ...(photoId ? { photo_media_id: photoId } : {}),
    };
    if (!body.code.trim()) return toast('Scrivi il codice interno', 'err');
    if (x && body.km !== null && x.km !== null && body.km < x.km) {
      if (!await confirmDialog(`I km scendono da ${num(x.km)} a ${num(body.km)}: è la correzione di un errore?`, { ok: 'Sì, correggi' })) return;
      body.km_correction = true;
    }
    if (x && body.km === x.km) delete body.km;
    ok.disabled = true;
    try {
      const saved = x ? await patch(`/api/mezzi/elenco/${x.id}`, body) : await post('/api/mezzi/elenco', body);
      m.close();
      toast(x ? 'Salvato' : 'Mezzo aggiunto: stampa la sua etichetta QR dalla scheda');
      done?.(saved);
    } catch { ok.disabled = false; }
  });
}

// ── scheda del mezzo ─────────────────────────────────────────────────────────
async function vehicleView(container, id) {
  fill(container, loading());
  let d;
  try { d = await get(`/api/mezzi/elenco/${id}`); } catch { return fill(container, h('div.card.empty', 'Mezzo non trovato.')); }
  const x = d.vehicle;
  const reload = () => vehicleView(container, id);
  if (!d.manager) {
    return fill(container,
      h('div.page-head', h('div', h('h1', vName(x)), h('div.sub', `${vModel(x)} · ${x.category_name}`)), statePill(x.state)),
      h('div.row.fl-actions', h('button.btn', { type: 'button', on: { click: () => reportDialog(x, reload) } }, 'Segnala un problema'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => bookingForm() } }, 'Prenota un mezzo')));
  }
  const t = d.totals;
  const tab = (location.hash.split('?')[1] || '').replace('t=', '') || 'scadenze';
  const SECTIONS = [['scadenze', `Scadenze (${d.deadlines.filter(z => !z.done_at).length})`], ['manutenzioni', `Manutenzioni (${d.maintenance.length})`],
    ['costi', `Costi (${d.costs.length})`], ['storico', `Chi l'ha usato (${d.bookings.filter(b => b.status !== 'approvata').length})`], ['segnalazioni', `Segnalazioni (${d.tickets.length})`]];
  const body = h('div');
  const seg = h('div.seg.fl-tabs', SECTIONS.map(([k, l]) => h('button', { type: 'button', class: k === tab ? 'on' : '', on: { click: () => { location.hash = `#/mezzi/v/${id}?t=${k}`; } } }, l)));
  const info = (k, val) => (val === null || val === undefined || val === '' ? null : h('div.fl-kv', h('span', k), h('div', val)));
  const now = {
    in_uso: `In uso da ${x.current_user_name}, rientro ${dt(x.current_end)}`,
    prenotato: `Prenotato da ${x.current_user_name} fino a ${dt(x.current_end)}`,
    manutenzione: `In manutenzione${x.maintenance_supplier ? ` da ${x.maintenance_supplier}` : ''}${x.maintenance_end ? ` fino al ${day(x.maintenance_end)}` : ''}`,
    fuori_servizio: x.status_note || 'Fuori servizio',
    assegnato: `Assegnato a ${x.assigned_name}`,
    libero: x.next_start ? `Libero. Prossima prenotazione: ${dt(x.next_start)}, ${x.next_user_name}` : 'Libero',
    dismesso: 'Dismesso',
  }[x.state];
  fill(container,
    h('div.page-head', h('div', h('h1', vName(x)), h('div.sub', `${vModel(x) || '—'} · ${x.category_name}`)),
      h('div.row',
        h('button.btn', { type: 'button', on: { click: () => vehicleForm(x, reload) } }, 'Modifica'),
        h('button.btn', { type: 'button', on: { click: () => reportDialog(x, reload) } }, 'Segnala'),
        h('a.btn', { href: `#/mezzi/etichette?ids=${x.id}` }, icon('crosshair', { size: 16 }), 'Etichetta QR'))),
    h('div.fl-vhead',
      h('div.card.fl-vinfo',
        h('div.fl-vstate', statePill(x.state), h('span', now)),
        x.photo_media_id ? h('img.fl-photo.big', { src: mediaUrl(x.photo_media_id), alt: '' }) : null,
        h('div.fl-kvs',
          info('Km', x.km !== null ? `${num(x.km)}${x.km_at ? ` (al ${day(x.km_at)})` : ''}` : null), info('Anno', x.year), info('Alimentazione', x.fuel), info('Posti', x.seats),
          info('Possesso', `${OWNERSHIP[x.ownership]}${x.lessor ? ` · ${x.lessor}` : ''}${x.contract_end ? ` · fino al ${day(x.contract_end)}` : ''}`),
          info('Sede', x.location), info('Telaio', x.vin), info('Carta carburante', x.fuel_card), info('Telepass', x.telepass),
          info('Note', x.notes ? h('span.pre', x.notes) : null))),
      h('div.fl-vside',
        h('div.sw-kpis.sm',
          h('div.sw-kpi', h('span.lab', 'Spese quest\'anno'), h('strong.big', eur(t.year))),
          h('div.sw-kpi', h('span.lab', 'Km percorsi in prenotazione'), h('strong.big', num(t.km_driven))),
          h('div.sw-kpi', h('span.lab', 'Utilizzi'), h('strong.big', num(t.uses))),
          h('div.sw-kpi', h('span.lab', 'Manutenzioni (totale)'), h('strong.big', eur(t.maintenance)))),
        h('div.card.fl-qrbox', h('img', { src: `/api/mezzi/${x.id}/qr.svg`, alt: `QR code di ${vName(x)}` }),
          h('div', h('strong', 'QR code del mezzo'), h('p.small.muted', 'Chi lo inquadra ritira, riconsegna o segnala un problema.'),
            h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => {
              if (!await confirmDialog('Generare un nuovo QR? L\'etichetta attuale smette di funzionare: va ristampata.', { ok: 'Nuovo QR' })) return;
              await post(`/api/mezzi/elenco/${x.id}/nuovo-qr`);
              reload();
            } } }, 'Nuovo QR'))))),
    seg, body);
  if (tab === 'manutenzioni') maintenanceSection(body, x, d.maintenance, reload);
  else if (tab === 'costi') costsSection(body, x, d.costs, reload);
  else if (tab === 'storico') usageSection(body, d.bookings);
  else if (tab === 'segnalazioni') reportsSection(body, d.tickets);
  else deadlinesSection(body, x, d.deadlines, reload);
}

function deadlinesSection(box, x, list, reload) {
  const open = list.filter(z => !z.done_at), done = list.filter(z => z.done_at);
  fill(box,
    h('div.toolbar', h('span.grow'), h('button.btn.btn-primary', { type: 'button', on: { click: () => deadlineForm(x, null, reload) } }, icon('plus', { size: 16 }), 'Nuova scadenza')),
    open.length ? deadlineList(open.map(z => ({ ...z, ...x, id: z.id, vehicle_id: x.id, vehicle_km: x.km })), reload, { inVehicle: true }) : h('div.card.empty', 'Nessuna scadenza: aggiungi assicurazione, bollo, revisione e tagliando per ricevere i promemoria.'),
    done.length ? h('details.fl-done', h('summary', `Fatte (${done.length})`), h('div.card.fl-list', done.map(z => h('div.fl-row',
      h('div.grow', h('strong', z.label || DEADLINE[z.kind]), h('div.small.muted', `${z.due_date ? day(z.due_date) : ''}${z.due_km ? ` · ${num(z.due_km)} km` : ''} · fatta il ${day(z.done_at)}${z.done_by_name ? ` da ${z.done_by_name}` : ''}`)))))) : null);
}

function deadlineList(list, reload, { inVehicle = false } = {}) {
  return h('div.card.fl-list', list.map(z => {
    const n = z.due_date ? daysLeft(z.due_date) : null;
    const kmLeft = z.due_km && z.vehicle_km !== null && z.vehicle_km !== undefined ? z.due_km - z.vehicle_km : null;
    const late = (n !== null && n < 0) || (kmLeft !== null && kmLeft <= 0);
    return h('div.fl-row', { class: late ? 'late' : '' },
      h('div.grow',
        h('div', h('strong', z.label || DEADLINE[z.kind]), inVehicle ? null : h('a.muted', { href: `#/mezzi/v/${z.vehicle_id}` }, ` · ${vName(z)}`)),
        h('div.small', { class: late ? 'fl-late' : n !== null && n <= 30 ? 'fl-soon' : 'muted' },
          [z.due_date ? `${day(z.due_date)} · ${n < 0 ? `scaduta da ${-n} gg` : n === 0 ? 'oggi' : `tra ${n} gg`}` : null,
            z.due_km ? `${num(z.due_km)} km${kmLeft !== null ? ` · ${kmLeft <= 0 ? `superati di ${num(-kmLeft)}` : `mancano ${num(kmLeft)}`}` : ''}` : null,
            z.repeat_months ? `ogni ${z.repeat_months} mesi` : null].filter(Boolean).join(' · '))),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => doneDialog(z, reload) } }, icon('check', { size: 15 }), 'Fatta'),
      inVehicle ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => deadlineForm(z, z, reload) } }, 'Modifica') : null);
  }));
}

function deadlineForm(x, z, reload) {
  const kind = select(Object.entries(DEADLINE), z?.kind || 'assicurazione');
  const label = input({ value: z?.label || '', maxLength: 120, placeholder: 'Facoltativa, es. «Polizza Allianz»' });
  const due = input({ type: 'date', value: z?.due_date ? String(z.due_date).slice(0, 10) : '' });
  const dueKm = input({ type: 'number', min: 0, value: z?.due_km ?? '', placeholder: 'Es. 60000' });
  const remind = input({ value: (z?.remind_days || [30, 7, 1]).join(', '), placeholder: '30, 7, 1' });
  const repeat = input({ type: 'number', min: 1, max: 120, value: z?.repeat_months ?? '', placeholder: 'Es. 12' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Salva');
  const m = modal({
    title: z ? 'Modifica scadenza' : `Nuova scadenza · ${vName(x)}`,
    body: [h('div.grid-2', field('Tipo', kind), field('Descrizione', label)),
      h('div.grid-2', field('Scade il', due), field('Oppure a km', dueKm, 'Per il tagliando: avviso 1000 km prima')),
      h('div.grid-2', field('Promemoria (giorni prima)', remind, 'Ai gestori del parco, e a chi ha il mezzo in assegnazione'), field('Si ripete ogni (mesi)', repeat, 'Quando la segni fatta propone la successiva'))],
    left: z ? [h('button.btn.btn-danger.btn-sm', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Eliminare la scadenza?', { ok: 'Elimina', danger: true })) return;
      await del(`/api/mezzi/scadenze/${z.id}`);
      m.close();
      reload();
    } } }, 'Elimina')] : [],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    const body = { kind: kind.value, label: label.value, due_date: due.value || null, due_km: dueKm.value === '' ? null : Number(dueKm.value),
      remind_days: remind.value.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 0),
      repeat_months: repeat.value === '' ? null : Number(repeat.value) };
    if (!body.due_date && body.due_km === null) return toast('Indica la data o i km', 'err');
    try {
      if (z) await patch(`/api/mezzi/scadenze/${z.id}`, body);
      else await post(`/api/mezzi/elenco/${x.id}/scadenze`, body);
      m.close();
      reload();
    } catch { /* il messaggio lo mostra api */ }
  });
}

function doneDialog(z, reload) {
  // la prossima: stessa data + i mesi di ripetizione (o un anno per bollo e assicurazione)
  let next = '';
  const months = z.repeat_months || (['bollo', 'assicurazione'].includes(z.kind) ? 12 : null);
  if (z.due_date && months) {
    const d = new Date(`${String(z.due_date).slice(0, 10)}T12:00:00`);
    d.setMonth(d.getMonth() + months);
    next = toLocal(d).slice(0, 10);
  }
  const nextDate = input({ type: 'date', value: next });
  const nextKm = input({ type: 'number', min: 0, value: z.due_km ? '' : '', placeholder: z.due_km ? `Es. ${num(z.due_km + 30000)}` : '' });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Segna fatta');
  const m = modal({
    title: `${z.label || DEADLINE[z.kind]}: fatta`,
    body: [h('p.small.muted', 'Indica la prossima scadenza per continuare a ricevere i promemoria (lascia vuoto se non serve).'),
      h('div.grid-2', field('Prossima scadenza', nextDate), field('Oppure a km', nextKm))],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    await post(`/api/mezzi/scadenze/${z.id}/fatta`, { next_due_date: nextDate.value || null, next_due_km: nextKm.value === '' ? null : Number(nextKm.value) });
    m.close();
    toast('Scadenza chiusa');
    reload();
  });
}

function maintenanceSection(box, x, list, reload) {
  fill(box,
    h('div.toolbar', h('span.grow'), h('button.btn.btn-primary', { type: 'button', on: { click: () => maintenanceForm(x, null, reload) } }, icon('plus', { size: 16 }), 'Nuova manutenzione')),
    list.length ? h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Tipo', 'Dal', 'Al', 'Officina', 'Km', 'Costo', 'Descrizione'].map(t => h('th', t)))),
      h('tbody', list.map(m => h('tr', { on: { click: () => maintenanceForm(x, m, reload) } },
        h('td', MAINT[m.kind]), h('td', day(m.start_date)), h('td', m.end_date ? day(m.end_date) : h('span.fl-soon', 'in corso')),
        h('td', m.supplier || '—'), h('td.num', num(m.km)), h('td.num', eur(m.cost)), h('td.small', m.description || '')))))) : h('div.card.empty', 'Nessuna manutenzione registrata. Mentre una manutenzione è aperta, il mezzo non si può prenotare.'));
}

function maintenanceForm(x, m0, reload) {
  const kind = select(Object.entries(MAINT), m0?.kind || 'tagliando');
  const start = input({ type: 'date', value: m0 ? String(m0.start_date).slice(0, 10) : toLocal(new Date()).slice(0, 10) });
  const end = input({ type: 'date', value: m0?.end_date ? String(m0.end_date).slice(0, 10) : '' });
  const km = input({ type: 'number', min: 0, value: m0?.km ?? '' });
  const supplier = input({ value: m0?.supplier || '', maxLength: 120, placeholder: 'Officina, gommista, carrozzeria' });
  const cost = input({ value: m0?.cost ?? '', inputmode: 'decimal', placeholder: 'Es. 180,50' });
  const desc = h('textarea.input', { rows: 3, maxLength: 5000 }, m0?.description || '');
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Salva');
  const m = modal({
    title: m0 ? 'Manutenzione' : `Nuova manutenzione · ${vName(x)}`,
    body: [h('div.grid-2', field('Tipo', kind), field('Officina', supplier)),
      h('div.grid-2', field('In officina dal', start), field('Fino al', end, 'Vuoto = ancora in officina: il mezzo non si prenota')),
      h('div.grid-2', field('Km', km), field('Costo €', cost)), field('Lavori fatti', desc)],
    left: m0 ? [h('button.btn.btn-danger.btn-sm', { type: 'button', on: { click: async () => {
      if (!await confirmDialog('Eliminare la manutenzione?', { ok: 'Elimina', danger: true })) return;
      await del(`/api/mezzi/manutenzioni/${m0.id}`);
      m.close();
      reload();
    } } }, 'Elimina')] : [],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    const body = { kind: kind.value, start_date: start.value, end_date: end.value || null, km: km.value === '' ? null : Number(km.value),
      supplier: supplier.value, cost: cost.value, description: desc.value };
    try {
      if (m0) await patch(`/api/mezzi/manutenzioni/${m0.id}`, body);
      else {
        const r = await post(`/api/mezzi/elenco/${x.id}/manutenzioni`, body);
        if (r.clashes?.length) toast(`Attenzione: ${r.clashes.length} prenotazioni approvate cadono in quei giorni (${r.clashes.map(c => c.name).join(', ')}). Cambia il mezzo dalle prenotazioni.`, 'err');
      }
      m.close();
      reload();
    } catch { /* messaggio già mostrato */ }
  });
}

function costsSection(box, x, list, reload) {
  const total = list.reduce((a, c) => a + Number(c.amount), 0);
  fill(box,
    h('div.toolbar', h('span.muted', `Totale: ${eur(total)}`), h('span.grow'),
      h('button.btn', { type: 'button', on: { click: () => whoDialog(x) } }, 'Chi guidava?'),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => costForm(x, reload) } }, icon('plus', { size: 16 }), 'Nuovo costo')),
    list.length ? h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Data', 'Tipo', 'Importo', 'Km', 'Litri', 'Conducente', 'Descrizione', ''].map(t => h('th', t)))),
      h('tbody', list.map(c => h('tr',
        h('td', dt(c.occurred_at)), h('td', COST[c.kind]), h('td.num', eur(c.amount)), h('td.num', num(c.km)), h('td.num', c.liters === null ? '—' : num(c.liters)),
        h('td', c.driver_name || '—'), h('td.small', c.description || ''),
        h('td', h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Elimina', on: { click: async e => {
          e.stopPropagation();
          if (!await confirmDialog('Eliminare il costo?', { ok: 'Elimina', danger: true })) return;
          await del(`/api/mezzi/costi/${c.id}`);
          reload();
        } } }, icon('x', { size: 15 })))))))) : h('div.card.empty', 'Nessun costo: carburante, pedaggi, multe, lavaggi.'));
}

function costForm(x, reload) {
  const kind = select(Object.entries(COST), 'carburante');
  const at = input({ type: 'datetime-local', value: toLocal(new Date()) });
  const amount = input({ inputmode: 'decimal', placeholder: 'Es. 65,30' });
  const km = input({ type: 'number', min: 0 });
  const liters = input({ inputmode: 'decimal' });
  const desc = input({ maxLength: 2000 });
  const driver = h('div.small.muted');
  const lookDriver = debounce(async () => {
    if (kind.value !== 'multa' || !at.value) return clear(driver);
    const w = await get(`/api/mezzi/elenco/${x.id}/chi-guidava?at=${encodeURIComponent(fromLocal(at.value))}`, { quiet: true }).catch(() => null);
    fill(driver, w?.name ? `In quel momento il mezzo era di ${w.name}${w.source === 'assegnazione' ? ' (assegnazione fissa)' : ''}: la multa viene registrata a suo nome.` : 'Nessuno risulta avere il mezzo in quel momento.');
  }, 300);
  kind.addEventListener('change', lookDriver);
  at.addEventListener('change', lookDriver);
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Salva');
  const m = modal({
    title: `Nuovo costo · ${vName(x)}`,
    body: [h('div.grid-2', field('Tipo', kind), field('Data e ora', at, 'Per le multe: l\'ora del verbale')), driver,
      h('div.fl-grid-3', field('Importo €', amount), field('Km', km), field('Litri', liters)), field('Descrizione', desc)],
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok],
  });
  ok.addEventListener('click', async () => {
    try {
      await post(`/api/mezzi/elenco/${x.id}/costi`, { kind: kind.value, occurred_at: fromLocal(at.value), amount: amount.value, km: km.value === '' ? null : Number(km.value), liters: liters.value, description: desc.value });
      m.close();
      reload();
    } catch { /* messaggio già mostrato */ }
  });
}

function whoDialog(x) {
  const at = input({ type: 'datetime-local', value: toLocal(new Date()) });
  const out = h('div.fl-who');
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Cerca');
  modal({ title: `Chi guidava ${vName(x)}?`, body: [field('Giorno e ora (es. della multa)', at), out], actions: [ok] });
  ok.addEventListener('click', async () => {
    const w = await get(`/api/mezzi/elenco/${x.id}/chi-guidava?at=${encodeURIComponent(fromLocal(at.value))}`);
    fill(out, w.user_id ? [avatar(userById(w.user_id) || { name: w.name }, 32), h('strong', w.name), h('span.small.muted', w.source === 'assegnazione' ? ' (assegnazione fissa)' : ' (dallo storico di ritiri e riconsegne)')]
      : h('span.muted', 'Nessuno risulta avere il mezzo in quel momento.'));
  });
}

function usageSection(box, list) {
  const used = list.filter(b => b.status !== 'approvata');
  fill(box, used.length ? h('div.card.table-wrap', h('table.list',
    h('thead', h('tr', ['Chi', 'Ritiro', 'Riconsegna', 'Km', 'Motivo', 'Note'].map(t => h('th', t)))),
    h('tbody', used.map(b => h('tr', { on: { click: () => { location.hash = `#/mezzi/prenotazioni/${b.id}`; } } },
      h('td', h('strong', b.requester_name), b.walk_in ? h('div.small.muted', 'senza prenotazione') : null),
      h('td', dt(b.picked_up_at || b.start_at)), h('td', b.returned_at ? dt(b.returned_at) : h('span.fl-soon', 'in corso')),
      h('td.num', b.return_km !== null && b.pickup_km !== null ? num(b.return_km - b.pickup_km) : '—'),
      h('td', b.purpose), h('td.small', b.return_notes || '')))))) : h('div.card.empty', 'Il mezzo non è ancora stato usato.'));
}

function reportsSection(box, list) {
  fill(box, list.length ? h('div.card.fl-list', list.map(t => h('a.fl-row', { href: `#/tickets/${t.id}` },
    h('div.grow', h('strong', t.title), h('div.small.muted', `${t.created_by_name || '—'} · ${day(t.created_at)}`)),
    h('span.pill', { class: `st-${t.status}` }, h('span.dot'), { todo: 'Da fare', doing: 'In corso', review: 'In revisione', done: 'Fatto' }[t.status])))) : h('div.card.empty', 'Nessuna segnalazione.'));
}

// ── gestori: tutte le scadenze ───────────────────────────────────────────────
async function deadlinesTab(box) {
  const list = await get('/api/mezzi/scadenze');
  fill(box, h('p.small.muted', 'Tutte le scadenze aperte del parco, le più vicine prima. I promemoria arrivano ai gestori nei giorni scelti per ogni scadenza.'),
    list.length ? deadlineList(list, () => deadlinesTab(box)) : h('div.card.empty', 'Nessuna scadenza aperta. Aggiungile dalla scheda di ogni mezzo.'));
}

// ── gestori: storico ─────────────────────────────────────────────────────────
async function historyTab(box) {
  const vehicles = await get('/api/mezzi/elenco?dismessi=1');
  const veh = select([['', 'Tutti i mezzi'], ...vehicles.map(x => [x.id, `${vName(x)} · ${vModel(x)}`])], '');
  let personId = null;
  const person = peoplePicker({ selected: [], label: '+ Persona', onChange: ids => { personId = ids[ids.length - 1] || null; draw(); } });
  const from = input({ type: 'date' }), to = input({ type: 'date' });
  const list = h('div');
  const exportLink = h('a.btn', { href: '/api/mezzi/esporta/storico.csv' }, icon('sheet', { size: 16 }), 'Esporta');
  for (const el of [veh, from, to]) el.addEventListener('change', () => draw());
  fill(box, h('div.toolbar.fl-filters', veh, person.el, field('Dal', from), field('Al', to), h('span.grow'), exportLink,
    h('a.btn', { href: '/api/mezzi/esporta/costi.csv' }, icon('sheet', { size: 16 }), 'Costi')), list);
  async function draw() {
    const q = new URLSearchParams();
    if (veh.value) q.set('vehicle_id', veh.value);
    if (personId) q.set('user_id', personId);
    if (from.value) q.set('from', new Date(`${from.value}T00:00`).toISOString());
    if (to.value) q.set('to', new Date(`${to.value}T23:59`).toISOString());
    exportLink.href = `/api/mezzi/esporta/storico.csv?${q}`;
    fill(list, loading());
    const rows = await get(`/api/mezzi/storico?${q}`);
    fill(list, rows.length ? h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Mezzo', 'Chi', 'Ritiro', 'Riconsegna', 'Km', 'Motivo e destinazione', 'Note'].map(t => h('th', t)))),
      h('tbody', rows.map(b => h('tr', { on: { click: () => { location.hash = `#/mezzi/prenotazioni/${b.id}`; } } },
        h('td', h('strong', b.code), h('div.small.muted', b.plate || vModel(b))), h('td', b.requester_name),
        h('td', dt(b.picked_up_at)), h('td', b.returned_at ? dt(b.returned_at) : h('span.fl-soon', 'in corso')),
        h('td.num', b.return_km !== null && b.pickup_km !== null ? num(b.return_km - b.pickup_km) : '—'),
        h('td', b.purpose, b.destination ? h('div.small.muted', b.destination) : null), h('td.small', b.return_notes || '')))))) : h('div.card.empty', 'Nessun utilizzo con questi filtri.'));
  }
  draw();
}

// ── gestori: impostazioni ────────────────────────────────────────────────────
async function settingsTab(box) {
  const [cats, managers] = await Promise.all([categories(true), get('/api/mezzi/gestori')]);
  const name = input({ placeholder: 'Nuova categoria, es. Furgoni', maxLength: 80 });
  const add = async () => {
    if (!name.value.trim()) return;
    await post('/api/mezzi/categorie', { name: name.value });
    settingsTab(box);
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  const catRow = c => h('div.fl-row', { class: c.archived ? 'muted' : '' },
    h('div.grow', h('strong', c.name), h('div.small.muted', `${c.vehicles} mezzi${c.archived ? ' · archiviata' : ''}${c.description ? ` · ${c.description}` : ''}`)),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => categoryForm(c, () => settingsTab(box)) } }, 'Modifica'),
    h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: async () => { await patch(`/api/mezzi/categorie/${c.id}`, { archived: !c.archived }); settingsTab(box); } } }, c.archived ? 'Ripristina' : 'Archivia'),
    !c.vehicles ? h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Elimina', on: { click: async () => {
      if (!await confirmDialog(`Eliminare la categoria «${c.name}»?`, { ok: 'Elimina', danger: true })) return;
      await del(`/api/mezzi/categorie/${c.id}`);
      settingsTab(box);
    } } }, icon('x', { size: 15 })) : null);
  let mgr = managers.map(m => m.user_id);
  const picker = peoplePicker({ selected: mgr, label: '+ Gestore', onChange: ids => { mgr = ids; } });
  fill(box, h('div.sw-grid',
    h('section.card.sw-card', h('h3', 'Categorie'),
      h('p.small.muted', 'Chi prenota sceglie una categoria; il mezzo preciso lo assegna il gestore.'),
      h('div.fl-list.flat', cats.map(catRow)),
      h('div.row', name, h('button.btn', { type: 'button', on: { click: add } }, icon('plus', { size: 16 }), 'Aggiungi'))),
    h('section.card.sw-card', h('h3', 'Gestori del parco mezzi'),
      h('p.small.muted', 'Approvano le prenotazioni, assegnano i mezzi, ricevono segnalazioni, rientri e scadenze. Senza gestori, le richieste vanno agli amministratori.'),
      store.me.is_admin ? [picker.el, h('div',
        h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => { await api('PUT', '/api/mezzi/gestori', { user_ids: mgr }); toast('Gestori salvati'); settingsTab(box); } } }, 'Salva i gestori'))]
        : h('div.fl-list.flat', managers.length ? managers.map(m => h('div.fl-row', avatar(userById(m.user_id) || m, 28), h('span', m.name))) : h('p.muted', 'Nessuno: li sceglie un amministratore.'))),
    h('section.card.sw-card', h('h3', 'QR code ed etichette'),
      h('p.small.muted', 'Ogni mezzo ha un QR code. Chi lo inquadra col telefono entra in Alma Planet col suo account Microsoft e può ritirare o riconsegnare la sua prenotazione, oppure segnalare un problema (diventa un ticket ai gestori; se il mezzo non è utilizzabile va subito fuori servizio).'),
      h('a.btn', { href: '#/mezzi/etichette' }, icon('crosshair', { size: 16 }), 'Stampa le etichette'))));
}

function categoryForm(c, done) {
  const name = input({ value: c.name, maxLength: 80 });
  const desc = input({ value: c.description || '', maxLength: 300, placeholder: 'Es. 5 posti, patente B' });
  const pos = input({ type: 'number', value: c.position, min: 0 });
  const ok = h('button.btn.btn-primary', { type: 'button' }, 'Salva');
  const m = modal({ title: 'Categoria', body: [field('Nome', name), field('Descrizione', desc), field('Ordine', pos)], actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), ok] });
  ok.addEventListener('click', async () => {
    try {
      await patch(`/api/mezzi/categorie/${c.id}`, { name: name.value, description: desc.value, position: Number(pos.value) || 0 });
      m.close();
      done();
    } catch { /* messaggio già mostrato */ }
  });
}

// ── etichette QR da stampare ─────────────────────────────────────────────────
async function labelsView(container) {
  if (!store.me.fleet_manager) return fill(container, h('div.card.empty', 'Le etichette le stampano i gestori del parco mezzi.'));
  const ids = new URLSearchParams(location.hash.split('?')[1] || '').get('ids');
  const all = (await get('/api/mezzi/elenco')).filter(x => !ids || ids.split(',').includes(String(x.id)));
  fill(container,
    h('div.page-head.fl-noprint', h('div', h('h1', 'Etichette QR'), h('div.sub', 'Stampa su fogli adesivi e attacca ogni etichetta sul mezzo (parabrezza o portachiavi).')),
      h('div.row', h('a.btn', { href: '#/mezzi/elenco' }, 'Torna ai mezzi'), h('button.btn.btn-primary', { type: 'button', on: { click: () => window.print() } }, 'Stampa'))),
    all.length ? h('div.fl-labels', all.map(x => h('div.fl-label-card',
      h('img', { src: `/api/mezzi/${x.id}/qr.svg`, alt: '' }),
      h('div', h('div.fl-label-brand', 'Alma Planet · Mezzi'), h('strong', x.code), x.plate ? h('div', x.plate) : null, h('div.small', vModel(x)),
        h('div.small.muted', 'Inquadra per ritirare, riconsegnare o segnalare un problema'))))) : h('div.card.empty', 'Nessun mezzo.'));
}
