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

const TABS = [['lead', 'Lead'], ['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['partner', 'Partner e concorrenti'], ['tutte', 'Tutte le anagrafiche'], ['contatti', 'Contatti'], ['asa', 'ASA e accessi']];
const ROLE_OF_TAB = { lead: 'lead', clienti: 'cliente', fornitori: 'fornitore' };
const TAB_OF_ROLE = { lead: 'lead', cliente: 'clienti', fornitore: 'fornitori', partner: 'partner', concorrente: 'partner' };

let data = null; // meta, ASA, le mie ASA, numeri
const ASA_KEY = 'alma.crmAsa';
const readAsa = () => { try { return sessionStorage.getItem(ASA_KEY) || ''; } catch { return ''; } };
const saveAsa = k => { try { sessionStorage.setItem(ASA_KEY, k); } catch { /* niente */ } };
const currentAsa = () => { const k = readAsa(); return data.myAsa.includes(k) ? k : ''; };

const day = d => (d ? fmtDate(String(d).slice(0, 10), { year: true }) : '—');
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
    { 'aria-label': 'Owner', on: { change: e => { state.owner = e.target.value; load(); } } });
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
  if (!store.me.crm) return fill(container, h('div.card.empty', 'Il CRM è per la direzione e per chi è assegnato a un\'ASA. Chiedi alla direzione di aggiungerti.'));
  data = await get('/api/crm');
  if (parts[1] === 'scheda' && Number(parts[2])) return subjectPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'contatti' && Number(parts[2])) return contactPage(container, Number(parts[2]), parts[3]);
  if (parts[1] === 'incontro' && Number(parts[2])) { // dalla notifica «mancano le note»
    openCrmMeeting(Number(parts[2]));
    parts = ['crm', 'lead'];
  }
  const tab = TABS.some(([k]) => k === parts[1]) && (parts[1] !== 'asa' || data.admin) ? parts[1] : 'lead';
  const body = h('div.en-body', loading());
  const asaSel = data.myAsa.length > 1 && tab !== 'asa'
    ? select([['', data.admin ? 'Tutte le ASA' : 'Tutte le mie ASA'], ...data.myAsa.map(k => [k, asaLabel(k)])], currentAsa(),
      { 'aria-label': 'ASA', on: { change: e => { saveAsa(e.target.value); crmView(container, parts); } } })
    : null;
  fill(container,
    h('div.page-head', h('div', h('div.en-eyebrow', currentAsa() && tab !== 'asa' ? `Alma CRM · ${asaLabel(currentAsa())}` : 'Alma CRM'), h('h1', TABS.find(([k]) => k === tab)[1])), asaSel),
    body);
  if (tab === 'lead') await leadTab(body, parts[2]);
  else if (tab === 'contatti') await contactsTab(body);
  else if (tab === 'asa') await asaTab(body);
  else await subjectsTab(body, tab);
}

// ── lead: colonne per fase ──────────────────────────────────────────────────
async function leadTab(box, mode) {
  const state = { q: '', mode: mode === 'elenco' ? 'elenco' : 'colonne', owner: '', fn: '' };
  const content = h('div', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, P.IVA o comune…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      ...ownerFunctionFilters(state, () => load()),
      h('div.profile-tabs.crm-switch', [['colonne', 'Colonne'], ['elenco', 'Elenco']].map(([k, label]) => h('button', {
        type: 'button', class: state.mode === k ? 'on' : '', on: { click: e => { state.mode = k; [...e.currentTarget.parentElement.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); load(); } },
      }, label))),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: ['lead'] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } }, icon('plus', { size: 16 }), 'Nuovo lead')),
    content);
  async function load() {
    const { subjects } = await get(`/api/crm/subjects${qs({ role: 'lead', asa: currentAsa(), q: state.q, owner: state.owner, function: state.fn })}`);
    if (state.mode === 'elenco') return fill(content, subjectTable(subjects, 'lead', state.q));
    fill(content, h('div.en-board-wrap', h('div.en-board.crm-board', data.meta.leadStages.map(([stage, label]) => {
      const items = subjects.filter(s => s.lead_stage === stage);
      const col = h('div.en-col', { class: stage === 'non_interessato' ? 'lost' : '' },
        h('div.en-col-head', h('span', label), h('span.en-col-n', String(items.length))),
        stage === 'opportunita' ? h('div.en-col-sub', 'la trattativa si lavora in BOSS') : null,
        h('div.en-cards', items.length ? items.map(s => leadCard(s)) : h('div.en-col-more', 'Nessuno')));
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async e => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/crm-lead'));
        const s = subjects.find(x => x.id === id);
        if (s && s.lead_stage !== stage && await changeStage(s, stage)) load();
      });
      return col;
    }))));
  }
  await load();
}

