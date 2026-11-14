// Alma CRM: anagrafiche uniche (Lead, Clienti, Fornitori, Partner, Concorrenti) e contatti, per ASA.
// Canvas «CRM Alma Planet – anagrafiche» (12–13/11/2026): un soggetto = una scheda con più ruoli; i contatti stanno in
// più soggetti con la loro qualifica; chi è di un'ASA vede solo le anagrafiche della sua, la direzione tutte.
// Su ogni azienda e contatto email, incontri, note e progetti come negli A3 (crm-tabs.js); quello del contatto
// ricade sull'azienda. Il lead diventa cliente da solo alla prima commessa in BOSS; opportunità in BOSS, qualifiche
// dei fornitori in Vittoria. Ovunque abbia senso i campi sono elenchi da cui scegliere (Dante 13/11).
import { h, fill, modal, confirmDialog, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { timelineCard, emailsTab, meetingsTab, notesTab, projectsTab, openCrmMeeting, bang } from './crm-tabs.js';
import { weekTab, settingsTab, stepsCard, keyAccountPill, keyAccountDialog, stepDialog } from './crm-commerciale.js';
import { gareTab, belowTab, plansTab } from './crm-radar.js';
import { businessView } from './crm-business.js';
import { ic, dots, pill, av, pageTop, title, card, link, listRow, emptyState, seg, tabsBar as cvTabs, moreMenu, cvModal, choiceChips } from './crm-v2.js';

const TABS = [['settimana', 'La mia settimana'], ['lead', 'Lead'], ['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['partner', 'Partner e concorrenti'], ['tutte', 'Tutte le anagrafiche'], ['contatti', 'Contatti'], ['asa', 'ASA e accessi'], ['impostazioni', 'Impostazioni'], ['gare', 'Proposte dal radar'], ['sottosoglia', 'Segnali sotto soglia']];
const ADMIN_TABS = ['asa', 'impostazioni'];
const NO_FILTER_TABS = ['asa', 'impostazioni', 'settimana', 'gare', 'sottosoglia'];
const ROLE_OF_TAB = { lead: 'lead', clienti: 'cliente', fornitori: 'fornitore' };
const TAB_OF_ROLE = { lead: 'lead', cliente: 'clienti', fornitore: 'fornitori', partner: 'partner', concorrente: 'partner' };

let data = null; // meta, ASA, le mie ASA, numeri
// Tutti vedono tutto (13/11); i filtri partono dalle cose di ognuno e restano ricordati su questo computer.
const FILTER_KEY = () => `alma.crmFilters.${store.me.id}`;
const readFilters = () => { try { return JSON.parse(localStorage.getItem(FILTER_KEY())) || {}; } catch { return {}; } };
const saveFilter = (k, val) => { try { localStorage.setItem(FILTER_KEY(), JSON.stringify({ ...readFilters(), [k]: val })); } catch { /* niente */ } };
// ASA scelta: 'mine' = le mie ASA, '' = tutte, oppure una sola
const asaChoice = () => { const f = readFilters(); if ('asa' in f && (f.asa === '' || f.asa === 'mine' || data.asa.some(a => a.key === f.asa))) return f.asa; return data.myAsa.length && !data.admin ? 'mine' : ''; }; // la direzione parte da tutto
const asaQuery = () => { const c = asaChoice(); return c === 'mine' ? data.myAsa.join(',') : c; };
// ASA da proporre su una scheda nuova
const currentAsa = () => { const c = asaChoice(); return c && c !== 'mine' ? c : data.myAsa.length === 1 ? data.myAsa[0] : ''; };
const ownerDefault = () => { const f = readFilters(); return 'owner' in f ? f.owner : data.mine && !data.admin ? String(store.me.id) : ''; };

const day = d => (d ? fmtDate(String(d).slice(0, 10)) : '—');
const eur = n => (n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const personName = p => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
const asaLabel = k => data.asa.find(a => a.key === k)?.label || k;
const stageLabel = k => data.meta.leadStages.find(([s]) => s === k)?.[1] || k;
const field = (label, control, hint) => h('label.field', h('span', label), control, hint ? h('small.muted', hint) : null);
const input = (attrs = {}) => h('input.input', attrs);
const select = (options, value, attrs = {}) => h('select.select', attrs, options.map(([k, label]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, label)));
const textarea = (value, attrs = {}) => h('textarea.input', { rows: 3, ...attrs }, value || '');
const userOptions = () => [['', '—'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])];
const rolePills = roles => h('div.en-types', roles.map(r => h('span.pill.crm-role', { class: `crm-r-${r}` }, data.meta.roles[r] || r)));
const asaPills = asa => h('div.en-types', asa.map(a => h('span.pill.crm-asa', asaLabel(a))));
const late = d => d && String(d).slice(0, 10) < new Date().toISOString().slice(0, 10);
const provinceName = code => data.meta.regions.flatMap(r => r.provinces).find(([k]) => k === code)?.[1] || code;
const regionOf = code => data.meta.regions.find(r => r.provinces.some(([k]) => k === code))?.name || '';
const dlist = pairs => h('dl.en-dl', pairs.filter(Boolean).flatMap(([k, val]) => [h('dt', k), h('dd', val ?? '—')]));
// filtri «owner» e «funzione» delle liste; state.owner / state.fn
function ownerFunctionFilters(state, load) {
  const owner = select([['', 'Tutti gli owner'], [String(store.me.id), 'I miei'], ...store.users.filter(u => u.active !== false && u.id !== store.me.id).map(u => [u.id, u.name])], state.owner,
    { 'aria-label': 'Owner', on: { change: e => { state.owner = e.target.value; saveFilter('owner', state.owner); load(); } } });
  const fn = data.functions.length ? select([['', 'Tutte le funzioni'], ...data.functions.map(f => [f, f])], state.fn,
    { 'aria-label': 'Funzione di riferimento', on: { change: e => { state.fn = e.target.value; load(); } } }) : null;
  return [owner, fn];
}
const ownerLine = s => h('div', s.owner_name || '—', s.function_name ? h('div.t-meta', s.function_name) : null);
const sec = (title, ...body) => h('section.card.crm-pad', h('h3.crm-h3', title), ...body);

function read(form) {
  const out = {};
  for (const el of form.querySelectorAll('[data-k]')) out[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  return out;
}
// pillole a scelta multipla; restituisce { el, values }
function chipSet(options, selected, { onChange, disabled = () => false } = {}) {
  const values = new Set(selected);
  const el = h('div.en-chips', options.map(([k, label]) => {
    const off = disabled(k);
    return h('button.pill.en-chip', {
      type: 'button', class: values.has(k) ? 'on' : '', 'aria-pressed': String(values.has(k)), disabled: off ? true : undefined, title: off || undefined,
      'data-v': k,
      on: { click: e => {
        values.has(k) ? values.delete(k) : values.add(k);
        e.currentTarget.classList.toggle('on', values.has(k));
        e.currentTarget.setAttribute('aria-pressed', String(values.has(k)));
        onChange?.(values, k);
      } },
    }, label);
  }));
  return { el, values };
}
// provincia: elenco raggruppato per regione
function provinceSelect(value, attrs = {}) {
  return h('select.select', attrs, h('option', { value: '' }, '—'), data.meta.regions.map(r => h('optgroup', { label: r.name },
    r.provinces.map(([k, n]) => h('option', { value: k, selected: k === value }, `${n} (${k})`)))));
}
// più province: si aggiungono dall'elenco e compaiono come pillole
function provincePicker(selected) {
  const values = new Set(selected);
  const chips = h('div.en-chips');
  const draw = () => fill(chips, [...values].map(k => h('span.pill.crm-member', provinceName(k),
    h('button.crm-x', { type: 'button', 'aria-label': `Togli ${provinceName(k)}`, on: { click: () => { values.delete(k); draw(); } } }, icon('x', { size: 12 })))));
  const sel = provinceSelect('', { 'aria-label': 'Aggiungi una provincia' });
  sel.firstChild.textContent = 'Aggiungi una provincia…';
  const all = h('select.select', { 'aria-label': 'Aggiungi una regione intera' }, h('option', { value: '' }, 'Aggiungi una regione intera…'), data.meta.regions.map(r => h('option', { value: r.name }, r.name)));
  sel.addEventListener('change', () => { if (sel.value) values.add(sel.value); sel.value = ''; draw(); });
  all.addEventListener('change', () => { data.meta.regions.find(r => r.name === all.value)?.provinces.forEach(([k]) => values.add(k)); all.value = ''; draw(); });
  draw();
  return { el: h('div.crm-picker', h('div.crm-composer-row', sel, all), chips), values };
}
// categorie SOA: righe categoria + classifica + scadenza
function soaEditor(list) {
  const rows = h('div.crm-soa');
  const add = (x = {}) => rows.append(h('div.crm-soa-row',
    select([['', 'Categoria…'], ...data.meta.soaCategories.map(([k, n]) => [k, `${k} · ${n}`])], x.cat, { 'data-s': 'cat', 'aria-label': 'Categoria SOA' }),
    select([['', 'Classifica…'], ...data.meta.soaClasses.map(([k, n]) => [k, `${k} · ${n}`])], x.cls, { 'data-s': 'cls', 'aria-label': 'Classifica' }),
    input({ type: 'date', value: x.expires || '', 'data-s': 'expires', 'aria-label': 'Scadenza dell\'attestazione', title: 'Scadenza dell\'attestazione' }),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: e => e.currentTarget.parentElement.remove() } }, icon('x', { size: 14 }))));
  (list || []).forEach(add);
  return {
    el: h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => add() } }, icon('plus', { size: 14 }), 'Aggiungi una categoria')),
    value: () => [...rows.children].map(r => ({ cat: r.querySelector('[data-s="cat"]').value, cls: r.querySelector('[data-s="cls"]').value, expires: r.querySelector('[data-s="expires"]').value || null }))
      .filter(x => x.cat && x.cls),
  };
}
const soaText = soa => (soa?.length ? soa.map(x => `${x.cat} ${x.cls}`).join(' · ') : '—');

export async function crmView(container, parts = []) {
  data = await get('/api/crm');
  if (parts[1] === 'business') return businessView(container, parts.slice(2), data); // Nuovi business
  if (parts[1] === 'scheda' && Number(parts[2])) return subjectPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'contatti' && Number(parts[2])) return contactPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'incontro' && Number(parts[2])) { // dalla notifica «mancano le note»
    openCrmMeeting(Number(parts[2]));
    parts = ['crm', 'lead'];
  }
  const tab = TABS.some(([k]) => k === parts[1]) && (!ADMIN_TABS.includes(parts[1]) || data.admin) && (parts[1] !== 'gare' || data.gare) ? parts[1] : 'settimana'; // si parte da «La mia settimana» (canvas 14/11)
  // design v2: ogni pagina disegna la sua intestazione (titolo Light + parola chiave Bold) e i suoi filtri a pillola
  const body = h('div.cv', loading());
  fill(container, body);
  const again = () => crmView(container, parts);
  if (tab === 'settimana') await weekTab(body, data);
  else if (tab === 'impostazioni') await settingsTab(body, data, parts[2], { asaTab, importCard });
  else if (tab === 'asa') await settingsTab(body, data, 'asa', { asaTab, importCard }); // ASA e accessi ora stanno nelle Impostazioni (artboard «Imp-asa»)
  else if (tab === 'gare') await gareTab(body, data);
  else if (tab === 'sottosoglia') await belowTab(body, data);
  else if (tab === 'lead') await leadTab(body, parts[2], again);
  else if (tab === 'contatti') await contactsTab(body, again);
  else await subjectsTab(body, tab, again);
}

