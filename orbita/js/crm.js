// Alma CRM: anagrafiche uniche (Lead, Clienti, Fornitori, Partner, Concorrenti) e contatti, per ASA.
// Canvas «CRM Alma Space – anagrafiche» (12–13/11/2026): un soggetto = una scheda con più ruoli; i contatti stanno in
// più soggetti con la loro qualifica; chi è di un'ASA vede solo le anagrafiche della sua, la direzione tutte.
// Su ogni azienda e contatto email, incontri, note e progetti come negli A3 (crm-tabs.js); quello del contatto
// ricade sull'azienda. Il lead diventa cliente da solo alla prima commessa in BOSS; opportunità in BOSS, qualifiche
// dei fornitori in Vittoria. Ovunque abbia senso i campi sono elenchi da cui scegliere (Dante 13/11).
import { bigliettiTab } from './biglietti.js';
import { scrivoTab } from './crm-scrivo.js';
import { postaPage } from './crm-posta.js';
import { h, fill, modal, confirmDialog, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { timelineCard, emailsTab, meetingsTab, notesTab, projectsTab, openCrmMeeting, bang } from './crm-tabs.js';
import { weekTab, settingsTab, stepsCard, keyAccountPill, keyAccountDialog, stepDialog } from './crm-commerciale.js';
import { gareTab, belowTab, radarTab, plansTab, openSignal } from './crm-radar.js';
import { launchRoom, mieiProgetti, crmProjectPage, touchBadges } from './crm-progetti.js';
import { gareHub } from './crm-gare.js';
import { soaCard, soaShort } from './crm-soa-card.js';
import { doppioniPage, dupBanner, dupLine, mergeDialog, conflictBox } from './crm-doppioni.js'; // canvas v15
import { businessView } from './crm-business.js';
import { esitiTab, relazioniTab } from './crm-esiti.js';
import { ic, dots, pill, av, pageTop, title, card, link, listRow, emptyState, seg, tabsBar as cvTabs, moreMenu, cvModal, choiceChips } from './crm-v2.js';

const TABS = [['settimana', 'La mia settimana'], ['lead', 'Lead'], ['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['partner', 'Partner e concorrenti'], ['tutte', 'Tutte le anagrafiche'], ['contatti', 'Contatti'], ['asa', 'ASA e accessi'], ['impostazioni', 'Impostazioni'], ['gare', 'Proposte dal radar'], ['sottosoglia', 'Segnali sotto soglia'], ['radar', 'Radar'], ['esiti', 'Vinte e perse'], ['relazioni', 'Chi conosciamo'], ['prima', 'Prima del bando'], ['concorrenza', 'Concorrenza']];
const ADMIN_TABS = ['asa', 'impostazioni'];
const NO_FILTER_TABS = ['asa', 'impostazioni', 'settimana', 'gare', 'sottosoglia', 'radar', 'esiti', 'relazioni', 'prima', 'concorrenza'];
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
// Azienda creata al volo (v8): «!» rosso «da completare»; al clic dice cosa manca.
const todoBang = s => (s && s.da_completare ? h('button.cv-bang', { type: 'button', title: `Da completare: ${s.da_completare.join(', ')}`, 'aria-label': `Da completare: ${s.da_completare.join(', ')}`,
  on: { click: e => { e.preventDefault(); e.stopPropagation(); toast(`${s.name}: da completare (${s.da_completare.join(', ')}). L'ha creata al volo chi ha aggiunto il contatto.`); } } }, '!') : null);
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
  store.crmData = data; // BU e ASA per «Registra esito» aperto da altre pagine
  if (parts[1] === 'business') return businessView(container, parts.slice(2), data); // Nuovi business
  // «Porta avanti» e «I miei progetti» (canvas v9): sala di lancio, portafoglio e scheda del progetto
  if (parts[1] === 'lancio' && ['s', 'i'].includes(parts[2]) && Number(parts[3])) return launchRoom(container, parts[2], Number(parts[3]));
  if (parts[1] === 'progetti') return mieiProgetti(container);
  if (parts[1] === 'posta') return postaPage(container); // la propria casella: da un'email nasce un progetto (ALM2-55)
  if (parts[1] === 'progetto' && Number(parts[2])) return crmProjectPage(container, Number(parts[2]));
  if (parts[1] === 'scheda' && Number(parts[2])) return subjectPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'contatti' && parts[2] === 'scrivo') { const body = h('div.cv'); fill(container, body); return scrivoTab(body); } // persone con cui mi scrivo (canvas v10, ALM2-46)
  if (parts[1] === 'contatti' && parts[2] === 'biglietti') { const body = h('div.cv'); fill(container, body); return bigliettiTab(body); } // biglietti da visita (canvas v10)
  if (parts[1] === 'contatti' && Number(parts[2])) return contactPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'doppioni') { const body = h('div.cv'); fill(container, body); return doppioniPage(body, parts[2] === 'contatti' ? 'contact' : 'subject'); } // canvas v15
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
  else if (tab === 'radar') await radarTab(body, data);
  else if (tab === 'esiti') await esitiTab(body, data);
  else if (tab === 'relazioni') await relazioniTab(body, data);
  // «Concorrenza e gare» (v11, 20/11): Concorrenza e Prima del bando in una pagina sola, a sezioni
  else if (tab === 'prima') await gareHub(body, data, 'prima-del-bando', { openSignal });
  else if (tab === 'concorrenza') await gareHub(body, data, parts[2], { openSignal });
  else if (tab === 'lead') await leadTab(body, parts[2], again);
  else if (tab === 'contatti') await contactsTab(body, again);
  else if (tab === 'clienti' || tab === 'fornitori') await roleListTab(body, tab, again); // stesso disegno dei Lead (21/11)
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
// «Lead» (canvas v9 «La pagina Lead», approvato da Dante il 19/11/2026): testata scura con l'imbuto per fase e il valore,
// gli avvisi di Alma (fermi da 90 giorni, senza prossimo passo, dove ci conoscono) e l'elenco con quanto ci conoscono,
// il prossimo passo e chiama/scrivi a un tocco. Restano le colonne per fase e «Da riordinare».
async function leadTab(box, mode, again) {
  const state = { q: '', mode: ['colonne', 'riordina'].includes(mode) ? mode : 'elenco', owner: ownerDefault(), fn: '', prio: '', stage: '', page: 0 };
  const hero = h('div');
  const alerts = h('div');
  const content = h('div', loading());
  const go = m => { state.mode = m; history.replaceState(null, '', `#/crm/lead${m === 'elenco' ? '' : `/${m}`}`); load(); };
  const prio = select([['', 'Priorità'], ...Object.entries(data.meta.priorities).map(([k, l]) => [k, `Priorità ${l.toLowerCase()}`])], '', { 'aria-label': 'Priorità',
    on: { change: e => { state.prio = e.target.value; e.target.classList.toggle('on', Boolean(state.prio)); state.page = 0; load(); } } });
  const stageSel = select([['', 'Fase: tutte'], ...data.meta.leadStages.filter(([k]) => k !== 'non_interessato').map(([k, l]) => [k, `Fase: ${l}`])], '', { 'aria-label': 'Fase',
    on: { change: e => { state.stage = e.target.value; e.target.classList.toggle('on', Boolean(state.stage)); state.page = 0; load(); } } });
  const modes = h('div');
  fill(box, hero, dupBanner('subject', 'lead'), alerts, filterRow(state, () => { state.page = 0; load(); }, { again, extra: [stageSel, prio, modes] }), content);
  let all = [];
  async function load() {
    all = (await get(`/api/crm/subjects${qs({ role: 'lead', asa: asaQuery(), q: state.q, owner: state.owner, function: state.fn })}`)).subjects;
    const filtered = all.filter(s => (!state.prio || s.priority === state.prio));
    const live = filtered.filter(s => s.live);
    const dead = filtered.filter(s => !s.live);
    const shown = live.filter(s => !state.stage || s.lead_stage === state.stage);
    fill(hero, leadHero(live, dead));
    fill(alerts, leadAlerts(live, dead, { onReorder: () => go('riordina'), onNoStep: () => { state.stage = ''; state.noStep = !state.noStep; state.page = 0; load(); }, noStep: state.noStep }));
    fill(modes, seg([['elenco', 'Elenco'], ['colonne', 'Colonne'], ['riordina', 'Da riordinare', dead.length]], state.mode, go, { label: 'Vista dei lead' }));
    if (state.mode === 'riordina') return fill(content, reorderView(dead, load));
    const list = state.noStep ? shown.filter(s => ['incontro', 'opportunita'].includes(s.lead_stage) && !s.next_step) : shown;
    if (state.mode === 'elenco') return fill(content, leadList(list, state, load));
    fill(content, h('div.cv-kan', data.meta.leadStages.map(([stage, label]) => leadColumn(stage, label, list.filter(s => s.lead_stage === stage), list, load))));
  }
  await load();
}

function leadHero(live, dead) {
  const stages = data.meta.leadStages.filter(([k]) => k !== 'non_interessato');
  const n = k => live.filter(s => s.lead_stage === k).length;
  const value = k => live.filter(s => s.lead_stage === k).reduce((t, s) => t + (Number(s.potential_value) || 0), 0);
  const withStep = live.filter(s => s.next_step_date && String(s.next_step_date).slice(0, 10) <= addDaysIso(7)).length;
  return h('section.ld-hero',
    h('div.ld-hero-top',
      h('div.cv-grow', h('div.ld-kicker', 'Anagrafiche'), h('h1.ld-h1', 'Lead'),
        h('p.ld-sub', `${live.length.toLocaleString('it-IT')} lead in corso · ${withStep} con un prossimo passo questa settimana${dead.length ? ` · ${dead.length.toLocaleString('it-IT')} da riordinare` : ''}`)),
      h('div.ld-acts',
        data.admin ? h('a.ld-ghost', { href: '#/crm/impostazioni/zoho' }, ic('download', 13), 'Importa') : null,
        h('button.ld-ghost.pri', { type: 'button', on: { click: () => subjectForm({ preset: { roles: ['lead'] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } }, ic('plus', 13), 'Nuovo lead'))),
    h('div.ld-funnel', stages.map(([k, l], i) => h('div.ld-step', { style: { '--a': String(0.25 + i * 0.18) } },
      h('div.ld-bar', { class: i === 0 ? 'first' : i === stages.length - 1 ? 'last' : '' }, h('b', n(k).toLocaleString('it-IT'))),
      h('span.ld-step-l', l), h('small', value(k) ? `${short(value(k))} di valore` : 'valore da stimare')))));
}
const addDaysIso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }); };

function leadAlerts(live, dead, { onReorder, onNoStep, noStep }) {
  const noStepN = live.filter(s => ['incontro', 'opportunita'].includes(s.lead_stage) && !s.next_step).length;
  const lateN = live.filter(s => s.next_step_date && late(s.next_step_date)).length;
  const card = (icn, tone, t, s, onClick, on) => h(onClick ? 'button.ld-alert' : 'div.ld-alert', { type: onClick ? 'button' : undefined, class: `${tone} ${on ? 'on' : ''}`, on: onClick ? { click: onClick } : undefined },
    h('span.ld-alert-ic', ic(icn, 17)), h('span.ld-alert-b', h('b', t), h('small', s)));
  return h('div.ld-alerts',
    card('alarm-clock', 'rd', `${dead.length.toLocaleString('it-IT')} lead fermi da 90 giorni`, dead.length ? 'Nessun passo, incontro o nota: richiamarli o chiuderli?' : 'Nessun lead fermo: bene così.', dead.length ? onReorder : null),
    card('target', 'or', `${noStepN} senza prossimo passo`, noStep ? 'Mostro solo questi: tocca per tornare a tutti.' : 'Tra i lead con incontro fatto o opportunità aperta.', noStepN || noStep ? onNoStep : null, noStep),
    card('clock', 'bl', `${lateN} passi in ritardo`, lateN ? 'Prossimi passi con la data già passata.' : 'Nessun passo in ritardo.', null));
}

function leadList(rows, state, reload) {
  if (!rows.length) return h('section.cv-card', emptyState('target', asaChoice() || ownerDefault() || state.q ? 'Nessun lead con questi filtri.' : 'Ancora nessun lead.'));
  const page = state.page || 0;
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE);
  const STAGE_TONE = { da_contattare: 'or', contattato: 'bl', incontro: 'gr', opportunita: 'op' };
  const TINTS = ['#C25E0E', '#4B6B8A', '#5A6B7A', '#7A5A6B', '#6B7A5A', '#5A7A6B', '#7A6B5A'];
  const tint = s => TINTS[[...String(s.name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
  const warmCells = new Map();
  const body = h('div.ld-rows', shown.map(s => {
    const warm = h('div.ld-warm', h('i', h('span', { style: { width: '0%' } })), h('small', '…'));
    warmCells.set(s.id, warm);
    const open = () => { location.hash = `#/crm/scheda/${s.id}`; };
    return h('div.ld-row', { role: 'link', tabIndex: 0, on: { click: e => { if (!e.target.closest('a, button')) open(); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } } },
      h('div.ld-name', h('span.ld-logo', { style: { background: tint(s) } }, initialsOf(s.short_name || s.name)),
        h('div.cv-grow', h('div.ld-name-t', { 'data-sid': s.id }, h('a', { href: `#/crm/scheda/${s.id}` }, s.name), todoBang(s), s.missing_notes ? bang() : null),
          h('small', dots([data.meta.kinds[s.kind], s.asa[0] ? asaLabel(s.asa[0]) : null, s.city || (s.created_quick ? 'creata al volo' : null)]) || '—'))),
      h('div.ld-c', h('span.ld-stage', { class: STAGE_TONE[s.lead_stage] || '' }, stageLabel(s.lead_stage))),
      h('div.ld-c.ld-val', s.potential_value ? short(Number(s.potential_value)) : '—'),
      h('div.ld-c', warm),
      h('div.ld-c.ld-next', s.next_step ? [h('span', s.next_step), h('small', { class: late(s.next_step_date) ? 'late' : '' }, s.next_step_date ? (late(s.next_step_date) ? `in ritardo · ${day(s.next_step_date)}` : `entro ${day(s.next_step_date)}`) : '')]
        : [h('span.cv-muted', 'Nessun passo'), h('small', 'da decidere')]),
      h('div.ld-c.ld-acts2',
        s.phone ? h('a.ld-ico', { href: `tel:${s.phone}`, 'aria-label': `Chiama ${s.name}`, title: s.phone }, ic('phone', 14)) : h('span.ld-ico.off', { title: 'Nessun telefono nella scheda' }, ic('phone', 14)),
        s.email ? h('a.ld-ico', { href: `mailto:${s.email}`, 'aria-label': `Scrivi a ${s.name}`, title: s.email }, ic('mail', 14)) : h('span.ld-ico.off', { title: 'Nessuna email nella scheda' }, ic('mail', 14))));
  }));
  // punti di contatto (bollino verde) e quanto ci conoscono: si leggono dopo, solo per le righe che si vedono
  setTimeout(() => touchBadges([...body.querySelectorAll('.ld-name-t[data-sid]')].map(el => [Number(el.dataset.sid), el])), 0);
  post('/api/crm/rapporti', { ids: shown.map(s => s.id) }).then(rel => {
    for (const [id, cell] of warmCells) {
      const r = rel[id];
      const pct = r ? (r.level === 'forte' ? 85 : r.level === 'media' ? 55 : 25) : 6;
      fill(cell, h('i', h('span', { class: r?.level || '', style: { width: `${pct}%` } })), h('small', r ? `${r.level}${r.why ? ` · ${r.why}` : ''}` : 'nessuno ci conosce'));
    }
  }).catch(() => { for (const cell of warmCells.values()) fill(cell, h('small', '—')); });
  return h('section.ld-list',
    h('div.ld-head', h('span', 'Lead'), h('span', 'Fase'), h('span', 'Valore'), h('span', 'Ci conoscono'), h('span', 'Prossimo passo'), h('span')),
    body,
    h('div.cv-tfoot', `Righe ${page * PAGE + 1}–${page * PAGE + shown.length} di ${rows.length.toLocaleString('it-IT')}`, h('span.cv-grow'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => exportCsv(rows, 'lead') } }, ic('download', 14), 'Esporta'),
      pages > 1 ? [h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina prima', disabled: page === 0 || undefined, on: { click: () => { state.page = page - 1; reload(); } } }, ic('chevron-left', 15)),
        h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina dopo', disabled: page >= pages - 1 || undefined, on: { click: () => { state.page = page + 1; reload(); } } }, ic('chevron-right', 15))] : null));
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
  h('div.cv-row', { style: { gap: '8px' } }, h('span.cv-t5.cv-grow.cv-ell', s.name), todoBang(s), s.missing_notes ? bang() : null, s.owner_name ? av(s.owner_name, 'or') : null),
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
    h('td', h('a.cv-name', { href: `#/crm/scheda/${s.id}` }, h('span.cv-ib', initialsOf(s.name)), h('div', h('div.cv-t5.cv-row', { style: { gap: '6px' } }, h('span.cv-ell', { style: { maxWidth: '340px' } }, s.name), todoBang(s)), h('div.cv-small.cv-muted', dots([data.meta.kinds[s.kind], s.city]) || '—')))),
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
  const state = { q: '', owner: ownerDefault(), fn: '', key: false, cat: '', role: '', soaCat: '', soaCls: '', soaValid: false, page: 0 };
  const list = h('div', loading());
  const lead = h('p.cv-sub');
  const newRole = sub === 'concorrenti' ? 'concorrente' : sub === 'partner' ? 'partner' : role;
  const c = data.counts;
  const switcher = seg([['clienti', 'Clienti', c.cliente || 0], ['lead', 'Lead', c.lead || 0], ['fornitori', 'Fornitori', c.fornitore || 0], ['partner', 'Partner', c.partner || 0],
    ['concorrenti', 'Concorrenti', c.concorrente || 0], ['tutte', 'Tutte']], sub, k => { location.hash = k === 'concorrenti' ? '#/crm/partner/concorrenti' : `#/crm/${k}`; }, { label: 'Anagrafiche' });
  const extra = tab === 'fornitori' ? [select([['', 'Categoria'], ...Object.entries(data.meta.supplierCategories)], '', { 'aria-label': 'Categoria', on: { change: e => { state.cat = e.target.value; e.target.classList.toggle('on', Boolean(state.cat)); load(); } } })]
    : tab === 'partner' ? [ // canvas v14: SOA da ANAC e a mano
      select([['', 'Categoria SOA'], ...data.meta.soaCategories.map(([k]) => [k, k])], '', { 'aria-label': 'Categoria SOA', on: { change: e => { state.soaCat = e.target.value; e.target.classList.toggle('on', Boolean(state.soaCat)); state.page = 0; load(); } } }),
      select([['', 'Classifica'], ...data.meta.soaClasses.map(([k]) => [k, `da ${k}`])], '', { 'aria-label': 'Classifica minima', on: { change: e => { state.soaCls = e.target.value; e.target.classList.toggle('on', Boolean(state.soaCls)); state.page = 0; load(); } } }),
      h('button.pill.en-chip', { type: 'button', 'aria-pressed': 'false', on: { click: e => { state.soaValid = !state.soaValid; e.currentTarget.classList.toggle('on', state.soaValid); e.currentTarget.setAttribute('aria-pressed', String(state.soaValid)); state.page = 0; load(); } } }, 'Solo valide')]
    : tab === 'tutte' ? [select([['', 'Ruolo'], ...Object.entries(data.meta.roles)], '', { 'aria-label': 'Ruolo', on: { change: e => { state.role = e.target.value; e.target.classList.toggle('on', Boolean(state.role)); load(); } } })] : [];
  let rows = [];
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · anagrafiche', heading: title('', LIST_TITLE[sub]), sub: lead,
      actions: [h('button.btn', { type: 'button', on: { click: () => exportCsv(rows, LIST_TITLE[sub]) } }, ic('download', 15), 'Esporta'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: newRole ? [newRole] : [] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } },
          ic('plus', 15), sub === 'clienti' ? 'Nuovo cliente' : sub === 'fornitori' ? 'Nuovo fornitore' : sub === 'partner' ? 'Nuovo partner' : sub === 'concorrenti' ? 'Nuovo concorrente' : 'Nuova anagrafica')] }),
    h('div.cv-row', switcher),
    dupBanner('subject', sub === 'concorrenti' ? 'concorrente' : sub === 'partner' ? 'partner' : role),
    filterRow(state, () => { state.page = 0; load(); }, { key: true, again, extra }),
    list);
  async function load() {
    const query = { asa: asaQuery(), q: state.q, role: sub === 'concorrenti' ? 'concorrente' : sub === 'partner' ? 'partner' : role || state.role, owner: state.owner, function: state.fn };
    if (tab === 'fornitori') query.category = state.cat;
    if (state.soaCat) Object.assign(query, { soa_cat: state.soaCat, soa_cls: state.soaCls, soa_valide: state.soaValid ? '1' : '' });
    const { subjects } = await get(`/api/crm/subjects${qs(query)}`);
    rows = subjects.filter(s => !state.key || s.key_account);
    const noun = { clienti: 'clienti', fornitori: 'fornitori', partner: 'partner', concorrenti: 'concorrenti', tutte: 'anagrafiche' }[sub];
    lead.textContent = `${rows.length.toLocaleString('it-IT')} ${noun} · ${rows.filter(s => s.next_step).length.toLocaleString('it-IT')} con un prossimo passo${sub === 'clienti' ? ' · un lead diventa cliente da solo alla prima commessa in BOSS' : ''}`;
    if (!state.soaCat && state.soaValid) rows = rows.filter(r => (r.soa_effective || []).some(x => !x.expired));
    fill(list, subjectTable(rows, sub, state.q || state.key || state.cat || state.role || state.soaCat || state.soaValid, state, load));
  }
  await load();
}