function leadCard(s) {
  const card = h('div.en-card', { tabindex: 0, draggable: 'true', on: {
    click: () => { location.hash = `#/crm/scheda/${s.id}`; },
    keydown: e => { if (e.key === 'Enter') location.hash = `#/crm/scheda/${s.id}`; },
    dragstart: e => { e.dataTransfer.setData('text/crm-lead', String(s.id)); card.classList.add('dragging'); },
    dragend: () => card.classList.remove('dragging'),
  } },
  h('div.en-card-top', h('div.en-card-title.grow', s.name), s.missing_notes ? bang() : null, s.priority ? h('span.pill.crm-prio', { class: `crm-p-${s.priority}` }, data.meta.priorities[s.priority]) : null),
  h('div.en-card-meta', [s.city, s.potential_value ? eur(s.potential_value) : '', s.owner_name, s.function_name].filter(Boolean).join(' · ')),
  s.next_step ? h('div.t-meta', { class: late(s.next_step_date) ? 'due-late' : '' }, `${s.next_step}${s.next_step_date ? ` · ${day(s.next_step_date)}` : ''}`) : null);
  return card;
}

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
    const m = modal({
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
async function subjectsTab(box, tab) {
  const role = ROLE_OF_TAB[tab] || '';
  const state = { q: '', chip: tab === 'partner' ? 'partner' : '', owner: '', fn: '' };
  const chipDefs = tab === 'fornitori' ? [['', 'Tutte le categorie'], ...Object.entries(data.meta.supplierCategories)]
    : tab === 'partner' ? [['partner', 'Partner'], ['concorrente', 'Concorrenti']]
      : tab === 'tutte' ? [['', 'Tutti i ruoli'], ...Object.entries(data.meta.roles)] : null;
  const chips = h('div.en-chips');
  const list = h('div', loading());
  const newRole = tab === 'partner' ? () => state.chip : () => role || '';
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, P.IVA o comune…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      ...ownerFunctionFilters(state, () => load()),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: newRole() ? [newRole()] : [] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } },
        icon('plus', { size: 16 }), tab === 'clienti' ? 'Nuovo cliente' : tab === 'fornitori' ? 'Nuovo fornitore' : 'Nuova anagrafica')),
    chipDefs ? chips : null,
    tab === 'clienti' ? h('p.small.muted', 'Un lead diventa cliente da solo alla prima commessa in BOSS. Qui si aggiungono a mano solo i clienti che ci sono già.') : null,
    list);
  async function load() {
    if (chipDefs) fill(chips, chipDefs.map(([k, label]) => h('button.pill.en-chip', { type: 'button', class: state.chip === k ? 'on' : '', on: { click: () => { state.chip = k; load(); } } }, label)));
    const query = { asa: currentAsa(), q: state.q, role, owner: state.owner, function: state.fn };
    if (tab === 'fornitori') query.category = state.chip;
    else if (tab === 'partner' || tab === 'tutte') query.role = state.chip;
    const { subjects } = await get(`/api/crm/subjects${qs(query)}`);
    fill(list, subjectTable(subjects, tab, state.q || state.chip));
  }
  await load();
}

function subjectTable(subjects, tab, filtered) {
  if (!subjects.length) return h('div.card.empty', filtered ? 'Nessuna anagrafica con questi filtri.' : 'Ancora nessuna anagrafica qui.');
  const extra = tab === 'lead' ? ['Fase', 'Valore potenziale'] : tab === 'fornitori' ? ['Categorie'] : ['Ruoli'];
  return h('div.card.table-wrap', h('table.list',
    h('thead', h('tr', ['Anagrafica', ...extra, 'ASA', 'Luogo', 'Owner · funzione', 'Contatti', 'Prossimo passo'].map(t => h('th', t)))),
    h('tbody', subjects.map(s => h('tr', { on: { click: () => { location.hash = `#/crm/scheda/${s.id}`; } } },
      h('td', h('div.t-title', s.name, s.missing_notes ? bang() : null), h('div.t-meta', [data.meta.kinds[s.kind], s.vat && `P.IVA ${s.vat}`, s.status !== 'attivo' && data.meta.status[s.status]].filter(Boolean).join(' · '))),
      ...(tab === 'lead' ? [h('td', stageLabel(s.lead_stage)), h('td.num', eur(s.potential_value))]
        : tab === 'fornitori' ? [h('td', s.supplier_categories.map(c => data.meta.supplierCategories[c]).join(', ') || '—')]
          : [h('td', rolePills(s.roles))]),
      h('td', asaPills(s.asa)),
      h('td', [s.city, s.province].filter(Boolean).join(', ') || '—'),
      h('td', ownerLine(s)),
      h('td.num', String(s.contacts)),
      h('td', s.next_step ? h('div', s.next_step, h('div.t-meta', { class: late(s.next_step_date) ? 'due-late' : '' }, day(s.next_step_date))) : '—'))))));
}