// ── filtri delle liste, come pillole sopra la tabella (artboard «Elenchi») ─────────────────────
// Restano ricordati su questo computer; quelli attivi si vedono in arancione, con «Mostra tutto».
function filterRow(state, load, { search = 'Cerca per nome, P.IVA o città', owner = true, fn = true, key = false, again, extra = [] } = {}) {
  const asaSel = select([['', 'Tutte le ASA'], ...(data.myAsa.length ? [['mine', data.myAsa.length === 1 ? `La mia ASA (${asaLabel(data.myAsa[0])})` : 'Le mie ASA']] : []), ...data.asa.map(a => [a.key, `ASA: ${a.label}`])], asaChoice(),
    { 'aria-label': 'ASA', class: asaChoice() ? 'on' : '', on: { change: e => { saveFilter('asa', e.target.value); again ? again() : load(); } } });
  const [ownerSel, fnSel] = ownerFunctionFilters(state, () => load());
  if (ownerSel && state.owner) ownerSel.classList.add('on');
  if (fnSel && state.fn) fnSel.classList.add('on');
  ownerSel?.addEventListener('change', () => ownerSel.classList.toggle('on', Boolean(ownerSel.value)));
  fnSel?.addEventListener('change', () => fnSel.classList.toggle('on', Boolean(fnSel.value)));
  const keyBtn = key ? h('button.cv-pill.line.big', { type: 'button', 'aria-pressed': String(Boolean(state.key)), class: state.key ? 'or' : '', on: { click: e => {
    state.key = !state.key;
    e.currentTarget.classList.toggle('or', state.key);
    e.currentTarget.classList.toggle('line', !state.key);
    e.currentTarget.setAttribute('aria-pressed', String(state.key));
    load();
  } } }, ic('star', 13), 'Key account') : null;
  if (keyBtn && state.key) keyBtn.classList.remove('line');
  const anyOn = () => Boolean(asaChoice() || state.owner || state.fn || state.key);
  const reset = link('Mostra tutto', { on: { click: () => { saveFilter('asa', ''); saveFilter('owner', ''); state.owner = ''; state.fn = ''; state.key = false; again ? again() : load(); } } });
  const sync = () => { reset.hidden = !anyOn(); };
  [ownerSel, fnSel, keyBtn].filter(Boolean).forEach(el => el.addEventListener(el === keyBtn ? 'click' : 'change', sync));
  sync();
  return h('div.cv-filters',
    h('input.input', { type: 'search', placeholder: search, 'aria-label': search, value: state.q || '', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
    asaSel, owner ? ownerSel : null, fn ? fnSel : null, keyBtn, reset, ...extra);
}

// ── lead: colonne per fase ──────────────────────────────────────────────────
// Design v2 (artboard «Lead»): barra della pipeline in alto, kanban solo con i lead vivi, gli altri (quasi tutti dal
// caricamento di Zoho, mai lavorati) in «Da riordinare» con assegnazione o chiusura in blocco.
const short = n => (n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString('it-IT')}k €` : `${n} €`);
async function leadTab(box, mode, again) {
  const state = { q: '', mode: ['elenco', 'riordina'].includes(mode) ? mode : 'colonne', owner: ownerDefault(), fn: '', prio: '' };
  const pipe = h('div');
  const content = h('div', loading());
  const go = m => { state.mode = m; history.replaceState(null, '', `#/crm/lead${m === 'colonne' ? '' : `/${m}`}`); load(); };
  const prio = select([['', 'Priorità'], ...Object.entries(data.meta.priorities).map(([k, l]) => [k, `Priorità ${l.toLowerCase()}`])], '', { 'aria-label': 'Priorità',
    on: { change: e => { state.prio = e.target.value; e.target.classList.toggle('on', Boolean(state.prio)); load(); } } });
  const modes = h('div');
  const sub = h('p.cv-sub');
  fill(box,
    pageTop({ eyebrow: 'Alma CRM', heading: title('', 'Lead'), sub,
      actions: [data.admin ? h('a.btn', { href: '#/crm/impostazioni/zoho' }, ic('upload', 15), 'Importa') : null,
        h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: ['lead'] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } }, ic('plus', 15), 'Nuovo lead')] }),
    pipe,
    filterRow(state, () => load(), { again, extra: [prio, modes] }),
    content);
  let all = [];
  async function load() {
    all = (await get(`/api/crm/subjects${qs({ role: 'lead', asa: asaQuery(), q: state.q, owner: state.owner, function: state.fn })}`)).subjects;
    const shown = all.filter(s => !state.prio || s.priority === state.prio);
    const live = shown.filter(s => s.live);
    const dead = shown.filter(s => !s.live);
    sub.textContent = `${shown.length.toLocaleString('it-IT')} lead · ${shown.filter(s => s.next_step).length.toLocaleString('it-IT')} con un prossimo passo`;
    fill(modes, seg([['colonne', 'Colonne'], ['elenco', 'Elenco'], ['riordina', 'Da riordinare', dead.length]], state.mode, go, { label: 'Vista dei lead' }));
    fill(pipe, pipeline(live, dead, () => go('riordina')));
    if (state.mode === 'riordina') return fill(content, reorderView(dead, load));
    if (state.mode === 'elenco') return fill(content, subjectTable(live, 'lead', state.q || state.prio, state, load));
    fill(content, h('div.cv-kan', data.meta.leadStages.map(([stage, label]) => leadColumn(stage, label, live.filter(s => s.lead_stage === stage), live, load))));
  }
  await load();
}

function pipeline(live, dead, onReorder) {
  const stages = data.meta.leadStages.filter(([k]) => k !== 'non_interessato');
  const order = stages.map(([k]) => k);
  const n = k => live.filter(s => s.lead_stage === k).length;
  const value = k => live.filter(s => s.lead_stage === k).reduce((t, s) => t + (Number(s.potential_value) || 0), 0);
  return h('section.cv-card.cv-pipe', { 'aria-label': 'Pipeline dei lead' },
    stages.map(([k, l], i) => {
      const later = order.slice(i + 1).reduce((t, x) => t + n(x), 0);
      const pct = n(k) + later ? Math.round((100 * later) / (n(k) + later)) : 0;
      return h('div', h('div.cv-lbl', l), h('div.cv-row', { style: { gap: '8px', marginTop: '4px' } }, h('span.cv-pipe-n', String(n(k))), value(k) ? h('span.cv-small.cv-muted', short(value(k))) : null),
        h('div.cv-small.cv-muted', i < stages.length - 1 ? (n(k) + later ? `${pct}% passa alla fase dopo` : 'nessun lead') : 'si lavora in BOSS'));
    }),
    h('div', dead.length ? pill(`${dead.length.toLocaleString('it-IT')} da riordinare`, 'am') : pill('Niente da riordinare', 'gr'),
      h('div.cv-small.cv-muted', 'senza passo e fermi da più di 90 giorni (quasi tutti da Zoho)'),
      dead.length ? link(['Riordina', ic('chevron-right', 13)], { on: { click: onReorder } }) : null));
}

const LEAD_COL_MAX = 30;
function leadColumn(stage, label, items, all, reload) {
  const lost = stage === 'non_interessato';
  const list = h('div');
  const drawCards = (limit) => fill(list, items.length ? [items.slice(0, limit).map(leadCard),
    items.length > limit ? h('button.cv-lnk.cv-kc-more', { type: 'button', on: { click: () => drawCards(items.length) } }, `Mostra altri ${items.length - limit}`) : null]
    : h('div.cv-kc-more', 'Nessuno'));
  drawCards(LEAD_COL_MAX);
  const col = h('div.cv-kc', { class: lost ? 'lost' : '', 'aria-label': `${label}: ${items.length}` },
    h('div.cv-kh', h('span', label), pill(String(items.length))),
    lost ? h('div.cv-small.cv-muted', { style: { padding: '0 6px 8px' } }, 'Con il motivo e la data per riprovare.') : stage === 'opportunita' ? h('div.cv-small.cv-muted', { style: { padding: '0 6px 8px' } }, 'La trattativa si lavora in BOSS.') : null,
    list);
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
  col.addEventListener('dragleave', () => col.classList.remove('drop'));
  col.addEventListener('drop', async e => {
    e.preventDefault();
    col.classList.remove('drop');
    const s = all.find(x => x.id === Number(e.dataTransfer.getData('text/crm-lead')));
    if (s && s.lead_stage !== stage && await changeStage(s, stage)) reload();
  });
  return col;
}

function leadCard(s) {
  const lost = s.lead_stage === 'non_interessato';
  const retry = s.retry_date ? fmtDate(String(s.retry_date).slice(0, 10), { year: true }).replace(/^\d+ /, '') : '';
  const el = h('div.cv-kcard', { tabindex: 0, draggable: 'true', role: 'link', 'aria-label': `Apri ${s.name}`, on: {
    click: () => { location.hash = `#/crm/scheda/${s.id}`; },
    keydown: e => { if (e.key === 'Enter') location.hash = `#/crm/scheda/${s.id}`; },
    dragstart: e => { e.dataTransfer.setData('text/crm-lead', String(s.id)); el.classList.add('dragging'); },
    dragend: () => el.classList.remove('dragging'),
  } },
  h('div.cv-row', { style: { gap: '8px' } }, h('span.cv-t5.cv-grow.cv-ell', s.name), s.missing_notes ? bang() : null, s.owner_name ? av(s.owner_name, 'or') : null),
  (lost || s.lead_why || s.city) ? h('div.cv-small.cv-muted.cv-ell', lost ? dots([`Motivo: ${s.lost_reason || '—'}`, retry && `riprovare a ${retry}`]) : (s.lead_why || s.city)) : null,
  h('div.cv-row.cv-small', { style: { gap: '8px' } },
    s.potential_value ? h('span.cv-t5', { style: { whiteSpace: 'nowrap' } }, short(Number(s.potential_value))) : null,
    s.priority === 'alta' ? pill('alta', 'or') : null,
    h('span.cv-grow'),
    lost ? (retry ? pill(retry) : null)
      : s.next_step_date ? h('span.cv-date', { class: late(s.next_step_date) ? 'late' : '', title: s.next_step }, ic('alarm-clock', 12), fmtDate(String(s.next_step_date).slice(0, 10)))
        : pill('senza passo', 'am')));
  return el;
}

// «Da riordinare»: elenco con selezione multipla → assegna owner o chiudi come «Non interessato» con il motivo
function reorderView(list, reload) {
  if (!list.length) return h('section.cv-card', emptyState('check', 'Niente da riordinare: ogni lead ha un passo o è stato lavorato negli ultimi 90 giorni.'));
  const picked = new Set();
  const canPick = s => data.admin || s.owner_id === store.me.id;
  const count = h('span.cv-grow.cv-small');
  const owner = select([['', 'Assegna a…'], ...store.users.filter(u => u.active !== false).map(u => [u.id, u.name])], '', { 'aria-label': 'Nuovo owner' });
  const assignBtn = h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
    if (!owner.value) return toast('Scegli a chi assegnarli', 'err');
    const r = await post('/api/crm/subjects/bulk', { action: 'assign', ids: [...picked], owner_id: Number(owner.value) });
    toast(`${r.updated} lead assegnati a ${store.users.find(u => String(u.id) === owner.value)?.name || ''}`);
    reload();
  } } }, ic('user-plus', 14), 'Assegna');
  const closeBtn = h('button.btn.btn-sm', { type: 'button', on: { click: () => closeLeadsDialog([...picked], reload) } }, ic('x', 14), 'Chiudi come non interessati');
  const bar = h('div.cv-bulkbar', { hidden: true }, count, owner, assignBtn, closeBtn);
  const sync = () => {
    bar.hidden = !picked.size;
    count.textContent = `${picked.size} selezionati`;
    all.checked = picked.size && picked.size === list.filter(canPick).length;
  };
  const all = h('input', { type: 'checkbox', 'aria-label': 'Seleziona tutti', on: { change: e => {
    list.filter(canPick).forEach(s => (e.target.checked ? picked.add(s.id) : picked.delete(s.id)));
    tbody.querySelectorAll('input[type=checkbox]').forEach(cb => { if (!cb.disabled) cb.checked = e.target.checked; });
    sync();
  } } });
  const tbody = h('tbody', list.map(s => h('tr',
    h('td', h('input', { type: 'checkbox', 'aria-label': `Seleziona ${s.name}`, disabled: !canPick(s) || undefined, title: canPick(s) ? undefined : 'Solo l\'owner o la direzione',
      on: { change: e => { e.target.checked ? picked.add(s.id) : picked.delete(s.id); sync(); } } })),
    h('td', h('a.cv-name', { href: `#/crm/scheda/${s.id}` }, h('span.cv-ib', s.name.slice(0, 2).toUpperCase()), h('div', h('div.cv-t5.cv-ell', { style: { maxWidth: '360px' } }, s.name), h('div.cv-small.cv-muted', dots([data.meta.kinds[s.kind], s.city]) || '—')))),
    h('td.cv-hide-m', asaCell(s.asa)),
    h('td.cv-hide-m', ownerCell(s)),
    h('td.cv-hide-m.cv-small.cv-muted', s.updated_at ? `fermo dal ${day(s.updated_at)}` : '—'))));
  return h('div.cv-stack',
    h('section.cv-card', h('div.cv-ch', h('h3.cv-t', h('span', 'Da riordinare'), h('span.cv-c', String(list.length))),
      h('span.cv-small.cv-muted', 'Senza un passo e fermi da più di 90 giorni: assegnali ai responsabili di BU o chiudili.')),
    h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', h('th', { style: { width: '44px' } }, all), h('th', 'Lead'), h('th.cv-hide-m', 'ASA'), h('th.cv-hide-m', 'Owner'), h('th.cv-hide-m', 'Ultimo movimento'))), tbody))),
    bar);
}
function closeLeadsDialog(ids, reload) {
  const reasons = choiceChips(data.meta.lostReasons.map(r => [r, r]), '', { label: 'Motivo' });
  const note = input({ placeholder: 'Facoltativa: «non lavorano più nella nostra zona»', maxlength: 500 });
  const retry = input({ type: 'date', 'aria-label': 'Riprovare il' });
  const m = cvModal({
    size: 'md', title: h('div', h('h2', `Chiudi ${ids.length} lead`), h('div.cv-subh', 'Diventano «Non interessato», con il motivo nello storico.')),
    body: h('div.en-form', h('div.cv-fld', h('span', 'Perché?'), reasons.el), h('label.cv-fld', h('span', 'Nota (facoltativa)'), note),
      h('label.cv-fld', h('span', 'Riprovare il (facoltativo)'), retry)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!reasons.value) return toast('Scegli il motivo', 'err');
        const r = await post('/api/crm/subjects/bulk', { action: 'close', ids, reason: reasons.value, note: note.value, retry_date: retry.value || null });
        m.close();
        toast(`${r.updated} lead chiusi come non interessati`);
        reload();
      } } }, 'Chiudi i lead')],
  });
}
const asaCell = asa => h('div.cv-row', { style: { gap: '4px' } }, asa.slice(0, 2).map(a => pill(asaLabel(a), 'line')), asa.length > 2 ? pill(`+${asa.length - 2}`, '', { title: asa.slice(2).map(asaLabel).join(', ') }) : null);
const ownerCell = s => (s.owner_name ? h('div.cv-row', { style: { gap: '8px' } }, av(s.owner_name, 'bl'), h('div', { style: { minWidth: 0 } }, h('div.cv-small.cv-t5.cv-ell', s.owner_name), s.function_name ? h('div.cv-small.cv-muted.cv-ell', s.function_name) : null)) : h('span.cv-small.cv-muted', '—'));

// Cambio di fase; «Non interessato» chiede motivo e quando riprovare. Restituisce true se cambiata.
async function changeStage(s, stage) {
  if (stage !== 'non_interessato') {
    await post(`/api/crm/subjects/${s.id}/stage`, { stage });
    toast(`${s.name}: ${stageLabel(stage)}`);
    return true;
  }
  return new Promise(resolve => {
    const reason = select([['', 'Scegli…'], ...data.meta.lostReasons.map(r => [r, r])], '');
    const retry = input({ type: 'date' });
    const note = input({ placeholder: 'Dettagli (facoltativo)' });
    let done = false;
    const m = cvModal({
      title: `${s.name}: non interessato`,
      body: h('div.en-form', field('Motivo', reason), field('Riprovare il', retry, 'Facoltativo: il lead tornerà in evidenza quel giorno.'), field('Nota', note)),
      onClose: () => { if (!done) resolve(false); },
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!reason.value) return toast('Scegli il motivo', 'err');
        await post(`/api/crm/subjects/${s.id}/stage`, { stage, lost_reason: reason.value, retry_date: retry.value || null, note: note.value });
        done = true;
        m.close();
        resolve(true);
      } } }, 'Salva')],
    });
  });
}

// ── elenchi di anagrafiche ──────────────────────────────────────────────────
// Design v2 (artboard «Elenchi»): un selettore in alto fra Clienti, Lead, Fornitori, Partner, Concorrenti, Tutte;
// filtri a pillola; tabella con 6 colonne che sta nello schermo, nomi lunghi con «…», ASA al massimo 2 + «+N».
const LIST_TITLE = { clienti: 'Clienti', fornitori: 'Fornitori', partner: 'Partner', concorrenti: 'Concorrenti', tutte: 'Tutte le anagrafiche' };
const PAGE = 50;
async function subjectsTab(box, tab, again) {
  const role = ROLE_OF_TAB[tab] || '';
  const sub = location.hash.split('/')[3] === 'concorrenti' && tab === 'partner' ? 'concorrenti' : tab; // «Partner e concorrenti»: due viste
  const state = { q: '', owner: ownerDefault(), fn: '', key: false, cat: '', role: '', page: 0 };
  const list = h('div', loading());
  const lead = h('p.cv-sub');
  const newRole = sub === 'concorrenti' ? 'concorrente' : sub === 'partner' ? 'partner' : role;
  const c = data.counts;
  const switcher = seg([['clienti', 'Clienti', c.cliente || 0], ['lead', 'Lead', c.lead || 0], ['fornitori', 'Fornitori', c.fornitore || 0], ['partner', 'Partner', c.partner || 0],
    ['concorrenti', 'Concorrenti', c.concorrente || 0], ['tutte', 'Tutte']], sub, k => { location.hash = k === 'concorrenti' ? '#/crm/partner/concorrenti' : `#/crm/${k}`; }, { label: 'Anagrafiche' });
  const extra = tab === 'fornitori' ? [select([['', 'Categoria'], ...Object.entries(data.meta.supplierCategories)], '', { 'aria-label': 'Categoria', on: { change: e => { state.cat = e.target.value; e.target.classList.toggle('on', Boolean(state.cat)); load(); } } })]
    : tab === 'tutte' ? [select([['', 'Ruolo'], ...Object.entries(data.meta.roles)], '', { 'aria-label': 'Ruolo', on: { change: e => { state.role = e.target.value; e.target.classList.toggle('on', Boolean(state.role)); load(); } } })] : [];
  let rows = [];
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · anagrafiche', heading: title('', LIST_TITLE[sub]), sub: lead,
      actions: [h('button.btn', { type: 'button', on: { click: () => exportCsv(rows, LIST_TITLE[sub]) } }, ic('download', 15), 'Esporta'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: newRole ? [newRole] : [] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } },
          ic('plus', 15), sub === 'clienti' ? 'Nuovo cliente' : sub === 'fornitori' ? 'Nuovo fornitore' : sub === 'partner' ? 'Nuovo partner' : sub === 'concorrenti' ? 'Nuovo concorrente' : 'Nuova anagrafica')] }),
    h('div.cv-row', switcher),
    filterRow(state, () => { state.page = 0; load(); }, { key: true, again, extra }),
    list);
  async function load() {
    const query = { asa: asaQuery(), q: state.q, role: sub === 'concorrenti' ? 'concorrente' : sub === 'partner' ? 'partner' : role || state.role, owner: state.owner, function: state.fn };
    if (tab === 'fornitori') query.category = state.cat;
    const { subjects } = await get(`/api/crm/subjects${qs(query)}`);
    rows = subjects.filter(s => !state.key || s.key_account);
    const noun = { clienti: 'clienti', fornitori: 'fornitori', partner: 'partner', concorrenti: 'concorrenti', tutte: 'anagrafiche' }[sub];
    lead.textContent = `${rows.length.toLocaleString('it-IT')} ${noun} · ${rows.filter(s => s.next_step).length.toLocaleString('it-IT')} con un prossimo passo${sub === 'clienti' ? ' · un lead diventa cliente da solo alla prima commessa in BOSS' : ''}`;
    fill(list, subjectTable(rows, sub, state.q || state.key || state.cat || state.role, state, load));
  }
  await load();
}

