// Posta e «Progetto da email» (ALM2-55, canvas «Progetto da email» approvato da Dante il 22/11/2026).
// - postaPage (tavola A): la propria casella nel CRM; «Crea progetto commerciale» o il link al progetto/Radar.
// - openProposal (tavola B): cosa ha capito Alma dalla conversazione, persone, email e legami nel CRM.
// - dealHero / dealOverview (tavola D): la scheda del progetto nato da una email: in breve, a chi tocca, termometro,
//   prossima mossa, cronologia unica con le note, impegni presi nelle email, chi conta, legami nel CRM.
import { h, fill, toast, loading, fmtDate, timeAgo, today, addDays, initials, debounce } from './ui.js';
import { get, post } from './api.js';
import { store } from './store.js';
import { ic, pill, cvModal, emptyState } from './crm-v2.js';
import { withMentions } from './social.js';
import { uploadNoteFiles } from './project-meetings.js';

const eur = n => (!Number(n) ? '—' : Number(n) >= 1e6 ? `${(Number(n) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€` : Number(n) >= 1e4 ? `${Math.round(Number(n) / 1e3).toLocaleString('it-IT')} k€` : `${Number(n).toLocaleString('it-IT')} €`);
const when = d => { if (!d) return ''; const s = String(d); const day = s.slice(0, 10); return day === today() ? s.slice(11, 16) : fmtDate(day); };
const firstName = n => String(n || '').replace(/^(Ing|Arch|Geom|Dott|Avv)\.?\s+/i, '').split(' ')[0];
const userName = id => store.users.find(u => u.id === id)?.name || '';
const handleOf = u => String(u?.email || '').split('@')[0];

// ═══ Posta (tavola A) ═════════════════════════════════════════════════════════════════════════════
export async function postaPage(container) {
  const st = { folder: 'arrivo', q: '', list: [], next: null, sel: null };
  const listBox = h('div.pm-items', loading());
  const reader = h('article.pm-reader', emptyState('mail', 'Scegli un\'email a sinistra.'));
  const search = h('input.pm-search', { type: 'search', placeholder: 'Cerca nella posta', 'aria-label': 'Cerca nella posta' });
  const folders = h('div.pm-folders');
  const drawFolders = () => fill(folders, [['arrivo', 'In arrivo'], ['inviate', 'Inviate']].map(([k, l]) => h('button.cv-pill.big', { type: 'button', class: st.folder === k ? 'dark' : 'line', 'aria-pressed': String(st.folder === k), on: { click: () => { st.folder = k; drawFolders(); load(); } } }, l)));
  drawFolders();
  fill(container, h('div.pm',
    h('section.pm-list', h('div.pm-list-h', h('strong', 'Posta'), folders, h('div.pm-search-w', ic('search', 15), search)), listBox),
    reader));
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); load(); }, 300));

  async function load(more = false) {
    if (!more) fill(listBox, loading());
    const qs = new URLSearchParams({ cartella: st.folder, ...(st.q ? { q: st.q } : {}), ...(more && st.next ? { next: st.next } : {}) });
    let r;
    try { r = await get(`/api/crm/posta?${qs}`, { quiet: true }); } catch (err) {
      fill(listBox, emptyState('mail', err?.message || 'La posta non si legge: Microsoft 365 non è collegato o manca il permesso Mail.Read.'));
      return;
    }
    st.list = more ? [...st.list, ...r.messages] : r.messages;
    st.next = r.next;
    drawList();
    if (!more && st.list[0] && !st.sel) open(st.list[0]);
  }
  function drawList() {
    if (!st.list.length) return fill(listBox, emptyState('mail', st.q ? `Nessuna email per «${st.q}».` : 'Nessuna email.'));
    fill(listBox, st.list.map(m => h('button.pm-item', { type: 'button', class: st.sel === m.id ? 'on' : '', on: { click: () => open(m) } },
      h('span.pm-item-r', h('b', st.folder === 'inviate' ? (m.to[0]?.name || m.to[0]?.address || '—') : (m.from.name || m.from.address)), h('small', when(m.date))),
      h('span.pm-item-s', m.subject),
      h('small.pm-item-m', m.project ? [ic('folder', 12), ` nel progetto «${m.project.name}»`] : m.signal ? [ic('radar', 12), ' nel Radar'] : m.in_page > 1 ? `${m.in_page} email` : m.preview.slice(0, 70)))),
    st.next ? h('button.btn.btn-sm.pm-more', { type: 'button', on: { click: () => load(true) } }, 'Altre email') : null);
  }
  async function open(m) {
    st.sel = m.id;
    drawList();
    fill(reader, loading());
    const e = await get(`/api/crm/posta/${encodeURIComponent(m.id)}`);
    const place = e.project ? h('a.btn.pm-in', { href: `#/crm/progetto/${e.project.id}` }, ic('folder', 15), `Nel progetto ${e.project.name}`, ic('chevron-right', 14))
      : e.signal ? h('a.btn.pm-in', { href: `#/crm/lancio/s/${e.signal.id}` }, ic('radar', 15), 'Nel Radar · portala avanti', ic('chevron-right', 14)) : null;
    fill(reader,
      h('div.pm-rhead',
        h('div.pm-rtitle', h('h1', e.subject), h('span.pm-rmeta', `${e.from.name || ''} <${e.from.address}> · a ${e.to.map(x => x.name || x.address).join(', ')}${e.cc.length ? `, cc ${e.cc.map(x => x.name || x.address).join(', ')}` : ''}`), h('small.cv-muted', `${fmtDate(String(e.date).slice(0, 10), { year: true })} ${String(e.date).slice(11, 16)}${e.conversation_count > 1 ? ` · ${e.conversation_count} email nella conversazione` : ''}`)),
        place || h('button.btn.btn-primary.pm-create', { type: 'button', on: { click: () => openProposal(e.id) } }, ic('sparkles', 15), 'Crea progetto commerciale'),
        place ? null : h('button.btn', { type: 'button', on: { click: () => addToProject(e) } }, 'Aggiungi a un progetto')),
      h('div.pm-body', e.body.trim()),
      e.attachments.length ? h('div.pm-atts', e.attachments.map(a => h('span.pm-att', ic('paperclip', 13), `${a.name} · ${(a.size / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`))) : null,
      h('div.pm-also',
        h('div.pm-hint', h('span.pm-hint-k', 'Anche da qui'), h('span', h('b', 'Persone con cui mi scrivo'), ': nel menu di una riga, «Crea progetto dalle sue email».'), h('span', h('b', 'Scheda contatto o azienda'), ', tab Email: «Crea progetto» su una conversazione.')),
        h('div.pm-hint', h('span.pm-hint-k', 'Se è già in un progetto'), h('span', 'Al posto del pulsante arancione compare il progetto in cui sta, come nelle righe a sinistra.'))));
  }
  async function addToProject(e) {
    const { projects } = await get('/api/crm/progetti?vista=miei');
    const m = cvModal({ title: 'Aggiungi a un progetto', body: projects.length ? h('div.pm-pick', projects.map(p => h('button.pm-pick-i', { type: 'button', on: { click: async () => {
      await post(`/api/projects/${p.id}/emails`, { message_ids: [e.id] });
      m.close(); toast(`Email aggiunta a «${p.name}»`); open({ id: e.id });
    } } }, h('b', p.name), h('small', p.steps?.[p.step] || '')))) : emptyState('folder', 'Non segui ancora nessun progetto del CRM.') });
  }
  load();
}

// ═══ Cosa ha capito Alma (tavola B) ═══════════════════════════════════════════════════════════════
// from: { message_id } oppure { email } (da «Persone con cui mi scrivo»: l'ultima email di quella persona)
export async function openProposal(messageId, from = {}) {
  const body = h('div.pp', h('div.pp-wait', loading(), h('p', 'Alma sta leggendo la conversazione…')));
  const m = cvModal({ title: h('div.pp-title', h('span.pp-k', 'Nuovo progetto commerciale · da email'), h('h2', 'Alma sta leggendo la conversazione')), body, size: 'xl' });
  m.box.classList.add('pp-dlg');
  let r;
  try { r = await post('/api/crm/posta/proposta', { ...(messageId ? { message_id: messageId } : {}), ...from }); } catch { m.close(); return; }
  if (r.already) { m.close(); location.hash = r.already.project_id ? `#/crm/progetto/${r.already.project_id}` : `#/crm/lancio/s/${r.already.signal_id}`; return; }
  m.head.querySelector('h2').textContent = `Alma ha letto ${r.messages.length} ${r.messages.length === 1 ? 'email' : 'email'} della conversazione «${r.subject}»`;
  const f = { ...r.fields };
  const people = r.people.map(p => ({ ...p }));
  const extra = new Set();
  const radar = new Set();
  let company = r.company?.kind === 'crm' ? { subject_id: r.company.subject_id } : r.company?.kind === 'nuova' ? { new: { name: r.company.name, domain: r.company.domain } } : null;
  const inp = (k, label, attrs = {}) => { const i = h('input.input', { value: f[k] ?? '', 'aria-label': label, ...attrs, on: { input: e => { f[k] = attrs.type === 'number' ? Number(e.target.value) || null : e.target.value; } } }); return i; };
  const tile = (k, label, tone = '') => h('label.pp-tile', { class: tone }, h('span', label), h('textarea', { rows: 2, 'aria-label': label, on: { input: e => { f[k] = e.target.value; } } }, f[k] || ''));
  const coSel = h('select.select', { 'aria-label': 'Azienda', on: { change: e => {
    const val = e.target.value;
    company = val === 'new' ? { new: { name: r.company?.name || '', domain: r.company?.domain || '' } } : val ? { subject_id: Number(val) } : null;
  } } },
  r.company?.kind === 'nuova' ? h('option', { value: 'new' }, `${r.company.name} · nuova, da creare`) : null,
  r.company_options.map(o => h('option', { value: String(o.subject_id), selected: r.company?.subject_id === o.subject_id }, `${o.name} · nel CRM`)),
  h('option', { value: '' }, 'Nessuna azienda'));
  const buSel = h('select.select', { 'aria-label': 'BU', on: { change: e => { f.bu = e.target.value; } } }, h('option', { value: '' }, '—'), r.asa.map(a => h('option', { value: a.key, selected: a.key === f.bu }, a.label)));
  const tipoSel = h('select.select', { 'aria-label': 'Tipo di progetto', on: { change: e => { f.tipo = e.target.value; } } }, [['trattativa', 'Trattativa privata'], ['gara', 'Gara']].map(([k, l]) => h('option', { value: k, selected: f.tipo === k }, l)));
  const tag = p => p.kind === 'crm' ? pill('nel CRM', 'gr') : p.kind === 'collega' ? pill('entra in squadra', '') : pill('nuova, dalla firma', 'or');
  const left = h('div.pp-l',
    h('label.pp-f', h('span', 'Titolo del progetto'), inp('title', 'Titolo del progetto')),
    h('div.pp-f', h('span', 'Il concetto, come l\'ha capito Alma'),
      h('div.pp-tiles', tile('cosa', 'Cosa'), tile('dove', 'Dove'), tile('per_chi', 'Per chi'),
        h('label.pp-tile', h('span', 'Importo'), h('textarea', { rows: 2, 'aria-label': 'Importo', on: { input: e => { f.importo_testo = e.target.value; const n = Number(String(e.target.value).replace(/[^\d,]/g, '').replace(',', '.')); if (/milion|mln|m€/i.test(e.target.value) && n) f.importo = Math.round(n * 1e6); else if (n > 1000) f.importo = Math.round(n); } } }, f.importo ? `circa ${eur(f.importo)}${f.importo_testo ? ` (${f.importo_testo})` : ''}` : (f.importo_testo || ''))),
        tile('tempi', 'Tempi'), tile('prossimo_passo', 'Prossimo passo', 'or'))),
    h('div.pp-row3',
      h('label.pp-f', h('span', 'Azienda'), coSel, h('small', f.committente ? `Committente: ${f.committente}` : 'Il committente si aggiunge quando ha un nome')),
      h('label.pp-f', h('span', 'BU'), buSel, h('small', 'dalle parole della email')),
      h('label.pp-f', h('span', 'Tipo di progetto'), tipoSel, h('small', 'gara se si parla di bando o CIG')),
      h('label.pp-f', h('span', 'Offerte entro'), inp('scadenza', 'Offerte entro', { type: 'date' }), h('small', 'dalla email'))),
    h('div.pp-f', h('span', 'Persone da collegare'),
      people.length ? h('div.pp-people', people.map(p => h('label.pp-person',
        h('input', { type: 'checkbox', checked: p.on, on: { change: e => { p.on = e.target.checked; } } }),
        h('span.pp-grow', h('b', p.name || p.email), [p.job, p.subject || (p.kind === 'nuova' ? p.company?.name : ''), p.mobile ? `cell. ${p.mobile}` : ''].filter(Boolean).length ? ` · ${[p.job, p.subject || (p.kind === 'nuova' ? p.company?.name : ''), p.mobile ? `cell. ${p.mobile}` : ''].filter(Boolean).join(', ')}` : ` · ${p.email}`),
        tag(p), h('small.cv-muted', p.role)))) : h('p.cv-muted', 'Nessuna persona oltre a te.')),
    h('div.pp-f', h('span', 'Email che entrano nel progetto'),
      h('div.pp-mails',
        h('span', h('b', `${r.messages.length} ${r.messages.length === 1 ? 'email' : 'email'}`), ` della conversazione${r.messages.length > 1 ? `, dal ${fmtDate(String(r.messages[0].date).slice(0, 10))} a oggi` : ''}${r.attachments.length ? `, con ${r.attachments.length} ${r.attachments.length === 1 ? 'allegato' : 'allegati'} (${r.attachments.join(', ')})` : ''}`),
        h('span.cv-muted', 'Le risposte nuove a questa conversazione si aggiungeranno da sole.'),
        r.extra.map(x => h('label.pp-extra', h('input', { type: 'checkbox', on: { change: e => { if (e.target.checked) extra.add(x.id); else extra.delete(x.id); } } }),
          h('span', `Anche «${x.subject}» di ${x.from.name || x.from.address} (${fmtDate(String(x.date).slice(0, 10))}): ${x.why}`))))));
  const right = h('aside.pp-r',
    h('div.pp-r-h', h('span.pp-k', 'Cosa sa già il CRM'), h('small', 'Legami trovati con persone, azienda e tema')),
    r.insights.length ? r.insights.map(x => h('div.pp-ins', { class: x.kind === 'attenzione' ? 'warn' : '' },
      h('b', x.title), h('span', x.text),
      x.signal_id ? h('label.pp-ins-c', h('input', { type: 'checkbox', checked: true, on: { change: e => { if (e.target.checked) radar.add(x.signal_id); else radar.delete(x.signal_id); } } }), 'collegala al progetto') : null,
      x.link ? h('a', { href: x.link, target: '_blank' }, `${x.link_label || 'Apri'} ›`) : null))
      : h('div.pp-ins', h('span', 'Niente nel CRM per ora: azienda, persone e tema sono nuovi.')),
    h('small.pp-r-f', 'Ogni legame dice da dove viene. Alma non inventa: se un dato manca, lo scrive.'));
  for (const x of r.insights) if (x.signal_id) radar.add(x.signal_id);
  fill(body, h('div.pp-grid', left, right));
  const save = async mode => {
    if (!String(f.title || '').trim()) return toast('Scrivi il titolo del progetto', 'err');
    btns.forEach(b => { b.disabled = true; });
    try {
      const out = await post('/api/crm/posta/crea', { conversation_id: r.conversation_id, message_id: r.message_id, fields: f, company, people, extra_ids: [...extra], link_signal_ids: [...radar] });
      m.close();
      if (mode === 'radar') { toast('Salvata nel Radar: la porti avanti quando vuoi'); location.hash = '#/crm/radar'; } else location.hash = `#/crm/lancio/s/${out.signal_id}`;
    } catch { btns.forEach(b => { b.disabled = false; }); }
  };
  const btns = [h('button.btn', { type: 'button', on: { click: () => save('radar') } }, 'Salva solo nel Radar'), h('button.btn.btn-primary', { type: 'button', on: { click: () => save('lancio') } }, 'Avanti: sala di lancio')];
  body.append(h('div.pp-foot', h('span.cv-muted', 'Niente è ancora salvato. Con «Avanti» vai alla sala di lancio.'), ...btns));
}