// ── intestazione con tab e conteggi, uguale per azienda e contatto ──────────
function tabsBar(container, tabs, active, go) {
  return h('nav.profile-tabs.crm-tabs', { role: 'tablist' }, tabs.map(([k, label]) => h('button', {
    type: 'button', role: 'tab', class: k === active ? 'on' : '', 'aria-selected': String(k === active), 'data-tab': k, on: { click: () => go(k) },
  }, label)));
}
async function counts(base) {
  const [e, m, n, p] = await Promise.all([get(`${base}/emails`), get(`${base}/meetings`), get(`${base}/notes`), get(`${base}/projects`)].map(x => x.catch(() => [])));
  return { email: e.length, incontri: m.length, missing: m.filter(x => x.missing_notes).length, note: n.length, progetti: p.length };
}
const label = (name, n, warn) => [name, n ? ` (${n})` : '', warn ? bang() : null];

// ── scheda dell'azienda (artboard «Anagrafica · …» e «Scheda azienda · …») ───
async function subjectPage(container, id, tabKey) {
  const s = await get(`/api/crm/subjects/${id}`);
  if (s.merged_into) return fill(container, h('div.card.empty', 'Questa scheda è stata unita a ', h('a', { href: `#/crm/scheda/${s.merged_into}` }, s.merged_name), '.'));
  const base = `/api/crm/subjects/${id}`;
  const c = await counts(base);
  const back = TAB_OF_ROLE[s.roles[0]] || 'tutte';
  const active = s.contacts.filter(x => !x.date_to);
  const tabs = [['panoramica', 'Panoramica'], ['contatti', label('Contatti', active.length)], ['email', label('Email', c.email)], ['incontri', label('Incontri', c.incontri, c.missing)],
    ['note', label('Note', c.note)], ['progetti', label('Progetti', c.progetti)],
    ...(s.roles.includes('cliente') ? [['opportunita', 'Opportunità e gare'], ['commesse', 'Commesse']] : s.roles.includes('lead') ? [['opportunita', 'Opportunità']] : []),
    ...(s.roles.includes('fornitore') ? [['qualifica', 'Qualifica e documenti'], ['ordini', 'Ordini e subappalti']] : []),
    ...(s.roles.includes('partner') || s.roles.includes('concorrente') ? [['gare', 'Gare insieme e contro']] : [])];
  const tab = tabs.some(([k]) => k === tabKey) ? tabKey : 'panoramica';
  const refresh = (k = tab) => subjectPage(container, id, k);
  const go = k => { history.replaceState(null, '', `#/crm/scheda/${id}/${k}`); refresh(k); };
  const body = h('div');
  const more = h('div.crm-more');
  if (data.admin) {
    more.append(h('button.btn.btn-ghost', { type: 'button', on: { click: () => mergeForm(s) } }, 'Unisci a un\'altra scheda'),
      h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Cancellare «${s.name}» dal CRM? I contatti restano, i loro collegamenti a questa scheda si tolgono.`, { ok: 'Cancella', danger: true })) return;
        await del(base);
        location.hash = `#/crm/${back}`;
      } } }, 'Cancella'));
  }
  const kindLine = [s.roles.map(r => data.meta.roles[r]).join(' · '), data.meta.kinds[s.kind], s.vat && `P.IVA ${s.vat}`].filter(Boolean).join(' · ');
  fill(container,
    h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: `#/crm/${back}` }, icon('chevron-left', { size: 16 }), TABS.find(([k]) => k === back)[1])),
    h('div.page-head.crm-head',
      h('div', h('div.en-eyebrow', kindLine), h('h1', s.name),
        h('div.en-head-pills', rolePills(s.roles), asaPills(s.asa),
          s.client_since ? h('span.pill.crm-r-cliente', `Cliente dal ${s.client_since.slice(0, 4)}`) : null,
          h('span.pill.crm-owner', icon('user', { size: 12 }), `Owner ${s.owner_name || '—'}${s.function_name ? ` · ${s.function_name}` : ''}`),
          s.status !== 'attivo' ? h('span.pill.en-lost', data.meta.status[s.status]) : null)),
      h('div.crm-actions',
        h('button.btn', { type: 'button', on: { click: () => subjectForm({ subject: s, onSaved: () => refresh() }) } }, icon('pencil', { size: 15 }), 'Modifica'),
        more.childElementCount ? h('details.crm-menu', h('summary.btn.btn-ghost', { 'aria-label': 'Altro' }, icon('more', { size: 16 })), more) : null)),
    s.roles.includes('lead') ? stageBar(s, () => refresh()) : null,
    nextStepBox(s, () => refresh()),
    tabsBar(container, tabs, tab, go),
    body);
  const canWrite = true;
  const people = active.map(x => ({ name: personName(x), email: x.email, preset: x.is_primary }));
  if (tab === 'panoramica') await overviewTab(body, s, base, go);
  else if (tab === 'contatti') subjectContacts(body, s, () => refresh());
  else if (tab === 'email') emailsTab(body, base, { canWrite });
  else if (tab === 'incontri') meetingsTab(body, base, { canWrite, people, label: 'quest\'azienda' });
  else if (tab === 'note') notesTab(body, base, { isSubject: true });
  else if (tab === 'progetti') projectsTab(body, base, { canWrite, newName: s.short_name || s.name });
  else fill(body, placeholderTab(tab, s));
}