// tabella delle anagrafiche: Azienda · ASA · Owner e funzione · (Contatti | Categorie | Ruoli | Fase) · Prossimo passo · «…»
function subjectTable(subjects, tab, filtered, state = { page: 0 }, reload = () => {}) {
  if (!subjects.length) {
    return h('section.cv-card', emptyState('building', filtered || asaChoice() || ownerDefault() ? 'Nessuna anagrafica con questi filtri.' : 'Ancora nessuna anagrafica qui.',
      filtered || asaChoice() || ownerDefault() ? link('Mostra tutto', { on: { click: () => { saveFilter('asa', ''); saveFilter('owner', ''); location.reload(); } } }) : null));
  }
  const col4 = tab === 'lead' ? ['Fase', s => h('div', h('div.cv-small.cv-t5', stageLabel(s.lead_stage)), s.potential_value ? h('div.cv-small.cv-muted', short(Number(s.potential_value))) : null)]
    : tab === 'fornitori' ? ['Categorie', s => h('div.cv-small.cv-ell', { style: { maxWidth: '200px' } }, s.supplier_categories.map(x => data.meta.supplierCategories[x]).join(', ') || '—')]
      : tab === 'tutte' ? ['Ruoli', s => h('div.cv-row', { style: { gap: '4px' } }, s.roles.slice(0, 2).map(r => pill(data.meta.roles[r], r === 'cliente' ? 'gr' : r === 'lead' ? 'or' : '')))]
        : ['Contatti', s => String(s.contacts), 'num'];
  const page = state.page || 0;
  const shown = subjects.slice(page * PAGE, page * PAGE + PAGE);
  const open = s => { location.hash = `#/crm/scheda/${s.id}`; };
  const pages = Math.ceil(subjects.length / PAGE);
  return h('section.cv-card',
    h('div.cv-tblwrap', h('table.cv-tbl',
      h('thead', h('tr', h('th', 'Azienda'), h('th.cv-hide-m', 'ASA'), h('th.cv-hide-m', 'Owner · funzione'), h(`th${col4[2] ? '.num' : ''}.cv-hide-m`, col4[0]), h('th', 'Prossimo passo'), h('th', h('span.cv-sr', 'Azioni')))),
      h('tbody', shown.map(s => h('tr.cv-click', { on: { click: e => { if (!e.target.closest('.cv-more, a, button')) open(s); } } },
        h('td', h('a.cv-name', { href: `#/crm/scheda/${s.id}` }, h('span.cv-ib', (s.short_name || s.name).slice(0, 2).toUpperCase()),
          h('div', h('div.cv-t5.cv-row', { style: { gap: '6px' } }, h('span.cv-ell', { style: { maxWidth: '300px' } }, s.name), s.key_account ? h('span', { title: 'Key account', style: { color: 'var(--cv-orange-d)', display: 'inline-flex' } }, ic('star', 13)) : null, s.missing_notes ? bang() : null),
            h('div.cv-small.cv-muted.cv-ell', { style: { maxWidth: '300px' } }, dots([data.meta.kinds[s.kind], s.city, s.status !== 'attivo' && data.meta.status[s.status]]) || '—')))),
        h('td.cv-hide-m', asaCell(s.asa)),
        h('td.cv-hide-m', ownerCell(s)),
        h(`td${col4[2] ? '.num' : ''}.cv-hide-m`, col4[1](s)),
        h('td', s.next_step ? h('div', { style: { minWidth: 0 } }, h('div.cv-small.cv-t5.cv-ell', { style: { maxWidth: '220px' } }, s.next_step), h('div.cv-date', { class: late(s.next_step_date) ? 'late' : '' }, late(s.next_step_date) ? day(s.next_step_date) : `entro ${day(s.next_step_date)}`)) : h('span.cv-small.cv-muted', '—')),
        h('td', moreMenu([['Apri la scheda', () => open(s)], ['Nuovo passo', async () => {
          const full = await get(`/api/crm/subjects/${s.id}`);
          stepDialog({ subjectId: s.id, subjectName: s.name, contacts: full.contacts.filter(x => !x.date_to), defaultOwner: s.owner_id, onSaved: reload });
        }]], { label: `Azioni per ${s.name}`, ghost: true }))))))),
    h('div.cv-tfoot', `Righe ${page * PAGE + 1}–${page * PAGE + shown.length} di ${subjects.length.toLocaleString('it-IT')}`, h('span.cv-grow'),
      pages > 1 ? [h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina prima', disabled: page === 0 || undefined, on: { click: () => { state.page = page - 1; reload(); } } }, ic('chevron-left', 15)),
        h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina dopo', disabled: page >= pages - 1 || undefined, on: { click: () => { state.page = page + 1; reload(); } } }, ic('chevron-right', 15))] : null));
}
// «Esporta»: le righe che si vedono, in un CSV per Excel
function exportCsv(rows, name) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Azienda', 'Tipo', 'P.IVA', 'Comune', 'Provincia', 'Ruoli', 'ASA', 'Owner', 'Funzione', 'Contatti', 'Prossimo passo', 'Entro'].map(cell).join(';'),
    ...rows.map(s => [s.name, data.meta.kinds[s.kind], s.vat, s.city, s.province, s.roles.map(r => data.meta.roles[r]).join(', '), s.asa.map(asaLabel).join(', '), s.owner_name, s.function_name, s.contacts, s.next_step, s.next_step_date ? String(s.next_step_date).slice(0, 10) : ''].map(cell).join(';'))];
  const a = h('a', { href: URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })), download: `${name} ${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
}

// ── conteggi dei tab, uguali per azienda e contatto ─────────────────────────
async function counts(base, { plans = false } = {}) {
  const [e, m, n, p, pl] = await Promise.all([get(`${base}/emails`), get(`${base}/meetings`), get(`${base}/notes`), get(`${base}/projects`),
    plans ? get(`${base}/plans`) : Promise.resolve({ plans: [] })].map(x => x.catch(() => [])));
  return { email: e.length, incontri: m.length, missing: m.filter(x => x.missing_notes).length, note: n.length, progetti: p.length, piani: pl?.plans?.length || 0 };
}
// persone attive dell'azienda, una volta sola anche se collegate due volte (design v2: «contatti doppi uniti»)
const activePeople = s => [...new Map(s.contacts.filter(x => !x.date_to).map(x => [x.id, x])).values()];
const rolePill = s => {
  const r = s.roles;
  if (r.includes('cliente')) return pill(s.client_since ? `Cliente dal ${String(s.client_since).slice(0, 4)}` : 'Cliente', 'gr');
  if (r.includes('lead')) return pill(`Lead · ${stageLabel(s.lead_stage)}`, s.lead_stage === 'non_interessato' ? 'rd' : 'or');
  return pill(r.map(x => data.meta.roles[x]).join(' · '));
};

// ── scheda dell'azienda (design v2, artboard «Scheda» e «Scheda-tab») ───────
// Intestazione su due righe (nome + pillole, poi owner · P.IVA · sede); davanti Chiama · Email · Nuovo passo, il resto
// nel menu «…»; il prossimo passo è una riga; tab con i contatori e «Altro ▾»; Panoramica in due colonne.
async function subjectPage(container, id, tabKey) {
  const s = await get(`/api/crm/subjects/${id}`);
  if (s.merged_into) return fill(container, h('div.cv', h('section.cv-card', emptyState('link', ['Questa scheda è stata unita a ', h('a', { href: `#/crm/scheda/${s.merged_into}` }, s.merged_name), '.']))));
  const base = `/api/crm/subjects/${id}`;
  const c = await counts(base, { plans: true });
  const back = TAB_OF_ROLE[s.roles[0]] || 'tutte';
  const people = activePeople(s);
  const tabs = [['panoramica', 'Panoramica'], ['piani', 'Piano d’azione', c.piani], ['contatti', 'Contatti', people.length], ['email', 'Email', c.email], ['incontri', 'Incontri', c.incontri, c.missing],
    ['note', 'Note', c.note], ['progetti', 'Progetti', c.progetti],
    ...(s.roles.includes('cliente') ? [['opportunita', 'Opportunità e gare'], ['commesse', 'Commesse']] : s.roles.includes('lead') ? [['opportunita', 'Opportunità']] : []),
    ...(s.roles.includes('fornitore') ? [['qualifica', 'Qualifica e documenti'], ['ordini', 'Ordini e subappalti']] : []),
    ...(s.roles.includes('partner') || s.roles.includes('concorrente') ? [['gare', 'Gare insieme e contro']] : [])];
  const tab = tabs.some(([k]) => k === tabKey) ? tabKey : 'panoramica';
  const refresh = (k = tab) => subjectPage(container, id, k);
  const go = k => { history.replaceState(null, '', `#/crm/scheda/${id}/${k}`); refresh(k); };
  const body = h('div.cv-stack');
  const primary = people.find(x => x.is_primary) || people[0];
  const phone = s.phone || primary?.mobile || primary?.phone;
  const mail = s.email || primary?.email;
  const newStep = () => stepDialog({ subjectId: s.id, subjectName: s.name, contacts: people, defaultOwner: s.owner_id, onSaved: () => refresh() });
  const menu = moreMenu([
    ['Collega a…', () => linkDialog(s, () => refresh())],
    ['Trasforma in…', () => transformDialog(s, () => refresh())],
    ['Modifica i dati', () => subjectForm({ subject: s, onSaved: () => refresh() })],
    ['Key account', () => keyAccountDialog(s, () => refresh(), data.keyRhythm || 90)],
    data.admin ? ['Unisci a un\'altra scheda', () => mergeForm(s)] : null,
    data.admin ? ['Cancella', async () => {
      if (!await confirmDialog(`Cancellare «${s.name}» dal CRM? I contatti restano, i loro collegamenti a questa scheda si tolgono.`, { ok: 'Cancella', danger: true })) return;
      await del(base);
      location.hash = `#/crm/${back}`;
    }, true] : null]);
  const place = [s.city, s.province && `(${s.province})`].filter(Boolean).join(' ');
  fill(container, h('div.cv',
    h('a.cv-crumb', { href: `#/crm/${back}` }, ic('chevron-left', 14), TABS.find(([k]) => k === back)[1]),
    h('section.cv-card.pad.cv-head.visible',
      h('div.cv-head-main',
        h('span.cv-mono', { 'aria-hidden': 'true' }, initialsOf(s.short_name || s.name)),
        h('div.cv-grow',
          h('div.cv-row.cv-wrap', { style: { gap: '8px 10px' } }, h('h1.cv-head-name', s.name), rolePill(s), s.asa.slice(0, 3).map(a => pill(asaLabel(a), 'line')),
            s.asa.length > 3 ? pill(`+${s.asa.length - 3}`, '', { title: s.asa.slice(3).map(asaLabel).join(', ') }) : null,
            keyAccountPill(s, () => refresh(), data.keyRhythm || 90), s.status !== 'attivo' ? pill(data.meta.status[s.status], 'rd') : null),
          h('div.cv-head-meta',
            h('span', s.owner_name ? av(s.owner_name, 'bl') : null, `Owner ${s.owner_name || '—'}${s.function_name ? ` · ${s.function_name}` : ''}`),
            s.vat ? h('span', `P.IVA ${s.vat}`) : null, place ? h('span', ic('map-pin', 13), place) : null,
            data.meta.kinds[s.kind] ? h('span', data.meta.kinds[s.kind]) : null)),
        h('div.cv-head-acts',
          phone ? h('a.btn', { href: `tel:${phone}` }, ic('phone', 15), 'Chiama') : h('button.btn', { type: 'button', disabled: true, title: 'Nessun telefono: aggiungilo nei dati o ai contatti' }, ic('phone', 15), 'Chiama'),
          mail ? h('a.btn', { href: `mailto:${mail}` }, ic('mail', 15), 'Email') : h('button.btn', { type: 'button', disabled: true, title: 'Nessuna email' }, ic('mail', 15), 'Email'),
          h('button.btn.btn-primary', { type: 'button', on: { click: newStep } }, ic('plus', 15), 'Nuovo passo'),
          menu)),
      s.roles.includes('lead') ? [h('div.cv-hr'), stageBar(s, () => refresh())] : null,
      h('div.cv-hr'),
      stepsCard(s, () => refresh(), { onNew: newStep })),
    cvTabs(tabs, tab, go),
    body));
  const canWrite = true;
  const invite = people.map(x => ({ name: personName(x), email: x.email, preset: x.is_primary }));
  if (tab === 'panoramica') await overviewTab(body, s, base, go, people, () => refresh());
  else if (tab === 'contatti') subjectContacts(body, s, () => refresh());
  else if (tab === 'email') emailsTab(body, base, { canWrite });
  else if (tab === 'incontri') meetingsTab(body, base, { canWrite, people: invite, label: 'quest\'azienda' });
  else if (tab === 'note') notesTab(body, base, { isSubject: true });
  else if (tab === 'progetti') projectsTab(body, base, { canWrite, newName: s.short_name || s.name });
  else if (tab === 'piani') await plansTab(body, s, () => refresh());
  else fill(body, placeholderTab(tab, s));
}
const initialsOf = name => String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(w => w.length > 1 || /\p{Lu}/u.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function placeholderTab(tab, s) {
  const text = {
    opportunita: ['Opportunità e offerte', 'Si lavorano in BOSS. Con il collegamento qui compariranno quelle di quest\'azienda (committente, partner o aggiudicatario), con un clic per aprirle e «Nuova opportunità» già compilata.'],
    commesse: ['Commesse', 'Arriveranno da BOSS: commesse aperte e chiuse di questo cliente, con valore e avanzamento.'],
    qualifica: ['Qualifica e documenti (da Vittoria)', 'Qualifica, DURC, SOA, white list, patente a crediti e gli altri documenti a scadenza si gestiscono in Vittoria. Con il collegamento (secondo passo) qui si vedranno lo stato e cosa scade.'],
    ordini: ['Ordini e subappalti', 'Arriveranno da BOSS, con il voto a fine lavoro.'],
    gare: ['Gare insieme e contro', 'Dalle opportunità di BOSS: le gare fatte in ATI con quest\'impresa e quelle che ci ha vinto.'],
  }[tab];
  return card({ title: text[0], right: pill('in arrivo con l\'integrazione', 'bl') }, emptyState('link', text[1]));
}

function stageBar(s, refresh) {
  return h('div.cv-row.cv-wrap', { style: { gap: '10px' } },
    h('span.cv-lbl', 'Fase del lead'),
    h('div.cv-stages', { role: 'group', 'aria-label': 'Fase del lead' },
      data.meta.leadStages.map(([k, l]) => h('button.cv-stage', {
        type: 'button', class: [k === s.lead_stage ? 'on' : '', k === 'non_interessato' ? 'lost' : ''].join(' '), 'aria-pressed': String(k === s.lead_stage),
        on: { click: async () => { if (k !== s.lead_stage && await changeStage(s, k)) refresh(); } },
      }, k === s.lead_stage ? ic('check', 13) : null, l)),
      h('span.cv-stage.end', { title: 'Succede da solo alla prima commessa in BOSS' }, ic('check', 13), 'Diventa cliente')),
    s.lead_stage === 'non_interessato' && s.lost_reason ? h('span.cv-small.cv-muted', dots([`Motivo: ${s.lost_reason}`, s.retry_date && `riprovare il ${day(s.retry_date)}`])) : null);
}

// Panoramica: a sinistra le attività recenti (e quello che conta del ruolo), a destra persone e dati; via i riquadri pieni di «—»
async function overviewTab(box, s, base, go, people, refresh) {
  const r = s.roles;
  const kv = pairs => h('dl.cv-kv', pairs.filter(p => p && p[1] !== null && p[1] !== undefined && p[1] !== '' && p[1] !== '—').flatMap(([k, val]) => [h('dt', k), h('dd', val)]));
  const left = [await timelineCard(base, { onOpenTab: go })];
  if (r.includes('lead')) {
    left.push(h('section.cv-card.pad', h('div.cv-lbl', 'Perché ci interessa'), s.lead_why ? h('p', s.lead_why) : emptyState('target', 'Due righe su cosa fa e cosa potremmo fare per lui.', link('Scrivile', { on: { click: () => subjectForm({ subject: s, onSaved: refresh }) } })),
      kv([['Valore potenziale', s.potential_value ? `${eur(s.potential_value)} l'anno` : ''], ['Priorità', s.priority ? data.meta.priorities[s.priority] : ''], ['Segmento', s.segment], ['Origine', s.origin], ['Segnalato da', s.referred_by]])));
  }
  if (r.includes('cliente')) left.push(card({ title: 'Commesse e opportunità', right: pill('da BOSS', 'bl') }, emptyState('folder', 'Arriveranno da BOSS con il collegamento: commesse aperte e chiuse, opportunità e gare di questo cliente.')));
  if (r.includes('fornitore')) {
    left.push(h('section.cv-card.pad', h('div.cv-lbl', 'Fornitore'), kv([['Categorie', s.supplier_categories.map(k => data.meta.supplierCategories[k]).join(', ')], ['Sottocategorie', s.supplier_subcategories.join(', ')],
      ['Zone servite', s.supplier_zones.map(provinceName).join(', ')], ['SOA', s.soa?.length ? soaText(s.soa) : ''], ['Codice Vittoria', s.vittoria_id]]),
    h('p.cv-small.cv-muted', 'Qualifica e documenti a scadenza arriveranno da Vittoria.')));
  }
  if ((r.includes('partner') || r.includes('concorrente')) && s.soa?.length) left.push(h('section.cv-card.pad', h('div.cv-lbl', r.includes('partner') ? 'Come partner (ATI, RTI, avvalimento)' : 'Come concorrente'), kv([['Categorie SOA', soaText(s.soa)]])));
  if (s.history.length) {
    left.push(card({ title: 'Storico', count: s.history.length }, s.history.slice(0, 6).map(x => listRow({ icon: 'clock', title: x.to_stage === 'cliente' ? 'Cliente' : x.to_stage === 'ruoli' ? 'Ruoli' : stageLabel(x.to_stage),
      meta: dots([new Date(x.at).toLocaleDateString('it-IT'), x.user_name, x.note]) }))));
  }
  const contactsLine = [s.pec && h('a', { href: `mailto:${s.pec}` }, s.pec), s.email && h('a', { href: `mailto:${s.email}` }, s.email), s.phone && h('a', { href: `tel:${s.phone}` }, s.phone), s.website].filter(Boolean);
  const codes = dots([s.boss_code && `BOSS ${s.boss_code}`, s.accounting_code && `Target ${s.accounting_code}`, s.zoho_id && `Zoho ${s.zoho_id}`]);
  const right = [
    card({ title: 'Persone', count: people.length, right: people.length ? link('Tutte', { on: { click: () => go('contatti') } }) : null },
      people.length ? people.slice(0, 5).map(x => listRow({ lead: av(personName(x), 'bl'), title: personName(x), meta: dots([x.job, x.is_primary && 'principale']) || null, href: `#/crm/contatti/${x.id}`,
        actions: [x.mobile || x.phone ? h('a.btn.btn-sm.btn-ghost.cv-ico', { href: `tel:${x.mobile || x.phone}`, 'aria-label': `Chiama ${personName(x)}` }, ic('phone', 15)) : null,
          x.email ? h('a.btn.btn-sm.btn-ghost.cv-ico', { href: `mailto:${x.email}`, 'aria-label': `Scrivi a ${personName(x)}` }, ic('mail', 15)) : null] }))
        : emptyState('users', 'Nessun contatto: aggiungi le persone da conoscere.', h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ preset: { subject_id: s.id }, onSaved: refresh }) } }, 'Aggiungi'))),
    h('section.cv-card.pad', h('div.cv-lbl', 'Dati'),
      kv([['Ragione sociale', s.name + (s.short_name ? ` (${s.short_name})` : '')], ['Tipo', `${data.meta.kinds[s.kind] || ''}${s.legal_form ? ` · ${s.legal_form}` : ''}`],
        ['Codice fiscale', s.tax_code], ['P.IVA', s.vat], (s.kind === 'ente_pubblico' || s.ipa_code) && ['Codice IPA', s.ipa_code], ['SDI', s.sdi_code], ['ATECO', s.ateco],
        ['Sede', [s.address, s.city, s.province && `(${s.province})`, s.region].filter(Boolean).join(' ')],
        ['Contatti', contactsLine.length ? h('span', contactsLine.flatMap((x, i) => (i ? [' · ', x] : [x]))) : ''],
        ['Gruppo', s.group_id ? h('a', { href: `#/crm/scheda/${s.group_id}` }, s.group_name) : ''],
        ['Società del gruppo', s.controlled.length ? h('span', s.controlled.flatMap((x, i) => [i ? ', ' : '', h('a', { href: `#/crm/scheda/${x.id}` }, x.name)])) : ''],
        ['Stato', s.status !== 'attivo' ? data.meta.status[s.status] + (s.block_reason ? ` · ${s.block_reason}` : '') : ''],
        ['Codici', codes ? h('span.cv-small.cv-muted', codes) : '']]),
      s.notes ? h('p.cv-soft.cv-small', { style: { whiteSpace: 'pre-wrap' } }, s.notes) : null,
      link('Modifica i dati', { on: { click: () => subjectForm({ subject: s, onSaved: refresh }) } })),
  ];
  fill(box, h('div.cv-cols.w400', h('div.cv-stack', left), h('div.cv-stack', right)));
}