// L'ultima email di una persona (da «Persone con cui mi scrivo») → proposta
export async function proposalFromPerson(email) {
  const r = await get(`/api/crm/posta?q=${encodeURIComponent(email)}`);
  const m = r.messages.find(x => x.from.address === email) || r.messages[0];
  if (!m) return toast('Non trovo email di questa persona nella tua casella', 'err');
  if (m.project) { location.hash = `#/crm/progetto/${m.project.id}`; return; }
  return openProposal(m.id);
}

// ═══ Scheda del progetto nato da una email (tavola D) ═════════════════════════════════════════════
export async function loadDeal(id) { return get(`/api/crm/progetti/${id}/trattativa`, { quiet: true }).catch(() => null); }

// testata scura: in breve, a chi tocca, tappe, quattro numeri; sotto la prossima mossa
export function dealHero({ info, deal, p, member, stepper, actions, reload, id }) {
  const s = info.source || {};
  const ball = deal.ball;
  const temp = deal.temperature;
  const hoursGoal = deal.hours_goal || Number(info.goal.hours) || 0;
  const kind = info.kind === 'gara' ? 'Gara' : 'Trattativa privata';
  const glass = (k, v, sub, tone = '') => h('div.pv-glass', { class: tone }, h('span.pv-k', k), h('b', v), sub ? h('small', sub) : null);
  const hero = h('section.pv-hero.pv-phero.dl-hero', { style: { '--acc': '#FF8A26' } },
    h('div.pv-row.top',
      h('div.pv-grow',
        h('a.pv-back.light', { href: '#/crm/progetti' }, ic('chevron-left', 14), 'I miei progetti'),
        h('span.pv-kicker', [kind, s.bu_label, deal.has_mail ? 'nata da una email' : null].filter(Boolean).join(' · ')),
        h('h1.pv-ptitle', p.name),
        deal.summary ? h('p.dl-brief', h('span', 'In breve, secondo Alma: '), deal.summary) : h('p.pv-hero-sub', [s.entity, `responsabile ${info.owner_name || '—'}`].filter(Boolean).join(' · '))),
      h('div.pv-hero-r',
        ball ? h('span.dl-ball', { class: ball.who }, ball.who === 'noi' ? 'Tocca a noi rispondere' : 'Tocca a loro', ` · da ${timeAgo(ball.since).replace(/^\s*fa\s*/, '')}`) : null,
        h('div.pv-hero-act', actions))),
    stepper,
    h('div.pv-glasses',
      glass('Valore pesato', info.weighted ? eur(info.weighted) : '—', info.goal.value ? `${eur(info.goal.value)} al ${info.goal.probability || 0}%` : 'valore da fissare'),
      glass('Termometro', temp ? temp.label : '—', temp?.why || 'dalle email e dagli incontri', temp?.level === 'caldo' ? 'hot' : temp?.level === 'freddo' ? 'cold' : ''),
      glass('All\'offerta', deal.days_to_offer == null ? '—' : deal.days_to_offer < 0 ? 'scaduta' : `${deal.days_to_offer} ${deal.days_to_offer === 1 ? 'giorno' : 'giorni'}`, deal.deadline ? `consegna ${fmtDate(deal.deadline, { year: true })}` : 'scadenza da capire'),
      glass('Ore spese', `${deal.hours} di ${hoursGoal || '—'}`, 'dal rendiconto')));
  const nm = deal.next_move;
  const move = nm ? h('section.dl-move',
    h('span.dl-move-i', ic('sparkles', 20)),
    h('div.dl-move-t', h('b', 'La prossima mossa'), h('span', nm.text)),
    member ? [
      h('button.btn', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/mossa`, {}); toast('Fatto'); reload(); } } }, 'Fatto'),
      nm.kind === 'incontro' || /incontr|sopralluog/i.test(nm.text) ? h('button.btn', { type: 'button', on: { click: () => meetingDialog(id, guessMeeting(nm.text, deal, info), reload) } }, 'Crea l\'incontro') : null,
      deal.has_mail ? h('button.btn.btn-primary', { type: 'button', on: { click: () => replyDialog(id, reload) } }, 'Prepara la risposta') : null] : null) : null;
  return [hero, move];
}

// «giovedì 27 alle 10» → { date, time }
function guessMeeting(text, deal, info) {
  const t = String(text).toLowerCase();
  let date = addDays(today(), 3), time = '10:00';
  const d = t.match(/(lunedì|martedì|mercoledì|giovedì|venerdì|sabato)?\s*(\d{1,2})(?:[/.](\d{1,2}))?\s*(?:alle|ore)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (d) {
    const now = new Date(`${today()}T12:00:00`);
    let y = now.getFullYear(), mo = d[3] ? Number(d[3]) : now.getMonth() + 1;
    if (!d[3] && Number(d[2]) < now.getDate()) mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
    date = `${y}-${String(mo).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;
    time = `${String(d[4]).padStart(2, '0')}:${d[5] || '00'}`;
  }
  const subject = /sopralluog/.test(t) ? `Sopralluogo · ${info.source?.entity || ''}`.replace(/ · $/, '') : `Incontro · ${info.source?.entity || ''}`.replace(/ · $/, '');
  const attendees = [...new Set((deal.stakeholders || []).map(s => s.email).filter(Boolean))];
  return { subject, date, time, attendees };
}

function meetingDialog(id, g, done) {
  const subj = h('input.input', { value: g.subject });
  const day = h('input.input', { type: 'date', value: g.date });
  const from = h('input.input', { type: 'time', value: g.time });
  const to = h('input.input', { type: 'time', value: `${String(Math.min(23, Number(g.time.slice(0, 2)) + 1)).padStart(2, '0')}:${g.time.slice(3, 5)}` });
  const where = h('input.input', { placeholder: 'facoltativo' });
  const att = h('input.input', { value: g.attendees.join(', ') });
  const go = h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
    go.disabled = true;
    try {
      await post(`/api/projects/${id}/meetings/new`, { title: subj.value.trim(), start: `${day.value}T${from.value}`, end: `${day.value}T${to.value}`, location: where.value, attendees: att.value.split(/[,;\s]+/).filter(Boolean) });
      m.close(); toast('Incontro nel tuo calendario Outlook, collegato al progetto'); done?.();
    } catch { go.disabled = false; }
  } } }, 'Fissa l\'incontro');
  const m = cvModal({ title: 'Crea l\'incontro', body: h('div.dl-form', h('label.field', h('span', 'Titolo'), subj), h('div.dl-form3', h('label.field', h('span', 'Giorno'), day), h('label.field', h('span', 'Dalle'), from), h('label.field', h('span', 'Alle'), to)),
    h('label.field', h('span', 'Luogo'), where), h('label.field', h('span', 'Invitati'), att), h('small.cv-muted', 'Va nel tuo calendario di Outlook con gli invitati e resta collegato al progetto.')),
  actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), go] });
}

