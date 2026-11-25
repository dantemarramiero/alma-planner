// Alma Impianti (ALM2-73, canvas «Alma Impianti · radar e CRM» approvato da Dante il 24/11/2026): il modulo della BU
// Impianti sopra il CRM comune. Pagine: Da fare (tavola 7), Radar per settore (tavola 2), Fondi e investitori (tavola 4),
// Progettisti e dare/avere (tavola 5). Le aziende e i contatti sono quelli del CRM: «Scheda» apre la scheda del CRM.
// Stili in css/impianti.css (classi im-*), sopra i pezzi del design v2 del CRM (cv-*).
import { h, fill, toast, fmtDate, loading, confirmDialog } from './ui.js';
import { get, post, put, del, api } from './api.js';
import { store } from './store.js';
import { ic, dots, pill, pageTop, title, card, link, emptyState, cvModal, choiceChips, toggle } from './crm-v2.js';
import { stepDialog, doneDialog } from './crm-commerciale.js';
import { shareDialog, markShareOpened, shareStrip } from './condividi.js';
import { radarTab, openSignal, newSignalDialog, TILES } from './crm-radar.js';
import { garaProgettisti } from './crm-progettisti.js';

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
  const page = parts[1] || 'home';
  const body = h('div.cv.im', loading());
  fill(container, body);
  if (page === 'radar') { const data = store.crmData || await get('/api/crm'); store.crmData = data; return radarTab(body, data, '', { scope: 'impianti' }); }
  if (page === 'home') return homePage(body);
  if (page === 'opportunita') return Number(parts[2]) ? oppPage(body, Number(parts[2])) : oppListPage(body);
  if (page === 'energivori') return energivoriPage(body);
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
      actions: [h('button.btn', { type: 'button', on: { click: () => findFundsDialog(id => again(id)) } }, ic('sparkles', 15), 'Trova fondi con Alma'), h('button.btn.btn-primary', { type: 'button', on: { click: () => newFundDialog(id => again(id)) } }, ic('plus', 15), 'Nuovo fondo')] }),
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

// ════ tappa 2 (ALM2-77) ════════════════════════════════════════════════════════════════════════
const STAGES = [['origination', 'Origination'], ['fattibilita', 'Fattibilità'], ['offerta', 'Offerta EPC'], ['negoziazione', 'Negoziazione'], ['firmato', 'Firmato']];
const stageName = k => (k === 'persa' ? 'Persa' : STAGES.find(s => s[0] === k)?.[1] || k);
const VERTEX = { fondo: 'Fondo', progettista: 'Progettista', sito: 'Sito' };
const secDot = k => h('span.im-dot', { style: { background: SECTORS.find(s => s[0] === k)?.[2] || 'var(--cv-muted)' }, 'aria-hidden': 'true' });
const triPills = o => h('div.im-tags', [['fondo', o.fund_name], ['progettista', o.designer_name], ['sito', o.site_name]].map(([k, name]) =>
  pill(`${VERTEX[k]}: ${name || 'da trovare'}`, name ? 'gr' : 'am')));