async function subjectContacts(box, s, refresh) {
  const current = activePeople(s);
  const past = s.contacts.filter(c => c.date_to);
  const row = c => listRow({ lead: av(personName(c), c.date_to ? '' : 'bl'), title: personName(c), href: `#/crm/contatti/${c.id}`,
    meta: dots([c.job, c.is_primary && 'principale', c.date_to && `fino al ${day(c.date_to)}`, c.email || c.mobile || c.phone]) });
  const proposals = await get(`/api/crm/subjects/${s.id}/proposals`).catch(() => []);
  fill(box, h('div.cv-cols.w420',
    h('div.cv-stack',
      card({ title: 'Persone', count: current.length, right: h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ preset: { subject_id: s.id }, onSaved: refresh }) } }, ic('plus', 14), 'Nuovo contatto') },
        current.length ? current.map(row) : emptyState('users', 'Nessun contatto. Aggiungi le persone da conoscere, con la loro qualifica.')),
      past.length ? card({ title: 'Non ci lavorano più', count: past.length }, past.map(row)) : null),
    proposals.length ? card({ title: 'Proposti dagli incontri', count: proposals.length },
      h('p.cv-small.cv-muted', { style: { padding: '0 24px 8px' } }, 'Indirizzi di quest\'azienda visti negli incontri di Outlook, non ancora tra i contatti.'),
      proposals.map(p => listRow({ icon: 'user', title: p.name || p.email, meta: dots([p.email, p.meeting_subject && `«${p.meeting_subject}»`]),
        actions: [h('button.btn.btn-sm', { type: 'button', on: { click: () => {
          const [first, ...rest] = (p.name && !p.name.includes('@') ? p.name : '').split(' ');
          contactForm({ preset: { subject_id: s.id, email: p.email, first_name: rest.length ? first : '', last_name: rest.length ? rest.join(' ') : first || p.email.split('@')[0] }, onSaved: refresh });
        } } }, 'Crea'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/proposals/${p.id}/dismiss`); refresh(); } } }, 'Ignora')] })))
      : h('div')));
}

// ── modulo del soggetto (con gli elenchi da cui scegliere) ──────────────────
async function subjectForm({ subject = null, preset = {}, onSaved }) {
  const s = subject || { kind: 'impresa', status: 'attivo', roles: preset.roles || [], asa: currentAsa() ? [currentAsa()] : data.myAsa.length === 1 ? [data.myAsa[0]] : [],
    supplier_categories: [], supplier_subcategories: [], supplier_zones: [], soa: [] };
  const { subjects: others } = await get('/api/crm/subjects');
  const leadBox = h('div'), supplierBox = h('div'), soaBox = h('div');
  const wasLead = Boolean(subject?.roles.includes('lead'));
  const roles = chipSet(Object.entries(data.meta.roles), s.roles, {
    disabled: k => (k === 'cliente' && wasLead && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS' : false),
    onChange: (vals, k) => {
      const other = k === 'lead' ? 'cliente' : k === 'cliente' ? 'lead' : null;
      if (other && vals.has(k) && vals.has(other)) {
        vals.delete(other);
        const b = roles.el.querySelector(`[data-v="${other}"]`);
        b?.classList.remove('on');
        b?.setAttribute('aria-pressed', 'false');
      }
      drawBlocks();
    },
  });
  const asa = chipSet(data.asa.map(a => [a.key, a.label]), s.asa);
  const subBox = h('div');
  const subs = new Set(s.supplier_subcategories);
  const drawSubs = () => fill(subBox, [...cats.values].length ? field('Sottocategorie', h('div.en-chips', [...cats.values].flatMap(cat => (data.meta.supplierSubcategories[cat] || []).map(sub => h('button.pill.en-chip', {
    type: 'button', class: subs.has(sub) ? 'on' : '', on: { click: e => { subs.has(sub) ? subs.delete(sub) : subs.add(sub); e.currentTarget.classList.toggle('on', subs.has(sub)); } } }, sub))))) : null);
  const cats = chipSet(Object.entries(data.meta.supplierCategories), s.supplier_categories, { onChange: drawSubs });
  const zones = provincePicker(s.supplier_zones);
  const soa = soaEditor(s.soa);
  const leadFields = h('div.en-type-block', h('div.en-type-title', 'Lead'),
    field('Perché ci interessa', textarea(s.lead_why, { 'data-k': 'lead_why', placeholder: 'Due righe: lavori che fa, zona, cosa potremmo fare per lui' })),
    h('div.en-row3',
      field('Valore potenziale (€ l\'anno)', input({ 'data-k': 'potential_value', value: s.potential_value === null || s.potential_value === undefined ? '' : Number(s.potential_value).toLocaleString('it-IT'), inputmode: 'decimal' })),
      field('Priorità', select([['', '—'], ...Object.entries(data.meta.priorities)], s.priority, { 'data-k': 'priority' })),
      field('Origine', select([['', '—'], ...data.meta.origins.map(o => [o, o])], s.origin, { 'data-k': 'origin' }))),
    field('Segnalato da', input({ 'data-k': 'referred_by', value: s.referred_by || '', placeholder: 'Contatto o collega che ci ha portato il nome' })));
  const supplierFields = h('div.en-type-block', h('div.en-type-title', 'Fornitore'),
    field('Categorie', cats.el), subBox,
    field('Zone servite', zones.el, 'Province o regioni intere'),
    field('Codice Vittoria', input({ 'data-k': 'vittoria_id', value: s.vittoria_id || '' }), 'Qualifica e documenti si gestiscono in Vittoria.'));
  const soaFields = h('div.en-type-block', h('div.en-type-title', 'Attestazione SOA'), soa.el);
  function drawBlocks() {
    fill(leadBox, roles.values.has('lead') ? leadFields : null);
    fill(supplierBox, roles.values.has('fornitore') ? supplierFields : null);
    fill(soaBox, ['fornitore', 'partner', 'concorrente'].some(k => roles.values.has(k)) ? soaFields : null);
  }
  drawBlocks();
  drawSubs();
  const dup = h('div');
  const nameIn = input({ 'data-k': 'name', value: s.name || '', maxlength: 200, autofocus: true });
  const vatIn = input({ 'data-k': 'vat', value: s.vat || '', maxlength: 20 });
  const taxIn = input({ 'data-k': 'tax_code', value: s.tax_code || '', maxlength: 20 });
  let m;
  const check = debounce(async () => {
    const { matches } = await get(`/api/crm/subjects/check${qs({ vat: vatIn.value, tax_code: taxIn.value, name: nameIn.value })}`, { quiet: true });
    const other = matches.filter(x => x.id !== subject?.id);
    fill(dup, other.length ? h('div.banner.crm-dup', 'Sembra già presente: ', other.map((x, i) => [i ? ', ' : '',
      x.visible ? h('a', { href: `#/crm/scheda/${x.id}`, on: { click: () => m.close() } }, x.name)
        : h('span', x.name, x.vat ? ` (P.IVA ${x.vat})` : '', ' di un\'altra ASA ',
          data.myAsa.length ? h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
            const mine = currentAsa() || data.myAsa[0];
            await post(`/api/crm/subjects/${x.id}/join`, { asa: mine });
            toast(`Aggiunta l'ASA ${asaLabel(mine)} alla scheda che c'era già`);
            m.close();
            location.hash = `#/crm/scheda/${x.id}`;
          } } }, 'Usa questa scheda') : null)])) : null);
  }, 400);
  for (const el of [nameIn, vatIn, taxIn]) el.addEventListener('input', check);
  const segments = [['', '—'], ...data.meta.segments.pubblico.map(x => [x, `Pubblico · ${x}`]), ...data.meta.segments.privato.map(x => [x, `Privato · ${x}`])];
  const prov = provinceSelect(s.province, { 'data-k': 'province' });
  const region = select([['', '—'], ...data.meta.regions.map(r => [r.name, r.name])], s.region, { 'data-k': 'region' });
  prov.addEventListener('change', () => { if (prov.value) region.value = regionOf(prov.value); });
  const form = h('div.en-form',
    h('div.en-row2', field('Ragione sociale', nameIn), field('Nome breve', input({ 'data-k': 'short_name', value: s.short_name || '', placeholder: 'Per le liste' }))),
    h('div.en-row3', field('P.IVA', vatIn), field('Codice fiscale', taxIn), field('Tipo', select(Object.entries(data.meta.kinds), s.kind, { 'data-k': 'kind' }))),
    dup,
    h('div.en-row2',
      field('Owner', select(userOptions().slice(1), subject ? s.owner_id || store.me.id : store.me.id, { 'data-k': 'owner_id' }), 'Chi tiene il rapporto: obbligatorio'),
      field('Funzione di riferimento', data.functions.length
        ? select([['', '—'], ...data.functions.map(f => [f, f])], s.function_name, { 'data-k': 'function_name' })
        : input({ 'data-k': 'function_name', value: s.function_name || '', placeholder: 'Reparto' }), 'Reparto dell\'organigramma che segue l\'anagrafica')),
    field('Ruoli', roles.el, wasLead && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS.' : 'Un\'anagrafica può avere più ruoli: Lead oppure Cliente, e anche Fornitore, Partner, Concorrente.'),
    field('ASA', asa.el, data.admin ? 'Chi è di un\'ASA vede solo le anagrafiche della sua.' : 'Tieni almeno una delle tue ASA, sennò non vedrai più la scheda.'),
    leadBox, supplierBox, soaBox,
    h('div.en-row2',
      field('Segmento', select(segments, s.segment, { 'data-k': 'segment' })),
      field('Gruppo / capogruppo', select([['', '—'], ...others.filter(x => x.id !== subject?.id).map(x => [x.id, x.name])], s.group_id, { 'data-k': 'group_id' }))),
    field('Indirizzo della sede', input({ 'data-k': 'address', value: s.address || '' })),
    h('div.en-row3', field('Comune', input({ 'data-k': 'city', value: s.city || '' })), field('Provincia', prov), field('Regione', region)),
    h('div.en-row3', field('PEC', input({ 'data-k': 'pec', value: s.pec || '', type: 'email' })), field('Email', input({ 'data-k': 'email', value: s.email || '', type: 'email' })),
      field('Telefono', input({ 'data-k': 'phone', value: s.phone || '' }))),
    h('div.en-row3', field('Sito web', input({ 'data-k': 'website', value: s.website || '' }), 'Serve anche a riconoscere gli incontri con quest\'azienda'),
      field('Codice SDI', input({ 'data-k': 'sdi_code', value: s.sdi_code || '', maxlength: 10 })),
      field('Codice IPA', input({ 'data-k': 'ipa_code', value: s.ipa_code || '' }), 'Solo enti pubblici')),
    h('div.en-row3', field('Forma giuridica', select([['', '—'], ...data.meta.legalForms.map(x => [x, x])], s.legal_form, { 'data-k': 'legal_form' })),
      field('ATECO', input({ 'data-k': 'ateco', value: s.ateco || '', placeholder: '41.20' })),
      field('Stato', select(Object.entries(data.meta.status), s.status, { 'data-k': 'status' }))),
    field('Motivo del blocco', input({ 'data-k': 'block_reason', value: s.block_reason || '' }), 'Solo se lo stato è «Bloccato»'),
    h('div.en-row3', field('Codice BOSS', input({ 'data-k': 'boss_code', value: s.boss_code || '' })), field('Codice contabile (Target)', input({ 'data-k': 'accounting_code', value: s.accounting_code || '' })),
      field('Codice Zoho', input({ 'data-k': 'zoho_id', value: s.zoho_id || '' }))),
    field('Note', textarea(s.notes, { 'data-k': 'notes' })));
  m = cvModal({
    wide: true, title: subject ? `Modifica ${subject.name}` : 'Nuova anagrafica', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      if (!roles.values.has('lead')) for (const k of ['lead_why', 'potential_value', 'priority', 'origin', 'referred_by']) delete f[k];
      if (!roles.values.has('fornitore')) delete f.vittoria_id;
      for (const k of ['group_id', 'owner_id']) f[k] = f[k] ? Number(f[k]) : null;
      f.roles = [...roles.values];
      f.asa = [...asa.values];
      if (roles.values.has('fornitore')) {
        f.supplier_categories = [...cats.values];
        f.supplier_subcategories = [...subs].filter(x => f.supplier_categories.some(c => (data.meta.supplierSubcategories[c] || []).includes(x)));
        f.supplier_zones = [...zones.values];
      }
      if (['fornitore', 'partner', 'concorrente'].some(k => roles.values.has(k))) f.soa = soa.value();
      const saved = subject ? await patch(`/api/crm/subjects/${subject.id}`, f) : await post('/api/crm/subjects', f);
      m.close();
      toast(subject ? 'Anagrafica aggiornata' : 'Anagrafica creata');
      onSaved?.(saved);
    } } }, subject ? 'Salva' : 'Crea')],
  });
}

