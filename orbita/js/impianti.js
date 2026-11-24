// Alma Impianti (ALM2-73, canvas «Alma Impianti · radar e CRM» approvato da Dante il 24/11/2026): il modulo della BU
// Impianti sopra il CRM comune. Pagine: Da fare (tavola 7), Radar per settore (tavola 2), Fondi e investitori (tavola 4),
// Progettisti e dare/avere (tavola 5). Le aziende e i contatti sono quelli del CRM: «Scheda» apre la scheda del CRM.
// Stili in css/impianti.css (classi im-*), sopra i pezzi del design v2 del CRM (cv-*).
import { h, fill, toast, fmtDate, loading, confirmDialog } from './ui.js';
import { get, post, put, del } from './api.js';
import { store } from './store.js';
import { ic, dots, pill, pageTop, title, card, link, emptyState, cvModal, choiceChips, toggle } from './crm-v2.js';
import { stepDialog, doneDialog } from './crm-commerciale.js';
import { radarTab, openSignal } from './crm-radar.js';

const SECTORS = [['depurazione', 'Depurazione', '#0057B8'], ['fotovoltaico', 'Fotovoltaico', '#E0A400'], ['biometano', 'Biometano', '#2E8B57'], ['edilizia', 'Impianti in edilizia', '#7A5AF8'], ['efficientamento', 'Efficientamento', '#FF8A26']];
const PHASES = [['greenfield', 'Da sviluppare'], ['autorizzato', 'Autorizzato (RTB)'], ['costruzione', 'In costruzione'], ['esercizio', 'In esercizio']];
const REGIONS = ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino-Alto Adige', 'Umbria', 'Valle d\'Aosta', 'Veneto'];
const STATE_TONE = { mai: '', contattato: 'bl', attesa: 'am', risposto: 'gr', incontro: 'gr' };
const EX_TONE = { forte: 'gr', medio: 'bl', da_ricambiare: 'am', fermo: 'rd', da_conoscere: '' };
const KIND_TONE = { Fondo: 'dark', Progettista: 'bl', Energivoro: 'or', Ente: 'line', Cliente: 'gr', Lead: 'or' };
const sectorName = k => SECTORS.find(s => s[0] === k)?.[1] || k;
const eur = n => (n === null || n === undefined || n === '' ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })} €`);
const ago = d => { if (!d) return 'mai sentito'; const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : `${n} giorni fa`; };
const input = (attrs = {}) => h('input.input', attrs);
const fld = (label, control, hint) => h('label.cv-fld', h('span', label), control, hint ? h('span.cv-hint', hint) : null);
const telHref = p => `tel:${String(p).replace(/[^\d+]/g, '')}`;
const mailHref = e => `mailto:${encodeURIComponent(e)}`;
const schedaHref = id => `#/crm/scheda/${id}`;

export async function impiantiView(container, parts = []) {
  const page = parts[1] || 'dafare';
  const body = h('div.cv.im', loading());
  fill(container, body);
  if (page === 'radar') { const data = store.crmData || await get('/api/crm'); store.crmData = data; return radarTab(body, data, '', { scope: 'impianti' }); }
  if (page === 'fondi') return fondiPage(body, Number(parts[2]) || null);
  if (page === 'progettisti') return progettistiPage(body, Number(parts[2]) || null);
  return daFarePage(body);
}