function placeholderTab(tab, s) {
  const text = {
    opportunita: ['Opportunità e offerte', 'Si lavorano in BOSS. Con il collegamento qui compariranno quelle di quest\'azienda (committente, partner o aggiudicatario), con un clic per aprirle e «Nuova opportunità» già compilata.'],
    commesse: ['Commesse', 'Arriveranno da BOSS: commesse aperte e chiuse di questo cliente, con valore e avanzamento.'],
    qualifica: ['Qualifica e documenti (da Vittoria)', 'Qualifica, DURC, SOA, white list, patente a crediti e gli altri documenti a scadenza si gestiscono in Vittoria. Con il collegamento (secondo passo) qui si vedranno lo stato e cosa scade.'],
    ordini: ['Ordini e subappalti', 'Arriveranno da BOSS, con il voto a fine lavoro.'],
    gare: ['Gare insieme e contro', 'Dalle opportunità di BOSS: le gare fatte in ATI con quest\'impresa e quelle che ci ha vinto.'],
  }[tab];
  return h('div.card.crm-pad', h('h3.crm-h3', text[0]), h('p', text[1]), h('p.small.muted', 'In arrivo con l\'integrazione.'));
}

function stageBar(s, refresh) {
  return h('div.crm-stages', { role: 'group', 'aria-label': 'Fase del lead' },
    data.meta.leadStages.map(([k, l]) => h('button.crm-stage', {
      type: 'button', class: [k === s.lead_stage ? 'on' : '', k === 'non_interessato' ? 'lost' : ''].join(' '), 'aria-pressed': String(k === s.lead_stage),
      on: { click: async () => { if (k !== s.lead_stage && await changeStage(s, k)) refresh(); } },
    }, l)),
    h('span.crm-stage.crm-stage-end', { title: 'Succede da solo alla prima commessa in BOSS' }, icon('check', { size: 14 }), 'Diventa cliente'),
    s.lead_stage === 'non_interessato' && s.lost_reason ? h('div.small.muted.crm-lost', `Motivo: ${s.lost_reason}${s.retry_date ? ` · riprovare il ${day(s.retry_date)}` : ''}`) : null);
}

// «Prossimo passo» sempre in alto: si cambia sul posto
function nextStepBox(s, refresh) {
  const text = input({ value: s.next_step || '', placeholder: 'Cosa fare (chiamare, mandare la presentazione…)', maxlength: 300 });
  const date = input({ type: 'date', value: s.next_step_date || '' });
  const save = async () => {
    if (text.value.trim() === (s.next_step || '') && (date.value || '') === (s.next_step_date || '')) return;
    await patch(`/api/crm/subjects/${s.id}`, { next_step: text.value, next_step_date: date.value || null });
    toast('Prossimo passo salvato');
    refresh();
  };
  text.addEventListener('change', save);
  date.addEventListener('change', save);
  return h('div.card.crm-next', { class: late(s.next_step_date) ? 'late' : '' }, h('span.crm-next-lab', icon('alarm-clock', { size: 16 }), 'Prossimo passo'), text, date);
}