// ── Home (tavola 1) ─────────────────────────────────────────────────────────────────────────────
async function homePage(box) {
  const r = await get('/api/crm/impianti/home');
  const t = r.totals;
  const parts = [t.fresh ? `${t.fresh} ${t.fresh === 1 ? 'segnale nuovo' : 'segnali nuovi'} da guardare` : 'nessun segnale nuovo questa settimana',
    t.incomplete ? `${t.incomplete} ${t.incomplete === 1 ? 'opportunità' : 'opportunità'} a cui manca un pezzo` : null,
    t.funds_late ? `${t.funds_late} ${t.funds_late === 1 ? 'fondo da risentire' : 'fondi da risentire'}` : null].filter(Boolean).join(', ');
  const data = store.crmData || await get('/api/crm');
  store.crmData = data;
  fill(box,
    pageTop({ eyebrow: 'Alma Impianti · Home', heading: title('La settimana di', 'Alma Impianti'), sub: `${parts[0].toUpperCase()}${parts.slice(1)}.`,
      actions: [h('a.btn', { href: '#/impianti/radar' }, 'Apri il radar'), h('button.btn.btn-primary', { type: 'button', on: { click: () => newSignalDialog(data, () => homePage(box)) } }, ic('plus', 15), 'Segnala un\'opportunità')] }),
    h('section.im-sectors-row', r.sectors.map(s => h('a.im-sector', { href: '#/impianti/radar' },
      h('div.im-sector-h', h('span.im-dot', { style: { background: s.color } }), h('b', s.label)),
      h('div.im-sector-v', h('span', s.value ? eur(s.value) : '—'), h('small', 'in pipeline')),
      h('div.im-tags', pill(`${s.fresh} ${s.fresh === 1 ? 'segnale nuovo' : 'segnali nuovi'}`, s.fresh ? 'or' : ''), pill(`${s.big} oltre ${eur(r.settings.big_amount)}`, s.big ? 'dark' : ''))))),
    h('p.im-sub.im-note', `«Oltre ${eur(r.settings.big_amount)}» è la fascia che preferiamo: nel radar la trovi tra gli importi.`),
    h('div.im-grid2',
      card({ title: 'Opportunità da completare', icon: 'triangle', count: t.incomplete, right: link('Tutte le opportunità', { href: '#/impianti/opportunita' }) },
        h('p.im-sub.im-pad', 'Un lavoro si vince quando conosciamo chi paga, chi progetta e dove si fa. Qui i progetti e le opportunità a cui manca uno dei tre.'),
        r.incomplete.length ? r.incomplete.map(o => h('a.im-opp', { href: `#/impianti/opportunita/${o.id}` },
          h('div', h('div.im-row-top', h('b', o.title), pill(sectorName(o.sector) || 'Senza settore', 'line'), h('span.im-sub', eur(o.amount))), triPills(o)),
          h('span.im-or.im-nw', `Trova ${o.missing[0] === 'fondo' ? 'un fondo' : o.missing[0] === 'progettista' ? 'il progettista' : 'il sito'} ›`)))
          : emptyState('check', 'Tutte le opportunità hanno chi paga, chi progetta e dove si fa.')),
      card({ title: 'Segnali caldi della settimana', icon: 'flame', right: link('Radar', { href: '#/impianti/radar' }) },
        r.hot.length ? r.hot.map(g => h('button.im-hot', { type: 'button', on: { click: () => openSignal(g.id, () => homePage(box), data) } },
          h('span.im-hot-s', String(g.score)), h('span', h('b', g.title), h('small', dots([sectorName(g.sector), g.entity, g.amount ? eur(g.amount) : '', g.region])))))
          : emptyState('radar', 'Nessun segnale nuovo negli ultimi 14 giorni.'))),
    h('div.im-grid2',
      card({ title: 'Fondi da risentire', icon: 'landmark', right: link('Fondi', { href: '#/impianti/fondi' }) },
        r.funds.length ? r.funds.map(f => h('div.im-li', h('div', h('b', f.name), h('div.im-sub', dots([(f.techs || []).map(sectorName).join(', '), f.days === null ? 'mai sentito' : `ultimo contatto ${f.days} giorni fa`, f.matches ? `${f.matches} progetti abbinati` : '']))),
          h('a.btn.btn-sm', { href: `#/impianti/fondi/${f.id}` }, f.matches ? 'Mostra abbinamenti' : 'Apri')))
          : emptyState('landmark', t.funds_all ? 'Tutti i fondi sentiti di recente.' : 'Nessun fondo ancora: aggiungili da «Fondi e investitori» o con «Trova fondi con Alma».')),
      card({ title: 'Progettisti: dare e avere', icon: 'ruler', right: link('Progettisti', { href: '#/impianti/progettisti' }) },
        r.progettisti.length ? r.progettisti.map(p => { const tot = p.dato + p.ricevuto || 1; return h('a.im-li', { href: `#/impianti/progettisti/${p.id}` }, h('div', h('b', p.name), h('div.im-sub', p.city || '')),
          h('div.im-recip', { style: { width: '170px' } }, h('span.im-recip-bar', h('i.dato', { style: { width: `${Math.round(p.dato / tot * 100)}%` } }), h('i.ric', { style: { width: `${Math.round(p.ricevuto / tot * 100)}%` } })),
            h('span.im-sub', `${p.dato} dati · ${p.ricevuto} ricevuti${p.ricevuto > p.dato ? ' · ricambia' : ''}`))); })
          : emptyState('ruler', 'Nessuno scambio registrato coi progettisti.'))));
}

