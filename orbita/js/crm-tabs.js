// Alma CRM: tab Email, Incontri, Note, Progetti e «Ultimi aggiornamenti», uguali per aziende e contatti
// (artboard «Scheda azienda · …» e «Avviso: incontro senza note» del 12–13/11/2026; design v2 del 14/11, artboard
// «Scheda-tab»: stesso schema di riga ovunque, incontri per mese con «!» e «Scrivi la nota» sulla riga, proposte di
// email in un riquadro tenue). base = '/api/crm/subjects/12' oppure '/api/crm/contacts/7'.
import { h, fill, confirmDialog, toast, fmtDate, loading, today, addDays } from './ui.js';
import { get, post, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { notesPanel } from './notes.js';
import { uploadNoteFiles, noteFileLinks } from './project-meetings.js';
import { ic, dots, pill, card, link, sect, listRow, emptyState, seg, cvModal } from './crm-v2.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
const hhmm = s => String(s || '').slice(11, 16);
const hours = s => Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
const monthOf = s => { const [y, m] = String(s || '').slice(0, 7).split('-').map(Number); return y ? `${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}` : ''; };
export const when = m => {
  const s = m.start_at || m.start;
  if (!s) return '';
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  const end = m.end_at || m.end;
  return `${DAYS[d.getDay()]} ${fmtDate(s.slice(0, 10), { year: true })}${m.all_day ? ' · tutto il giorno' : ` · ${hhmm(s)}${end ? `–${hhmm(end)}` : ''}`}`;
};
const shortWhen = m => { const s = m.start_at || m.start || ''; return s ? `${fmtDate(s.slice(0, 10))}${m.all_day ? '' : ` · ${hhmm(s)}`}` : ''; };
const viaText = name => (name ? `tramite ${name}` : null);
const autoPill = () => pill([ic('link', 11), 'automatico'], 'bl');
export const bang = () => h('span.cv-bang', { title: 'Incontro fatto senza note', role: 'img', 'aria-label': 'Incontro senza note' }, '!');

// ── ultimi aggiornamenti (panoramica) ────────────────────────────────────────
export async function timelineCard(base, { onOpenTab } = {}) {
  const body = h('div', loading());
  let filter = 'all';
  const el = card({ title: 'Ultimi aggiornamenti', right: seg([['all', 'Tutto'], ['email', 'Email'], ['meeting', 'Incontri'], ['note', 'Note']], 'all', k => { filter = k; draw(); }, { label: 'Tipo di aggiornamento' }) }, body);
  const { items } = await get(`${base}/timeline`).catch(() => ({ items: [] }));
  const kind = { email: ['mail', 'bl'], meeting: ['calendar', 'or'], note: ['file-text', 'gr'] };
  const noteKind = k => ({ nota: 'nota', telefonata: 'telefonata', riunione: 'riunione', decisione: 'decisione' }[k] || 'nota');
  const draw = () => {
    const shown = items.filter(i => filter === 'all' || i.type === filter).slice(0, 12);
    fill(body, shown.length ? shown.map(i => listRow({
      icon: kind[i.type][0], tone: i.missing ? 'rd' : kind[i.type][1], title: i.title || '(senza titolo)', after: i.missing ? bang() : i.auto ? autoPill() : null,
      meta: i.type === 'meeting' ? dots([`incontro · ${shortWhen({ start_at: i.date })}`, i.missing ? 'mancano le note' : i.notes ? `${i.notes} note` : null, viaText(i.via)])
        : i.type === 'email' ? dots([`email${i.meta ? ` da ${i.meta}` : ''}`, fmtDate(String(i.date || '').slice(0, 10)), viaText(i.via)])
          : dots([`${noteKind(i.kind)} · ${fmtDate(String(i.date).slice(0, 10))}`, i.meeting && `dell'incontro «${i.meeting}»`, viaText(i.via)]),
      onClick: () => (i.type === 'meeting' ? openCrmMeeting(i.id, () => onOpenTab?.('incontri')) : i.type === 'email' ? openCrmEmail(i.id) : onOpenTab?.('note')),
      actions: i.type === 'meeting' && i.missing ? [h('button.btn.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(i.id, () => onOpenTab?.('incontri')) } }, 'Scrivi la nota')] : null,
    })) : emptyState('clock', 'Ancora niente: email, incontri e note compariranno qui.'));
  };
  draw();
  return el;
}

// ── email ────────────────────────────────────────────────────────────────────
export function emailsTab(box, base, { canWrite = true, onCount } = {}) {
  const list = h('div', loading());
  const proposals = h('div');
  const count = h('span.cv-c');
  const head = card({ title: 'Email', right: canWrite ? link('Collega dalla casella', { on: { click: () => mailboxDialog(base, load) } }) : null }, proposals, list);
  head.querySelector('.cv-t').append(count);
  fill(box, head);
  async function load() {
    const emails = await get(`${base}/emails`).catch(() => []);
    onCount?.(emails.length);
    count.textContent = String(emails.length);
    fill(list, emails.length ? emails.map(e => listRow({ icon: 'mail', tone: 'bl', title: e.subject || '(senza oggetto)',
      meta: dots([e.from_name || e.from_address, fmtDate(String(e.sent_at || '').slice(0, 10)), e.attachment_count ? `${e.attachment_count} allegati` : null, viaText(e.via)]),
      onClick: () => openCrmEmail(e.id),
      actions: canWrite && !e.via ? [h('button.btn.btn-sm', { type: 'button', title: 'Progetto commerciale da questa conversazione (Alma la legge)', on: { click: async () => (await import('./crm-posta.js')).openProposal(null, { internet_message_id: e.internet_message_id }) } }, ic('sparkles', 13), 'Crea progetto'),
        h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Togli «${e.subject}»`, on: { click: async () => {
        if (!await confirmDialog(`Togliere «${e.subject}» da questa scheda?`, { ok: 'Togli', danger: true })) return;
        await del(`${base}/emails/${e.id}`);
        load();
      } } }, ic('x', 14))] : null }))
      : emptyState('mail', 'Nessuna email collegata. Collegale dalla tua casella di Outlook.', canWrite ? h('button.btn.btn-sm', { type: 'button', on: { click: () => mailboxDialog(base, load) } }, 'Collega') : null));
    drawProposals();
  }
  // proposte dalla casella: un riquadro tenue sopra l'elenco, non mischiate alle collegate
  async function drawProposals() {
    if (!canWrite) return;
    let r;
    try { r = await get(`${base}/email-proposals`, { quiet: true }); } catch { return fill(proposals); }
    if (!r.messages.length) return fill(proposals);
    const picked = new Set();
    const listBox = h('div', { hidden: true });
    const btn = h('button.btn.btn-sm', { type: 'button', disabled: true, on: { click: async () => {
      btn.disabled = true;
      const res = await post(`${base}/emails`, { message_ids: [...picked] });
      toast(`${res.added} email collegate`);
      load();
    } } }, 'Collega');
    fill(listBox, r.messages.map(m => h('label.cv-li', { style: { cursor: 'pointer', padding: '10px 4px' } },
      h('input', { type: 'checkbox', on: { change: e => { e.target.checked ? picked.add(m.id) : picked.delete(m.id); btn.disabled = !picked.size; btn.textContent = picked.size ? `Collega ${picked.size} email` : 'Collega'; } } }),
      h('div.cv-li-main', h('div.cv-li-t', h('span.cv-ell', m.subject)), h('div.cv-li-m', dots([m.from.name || m.from.address, fmtDate(String(m.date).slice(0, 10))]))))), h('div', { style: { paddingTop: '8px' } }, btn));
    fill(proposals, h('div.cv-soft', { style: { margin: '0 16px 10px' } },
      h('div.cv-row', h('span.cv-small.cv-grow.cv-row', { style: { gap: '6px' } }, ic('mail', 13), `${r.messages.length} email ${r.messages.length === 1 ? 'proposta' : 'proposte'} da collegare`),
        link('Guarda', { 'aria-expanded': 'false', on: { click: e => { listBox.hidden = !listBox.hidden; e.currentTarget.textContent = listBox.hidden ? 'Guarda' : 'Chiudi'; e.currentTarget.setAttribute('aria-expanded', String(!listBox.hidden)); } } })),
      listBox));
  }
  load();
}

// casella di Outlook per scegliere le email (stessa API dei progetti, senza progetto)
function mailboxDialog(base, onDone) {
  const search = h('input.input', { type: 'search', placeholder: 'Cerca nella posta…', 'aria-label': 'Cerca nella posta' });
  const folder = h('select.select', { 'aria-label': 'Cartella', style: { width: 'auto' } }, [['inbox', 'Posta in arrivo'], ['sent', 'Posta inviata'], ['all', 'Tutte']].map(([k, l]) => h('option', { value: k }, l)));
  const list = h('div', { style: { maxHeight: '55vh', overflowY: 'auto' } }, loading());
  const picked = new Set();
  const load = async () => {
    fill(list, loading());
    let r;
    try { r = await get(`/api/mail/messages?folder=${folder.value}${search.value.trim() ? `&q=${encodeURIComponent(search.value.trim())}` : ''}`); } catch { return fill(list, emptyState('mail', 'Posta non disponibile: collega Microsoft.')); }
    fill(list, r.messages.length ? r.messages.map(m => h('label.cv-li', { style: { cursor: 'pointer', padding: '10px 0' } },
      h('input', { type: 'checkbox', checked: picked.has(m.id), on: { change: e => (e.target.checked ? picked.add(m.id) : picked.delete(m.id)) } }),
      h('div.cv-li-main', h('div.cv-li-t', h('span.cv-ell', m.subject)), h('div.cv-li-m', dots([m.from.name || m.from.address, fmtDate(String(m.date).slice(0, 10))])), m.preview ? h('div.cv-li-m.cv-clamp', m.preview) : null))) : emptyState('mail', 'Nessuna email.'));
  };
  search.addEventListener('change', load);
  folder.addEventListener('change', load);
  const m = cvModal({
    wide: true, title: 'Collega email dalla tua casella', body: h('div', { style: { display: 'grid', gap: '12px' } }, h('div.cv-row', folder, search), list),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!picked.size) return toast('Scegli almeno una email', 'err');
        const r = await post(`${base}/emails`, { message_ids: [...picked] });
        toast(`${r.added} email collegate${r.already ? `, ${r.already} c'erano già` : ''}`);
        m.close();
        onDone?.();
      } } }, 'Collega')],
  });
  load();
}

export async function openCrmEmail(id) {
  const e = await get(`/api/crm/emails/${id}`);
  const m = cvModal({
    wide: true, title: h('div', h('h2', e.subject), h('div.cv-subh', dots([fmtDate(String(e.sent_at || '').slice(0, 10), { year: true }), `da ${e.from_name || ''} ${e.from_address ? `<${e.from_address}>` : ''}`.trim()]))),
    body: h('div', { style: { display: 'grid', gap: '12px' } },
      e.to_list?.length ? h('div.cv-small.cv-muted', `a ${e.to_list.map(t => t.name || t.address).join(', ')}`) : null,
      e.attachments.length ? h('div.cv-chips', e.attachments.map(a => h('a.cv-pill.line.big', { href: `/api/crm/emails/${e.id}/attachments/${a.id}`, download: a.name, style: { textDecoration: 'none' } }, icon('paperclip', { size: 13 }), a.name))) : null,
      h('pre.crm-mail', e.body_text || '')),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Chiudi'), e.web_link ? h('a.btn', { href: e.web_link, target: '_blank', rel: 'noopener' }, ic('external', 14), 'Apri in Outlook') : null].filter(Boolean),
  });
}

// ── incontri: settimana del proprio calendario + elenco per mese ─────────────
// Tab Incontri delle schede (ALM2-65, tavola I): due sotto-tab a pillola, «Elenco» (gli incontri collegati) e
// «Calendario» a tutta larghezza (lo stesso del Calendario del CRM). L'ultima scelta resta.
export function meetingsTab(box, base, opts = {}) {
  const m = String(base).match(/\/api\/crm\/(subjects|contacts)\/(\d+)$/);
  if (!m) return meetingsTabOld(box, base, opts);
  const key = 'crm-incontri-vista';
  let view = 'calendario';
  try { view = localStorage.getItem(key) || 'calendario'; } catch { /* niente */ }
  const count = h('span.cv-c');
  const pills = h('div.kc-subtabs');
  const body = h('div');
  const drawPills = () => fill(pills, [['elenco', 'Elenco', count], ['calendario', 'Calendario']].map(([k, l, extra]) => h('button.cv-pill.big', {
    type: 'button', class: view === k ? 'dark' : 'line', 'aria-pressed': String(view === k), on: { click: () => { view = k; try { localStorage.setItem(key, k); } catch { /* niente */ } drawPills(); draw(); } },
  }, l, extra ? [' · ', extra] : null)));
  const listOpts = { ...opts, onCount: (n, miss) => { count.textContent = String(n); opts.onCount?.(n, miss); } };
  async function draw() {
    if (view === 'elenco') return meetingsTabOld(body, base, { ...listOpts, listOnly: true });
    const { schedaCalendar } = await import('./crm-calendario.js');
    schedaCalendar(body, { target: m[1], id: Number(m[2]), label: opts.label || 'questa scheda', name: opts.name || 'loro', people: opts.people || [], canWrite: opts.canWrite !== false, onChange: () => get(`${base}/meetings`).then(x => { count.textContent = String(x.length); }).catch(() => {}) });
  }
  fill(box, h('div.kc-incontri', pills, body));
  get(`${base}/meetings`, { quiet: true }).then(x => { count.textContent = String(x.length); }).catch(() => {});
  drawPills();
  draw();
}

function meetingsTabOld(box, base, { canWrite = true, people = [], onCount, label = 'questa scheda', listOnly = false } = {}) {
  let week = mondayOf(today());
  const cal = h('div.crm-week', loading());
  const weekTitle = h('span.cv-t5.cv-small');
  const list = h('div', loading());
  const count = h('span.cv-c');
  const listCard = card({ title: 'Incontri', right: canWrite ? h('button.btn.btn-sm', { type: 'button', on: { click: () => scheduleDialog(base, people, reload) } }, ic('plus', 14), 'Programma') : null }, list);
  listCard.querySelector('.cv-t').append(count);
  if (listOnly) fill(box, listCard);
  else fill(box, h('div.cv-cols.w420',
    listCard,
    card({ title: 'Il tuo calendario', right: h('div.cv-row', { style: { gap: '6px' } },
      h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Settimana prima', on: { click: () => { week = addDays(week, -7); loadCal(); } } }, ic('chevron-left', 14)),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => { week = mondayOf(today()); loadCal(); } } }, 'Oggi'),
      h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Settimana dopo', on: { click: () => { week = addDays(week, 7); loadCal(); } } }, ic('chevron-right', 14))) },
    h('div', { style: { padding: '0 20px 20px', display: 'grid', gap: '10px' } }, weekTitle,
      h('div.crm-legend', h('span', h('i.mine'), `collegato a ${label}`), h('span', h('i.other'), 'altro: clicca per collegarlo'), h('span', h('i.nonotes'), 'senza note')),
      cal))));
  const reload = () => { if (!listOnly) loadCal(); loadList(); };
  async function loadCal() {
    const end = addDays(week, 5);
    weekTitle.textContent = `${fmtDate(week)} – ${fmtDate(addDays(week, 4), { year: true })}`;
    let events;
    try { events = await get(`${base}/calendar?start=${week}&end=${end}`, { quiet: true }); } catch {
      return fill(cal, emptyState('calendar', 'Il tuo calendario di Outlook non è disponibile: collega Microsoft per vederlo.'));
    }
    const H0 = 8, H1 = 19, ROW = 30;
    const days = [0, 1, 2, 3, 4].map(i => addDays(week, i));
    fill(cal,
      h('div.crm-wh', days.map(d => h('span', `${DAYS[new Date(`${d}T12:00:00`).getDay()]} ${Number(d.slice(8))}`))),
      h('div.crm-wb', { style: { height: `${(H1 - H0) * ROW}px`, background: `repeating-linear-gradient(var(--cv-card) 0 ${ROW - 1}px, var(--cv-line-2) ${ROW - 1}px ${ROW}px)` } },
        Array.from({ length: H1 - H0 }, (_, i) => h('span.crm-hr', { style: { top: `${i * ROW}px` } }, `${H0 + i}`)),
        events.filter(e => !e.all_day).map(e => {
          const di = days.indexOf(e.start.slice(0, 10));
          if (di < 0) return null;
          const top = Math.max(0, (hours(e.start) - H0) * ROW), hgt = Math.max(16, (hours(e.end || e.start) - hours(e.start)) * ROW);
          return h('button.crm-ev', {
            type: 'button', class: [e.linked ? 'mine' : 'other', e.missing_notes ? 'nonotes' : ''].join(' '),
            style: { left: `calc(${di} * 20% + 3px)`, top: `${top}px`, height: `${hgt}px` },
            title: e.linked ? (e.missing_notes ? `${e.subject}: senza note, aprilo e scrivile` : e.subject) : `Collega «${e.subject}»`,
            on: { click: async () => {
              if (e.linked) return openCrmMeeting(e.meeting_id, reload);
              if (!canWrite) return;
              if (!await confirmDialog(`Collegare «${e.subject}» a ${label}?`, { ok: 'Collega' })) return;
              await post(`${base}/meetings`, { event_ids: [e.id] });
              toast('Incontro collegato');
              reload();
            } },
          }, h('span', e.subject));
        })));
  }
  async function loadList() {
    const meetings = await get(`${base}/meetings`).catch(() => []);
    onCount?.(meetings.length, meetings.filter(m => m.missing_notes).length);
    count.textContent = String(meetings.length);
    if (!meetings.length) return fill(list, emptyState('calendar', 'Nessun incontro. Si collegano dal calendario qui accanto, con «Programma», oppure da soli quando un invitato ha un\'email del CRM.'));
    const months = [...new Set(meetings.map(m => monthOf(m.start_at)))];
    fill(list, months.map(mo => [sect(mo), meetings.filter(m => monthOf(m.start_at) === mo).map(m => listRow({
      icon: 'calendar', tone: m.missing_notes ? 'rd' : 'or', title: m.subject, after: [m.missing_notes ? bang() : null, m.auto ? autoPill() : null],
      meta: dots([shortWhen(m), m.location, m.attendees?.length ? m.attendees.map(a => a.name || a.address).slice(0, 3).join(', ') : '', m.note_count ? `${m.note_count} note` : '', viaText(m.via)]),
      onClick: () => openCrmMeeting(m.id, reload),
      actions: [m.missing_notes ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(m.id, reload) } }, 'Scrivi la nota')
        : h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(m.id, reload) } }, 'Apri'),
      canWrite && !m.via ? h('button.btn.btn-ghost.btn-sm.cv-ico', { type: 'button', 'aria-label': `Togli «${m.subject}»`, on: { click: async () => {
        if (!await confirmDialog(`Togliere «${m.subject}» da ${label}? Non verrà più collegato da solo.`, { ok: 'Togli', danger: true })) return;
        await del(`${base}/meetings/${m.id}`);
        reload();
      } } }, ic('x', 14)) : null],
    }))]));
  }
  reload();
}

// «Programma» un incontro come in Outlook: invitati tra i contatti della scheda e i colleghi
function scheduleDialog(base, people, onDone) {
  const subject = h('input.input', { placeholder: 'Titolo', maxlength: 255, autofocus: true, 'aria-label': 'Titolo' });
  const dayIn = h('input.input', { type: 'date', value: today(), 'aria-label': 'Giorno' });
  const from = h('input.input', { type: 'time', value: '10:00', 'aria-label': 'Dalle' });
  const to = h('input.input', { type: 'time', value: '11:00', 'aria-label': 'Alle' });
  const where = h('input.input', { placeholder: 'Luogo', 'aria-label': 'Luogo' });
  const online = h('input', { type: 'checkbox', role: 'switch' });
  const picked = new Set(people.filter(p => p.email && p.preset).map(p => p.email));
  const colleagues = store.users.filter(u => u.active !== false && u.id !== store.me.id).map(u => ({ name: u.name, email: u.email }));
  const chip = p => h('button.cv-chip', { type: 'button', class: picked.has(p.email) ? 'on' : '', 'aria-pressed': String(picked.has(p.email)), on: { click: e => {
    picked.has(p.email) ? picked.delete(p.email) : picked.add(p.email);
    e.currentTarget.classList.toggle('on', picked.has(p.email));
    e.currentTarget.setAttribute('aria-pressed', String(picked.has(p.email)));
  } } }, p.name);
  const colleagueSel = h('select.select', { 'aria-label': 'Aggiungi un collega' }, [h('option', { value: '' }, 'Aggiungi un collega…'), ...colleagues.map(c => h('option', { value: c.email }, c.name))]);
  const colleagueBox = h('div.cv-chips');
  colleagueSel.addEventListener('change', () => {
    const c = colleagues.find(x => x.email === colleagueSel.value);
    if (c && !picked.has(c.email)) { picked.add(c.email); colleagueBox.append(chip(c)); }
    colleagueSel.value = '';
  });
  const m = cvModal({
    size: 'md', title: 'Programma un incontro',
    body: h('div.en-form', subject, h('div.cv-grid3', { style: { gap: '8px' } }, dayIn, from, to), where,
      h('label.cv-tg', online, h('span.cv-tg-ui', { 'aria-hidden': 'true' }), h('span', 'Riunione su Teams')),
      h('div.cv-fld', h('span', 'Contatti'), people.filter(p => p.email).length ? h('div.cv-chips', people.filter(p => p.email).map(chip)) : h('p.cv-small.cv-muted', 'Nessun contatto con email.')),
      h('div.cv-fld', h('span', 'Colleghi'), colleagueSel, colleagueBox)),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!subject.value.trim()) return toast('Scrivi il titolo', 'err');
        await post(`${base}/meetings/new`, { title: subject.value.trim(), start: `${dayIn.value}T${from.value}`, end: `${dayIn.value}T${to.value}`,
          location: where.value.trim(), online: online.checked, attendees: [...picked] });
        toast('Incontro fissato nel tuo calendario e collegato');
        m.close();
        onDone?.();
      } } }, 'Fissa')],
  });
}

// L'incontro con le sue note (artboard «Avviso: incontro senza note»)
export async function openCrmMeeting(id, onChange) {
  let mt;
  try { mt = await get(`/api/crm/meetings/${id}`); } catch { return; }
  const body = h('textarea.input', { rows: 5, placeholder: 'Com\'è andato: decisioni, cose da fare, prossimo passo… (@ per avvisare un collega)', 'aria-label': 'Note dell\'incontro' });
  const fileIn = h('input', { type: 'file', multiple: true, 'aria-label': 'Allegati' });
  const notesBox = h('div');
  fill(notesBox, mt.notes.length ? mt.notes.map(n => listRow({ icon: 'file-text', tone: 'gr', cls: 'flat', title: n.title || fmtDate(n.note_date, { year: true }),
    meta: dots([fmtDate(n.note_date, { year: true }), store.users.find(u => u.id === n.author_id)?.name]),
    extra: [h('div.cv-small', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, n.body), noteFileLinks(n, null, '/api/crm/note-files')] })) : null);
  const m = cvModal({
    wide: true,
    title: h('div', h('div.cv-eyebrow', `Incontro${mt.links.length ? ` · ${mt.links.map(l => l.subject_name || l.contact_name).join(', ')}` : ''}`), h('h2', mt.subject),
      h('div.cv-subh', dots([when(mt), mt.location, mt.attendees?.map(a => a.name || a.address).join(', ')]))),
    body: h('div', { style: { display: 'grid', gap: '14px' } },
      h('div.cv-chips', mt.missing_notes ? pill([bang(), 'senza note'], 'rd') : null, mt.links.some(l => l.auto) ? pill([ic('link', 11), 'collegato in automatico da Outlook'], 'bl') : null),
      notesBox,
      h('div.cv-fld', h('span', mt.notes.length ? 'Aggiungi una nota' : 'Le note dell\'incontro'), body, h('div.cv-row', fileIn))),
    left: mt.web_link ? [h('a.btn.btn-ghost', { href: mt.web_link, target: '_blank', rel: 'noopener' }, ic('external', 14), 'Apri in Outlook')] : [],
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      const files = [...fileIn.files];
      if (!body.value.trim() && !files.length) return toast('Scrivi le note', 'err');
      const n = await post(`/api/crm/meetings/${id}/notes`, { body: body.value.trim(), with_files: files.length > 0 });
      if (files.length) await uploadNoteFiles(n.id, files, '/api/crm/notes');
      toast('Note salvate');
      m.close();
      onChange?.();
    } } }, 'Salva le note')],
  });
}

// ── note (come negli A3) ─────────────────────────────────────────────────────
export function notesTab(box, base, { onCount, isSubject } = {}) {
  const wrap = h('section.cv-card.pad.crm-notes-v2');
  fill(box, wrap);
  notesPanel(wrap, { url: `${base}/notes`, api: '/api/crm/notes', filesApi: '/api/crm/note-files', onCount,
    openMeetingFn: (mid, reload) => openCrmMeeting(mid, reload), origins: isSubject ? 'Solo dell\'azienda' : null, title: 'Note' });
}

// ── progetti di Alma Project ─────────────────────────────────────────────────
export function projectsTab(box, base, { canWrite = true, onCount, newName = '' } = {}) {
  const grid = h('div.cv-cardlist', loading());
  fill(box,
    canWrite ? h('div.cv-row.cv-wrap', { style: { justifyContent: 'flex-end', gap: '8px' } },
      h('button.btn.btn-sm', { type: 'button', on: { click: () => linkProjectDialog(base, load) } }, ic('link', 14), 'Collega un progetto'),
      h('button.btn.btn-sm', { type: 'button', on: { click: async () => {
        const p = await post('/api/projects', { name: newName || 'Nuovo progetto' });
        await post(`${base}/projects`, { project_id: p.id });
        toast('Progetto creato e collegato');
        location.hash = `#/projects/${p.id}`;
      } } }, ic('plus', 14), 'Nuovo progetto per questa scheda')) : null,
    grid);
  async function load() {
    const list = await get(`${base}/projects`).catch(() => []);
    onCount?.(list.length);
    fill(grid, list.length ? list.map(p => {
      const done = p.total_tickets ? Math.round(((p.total_tickets - p.open_tickets) / p.total_tickets) * 100) : 0;
      return h('section.cv-card.pad', { style: { gap: '12px' } },
        h('a.cv-row', { href: `#/projects/${p.id}`, style: { textDecoration: 'none', color: 'inherit' } }, h('span.cv-ib', { style: { background: p.color, color: '#fff' } }, ic('folder', 16)),
          h('div.cv-grow', h('div.cv-t5.cv-ell', p.name), h('div.cv-small.cv-muted', `Alma Project · ${p.owner_name || '—'}`))),
        h('span.cv-bar', h('i', { style: { width: `${done}%` } })),
        h('div.cv-row', h('span.cv-small.cv-muted.cv-grow', dots([`${p.open_tickets} ticket aperti`, p.due_date && `scade ${fmtDate(p.due_date, { year: true })}`])),
          canWrite ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
            if (!await confirmDialog(`Scollegare «${p.name}»? Il progetto resta in Alma Project.`, { ok: 'Scollega' })) return;
            await del(`${base}/projects/${p.id}`);
            load();
          } } }, 'Scollega') : null));
    }) : h('section.cv-card', { style: { gridColumn: '1 / -1' } }, emptyState('folder', 'Nessun progetto collegato.')));
  }
  load();
}
function linkProjectDialog(base, onDone) {
  const sel = h('select.select', { 'aria-label': 'Progetto' }, [h('option', { value: '' }, 'Scegli il progetto…'), ...store.projects.filter(p => p.status !== 'archived').map(p => h('option', { value: p.id }, p.name))]);
  const m = cvModal({
    size: 'sm', title: 'Collega un progetto', body: h('div.en-form', sel),
    actions: [h('button.btn.btn-ghost', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
      h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
        if (!sel.value) return toast('Scegli il progetto', 'err');
        await post(`${base}/projects`, { project_id: Number(sel.value) });
        m.close();
        onDone?.();
      } } }, 'Collega')],
  });
}