// Panoramica: le informazioni della categoria su tre colonne, poi gli ultimi aggiornamenti
async function overviewTab(box, s, base, go) {
  const r = s.roles;
  const kpi = list => sec('Numeri', h('div.crm-kpis', list.map(([k, val]) => h('div.crm-kpi', h('span', k), h('strong', val)))), h('p.small.muted', 'da BOSS e da Target'));
  const col1 = [];
  if (r.includes('lead')) {
    col1.push(sec('Perché ci interessa', h('p.en-notes', s.lead_why || '—'), dlist([
      ['Segmento', s.segment || '—'], ['Valore potenziale', s.potential_value ? `${eur(s.potential_value)} l'anno` : '—'],
      ['Priorità', s.priority ? h('span.pill.crm-prio', { class: `crm-p-${s.priority}` }, data.meta.priorities[s.priority]) : '—'],
      ['Origine', s.origin || '—'], ['Segnalato da', s.referred_by || '—']])));
  }
  if (r.includes('cliente')) col1.push(sec('Cliente', dlist([['Segmento', s.segment || '—'], ['ASA', s.asa.map(asaLabel).join(', ')], ['Cliente dal', day(s.client_since)],
    ['Pagamenti', 'da Target'], ['Accordi quadro', 'da BOSS']])));
  if (r.includes('fornitore')) col1.push(sec('Fornitore', dlist([
    ['Categorie', s.supplier_categories.map(k => data.meta.supplierCategories[k]).join(', ') || '—'],
    ['Sottocategorie', s.supplier_subcategories.join(', ') || '—'],
    ['Zone servite', s.supplier_zones.map(provinceName).join(', ') || '—'], ['SOA', soaText(s.soa)], ['Codice Vittoria', s.vittoria_id || '—']])),
  sec('Qualifica (da Vittoria)', h('p.small.muted', 'Stato della qualifica e documenti a scadenza arriveranno da Vittoria.')));
  if (r.includes('partner') || r.includes('concorrente')) col1.push(sec(r.includes('partner') ? 'Come partner (ATI, RTI, avvalimento)' : 'Come concorrente', dlist([['Categorie SOA', soaText(s.soa)], ['Gare', 'da BOSS']])));
  if (s.history.length) col1.push(sec('Storico delle fasi', h('ul.en-history', s.history.map(x => h('li', h('strong', x.to_stage === 'cliente' ? 'Cliente' : stageLabel(x.to_stage)),
    h('div.t-meta', [new Date(x.at).toLocaleDateString('it-IT'), x.user_name, x.note].filter(Boolean).join(' · ')))))));
  const contactsLine = [s.pec && h('a', { href: `mailto:${s.pec}` }, `PEC ${s.pec}`), s.email && h('a', { href: `mailto:${s.email}` }, s.email), s.phone && h('a', { href: `tel:${s.phone}` }, s.phone), s.website].filter(Boolean);
  const col2 = [sec('Anagrafica', dlist([
    ['Owner', h('strong', s.owner_name || '—')], ['Funzione di riferimento', h('strong', s.function_name || '—')],
    ['Ragione sociale', s.name + (s.short_name ? ` (${s.short_name})` : '')], ['Tipo', `${data.meta.kinds[s.kind]}${s.legal_form ? ` · ${s.legal_form}` : ''}`],
    ['P.IVA', s.vat || '—'], ['Codice fiscale', s.tax_code || '—'], (s.kind === 'ente_pubblico' || s.ipa_code) && ['Codice IPA', s.ipa_code || '—'],
    ['Codice SDI', s.sdi_code || '—'], ['ATECO', s.ateco || '—'],
    ['Gruppo', s.group_id ? h('a', { href: `#/crm/scheda/${s.group_id}` }, s.group_name) : '—'],
    ['Sede', [s.address, s.city, s.province && `(${s.province})`, s.region].filter(Boolean).join(' ') || '—'],
    ['Contatti', contactsLine.length ? h('span', contactsLine.flatMap((x, i) => (i ? [' · ', x] : [x]))) : '—'],
    ['ASA', s.asa.map(asaLabel).join(', ')],
    ['Stato', data.meta.status[s.status] + (s.status === 'bloccato' && s.block_reason ? ` · ${s.block_reason}` : '')]]),
  s.notes ? h('p.en-notes.crm-notes', s.notes) : null),
  sec('Codici', dlist([['ID Alma Planet', String(s.id)], ['Codice BOSS', s.boss_code || '—'], ['Codice contabile (Target)', s.accounting_code || '—'], ['Codice Zoho (storico)', s.zoho_id || '—']]))];
  if (s.controlled.length) col2.push(sec('Società del gruppo', h('div.en-links', s.controlled.map(x => h('a.en-link', { href: `#/crm/scheda/${x.id}` }, x.name)))));
  const active = s.contacts.filter(x => !x.date_to);
  const col3 = [
    r.includes('cliente') ? kpi([['Commesse aperte', '—'], ['Portafoglio', '—'], ['Fatturato 12 mesi', '—'], ['Margine medio', '—'], ['Gare vinte', '—'], ['Ultimo contatto', '—']])
      : r.includes('fornitore') ? kpi([['Ordini 12 mesi', '—'], ['Speso 12 mesi', '—'], ['Voto medio', '—'], ['Commesse servite', '—']])
        : r.includes('lead') ? kpi([['Opportunità aperte', '—'], ['Valore potenziale', s.potential_value ? eur(s.potential_value) : '—'], ['Giorni nella fase', s.history[0] ? String(Math.max(0, Math.round((Date.now() - Date.parse(s.history[0].at)) / 86400000))) : '—'], ['Ultimo contatto', '—']])
          : kpi([['Gare insieme', '—'], ['Vinte insieme', '—'], ['Gare contro', '—'], ['Ribasso medio', '—']]),
    sec('Persone', active.length ? h('div.crm-lines', active.slice(0, 5).map(x => h('a.crm-line.crm-linkline', { href: `#/crm/contatti/${x.id}` },
      h('span.crm-ico', icon('user', { size: 15 })), h('div.grow', h('div.crm-line-t', personName(x)), h('div.t-meta', [x.job, x.is_primary && 'principale'].filter(Boolean).join(' · ')))))) : h('p.small.muted', 'Nessun contatto.')),
  ];
  fill(box, h('div.crm-cols', h('div.crm-col', col1), h('div.crm-col', col2), h('div.crm-col', col3)));
  box.append(await timelineCard(base, { onOpenTab: go }));
}