// ── Clienti e Fornitori con lo stesso disegno di Lead e Contatti (Dante 21/11/2026) ──
// Testata scura con i riquadri (tipo di cliente / categoria del fornitore) che filtrano, tre avvisi che filtrano,
// elenco a righe: il nome apre la scheda, telefono ed email a un tocco. Partner, Concorrenti e Tutte restano su subjectsTab.
const CLIENT_GROUPS = [['pubblici', 'Enti pubblici', s => s.kind === 'ente_pubblico'], ['partecipate', 'Partecipate e consorzi', s => ['partecipata', 'consorzio'].includes(s.kind)],
  ['imprese', 'Imprese', s => s.kind === 'impresa'], ['privati', 'Altri privati', s => !['ente_pubblico', 'partecipata', 'consorzio', 'impresa'].includes(s.kind)]];
const CAT_SHORT = { materiali: 'Materiali', subappalti: 'Subappalti', noli: 'Noli', servizi_cantiere: 'Servizi di cantiere', professionisti: 'Professionisti', mezzi: 'Mezzi', servizi_generali: 'Servizi generali' };
const tintOf = name => ['#C25E0E', '#4B6B8A', '#5A6B7A', '#7A5A6B', '#6B7A5A', '#5A7A6B', '#7A6B5A'][[...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 7];
async function roleListTab(box, tab, again) {
  const sup = tab === 'fornitori';
  const role = sup ? 'fornitore' : 'cliente';
  const noun = sup ? 'fornitori' : 'clienti';
  const state = { q: '', owner: ownerDefault(), fn: '', key: false, tile: '', alert: '', page: 0 };
  const hero = h('div');
  const alerts = h('div');
  const content = h('div', loading());
  let all = [];
  fill(box, hero, dupBanner('subject', role), alerts, filterRow(state, () => { state.page = 0; load(); }, { key: true, again }), content);
  const week = addDaysIso(7);
  const TILES = sup ? Object.keys(data.meta.supplierCategories).map(k => [k, CAT_SHORT[k] || data.meta.supplierCategories[k], s => (s.supplier_categories || []).includes(k)]) : CLIENT_GROUPS;
  const ALERTS = sup
    ? { categoria: s => !(s.supplier_categories || []).length, referente: s => !s.contacts, piva: s => !s.vat && !s.tax_code }
    : { passo: s => !s.next_step, ritardo: s => s.next_step_date && late(s.next_step_date), referente: s => !s.contacts };
  async function load() {
    all = (await get(`/api/crm/subjects${qs({ role, asa: asaQuery(), q: state.q, owner: state.owner, function: state.fn })}`)).subjects.filter(s => !state.key || s.key_account);
    drawTop();
    draw();
  }
  const pick = (k, v) => { state[k] = state[k] === v ? '' : v; state.page = 0; drawTop(); draw(); };
  function drawTop() {
    const withStep = all.filter(s => s.next_step_date && String(s.next_step_date).slice(0, 10) <= week).length;
    fill(hero, h('section.ld-hero',
      h('div.ld-hero-top',
        h('div.cv-grow', h('div.ld-kicker', 'Anagrafiche'), h('h1.ld-h1', sup ? 'Fornitori' : 'Clienti'),
          h('p.ld-sub', `${all.length.toLocaleString('it-IT')} ${noun} · ${withStep} con un prossimo passo questa settimana${sup ? '' : ' · un lead diventa cliente da solo alla prima commessa in BOSS'}`)),
        h('div.ld-acts',
          h('button.ld-ghost', { type: 'button', on: { click: () => exportCsv(all, sup ? 'Fornitori' : 'Clienti') } }, ic('download', 13), 'Esporta'),
          h('button.ld-ghost.pri', { type: 'button', on: { click: () => subjectForm({ preset: { roles: [role] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } }, ic('plus', 13), sup ? 'Nuovo fornitore' : 'Nuovo cliente'))),
      h('div.ld-funnel.flat', { class: `${state.tile ? 'has-on' : ''} ${TILES.length > 4 ? 'many' : ''}` }, TILES.map(([k, l, test], i) => {
        const n = all.filter(test).length;
        const on = state.tile === k;
        return h('button.ld-step', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), style: { '--a': String(Math.min(0.25 + i * (0.54 / Math.max(TILES.length - 1, 1)), 0.79)) }, on: { click: () => pick('tile', k) } },
          h('div.ld-bar', h('b', n.toLocaleString('it-IT'))),
          h('span.ld-step-l', l), h('small', on ? 'filtro attivo · tocca per toglierlo' : n ? `${all.filter(x => test(x) && x.next_step).length} con un prossimo passo` : 'nessuno'));
      }))));
    const card = (key, icn, tone, t, s) => {
      const n = all.filter(ALERTS[key]).length;
      const on = state.alert === key;
      const click = n || on;
      return h(click ? 'button.ld-alert' : 'div.ld-alert', { type: click ? 'button' : undefined, class: `${tone} ${on ? 'on' : ''}`, on: click ? { click: () => pick('alert', key) } : undefined },
        h('span.ld-alert-ic', ic(icn, 17)), h('span.ld-alert-b', h('b', t(n)), h('small', on ? 'Mostro solo questi: tocca per tornare a tutti.' : s(n))));
    };
    const num = n => n.toLocaleString('it-IT');
    fill(alerts, h('div.ld-alerts', sup ? [
      card('categoria', 'list', 'or', n => `${num(n)} senza categoria`, n => (n ? 'Non si trovano quando cerchi un fornitore per categoria.' : 'Ogni fornitore ha la sua categoria.')),
      card('referente', 'users', 'rd', n => `${num(n)} senza referente`, n => (n ? 'Nessuna persona collegata: chi chiamiamo?' : 'Ogni fornitore ha almeno un referente.')),
      card('piva', 'file-text', 'bl', n => `${num(n)} senza P. IVA`, n => (n ? 'Serve per la qualifica in Vittoria e per BOSS.' : 'Tutti hanno P. IVA o codice fiscale.')),
    ] : [
      card('passo', 'target', 'or', n => `${num(n)} senza prossimo passo`, n => (n ? 'Clienti senza una cosa da fare in agenda.' : 'Ogni cliente ha un prossimo passo.')),
      card('ritardo', 'clock', 'rd', n => `${num(n)} passi in ritardo`, n => (n ? 'Prossimi passi con la data già passata.' : 'Nessun passo in ritardo.')),
      card('referente', 'users', 'bl', n => `${num(n)} senza referente`, n => (n ? 'Nessuna persona collegata al cliente.' : 'Ogni cliente ha almeno un referente.')),
    ]));
  }
  function draw() {
    const test = TILES.find(([k]) => k === state.tile)?.[2];
    const rows = all.filter(s => (!test || test(s)) && (!state.alert || ALERTS[state.alert](s)));
    if (!rows.length) return fill(content, h('section.cv-card', emptyState(sup ? 'truck' : 'building', state.q || state.tile || state.alert || state.key || asaChoice() || state.owner ? `Nessun ${sup ? 'fornitore' : 'cliente'} con questi filtri.` : `Ancora nessun ${sup ? 'fornitore' : 'cliente'}.`)));
    const pages = Math.ceil(rows.length / PAGE);
    const page = Math.min(state.page, pages - 1);
    const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
    const warmCells = new Map();
    const body = h('div.ld-rows', shown.map(s => {
      const open = () => { location.hash = `#/crm/scheda/${s.id}`; };
      let col2, col3;
      if (sup) {
        const cats = (s.supplier_categories || []).map(k => CAT_SHORT[k] || data.meta.supplierCategories[k]);
        col2 = h('div.ld-c.ld-tags', cats.length ? [h('span.ld-stage.bl', cats[0]), cats.length > 1 ? h('span.ld-stage', { title: cats.slice(1).join(', ') }, `+${cats.length - 1}`) : null] : h('span.cv-muted', 'Nessuna'));
        col3 = h('div.ld-c.ld-val', s.contacts ? `${s.contacts} ${s.contacts === 1 ? 'persona' : 'persone'}` : h('span.cv-muted', 'Nessuno'));
      } else {
        col2 = h('div.ld-c.ld-tags', s.asa.length ? [h('span.ld-stage', asaLabel(s.asa[0])), s.asa.length > 1 ? h('span.ld-stage', { title: s.asa.slice(1).map(asaLabel).join(', ') }, `+${s.asa.length - 1}`) : null] : h('span.cv-muted', '—'));
        const warm = h('div.ld-warm', h('i', h('span', { style: { width: '0%' } })), h('small', '…'));
        warmCells.set(s.id, warm);
        col3 = h('div.ld-c', warm);
      }
      return h('div.ld-row', { role: 'link', tabIndex: 0, on: { click: e => { if (!e.target.closest('a, button')) open(); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } } },
        h('div.ld-name', h('span.ld-logo', { style: { background: tintOf(s.name) } }, initialsOf(s.short_name || s.name)),
          h('div.cv-grow', h('div.ld-name-t', { 'data-sid': s.id }, h('a', { href: `#/crm/scheda/${s.id}`, title: `Apri la scheda di ${s.name}` }, s.name), s.key_account ? h('span.ld-star', { title: 'Key account' }, ic('star', 12)) : null, todoBang(s), s.missing_notes ? bang() : null),
            h('small', dots([data.meta.kinds[s.kind], s.city, s.status !== 'attivo' && data.meta.status[s.status]]) || '—'))),
        col2, col3,
        h('div.ld-c.ld-owner', s.owner_name ? [av(s.owner_name, 'or'), h('span', s.owner_name)] : h('span.cv-muted', '—')),
        h('div.ld-c.ld-next', s.next_step ? [h('span', s.next_step), h('small', { class: late(s.next_step_date) ? 'late' : '' }, s.next_step_date ? (late(s.next_step_date) ? `in ritardo · ${day(s.next_step_date)}` : `entro ${day(s.next_step_date)}`) : '')]
          : [h('span.cv-muted', 'Nessun passo'), h('small', 'da decidere')]),
        h('div.ld-c.ld-acts2',
          s.phone ? h('a.ld-ico', { href: `tel:${s.phone}`, 'aria-label': `Chiama ${s.name}`, title: s.phone }, ic('phone', 14)) : h('span.ld-ico.off', { title: 'Nessun telefono nella scheda' }, ic('phone', 14)),
          s.email ? h('a.ld-ico', { href: `mailto:${s.email}`, 'aria-label': `Scrivi a ${s.name}`, title: s.email }, ic('mail', 14)) : h('span.ld-ico.off', { title: 'Nessuna email nella scheda' }, ic('mail', 14))));
    }));
    setTimeout(() => touchBadges([...body.querySelectorAll('.ld-name-t[data-sid]')].map(el => [Number(el.dataset.sid), el])), 0);
    if (warmCells.size) {
      post('/api/crm/rapporti', { ids: shown.map(s => s.id) }).then(rel => {
        for (const [id, cell] of warmCells) {
          const r = rel[id];
          const pct = r ? (r.level === 'forte' ? 85 : r.level === 'media' ? 55 : 25) : 6;
          fill(cell, h('i', h('span', { class: r?.level || '', style: { width: `${pct}%` } })), h('small', r ? `${r.level}${r.why ? ` · ${r.why}` : ''}` : 'nessuno ci conosce'));
        }
      }).catch(() => { for (const cell of warmCells.values()) fill(cell, h('small', '—')); });
    }
    fill(content, h('section.ld-list', { class: sup ? 'fo-list' : 'cl-list' },
      h('div.ld-head', h('span', sup ? 'Fornitore' : 'Cliente'), h('span', sup ? 'Categorie' : 'ASA'), h('span', sup ? 'Referenti' : 'Ci conoscono'), h('span', 'Responsabile'), h('span', 'Prossimo passo'), h('span')),
      body,
      h('div.cv-tfoot', `Righe ${page * PAGE + 1}–${page * PAGE + shown.length} di ${rows.length.toLocaleString('it-IT')}`, h('span.cv-grow'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => exportCsv(rows, sup ? 'Fornitori' : 'Clienti') } }, ic('download', 14), 'Esporta'),
        pages > 1 ? [h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina prima', disabled: page === 0 || undefined, on: { click: () => { state.page = page - 1; draw(); } } }, ic('chevron-left', 15)),
          h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina dopo', disabled: page >= pages - 1 || undefined, on: { click: () => { state.page = page + 1; draw(); } } }, ic('chevron-right', 15))] : null)));
  }
  await load();
}

// tabella delle anagrafiche: Azienda · ASA · Owner e funzione · (Contatti | Categorie | Ruoli | Fase) · Prossimo passo · «…»
// SOA in elenco (canvas v14): le categorie che contano, la scadenza di ANAC e da dove vengono
function soaCell(s) {
  const l = s.soa_effective || [];
  if (!l.length) return h('span.cv-small.cv-muted', '—');
  const valid = l.filter(x => !x.expired);
  const exp = s.soa_expires ? new Date(`${String(s.soa_expires).slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT', { month: '2-digit', year: 'numeric' }) : '';
  return h('div', { style: { minWidth: 0 } },
    h('div.cv-small.cv-ell', { style: { maxWidth: '230px', textDecoration: valid.length ? '' : 'line-through' } }, (valid.length ? valid : l).slice(0, 4).map(x => `${x.cat} ${x.cls}`).join(' · ')),
    h('div.cv-small', { style: { color: s.soa_state === 'scaduta' ? 'var(--cv-red, #C0392B)' : s.soa_state === 'in_scadenza' ? 'var(--cv-orange-d)' : 'var(--cv-muted, #8A8A8A)' } },
      s.soa_state === 'scaduta' ? 'scaduta' : s.soa_state ? `ANAC${exp ? ` · scade ${exp}` : ''}` : 'a mano'));
}
function subjectTable(subjects, tab, filtered, state = { page: 0 }, reload = () => {}) {
  if (!subjects.length) {
    return h('section.cv-card', emptyState('building', filtered || asaChoice() || ownerDefault() ? 'Nessuna anagrafica con questi filtri.' : 'Ancora nessuna anagrafica qui.',
      filtered || asaChoice() || ownerDefault() ? link('Mostra tutto', { on: { click: () => { saveFilter('asa', ''); saveFilter('owner', ''); location.reload(); } } }) : null));
  }
  const col4 = tab === 'lead' ? ['Fase', s => h('div', h('div.cv-small.cv-t5', stageLabel(s.lead_stage)), s.potential_value ? h('div.cv-small.cv-muted', short(Number(s.potential_value))) : null)]
    : tab === 'fornitori' ? ['Categorie', s => h('div.cv-small.cv-ell', { style: { maxWidth: '200px' } }, s.supplier_categories.map(x => data.meta.supplierCategories[x]).join(', ') || '—')]
      : ['partner', 'concorrenti'].includes(tab) ? ['SOA', s => soaCell(s)]
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
        h('td', h('a.cv-name', { href: `#/crm/scheda/${s.id}` }, h('span.cv-ib', initialsOf(s.short_name || s.name)),
          h('div', h('div.cv-t5.cv-row', { style: { gap: '6px' } }, h('span.cv-ell', { style: { maxWidth: '300px' } }, s.name), todoBang(s), s.key_account ? h('span', { title: 'Key account', style: { color: 'var(--cv-orange-d)', display: 'inline-flex' } }, ic('star', 13)) : null, s.missing_notes ? bang() : null),
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
    ['Unisci a un\'altra scheda…', () => mergeForm(s, r => (r.into === s.id ? refresh() : (location.hash = `#/crm/scheda/${r.into}`)))],
    data.admin ? ['Cancella', async () => {
      if (!await confirmDialog(`Cancellare «${s.name}» dal CRM? I contatti restano, i loro collegamenti a questa scheda si tolgono.`, { ok: 'Cancella', danger: true })) return;
      await del(base);
      location.hash = `#/crm/${back}`;
    }, true] : null]);
  const place = [s.city, s.province && `(${s.province})`].filter(Boolean).join(' ');
  fill(container, h('div.cv',
    h('a.cv-crumb', { href: `#/crm/${back}` }, ic('chevron-left', 14), TABS.find(([k]) => k === back)[1]),
    dupLine('subject', s.id, r => (r.into === s.id ? refresh() : (location.hash = `#/crm/scheda/${r.into}`))), // canvas v15
    h('section.cv-card.pad.cv-head.visible',
      h('div.cv-head-main',
        h('span.cv-mono', { 'aria-hidden': 'true' }, initialsOf(s.short_name || s.name)),
        h('div.cv-grow',
          h('div.cv-row.cv-wrap', { style: { gap: '8px 10px' } }, h('h1.cv-head-name', s.name), todoBang(s), rolePill(s), s.asa.slice(0, 3).map(a => pill(asaLabel(a), 'line')),
            s.asa.length > 3 ? pill(`+${s.asa.length - 3}`, '', { title: s.asa.slice(3).map(asaLabel).join(', ') }) : null,
            keyAccountPill(s, () => refresh(), data.keyRhythm || 90), s.status !== 'attivo' ? pill(data.meta.status[s.status], 'rd') : null),
          h('div.cv-head-meta',
            h('span', s.owner_name ? av(s.owner_name, 'bl') : null, `Owner ${s.owner_name || '—'}${s.function_name ? ` · ${s.function_name}` : ''}`),
            s.vat ? h('span', `P.IVA ${s.vat}`) : null, place ? h('span', ic('map-pin', 13), place) : null,
            data.meta.kinds[s.kind] ? h('span', data.meta.kinds[s.kind]) : null)),
        h('div.cv-head-acts',
          phone ? h('a.btn', { href: `tel:${phone}` }, ic('phone', 15), 'Chiama') : h('button.btn', { type: 'button', disabled: true, title: 'Nessun telefono: aggiungilo nei dati o ai contatti' }, ic('phone', 15), 'Chiama'),
          mail ? h('a.btn', { href: `mailto:${mail}` }, ic('mail', 15), 'Email') : h('button.btn', { type: 'button', disabled: true, title: 'Nessuna email' }, ic('mail', 15), 'Email'),
          s.website ? h('a.btn.cv-hide-m', { href: /^https?:/i.test(s.website) ? s.website : `https://${s.website}`, target: '_blank', rel: 'noopener' }, ic('globe', 15), 'Sito') : null,
          h('button.btn.an-websearch', { type: 'button', on: { click: () => webSearchDialog(s, () => refresh()) } }, ic('sparkles', 15), h('span.cv-hide-m', 'Cerca su internet'), h('span.cv-only-m', 'Internet')),
          h('button.btn.btn-primary', { type: 'button', on: { click: newStep }, 'aria-label': 'Nuovo passo' }, ic('plus', 15), h('span.cv-hide-m', 'Nuovo passo'), h('span.cv-only-m', 'Passo')),
          menu),
        completenessRing(s)),
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
// ── Anagrafica completa e «Cerca su internet» (canvas v9 «Anagrafica», Dante 19/11/2026) ──────────────────────────
// I vuoti sono pillole «+ Aggiungi»; i dati presi da internet hanno il bollino verde finché qualcuno non li conferma.
const COMPLETE_KEYS = [['vat', 'P.IVA'], ['pec', 'PEC'], ['address', 'indirizzo'], ['city', 'città'], ['province', 'provincia'], ['phone', 'telefono'], ['email', 'email'], ['website', 'sito'], ['ateco', 'ATECO']];
function completeness(s) {
  const missing = COMPLETE_KEYS.filter(([k]) => !(k === 'vat' ? s.vat || s.tax_code : s[k]));
  return { pct: Math.round(100 * (COMPLETE_KEYS.length - missing.length) / COMPLETE_KEYS.length), missing: missing.map(([, l]) => l) };
}
function completenessRing(s) {
  const { pct, missing } = completeness(s);
  const el = h('div.an-ring', { title: missing.length ? `Mancano: ${missing.join(', ')}` : 'Scheda completa' });
  const C = 2 * Math.PI * 26;
  el.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--cv-ring)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${pct === 100 ? '#1B7A45' : '#FF8A26'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>`;
  el.append(h('b', `${pct}%`), h('small', missing.length ? `mancano ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? '…' : ''}` : 'scheda completa'));
  return el;
}
function anagraficaSections(s, refresh) {
  const web = s.web_fields || {};
  const edit = () => subjectForm({ subject: s, onSaved: refresh });
  const val = (k, v) => {
    if (!v) return h('button.an-add', { type: 'button', on: { click: edit } }, '+ Aggiungi');
    const w = web[k];
    return h('span.an-val', h('b', v), w ? h('button.an-web', { type: 'button', title: `Preso da internet${w.source ? ` (${w.source})` : ''}: tocca per confermarlo`,
      on: { click: async () => { await post(`/api/crm/subjects/${s.id}/da-web/conferma`, { key: k }); toast('Dato confermato'); refresh(); } } }, 'da internet') : null);
  };
  const ext = (url, text) => (url ? h('a', { href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`, target: '_blank', rel: 'noopener' }, text || url.replace(/^https?:\/\/(www\.)?/i, '')) : '');
  const dl = rows => h('div.an-dl', rows.filter(Boolean).map(([k, label, v]) => h('div', h('span', label), val(k, v))));
  const sec = (icn, ttl, rows) => h('section.an-sec', h('div.an-sec-h', h('span.an-ic', ic(icn, 15)), h('b', ttl)), dl(rows));
  const nWeb = Object.keys(web).length;
  return h('div.an-wrap',
    nWeb ? h('div.an-webnote', ic('sparkles', 14), h('span.cv-grow', `${nWeb} ${nWeb === 1 ? 'dato preso' : 'dati presi'} da internet da controllare: tocca il bollino verde per confermarli.`),
      h('button.cv-lnk', { type: 'button', on: { click: async () => { await post(`/api/crm/subjects/${s.id}/da-web/conferma`, { key: '*' }); toast('Dati confermati'); refresh(); } } }, 'Confermali tutti')) : null,
    h('div.an-grid',
      sec('receipt', 'Dati fiscali', [['name', 'Ragione sociale', s.name], ['legal_form', 'Forma giuridica', s.legal_form], ['vat', 'P.IVA', s.vat], ['tax_code', 'Codice fiscale', s.tax_code], ['pec', 'PEC', s.pec],
        ['sdi_code', 'Codice SDI', s.sdi_code], (s.kind === 'ente_pubblico' || s.ipa_code) && ['ipa_code', 'Codice IPA', s.ipa_code]]),
      sec('map-pin', 'Sede', [['address', 'Indirizzo', s.address], ['zip', 'CAP', s.zip], ['city', 'Comune', s.city], ['province', 'Provincia', s.province], ['region', 'Regione', s.region]]),
      sec('phone', 'Recapiti', [['email', 'Email', s.email && ext(`mailto:${s.email}`, s.email)], ['phone', 'Telefono', s.phone && h('a', { href: `tel:${s.phone}` }, s.phone)],
        ['website', 'Sito', ext(s.website)], ['linkedin', 'LinkedIn', ext(s.linkedin, 'profilo')]]),
      sec('briefcase', 'Attività', [['ateco', 'ATECO', s.ateco], ['employees', 'Dipendenti', s.employees], ['revenue', 'Fatturato', s.revenue], ['soa', 'SOA', soaShort(s) || (s.soa?.length ? soaText(s.soa) : '')]])));
}
async function webSearchDialog(s, onSaved) {
  const body = h('div.an-wsd');
  const m = cvModal({ title: h('div.cv-row', { style: { gap: '10px' } }, h('span.an-spark', ic('sparkles', 17)), h('div', h('h2', 'Cerca su internet'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, s.name))), body, size: 'web' });
  const searching = text => fill(body, h('div.an-searching', h('span.spinner'), h('span', text)));
  const run = async (scelta = null) => {
    searching(scelta ? `Cerco i dati di «${scelta.name || scelta.note}»…` : 'Cerco l’azienda su internet…');
    let r;
    try { r = await post(`/api/crm/subjects/${s.id}/cerca-web`, scelta ? { scelta } : {}); } catch (err) {
      fill(body, h('p.an-err', err.message || 'La ricerca non ha risposto.'), h('button.btn', { type: 'button', on: { click: () => run(scelta) } }, 'Riprova'));
      return;
    }
    if (r.ambiguous) { choose(r.candidates); return; }
    showFields(r);
  };
  // Alma è indecisa: propone le alternative e la persona dice qual è
  const choose = candidates => {
    const hint = h('input.input', { placeholder: 'Oppure scrivilo tu: città, P.IVA, sito…', 'aria-label': 'Di quale azienda si tratta' });
    fill(body,
      h('p.an-q', 'Ho trovato più aziende con questo nome. Di quale si tratta?'),
      h('div.an-cands', candidates.map(c => h('button.an-cand', { type: 'button', on: { click: () => run(c) } },
        h('span.an-cand-ic', ic('building', 15)), h('span.cv-grow', h('b', c.name), h('small', [c.city, c.vat && `P.IVA ${c.vat}`, c.website].filter(Boolean).join(' · ')), c.note ? h('small.an-note', c.note) : null), ic('chevron-right', 15)))),
      h('div.an-hint', hint, h('button.btn', { type: 'button', on: { click: () => { const t = hint.value.trim(); if (t) run({ name: s.name, note: t }); else hint.focus(); } } }, 'Cerca questa')));
  };
  const showFields = r => {
    if (!r.fields.length) {
      fill(body, h('p.an-q', r.company?.name ? `Ho trovato «${r.company.name}», ma niente di nuovo rispetto alla scheda.` : 'Non ho trovato dati nuovi per questa scheda.'),
        h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'));
      return;
    }
    const checks = r.fields.map(f => ({ f, on: !f.current }));
    const count = h('span');
    const conflictSlot = h('div');
    const useBtn = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const picked = checks.filter(c => c.on);
      if (!picked.length) return;
      useBtn.disabled = true;
      const send = async list => {
        const out = await post(`/api/crm/subjects/${s.id}/da-web`, { fields: Object.fromEntries(list.map(c => [c.f.key, c.f.value])), sources: Object.fromEntries(list.map(c => [c.f.key, c.f.source])) }, { quiet: true });
        m.close();
        toast(`${out.saved.length} ${out.saved.length === 1 ? 'dato salvato' : 'dati salvati'}${out.skipped?.length ? ` (saltati: ${out.skipped.join(', ')})` : ''}`);
        onSaved?.();
      };
      try { await send(picked); } catch (err) {
        // la P.IVA trovata è già di un'altra scheda: «È la stessa azienda?» invece dell'errore (canvas v15)
        const others = picked.filter(c => !['vat', 'tax_code'].includes(c.f.key));
        const box = conflictBox(err, { currentId: s.id, onMerged: r => { m.close(); location.hash = `#/crm/scheda/${r.into}`; },
          onSaveWithout: others.length ? () => send(others).catch(e => toast(e.message, 'err')) : null });
        if (box) { fill(conflictSlot, box); conflictSlot.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else toast(err.message, 'err');
        useBtn.disabled = false;
      }
    } } }, ic('check', 15), count);
    const drawCount = () => { const n = checks.filter(c => c.on).length; count.textContent = n ? `Usa ${n === 1 ? 'quello spuntato' : `i ${n} spuntati`}` : 'Spunta i dati da usare'; useBtn.disabled = !n; };
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    fill(body,
      r.company?.name ? h('p.an-q', `${r.fields.length} ${r.fields.length === 1 ? 'dato trovato' : 'dati trovati'} per «${r.company.name}»${r.company.city ? `, ${r.company.city}` : ''}.`) : null,
      h('div.an-found', checks.map(c => {
        const box = h('button.an-chk', { type: 'button', role: 'checkbox', 'aria-checked': String(c.on), 'aria-label': c.f.label, class: c.on ? 'on' : '', on: { click: () => { c.on = !c.on; box.classList.toggle('on', c.on); box.setAttribute('aria-checked', String(c.on)); drawCount(); } } }, ic('check', 12));
        return h('div.an-frow', box, h('div.cv-grow', h('small', c.f.label), h('b', c.f.value),
          c.f.current ? h('small.an-was', `nella scheda: ${c.f.current}`) : null,
          c.f.source ? h('a.an-src', { href: c.f.source, target: '_blank', rel: 'noopener' }, ic('link', 10), host(c.f.source) || 'fonte') : null));
      })),
      conflictSlot,
      h('div.cv-row', { style: { gap: '8px', marginTop: '12px' } }, useBtn, h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla')),
      h('p.cv-small.cv-muted', { style: { marginTop: '8px' } }, 'Niente si salva da solo: i dati presi da internet restano segnati finché qualcuno non li conferma.'));
    drawCount();
  };
  run();
}

// «Trova su LinkedIn» (Dante 20/11): Alma cerca i profili pubblici possibili, la persona sceglie quello giusto e si salva il link
async function linkedinDialog(c, onSaved) {
  const body = h('div.an-wsd');
  const m = cvModal({ title: h('div.cv-row', { style: { gap: '10px' } }, h('span.an-spark', ic('linkedin', 17)), h('div', h('h2', 'Trova su LinkedIn'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, personName(c)))), body, size: 'web' });
  const save = async url => {
    await patch(`/api/crm/contacts/${c.id}`, { linkedin: url });
    m.close(); toast('Profilo LinkedIn salvato'); onSaved?.();
  };
  const manual = () => {
    const inp = h('input.input', { placeholder: 'https://www.linkedin.com/in/…', 'aria-label': 'Link del profilo LinkedIn' });
    return h('div.an-hint', inp, h('button.btn', { type: 'button', on: { click: () => { const u = inp.value.trim(); if (/linkedin\.com\/in\//i.test(u)) save(u.startsWith('http') ? u : `https://${u}`); else { toast('Incolla un link linkedin.com/in/…', 'error'); inp.focus(); } } } }, 'Salva questo'));
  };
  fill(body, h('div.an-searching', h('span.spinner'), h('span', 'Cerco il profilo pubblico…')));
  let r;
  try { r = await post(`/api/crm/contacts/${c.id}/cerca-linkedin`, {}); } catch (err) {
    fill(body, h('p.an-err', err.message || 'La ricerca non ha risposto.'), h('p.an-q', 'Puoi incollare tu il link del profilo:'), manual());
    return;
  }
  fill(body,
    r.profiles.length ? h('p.an-q', r.profiles.length === 1 ? 'Ho trovato questo profilo: è lui o lei?' : 'Ho trovato questi profili: quale è quello giusto?')
      : h('p.an-q', 'Non ho trovato un profilo pubblico. Se lo conosci, incolla il link:'),
    r.profiles.length ? h('div.an-cands', r.profiles.map(p => h('div.an-cand.li',
      h('span.an-cand-ic', ic('linkedin', 15)),
      h('span.cv-grow', h('b', p.title || p.url.replace(/^https:\/\/(www\.)?/, '')), h('small', [p.company, p.url.replace(/^https:\/\/(www\.)?/, '')].filter(Boolean).join(' · '))),
      h('a.btn.btn-sm.btn-ghost', { href: p.url, target: '_blank', rel: 'noopener', title: 'Guardalo su LinkedIn prima di sceglierlo' }, 'Guarda'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => save(p.url) } }, 'È questo')))) : null,
    r.profiles.length ? h('p.cv-small.cv-muted', 'Oppure incolla tu il link giusto:') : null,
    manual(),
    h('p.cv-small.cv-muted', { style: { marginTop: '6px' } }, 'Si salva solo il link: foto e dati restano su LinkedIn e si guardano aprendo il profilo.'));
}

// «Collegata a» (canvas v9 «Collegamenti»): gare, opportunità e progetti a cui è collegata, con il ruolo
function linkedToCard(kind, id) {
  const box = h('section.cv-card.pad.lk-side', h('div.cv-lbl', 'Collegata a'), h('div.loading', h('span.spinner')));
  get(`/api/crm/${kind}/${id}/collegata`, { quiet: true }).then(r => {
    if (!r.items.length) { box.remove(); return; }
    box.lastChild.replaceWith(h('div', r.items.map(i => h('a.lk-item', { href: i.type === 'project' ? (i.crm ? `#/crm/progetto/${i.id}` : `#/projects/${i.id}`) : '#/crm/radar' },
      h('span.lk-ic', ic(i.type === 'project' ? 'folder' : 'radar', 14)), h('span.cv-grow', h('b', i.title), h('small', i.type === 'project' ? 'progetto' : dots(['opportunità nel Radar', i.entity]))),
      i.role_label ? pill(i.role_label, 'line') : null))));
  }).catch(() => box.remove());
  return box;
}
// ── Anagrafica del contatto come quella dell'azienda (canvas v9 «Anagrafica»: «il contatto ha la stessa carta») ─────
// Lavoro (azienda, qualifica, sede di lavoro), recapiti (email, cellulare, telefono, LinkedIn), altro (lingua, owner,
// privacy). I vuoti sono «+ Aggiungi»; in testa l'anello «scheda completa».
const CONTACT_KEYS = [['email', 'email'], ['mobile', 'cellulare'], ['job', 'qualifica'], ['company', 'azienda'], ['linkedin', 'LinkedIn'], ['language', 'lingua']];
function contactCompleteness(c, primary) {
  const has = { email: c.email, mobile: c.mobile || c.phone, job: primary?.job, company: primary, linkedin: c.linkedin, language: c.language };
  const missing = CONTACT_KEYS.filter(([k]) => !has[k]).map(([, l]) => l);
  return { pct: Math.round(100 * (CONTACT_KEYS.length - missing.length) / CONTACT_KEYS.length), missing };
}
function contactRing(c, primary) {
  const { pct, missing } = contactCompleteness(c, primary);
  const el = h('div.an-ring', { title: missing.length ? `Mancano: ${missing.join(', ')}` : 'Scheda completa' });
  const C = 2 * Math.PI * 26;
  el.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--cv-ring)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${pct === 100 ? '#1B7A45' : '#FF8A26'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>`;
  el.append(h('b', `${pct}%`), h('small', missing.length ? `mancano ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? '…' : ''}` : 'scheda completa'));
  return el;
}
function contactSections(c, primary, refresh) {
  const edit = () => contactForm({ contact: c, onSaved: () => refresh() });
  const val = v => (v ? h('span.an-val', h('b', v)) : h('button.an-add', { type: 'button', on: { click: edit } }, '+ Aggiungi'));
  const ext = (url, text) => h('a', { href: /^https?:/i.test(url) ? url : `https://${url}`, target: '_blank', rel: 'noopener' }, text);
  const dl = rows => h('div.an-dl', rows.filter(Boolean).map(([label, v]) => h('div', h('span', label), val(v))));
  const sec = (icn, ttl, rows, extra) => h('section.an-sec', h('div.an-sec-h', h('span.an-ic', ic(icn, 15)), h('b', ttl)), dl(rows), extra || null);
  const work = h('span.an-val', h('b', '…'));
  const workRow = primary ? h('div', h('span', 'Sede di lavoro'), work) : null;
  if (primary) get(`/api/crm/subjects/${primary.subject_id}`, { quiet: true }).then(s => {
    const addr = [s.address, [s.zip, s.city].filter(Boolean).join(' '), s.province && `(${s.province})`].filter(Boolean).join(', ');
    fill(work, addr ? h('b', addr) : h('a.an-add', { href: `#/crm/scheda/${s.id}`, title: 'L’indirizzo è quello dell’azienda: completalo nella sua scheda' }, '+ Aggiungi nell’azienda'));
  }).catch(() => fill(work, h('b', '—')));
  const workSec = sec('briefcase', 'Lavoro', [
    ['Azienda', primary ? h('a', { href: `#/crm/scheda/${primary.subject_id}` }, primary.name) : ''],
    ['Qualifica', primary?.job || ''],
  ]);
  if (workRow) workSec.querySelector('.an-dl').append(workRow);
  return h('div.an-wrap', h('div.an-grid.c3',
    workSec,
    sec('phone', 'Recapiti', [
      ['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : ''],
      ['Cellulare', c.mobile ? h('a', { href: `tel:${c.mobile}` }, c.mobile) : ''],
      ['Telefono', c.phone ? h('a', { href: `tel:${c.phone}` }, c.phone) : ''],
      ['LinkedIn', c.linkedin ? ext(c.linkedin, 'profilo') : ''],
    ]),
    sec('user', 'Altro', [
      ['Lingua', c.language || ''],
      ['Owner', c.owner_name || ''],
      ['Privacy', `${data.meta.legalBasis[c.legal_basis] || ''}${c.newsletter ? ' · consenso alle comunicazioni' : ''}`],
      c.status !== 'attivo' ? ['Stato', data.meta.contactStatus[c.status]] : null,
    ], c.notes ? h('p.cv-soft.cv-small', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, c.notes) : null)));
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
  const soaBox = soaCard(s, { meta: data.meta, refresh, onEdit: () => subjectForm({ subject: s, onSaved: () => refresh() }) }); // canvas v14: SOA da ANAC
  if (soaBox) left.unshift(soaBox);
  if (r.includes('lead')) {
    left.push(h('section.cv-card.pad', h('div.cv-lbl', 'Perché ci interessa'), s.lead_why ? h('p', s.lead_why) : emptyState('target', 'Due righe su cosa fa e cosa potremmo fare per lui.', link('Scrivile', { on: { click: () => subjectForm({ subject: s, onSaved: refresh }) } })),
      kv([['Valore potenziale', s.potential_value ? `${eur(s.potential_value)} l'anno` : ''], ['Priorità', s.priority ? data.meta.priorities[s.priority] : ''], ['Segmento', s.segment], ['Origine', s.origin], ['Segnalato da', s.referred_by]])));
  }
  if (r.includes('cliente')) left.push(card({ title: 'Commesse e opportunità', right: pill('da BOSS', 'bl') }, emptyState('folder', 'Arriveranno da BOSS con il collegamento: commesse aperte e chiuse, opportunità e gare di questo cliente.')));
  if (r.includes('fornitore')) {
    left.push(h('section.cv-card.pad', h('div.cv-lbl', 'Fornitore'), kv([['Categorie', s.supplier_categories.map(k => data.meta.supplierCategories[k]).join(', ')], ['Sottocategorie', s.supplier_subcategories.join(', ')],
      ['Zone servite', s.supplier_zones.map(provinceName).join(', ')], ['Codice Vittoria', s.vittoria_id]]),
    h('p.cv-small.cv-muted', 'Qualifica e documenti a scadenza arriveranno da Vittoria.')));
  }
  if (s.history.length) {
    left.push(card({ title: 'Storico', count: s.history.length }, s.history.slice(0, 6).map(x => listRow({ icon: 'clock', title: x.to_stage === 'cliente' ? 'Cliente' : x.to_stage === 'ruoli' ? 'Ruoli' : x.to_stage === 'unione' ? 'Unione' : stageLabel(x.to_stage),
      meta: dots([new Date(x.at).toLocaleDateString('it-IT'), x.user_name, x.note]) }))));
  }
  const contactsLine = [s.pec && h('a', { href: `mailto:${s.pec}` }, s.pec), s.email && h('a', { href: `mailto:${s.email}` }, s.email), s.phone && h('a', { href: `tel:${s.phone}` }, s.phone), s.website].filter(Boolean);
  const codes = dots([s.boss_code && `BOSS ${s.boss_code}`, s.accounting_code && `Target ${s.accounting_code}`, s.zoho_id && `Zoho ${s.zoho_id}`]);
  const right = [
    linkedToCard('subjects', s.id),
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
  right.splice(1, 1, h('section.cv-card.pad', h('div.cv-lbl', 'Altro'),
    kv([['Gruppo', s.group_id ? h('a', { href: `#/crm/scheda/${s.group_id}` }, s.group_name) : ''],
      ['Società del gruppo', s.controlled.length ? h('span', s.controlled.flatMap((x, i) => [i ? ', ' : '', h('a', { href: `#/crm/scheda/${x.id}` }, x.name)])) : ''],
      ['Stato', s.status !== 'attivo' ? data.meta.status[s.status] + (s.block_reason ? ` · ${s.block_reason}` : '') : ''],
      ['Codici', codes ? h('span.cv-small.cv-muted', codes) : '']]),
    s.notes ? h('p.cv-soft.cv-small', { style: { whiteSpace: 'pre-wrap' } }, s.notes) : null,
    link('Modifica i dati', { on: { click: () => subjectForm({ subject: s, onSaved: refresh }) } })));
  fill(box, anagraficaSections(s, refresh), h('div.cv-cols.w400', h('div.cv-stack', left), h('div.cv-stack', right)));
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
  const soaFields = h('div.en-type-block', h('div.en-type-title', 'Attestazione SOA'), h('p.cv-small.cv-muted', { style: { margin: '0 0 8px' } }, 'Quelle di ANAC arrivano da sole con la P.IVA: qui scrivi solo quelle che ANAC non ha (es. un\'attestazione appena rilasciata).'), soa.el);
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
      x.visible ? [h('a', { href: `#/crm/scheda/${x.id}`, on: { click: () => m.close() } }, x.name), x.similar ? ' (nome simile)' : '']
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
  // canvas v14: con la P.IVA si vede subito cosa dice ANAC sulle SOA
  const soaHint = h('div.soa-hint');
  const lookSoa = debounce(async () => {
    const cf = (vatIn.value || taxIn.value).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, '');
    if (cf.length !== 11 && cf.length !== 16) return fill(soaHint);
    const r = await get(`/api/crm/soa/impresa${qs({ cf })}`, { quiet: true }).catch(() => null);
    const c = r?.soa?.cats || [];
    fill(soaHint, c.length ? [icon('check', { size: 14 }), ' Trovata su ANAC: ', h('b', c.slice(0, 2).map(x => `${x.cat} ${x.cls.replace(/-BIS$/, '-bis')}`).join(', ')), c.length > 2 ? ` e altre ${c.length - 2}` : '', ' · le aggiungo alla scheda']
      : r?.source?.updated_at ? h('span.cv-muted', 'Nessuna attestazione SOA valida su ANAC') : null);
  }, 500);
  for (const el of [vatIn, taxIn]) el.addEventListener('input', lookSoa);
  if (vatIn.value || taxIn.value) lookSoa();
  const segments = [['', '—'], ...data.meta.segments.pubblico.map(x => [x, `Pubblico · ${x}`]), ...data.meta.segments.privato.map(x => [x, `Privato · ${x}`])];
  const prov = provinceSelect(s.province, { 'data-k': 'province' });
  const region = select([['', '—'], ...data.meta.regions.map(r => [r.name, r.name])], s.region, { 'data-k': 'region' });
  prov.addEventListener('change', () => { if (prov.value) region.value = regionOf(prov.value); });
  const form = h('div.en-form',
    h('div.en-row2', field('Ragione sociale', nameIn), field('Nome breve', input({ 'data-k': 'short_name', value: s.short_name || '', placeholder: 'Per le liste' }))),
    h('div.en-row3', field('P.IVA', vatIn), field('Codice fiscale', taxIn), field('Tipo', select(Object.entries(data.meta.kinds), s.kind, { 'data-k': 'kind' }))),
    soaHint, dup,
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
    h('div.en-row2', field('Indirizzo della sede', input({ 'data-k': 'address', value: s.address || '' })), field('CAP', input({ 'data-k': 'zip', value: s.zip || '', maxlength: 10 }))),
    h('div.en-row3', field('Comune', input({ 'data-k': 'city', value: s.city || '' })), field('Provincia', prov), field('Regione', region)),
    h('div.en-row3', field('PEC', input({ 'data-k': 'pec', value: s.pec || '', type: 'email' })), field('Email', input({ 'data-k': 'email', value: s.email || '', type: 'email' })),
      field('Telefono', input({ 'data-k': 'phone', value: s.phone || '' }))),
    h('div.en-row3', field('Sito web', input({ 'data-k': 'website', value: s.website || '' }), 'Serve anche a riconoscere gli incontri con quest\'azienda'),
      field('Codice SDI', input({ 'data-k': 'sdi_code', value: s.sdi_code || '', maxlength: 10 })),
      field('Codice IPA', input({ 'data-k': 'ipa_code', value: s.ipa_code || '' }), 'Solo enti pubblici')),
    h('div.en-row3', field('LinkedIn', input({ 'data-k': 'linkedin', value: s.linkedin || '' })), field('Dipendenti', input({ 'data-k': 'employees', value: s.employees || '', placeholder: '25–30' })),
      field('Fatturato', input({ 'data-k': 'revenue', value: s.revenue || '', placeholder: '€ 4 M (2024)' }))),
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
      let saved;
      try { saved = subject ? await patch(`/api/crm/subjects/${subject.id}`, f, { quiet: true }) : await post('/api/crm/subjects', f, { quiet: true }); } catch (err) {
        // P.IVA già di un'altra scheda: «È la stessa azienda?» con Unisci (canvas v15)
        const box = conflictBox(err, { currentId: subject?.id, onMerged: r => { m.close(); location.hash = `#/crm/scheda/${r.into}`; },
          onSaveWithout: () => { vatIn.value = ''; taxIn.value = ''; fill(dup); toast('P.IVA tolta: ora puoi salvare'); } });
        if (box) { fill(dup, box); dup.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else toast(err.message, 'err');
        return;
      }
      m.close();
      toast(`${subject ? 'Anagrafica aggiornata' : 'Anagrafica creata'}${saved.soa_found ? ` · ${saved.soa_found} ${saved.soa_found === 1 ? 'categoria SOA' : 'categorie SOA'} da ANAC` : ''}`);
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

// «Unisci a un'altra scheda…»: si sceglie l'altra (le più simili in cima), poi la finestra Unisci dato per dato (canvas v15)
async function mergeForm(s, onDone) {
  const { subjects } = await get('/api/crm/subjects');
  const { matches = [] } = await get(`/api/crm/subjects/check${qs({ name: s.name })}`, { quiet: true }).catch(() => ({}));
  const near = matches.filter(x => x.id !== s.id).map(x => [x.id, `${x.name}${x.vat ? ` · ${x.vat}` : ''} (nome simile)`]);
  const rest = subjects.filter(x => x.id !== s.id && !near.some(n => n[0] === x.id)).map(x => [x.id, `${x.name}${x.vat ? ` · ${x.vat}` : ''}`]);
  const target = select([['', 'Scegli l\'altra scheda…'], ...near, ...rest], near[0]?.[0] || '');
  const m = cvModal({
    title: `Unisci «${s.name}»`,
    body: h('div.en-form', h('p', 'Scegli l\'altra scheda: poi decidi dato per dato cosa tenere.'), field('Con', target)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => {
      if (!target.value) return toast('Scegli l\'altra scheda', 'err');
      m.close();
      mergeDialog({ kind: 'subject', a: s.id, b: Number(target.value), onDone });
    } } }, 'Avanti')],
  });
}

// ── contatti (stesso disegno della pagina Lead, richiesta di Dante del 21/11/2026) ──
// Testata scura con i contatti per tipo di azienda (cliccabili come filtro), tre avvisi (senza azienda, da sistemare,
// senza recapiti) e l'elenco a righe: il nome apre l'anagrafica del contatto, l'azienda apre la sua scheda.
const dirty = c => /\d{6,}/.test(`${c.first_name || ''} ${c.last_name || ''}`) || !(c.last_name || c.first_name);
const workOf = c => c.links.find(l => l.is_primary && !l.date_to) || c.links.find(l => !l.date_to);
const CT_ROLES = [['cliente', 'Clienti'], ['lead', 'Lead'], ['fornitore', 'Fornitori'], ['partner', 'Partner']];
const ROLE_TONE = { cliente: 'gr', lead: 'or', fornitore: 'bl', partner: 'op', concorrente: '' };
async function contactsTab(box, again) {
  const state = { q: '', owner: ownerDefault(), fn: '', role: '', alert: '', page: 0 };
  const hero = h('div');
  const alerts = h('div');
  const content = h('div', loading());
  let all = [];
  let loaded = false;
  // «Tutti i contatti» · «Persone con cui mi scrivo» · «Biglietti da visita» (canvas v10); il numero = contatti lasciati dal mio QR da confermare
  const contactsTabs = h('div.ct-tabs');
  const drawContactsTabs = n => fill(contactsTabs, cvTabs([['tutti', 'Tutti i contatti'], ['scrivo', 'Persone con cui mi scrivo'], ['biglietti', 'Biglietti da visita', n || null]], 'tutti',
    k => { if (k !== 'tutti') location.hash = `#/crm/contatti/${k}`; }));
  drawContactsTabs(0);
  get('/api/biglietto', { quiet: true }).then(r => drawContactsTabs(r?.leads_new)).catch(() => {});
  fill(box, hero, contactsTabs, dupBanner('contact'), alerts, h('div.cv-filters', filterRow(state, () => { state.page = 0; load(); }, { search: 'Cerca per nome, email o azienda', fn: false, again })), content);
  const noCo = c => !c.links.some(l => !l.date_to);
  const noReach = c => !dirty(c) && !c.email && !c.mobile && !c.phone;
  const hasRole = (c, r) => c.links.some(l => !l.date_to && (l.roles || []).includes(r));
  const ALERTS = { senza: noCo, sistemare: dirty, recapiti: noReach };
  async function load() {
    all = (await get(`/api/crm/contacts${qs({ q: state.q, asa: asaQuery(), owner: state.owner })}`)).contacts;
    loaded = true;
    drawTop();
    draw();
  }
  const pick = (k, v) => { state[k] = state[k] === v ? '' : v; state.page = 0; drawTop(); draw(); };
  function drawTop() {
    const linked = all.length - all.filter(noCo).length;
    fill(hero, h('section.ld-hero',
      h('div.ld-hero-top',
        h('div.cv-grow', h('div.ld-kicker', 'Anagrafiche'), h('h1.ld-h1', 'Contatti'),
          h('p.ld-sub', `${all.length.toLocaleString('it-IT')} persone · ${linked.toLocaleString('it-IT')} collegate a un'azienda`)),
        h('div.ld-acts',
          h('button.ld-ghost.pri', { type: 'button', on: { click: () => contactForm({ onSaved: c => { location.hash = `#/crm/contatti/${c.id}`; } }) } }, ic('plus', 13), 'Nuovo contatto'))),
      h('div.ld-funnel.flat', { class: state.role ? 'has-on' : '' }, CT_ROLES.map(([k, l], i) => {
        const n = all.filter(c => hasRole(c, k)).length;
        const on = state.role === k;
        return h('button.ld-step', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), style: { '--a': String(0.25 + i * 0.18) }, on: { click: () => pick('role', k) } },
          h('div.ld-bar', h('b', n.toLocaleString('it-IT'))),
          h('span.ld-step-l', l), h('small', on ? 'filtro attivo · tocca per toglierlo' : `contatti di ${l.toLowerCase()}`));
      }))));
    const card = (key, icn, tone, t, s) => {
      const n = all.filter(ALERTS[key]).length;
      const on = state.alert === key;
      const click = n || on;
      return h(click ? 'button.ld-alert' : 'div.ld-alert', { type: click ? 'button' : undefined, class: `${tone} ${on ? 'on' : ''}`, on: click ? { click: () => pick('alert', key) } : undefined },
        h('span.ld-alert-ic', ic(icn, 17)), h('span.ld-alert-b', h('b', t(n)), h('small', on ? 'Mostro solo questi: tocca per tornare a tutti.' : s(n))));
    };
    fill(alerts, h('div.ld-alerts',
      card('senza', 'building', 'or', n => `${n.toLocaleString('it-IT')} senza azienda`, n => (n ? 'Persone non collegate a nessuna azienda del CRM.' : 'Ognuno è collegato alla sua azienda.')),
      card('sistemare', 'alert-triangle', 'rd', n => `${n.toLocaleString('it-IT')} da sistemare`, n => (n ? 'Nome mancante o con numeri dentro: da correggere.' : 'Nessun dato sporco.')),
      card('recapiti', 'phone', 'bl', n => `${n.toLocaleString('it-IT')} senza recapiti`, n => (n ? 'Né email né telefono: non li possiamo raggiungere.' : 'Tutti hanno email o telefono.'))));
  }
  function draw() {
    // i contatti con i dati sporchi vanno in fondo: si trovano dall'avviso «da sistemare»
    const rows = all.filter(c => (!state.role || hasRole(c, state.role)) && (!state.alert || ALERTS[state.alert](c))).sort((a, b) => dirty(a) - dirty(b));
    if (!rows.length) return fill(content, h('section.cv-card', emptyState('users', state.q || state.role || state.alert ? 'Nessun contatto con questi filtri.' : 'Ancora nessun contatto. Le persone si aggiungono di solito dalla scheda della loro azienda.')));
    const pages = Math.ceil(rows.length / PAGE);
    const page = Math.min(state.page, pages - 1);
    const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
    const TINTS = ['#4B6B8A', '#5A6B7A', '#7A5A6B', '#6B7A5A', '#5A7A6B', '#7A6B5A', '#C25E0E'];
    const tint = name => TINTS[[...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % TINTS.length];
    fill(content, h('section.ld-list.ct-list',
      h('div.ld-head', h('span', 'Contatto'), h('span', 'Azienda'), h('span', 'Tipo'), h('span', 'Recapiti'), h('span', 'Responsabile'), h('span')),
      h('div.ld-rows', shown.map(c => {
        const bad = dirty(c);
        const work = workOf(c);
        const roles = work?.roles || [];
        const role = CT_ROLES.map(([k]) => k).find(k => roles.includes(k)) || roles[0] || null;
        const name = personName(c) || c.email || 'Senza nome';
        const open = () => { location.hash = `#/crm/contatti/${c.id}`; };
        return h('div.ld-row', { role: 'link', tabIndex: 0, class: bad ? 'bad' : '', on: { click: e => { if (!e.target.closest('a, button')) open(); }, keydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); } } },
          h('div.ld-name', h('span.ld-logo.round', { style: { background: bad ? 'var(--cv-check)' : tint(name) } }, initialsOf(name)),
            h('div.cv-grow', h('div.ld-name-t', h('a', { href: `#/crm/contatti/${c.id}`, title: `Apri l'anagrafica di ${name}` }, name), c.status === 'non_raggiungibile' ? h('span.ld-stage', 'non raggiungibile') : null),
              h('small', bad ? 'Dati da sistemare' : (work?.job || 'Ruolo non indicato'), !bad && work ? h('span.ld-co-m', ` · ${work.name}`) : null))),
          h('div.ld-c.ld-co', work ? h('a', { href: `#/crm/scheda/${work.subject_id}`, title: `Apri la scheda di ${work.name}` }, ic('building', 13), h('span', work.name)) : h('span.cv-muted', 'Senza azienda')),
          h('div.ld-c', role ? h('span.ld-stage', { class: ROLE_TONE[role] || '' }, data.meta.roles[role] || role) : h('span.cv-muted', '—')),
          h('div.ld-c.ld-next', c.email ? h('span', c.email) : h('span.cv-muted', 'Nessuna email'), h('small', c.mobile || c.phone || 'nessun telefono')),
          h('div.ld-c.ld-owner', c.owner_name ? [av(c.owner_name, 'or'), h('span', c.owner_name)] : h('span.cv-muted', '—')),
          h('div.ld-c.ld-acts2', bad ? h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ contact: c, onSaved: () => load() }) } }, 'Sistema') : [
            c.mobile || c.phone ? h('a.ld-ico', { href: `tel:${c.mobile || c.phone}`, 'aria-label': `Chiama ${name}`, title: c.mobile || c.phone }, ic('phone', 14)) : h('span.ld-ico.off', { title: 'Nessun telefono' }, ic('phone', 14)),
            c.email ? h('a.ld-ico', { href: `mailto:${c.email}`, 'aria-label': `Scrivi a ${name}`, title: c.email }, ic('mail', 14)) : h('span.ld-ico.off', { title: 'Nessuna email' }, ic('mail', 14))]));
      })),
      h('div.cv-tfoot', `Righe ${page * PAGE + 1}–${page * PAGE + shown.length} di ${rows.length.toLocaleString('it-IT')}`, h('span.cv-grow'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => exportContacts(rows) } }, ic('download', 14), 'Esporta'),
        pages > 1 ? [h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina prima', disabled: page === 0 || undefined, on: { click: () => { state.page = page - 1; draw(); } } }, ic('chevron-left', 15)),
          h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Pagina dopo', disabled: page >= pages - 1 || undefined, on: { click: () => { state.page = page + 1; draw(); } } }, ic('chevron-right', 15))] : null)));
  }
  await load();
}
function exportContacts(rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Cognome', 'Nome', 'Email', 'Cellulare', 'Telefono', 'Azienda', 'Ruolo', 'Responsabile'].map(cell).join(';'),
    ...rows.map(c => { const w = workOf(c); return [c.last_name, c.first_name, c.email, c.mobile, c.phone, w?.name, w?.job, c.owner_name].map(cell).join(';'); })];
  const a = h('a', { href: URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })), download: `contatti ${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
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
    dupLine('contact', id, r => (r.into === id ? contactPage(container, id, tabKey) : (location.hash = `#/crm/contatti/${r.into}`))), // canvas v15
    h('section.cv-card.pad.cv-head.visible', h('div.cv-head-main',
      h('span.cv-mono', { 'aria-hidden': 'true', style: { borderRadius: '50%' } }, initialsOf(personName(c) || '?')),
      h('div.cv-grow', h('div.cv-row.cv-wrap', { style: { gap: '8px 10px' } }, h('h1.cv-head-name', personName(c)), c.status !== 'attivo' ? pill(data.meta.contactStatus[c.status], 'rd') : null,
        primary ? pill(`anche su ${primary.name}`, 'bl', { title: 'Quello che colleghi qui ricade sull\'azienda dove lavora' }) : null),
      h('div.cv-head-meta', h('span', dots([primary?.job, primary?.name]) || 'Contatto senza azienda'), c.owner_name ? h('span', av(c.owner_name, 'bl'), `Owner ${c.owner_name}`) : null)),
      h('div.cv-head-acts',
        c.mobile || c.phone ? h('a.btn', { href: `tel:${c.mobile || c.phone}` }, ic('phone', 15), 'Chiama') : null,
        c.email ? h('a.btn', { href: `mailto:${c.email}` }, ic('mail', 15), 'Email') : null,
        // LinkedIn (Dante 20/11): solo il link al profilo pubblico, scelto dalla persona; il profilo si guarda su LinkedIn
        c.linkedin ? h('a.btn', { href: /^https?:/i.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`, target: '_blank', rel: 'noopener' }, ic('linkedin', 15), h('span.cv-hide-m', 'Apri su LinkedIn'))
          : h('button.btn.an-websearch', { type: 'button', on: { click: () => linkedinDialog(c, () => refresh()) } }, ic('sparkles', 15), h('span.cv-hide-m', 'Trova su LinkedIn')),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => go('note') } }, ic('file-text', 15), 'Nuova nota'),
        menu),
      contactRing(c, primary))),
    cvTabs(tabs, tab, go),
    body));
  if (tab === 'email') return emailsTab(body, base, {});
  if (tab === 'incontri') return meetingsTab(body, base, { people: [{ name: personName(c), email: c.email, preset: true }], label: 'questo contatto' });
  if (tab === 'note') return notesTab(body, base, {});
  if (tab === 'progetti') return projectsTab(body, base, { newName: personName(c) });
  fill(body, contactSections(c, primary, refresh), h('div.cv-cols.w420',
    h('div.cv-stack', await timelineCard(base, { onOpenTab: go })),
    h('div.cv-stack',
      linkedToCard('contacts', c.id),
      h('section.cv-card.pad', workHistory(c.links)))));
}

// ── Nuovo contatto semplificato (18/11/2026, canvas «v8 · Nuovo contatto a mano, semplificato») ─────────────
// Un campo «Nome» («Ing. Mario Rossi», diviso da solo e mostrato in pillole), email, azienda con ricerca e «Crea "…"»
// (lead, owner tu, la tua ASA, «da completare»; con l'email l'azienda del dominio è suggerita in cima), cellulare.
// Basta un nome o un'email; il resto è in «Altri campi». Doppioni: avviso, non blocco. La modifica resta il modulo completo.
const NAME_TITLES = { ing: 'Ing.', ingegner: 'Ing.', ingegnere: 'Ing.', arch: 'Arch.', architetto: 'Arch.', geom: 'Geom.', geometra: 'Geom.', dott: 'Dott.', dottor: 'Dott.', dottore: 'Dott.',
  dottssa: 'Dott.ssa', dottoressa: 'Dott.ssa', avv: 'Avv.', avvocato: 'Avv.', rag: 'Rag.', prof: 'Prof.', sig: 'Sig.', signor: 'Sig.', sigra: 'Sig.ra', signora: 'Sig.ra' };
const NAME_PARTICLES = new Set(['de', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'da', 'dal', 'dalla', 'lo', 'la', 'van', 'von']);
const capWord = w => (w === w.toLowerCase() || w === w.toUpperCase() ? w.split(/([-'’])/).map(p => (p.length > 1 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join('') : w);
function splitNameUi(raw) { // come lib/crm-nomi.js (il server divide allo stesso modo, maiuscole comprese)
  let words = String(raw || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let title = '';
  while (words.length && NAME_TITLES[words[0].toLowerCase().replace(/[.\s]/g, '')]) title = title || NAME_TITLES[words.shift().toLowerCase().replace(/[.\s]/g, '')];
  words = words.map(capWord);
  if (!words.length) return { title, first: '', last: '' };
  if (words.length === 1) return { title, first: '', last: words[0] };
  let i = words.length - 1;
  while (i > 1 && NAME_PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return { title, first: words.slice(0, i).join(' '), last: words.slice(i).join(' ') };
}
async function quickContactForm({ preset = {}, onSaved }) {
  let chosen = null; // { id, name } oppure { create: 'Nome' }
  if (preset.subject_id) { const s = await get(`/api/crm/subjects/${preset.subject_id}`).catch(() => null); if (s) chosen = { id: s.id, name: s.name }; }
  let m, split = { title: '', first: '', last: '' }, byDomain = [];
  const nameIn = input({ value: [preset.first_name, preset.last_name].filter(Boolean).join(' '), placeholder: 'Ing. Mario Rossi', autofocus: true, 'aria-label': 'Nome' });
  const chips = h('div.cv-row.crm-namechips');
  const emailIn = input({ type: 'email', value: preset.email || '', placeholder: 'm.rossi@azienda.it' });
  const mobileIn = input({ value: '', placeholder: '347 …' });
  const companyIn = input({ placeholder: 'Scrivi il nome dell\'azienda o dell\'ente', 'aria-label': 'Azienda' });
  const list = h('div.crm-qlist', { hidden: true });
  const picked = h('div');
  const dup = h('div');
  const more = h('div', { hidden: true },
    h('div.en-row3', field('Qualifica', input({ 'data-k': 'job' })), field('Telefono', input({ 'data-k': 'phone' })), field('LinkedIn', input({ 'data-k': 'linkedin' }))),
    field('Note', textarea('', { 'data-k': 'notes' })));
  const toggleMore = h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => { more.hidden = !more.hidden; toggleMore.lastChild.textContent = more.hidden ? 'Altri campi (qualifica, telefono, LinkedIn, note)' : 'Meno campi'; } } },
    icon('chevron-down', { size: 14 }), h('span', 'Altri campi (qualifica, telefono, LinkedIn, note)'));
  const drawChips = () => {
    split = splitNameUi(nameIn.value);
    fill(chips, nameIn.value.trim() ? [split.title ? ['titolo', split.title] : null, split.first ? ['nome', split.first] : null, ['cognome', split.last]].filter(Boolean)
      .map(([l, v]) => h('span.cv-pill.line', `${l}: ${v}`)) : null);
  };
  // categoria dell'azienda nuova (Dante 22/11): non solo lead; più di una insieme, ma lead e cliente no
  const newRoles = new Set(['lead']);
  const rolesBox = h('div.crm-qroles', { hidden: true });
  const rolesText = () => [...newRoles].map(r => (data.meta.roles[r] || r).toLowerCase()).join(' e ');
  const drawRoles = () => {
    rolesBox.hidden = !(chosen?.create || (!chosen && companyIn.value.trim()));
    fill(rolesBox, h('span.cv-small.cv-muted', 'L\'azienda nuova è'), h('div.en-chips', Object.entries(data.meta.roles).map(([k, label]) => h('button.pill.en-chip', {
      type: 'button', class: newRoles.has(k) ? 'on' : '', 'aria-pressed': String(newRoles.has(k)),
      on: { click: () => {
        if (newRoles.has(k)) newRoles.delete(k); else { newRoles.add(k); if (k === 'lead') newRoles.delete('cliente'); if (k === 'cliente') newRoles.delete('lead'); }
        if (!newRoles.size) newRoles.add('lead');
        drawRoles(); if (chosen?.create) drawPicked();
      } } }, label))));
  };
  const drawPicked = () => {
    companyIn.hidden = Boolean(chosen);
    drawRoles();
    fill(picked, chosen ? h('div.cv-row.crm-qpicked', icon(chosen.create ? 'plus' : 'building', { size: 15 }),
      h('span.cv-grow', chosen.create ? `Nuova: «${chosen.create}» · ${rolesText()} · owner tu · tua ASA · da completare` : chosen.name),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Cambia azienda', on: { click: () => { chosen = null; drawPicked(); companyIn.focus(); } } }, icon('x', { size: 14 }))) : null);
  };
  const option = (title, sub, onPick, cls = '') => h(`button.crm-qopt${cls}`, { type: 'button', on: { click: () => { onPick(); list.hidden = true; drawPicked(); check(); } } }, h('span.cv-t5', title), sub ? h('span.cv-small.cv-muted', sub) : null);
  const search = debounce(async () => {
    const q = companyIn.value.trim();
    const { subjects = [] } = q.length >= 2 ? await get(`/api/crm/subjects${qs({ q })}`, { quiet: true }).catch(() => ({})) : {};
    const dom = byDomain.filter(s => !subjects.some(x => x.id === s.id));
    const opts = [...dom.map(s => option(s.name, `${(s.roles || []).join(', ')} · suggerita dal dominio dell'email`, () => { chosen = { id: s.id, name: s.name }; }, '.dom')),
      ...subjects.slice(0, 6).map(s => option(s.name, [(s.roles || []).join(', '), s.city].filter(Boolean).join(' · '), () => { chosen = { id: s.id, name: s.name }; })),
      ...(q ? [option(`Crea «${q}»`, 'nuova azienda: scegli sotto se è lead, cliente, fornitore, partner o concorrente', () => { chosen = { create: q }; }, '.new')] : [])];
    fill(list, opts);
    list.hidden = !opts.length;
  }, 250);
  companyIn.addEventListener('input', search);
  companyIn.addEventListener('input', drawRoles);
  companyIn.addEventListener('focus', search);
  const domain = debounce(async () => {
    const { subjects = [] } = emailIn.value.includes('@') ? await get(`/api/crm/subjects/da-email${qs({ email: emailIn.value })}`, { quiet: true }).catch(() => ({})) : {};
    byDomain = subjects;
    if (!chosen && byDomain.length === 1 && !companyIn.value.trim()) { companyIn.value = ''; fill(list, option(byDomain[0].name, 'suggerita dal dominio dell\'email: tocca per usarla', () => { chosen = { id: byDomain[0].id, name: byDomain[0].name }; }, '.dom')); list.hidden = false; }
  }, 400);
  emailIn.addEventListener('input', domain);
  const check = debounce(async () => {
    const s = splitNameUi(nameIn.value);
    const { matches = [] } = await get(`/api/crm/contacts/check${qs({ email: emailIn.value, first_name: s.first, last_name: s.last, subject_id: chosen?.id || '' })}`, { quiet: true }).catch(() => ({}));
    fill(dup, matches.length ? h('div.banner.crm-dup', 'C\'è già: ', matches.map((x, i) => [i ? ', ' : '', h('a', { href: `#/crm/contatti/${x.id}`, on: { click: () => m.close() } }, personName(x))]), ' · se è un\'altra persona, salva pure.') : null);
  }, 400);
  nameIn.addEventListener('input', () => { drawChips(); check(); });
  emailIn.addEventListener('input', check);
  drawChips(); drawPicked();
  const form = h('div.en-form',
    field('Nome', h('div', nameIn, chips), 'Scrivilo tutto insieme: titolo, nome e cognome si dividono da soli.'),
    field('Email', emailIn),
    field('Azienda', h('div.crm-qcompany', picked, companyIn, list, rolesBox),'Se non c\'è, la crea da sola quando salvi: P.IVA e città si aggiungono dopo.'),
    field('Cellulare', mobileIn),
    toggleMore, more, dup);
  m = cvModal({
    title: h('div', h('h2', 'Nuovo contatto'), h('p.cv-small.cv-muted', { style: { margin: '2px 0 0' } }, 'Basta un nome o un\'email: il resto si aggiunge dopo.')), body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async e => {
      const s = splitNameUi(nameIn.value);
      if (!s.last && !emailIn.value.trim()) { toast('Scrivi almeno il nome o l\'email'); nameIn.focus(); return; }
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const extra = read(more);
        // azienda scritta ma non scelta dall'elenco (Dante 19/11): la crea da sola, o usa quella che ha già lo stesso nome
        const typed = !chosen && companyIn.value.replace(/\s+/g, ' ').trim();
        let subjectId = chosen?.id || null, made = null;
        if (chosen?.create || typed) { made = await post('/api/crm/subjects/rapida', { name: chosen?.create || typed, roles: [...newRoles] }); subjectId = made.id; }
        const saved = await post('/api/crm/contacts', { title: s.title, first_name: s.first, last_name: s.last, email: emailIn.value.trim(), mobile: mobileIn.value.trim(),
          phone: extra.phone || '', linkedin: extra.linkedin || '', notes: extra.notes || '', links: subjectId ? [{ subject_id: subjectId, job: extra.job || '', is_primary: true }] : [] });
        m.close();
        toast(made && !made.existing ? `Contatto e «${made.name}» creati (azienda da completare)` : made ? `Contatto creato in «${made.name}»` : 'Contatto creato');
        onSaved?.(saved);
      } catch { btn.disabled = false; }
    } } }, icon('check', { size: 15 }), 'Salva')],
  });
}

async function contactForm({ contact = null, preset = {}, onSaved }) {
  if (!contact) return quickContactForm({ preset, onSaved });
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
      !people.length ? h('p.cv-small.cv-muted', 'Nessuno in quest\'ASA: aggiungi chi riceve segnali e promemoria.') : null,
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

// «+ Nuovo» della barra in alto (palette.js, canvas v10): contatto e azienda da qualsiasi pagina
export const newContact = () => contactForm({ onSaved: c => { location.hash = `#/crm/contatti/${c.id}`; } });
export const newSubject = () => subjectForm({ onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } });
