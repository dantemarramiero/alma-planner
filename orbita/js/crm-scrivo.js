// «Persone con cui mi scrivo» (ALM2-46, canvas CRM v10 · V10-Scrivo, via di Dante 19/11/2026).
// #/crm/contatti/scrivo: chi mi scrive o a cui scrivo (dalla mia casella Outlook, ultimi 12 mesi) e non è ancora nel
// CRM. Per ognuno «Crea contatto» (con l'azienda dal dominio e i dati dalla firma proposti da Alma) oppure «Ignora».
// Le ignorate non tornano ma si ritrovano nel filtro; «Già nel CRM» mostra chi c'è già. Ognuno vede solo la sua posta.
import { h, fill, toast, loading, debounce, fmtDate, timeAgo } from './ui.js';
import { get, post } from './api.js';
import { ic, pill, title, pageTop, tabsBar, emptyState, av, cvModal } from './crm-v2.js';

const VIEWS = [['da_aggiungere', 'Da aggiungere'], ['ignorate', 'Ignorate'], ['crm', 'Già nel CRM']];
const PERIODS = [[12, '12 mesi'], [6, '6 mesi'], [3, '3 mesi'], [1, 'ultimo mese']];
const ROLE = { lead: 'Lead', cliente: 'Cliente', fornitore: 'Fornitore', partner: 'Partner', concorrente: 'Concorrente' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function companyCell(c) {
  if (c.kind === 'crm') return h('div.sc-co', pill('Già nel CRM', 'gr'), h('span.sc-co-n', c.name), c.roles?.length ? h('small', c.roles.map(r => ROLE[r]).filter(Boolean).join(', ')) : null);
  if (c.kind === 'nuova') return h('div.sc-co', pill('Nuova · Lead', 'bl'), h('span.sc-co-n', c.name));
  return h('div.sc-co', pill('Indirizzo personale', ''), h('small', 'l\'azienda la scegli tu'));
}

export async function scrivoTab(box) {
  const hashQ = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  const state = { view: 'da_aggiungere', q: hashQ, months: 12, replied: false, sel: new Set() };
  const tabs = h('div');
  const sub = h('p.cv-sub');
  const views = h('div.sc-views');
  const list = h('div.sc-list', loading());
  const bulk = h('div.sc-bulk', { hidden: true });
  const refreshBtn = h('button.btn', { type: 'button', on: { click: () => refresh() } }, ic('refresh', 15), 'Aggiorna dalla posta');
  const search = h('input.input.sc-search', { type: 'search', value: state.q, placeholder: 'Cerca: nome, email, dominio o azienda', 'aria-label': 'Cerca tra le persone con cui ti scrivi' });
  const period = h('select.select.sc-sel', { 'aria-label': 'Periodo', on: { change: e => { state.months = Number(e.target.value); load(); } } }, PERIODS.map(([k, l]) => h('option', { value: String(k) }, `Periodo: ${l}`)));
  const replied = h('label.sc-check', h('input', { type: 'checkbox', on: { change: e => { state.replied = e.target.checked; load(); } } }), 'Solo chi mi ha risposto');
  fill(tabs, tabsBar([['tutti', 'Tutti i contatti'], ['scrivo', 'Persone con cui mi scrivo'], ['biglietti', 'Biglietti da visita']], 'scrivo',
    k => { location.hash = k === 'tutti' ? '#/crm/contatti' : `#/crm/contatti/${k}`; }));
  fill(box,
    pageTop({ eyebrow: 'Alma CRM · Contatti', heading: title('', 'Persone con cui mi scrivo'), sub, actions: [refreshBtn] }),
    tabs,
    h('div.sc-filters', h('div.sc-search-w', ic('search', 16), search), views, h('div.sc-more', period, replied)),
    h('section.cv-card.sc-card', list, bulk));
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 200));

  let data = null;
  async function load() {
    const qs = new URLSearchParams({ vista: state.view, mesi: String(state.months), ...(state.q ? { q: state.q } : {}), ...(state.replied ? { risposto: '1' } : {}) });
    data = await get(`/api/crm/scrivo?${qs}`);
    state.sel = new Set([...state.sel].filter(e => data.people.some(p => p.email === e)));
    draw();
  }

  function drawHead() {
    sub.textContent = data.scanned_at
      ? `Dalla tua posta Outlook · aggiornato ${timeAgo(data.scanned_at)} · ${data.months === 12 ? 'ultimi 12 mesi' : PERIODS.find(([k]) => k === data.months)?.[1]}`
      : 'Dalla tua posta Outlook · solo tu vedi queste persone';
    fill(views, VIEWS.map(([k, l]) => h('button.cv-pill.big', { type: 'button', class: state.view === k ? 'or' : 'line', 'aria-pressed': String(state.view === k),
      on: { click: () => { state.view = k; state.sel.clear(); load(); } } }, l, ' · ', String(data.counts[k] ?? 0))));
  }

  function draw() {
    drawHead();
    if (!data.scanned_at) {
      fill(list, emptyState('mail', 'Non ho ancora letto la tua posta. Con «Aggiorna dalla posta» guardo ricevute e inviate degli ultimi 12 mesi e ti mostro chi non è nel CRM. Non creo niente da solo.',
        h('button.btn.btn-primary', { type: 'button', on: { click: () => refresh() } }, ic('refresh', 15), 'Leggi la mia posta')));
      bulk.hidden = true;
      return;
    }
    if (!data.people.length) {
      const msg = state.q ? `Nessuno per «${state.q}» in questo elenco. Prova in «Ignorate» o «Già nel CRM».`
        : state.view === 'da_aggiungere' ? 'Tutte le persone con cui ti scrivi sono già nel CRM o le hai ignorate.' : state.view === 'ignorate' ? 'Nessuna persona ignorata.' : 'Nessuna delle persone con cui ti scrivi è ancora nel CRM.';
      fill(list, emptyState('check', msg));
      bulk.hidden = true;
      return;
    }
    const head = h('div.sc-row.sc-head', h('span.sc-c0'), h('span', 'Persona'), h('span', 'Azienda dal dominio'), h('span.sc-num', 'Email'), h('span', 'Ultima'), h('span'));
    fill(list, head, data.people.map(row), data.total > data.people.length ? h('p.cv-small.cv-muted.sc-more-n', `Ne mostro ${data.people.length} su ${data.total}: cerca per restringere.`) : null);
    drawBulk();
  }

  function row(p) {
    const check = h('input', { type: 'checkbox', checked: state.sel.has(p.email), 'aria-label': `Seleziona ${p.name || p.email}`,
      on: { change: e => { if (e.target.checked) state.sel.add(p.email); else state.sel.delete(p.email); drawBulk(); } } });
    const [local, dom] = p.email.split('@');
    const mark = s => { const q = state.q.toLowerCase(); const i = q ? s.toLowerCase().indexOf(q) : -1; return i < 0 ? s : [s.slice(0, i), h('mark', s.slice(i, i + q.length)), s.slice(i + q.length)]; };
    const actions = state.view === 'crm'
      ? h('div.sc-act', h('a.btn.btn-sm', { href: `#/crm/contatti/${p.contact.id}` }, 'Apri la scheda'))
      : state.view === 'ignorate'
        ? h('div.sc-act', h('button.btn.btn-sm', { type: 'button', on: { click: () => ignore([p.email], true) } }, 'Ripristina'))
        : h('div.sc-act',
          h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => createFrom(p) } }, 'Crea contatto'),
          h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: () => ignore([p.email]) } }, 'Ignora'));
    return h('div.sc-row',
      h('span.sc-c0', state.view === 'crm' ? null : check),
      h('div.sc-who', av(p.name || p.email, 'bl'), h('div.sc-who-t', h('b', mark(p.name || local)), h('small', mark(local), '@', mark(dom)), !p.name ? h('small.cv-muted', 'nessun nome nell\'intestazione') : null)),
      state.view === 'crm' ? h('div.sc-co', pill('Nel CRM', 'gr'), h('span.sc-co-n', p.contact.name), p.contact.subject ? h('small', p.contact.subject) : null) : companyCell(p.company),
      h('div.sc-num', h('b', String(p.received + p.sent)), h('small', [p.received ? plural(p.received, 'ricevuta', 'ricevute') : null, p.sent ? plural(p.sent, 'inviata', 'inviate') : null].filter(Boolean).join(' · '))),
      h('span.sc-last', p.last_at ? fmtDate(p.last_at.slice(0, 10)) : ''),
      actions);
  }

  function drawBulk() {
    const n = state.sel.size;
    bulk.hidden = !n || state.view === 'crm';
    if (bulk.hidden) return;
    fill(bulk, h('span', plural(n, 'selezionata', 'selezionate')),
      state.view === 'ignorate'
        ? h('button.btn.btn-sm', { type: 'button', on: { click: () => ignore([...state.sel], true) } }, 'Ripristina le selezionate')
        : [h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: () => createMany([...state.sel]) } }, 'Crea i selezionati'),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => ignore([...state.sel]) } }, 'Ignora i selezionati')]);
  }

  async function ignore(emails, undo = false) {
    await post('/api/crm/scrivo/ignora', { emails, ripristina: undo });
    toast(undo ? (emails.length === 1 ? 'Ripristinata' : `${emails.length} ripristinate`) : (emails.length === 1 ? 'Ignorata: la ritrovi in «Ignorate»' : `${emails.length} ignorate`));
    emails.forEach(e => state.sel.delete(e));
    load();
  }

  async function refresh() {
    refreshBtn.disabled = true;
    const label = refreshBtn.lastChild;
    refreshBtn.replaceChildren(ic('refresh', 15), 'Sto leggendo la posta…');
    try {
      const r = await post('/api/crm/scrivo/aggiorna', {});
      toast(`Lette ${r.messages.toLocaleString('it-IT')} email: ${plural(r.people, 'persona', 'persone')} con cui ti scrivi`);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.replaceChildren(ic('refresh', 15), label?.textContent === 'Sto leggendo la posta…' ? 'Aggiorna dalla posta' : 'Aggiorna dalla posta');
    }
    load();
  }

  // più persone insieme: una dopo l'altra, con la finestra di ognuna (niente si crea senza vedere i dati)
  async function createMany(emails) {
    for (const e of emails) {
      const p = data.people.find(x => x.email === e);
      if (!p) continue;
      const ok = await createFrom(p, { many: true });
      if (ok === 'stop') break;
    }
    load();
  }

  function createFrom(p, { many = false } = {}) {
    return new Promise(resolve => openCreate(p, { onDone: r => { if (!many) load(); resolve(r); } }));
  }

  await load();
  // la prima volta (o dopo più di un giorno) leggo la posta da solo
  if (!data.scanned_at || Date.now() - new Date(data.scanned_at).getTime() > 864e5) refresh().catch(() => {});
}