async function subjectContacts(box, s, refresh) {
  const current = s.contacts.filter(c => !c.date_to);
  const past = s.contacts.filter(c => c.date_to);
  const row = c => h('a.crm-line.crm-linkline', { href: `#/crm/contatti/${c.id}` },
    h('span.crm-ico', icon('user', { size: 15 })),
    h('div.grow', h('div.crm-line-t', personName(c)), h('div.t-meta', [c.job, c.is_primary && 'principale', c.date_to && `fino al ${day(c.date_to)}`].filter(Boolean).join(' · '))),
    h('span.small.muted', c.email || c.mobile || c.phone || ''));
  const proposals = await get(`/api/crm/subjects/${s.id}/proposals`).catch(() => []);
  fill(box, h('div.crm-grid',
    h('section.card.crm-pad', h('div.en-detail',
      h('div.crm-sec-row', h('h3.crm-h3', 'Persone'),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ preset: { subject_id: s.id }, onSaved: refresh }) } }, icon('plus', { size: 15 }), 'Nuovo contatto')),
      current.length ? h('div.crm-lines', current.map(row)) : h('p.muted.small', 'Nessun contatto. Aggiungi le persone da conoscere, con la loro qualifica.'),
      past.length ? h('section.en-sec', h('h3', 'Non ci lavorano più'), h('div.crm-lines', past.map(row))) : null)),
    proposals.length ? h('section.card.crm-pad.crm-dashed', h('h3.crm-h3', 'Proposti dagli incontri'),
      h('p.small.muted', 'Indirizzi di quest\'azienda visti negli incontri di Outlook, non ancora tra i contatti.'),
      h('div.crm-lines', proposals.map(p => h('div.crm-line', h('span.crm-ico', icon('user', { size: 15 })),
        h('div.grow', h('div.crm-line-t', p.name || p.email), h('div.t-meta', `${p.email}${p.meeting_subject ? ` · «${p.meeting_subject}»` : ''}`)),
        h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => {
          const [first, ...rest] = (p.name && !p.name.includes('@') ? p.name : '').split(' ');
          contactForm({ preset: { subject_id: s.id, email: p.email, first_name: rest.length ? first : '', last_name: rest.length ? rest.join(' ') : first || p.email.split('@')[0] }, onSaved: refresh });
        } } }, 'Crea contatto'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/proposals/${p.id}/dismiss`); refresh(); } } }, 'Ignora'))))) : null));
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
  m = modal({
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

async function mergeForm(s) {
  const { subjects } = await get('/api/crm/subjects');
  const target = select([['', 'Scegli la scheda buona…'], ...subjects.filter(x => x.id !== s.id).map(x => [x.id, `${x.name}${x.vat ? ` · ${x.vat}` : ''}`])], '');
  const m = modal({
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

// ── contatti ────────────────────────────────────────────────────────────────
async function contactsTab(box) {
  const state = { q: '' };
  const list = h('div', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome o email…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => contactForm({ onSaved: c => { location.hash = `#/crm/contatti/${c.id}`; } }) } }, icon('plus', { size: 16 }), 'Nuovo contatto')),
    list);
  async function load() {
    const { contacts } = await get(`/api/crm/contacts${qs({ q: state.q, asa: currentAsa() })}`);
    if (!contacts.length) return fill(list, h('div.card.empty', state.q ? 'Nessun contatto con questa ricerca.' : 'Ancora nessun contatto. Le persone si aggiungono di solito dalla scheda della loro azienda.'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Persona', 'Dove lavora', 'Email', 'Telefono', 'Owner'].map(t => h('th', t)))),
      h('tbody', contacts.map(c => h('tr', { on: { click: () => { location.hash = `#/crm/contatti/${c.id}`; } } },
        h('td', h('div.t-title', personName(c)), c.status !== 'attivo' ? h('div.t-meta', data.meta.contactStatus[c.status]) : null),
        h('td', c.links.filter(l => !l.date_to).map(l => h('div', l.name, l.job ? h('span.t-meta', ` · ${l.job}`) : null))),
        h('td', c.email || '—'), h('td', c.mobile || c.phone || '—'), h('td', c.owner_name || '—')))))));
  }
  await load();
}