// ── Da fare e in attesa di risposta (tavola 7) ──────────────────────────────────────────────────
const GROUPS = [['attesa', 'In attesa di risposta', 'email senza risposta'], ['oggi', 'Da chiamare oggi', 'compiti di oggi'], ['ritardo', 'Compiti in ritardo', 'scaduti e non fatti'], ['risentire', 'Da risentire', 'oltre la cadenza']];
let dfState = { g: null, miei: false };
async function daFarePage(box, { fresh = false } = {}) {
  const r = await get(`/api/crm/impianti/dafare?${dfState.miei ? 'miei=1&' : ''}${fresh ? 'aggiorna=1' : ''}`);
  if (!dfState.g) dfState.g = GROUPS.find(([k]) => r.groups[k].length)?.[0] || 'attesa';
  const again = opts => daFarePage(box, opts);
  const cfg = r.settings;
  const tiles = h('section.im-tiles', { role: 'tablist', 'aria-label': 'Gruppi' }, GROUPS.map(([k, l, d]) => h('button.im-tile', {
    type: 'button', role: 'tab', 'aria-selected': String(dfState.g === k), class: dfState.g === k ? 'on' : '', on: { click: () => { dfState.g = k; again(); } },
  }, h('span.im-tile-l', l), h('span.im-tile-n', String(r.groups[k].length)), h('span.im-tile-d', k === 'attesa' ? `da ${cfg.wait_days} giorni lavorativi` : d))));

  const rows = r.groups[dfState.g];
  const actionsOf = x => {
    const call = x.phone ? h('a.btn.btn-primary.btn-sm', { href: telHref(x.phone) }, ic('phone', 14), 'Chiama') : null;
    const write = x.email ? h('a.btn.btn-sm', { href: mailHref(x.email) }, ic('mail', 14), 'Scrivi') : null;
    if (x.group === 'attesa') return [call, x.web_link ? h('a.btn.btn-sm', { href: x.web_link, target: '_blank', rel: 'noopener' }, ic('reply', 14), 'Riscrivi') : write,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => { await post('/api/crm/impianti/dafare/ignora', { message_id: x.message_id }); toast('Non te lo ricordo più'); again(); } } }, 'Lascia stare')];
    if (x.group === 'oggi' || x.group === 'ritardo') return [call || write,
      h('button.btn.btn-sm', { type: 'button', on: { click: () => doneDialog({ id: x.step_id, title: x.title, subject_name: x.subject_name }, { onSaved: () => again() }) } }, ic('check', 14), 'Fatto'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => stepDialog({ subjectId: x.subject_id, subjectName: x.subject_name,
        step: { id: x.step_id, title: x.title, due_date: x.due_date, channel: x.channel, owner_id: x.owner_id, people: x.people || [], note: x.note || '', draft: x.draft || '', contact_id: x.contact_id }, onSaved: () => again() }) } }, 'Sposta')];
    return [call || write,
      h('button.btn.btn-sm', { type: 'button', on: { click: () => stepDialog({ subjectId: x.subject_id, subjectName: x.org || x.who, onSaved: () => again() }) } }, ic('plus', 14), 'Nuovo compito'),
      x.subject_id ? h('a.btn.btn-ghost.btn-sm', { href: schedaHref(x.subject_id) }, 'Scheda') : null];
  };
  const list = rows.length
    ? rows.map(x => h('div.im-row',
      h('div.im-row-main',
        h('div.im-row-top', x.subject_id ? h('a.im-who', { href: schedaHref(x.subject_id) }, x.who) : h('b.im-who', x.who), x.org ? h('span.im-org', x.org) : null, pill(x.kind, KIND_TONE[x.kind] || 'line')),
        h('div.im-what', x.what)),
      h('div.im-acts', actionsOf(x).filter(Boolean))))
    : [emptyState('check', dfState.g === 'attesa' ? (r.mail_error || 'Nessuna email senza risposta: tutti ti hanno risposto.') : 'Niente in questo gruppo.')];

  const max = Math.max(1, ...Object.values(r.funnel));
  const COLORS = { mai: '#D6D2CC', contattato: '#9DB8DC', attesa: '#E0A400', risposto: '#6DBE8D', incontro: '#2E8B57' };
  const funnel = card({ title: 'A che punto sei con i clienti', icon: 'filter' },
    h('div.im-funnel', r.states.map(([k, l]) => h('div.im-fn-row', h('span', l), h('span.im-fn-bar', h('i', { style: { width: `${Math.round(r.funnel[k] / max * 100)}%`, background: COLORS[k] } })), h('b', String(r.funnel[k]))))),
    h('p.cv-hint', 'Lo stato cambia da solo: email inviata → «contattato», nessuna risposta → «in attesa», risposta → «ha risposto», incontro in calendario → «incontro fatto».'));
  const cad = card({ title: 'Ogni quanto sentirli', icon: 'repeat', right: store.me?.admin || store.crmData?.admin ? link('Cambia', { on: { click: () => cadenceDialog(cfg, () => again()) } }) : null },
    h('dl.im-dl',
      h('dt', 'Fondi e investitori'), h('dd', `ogni ${cfg.cadence.fondo} giorni`),
      h('dt', 'Progettisti'), h('dd', `ogni ${cfg.cadence.progettista} giorni`),
      h('dt', 'Clienti con opportunità aperta'), h('dd', `ogni ${cfg.cadence.opportunita} giorni`),
      h('dt', 'Aspettare una risposta'), h('dd', `${cfg.wait_days} giorni lavorativi`)));

  fill(box,
    pageTop({ eyebrow: 'Alma Impianti · Da fare', heading: title('Chi chiamare, chi', 'non ha risposto'),
      sub: `Il CRM legge la tua posta inviata e i tuoi compiti: se mandi un'email e nessuno risponde, dopo ${cfg.wait_days} giorni lavorativi te lo ricorda qui.`,
      actions: [h('button.btn', { type: 'button', class: dfState.miei ? 'on' : '', 'aria-pressed': String(dfState.miei), on: { click: () => { dfState.miei = !dfState.miei; again(); } } }, dfState.miei ? 'Solo i miei ✓' : 'Solo i miei'),
        h('button.btn', { type: 'button', title: 'Rilegge la posta adesso', on: { click: () => again({ fresh: true }) } }, ic('refresh-cw', 14), 'Aggiorna')] }),
    tiles,
    h('div.im-main', h('section.cv-card.im-list', list), h('aside.im-side', funnel, cad)));
}
function cadenceDialog(cfg, onSaved) {
  const n = (v, min, max) => input({ type: 'number', min, max, value: v, style: { width: '110px' } });
  const fondo = n(cfg.cadence.fondo, 7, 365), prog = n(cfg.cadence.progettista, 7, 365), opp = n(cfg.cadence.opportunita, 3, 180), wait = n(cfg.wait_days, 1, 30);
  const m = cvModal({ size: 'sm', title: h('h2', 'Ogni quanto sentirli'),
    body: h('div.en-form', fld('Fondi e investitori (giorni)', fondo), fld('Progettisti (giorni)', prog), fld('Clienti con opportunità aperta (giorni)', opp),
      fld('Aspettare una risposta (giorni lavorativi)', wait, 'Dopo quanti giorni un\'email senza risposta compare in «In attesa di risposta».')),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        await put('/api/crm/impianti/impostazioni', { wait_days: Number(wait.value), cadence: { fondo: Number(fondo.value), progettista: Number(prog.value), opportunita: Number(opp.value) } });
        m.close(); toast('Salvato'); onSaved?.();
      } } }, 'Salva')] });
}

