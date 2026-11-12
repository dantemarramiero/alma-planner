// Alma CRM: anagrafiche uniche (Lead, Clienti, Fornitori, Partner, Concorrenti) e contatti, per ASA.
// Canvas «CRM Alma Planet – anagrafiche» (12/11/2026): un soggetto = una scheda con più ruoli; i contatti stanno in
// più soggetti con la loro qualifica; chi è di un'ASA vede solo le anagrafiche della sua, la direzione tutte.
// Il lead diventa cliente da solo alla prima commessa in BOSS; opportunità in BOSS, qualifiche fornitori in Vittoria.
import { h, fill, modal, confirmDialog, toast, fmtDate, loading, debounce } from './ui.js';
import { get, post, patch, del, qs } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';

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

export async function crmView(container, parts = []) {
  if (!store.me.crm) return fill(container, h('div.card.empty', 'Il CRM è per la direzione e per chi è assegnato a un\'ASA. Chiedi alla direzione di aggiungerti.'));
  data = await get('/api/crm');
  if (parts[1] === 'scheda' && Number(parts[2])) return subjectPage(container, Number(parts[2]), parts[3]);
  const tab = TABS.some(([k]) => k === parts[1]) && (parts[1] !== 'asa' || data.admin) ? parts[1] : 'lead';
  const body = h('div.en-body', loading());
  // selettore dell'ASA: «Tutte le mie» oppure una sola; resta per la sessione
  const asaSel = data.myAsa.length > 1 && tab !== 'asa'
    ? select([['', data.admin ? 'Tutte le ASA' : 'Tutte le mie ASA'], ...data.myAsa.map(k => [k, asaLabel(k)])], currentAsa(),
      { 'aria-label': 'ASA', on: { change: e => { saveAsa(e.target.value); crmView(container, parts); } } })
    : null;
  fill(container,
    h('div.page-head', h('div', h('div.en-eyebrow', currentAsa() && tab !== 'asa' ? `Alma CRM · ${asaLabel(currentAsa())}` : 'Alma CRM'), h('h1', TABS.find(([k]) => k === tab)[1])), asaSel),
    body);
  if (tab === 'lead') await leadTab(body, parts[2]);
  else if (tab === 'contatti') await contactsTab(body, parts[2]);
  else if (tab === 'asa') await asaTab(body);
  else await subjectsTab(body, tab);
}

// ── lead: colonne per fase ──────────────────────────────────────────────────
async function leadTab(box, mode) {
  const state = { q: '', mode: mode === 'elenco' ? 'elenco' : 'colonne' };
  const content = h('div', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, P.IVA o comune…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('div.profile-tabs.crm-switch', [['colonne', 'Colonne'], ['elenco', 'Elenco']].map(([k, label]) => h('button', {
        type: 'button', class: state.mode === k ? 'on' : '', on: { click: e => { state.mode = k; [...e.currentTarget.parentElement.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); load(); } },
      }, label))),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: ['lead'] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } }, icon('plus', { size: 16 }), 'Nuovo lead')),
    content);
  async function load() {
    const { subjects } = await get(`/api/crm/subjects${qs({ role: 'lead', asa: currentAsa(), q: state.q })}`);
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
  h('div.en-card-top', h('div.en-card-title.grow', s.name), s.priority ? h('span.pill.crm-prio', { class: `crm-p-${s.priority}` }, data.meta.priorities[s.priority]) : null),
  h('div.en-card-meta', [s.city, s.potential_value ? eur(s.potential_value) : '', s.owner_name].filter(Boolean).join(' · ')),
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
  const state = { q: '', chip: tab === 'partner' ? 'partner' : '' };
  // filtri a pillole: categorie per i fornitori, partner/concorrenti, ruoli per «Tutte»
  const chipDefs = tab === 'fornitori' ? [['', 'Tutte le categorie'], ...Object.entries(data.meta.supplierCategories)]
    : tab === 'partner' ? [['partner', 'Partner'], ['concorrente', 'Concorrenti']]
      : tab === 'tutte' ? [['', 'Tutti i ruoli'], ...Object.entries(data.meta.roles)] : null;
  const chips = h('div.en-chips');
  const list = h('div', loading());
  const newRole = tab === 'partner' ? () => state.chip : () => role || '';
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome, P.IVA o comune…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => subjectForm({ preset: { roles: newRole() ? [newRole()] : [] }, onSaved: s => { location.hash = `#/crm/scheda/${s.id}`; } }) } },
        icon('plus', { size: 16 }), tab === 'clienti' ? 'Nuovo cliente' : tab === 'fornitori' ? 'Nuovo fornitore' : 'Nuova anagrafica')),
    chipDefs ? chips : null,
    tab === 'clienti' ? h('p.small.muted', 'Un lead diventa cliente da solo alla prima commessa in BOSS. Qui si aggiungono a mano solo i clienti che ci sono già.') : null,
    list);
  async function load() {
    if (chipDefs) fill(chips, chipDefs.map(([k, label]) => h('button.pill.en-chip', { type: 'button', class: state.chip === k ? 'on' : '', on: { click: () => { state.chip = k; load(); } } }, label)));
    const query = { asa: currentAsa(), q: state.q, role };
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
    h('thead', h('tr', ['Anagrafica', ...extra, 'ASA', 'Luogo', 'Responsabile', 'Contatti', 'Prossimo passo'].map(t => h('th', t)))),
    h('tbody', subjects.map(s => h('tr', { on: { click: () => { location.hash = `#/crm/scheda/${s.id}`; } } },
      h('td', h('div.t-title', s.name), h('div.t-meta', [data.meta.kinds[s.kind], s.vat && `P.IVA ${s.vat}`, s.status !== 'attivo' && data.meta.status[s.status]].filter(Boolean).join(' · '))),
      ...(tab === 'lead' ? [h('td', stageLabel(s.lead_stage)), h('td.num', eur(s.potential_value))]
        : tab === 'fornitori' ? [h('td', s.supplier_categories.map(c => data.meta.supplierCategories[c]).join(', ') || '—')]
          : [h('td', rolePills(s.roles))]),
      h('td', asaPills(s.asa)),
      h('td', [s.city, s.province].filter(Boolean).join(', ') || '—'),
      h('td', s.owner_name || '—'),
      h('td.num', String(s.contacts)),
      h('td', s.next_step ? h('div', s.next_step, h('div.t-meta', { class: late(s.next_step_date) ? 'due-late' : '' }, day(s.next_step_date))) : '—'))))));
}