// «Collega a»: la stessa azienda ha anche un altro ruolo (resta una scheda sola), oppure c'è già un'altra scheda
// della stessa azienda e si uniscono (contatti, email, incontri, note, progetti passano qui).
async function linkDialog(s, onDone) {
  const { subjects } = await get('/api/crm/subjects');
  const others = subjects.filter(x => x.id !== s.id);
  const free = Object.entries(data.meta.roles).filter(([k]) => !s.roles.includes(k) && !(k === 'lead' && s.roles.includes('cliente')));
  const roles = chipSet(free, [], { disabled: k => (k === 'cliente' && s.roles.includes('lead') && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS' : false) });
  const search = input({ type: 'search', placeholder: 'Cerca l\'anagrafica…' });
  const results = h('div.crm-lines.crm-scroll.crm-pickbox');
  let picked = null;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const list = q ? others.filter(x => `${x.name} ${x.vat || ''}`.toLowerCase().includes(q)).slice(0, 8) : [];
    fill(results, list.map(x => h('label.crm-line.crm-pick',
      h('input', { type: 'radio', name: 'crm-link', checked: picked === x.id, on: { change: () => { picked = x.id; } } }),
      h('div.grow', h('div.crm-line-t', x.name), h('div.t-meta', [x.roles.map(r => data.meta.roles[r]).join(', '), x.vat && `P.IVA ${x.vat}`, `${x.contacts} contatti`].filter(Boolean).join(' · '))))));
  };
  search.addEventListener('input', debounce(draw, 150));
  const m = cvModal({
    title: 'Collega a',
    body: h('div.en-form',
      h('p.small.muted', 'La stessa azienda ha più ruoli: resta una sola scheda, e se cambi un dato cambia dappertutto.'),
      field('È anche…', free.length ? roles.el : h('p.small.muted', 'Ha già tutti i ruoli.')),
      field('Oppure c\'è già un\'altra scheda della stessa azienda', h('div', search, results),
        'Le due schede diventano una: contatti, email, incontri, note e progetti passano tutti qui, l\'altra resta come rimando.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!roles.values.size && !picked) return toast('Scegli un ruolo o la scheda da collegare', 'err');
      if (picked) {
        const other = others.find(x => x.id === picked);
        if (!await confirmDialog(`Unire «${other.name}» a «${s.name}»? Tutto passa in questa scheda.`, { ok: 'Unisci' })) return;
        await post(`/api/crm/subjects/${picked}/merge`, { into: s.id });
      }
      if (roles.values.size) await post(`/api/crm/subjects/${s.id}/roles`, { mode: 'add', roles: [...roles.values] });
      m.close();
      toast('Collegato');
      onDone?.();
    } } }, 'Collega')],
  });
}

// «Trasforma in»: il ruolo cambia, la scheda resta la stessa con tutta la sua storia
function transformDialog(s, onDone) {
  const opts = Object.entries(data.meta.roles).filter(([k]) => !s.roles.includes(k));
  const roles = chipSet(opts, [], { disabled: k => (k === 'cliente' && s.roles.includes('lead') && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS' : false) });
  const note = textarea('', { placeholder: 'Perché (facoltativo): «da gennaio facciamo le gare in ATI con loro»', maxlength: 300 });
  const m = cvModal({
    title: 'Trasforma in',
    body: h('div.en-form',
      h('p.small.muted', 'Il ruolo cambia: la scheda resta la stessa, con tutta la sua storia; il ruolo vecchio sparisce. I dati del ruolo vecchio (categorie, zone, SOA) restano nella scheda.'),
      h('div.crm-composer-row', rolePills(s.roles), h('span.muted', '→'), roles.el),
      field('Nota', note)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!roles.values.size) return toast('Scegli il ruolo nuovo', 'err');
      await post(`/api/crm/subjects/${s.id}/roles`, { mode: 'set', roles: [...roles.values], note: note.value.trim() });
      m.close();
      toast(`Trasformata in ${[...roles.values].map(r => data.meta.roles[r]).join(', ')}`);
      onDone?.();
    } } }, 'Trasforma')],
  });
}

async function mergeForm(s) {
  const { subjects } = await get('/api/crm/subjects');
  const target = select([['', 'Scegli la scheda buona…'], ...subjects.filter(x => x.id !== s.id).map(x => [x.id, `${x.name}${x.vat ? ` · ${x.vat}` : ''}`])], '');
  const m = cvModal({
    title: `Unisci «${s.name}»`,
    body: h('div.en-form', h('p', 'Contatti, email, incontri, note e progetti passano alla scheda buona; questa resta come rimando, così i collegamenti di BOSS non si rompono.'), field('Scheda buona', target)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!target.value) return toast('Scegli la scheda buona', 'err');
      await post(`/api/crm/subjects/${s.id}/merge`, { into: Number(target.value) });
      m.close();
      toast('Schede unite');
      location.hash = `#/crm/scheda/${target.value}`;
    } } }, 'Unisci')],
  });
}