// ── Opportunità: elenco e scheda col triangolo (tavola 3) ───────────────────────────────────────
let oppState = { st: '' };
async function oppListPage(box) {
  const r = await get('/api/crm/impianti/opportunita');
  const again = () => oppListPage(box);
  const all = r.opportunities;
  const shown = all.filter(o => (oppState.st ? o.imp_stage === oppState.st : o.imp_stage !== 'persa'));
  const chip = (k, l, n) => h('button.im-alert', { type: 'button', class: oppState.st === k ? 'on' : '', 'aria-pressed': String(oppState.st === k), on: { click: () => { oppState.st = k; again(); } } }, h('b', String(n)), l);
  const go = id => { location.hash = `#/impianti/opportunita/${id}`; };
  fill(box,
    pageTop({ eyebrow: 'Alma Impianti · Opportunità', heading: title('Le opportunità', 'della BU'),
      sub: 'Quelle con «Interessa» dal radar o già su BOSS, con la fase e chi paga, chi progetta, dove si fa. Le offerte restano in BOSS.',
      actions: [h('a.btn', { href: '#/impianti/radar' }, 'Trovane altre nel radar')] }),
    h('section.im-stages', chip('', 'aperte', all.filter(o => o.imp_stage !== 'persa').length), STAGES.map(([k, l]) => chip(k, l, all.filter(o => o.imp_stage === k).length)), chip('persa', 'perse', all.filter(o => o.imp_stage === 'persa').length)),
    h('section.cv-card.im-list', shown.length ? h('div.im-table-box', h('table.im-table',
      h('thead', h('tr', ['Opportunità', 'Settore', 'Valore', 'Fase', 'Paga · progetta · sito', ''].map(x => h('th', x)))),
      h('tbody', shown.map(o => h('tr', { tabIndex: 0, on: { click: () => go(o.id), keydown: e => { if (e.key === 'Enter') go(o.id); } } },
        h('td', h('b', o.title), h('div.im-sub', dots([o.site_name || o.entity, o.region, o.owner_name]))),
        h('td.im-nw', o.sector ? [secDot(o.sector), sectorName(o.sector)] : h('span.im-sub', '—')),
        h('td.im-nw', eur(o.amount)),
        h('td', pill(stageName(o.imp_stage), o.imp_stage === 'firmato' ? 'gr' : o.imp_stage === 'persa' ? 'rd' : 'bl')),
        h('td', h('div.im-tri-mini', [['fondo', o.fund_name], ['progettista', o.designer_name], ['sito', o.site_name]].map(([k, n]) => h('span', { class: n ? 'ok' : '', title: `${VERTEX[k]}: ${n || 'da trovare'}` }, VERTEX[k][0])))),
        h('td.im-or.im-nw', o.missing.length ? `manca ${o.missing.map(m => VERTEX[m].toLowerCase()).join(' e ')}` : ''))))))
      : emptyState('triangle', oppState.st ? 'Nessuna opportunità in questa fase.' : 'Nessuna opportunità ancora: premi «Interessa» su un segnale del radar.')));
}