// ── scheda del soggetto ─────────────────────────────────────────────────────
async function subjectPage(container, id, tabKey) {
  const s = await get(`/api/crm/subjects/${id}`);
  if (s.merged_into) {
    return fill(container, h('div.card.empty', 'Questa scheda è stata unita a ', h('a', { href: `#/crm/scheda/${s.merged_into}` }, s.merged_name), '.'));
  }
  const back = TAB_OF_ROLE[s.roles[0]] || 'tutte';
  const tabs = [['panoramica', 'Panoramica'], ['contatti', `Contatti (${s.contacts.filter(c => !c.date_to).length})`], ['attivita', `Attività (${s.activities.length})`], ['opportunita', 'Opportunità'],
    ...(s.roles.includes('fornitore') ? [['fornitore', 'Come fornitore']] : [])];
  const tab = tabs.some(([k]) => k === tabKey) ? tabKey : 'panoramica';
  const refresh = () => subjectPage(container, id, tab);
  const body = h('div');
  const more = h('div.crm-more');
  if (data.admin) {
    more.append(h('button.btn.btn-ghost', { type: 'button', on: { click: () => mergeForm(s) } }, 'Unisci a un\'altra scheda'),
      h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Cancellare «${s.name}» dal CRM? I contatti restano, i loro collegamenti a questa scheda si tolgono.`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/crm/subjects/${id}`);
        location.hash = `#/crm/${back}`;
      } } }, 'Cancella'));
  }
  fill(container,
    h('nav.pj-top', { 'aria-label': 'Percorso' }, h('a.pj-crumb', { href: `#/crm/${back}` }, icon('chevron-left', { size: 16 }), TABS.find(([k]) => k === back)[1])),
    h('div.page-head.crm-head',
      h('div', h('div.en-eyebrow', [data.meta.kinds[s.kind], s.vat && `P.IVA ${s.vat}`].filter(Boolean).join(' · ')),
        h('h1', s.name),
        h('div.en-head-pills', rolePills(s.roles), asaPills(s.asa), s.status !== 'attivo' ? h('span.pill.en-lost', data.meta.status[s.status]) : null)),
      h('div.crm-actions',
        h('button.btn', { type: 'button', on: { click: () => subjectForm({ subject: s, onSaved: refresh }) } }, icon('pencil', { size: 15 }), 'Modifica'),
        more.childElementCount ? h('details.crm-menu', h('summary.btn.btn-ghost', { 'aria-label': 'Altro' }, icon('more', { size: 16 })), more) : null)),
    s.roles.includes('lead') ? stageBar(s, refresh) : null,
    nextStepBox(s, refresh),
    h('nav.profile-tabs.crm-tabs', { role: 'tablist' }, tabs.map(([k, label]) => h('button', {
      type: 'button', role: 'tab', class: k === tab ? 'on' : '', 'aria-selected': String(k === tab),
      on: { click: () => { history.replaceState(null, '', `#/crm/scheda/${id}/${k}`); subjectPage(container, id, k); } },
    }, label))),
    body);
  if (tab === 'panoramica') overviewTab(body, s);
  else if (tab === 'contatti') subjectContacts(body, s, refresh);
  else if (tab === 'attivita') fill(body, activityBox({ subject: s, activities: s.activities, onChange: refresh }));
  else if (tab === 'opportunita') fill(body, h('div.card.crm-pad',
    h('h3.crm-h3', 'Opportunità e offerte'),
    h('p', 'Le opportunità e le offerte si lavorano in BOSS. Con il collegamento qui compariranno quelle di questa anagrafica (come committente, partner o aggiudicatario), con un clic per aprirle in BOSS e «Nuova opportunità» già compilata.'),
    h('p.small.muted', 'In arrivo con l\'integrazione con BOSS.')));
  else fill(body, h('div.card.crm-pad', h('div.en-detail',
    h('section.en-sec', h('h3', 'Categorie e zone'), dlist([
      ['Categorie', s.supplier_categories.map(c => data.meta.supplierCategories[c]).join(', ') || '—'],
      ['Zone servite', s.supplier_zones || '—'],
      ['Codice Vittoria', s.vittoria_id || '—'],
    ])),
    h('section.en-sec', h('h3', 'Qualifica e documenti'),
      h('p', 'Qualifica, DURC, SOA, white list, patente a crediti e gli altri documenti a scadenza si gestiscono in Vittoria. Con il collegamento (secondo passo) qui si vedranno lo stato della qualifica e cosa scade.')))));
}