// ── contatti (design v2, artboard «Contatti») ──────────────────────────────
// Card larghe in due colonne (nome, ruolo, azienda, email e telefono cliccabili), avviso per i dati sporchi con
// «Sistema», a destra l'anteprima del contatto con la storia lavorativa e le ultime attività.
const dirty = c => /\d{6,}/.test(`${c.first_name || ''} ${c.last_name || ''}`) || !(c.last_name || c.first_name);
async function contactsTab(box, again) {
  const state = { q: '', owner: ownerDefault(), fn: '', noCompany: false, bad: false, limit: 60, pick: null };
  const list = h('div.cv-cardlist');
  const side = h('div.cv-stack.cv-hide-m');
  const sub = h('p.cv-sub');
  const pills = h('div.cv-row.cv-wrap', { style: { gap: '8px' } });
  let all = [];
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · persone', heading: title('', 'Contatti'), sub,
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => contactForm({ onSaved: c => { location.hash = `#/crm/contatti/${c.id}`; } }) } }, ic('plus', 15), 'Nuovo contatto')] }),
    h('div.cv-filters', filterRow(state, () => load(), { search: 'Cerca per nome, email o azienda', fn: false, again }), pills),
    h('div.cv-cols.w420', h('div', list), side));
  const showMore = h('div');
  list.after(showMore);
  async function load() {
    const { contacts } = await get(`/api/crm/contacts${qs({ q: state.q, asa: asaQuery(), owner: state.owner })}`);
    all = contacts;
    const noCo = contacts.filter(c => !c.links.some(l => !l.date_to));
    const bad = contacts.filter(dirty);
    sub.textContent = `${contacts.length.toLocaleString('it-IT')} contatti · ${(contacts.length - noCo.length).toLocaleString('it-IT')} collegati a un'azienda`;
    const toggle = (k, text, n, tone) => h('button.cv-pill.big', { type: 'button', class: state[k] ? tone || 'or' : 'line', 'aria-pressed': String(state[k]), on: { click: () => { state[k] = !state[k]; state.limit = 60; draw(); drawPills(); } } }, `${text} · ${n}`);
    const drawPills = () => fill(pills, noCo.length ? toggle('noCompany', 'Senza azienda', noCo.length) : null, bad.length ? toggle('bad', 'Da sistemare', bad.length, 'am') : null);
    drawPills();
    draw();
  }
  function draw() {
    const shown = all.filter(c => (!state.noCompany || !c.links.some(l => !l.date_to)) && (!state.bad || dirty(c)));
    if (!shown.length) {
      fill(list, h('section.cv-card', { style: { gridColumn: '1 / -1' } }, emptyState('users', state.q ? 'Nessun contatto con questa ricerca.' : 'Ancora nessun contatto. Le persone si aggiungono di solito dalla scheda della loro azienda.')));
      fill(showMore);
      return fill(side);
    }
    fill(list, shown.slice(0, state.limit).map(contactCard));
    fill(showMore, shown.length > state.limit ? h('div.cv-more-row', { style: { borderTop: 0 } }, link(`Mostra altri ${Math.min(60, shown.length - state.limit)} di ${shown.length - state.limit}`, { on: { click: () => { state.limit += 60; draw(); } } })) : null);
    preview(shown.find(c => c.id === state.pick) || shown[0]);
  }
  function contactCard(c) {
    const bad = dirty(c);
    const work = c.links.find(l => l.is_primary && !l.date_to) || c.links.find(l => !l.date_to);
    const select = () => { if (window.matchMedia('(min-width: 1181px)').matches) { state.pick = c.id; preview(c); } else location.hash = `#/crm/contatti/${c.id}`; };
    return h('section.cv-card.pad.cv-contact', { class: bad ? 'bad' : '' },
      h('div.cv-row', av(personName(c) || c.email, bad ? '' : 'bl'),
        h('button.cv-li-main', { type: 'button', on: { click: select } }, h('div.cv-li-t', h('span.cv-ell', personName(c) || c.email || 'Senza nome')),
          h('div.cv-li-m.cv-ell', bad ? `Dati da sistemare: «${personName(c)}»` : (work?.job || data.meta.contactStatus[c.status] || '—'))),
        bad ? h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ contact: c, onSaved: () => load() }) } }, 'Sistema')
          : h('a.btn.btn-sm.btn-ghost.cv-ico', { href: `#/crm/contatti/${c.id}`, 'aria-label': `Apri ${personName(c)}` }, ic('chevron-right', 16))),
      bad ? null : [
        h('div.cv-row.cv-small', { style: { gap: '6px' } }, ic('building', 13), work ? h('a.cv-t5.cv-ell', { href: `#/crm/scheda/${work.subject_id}` }, work.name) : h('span.cv-muted', 'Senza azienda')),
        c.email || c.mobile || c.phone ? h('div.cv-row.cv-small.cv-muted.cv-wrap', { style: { gap: '4px 14px' } },
          c.email ? h('a.cv-row.cv-ell', { href: `mailto:${c.email}`, style: { gap: '5px' } }, ic('mail', 13), h('span.cv-ell', c.email)) : null,
          c.mobile || c.phone ? h('a.cv-row', { href: `tel:${c.mobile || c.phone}`, style: { gap: '5px' } }, ic('phone', 13), c.mobile || c.phone) : null) : null]);
  }
  async function preview(c) {
    if (!c) return fill(side);
    const work = c.links.filter(l => !l.date_to);
    const main = work.find(l => l.is_primary) || work[0];
    fill(side, h('section.cv-card.pad', { style: { gap: '14px' } },
      h('div.cv-row', h('span.cv-av.bl', { style: { width: '52px', height: '52px', fontSize: '16px' }, 'aria-hidden': 'true' }, initialsOf(personName(c) || c.email || '?')),
        h('div.cv-grow', h('div.cv-t5', { style: { fontSize: '18px', lineHeight: '24px' } }, personName(c) || c.email), h('div.cv-small.cv-muted', dots([main?.job, main?.name]) || '—'))),
      h('div.cv-row.cv-wrap', { style: { gap: '8px' } },
        c.mobile || c.phone ? h('a.btn.btn-sm', { href: `tel:${c.mobile || c.phone}` }, ic('phone', 14), 'Chiama') : null,
        c.email ? h('a.btn.btn-sm', { href: `mailto:${c.email}` }, ic('mail', 14), 'Email') : null,
        h('a.btn.btn-sm', { href: `#/crm/contatti/${c.id}/note` }, ic('file-text', 14), 'Nuova nota'),
        h('a.cv-lnk', { href: `#/crm/contatti/${c.id}` }, 'Apri la scheda')),
      workHistory(c.links),
      h('div.cv-lbl.cv-row', { style: { gap: '8px' } }, 'Ultime attività', main ? pill(`anche su ${main.name}`, 'bl') : null),
      h('div', { 'data-tl': '' }, h('div.cv-small.cv-muted', 'Carico…'))));
    const box2 = side.querySelector('[data-tl]');
    const { items } = await get(`/api/crm/contacts/${c.id}/timeline`).catch(() => ({ items: [] }));
    if (!box2.isConnected) return;
    fill(box2, items.length ? items.slice(0, 4).map(i => listRow({ icon: i.type === 'email' ? 'mail' : i.type === 'meeting' ? 'calendar' : 'file-text', tone: i.missing ? 'rd' : i.type === 'email' ? 'bl' : i.type === 'meeting' ? 'or' : 'gr',
      title: i.title || '(senza titolo)', meta: dots([fmtDate(String(i.date || '').slice(0, 10)), i.missing && 'mancano le note']), cls: 'flat' }))
      : emptyState('clock', 'Ancora niente: email, incontri e note compariranno qui.'));
  }
  await load();
}
// «Dove ha lavorato»: storia lavorativa come linea del tempo
function workHistory(links) {
  if (!links.length) return h('div', h('div.cv-lbl', 'Dove ha lavorato'), h('p.cv-small.cv-muted', { style: { marginTop: '6px' } }, 'Non è collegato a nessuna azienda.'));
  const when = l => (l.date_to ? `${l.date_from ? String(l.date_from).slice(0, 4) : '…'} – ${String(l.date_to).slice(0, 4)}` : l.date_from ? `dal ${String(l.date_from).slice(0, 4)}` : 'adesso');
  return h('div', { style: { display: 'grid', gap: '10px' } }, h('div.cv-lbl', 'Dove ha lavorato'),
    links.map(l => h('div.cv-row', { style: { alignItems: 'flex-start' } }, h('span.cv-timeline-dot', { class: l.date_to ? '' : 'on' }),
      h('div.cv-grow', h('a.cv-t5', { href: `#/crm/scheda/${l.subject_id}`, style: { textDecoration: 'none', color: 'inherit' } }, l.name),
        h('div.cv-small.cv-muted', dots([l.job, when(l), l.is_primary && !l.date_to && 'principale']))))));
}

// Scheda del contatto: stessi tab dell'azienda; quello che si collega qui ricade sulle aziende dove lavora
async function contactPage(container, id, tabKey) {
  const c = await get(`/api/crm/contacts/${id}`);
  const base = `/api/crm/contacts/${id}`;
  const n = await counts(base);
  const tabs = [['panoramica', 'Panoramica'], ['email', 'Email', n.email], ['incontri', 'Incontri', n.incontri, n.missing], ['note', 'Note', n.note], ['progetti', 'Progetti', n.progetti]];
  const tab = tabs.some(([k]) => k === tabKey) ? tabKey : 'panoramica';
  const refresh = (k = tab) => contactPage(container, id, k);
  const go = k => { history.replaceState(null, '', `#/crm/contatti/${id}/${k}`); refresh(k); };
  const body = h('div.cv-stack');
  const primary = c.links.find(l => l.is_primary && !l.date_to) || c.links.find(l => !l.date_to);
  const menu = moreMenu([['Modifica', () => contactForm({ contact: c, onSaved: () => refresh() })],
    data.admin || c.created_by === store.me.id ? ['Cancella', async () => {
      if (!await confirmDialog(`Cancellare ${personName(c)} dal CRM?`, { ok: 'Cancella', danger: true })) return;
      await del(base);
      location.hash = '#/crm/contatti';
    }, true] : null]);
  fill(container, h('div.cv',
    h('a.cv-crumb', { href: '#/crm/contatti' }, ic('chevron-left', 14), 'Contatti'),
    h('section.cv-card.pad.cv-head.visible', h('div.cv-head-main',
      h('span.cv-mono', { 'aria-hidden': 'true', style: { borderRadius: '50%' } }, initialsOf(personName(c) || '?')),
      h('div.cv-grow', h('div.cv-row.cv-wrap', { style: { gap: '8px 10px' } }, h('h1.cv-head-name', personName(c)), c.status !== 'attivo' ? pill(data.meta.contactStatus[c.status], 'rd') : null,
        primary ? pill(`anche su ${primary.name}`, 'bl', { title: 'Quello che colleghi qui ricade sull\'azienda dove lavora' }) : null),
      h('div.cv-head-meta', h('span', dots([primary?.job, primary?.name]) || 'Contatto senza azienda'), c.owner_name ? h('span', av(c.owner_name, 'bl'), `Owner ${c.owner_name}`) : null)),
      h('div.cv-head-acts',
        c.mobile || c.phone ? h('a.btn', { href: `tel:${c.mobile || c.phone}` }, ic('phone', 15), 'Chiama') : null,
        c.email ? h('a.btn', { href: `mailto:${c.email}` }, ic('mail', 15), 'Email') : null,
        h('button.btn.btn-primary', { type: 'button', on: { click: () => go('note') } }, ic('file-text', 15), 'Nuova nota'),
        menu))),
    cvTabs(tabs, tab, go),
    body));
  if (tab === 'email') return emailsTab(body, base, {});
  if (tab === 'incontri') return meetingsTab(body, base, { people: [{ name: personName(c), email: c.email, preset: true }], label: 'questo contatto' });
  if (tab === 'note') return notesTab(body, base, {});
  if (tab === 'progetti') return projectsTab(body, base, { newName: personName(c) });
  const kv = pairs => h('dl.cv-kv', pairs.filter(p => p[1]).flatMap(([k, val]) => [h('dt', k), h('dd', val)]));
  fill(body, h('div.cv-cols.w420',
    h('div.cv-stack', await timelineCard(base, { onOpenTab: go })),
    h('div.cv-stack',
      h('section.cv-card.pad', h('div.cv-lbl', 'Persona'),
        kv([['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : ''], ['Cellulare', c.mobile ? h('a', { href: `tel:${c.mobile}` }, c.mobile) : ''], ['Telefono', c.phone],
          ['LinkedIn', c.linkedin], ['Lingua', c.language], ['Owner', c.owner_name], ['Privacy', `${data.meta.legalBasis[c.legal_basis]}${c.newsletter ? ' · consenso alle comunicazioni' : ''}`]]),
        c.notes ? h('p.cv-soft.cv-small', { style: { whiteSpace: 'pre-wrap' } }, c.notes) : null,
        link('Modifica', { on: { click: () => contactForm({ contact: c, onSaved: () => refresh() }) } })),
      h('section.cv-card.pad', workHistory(c.links)))));
}

async function contactForm({ contact = null, preset = {}, onSaved }) {
  const { subjects } = await get('/api/crm/subjects');
  const options = [['', 'Scegli l\'anagrafica…'], ...subjects.map(x => [x.id, x.name])];
  const jobs = data.meta.contactJobs;
  const rows = h('div.crm-links-edit');
  const addRow = (l = {}) => {
    const known = !l.job || jobs.includes(l.job);
    const other = input({ 'data-l': 'job_other', value: known ? '' : l.job, placeholder: 'Scrivi la qualifica', hidden: known });
    const job = select([['', 'Qualifica…'], ...jobs.map(j => [j, j]), ['__altro', 'Altro…']], known ? l.job || '' : '__altro', { 'data-l': 'job', 'aria-label': 'Qualifica' });
    job.addEventListener('change', () => { other.hidden = job.value !== '__altro'; if (!other.hidden) other.focus(); });
    rows.append(h('div.crm-link-row',
      select(options, l.subject_id || '', { 'data-l': 'subject_id', 'aria-label': 'Anagrafica' }),
      h('div.crm-job', job, other),
      h('label.en-check', h('input', { type: 'checkbox', 'data-l': 'is_primary', checked: Boolean(l.is_primary) }), 'principale'),
      input({ 'data-l': 'date_to', type: 'date', value: l.date_to || '', title: 'Fino al (se non ci lavora più)', 'aria-label': 'Fino al' }),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: e => e.currentTarget.parentElement.remove() } }, icon('x', { size: 15 }))));
  };
  (contact?.links || (preset.subject_id ? [{ subject_id: preset.subject_id }] : [])).forEach(addRow);
  if (!rows.childElementCount) addRow();
  const c = contact || { email: preset.email, first_name: preset.first_name, last_name: preset.last_name };
  const dup = h('div');
  const emailIn = input({ 'data-k': 'email', value: c.email || '', type: 'email' });
  const firstIn = input({ 'data-k': 'first_name', value: c.first_name || '', autofocus: true });
  const lastIn = input({ 'data-k': 'last_name', value: c.last_name || '' });
  let m;
  const check = debounce(async () => {
    const subjectId = rows.querySelector('[data-l="subject_id"]')?.value || '';
    const { matches } = await get(`/api/crm/contacts/check${qs({ email: emailIn.value, first_name: firstIn.value, last_name: lastIn.value, subject_id: subjectId })}`, { quiet: true });
    const other = matches.filter(x => x.id !== contact?.id);
    fill(dup, other.length ? h('div.banner.crm-dup', 'Sembra già presente: ', other.map((x, i) => [i ? ', ' : '',
      h('a', { href: `#/crm/contatti/${x.id}`, on: { click: () => m.close() } }, personName(x))])) : null);
  }, 400);
  for (const el of [emailIn, firstIn, lastIn]) el.addEventListener('input', check);
  const form = h('div.en-form',
    h('div.en-row3', field('Titolo', select([['', '—'], ...data.meta.titles.map(t => [t, t])], c.title, { 'data-k': 'title' })), field('Nome', firstIn), field('Cognome', lastIn)),
    field('Dove lavora', h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addRow() } }, icon('plus', { size: 15 }), 'Un\'altra anagrafica')),
      'Quando cambia azienda, metti la data «fino al»: la storia resta.'),
    h('div.en-row3', field('Email', emailIn, 'Serve a collegare da soli gli incontri di Outlook'), field('Cellulare', input({ 'data-k': 'mobile', value: c.mobile || '' })), field('Telefono', input({ 'data-k': 'phone', value: c.phone || '' }))),
    dup,
    h('div.en-row3', field('LinkedIn', input({ 'data-k': 'linkedin', value: c.linkedin || '' })),
      field('Lingua', select([['', '—'], ...data.meta.languages.map(x => [x, x])], c.language, { 'data-k': 'language' })),
      field('Owner', select(userOptions(), contact ? c.owner_id : store.me.id, { 'data-k': 'owner_id' }))),
    h('div.en-row3', field('Stato', select(Object.entries(data.meta.contactStatus), c.status || 'attivo', { 'data-k': 'status' })),
      field('Base giuridica (privacy)', select(Object.entries(data.meta.legalBasis), c.legal_basis || 'legittimo_interesse', { 'data-k': 'legal_basis' })),
      h('label.en-check.crm-check', h('input', { type: 'checkbox', 'data-k': 'newsletter', checked: Boolean(c.newsletter) }), 'Consenso alle comunicazioni')),
    field('Note', textarea(c.notes, { 'data-k': 'notes' })));
  m = cvModal({
    wide: true, title: contact ? `Modifica ${personName(contact)}` : 'Nuovo contatto', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      f.owner_id = f.owner_id ? Number(f.owner_id) : null;
      f.links = [...rows.children].map(r => {
        const j = r.querySelector('[data-l="job"]').value;
        return {
          subject_id: Number(r.querySelector('[data-l="subject_id"]').value) || null,
          job: j === '__altro' ? r.querySelector('[data-l="job_other"]').value.trim() : j,
          is_primary: r.querySelector('[data-l="is_primary"]').checked, date_to: r.querySelector('[data-l="date_to"]').value || null,
        };
      }).filter(l => l.subject_id);
      const saved = contact ? await patch(`/api/crm/contacts/${contact.id}`, f) : await post('/api/crm/contacts', f);
      m.close();
      toast(contact ? 'Contatto aggiornato' : 'Contatto creato');
      onSaved?.(saved);
    } } }, contact ? 'Salva' : 'Crea contatto')],
  });
}