async function replyDialog(id, done) {
  const text = h('textarea.input', { rows: 10 }, '');
  const info = h('div.cv-muted.dl-to', loading());
  const send = h('button.btn.btn-primary', { type: 'button', disabled: true, on: { click: async () => {
    if (!text.value.trim()) return toast('Scrivi la risposta', 'err');
    send.disabled = true;
    try { await post(`/api/crm/progetti/${id}/risposta`, { text: text.value }); m.close(); toast('Risposta inviata a tutti, nella stessa conversazione'); done?.(); } catch { send.disabled = false; }
  } } }, 'Invia a tutti');
  const m = cvModal({ title: 'Prepara la risposta', body: h('div.dl-form', info, h('label.field', h('span', 'Risposta (Alma l\'ha preparata, cambiala come vuoi)'), text)), wide: true,
    actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'), send] });
  const d = await post(`/api/crm/progetti/${id}/risposta/bozza`, {}).catch(() => null);
  if (!d) return m.close();
  text.value = d.text;
  fill(info, h('span', h('b', d.subject), ` · a ${d.to.join(', ')}`), h('small', 'Parte dalla tua casella come «Rispondi a tutti».'));
  send.disabled = false;
  text.focus();
}

// Panoramica: cronologia con le note a sinistra; impegni, chi conta, legami a destra
export async function dealOverview(box, { id, p, info, deal, member, reload, team }) {
  const subjects = (info.links || []).filter(l => l.subject_id && !l.contact_id);
  const tl = h('div.dl-tl', loading());
  let filter = 'all';
  const filters = h('div.dl-filters');
  const drawFilters = () => fill(filters, [['all', 'Tutto'], ['email', 'Email'], ['note', 'Note'], ['meeting', 'Incontri']].map(([k, l]) => h('button.cv-pill', { type: 'button', class: filter === k ? 'dark' : 'line', 'aria-pressed': String(filter === k), on: { click: () => { filter = k; drawFilters(); drawTl(); } } }, l)));
  drawFilters();
  let items = [];
  const drawTl = () => {
    const shown = items.filter(i => filter === 'all' || i.type === filter);
    if (!shown.length) return fill(tl, emptyState('clock', 'Ancora niente qui.'));
    fill(tl, shown.slice(0, 14).map(i => h('div.dl-item', { class: i.type },
      h('span.dl-ico', i.type === 'email' ? '@' : i.type === 'note' ? 'N' : ic('calendar', 13)),
      h('div.dl-item-b',
        h('div.dl-item-h', h('b', i.type === 'note' ? `${userName(i.author_id) || '—'} · ${i.kind === 'nota' ? 'nota' : i.kind}` : i.type === 'email' ? `${i.who} · email` : `Incontro · ${i.title}`),
          h('small', [when(i.at), i.auto ? 'entrata da sola' : null].filter(Boolean).join(' · '))),
        h('span', i.type === 'email' ? (i.body || i.title) : i.type === 'note' ? [i.title ? `${i.title}: ` : '', i.body] : i.body),
        i.files ? h('small.cv-muted', `${i.files} ${i.files === 1 ? 'allegato' : 'allegati'}`) : null))),
    shown.length > 14 ? h('small.cv-muted', `+ ${shown.length - 14} voci più vecchie · email, note e incontri in un'unica fila`) : null);
  };
  const loadTl = async () => { items = (await get(`/api/crm/progetti/${id}/cronologia`)).items; drawTl(); };

  // nuova nota: @ per avvisare, «Squadra» menziona tutta la squadra, allegato, a voce; va anche sull'azienda
  const noteIn = h('textarea.dl-note-in', { rows: 2, placeholder: 'Scrivi una nota… @ per avvisare un collega', 'aria-label': 'Nuova nota' });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true });
  const filesLbl = h('small.cv-muted');
  fileIn.addEventListener('change', () => { filesLbl.textContent = fileIn.files.length ? `${fileIn.files.length} ${fileIn.files.length === 1 ? 'file' : 'file'}` : ''; });
  const alsoOn = h('input', { type: 'checkbox', checked: subjects.length > 0 });
  let rec = null;
  const voiceBtn = h('button.cv-pill.line', { type: 'button', on: { click: () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Questo browser non sa dettare: usa Chrome o Edge', 'err');
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { for (let k = e.resultIndex; k < e.results.length; k++) if (e.results[k].isFinal) noteIn.value = `${noteIn.value}${noteIn.value && !/\s$/.test(noteIn.value) ? ' ' : ''}${e.results[k][0].transcript.trim()}`; };
    rec.onend = () => { rec = null; voiceBtn.classList.remove('rec'); voiceBtn.lastChild.textContent = 'A voce'; };
    rec.start(); voiceBtn.classList.add('rec'); voiceBtn.lastChild.textContent = 'Sto ascoltando… tocca per fermare';
  } } }, ic('mic', 13), h('span', 'A voce'));
  const saveNote = h('button.btn.btn-sm.dl-save', { type: 'button', on: { click: async () => {
    const text = noteIn.value.trim();
    if (!text && !fileIn.files.length) return toast('Scrivi la nota', 'err');
    saveNote.disabled = true;
    try {
      const n = await post(`/api/projects/${id}/notes`, { body: text || '(file)', note_date: today(), kind: 'nota' });
      if (fileIn.files.length) await uploadNoteFiles(n.id, [...fileIn.files]);
      if (alsoOn.checked) for (const s of subjects) await post(`/api/crm/subjects/${s.subject_id}/notes`, { body: `${text}\n\n(dal progetto «${p.name}»)`, note_date: today(), kind: 'nota' }).catch(() => {});
      noteIn.value = ''; fileIn.value = ''; filesLbl.textContent = '';
      toast('Nota salvata');
      loadTl();
    } finally { saveNote.disabled = false; }
  } } }, 'Salva nota');
  noteIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote.click(); });
  const composer = member ? h('div.dl-note',
    h('label.dl-note-k', { for: 'dl-note' }, 'Nuova nota'),
    withMentions(Object.assign(noteIn, { id: 'dl-note' })),
    h('div.dl-note-a',
      h('button.cv-pill.line', { type: 'button', title: 'Avvisa tutta la squadra', on: { click: () => {
        const tags = team.filter(u => u.id !== store.me.id).map(u => `@${handleOf(store.users.find(x => x.id === u.id))}`).filter(t => t.length > 1);
        noteIn.value = `${noteIn.value}${noteIn.value && !/\s$/.test(noteIn.value) ? ' ' : ''}${tags.join(' ')} `; noteIn.focus();
      } } }, ic('users', 13), 'Squadra'),
      h('button.cv-pill.line', { type: 'button', on: { click: () => fileIn.click() } }, ic('paperclip', 13), 'Allegato'), fileIn,
      voiceBtn, filesLbl,
      h('span.dl-grow'),
      subjects.length ? h('label.dl-also', alsoOn, `anche su ${subjects.map(s => s.subject_name).join(', ')}`) : null,
      saveNote)) : null;

  // destra
  const STATE = { compito: 'compito creato', promemoria: 'promemoria creato', fatto: 'fatto', in_calendario: 'in calendario' };
  const WHO = { noi: ['noi', 'rd'], loro: ['loro', 'bl'], fissato: ['fissato', 'gr'] };
  const act = async (i, azione) => { await post(`/api/crm/progetti/${id}/impegni/${i}`, { azione }); toast(azione === 'compito' ? 'Compito creato e assegnato a te' : azione === 'ricorda' ? 'Te lo ricordo: promemoria tra i tuoi compiti' : 'Segnato'); reload(); };
  const commitments = h('section.pv-card.dl-card', h('h3', 'Impegni presi nelle email'),
    deal.commitments.length ? deal.commitments.map(c => h('div.dl-cm', h('span.dl-who', { class: WHO[c.who][1] }, WHO[c.who][0]),
      h('span.dl-grow', c.text, c.by ? h('small.cv-muted', ` · ${c.by}${c.date ? `, ${fmtDate(c.date)}` : ''}`) : null),
      c.state ? h('small.dl-done', ic('check', 12), STATE[c.state]) : member ? (c.who === 'noi' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => act(c.i, 'compito') } }, 'Compito')
        : c.who === 'loro' ? h('button.btn.btn-sm', { type: 'button', on: { click: () => act(c.i, 'ricorda') } }, 'Ricordamelo')
          : h('button.btn.btn-sm.btn-dark', { type: 'button', on: { click: () => meetingDialog(id, guessMeeting(c.text, deal, info), () => act(c.i, 'calendario')) } }, 'In calendario')) : null))
      : h('p.cv-muted', 'Nessun impegno trovato nelle email per ora.'));
  const ROLE = { decide: 'Decide', influenza: 'Influenza', operativa: 'Operativa' };
  const who = h('section.pv-card.dl-card', h('h3', 'Chi conta in questa trattativa'),
    deal.stakeholders.length ? ['decide', 'influenza', 'operativa'].flatMap(r => deal.stakeholders.filter(s => s.role === r).map(s => h('div.dl-sh',
      h('span.dl-sh-k', ROLE[r]),
      h('span', h('b', s.name), s.why ? ` · ${s.why}` : ''),
      r === 'decide' && !s.contact_id ? h('a', { href: `#/alma?q=${encodeURIComponent(`Chi conosce in Almacis ${s.name}? Cerca nel CRM, nelle email e negli incontri.`)}` }, 'Chi la conosce in Almacis? Chiedi ad Alma ›') : null)))
      : h('p.cv-muted', 'Lo capisco dalle email e dalle firme appena ce ne sono.'));
  const extraCards = [];
  if (deal.new_people.length && member) extraCards.push(h('section.pv-card.dl-card', h('h3', 'Persone nuove nella conversazione'),
    deal.new_people.map(x => h('div.dl-cm', h('span.dl-grow', h('b', x.name || x.email), h('small.cv-muted', ` · ${x.email}`)),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/persone-nuove`, { email: x.email, azione: 'ignora' }); reload(); } } }, 'Non serve'),
      h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/persone-nuove`, { email: x.email, azione: 'aggiungi' }); toast('Aggiunta al CRM e collegata al progetto'); reload(); } } }, 'Aggiungi al CRM')))));
  if (deal.suggestions.length && member) extraCards.push(h('section.pv-card.dl-card.dl-sug', h('h3', `Alma suggerisce ${deal.suggestions.length} ${deal.suggestions.length === 1 ? 'email' : 'email'}`),
    deal.suggestions.map(sg => h('div.dl-cm', h('span.dl-grow', h('b', sg.from_name || sg.from_address), `, ${fmtDate(String(sg.sent_at).slice(0, 10))}, «${sg.subject}»: ${sg.why}.`),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/suggerite/${sg.id}`, { azione: 'scarta' }); reload(); } } }, 'Non c\'entra'),
      h('button.btn.btn-sm.btn-dark', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/suggerite/${sg.id}`, { azione: 'aggiungi' }); toast('Email aggiunta al progetto'); reload(); } } }, 'Aggiungi')))));
  const legami = h('section.dl-legami', h('h3', 'Legami nel CRM'),
    deal.insights.length ? deal.insights.map(x => h('div.dl-lg', { class: x.kind === 'attenzione' ? 'warn' : '' }, h('b', `${x.title}: `), x.text, x.link ? [' ', h('a', { href: x.link }, `${x.link_label || 'Apri'} ›`)] : null)) : h('span.dl-lg', 'Niente di collegato per ora.'),
    deal.client ? h('div.dl-client', h('span', `Novità: nelle email compare il committente, «${deal.client.name}».${deal.client.subject_id ? ' È nel CRM ma non è collegato.' : ' Non è nel CRM.'}`),
      member ? h('div.dl-client-a',
        h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/committente`, { azione: 'aggiungi' }); toast('Committente nel CRM e collegato al progetto'); reload(); } } }, deal.client.subject_id ? 'Collegala' : 'Aggiungila al CRM'),
        h('button.btn.btn-sm.dl-ghost', { type: 'button', on: { click: async () => { await post(`/api/crm/progetti/${id}/committente`, { azione: 'dopo' }); reload(); } } }, 'Più tardi')) : null) : null,
    h('small.dl-lg-f', deal.updated_at ? `Si aggiornano quando entrano email nuove · ultimo controllo ${timeAgo(deal.updated_at)}` : 'Si aggiornano quando entrano email nuove.'),
    deal.has_mail ? h('button.dl-refresh', { type: 'button', on: { click: async e => { e.currentTarget.disabled = true; await post(`/api/crm/progetti/${id}/posta/aggiorna`, {}).catch(() => {}); reload(); } } }, ic('refresh', 12), 'Controlla adesso le email') : null);

  box.append(h('div.dl-over',
    h('section.pv-card.dl-main', h('div.dl-main-h', h('h3', 'Cronologia'), filters), composer, tl),
    h('aside.dl-side', commitments, ...extraCards, who, legami)));
  loadTl();
}