const dlist = pairs => h('dl.en-dl', pairs.flatMap(([k, val]) => [h('dt', k), h('dd', val)]));

function stageBar(s, refresh) {
  return h('div.crm-stages', { role: 'group', 'aria-label': 'Fase del lead' },
    data.meta.leadStages.map(([k, label]) => h('button.crm-stage', {
      type: 'button', class: [k === s.lead_stage ? 'on' : '', k === 'non_interessato' ? 'lost' : ''].join(' '), 'aria-pressed': String(k === s.lead_stage),
      on: { click: async () => { if (k !== s.lead_stage && await changeStage(s, k)) refresh(); } },
    }, label)),
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

function overviewTab(box, s) {
  const isLead = s.roles.includes('lead');
  fill(box, h('div.crm-grid',
    h('section.card.crm-pad', h('div.en-detail',
      isLead ? h('section.en-sec', h('h3', 'Perché ci interessa'), h('p.en-notes', s.lead_why || '—'), dlist([
        ['Valore potenziale', s.potential_value ? `${eur(s.potential_value)} l'anno` : '—'], ['Priorità', data.meta.priorities[s.priority] || '—'],
        ['Origine', s.origin || '—'], ['Segnalato da', s.referred_by || '—'],
      ])) : null,
      h('section.en-sec', h('h3', 'Anagrafica'), dlist([
        ['Ragione sociale', s.name + (s.short_name ? ` (${s.short_name})` : '')], ['Tipo', `${data.meta.kinds[s.kind]}${s.legal_form ? ` · ${s.legal_form}` : ''}`],
        ['P.IVA', s.vat || '—'], ['Codice fiscale', s.tax_code || '—'],
        ...(s.kind === 'ente_pubblico' || s.ipa_code ? [['Codice IPA', s.ipa_code || '—']] : []),
        ['Codice SDI', s.sdi_code || '—'], ['Segmento', s.segment || '—'], ['ATECO', s.ateco || '—'],
        ['Gruppo', s.group_id ? h('a', { href: `#/crm/scheda/${s.group_id}` }, s.group_name) : '—'],
        ['Sede', [s.address, s.city, s.province, s.region].filter(Boolean).join(', ') || '—'],
        ['Contatti', s.pec || s.email || s.phone || s.website ? h('span', [s.pec && h('a', { href: `mailto:${s.pec}` }, `PEC ${s.pec}`), s.email && h('a', { href: `mailto:${s.email}` }, s.email), s.phone && h('a', { href: `tel:${s.phone}` }, s.phone), s.website].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))) : '—'],
        ['Responsabile', s.owner_name || '—'], ['Stato', data.meta.status[s.status] + (s.status === 'bloccato' && s.block_reason ? ` · ${s.block_reason}` : '')],
        ...(s.client_since ? [['Cliente dal', day(s.client_since)]] : []),
      ])),
      s.notes ? h('section.en-sec', h('h3', 'Note'), h('p.en-notes', s.notes)) : null,
      s.controlled.length ? h('section.en-sec', h('h3', 'Società del gruppo'), h('div.en-links', s.controlled.map(x => h('a.en-link', { href: `#/crm/scheda/${x.id}` }, x.name)))) : null,
      h('section.en-sec', h('h3', 'Codici'), dlist([['ID Alma Planet', String(s.id)], ['Codice BOSS', s.boss_code || '—'], ['Codice contabile (Target)', s.accounting_code || '—'], ['Codice Zoho', s.zoho_id || '—']])))),
    h('div.crm-side',
      h('section.card.crm-pad', h('h3.crm-h3', 'Numeri'), h('div.crm-kpis',
        ['Commesse aperte', 'Portafoglio', 'Fatturato 12 mesi', 'Gare vinte'].map(l => h('div.crm-kpi', h('span', l), h('strong', '—')))),
      h('p.small.muted', 'Arriveranno da BOSS e da Target.')),
      h('section.card.crm-pad', h('h3.crm-h3', 'Persone principali'), s.contacts.filter(c => !c.date_to).slice(0, 4).length
        ? h('div.en-links', s.contacts.filter(c => !c.date_to).slice(0, 4).map(c => h('button.en-link.crm-linkbtn', { type: 'button', on: { click: () => openContact(c.id) } },
          h('div.grow', h('strong', personName(c)), h('div.t-meta', [c.job, c.is_primary && 'principale'].filter(Boolean).join(' · '))))))
        : h('p.small.muted', 'Nessun contatto.')),
      s.history.length ? h('section.card.crm-pad', h('h3.crm-h3', 'Storico delle fasi'), h('ul.en-history', s.history.map(x => h('li',
        h('strong', x.to_stage === 'cliente' ? 'Cliente' : stageLabel(x.to_stage)),
        h('div.t-meta', [new Date(x.at).toLocaleDateString('it-IT'), x.user_name, x.note].filter(Boolean).join(' · ')))))) : null)));
}