// Scheda del contatto: stessi tab dell'azienda; quello che si collega qui ricade sulle aziende dove lavora
async function contactPage(container, id, tabKey) {
  const c = await get(`/api/crm/contacts/${id}`);
  const base = `/api/crm/contacts/${id}`;
  const n = await counts(base);
  const tabs = [['panoramica', 'Panoramica'], ['email', label('Email', n.email)], ['incontri', label('Incontri', n.incontri, n.missing)], ['note', label('Note', n.note)], ['progetti', label('Progetti', n.progetti)]];
  const tab = tabs.some(([k]) => k === tabKey) ? tabKey : 'panoramica';
  const refresh = (k = tab) => contactPage(container, id, k);
  const go = k => { history.replaceState(null, '', `#/crm/contatti/${id}/${k}`); refresh(k); };
  const body = h('div');
  const primary = c.links.find(l => l.is_primary && !l.date_to) || c.links.find(l => !l.date_to);
  fill(container,
    h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: '#/crm/contatti' }, icon('chevron-left', { size: 16 }), 'Contatti')),
    h('div.page-head.crm-head',
      h('div', h('div.en-eyebrow', ['Contatto', primary?.job, primary?.name].filter(Boolean).join(' · ')), h('h1', personName(c)),
        h('div.en-head-pills', c.email ? h('a.pill', { href: `mailto:${c.email}` }, c.email) : null, c.mobile ? h('a.pill', { href: `tel:${c.mobile}` }, c.mobile) : null,
          c.status !== 'attivo' ? h('span.pill.en-lost', data.meta.contactStatus[c.status]) : null)),
      h('div.crm-actions',
        h('button.btn', { type: 'button', on: { click: () => contactForm({ contact: c, onSaved: () => refresh() }) } }, icon('pencil', { size: 15 }), 'Modifica'),
        data.admin || c.created_by === store.me.id ? h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
          if (!await confirmDialog(`Cancellare ${personName(c)} dal CRM?`, { ok: 'Cancella', danger: true })) return;
          await del(base);
          location.hash = '#/crm/contatti';
        } } }, 'Cancella') : null)),
    tabsBar(container, tabs, tab, go),
    body);
  if (tab === 'email') return emailsTab(body, base, {});
  if (tab === 'incontri') return meetingsTab(body, base, { people: [{ name: personName(c), email: c.email, preset: true }], label: 'questo contatto' });
  if (tab === 'note') return notesTab(body, base, {});
  if (tab === 'progetti') return projectsTab(body, base, { newName: personName(c) });
  fill(body, h('div.crm-cols',
    h('div.crm-col', sec('Persona', dlist([
      ['Nome', personName(c)], ['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : '—'],
      ['Cellulare · telefono', [c.mobile && h('a', { href: `tel:${c.mobile}` }, c.mobile), c.phone].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])).length ? h('span', [c.mobile && h('a', { href: `tel:${c.mobile}` }, c.mobile), c.phone].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))) : '—'],
      ['LinkedIn', c.linkedin || '—'], ['Lingua', c.language || '—'], ['Owner', c.owner_name || '—'], ['Stato', data.meta.contactStatus[c.status]],
      ['Privacy', `${data.meta.legalBasis[c.legal_basis]}${c.newsletter ? ' · consenso alle comunicazioni' : ''}`]]), c.notes ? h('p.en-notes.crm-notes', c.notes) : null)),
    h('div.crm-col', sec('Dove lavora', c.links.length ? h('div.crm-lines', c.links.map(l => h('a.crm-line.crm-linkline', { href: `#/crm/scheda/${l.subject_id}`, class: l.date_to ? 'past' : '' },
      h('span.crm-ico', icon('building', { size: 15 })),
      h('div.grow', h('div.crm-line-t', l.name), h('div.t-meta', [l.job, l.is_primary && 'principale', l.roles.map(r => data.meta.roles[r]).join(', '),
        l.date_to ? `fino al ${day(l.date_to)}` : l.date_from ? `dal ${day(l.date_from)}` : ''].filter(Boolean).join(' · ')))))) : h('p.muted.small', 'Non è collegato a nessuna anagrafica.'))),
    h('div.crm-col')));
  body.lastChild.lastChild.append(await timelineCard(base, { onOpenTab: go }));
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
  m = modal({
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

// ── ASA e accessi (direzione) ───────────────────────────────────────────────
async function asaTab(box) {
  const { asa } = await get('/api/crm/asa');
  const emails = h('datalist', { id: 'crm-users' }, store.users.map(u => h('option', { value: u.email }, u.name)));
  fill(box,
    h('p.muted', 'Chi è di un\'ASA vede nel CRM solo le anagrafiche della sua ASA; la direzione (amministratori di Alma Planet) le vede tutte. I membri di Alma Energy sono dell\'ASA Energy.'),
    emails,
    h('div.crm-asa-grid', asa.map(a => {
      const mail = input({ type: 'email', placeholder: 'email@almacis.it', list: 'crm-users' });
      return h('section.card.crm-pad.crm-asa-card',
        h('div.en-sec-head', h('h3.crm-h3', a.label), a.boss_label ? h('span.small.muted', `in BOSS: ${a.boss_label}`) : null),
        a.key === 'energy' && a.energyMembers.length ? h('div.small.muted', `Da Alma Energy: ${a.energyMembers.map(x => x.name || x.email).join(', ')}`) : null,
        h('div.en-chips', a.members.map(x => h('span.pill.crm-member', x.name || x.email,
          h('button.crm-x', { type: 'button', 'aria-label': `Togli ${x.name || x.email}`, on: { click: async () => {
            await del(`/api/crm/asa/${a.key}/members/${encodeURIComponent(x.email)}`);
            asaTab(box);
          } } }, icon('x', { size: 13 }))))),
        h('form.crm-add', { on: { submit: async e => {
          e.preventDefault();
          await post(`/api/crm/asa/${a.key}/members`, { email: mail.value });
          asaTab(box);
        } } }, mail, h('button.btn.btn-sm', { type: 'submit' }, icon('plus', { size: 15 }), 'Aggiungi')));
    })),
    h('form.card.crm-pad.crm-add', { on: { submit: async e => {
      e.preventDefault();
      await post('/api/crm/asa', { label: e.currentTarget.querySelector('input').value });
      toast('ASA creata');
      asaTab(box);
    } } }, input({ placeholder: 'Nome della nuova ASA', maxlength: 60 }), h('button.btn', { type: 'submit' }, icon('plus', { size: 15 }), 'Nuova ASA')));
}