// ── ASA e accessi (direzione), dentro le Impostazioni (design v2, artboard «Imp-asa») ─────────
// ASA come schede con le persone in avatar e «+ persona» dalla rubrica, con quanti clienti e lead ha ognuna.
async function asaTab(box) {
  const { asa } = await get('/api/crm/asa');
  const again = () => asaTab(box);
  const emails = h('datalist', { id: 'crm-users' }, store.users.map(u => h('option', { value: u.email }, u.name)));
  const asaCard = a => {
    const mail = input({ type: 'email', placeholder: 'email@almacis.it', list: 'crm-users', 'aria-label': `Aggiungi una persona a ${a.label}` });
    const form = h('form.cv-row', { hidden: true, style: { gap: '8px' }, on: { submit: async e => {
      e.preventDefault();
      await post(`/api/crm/asa/${a.key}/members`, { email: mail.value });
      toast('Persona aggiunta');
      again();
    } } }, mail, h('button.btn.btn-sm', { type: 'submit' }, 'Aggiungi'));
    const people = [...a.members, ...(a.key === 'energy' ? a.energyMembers.map(x => ({ ...x, energy: true })) : [])];
    return h('section.cv-card.pad.visible', { style: { gap: '10px' } },
      h('div.cv-row', h('span.cv-t5.cv-grow', { style: { fontSize: '15px' } }, a.label), a.boss_label ? h('span.cv-hint', `in BOSS: ${a.boss_label}`) : null),
      h('div.cv-row.cv-small.cv-muted', { style: { gap: '12px' } }, h('span', `${a.clients} clienti`), h('span', `${a.leads} lead`)),
      h('div.cv-row.cv-wrap', { style: { gap: '6px' } },
        people.map(x => h('span.cv-pill.line.big', { title: x.energy ? 'Da Alma Energy' : x.email }, av(x.name || x.email, 'bl'), x.name || x.email,
          x.energy ? null : h('button.crm-x', { type: 'button', 'aria-label': `Togli ${x.name || x.email}`, on: { click: async () => {
            await del(`/api/crm/asa/${a.key}/members/${encodeURIComponent(x.email)}`);
            again();
          } } }, ic('x', 12)))),
        h('button.cv-pill.or.big', { type: 'button', on: { click: () => { form.hidden = !form.hidden; if (!form.hidden) mail.focus(); } } }, ic('plus', 12), 'persona')),
      !people.length ? h('p.cv-small', { style: { color: 'var(--cv-rd)' } }, 'Nessuno in quest\'ASA.') : null,
      form);
  };
  const newAsa = input({ placeholder: 'Nome della nuova ASA', maxlength: 60, 'aria-label': 'Nome della nuova ASA' });
  fill(box,
    emails,
    h('p.cv-small.cv-muted', 'Tutti vedono tutte le anagrafiche: l\'ASA serve per i filtri e per chi riceve segnali e promemoria. I membri di Alma Energy sono dell\'ASA Energy.'),
    h('div.cv-grid3', asa.map(asaCard)),
    h('form.cv-card.pad', { on: { submit: async e => {
      e.preventDefault();
      await post('/api/crm/asa', { label: newAsa.value });
      toast('ASA creata');
      again();
    } } }, h('div.cv-row', newAsa, h('button.btn', { type: 'submit' }, ic('plus', 15), 'Nuova ASA'))));
}

// Primo caricamento da Zoho in 3 passi (File → Controlla → Carica): export «Aziende» così com'è, l'Excel di controllo
// corretto a mano, l'export «Contatti» o quello «Commesse». Quello che c'è già non si tocca.
function importCard() {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv', 'aria-label': 'File di Zoho' });
  const out = h('div', { style: { display: 'grid', gap: '14px' } });
  const stepper = h('div.cv-stepper');
  const drawStep = n => fill(stepper, ['File', 'Controlla', 'Carica'].map((l, i) => [i ? h('span.ln') : null,
    h('span.s', { class: i + 1 < n ? 'done' : i + 1 === n ? 'on' : '' }, h('b', i + 1 < n ? ic('check', 12) : String(i + 1)), l)]));
  drawStep(1);
  const drop = h('label.cv-drop', file, h('span.cv-ib.or', ic('upload', 18)), h('span.cv-t5', 'Scegli o trascina qui il file di Zoho'), h('span.cv-small.cv-muted', 'Excel o CSV: Aziende, Contatti o Commesse'));
  drop.addEventListener('dragover', () => drop.classList.add('over'));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', () => drop.classList.remove('over'));
  const send = async (path, buf) => {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-Alma': '1', 'Content-Type': 'application/octet-stream' }, body: buf });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Errore');
    return body;
  };
  const box = (n, l, s, warn) => h('div.cv-box', { style: warn ? { borderColor: 'var(--cv-am-line)', background: 'var(--cv-am-bg)' } : {} },
    h('div.cv-row', { style: { gap: '6px', alignItems: 'baseline' } }, h('span', { style: { fontSize: '24px', color: 'var(--cv-ink)' } }, String(n)), h('span.cv-small.cv-muted', l)), s ? h('div.cv-hint', s) : null);
  const table = (head, rows) => h('div.cv-box', { style: { padding: 0, overflow: 'hidden' } }, h('div.cv-tblwrap', h('table.cv-tbl', h('thead', h('tr', head.map(t => h('th', t)))), h('tbody', rows))));
  const roleText = r => Object.entries(r).map(([k, n]) => `${data.meta.roles[k]} ${n}`).join(' · ');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    drop.querySelector('.cv-t5').textContent = f.name;
    drop.querySelector('.cv-small').textContent = 'Scegli un altro file per sostituirlo';
    fill(out, loading());
    let pre;
    try { pre = await send('/api/crm/import/anteprima', buf); } catch (err) { drawStep(1); return fill(out, h('p.cv-small', { style: { color: 'var(--cv-rd)' } }, err.message)); }
    drawStep(2);
    const st = pre.stats;
    const missing = Object.entries(st.ownersMissing || {});
    const go = (label, count) => h('div.cv-row', h('span.cv-grow.cv-small.cv-muted', 'Le schede già presenti non si duplicano: P.IVA, codice fiscale e codice Zoho.'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async e => {
        e.currentTarget.disabled = true;
        try {
          const r = await send('/api/crm/import', buf);
          drawStep(4);
          toast(`Caricati ${r.created} ${label}`);
          fill(out, emptyState('check', `Caricati ${r.created} ${label}. Li trovi nel CRM.`));
        } catch (err) { toast(err.message, 'err'); }
      } } }, `Carica ${count} ${label}`));
    const owners = missing.length ? h('div.cv-row.cv-wrap', { style: { gap: '8px' } }, h('span.cv-small.cv-t5', 'Owner non trovati (vanno a chi carica):'), missing.map(([n, c]) => pill(`${n} (${c})`, 'am'))) : null;
    if (st.commesse) {
      return fill(out,
        h('div.cv-grid3', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, box(st.total, 'commesse', `${st.withClient} con il committente`), box(st.newClients, 'nuovi clienti', `${st.alreadyClients} lo erano già`),
          box(st.vatAdded, 'P.IVA da aggiungere', `${st.taxAdded} codici fiscali`), box(st.notFound.length, 'non trovati', 'committenti senza scheda', st.notFound.length > 0)),
        st.notFound.length ? h('p.cv-small.cv-muted', `Committenti non trovati: ${st.notFound.join(', ')}`) : null,
        table(['Azienda', 'Diventa cliente', 'P.IVA', 'Commesse', 'Prima'], pre.sample.map(x => h('tr', h('td', x.name), h('td', x.becomesClient ? 'sì' : 'è già cliente'), h('td', x.vat || '—'), h('td.num', String(x.commesse)), h('td', x.first ? fmtDate(x.first, { year: true }) : '—')))),
        go('aziende dai committenti', st.toLoad));
    }
    if (st.contacts) {
      return fill(out,
        h('div.cv-grid3', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, box(st.toLoad, 'contatti', `${st.linked} collegati a un'azienda`), box(st.unlinked, 'senza azienda'),
          box(st.existing, 'già presenti', `${st.colleagues} colleghi esclusi`), box(missing.length, 'owner non trovati', 'vanno a chi carica', missing.length > 0)),
        owners,
        table(['Persona', 'Qualifica', 'Azienda', 'Owner'], pre.sample.map(x => h('tr', h('td', x.name), h('td', x.job || '—'), h('td', x.company), h('td', x.owner)))),
        go('contatti', st.toLoad));
    }
    fill(out,
      h('div.cv-grid3', { style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, box(st.toLoad, 'aziende', roleText(st.roles)), box(st.existing, 'già presenti', `${st.duplicates} doppioni`),
        box(st.skipped, 'escluse'), box(missing.length, 'owner non trovati', 'vanno a chi carica', missing.length > 0)),
      owners,
      table(['Azienda', 'Tipo', 'Ruolo', 'ASA', 'Owner', 'Perché'], pre.sample.map(x => h('tr', h('td', x.name), h('td', data.meta.kinds[x.kind] || x.kind), h('td', x.roles.map(r => data.meta.roles[r]).join(', ')),
        h('td', x.asa.map(asaLabel).join(', ')), h('td', h('div', x.owner, x.function_name ? h('div.cv-small.cv-muted', x.function_name) : null)), h('td.cv-small', x.why)))),
      go('aziende', st.toLoad));
  });
  return h('section.cv-card.pad', { style: { gap: '14px' } },
    h('div.cv-row.cv-wrap', h('div.cv-t5.cv-grow', { style: { fontSize: '15px' } }, 'Caricamento da Zoho'), stepper),
    h('p.cv-small.cv-muted', 'L\'export «Aziende» così com\'è (le classifico io: lead, clienti, fornitori, partner, concorrenti) oppure l\'Excel di controllo corretto a mano; poi l\'export «Contatti», che si collegano da soli alla loro azienda, e l\'export «Commesse» (CSV), che fa diventare clienti i committenti. Prima vedi il riepilogo; quello che c\'è già non si tocca.'),
    drop, out);
}