// ── Fondi e investitori (tavola 4) ──────────────────────────────────────────────────────────────
async function fondiPage(box, openId) {
  const r = await get('/api/crm/impianti/fondi');
  const again = id => fondiPage(box, id === undefined ? openId : id);
  const t = r.totals;
  const kpis = h('section.im-kpis',
    kpi('Fondi nel CRM', t.all, `${t.impianti} Impianti · ${t.energy} Energy · ${t.both} tutte e due`),
    kpi('Con mandato compilato', t.with_mandate, t.all - t.with_mandate ? `${t.all - t.with_mandate} non si abbinano ancora` : 'tutti si abbinano'),
    kpi('Abbinamenti', t.matches, 'progetti della BU ↔ fondi', 'or'),
    kpi('Fermi da 60 giorni', t.late, 'nessun contatto'));
  const sel = openId || r.funds[0]?.id || null;
  const rows = r.funds.length ? h('div.im-table-box', h('table.im-table',
    h('thead', h('tr', ['Fondo', 'Mandato', 'Ticket', 'Ultimo contatto', 'Abbinati', 'Prossimo compito'].map(x => h('th', x)))),
    h('tbody', r.funds.map(f => h('tr', { class: f.id === sel ? 'on' : '', tabIndex: 0, on: { click: () => again(f.id), keydown: e => { if (e.key === 'Enter') again(f.id); } } },
      h('td', h('b', f.name), h('div.im-sub', dots([f.mandate?.bus?.includes('energy') && f.mandate?.bus?.includes('impianti') ? 'Impianti + Energy' : f.mandate?.bus?.includes('energy') ? 'Energy' : 'Impianti', f.city]))),
      h('td', f.mandate?.techs?.length ? h('div.im-tags', f.mandate.techs.map(k => pill(sectorName(k), 'line'))) : h('span.im-sub', 'da compilare')),
      h('td.im-nw', f.mandate && (f.mandate.ticket_min || f.mandate.ticket_max) ? `${eur(f.mandate.ticket_min)} – ${eur(f.mandate.ticket_max)}` : '—'),
      h('td', pill(ago(f.last_contact), f.days === null ? '' : f.late ? 'am' : 'gr')),
      h('td', f.matches ? h('b.im-or', String(f.matches)) : h('span.im-sub', '0')),
      h('td.im-sub', f.next_step ? `${f.next_step.title} · ${fmtDate(f.next_step.due_date)}` : 'Nessun compito: fissane uno'))))))
    : emptyState('landmark', 'Nessun fondo ancora. Aggiungi il primo con «+ Nuovo fondo», o metti il tipo «Fondo o investitore» a un cliente del CRM.');
  const aside = h('aside.cv-card.im-drawer', sel ? loading() : emptyState('landmark', 'Scegli un fondo'));
  fill(box,
    pageTop({ eyebrow: 'Clienti · Fondi e investitori', heading: title('Chi', 'finanzia', 'gli impianti'),
      sub: 'Un fondo vale dieci clienti: ogni impianto del suo portafoglio è un lavoro da costruire. Gli stessi fondi li vede Alma Energy, con la sua etichetta.',
      actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => newFundDialog(id => again(id)) } }, ic('plus', 15), 'Nuovo fondo')] }),
    kpis,
    h('div.im-main', h('section.cv-card.im-list', rows), aside));
  if (sel) fundDrawer(aside, sel, () => again(sel));
}
const kpi = (label, n, sub, tone = '') => h('div.im-kpi', { class: tone }, h('span.im-kpi-l', label), h('span.im-kpi-n', String(n)), h('span.im-kpi-s', sub));