function subjectContacts(box, s, refresh) {
  const current = s.contacts.filter(c => !c.date_to);
  const past = s.contacts.filter(c => c.date_to);
  const row = c => h('button.en-link.crm-linkbtn', { type: 'button', on: { click: () => openContact(c.id, refresh) } },
    h('div.grow', h('strong', personName(c)), h('div.t-meta', [c.job, c.is_primary && 'principale', c.date_to && `fino al ${day(c.date_to)}`].filter(Boolean).join(' · '))),
    h('span.small.muted', c.email || c.mobile || c.phone || ''));
  fill(box, h('div.card.crm-pad', h('div.en-detail',
    h('div.en-sec-head', h('h3.crm-h3', 'Persone'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => contactForm({ preset: { subject_id: s.id }, onSaved: refresh }) } }, icon('plus', { size: 15 }), 'Nuovo contatto')),
    current.length ? h('div.en-links', current.map(row)) : h('p.muted.small', 'Nessun contatto. Aggiungi le persone da conoscere, con la loro qualifica.'),
    past.length ? h('section.en-sec', h('h3', 'Non ci lavorano più'), h('div.en-links', past.map(row))) : null)));
}

// ── attività ────────────────────────────────────────────────────────────────
function activityBox({ subject = null, contact = null, activities, onChange }) {
  const kind = select(Object.entries(data.meta.activityKinds), 'nota');
  const on = input({ type: 'date', value: new Date().toISOString().slice(0, 10) });
  const text = textarea('', { placeholder: 'Cosa è successo: chiamata, incontro, email…', maxlength: 5000 });
  const ico = { nota: 'file-text', chiamata: 'phone', email: 'mail', incontro: 'users' };
  return h('div.card.crm-pad', h('div.en-detail',
    h('div.crm-composer', h('div.crm-composer-row', kind, on), text,
      h('div', h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => {
        if (!text.value.trim()) return toast('Scrivi il testo', 'err');
        await post('/api/crm/activities', { subject_id: subject?.id || null, contact_id: contact?.id || null, kind: kind.value, happened_on: on.value, body: text.value });
        toast('Attività salvata');
        onChange?.();
      } } }, 'Aggiungi'))),
    activities.length ? h('ul.crm-timeline', activities.map(a => h('li',
      h('span.crm-tl-ico', icon(ico[a.kind] || 'file-text', { size: 15 })),
      h('div.grow',
        h('div.t-meta', [data.meta.activityKinds[a.kind], day(a.happened_on), a.user_name, a.first_name || a.last_name ? `con ${[a.first_name, a.last_name].filter(Boolean).join(' ')}` : '', a.subject_name && !subject ? a.subject_name : ''].filter(Boolean).join(' · ')),
        h('p.en-notes', a.body)),
      data.admin || a.user_id === store.me.id ? h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Cancella', on: { click: async () => {
        if (!await confirmDialog('Cancellare questa attività?', { ok: 'Cancella', danger: true })) return;
        await del(`/api/crm/activities/${a.id}`);
        onChange?.();
      } } }, icon('trash', { size: 15 })) : null)))
      : h('p.muted.small', 'Ancora nessuna attività.')));
}