async function oppPage(box, id) {
  const r = await get(`/api/crm/impianti/opportunita/${id}`);
  const o = r.opportunity;
  const again = () => oppPage(box, id);
  markShareOpened('impianti', id); // ALM2-87: «aperta» per chi l'ha ricevuta con Condividi
  const save = async body => { await put(`/api/crm/impianti/opportunita/${id}`, body); again(); };
  const stepIdx = STAGES.findIndex(s => s[0] === o.imp_stage);
  const big = o.amount >= r.settings.big_amount;
  const header = h('header.im-hero',
    h('div.im-hero-top',
      h('div.cv-grow', h('div.im-tags', o.sector ? h('span.cv-pill.dark', secDot(o.sector), sectorName(o.sector)) : null, big ? pill(`Oltre ${eur(r.settings.big_amount)}`, 'or') : null, o.source ? pill(`dal radar · ${o.source}`, 'line') : null),
        h('h1', o.title), h('p', dots([o.site_name || o.entity, o.place || o.region, o.amount ? `valore stimato ${eur(o.amount)}` : '', o.owner_name ? `segue ${o.owner_name}` : '']))),
      h('div.im-acts', h('button.btn', { type: 'button', on: { click: () => openSignal(o.id, again, store.crmData || {}) } }, 'Apri nel radar'),
        h('button.btn.sh-btn', { type: 'button', on: { click: () => shareDialog({ kind: 'impianti', id }) } }, ic('share-2', 14), 'Condividi'), // ALM2-87
        o.subject_id ? h('button.btn.btn-primary', { type: 'button', on: { click: () => stepDialog({ subjectId: o.subject_id, subjectName: o.site_name, onSaved: again }) } }, ic('plus', 14), 'Nuovo compito') : null)),
    h('ol.im-stepper', { 'aria-label': 'Fase' }, STAGES.map(([k, l], i) => h('li', h('button', { type: 'button', class: o.imp_stage === 'persa' ? '' : i < stepIdx ? 'done' : i === stepIdx ? 'on' : '', 'aria-current': i === stepIdx ? 'step' : null,
      on: { click: () => save({ imp_stage: k }) } }, l)))),
    h('div.im-hero-ft', o.imp_stage === 'persa' ? [pill('Persa', 'rd'), link('Riapri', { on: { click: () => save({ imp_stage: 'origination' }) } })]
      : link('Segna come persa', { on: { click: async () => { if (await confirmDialog('Segnare l\'opportunità come persa?', { ok: 'Persa', danger: true })) save({ imp_stage: 'persa' }); } } })));

  const lastTxt = w => (w?.last_contact ? `ultimo contatto ${ago(w.last_contact)}` : 'mai sentito');
  const known = (label, w, name, key) => h('div.im-node.ok',
    h('div.im-node-h', h('span.cv-eyebrow', label), pill(w?.last_contact ? 'lo conosciamo' : 'nel CRM', 'gr')),
    h('b', name), w?.contact ? h('span.im-sub', dots([w.contact.name, w.contact.job])) : null, h('span.im-sub', lastTxt(w)),
    h('div.im-acts.im-left', h('a.btn.btn-sm', { href: schedaHref(w.id) }, 'Scheda'), w?.contact?.mobile || w?.contact?.phone ? h('a.btn.btn-sm', { href: telHref(w.contact.mobile || w.contact.phone) }, 'Chiama') : null,
      w?.contact?.email ? h('a.btn.btn-sm', { href: mailHref(w.contact.email) }, 'Scrivi') : null,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => pickSubject(label, s => save({ [key]: s.id })) } }, 'Cambia')));
  const fundNode = o.fund_id ? known('Chi finanzia', o.fund, o.fund_name, 'fund_id')
    : h('div.im-node.miss', h('div.im-node-h', h('span.cv-eyebrow', 'Chi finanzia'), pill('da trovare', 'am')),
      r.ideas.funds.length ? [h('b', `${r.ideas.funds.length} ${r.ideas.funds.length === 1 ? 'fondo ha un mandato che combacia' : 'fondi hanno un mandato che combacia'}`),
        r.ideas.funds.map(f => h('div.im-idea', h('div', h('b', f.name), h('div.im-sub', dots([f.reasons.join(', '), f.known ? 'lo conosciamo' : 'nessun contatto']))),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => save({ fund_id: f.id }) } }, 'Scegli')))]
        : h('p.im-sub', 'Nessun fondo col mandato giusto: compila i mandati in «Fondi e investitori», o cercane uno nel CRM.'),
      h('div.im-acts.im-left', h('button.btn.btn-sm', { type: 'button', on: { click: () => pickSubject('Chi finanzia', s => save({ fund_id: s.id })) } }, ic('search', 13), 'Cerca nel CRM'), h('a.btn.btn-ghost.btn-sm', { href: '#/impianti/fondi' }, 'Fondi')));
  const desNode = o.designer_id ? known('Chi progetta', o.designer, o.designer_name, 'designer_id')
    : h('div.im-node.miss', h('div.im-node-h', h('span.cv-eyebrow', 'Chi progetta'), pill('da trovare', 'am')),
      garaProgettisti(o.id),
      r.ideas.designers.length ? [h('span.im-sub', 'Progettisti del CRM'), r.ideas.designers.map(d => h('div.im-idea', h('div', h('b', d.name), h('div.im-sub', dots([d.city, d.ricevuto || d.dato ? `${d.dato} dati · ${d.ricevuto} ricevuti` : '']))),
        h('button.btn.btn-sm', { type: 'button', on: { click: () => save({ designer_id: d.id }) } }, 'Scegli')))] : null,
      h('div.im-acts.im-left', h('button.btn.btn-sm', { type: 'button', on: { click: () => pickSubject('Chi progetta', s => save({ designer_id: s.id })) } }, ic('search', 13), 'Cerca nel CRM')));
  const siteNode = o.subject_id ? known('Dove si fa', o.site, o.site_name, 'subject_id')
    : h('div.im-node.miss', h('div.im-node-h', h('span.cv-eyebrow', 'Dove si fa'), pill('da trovare', 'am')),
      h('p.im-sub', o.entity ? `Nel segnale: «${o.entity}». Collegalo all'azienda del CRM.` : 'L\'azienda o l\'ente proprietario del sito.'),
      h('div.im-acts.im-left', h('button.btn.btn-sm', { type: 'button', on: { click: () => pickSubject('Dove si fa', s => save({ subject_id: s.id }), o.entity || '') } }, ic('search', 13), 'Cerca nel CRM')));
  const nOk = 3 - o.missing.length;

  fill(box,
    h('a.im-crumb', { href: '#/impianti/opportunita' }, '‹ Opportunità', o.sector ? ` · ${sectorName(o.sector)}` : ''),
    header,
    shareStrip('impianti', id), // ALM2-87: chi l'ha condivisa, con chi e se l'hanno aperta
    h('div.im-main',
      h('section.cv-card.im-tri-card',
        h('div.im-row-top', h('div.cv-grow', h('h2', 'Chi paga, chi progetta, dove si fa'), h('p.im-sub', nOk === 3 ? 'Li conosciamo tutti e tre.' : `${['Nessuno', 'Uno', 'Due'][nOk]} su tre li conosciamo.`)),
          o.missing.length ? pill(`Manca ${o.missing.map(m => VERTEX[m].toLowerCase()).join(' e ')}`, 'am') : pill('Completo', 'gr')),
        h('div.im-tri', h('div.im-tri-top', fundNode), desNode, siteNode),
        h('p.im-sub', 'I fondi si abbinano dal loro mandato: settore, taglia del ticket, regione e fase del progetto.')),
      h('aside.im-side',
        card({ title: 'Prossimo compito', icon: 'alarm-clock' },
          r.steps.length ? r.steps.map(s => h('div.im-li', h('div', h('b', s.title), h('div.im-sub', dots([s.subject_name, s.owner_name, `entro ${fmtDate(s.due_date)}`])))))
            : h('p.im-sub', 'Nessun compito aperto su queste aziende.')),
        card({ title: 'Numeri', icon: 'banknote' }, h('dl.im-dl', h('dt', 'Valore stimato'), h('dd', eur(o.amount)), h('dt', 'Punteggio del radar'), h('dd', String(o.score ?? '—')), h('dt', 'Fase'), h('dd', stageName(o.imp_stage)),
          h('dt', 'Offerta e margine'), h('dd', 'in BOSS'))),
        card({ title: 'Storia', icon: 'history' }, r.history.length ? h('div.im-ledger', r.history.map(x => h('div.im-hist', h('span.im-sub.im-nw', x.at ? fmtDate(String(x.at).slice(0, 10)) : ''), h('span', x.text)))) : h('p.im-sub', '—')))));
}
// scegli un'azienda del CRM per un vertice del triangolo
function pickSubject(label, onPick, start = '') {
  const q = input({ type: 'search', value: start, placeholder: 'Nome dell\'azienda o dello studio', 'aria-label': 'Cerca' });
  const out = h('div.im-pick');
  let t;
  const run = async () => {
    const val = q.value.trim();
    if (val.length < 2) return fill(out, h('p.im-sub', 'Scrivi almeno due lettere.'));
    const r = await get(`/api/crm/impianti/cerca?q=${encodeURIComponent(val)}`);
    fill(out, r.subjects.length ? r.subjects.map(s => h('button.im-idea', { type: 'button', on: { click: () => { m.close(); onPick(s); } } },
      h('div', h('b', s.name), h('div.im-sub', dots([s.kind_label, s.city]))), h('span.im-or', 'Scegli')))
      : h('p.im-sub', 'Nessuna azienda con questo nome nel CRM. Aggiungila dal CRM e torna qui.'));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  const m = cvModal({ size: 'sm', title: h('h2', label), body: h('div.en-form', q, out), actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')] });
  setTimeout(() => { q.focus(); if (start) run(); }, 50);
}

// ── Energivori (tavola 6) ───────────────────────────────────────────────────────────────────────
let enState = { region: '', roof: false, nocrm: false, q: '', cls: '' };
async function energivoriPage(box) {
  const r = await get('/api/crm/impianti/energivori');
  const again = () => energivoriPage(box);
  const regions = Object.keys(r.regions).sort((a, b) => a.localeCompare(b, 'it'));
  const qn = enState.q.trim().toLowerCase();
  const shown = r.energivori.filter(e => (!enState.region || e.region === enState.region) && (!enState.roof || e.roof_m2 >= 5000) && (!enState.nocrm || !e.subject_id)
    && (!qn || `${e.name} ${e.vat} ${e.city}`.toLowerCase().includes(qn)) && (!enState.cls || e.csea_class === enState.cls));
  const classes = [...new Set(r.energivori.map(e => e.csea_class).filter(Boolean))].sort();
  const cls = h('select.select', { 'aria-label': 'Classe CSEA' }, [['', 'Classe CSEA: tutte'], ...classes.map(c => [c, `Classe ${c} · ${r.energivori.filter(e => e.csea_class === c).length}`])].map(([k, l]) => h('option', { value: k, selected: k === enState.cls }, l)));
  cls.addEventListener('change', () => { enState.cls = cls.value; again(); });
  // ricerca: si ridisegna dopo una pausa e il cursore torna nel campo
  const q = h('input.input', { type: 'search', value: enState.q, placeholder: 'Cerca per nome o P. IVA', 'aria-label': 'Cerca', style: { maxWidth: '240px' } });
  let qt;
  q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(async () => { enState.q = q.value; await again(); const el = document.querySelector('.im-filters input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350); });
  const reg = h('select.select', { 'aria-label': 'Regione' }, [['', 'Tutta Italia'], ...regions.map(x => [x, `${x} · ${r.regions[x]}`])].map(([k, l]) => h('option', { value: k, selected: k === enState.region }, l)));
  reg.addEventListener('change', () => { enState.region = reg.value; again(); });
  const roof = toggle(enState.roof, 'Tetto libero oltre 5.000 m²'); roof.input.addEventListener('change', () => { enState.roof = roof.input.checked; again(); });
  const nocrm = toggle(enState.nocrm, 'Solo chi non è nel CRM'); nocrm.input.addEventListener('change', () => { enState.nocrm = nocrm.input.checked; again(); });
  const max = Math.max(1, ...Object.values(r.regions));
  const map = h('section.cv-card.im-map', h('div.im-sec-l', 'Dove sono · Italia'),
    h('div.im-map-grid', Object.entries(TILES).map(([name, [c, row, short]]) => {
      const n = r.regions[name] || 0;
      const lvl = !n ? '' : n / max > 0.66 ? 'h3' : n / max > 0.33 ? 'h2' : 'h1';
      return h('button.im-tile2', { type: 'button', class: [lvl, enState.region === name ? 'sel' : ''].join(' '), style: { gridColumn: String(c + 1), gridRow: String(row + 1) },
        title: `${name}: ${n} ${n === 1 ? 'azienda' : 'aziende'}`, 'aria-pressed': String(enState.region === name), on: { click: () => { enState.region = enState.region === name ? '' : name; again(); } } }, short);
    })),
    h('p.im-sub', 'Più arancio = più aziende energivore. Tocca una regione per filtrare.'));
  const bring = async e => { const out = await post(`/api/crm/impianti/energivori/${e.id}/radar`); toast('Nel radar, settore Efficientamento'); location.hash = `#/impianti/opportunita/${out.signal_id}`; };
  const table = shown.length ? h('div.im-table-box', h('table.im-table.nohover',
    h('thead', h('tr', ['Punteggio', 'Azienda', 'Consumo', 'Tetto libero', 'Risparmio stimato', 'Incentivi', ''].map(x => h('th', x)))),
    h('tbody', shown.slice(0, 300).map(e => h('tr',
      h('td', h('span.im-hot-s', String(e.score))),
      h('td', h('b', e.name), h('div.im-sub', dots([e.sector, [e.city, e.province].filter(Boolean).join(' '), e.region])), h('div.im-tags', e.csea_class ? pill(`CSEA ${e.csea_class}`, 'bl') : null, e.subject_id ? pill(`nel CRM${(e.subject_roles || []).includes('cliente') ? ' · cliente' : ''}`, 'line') : null)),
      h('td.im-nw', e.consumption_gwh != null ? `${Number(e.consumption_gwh).toLocaleString('it-IT')} GWh/anno` : '—'),
      h('td.im-nw', e.roof_m2 ? `${Number(e.roof_m2).toLocaleString('it-IT')} m²` : '—'),
      h('td.im-nw', e.saving_eur ? h('b.im-gr', `≈ ${eur(e.saving_eur)}/anno`) : '—'),
      h('td.im-sub', e.incentives.join(', ') || '—'),
      h('td', e.signal_id ? h('a.btn.btn-sm', { href: `#/impianti/opportunita/${e.signal_id}` }, 'Apri') : h('button.btn.btn-sm', { type: 'button', on: { click: () => bring(e) } }, 'Porta nel radar')))))))
    : emptyState('factory', r.energivori.length ? 'Nessuna azienda con questi filtri.' : 'L\'elenco è vuoto: carica il file delle aziende energivore (per esempio l\'elenco pubblicato dalla CSEA) con «Carica l\'elenco».');
  fill(box,
    pageTop({ eyebrow: 'Clienti · Energivori', heading: title('Chi consuma tanto e', 'spreca'),
      sub: 'L\'elenco delle aziende energivore caricato da file, con il punteggio che unisce consumo e tetto libero. Il risparmio è una stima: si conferma con la diagnosi.',
      actions: [h('button.btn', { type: 'button', on: { click: () => howDialog(r.estimate) } }, 'Come si calcola'), h('button.btn.btn-primary', { type: 'button', on: { click: () => uploadDialog(again) } }, ic('upload', 15), 'Carica l\'elenco')] }),
    h('div.im-filters', q, reg, classes.length ? cls : null, roof.el, nocrm.el, h('span.im-sub', `${shown.length} di ${r.energivori.length} aziende${r.sources.length ? ` · da ${r.sources.join(', ')}` : ''}`)),
    h('div.im-main', map, h('section.cv-card.im-list', table)));
}
function howDialog(est) {
  const m = cvModal({ size: 'sm', title: h('h2', 'Come si calcola'),
    body: h('div.en-form',
      h('p', h('b', 'Punteggio (0–100): '), 'consumo di energia fino a 60 punti (pieno da circa 100 GWh l\'anno) e tetto libero fino a 40 punti (pieno da 20.000 m²).'),
      h('p', h('b', 'Elenco CSEA: '), 'riporta solo P. IVA, ragione sociale e classe di agevolazione, senza consumi né comune. Queste aziende partono da 40 punti perché sono certificate energivore; la classe si vede e si filtra ma non pesa sul punteggio. Con «Porta nel radar» entrano nel CRM, dove «Cerca su internet» completa sede e settore.'),
      h('p', h('b', 'Risparmio stimato: '), `il ${Math.round(est.efficiency * 100)}% del consumo con l'efficienza, più l'energia del fotovoltaico sul tetto (${est.kwp_per_m2} kWp per m², ${est.mwh_per_kwp} MWh per kWp l'anno), a ${est.price_mwh} € per MWh.`),
      h('p', h('b', 'Incentivi: '), 'Transizione 5.0 se c\'è un consumo, certificati bianchi oltre 10 GWh, autoconsumo se c\'è il tetto. Da verificare caso per caso.'),
      h('p.im-sub', 'Sono stime per scegliere chi chiamare prima: i numeri veri vengono dalla diagnosi energetica.')),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: () => m.close() } }, 'Ho capito')] });
}
function uploadDialog(onDone) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', 'aria-label': 'Elenco delle aziende energivore' });
  const out = h('div');
  const drop = h('label.cv-drop', file, h('span.cv-ib.or', ic('upload', 18)), h('span.cv-t5', 'Scegli o trascina qui l\'elenco'),
    h('span.cv-small.cv-muted', 'Excel o CSV. Colonne riconosciute: ragione sociale, partita IVA, comune, provincia, regione, settore o ATECO, consumo (GWh, MWh o kWh), tetto (m²).'));
  let buf = null, name = '';
  const go = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: async () => {
    const r = await api('POST', `/api/crm/impianti/energivori?nome=${encodeURIComponent(name)}`, buf, { raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
    m.close(); toast(`${r.added} aziende nuove, ${r.updated} aggiornate`); onDone?.();
  } } }, 'Carica');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    name = f.name; buf = await f.arrayBuffer();
    fill(out, loading());
    try {
      const pre = await api('POST', '/api/crm/impianti/energivori/anteprima', buf, { raw: true, quiet: true, headers: { 'Content-Type': 'application/octet-stream' } });
      fill(out, h('div.cv-box.big', h('div.cv-t5', `${pre.total} aziende nel file · ${pre.fresh} nuove`),
        h('div.cv-small.cv-muted', `Colonne riconosciute: ${Object.values(pre.columns).join(', ')}`),
        h('div.im-ledger', pre.sample.map(s => h('div.im-hist', h('b', s.name), h('span.im-sub', dots([s.city, s.region, s.consumption_gwh != null ? `${s.consumption_gwh} GWh` : '', s.roof_m2 ? `${s.roof_m2} m²` : '', `punteggio ${s.score}`])))))));
      go.disabled = false;
    } catch (err) { fill(out, h('p.im-warn', err.message || 'Il file non si legge')); go.disabled = true; }
  });
  const m = cvModal({ size: 'md', title: h('h2', 'Carica l\'elenco degli energivori'), body: h('div.en-form', drop, out,
    h('p.cv-hint', 'Le aziende già caricate (stessa partita IVA, o stesso nome e comune) si aggiornano, non si doppiano.')),
  actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go] });
}