async function fundDrawer(box, id, refresh) {
  const r = await get(`/api/crm/impianti/fondi/${id}`);
  const f = r.fund, m = r.mandate;
  const c = f.contact;
  fill(box,
    h('div.im-dr-h', h('span.cv-eyebrow', 'Scheda fondo'), h('h2', f.name),
      h('p.im-sub', dots([f.city, c ? `referente: ${c.name}${c.job ? `, ${c.job}` : ''}` : 'nessun referente', `ultimo contatto ${ago(f.last_contact)}`]))),
    h('div.im-sec-l', 'Mandato'),
    m ? h('dl.im-dl',
      h('dt', 'Settori'), h('dd', m.techs.length ? m.techs.map(sectorName).join(', ') : 'tutti'),
      h('dt', 'Ticket'), h('dd', m.ticket_min || m.ticket_max ? `${eur(m.ticket_min)} – ${eur(m.ticket_max)} per progetto` : 'qualsiasi'),
      h('dt', 'Regioni'), h('dd', m.regions.length ? m.regions.join(', ') : 'tutta Italia'),
      h('dt', 'Fase'), h('dd', m.phases.length ? m.phases.map(k => PHASES.find(p => p[0] === k)?.[1] || k).join(', ') : 'qualsiasi'),
      h('dt', 'Cerca EPC'), h('dd', m.seeks_epc ? 'Sì' : 'No'),
      h('dt', 'Lo seguono'), h('dd', m.bus.map(b => (b === 'energy' ? 'Alma Energy' : 'Alma Impianti')).join(' e ')),
      m.notes ? h('dt', 'Note') : null, m.notes ? h('dd', m.notes) : null)
      : h('p.im-sub', 'Mandato da compilare: senza, il fondo non si abbina ai progetti.'),
    h('div.im-sec-l', `Progetti che combaciano${r.matches.length ? ` · ${r.matches.length}` : ''}`),
    r.matches.length ? h('div.im-matches', r.matches.map(x => h('div.im-match',
      h('div', h('b', x.title), h('div.im-sub', dots([x.entity, eur(x.amount), x.region, x.reasons.join(', ')]))),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => openSignal(x.id, refresh, store.crmData || {}) } }, 'Apri'))))
      : h('p.im-sub', m ? 'Nessun progetto del radar Impianti combacia adesso.' : '—'),
    h('div.im-dr-acts',
      h('button.btn.btn-primary', { type: 'button', on: { click: () => mandateDialog(id, m, refresh) } }, m ? 'Modifica il mandato' : 'Compila il mandato'),
      h('button.btn', { type: 'button', on: { click: () => stepDialog({ subjectId: id, subjectName: f.name, onSaved: refresh }) } }, 'Nuovo compito'),
      c?.email ? h('a.btn', { href: mailHref(c.email) }, 'Scrivi') : null,
      h('a.btn.btn-ghost', { href: schedaHref(id) }, 'Scheda CRM')));
}
function newFundDialog(onSaved) {
  const name = input({ placeholder: 'Nome del fondo o della SGR', maxlength: 200 });
  const city = input({ placeholder: 'Città (facoltativa)', maxlength: 120 });
  const m = cvModal({ size: 'sm', title: h('h2', 'Nuovo fondo'),
    body: h('div.en-form', fld('Nome', name), fld('Città', city), h('p.cv-hint', 'Entra nel CRM come lead col tipo «Fondo o investitore» e l\'ASA Impianti; se c\'è già con lo stesso nome, si usa quella scheda.')),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!name.value.trim()) return toast('Scrivi il nome', 'err');
        const r = await post('/api/crm/impianti/fondi', { name: name.value, city: city.value });
        m.close(); toast(r.existing ? 'Era già nel CRM: ora è tra i fondi' : 'Fondo aggiunto: compila il mandato');
        onSaved?.(r.id);
      } } }, 'Aggiungi')] });
  setTimeout(() => name.focus(), 50);
}
function mandateDialog(id, m, onSaved) {
  m = m || { techs: [], ticket_min: null, ticket_max: null, regions: [], phases: [], seeks_epc: true, bus: ['impianti'], notes: '' };
  const multi = (options, selected) => { const set = new Set(selected); const el = h('div.cv-chips'); const draw = () => fill(el, options.map(([k, l]) => h('button.cv-chip', { type: 'button', class: set.has(k) ? 'on' : '', 'aria-pressed': String(set.has(k)), on: { click: () => { set.has(k) ? set.delete(k) : set.add(k); draw(); } } }, l))); draw(); return { el, get value() { return [...set]; } }; };
  const techs = multi(SECTORS.map(([k, l]) => [k, l]), m.techs);
  const phases = multi(PHASES, m.phases);
  const bus = multi([['impianti', 'Alma Impianti'], ['energy', 'Alma Energy']], m.bus);
  const regions = multi(REGIONS.map(x => [x, x]), m.regions);
  const mil = v => (v ? String(Number(v) / 1e6) : '');
  const tmin = input({ type: 'number', min: 0, step: '0.1', value: mil(m.ticket_min), placeholder: 'es. 5', style: { width: '120px' } });
  const tmax = input({ type: 'number', min: 0, step: '0.1', value: mil(m.ticket_max), placeholder: 'es. 30', style: { width: '120px' } });
  const epc = toggle(m.seeks_epc, 'Cerca un costruttore (EPC)');
  const notes = h('textarea.input', { rows: 2, maxlength: 2000, placeholder: 'Cosa sappiamo del fondo: chi decide, come investe…' }, m.notes || '');
  const dlg = cvModal({ size: 'md', title: h('h2', 'Mandato del fondo'),
    body: h('div.en-form',
      h('div.cv-fld', h('span', 'Settori in cui investe'), techs.el, h('span.cv-hint', 'Nessuno = tutti.')),
      h('div.cv-fld', h('span', 'Ticket per progetto (milioni di €)'), h('div.cv-row', { style: { gap: '8px', alignItems: 'center' } }, 'da', tmin, 'a', tmax)),
      h('div.cv-fld', h('span', 'Regioni'), regions.el, h('span.cv-hint', 'Nessuna = tutta Italia.')),
      h('div.cv-fld', h('span', 'Fase dei progetti'), phases.el),
      h('div.cv-fld', epc.el),
      h('div.cv-fld', h('span', 'Lo seguono'), bus.el),
      fld('Note', notes)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => dlg.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        const num = el => (el.value === '' ? null : Math.round(Number(el.value) * 1e6));
        await put(`/api/crm/impianti/fondi/${id}/mandato`, { techs: techs.value, ticket_min: num(tmin), ticket_max: num(tmax), regions: regions.value, phases: phases.value, seeks_epc: epc.input.checked, bus: bus.value, notes: notes.value });
        dlg.close(); toast('Mandato salvato'); onSaved?.();
      } } }, 'Salva')] });
}