// ── modulo del soggetto ─────────────────────────────────────────────────────
async function subjectForm({ subject = null, preset = {}, onSaved }) {
  const s = subject || { kind: 'impresa', status: 'attivo', roles: preset.roles || [], asa: currentAsa() ? [currentAsa()] : data.myAsa.length === 1 ? [data.myAsa[0]] : [], supplier_categories: [] };
  const { subjects: others } = await get('/api/crm/subjects');
  const leadBox = h('div');
  const supplierBox = h('div');
  const wasLead = Boolean(subject?.roles.includes('lead'));
  const roles = chipSet(Object.entries(data.meta.roles), s.roles, {
    disabled: k => (k === 'cliente' && wasLead && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS' : false),
    onChange: (vals, k) => {
      // Lead oppure Cliente, non tutti e due
      const other = k === 'lead' ? 'cliente' : k === 'cliente' ? 'lead' : null;
      if (other && vals.has(k) && vals.has(other)) {
        vals.delete(other);
        const b = [...roles.el.children].find(x => x.textContent === data.meta.roles[other]);
        b?.classList.remove('on');
        b?.setAttribute('aria-pressed', 'false');
      }
      drawBlocks();
    },
  });
  const asa = chipSet(data.asa.map(a => [a.key, a.label]), s.asa);
  const cats = chipSet(Object.entries(data.meta.supplierCategories), s.supplier_categories);
  const leadFields = h('div.en-type-block', h('div.en-type-title', 'Lead'),
    field('Perché ci interessa', textarea(s.lead_why, { 'data-k': 'lead_why', placeholder: 'Due righe: lavori che fa, zona, cosa potremmo fare per lui' })),
    h('div.en-row3',
      field('Valore potenziale (€ l\'anno)', input({ 'data-k': 'potential_value', value: s.potential_value === null || s.potential_value === undefined ? '' : Number(s.potential_value).toLocaleString('it-IT'), inputmode: 'decimal' })),
      field('Priorità', select([['', '—'], ...Object.entries(data.meta.priorities)], s.priority, { 'data-k': 'priority' })),
      field('Origine', select([['', '—'], ...data.meta.origins.map(o => [o, o])], s.origin, { 'data-k': 'origin' }))),
    field('Segnalato da', input({ 'data-k': 'referred_by', value: s.referred_by || '', placeholder: 'Contatto o collega che ci ha portato il nome' })));
  const supplierFields = h('div.en-type-block', h('div.en-type-title', 'Fornitore'),
    field('Categorie', cats.el),
    field('Zone servite', input({ 'data-k': 'supplier_zones', value: s.supplier_zones || '', placeholder: 'Province o raggio dalla sede' })),
    h('p.small.muted', 'Qualifica e documenti si gestiscono in Vittoria.'));
  function drawBlocks() {
    fill(leadBox, roles.values.has('lead') ? leadFields : null);
    fill(supplierBox, roles.values.has('fornitore') ? supplierFields : null);
  }
  drawBlocks();
  const dup = h('div');
  const nameIn = input({ 'data-k': 'name', value: s.name || '', maxlength: 200, autofocus: true });
  const vatIn = input({ 'data-k': 'vat', value: s.vat || '', maxlength: 20 });
  const taxIn = input({ 'data-k': 'tax_code', value: s.tax_code || '', maxlength: 20 });
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
  const form = h('div.en-form',
    h('div.en-row2', field('Ragione sociale', nameIn), field('Nome breve', input({ 'data-k': 'short_name', value: s.short_name || '', placeholder: 'Per le liste' }))),
    h('div.en-row3', field('P.IVA', vatIn), field('Codice fiscale', taxIn), field('Tipo', select(Object.entries(data.meta.kinds), s.kind, { 'data-k': 'kind' }))),
    dup,
    field('Ruoli', roles.el, wasLead && !data.admin ? 'Un lead diventa cliente da solo alla prima commessa in BOSS.' : 'Un\'anagrafica può avere più ruoli: Lead oppure Cliente, e anche Fornitore, Partner, Concorrente.'),
    field('ASA', asa.el, data.admin ? 'Chi è di un\'ASA vede solo le anagrafiche della sua.' : 'Tieni almeno una delle tue ASA, sennò non vedrai più la scheda.'),
    leadBox, supplierBox,
    h('div.en-row3',
      field('Segmento', select(segments, s.segment, { 'data-k': 'segment' })),
      field('Responsabile Almacis', select(userOptions(), subject ? s.owner_id : store.me.id, { 'data-k': 'owner_id' })),
      field('Gruppo / capogruppo', select([['', '—'], ...others.filter(x => x.id !== subject?.id).map(x => [x.id, x.name])], s.group_id, { 'data-k': 'group_id' }))),
    field('Indirizzo della sede', input({ 'data-k': 'address', value: s.address || '' })),
    h('div.en-row3', field('Comune', input({ 'data-k': 'city', value: s.city || '' })), field('Provincia', input({ 'data-k': 'province', value: s.province || '', placeholder: 'PE' })),
      field('Regione', input({ 'data-k': 'region', value: s.region || '' }))),
    h('div.en-row3', field('PEC', input({ 'data-k': 'pec', value: s.pec || '', type: 'email' })), field('Email', input({ 'data-k': 'email', value: s.email || '', type: 'email' })),
      field('Telefono', input({ 'data-k': 'phone', value: s.phone || '' }))),
    h('div.en-row3', field('Sito web', input({ 'data-k': 'website', value: s.website || '' })), field('Codice SDI', input({ 'data-k': 'sdi_code', value: s.sdi_code || '', maxlength: 10 })),
      field('Codice IPA', input({ 'data-k': 'ipa_code', value: s.ipa_code || '' }), 'Solo enti pubblici')),
    h('div.en-row3', field('Forma giuridica', input({ 'data-k': 'legal_form', value: s.legal_form || '', placeholder: 'S.r.l., S.p.A.…' })), field('ATECO', input({ 'data-k': 'ateco', value: s.ateco || '' })),
      field('Stato', select(Object.entries(data.meta.status), s.status, { 'data-k': 'status' }))),
    field('Motivo del blocco', input({ 'data-k': 'block_reason', value: s.block_reason || '' }), 'Solo se lo stato è «Bloccato»'),
    h('div.en-row3', field('Codice BOSS', input({ 'data-k': 'boss_code', value: s.boss_code || '' })), field('Codice contabile (Target)', input({ 'data-k': 'accounting_code', value: s.accounting_code || '' })),
      field('Codice Zoho', input({ 'data-k': 'zoho_id', value: s.zoho_id || '' }))),
    field('Note', textarea(s.notes, { 'data-k': 'notes' })));
  const m = modal({
    wide: true, title: subject ? `Modifica ${subject.name}` : 'Nuova anagrafica', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      // i campi dei blocchi nascosti non si mandano
      if (!roles.values.has('lead')) for (const k of ['lead_why', 'potential_value', 'priority', 'origin', 'referred_by']) delete f[k];
      if (!roles.values.has('fornitore')) delete f.supplier_zones;
      for (const k of ['group_id', 'owner_id']) f[k] = f[k] ? Number(f[k]) : null;
      f.roles = [...roles.values];
      f.asa = [...asa.values];
      if (roles.values.has('fornitore')) f.supplier_categories = [...cats.values];
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
    body: h('div.en-form', h('p', 'Contatti, attività e storico passano alla scheda buona; questa resta come rimando, così i collegamenti di BOSS non si rompono.'), field('Scheda buona', target)),
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
async function contactsTab(box, openId) {
  const state = { q: '' };
  const list = h('div', loading());
  fill(box,
    h('div.toolbar',
      h('input.input.grow', { type: 'search', placeholder: 'Cerca per nome o email…', on: { input: debounce(e => { state.q = e.target.value; load(); }) } }),
      h('button.btn.btn-primary', { type: 'button', on: { click: () => contactForm({ onSaved: c => { load(); openContact(c.id, load); } }) } }, icon('plus', { size: 16 }), 'Nuovo contatto')),
    list);
  async function load() {
    const { contacts } = await get(`/api/crm/contacts${qs({ q: state.q, asa: currentAsa() })}`);
    if (!contacts.length) return fill(list, h('div.card.empty', state.q ? 'Nessun contatto con questa ricerca.' : 'Ancora nessun contatto. Le persone si aggiungono di solito dalla scheda della loro azienda.'));
    fill(list, h('div.card.table-wrap', h('table.list',
      h('thead', h('tr', ['Persona', 'Dove lavora', 'Email', 'Telefono', 'Responsabile'].map(t => h('th', t)))),
      h('tbody', contacts.map(c => h('tr', { on: { click: () => openContact(c.id, load) } },
        h('td', h('div.t-title', personName(c)), c.status !== 'attivo' ? h('div.t-meta', data.meta.contactStatus[c.status]) : null),
        h('td', c.links.filter(l => !l.date_to).map(l => h('div', l.name, l.job ? h('span.t-meta', ` · ${l.job}`) : null))),
        h('td', c.email || '—'), h('td', c.mobile || c.phone || '—'), h('td', c.owner_name || '—')))))));
  }
  await load();
  if (Number(openId)) openContact(Number(openId), load);
}

async function contactForm({ contact = null, preset = {}, onSaved }) {
  const { subjects } = await get('/api/crm/subjects');
  const options = [['', 'Scegli l\'anagrafica…'], ...subjects.map(x => [x.id, x.name])];
  const rows = h('div.crm-links-edit');
  const addRow = (l = {}) => rows.append(h('div.crm-link-row',
    select(options, l.subject_id || '', { 'data-l': 'subject_id', 'aria-label': 'Anagrafica' }),
    input({ 'data-l': 'job', value: l.job || '', placeholder: 'Qualifica (direttore tecnico, RUP…)' }),
    h('label.en-check', h('input', { type: 'checkbox', 'data-l': 'is_primary', checked: Boolean(l.is_primary) }), 'principale'),
    input({ 'data-l': 'date_to', type: 'date', value: l.date_to || '', title: 'Fino al (se non ci lavora più)', 'aria-label': 'Fino al' }),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: e => e.currentTarget.parentElement.remove() } }, icon('x', { size: 15 }))));
  (contact?.links || (preset.subject_id ? [{ subject_id: preset.subject_id }] : [])).forEach(addRow);
  if (!rows.childElementCount) addRow();
  const c = contact || {};
  const dup = h('div');
  const emailIn = input({ 'data-k': 'email', value: c.email || '', type: 'email' });
  const firstIn = input({ 'data-k': 'first_name', value: c.first_name || '', autofocus: true });
  const lastIn = input({ 'data-k': 'last_name', value: c.last_name || '' });
  const check = debounce(async () => {
    const subjectId = rows.querySelector('[data-l="subject_id"]')?.value || '';
    const { matches } = await get(`/api/crm/contacts/check${qs({ email: emailIn.value, first_name: firstIn.value, last_name: lastIn.value, subject_id: subjectId })}`, { quiet: true });
    const other = matches.filter(x => x.id !== contact?.id);
    fill(dup, other.length ? h('div.banner.crm-dup', 'Sembra già presente: ', other.map((x, i) => [i ? ', ' : '',
      h('a', { href: '#', on: { click: e => { e.preventDefault(); m.close(); openContact(x.id); } } }, personName(x))])) : null);
  }, 400);
  for (const el of [emailIn, firstIn, lastIn]) el.addEventListener('input', check);
  const form = h('div.en-form',
    h('div.en-row3', field('Titolo', input({ 'data-k': 'title', value: c.title || '', placeholder: 'Ing., Arch., Geom.…' })), field('Nome', firstIn), field('Cognome', lastIn)),
    field('Dove lavora', h('div', rows, h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => addRow() } }, icon('plus', { size: 15 }), 'Un\'altra anagrafica')),
      'Quando cambia azienda, metti la data «fino al»: la storia resta.'),
    h('div.en-row3', field('Email', emailIn), field('Cellulare', input({ 'data-k': 'mobile', value: c.mobile || '' })), field('Telefono', input({ 'data-k': 'phone', value: c.phone || '' }))),
    dup,
    h('div.en-row3', field('LinkedIn', input({ 'data-k': 'linkedin', value: c.linkedin || '' })), field('Lingua', input({ 'data-k': 'language', value: c.language || '', placeholder: 'Per i clienti esteri' })),
      field('Responsabile Almacis', select(userOptions(), contact ? c.owner_id : store.me.id, { 'data-k': 'owner_id' }))),
    h('div.en-row3', field('Stato', select(Object.entries(data.meta.contactStatus), c.status || 'attivo', { 'data-k': 'status' })),
      field('Base giuridica (privacy)', select(Object.entries(data.meta.legalBasis), c.legal_basis || 'legittimo_interesse', { 'data-k': 'legal_basis' })),
      h('label.en-check.crm-check', h('input', { type: 'checkbox', 'data-k': 'newsletter', checked: Boolean(c.newsletter) }), 'Consenso alle comunicazioni')),
    field('Note', textarea(c.notes, { 'data-k': 'notes' })));
  const m = modal({
    wide: true, title: contact ? `Modifica ${personName(contact)}` : 'Nuovo contatto', body: form,
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const f = read(form);
      f.owner_id = f.owner_id ? Number(f.owner_id) : null;
      f.links = [...rows.children].map(r => ({
        subject_id: Number(r.querySelector('[data-l="subject_id"]').value) || null, job: r.querySelector('[data-l="job"]').value.trim(),
        is_primary: r.querySelector('[data-l="is_primary"]').checked, date_to: r.querySelector('[data-l="date_to"]').value || null,
      })).filter(l => l.subject_id);
      const saved = contact ? await patch(`/api/crm/contacts/${contact.id}`, f) : await post('/api/crm/contacts', f);
      m.close();
      toast(contact ? 'Contatto aggiornato' : 'Contatto creato');
      onSaved?.(saved);
    } } }, contact ? 'Salva' : 'Crea contatto')],
  });
}