// «Trova fondi con Alma»: Alma propone fondi reali dal web; si aggiungono al CRM solo quelli spuntati
function findFundsDialog(onDone) {
  const sector = h('select.select', { 'aria-label': 'Settore' }, [['', 'Tutti i settori'], ...SECTORS.map(([k, l]) => [k, l])].map(([k, l]) => h('option', { value: k }, l)));
  const region = h('select.select', { 'aria-label': 'Regione' }, [['', 'Tutta Italia'], ...REGIONS.map(x => [x, x])].map(([k, l]) => h('option', { value: k }, l)));
  const out = h('div.im-pick');
  let found = [];
  const picked = new Set();
  const add = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: async () => {
    const r = await post('/api/crm/impianti/fondi/aggiungi', { funds: found.filter((_, i) => picked.has(i)) });
    m.close(); toast(`${r.added} ${r.added === 1 ? 'fondo aggiunto' : 'fondi aggiunti'} al CRM, col mandato proposto da Alma`); onDone?.(r.ids[0]);
  } } }, 'Aggiungi i selezionati');
  const draw = () => {
    add.disabled = !picked.size;
    add.textContent = picked.size ? `Aggiungi ${picked.size} al CRM` : 'Aggiungi i selezionati';
    fill(out, found.length ? found.map((f, i) => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(i), disabled: Boolean(f.existing), 'aria-label': `Scegli ${f.name}` });
      cb.addEventListener('change', () => { cb.checked ? picked.add(i) : picked.delete(i); draw(); });
      return h('label.im-found', cb,
        h('div', h('div.im-row-top', h('b', f.name), f.type ? pill(f.type, 'line') : null, f.existing ? pill('già nel CRM', 'gr') : null),
          h('div.im-sub', dots([f.city, f.techs.map(sectorName).join(', '), f.ticket_min || f.ticket_max ? `ticket ${eur(f.ticket_min)} – ${eur(f.ticket_max)}` : '', f.regions.length ? f.regions.join(', ') : ''])),
          f.why ? h('div.im-what', f.why) : null,
          h('a.im-sub', { href: f.url, target: '_blank', rel: 'noopener' }, 'Fonte')));
    }) : h('p.im-sub', 'Alma non ha trovato fondi nuovi con questi criteri. Prova un altro settore o tutta Italia.'));
  };
  const go = h('button.btn', { type: 'button', on: { click: async () => {
    go.disabled = true; fill(out, h('div.im-sub', 'Alma sta cercando in rete… (circa un minuto)'), loading());
    try { const r = await post('/api/crm/impianti/fondi/cerca', { sector: sector.value, region: region.value }); found = r.funds; picked.clear(); draw(); }
    catch (err) { fill(out, h('p.im-warn', err.message || 'La ricerca non è riuscita: riprova')); }
    go.disabled = false;
  } } }, ic('search', 14), 'Cerca');
  const m = cvModal({ size: 'md', title: h('div', h('h2', 'Trova fondi con Alma'), h('div.cv-subh', 'Fondi e investitori che finanziano impianti in Italia e cercano un costruttore')),
    body: h('div.en-form', h('div.cv-row', { style: { gap: '8px', flexWrap: 'wrap' } }, sector, region, go), out,
      h('p.cv-hint', 'Alma propone, tu scegli: si aggiungono solo quelli spuntati, come lead col tipo «Fondo o investitore» e il mandato che ha trovato (poi lo correggi). Ogni ricerca costa pochi centesimi sul budget del radar Impianti.')),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'), add] });
}