// ── Progettisti: dare e avere (tavola 5) ────────────────────────────────────────────────────────
let prState = { f: '' };
async function progettistiPage(box, openId) {
  const r = await get('/api/crm/impianti/progettisti');
  const again = id => progettistiPage(box, id === undefined ? openId : id);
  const t = r.totals;
  const alert = (k, n, text) => h('button.im-alert', { type: 'button', class: prState.f === k ? 'on' : '', 'aria-pressed': String(prState.f === k), on: { click: () => { prState.f = prState.f === k ? '' : k; again(); } } }, h('b', String(n)), text);
  const shown = r.progettisti.filter(p => !prState.f || p.state === prState.f);
  const sel = openId || shown[0]?.id || null;
  const rows = shown.length ? shown.map(p => {
    const tot = p.dato + p.ricevuto || 1;
    return h('div.im-pr', { class: p.id === sel ? 'on' : '', tabIndex: 0, on: { click: () => again(p.id), keydown: e => { if (e.key === 'Enter') again(p.id); } } },
      h('div', h('b', p.name), h('div.im-sub', dots([p.city || p.province, p.contact?.name, `ultimo contatto ${ago(p.last_contact)}`]))),
      h('div.im-recip', h('span.im-recip-bar', h('i.dato', { style: { width: `${Math.round(p.dato / tot * 100)}%` } }), h('i.ric', { style: { width: `${Math.round(p.ricevuto / tot * 100)}%` } })),
        h('span.im-sub', `${p.dato} dati · ${p.ricevuto} ricevuti`)),
      pill(p.state_label, EX_TONE[p.state]));
  }) : [emptyState('ruler', prState.f ? 'Nessun progettista in questo gruppo.' : 'Nessun progettista nel CRM. Si aggiungono da Concorrenza e gare → Progettisti, o col tipo «Progettista» su una scheda.')];
  const aside = h('aside.cv-card.im-drawer', sel ? loading() : emptyState('ruler', 'Scegli un progettista'));
  fill(box,
    pageTop({ eyebrow: 'Alma Impianti · Progettisti', heading: title('I progettisti:', 'dare e avere'),
      sub: 'Pubblici da ANAC e privati che conosciamo. Il rapporto regge se lo scambio è in equilibrio: qui vedi chi ci ha portato lavoro e a chi dobbiamo ricambiare.',
      actions: [h('a.btn', { href: '#/crm/concorrenza/progettisti' }, 'Classifica ANAC')] }),
    h('section.im-alerts', alert('da_ricambiare', t.da_ricambiare, 'da ricambiare: ci hanno dato più di quanto abbiamo dato'), alert('fermo', t.fermo, `fermi da più di ${r.settings.cadence.progettista} giorni`),
      alert('da_conoscere', t.da_conoscere, 'da conoscere: nessun contatto ancora'), alert('forte', t.forte, 'rapporti forti')),
    h('div.im-main', h('section.cv-card.im-list', rows,
      h('div.im-legend', h('span', h('i.dato'), 'lavori che gli abbiamo portato'), h('span', h('i.ric'), 'lavori che ci ha portato'))), aside));
  if (sel) progDrawer(aside, r.progettisti.find(p => p.id === sel), () => again(sel));
}
async function progDrawer(box, p, refresh) {
  if (!p) return fill(box, emptyState('ruler', 'Scegli un progettista'));
  const { scambi } = await get(`/api/crm/impianti/progettisti/${p.id}/scambi`);
  const warn = p.state === 'da_ricambiare' ? h('div.im-warn', h('b', 'Da ricambiare. '), `Ci ha portato ${p.ricevuto} ${p.ricevuto === 1 ? 'lavoro' : 'lavori'}, noi ${p.dato || 'nessuno'}. Coinvolgilo in un'opportunità del radar.`)
    : p.state === 'fermo' ? h('div.im-warn', h('b', 'Fermo. '), `Ultimo contatto ${ago(p.last_contact)}.`) : null;
  fill(box,
    h('div.im-dr-h', h('span.cv-eyebrow', 'Scheda progettista'), h('h2', p.name), h('p.im-sub', dots([p.city || p.province, p.contact ? `${p.contact.name}${p.contact.job ? `, ${p.contact.job}` : ''}` : null]))),
    warn,
    h('div.im-sec-l', 'Dare e avere'),
    scambi.length ? h('div.im-ledger', scambi.map(x => h('div.im-led',
      h('span.im-led-s', { class: x.direction === 'dato' ? 'dato' : 'ric', title: x.direction === 'dato' ? 'Gliel\'abbiamo portato noi' : 'Ce l\'ha portato lui' }, x.direction === 'dato' ? '→' : '←'),
      h('span', h('b', x.title), x.note ? h('div.im-sub', x.note) : null), h('span.im-sub.im-nw', fmtDate(x.happened_on)),
      h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Togli', title: 'Togli', on: { click: async () => { if (await confirmDialog('Togliere questo scambio?', { ok: 'Togli', danger: true })) { await del(`/api/crm/impianti/scambi/${x.id}`); refresh(); } } } }, ic('x', 14)))))
      : h('p.im-sub', 'Nessuno scambio registrato. Quando ci porta un lavoro, o glielo portiamo noi, scrivilo qui.'),
    h('div.im-dr-acts',
      h('button.btn.btn-primary', { type: 'button', on: { click: () => exchangeDialog(p, refresh) } }, ic('plus', 14), 'Registra uno scambio'),
      h('button.btn', { type: 'button', on: { click: () => stepDialog({ subjectId: p.id, subjectName: p.name, onSaved: refresh }) } }, 'Nuovo compito'),
      p.contact?.mobile || p.contact?.phone ? h('a.btn', { href: telHref(p.contact.mobile || p.contact.phone) }, 'Chiama') : null,
      h('a.btn.btn-ghost', { href: schedaHref(p.id) }, 'Scheda CRM')));
}
function exchangeDialog(p, onSaved) {
  let dir = 'ricevuto';
  const pick = choiceChips([['ricevuto', 'Ce l\'ha portato lui'], ['dato', 'Gliel\'abbiamo portato noi']], dir, { label: 'Verso', onChange: k => { dir = k; } });
  const what = input({ placeholder: 'Il lavoro o la presentazione: depuratore di Ortona, incontro col gestore…', maxlength: 300 });
  const when = input({ type: 'date', value: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) });
  const note = h('textarea.input', { rows: 2, maxlength: 2000 });
  const m = cvModal({ size: 'sm', title: h('div', h('h2', 'Registra uno scambio'), h('div.cv-subh', p.name)),
    body: h('div.en-form', h('div.cv-fld', h('span', 'Chi l\'ha portato'), pick.el), fld('Cosa', what), fld('Quando', when), fld('Note', note)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!what.value.trim()) return toast('Scrivi cosa', 'err');
        await post(`/api/crm/impianti/progettisti/${p.id}/scambi`, { direction: dir, title: what.value, happened_on: when.value, note: note.value });
        m.close(); toast('Scambio registrato'); onSaved?.();
      } } }, 'Salva')] });
  setTimeout(() => what.focus(), 50);
}