// ── finestra «Nuovo contatto dalla posta» ────────────────────────────────────
async function openCreate(p, { onDone }) {
  let done = false;
  const body = h('div.sc-form', loading());
  const m = cvModal({ title: `Nuovo contatto dalla posta · ${p.name || p.email}`, body, drawer: true,
    actions: [], onClose: () => { if (!done) onDone('stop'); } });
  let prop;
  try { prop = await get(`/api/crm/scrivo/proposta?email=${encodeURIComponent(p.email)}`); } catch (err) { fill(body, h('p', err.message)); return; }
  const f = prop.fields;
  const alma = k => (prop.source === 'alma' || prop.source === 'firma') && f[k] ? h('span.sc-alma', { title: 'Proposto dalla firma: controlla' }, prop.source === 'alma' ? 'ALMA' : 'FIRMA') : null;
  const field = (label, key, value, attrs = {}) => {
    const input = h('input.input', { value: value || '', 'data-k': key, ...attrs, class: f[key] ? 'sc-prop' : '' });
    return h('label.field', h('span', label, alma(key)), input);
  };
  const company = { ...prop.company, choice: prop.company.kind === 'crm' ? 'crm' : prop.company.kind === 'nuova' ? 'nuova' : 'nessuna', pick: null };
  const coBox = h('div.sc-cobox');
  const coName = h('input.input', { value: company.name || '', 'aria-label': 'Nome della nuova azienda' });
  const coSearch = h('input.input', { type: 'search', placeholder: 'Cerca un\'azienda già nel CRM', 'aria-label': 'Cerca un\'azienda già nel CRM' });
  const coHits = h('div.sc-hits');
  coSearch.addEventListener('input', debounce(async () => {
    const q = coSearch.value.trim();
    if (q.length < 2) return fill(coHits);
    const r = await get(`/api/crm/scrivo/cerca?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ subjects: [] }));
    fill(coHits, r.subjects.map(s => h('button.sc-hit', { type: 'button', on: { click: () => { company.choice = 'scelta'; company.pick = s; fill(coHits); coSearch.value = ''; drawCo(); } } },
      h('b', s.name), h('small', [s.roles.map(x => ROLE[x]).filter(Boolean).join(', '), s.city].filter(Boolean).join(' · ')))));
  }, 200));
  const drawCo = () => {
    const head = company.choice === 'crm' ? [pill('Già nel CRM', 'gr'), h('b', company.name), h('small', `@${company.domain} · il contatto va dentro questa azienda`)]
      : company.choice === 'scelta' ? [pill('Scelta da te', 'gr'), h('b', company.pick.name)]
        : company.choice === 'nuova' ? [pill('Nuova · Lead', 'bl'), coName, h('small', `@${company.domain}${f.city ? ` · ${f.city}` : ''} · la creo insieme al contatto`)]
          : [pill(company.kind === 'personale' ? 'Indirizzo personale' : 'Senza azienda', ''), h('small', 'Il contatto resta senza azienda: puoi sceglierne una qui sotto.')];
    fill(coBox, h('div.sc-cohead', head),
      h('div.sc-cosearch', coSearch, coHits),
      company.choice !== 'nessuna' ? h('button.cv-lnk', { type: 'button', on: { click: () => { company.choice = 'nessuna'; drawCo(); } } }, 'Senza azienda') : null,
      company.kind === 'nuova' && company.choice !== 'nuova' ? h('button.cv-lnk', { type: 'button', on: { click: () => { company.choice = 'nuova'; drawCo(); } } }, `Crea «${company.name}» come Lead`) : null);
  };
  drawCo();
  const linkMail = h('input', { type: 'checkbox', checked: true });
  const n = p.received + p.sent;
  const sig = prop.fields.signature && prop.source !== 'intestazione'
    ? h('div.sc-sig', h('div.cv-lbl', `Firma dell'ultima email${prop.last?.date ? ` (${fmtDate(prop.last.date.slice(0, 10))})` : ''}`), h('pre', prop.fields.signature)) : null;
  fill(body,
    sig,
    h('div.sc-grid', field('Nome', 'first_name', f.first_name), field('Cognome', 'last_name', f.last_name, { required: true })),
    h('div.sc-grid', field('Ruolo', 'job', f.job, { placeholder: 'Es. Direttore tecnico' }), field('Titolo', 'title', f.title, { placeholder: 'Ing., Arch., Geom.…' })),
    h('div.sc-grid', field('Email', 'email', p.email, { type: 'email' }), field('Cellulare', 'mobile', f.mobile, { type: 'tel' })),
    f.phone ? h('div.sc-grid', field('Telefono', 'phone', f.phone, { type: 'tel' }), h('span')) : null,
    h('div.field', h('span', 'Azienda'), coBox),
    h('label.sc-check.sc-link', linkMail, h('span', h('b', `Collega ${plural(n, 'email già scambiata', 'email già scambiate')}`), h('small', 'Si vedono nella scheda del contatto e salgono sull\'azienda'))));
  const save = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    const val = k => body.querySelector(`[data-k="${k}"]`)?.value.trim() || '';
    if (!val('last_name') && !val('first_name')) { body.querySelector('[data-k="last_name"]').focus(); return; }
    save.disabled = true;
    try {
      let subjectId = company.choice === 'crm' ? company.subject_id : company.choice === 'scelta' ? company.pick.id : null;
      if (company.choice === 'nuova') {
        const s = await post('/api/crm/subjects/rapida', { name: coName.value.trim() || company.name, website: company.domain, city: f.city || undefined, origin: 'Posta Outlook' });
        subjectId = s.id;
      }
      const c = await post('/api/crm/contacts', { first_name: val('first_name'), last_name: val('last_name'), title: val('title'), email: val('email'), mobile: val('mobile'), phone: val('phone'),
        links: subjectId ? [{ subject_id: subjectId, job: val('job'), is_primary: true }] : [] });
      done = true;
      let linked = 0;
      if (linkMail.checked) {
        try {
          const { ids } = await get(`/api/crm/scrivo/messaggi?email=${encodeURIComponent(p.email)}`, { quiet: true });
          for (let i = 0; i < ids.length; i += 50) linked += (await post(`/api/crm/contacts/${c.id}/emails`, { message_ids: ids.slice(i, i + 50) }, { quiet: true })).added || 0;
        } catch { toast('Contatto creato. Le email non si sono collegate: riprova dalla scheda, tab Email', 'warn'); }
      }
      m.close();
      toast(`${[c.first_name, c.last_name].filter(Boolean).join(' ')} è nel CRM${linked ? ` con ${plural(linked, 'email', 'email')}` : ''}`);
      onDone('ok');
    } catch (err) {
      save.disabled = false;
      toast(err.message, 'err');
    }
  } } }, company.choice === 'nuova' ? 'Crea contatto e azienda' : 'Crea contatto');
  const cancel = h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla');
  m.box.append(h('div.modal-foot', h('div.left'), cancel, save));
}