async function openContact(id, onChange) {
  if (!data) data = await get('/api/crm');
  const c = await get(`/api/crm/contacts/${id}`);
  const reopen = () => { m.close(); openContact(id, onChange); onChange?.(); };
  const m = modal({
    drawer: true,
    title: h('div', h('h2', personName(c)), c.status !== 'attivo' ? h('div.en-head-pills', h('span.pill.en-lost', data.meta.contactStatus[c.status])) : null),
    body: h('div.en-detail',
      h('section.en-sec', dlist([
        ['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : '—'], ['Cellulare', c.mobile ? h('a', { href: `tel:${c.mobile}` }, c.mobile) : '—'],
        ['Telefono', c.phone ? h('a', { href: `tel:${c.phone}` }, c.phone) : '—'], ['LinkedIn', c.linkedin || '—'], ['Lingua', c.language || '—'],
        ['Responsabile', c.owner_name || '—'], ['Privacy', `${data.meta.legalBasis[c.legal_basis]}${c.newsletter ? ' · consenso alle comunicazioni' : ''}`],
      ]), c.notes ? h('p.en-notes', c.notes) : null),
      h('section.en-sec', h('h3', 'Dove lavora'), c.links.length ? h('div.en-links', c.links.map(l => h('a.en-link', { href: `#/crm/scheda/${l.subject_id}`, on: { click: () => m.close() } },
        h('div.grow', h('strong', l.name), h('div.t-meta', [l.job, l.is_primary && 'principale', l.date_to && `fino al ${day(l.date_to)}`, l.roles.map(r => data.meta.roles[r]).join(', ')].filter(Boolean).join(' · '))))))
        : h('p.muted.small', 'Non è collegato a nessuna anagrafica.')),
      h('section.en-sec', h('h3', 'Attività'), activityBox({ contact: c, subject: c.links.length === 1 ? { id: c.links[0].subject_id } : null, activities: c.activities, onChange: reopen }))),
    left: data.admin || c.created_by === store.me.id ? [h('button.btn.btn-ghost.danger', { type: 'button', on: { click: async () => {
      if (!await confirmDialog(`Cancellare ${personName(c)} dal CRM?`, { ok: 'Cancella', danger: true })) return;
      await del(`/api/crm/contacts/${id}`);
      m.close();
      onChange?.();
    } } }, 'Cancella')] : [],
    actions: [h('button.btn', { type: 'button', on: { click: () => { m.close(); contactForm({ contact: c, onSaved: () => { onChange?.(); openContact(id, onChange); } }); } } }, icon('pencil', { size: 15 }), 'Modifica')],
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
        a.key === 'energy' && a.energyMembers.length ? h('div.small.muted', `Da Alma Energy: ${a.energyMembers.map(m => m.name || m.email).join(', ')}`) : null,
        h('div.en-chips', a.members.map(m => h('span.pill.crm-member', m.name || m.email,
          h('button.crm-x', { type: 'button', 'aria-label': `Togli ${m.name || m.email}`, on: { click: async () => {
            await del(`/api/crm/asa/${a.key}/members/${encodeURIComponent(m.email)}`);
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
      const label = e.currentTarget.querySelector('input').value;
      await post('/api/crm/asa', { label });
      toast('ASA creata');
      asaTab(box);
    } } }, input({ placeholder: 'Nome della nuova ASA', maxlength: 60 }), h('button.btn', { type: 'submit' }, icon('plus', { size: 15 }), 'Nuova ASA')));
}

export { openContact };
