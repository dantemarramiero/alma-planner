// Alma CRM: tab Email, Incontri, Note, Progetti e «Ultimi aggiornamenti», uguali per aziende e contatti
// (artboard «Scheda azienda · …» e «Avviso: incontro senza note» del canvas del 12–13/11/2026).
// base = '/api/crm/subjects/12' oppure '/api/crm/contacts/7'. Quello che arriva da un contatto porta «tramite …».
import { h, fill, modal, confirmDialog, toast, fmtDate, loading, today, addDays } from './ui.js';
import { get, post, del } from './api.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { notesPanel } from './notes.js';
import { uploadNoteFiles, noteFileLinks } from './project-meetings.js';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
const hhmm = s => String(s || '').slice(11, 16);
const hours = s => Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
export const when = m => {
  const s = m.start_at || m.start;
  if (!s) return '';
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  const end = m.end_at || m.end;
  return `${DAYS[d.getDay()]} ${fmtDate(s.slice(0, 10), { year: true })}${m.all_day ? ' · tutto il giorno' : ` · ${hhmm(s)}${end ? `–${hhmm(end)}` : ''}`}`;
};
const via = name => (name ? h('div.crm-via', `tramite ${name}`) : null);
const autoPill = () => h('span.pill.crm-auto', icon('link', { size: 12 }), 'automatico');
const missingPill = () => h('span.pill.crm-missing', 'senza note');
export const bang = () => h('span.crm-bang', { title: 'Incontro fatto senza note' }, '!');

// ── ultimi aggiornamenti (panoramica) ────────────────────────────────────────
export async function timelineCard(base, { onOpenTab } = {}) {
  const box = h('section.card.crm-pad', h('div.crm-sec-row', h('h3.crm-h3', 'Ultimi aggiornamenti')), h('div', loading()));
  const chips = h('div.en-chips');
  let filter = 'all';
  box.querySelector('.crm-sec-row').append(chips);
  const { items } = await get(`${base}/timeline`).catch(() => ({ items: [] }));
  const ico = { email: ['mail', 'mail'], meeting: ['calendar', 'meet'], note: ['file-text', 'note'] };
  const draw = () => {
    fill(chips, [['all', 'Tutto'], ['email', 'Email'], ['meeting', 'Incontri'], ['note', 'Note']].map(([k, l]) => h('button.pill.en-chip', {
      type: 'button', class: filter === k ? 'on' : '', on: { click: () => { filter = k; draw(); } } }, l)));
    const shown = items.filter(i => filter === 'all' || i.type === filter);
    fill(box.lastChild, shown.length ? h('div.crm-lines', shown.map(i => h('div.crm-line',
      h('span.crm-ico', { class: i.missing ? 'warn' : ico[i.type][1] }, icon(ico[i.type][0], { size: 15 })),
      h('div.grow',
        h('div.crm-line-t', i.title || '(senza titolo)', i.missing ? missingPill() : null, i.auto ? autoPill() : null),
        h('div.t-meta', i.type === 'meeting' ? `Incontro · ${when({ start_at: i.date, end_at: i.end })}${i.notes ? ` · ${i.notes} note` : ''}`
          : i.type === 'email' ? `Email · ${fmtDate(String(i.date || '').slice(0, 10), { year: true })} · ${i.meta || ''}`
            : `${{ nota: 'Nota', telefonata: 'Telefonata', riunione: 'Riunione', decisione: 'Decisione' }[i.kind] || 'Nota'} · ${fmtDate(String(i.date).slice(0, 10), { year: true })}${i.meeting ? ` · nota dell'incontro «${i.meeting}»` : ''}`),
        i.type === 'note' && i.body && i.body !== i.title ? h('div.crm-line-b', i.body.slice(0, 220)) : null,
        via(i.via)),
      i.type === 'meeting' && i.missing ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(i.id, () => onOpenTab?.('incontri')) } }, 'Scrivi le note')
        : h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => (i.type === 'meeting' ? openCrmMeeting(i.id) : i.type === 'email' ? openCrmEmail(i.id) : onOpenTab?.('note')) } }, 'Apri'))))
      : h('p.muted.small', 'Ancora niente: email, incontri e note compariranno qui.'));
  };
  draw();
  return box;
}

// ── email ────────────────────────────────────────────────────────────────────
export function emailsTab(box, base, { canWrite = true, onCount } = {}) {
  const list = h('div', loading());
  const side = h('div');
  fill(box, h('div.crm-grid',
    h('section.card.crm-pad', h('div.crm-sec-row', h('h3.crm-h3', 'Email collegate'),
      canWrite ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => mailboxDialog(base, load) } }, icon('plus', { size: 14 }), 'Collega email') : null), list),
    side));
  async function load() {
    const emails = await get(`${base}/emails`).catch(() => []);
    onCount?.(emails.length);
    fill(list, emails.length ? h('div.crm-lines', emails.map(e => h('div.crm-line',
      h('span.crm-ico.mail', icon('mail', { size: 15 })),
      h('div.grow', h('div.crm-line-t', e.subject),
        h('div.t-meta', `${fmtDate(String(e.sent_at || '').slice(0, 10), { year: true })} · ${e.from_name || e.from_address || ''}${e.attachment_count ? ` · ${e.attachment_count} allegati` : ''}`),
        via(e.via)),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: () => openCrmEmail(e.id) } }, 'Apri'),
      canWrite && !e.via ? h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Togli', on: { click: async () => {
        if (!await confirmDialog(`Togliere «${e.subject}» da questa scheda?`, { ok: 'Togli', danger: true })) return;
        await del(`${base}/emails/${e.id}`);
        load();
      } } }, icon('x', { size: 14 })) : null)))
      : h('p.muted.small', 'Nessuna email collegata. Collegale dalla tua casella di Outlook.'));
    drawProposals();
  }
  async function drawProposals() {
    if (!canWrite) return;
    fill(side, h('section.card.crm-pad.crm-dashed', h('h3.crm-h3', 'Dalla tua casella'), loading()));
    let r;
    try { r = await get(`${base}/email-proposals`, { quiet: true }); } catch {
      return fill(side, h('section.card.crm-pad.crm-dashed', h('h3.crm-h3', 'Dalla tua casella'), h('p.muted.small', 'Collega Outlook per vedere le email scambiate con i contatti.')));
    }
    const picked = new Set();
    const btn = h('button.btn.btn-primary.btn-sm', { type: 'button', disabled: true, on: { click: async () => {
      btn.disabled = true;
      const res = await post(`${base}/emails`, { message_ids: [...picked] });
      toast(`${res.added} email collegate`);
      load();
    } } }, 'Collega');
    fill(side, h('section.card.crm-pad.crm-dashed', h('h3.crm-h3', 'Dalla tua casella'),
      h('p.small.muted', r.addresses.length ? 'Email con i contatti non ancora collegate' : 'Aggiungi l\'email ai contatti per avere le proposte.'),
      r.messages.length ? h('div.crm-lines', r.messages.map(m => h('label.crm-line.crm-pick',
        h('input', { type: 'checkbox', on: { change: e => { e.target.checked ? picked.add(m.id) : picked.delete(m.id); btn.disabled = !picked.size; btn.textContent = picked.size ? `Collega ${picked.size} email` : 'Collega'; } } }),
        h('div.grow', h('div.crm-line-t', m.subject), h('div.t-meta', `${fmtDate(String(m.date).slice(0, 10))} · ${m.from.name || m.from.address}`))))) : h('p.muted.small', 'Niente di nuovo.'),
      r.messages.length ? btn : null));
  }
  load();
}

// casella di Outlook per scegliere le email (stessa API dei progetti, senza progetto)
function mailboxDialog(base, onDone) {
  const search = h('input.input', { type: 'search', placeholder: 'Cerca nella posta…' });
  const folder = h('select.select', [['inbox', 'Posta in arrivo'], ['sent', 'Posta inviata'], ['all', 'Tutte']].map(([k, l]) => h('option', { value: k }, l)));
  const list = h('div.crm-lines.crm-scroll', loading());
  const picked = new Set();
  const load = async () => {
    fill(list, loading());
    let r;
    try { r = await get(`/api/mail/messages?folder=${folder.value}${search.value.trim() ? `&q=${encodeURIComponent(search.value.trim())}` : ''}`); } catch { return fill(list, h('p.muted', 'Posta non disponibile.')); }
    fill(list, r.messages.map(m => h('label.crm-line.crm-pick',
      h('input', { type: 'checkbox', checked: picked.has(m.id), on: { change: e => (e.target.checked ? picked.add(m.id) : picked.delete(m.id)) } }),
      h('div.grow', h('div.crm-line-t', m.subject), h('div.t-meta', `${fmtDate(String(m.date).slice(0, 10))} · ${m.from.name || m.from.address}`), h('div.crm-line-b', m.preview)))));
  };
  search.addEventListener('change', load);
  folder.addEventListener('change', load);
  const m = modal({
    wide: true, title: 'Collega email dalla tua casella', body: h('div.en-form', h('div.crm-composer-row', folder, search), list),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
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
  modal({
    wide: true, title: e.subject,
    body: h('div.en-detail',
      h('div.t-meta', `${fmtDate(String(e.sent_at || '').slice(0, 10), { year: true })} · da ${e.from_name || ''} ${e.from_address ? `<${e.from_address}>` : ''}`),
      e.to_list?.length ? h('div.t-meta', `a ${e.to_list.map(t => t.name || t.address).join(', ')}`) : null,
      e.attachments.length ? h('div.mt-files', e.attachments.map(a => h('a.mt-file', { href: `/api/crm/emails/${e.id}/attachments/${a.id}`, download: a.name }, icon('paperclip', { size: 13 }), ` ${a.name}`))) : null,
      h('pre.crm-mail', e.body_text || '')),
    actions: e.web_link ? [h('a.btn', { href: e.web_link, target: '_blank', rel: 'noopener' }, 'Apri in Outlook')] : [],
  });
}

// ── incontri: settimana del proprio calendario + elenco ──────────────────────
export function meetingsTab(box, base, { canWrite = true, people = [], onCount, label = 'questa scheda' } = {}) {
  let week = mondayOf(today());
  const cal = h('div.crm-week', loading());
  const title = h('strong');
  const list = h('div', loading());
  fill(box,
    h('section.card.crm-pad.crm-cal',
      h('div.crm-sec-row',
        h('div.crm-composer-row',
          h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana prima', on: { click: () => { week = addDays(week, -7); loadCal(); } } }, '‹'),
          h('button.btn.btn-sm', { type: 'button', on: { click: () => { week = mondayOf(today()); loadCal(); } } }, 'Oggi'),
          h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Settimana dopo', on: { click: () => { week = addDays(week, 7); loadCal(); } } }, '›'), title),
        canWrite ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => scheduleDialog(base, people, reload) } }, icon('plus', { size: 14 }), 'Fissa un incontro') : null),
      h('div.crm-legend', h('span', h('i.mine'), `collegato a ${label}`), h('span', h('i.other'), 'altro nel tuo calendario: clicca per collegarlo'), h('span', h('i.nonotes'), 'fatto, senza note')),
      cal),
    h('section.card.crm-pad', h('h3.crm-h3', 'Incontri collegati'), list));
  const reload = () => { loadCal(); loadList(); };
  async function loadCal() {
    const end = addDays(week, 5);
    title.textContent = `${fmtDate(week)} – ${fmtDate(addDays(week, 4), { year: true })}`;
    let events;
    try { events = await get(`${base}/calendar?start=${week}&end=${end}`, { quiet: true }); } catch {
      return fill(cal, h('p.muted.small', 'Il tuo calendario di Outlook non è disponibile: collega Microsoft per vederlo. Gli incontri collegati sono qui sotto.'));
    }
    const H0 = 8, H1 = 19, ROW = 36;
    const days = [0, 1, 2, 3, 4].map(i => addDays(week, i));
    fill(cal,
      h('div.crm-wh', days.map(d => h('span', `${DAYS[new Date(`${d}T12:00:00`).getDay()]} ${Number(d.slice(8))}`))),
      h('div.crm-wb', { style: { height: `${(H1 - H0) * ROW}px` } },
        Array.from({ length: H1 - H0 }, (_, i) => h('span.crm-hr', { style: { top: `${i * ROW}px` } }, `${H0 + i}:00`)),
        events.filter(e => !e.all_day).map(e => {
          const di = days.indexOf(e.start.slice(0, 10));
          if (di < 0) return null;
          const top = Math.max(0, (hours(e.start) - H0) * ROW), hgt = Math.max(18, (hours(e.end || e.start) - hours(e.start)) * ROW);
          return h('button.crm-ev', {
            type: 'button', class: [e.linked ? 'mine' : 'other', e.missing_notes ? 'nonotes' : ''].join(' '),
            style: { left: `calc(${di} * 20% + 3px)`, top: `${top}px`, height: `${hgt}px` },
            title: e.linked ? (e.missing_notes ? 'Senza note: aprilo e scrivile' : 'Apri l\'incontro') : 'Collega questo incontro',
            on: { click: async () => {
              if (e.linked) return openCrmMeeting(e.meeting_id, reload);
              if (!canWrite) return;
              if (!await confirmDialog(`Collegare «${e.subject}» a ${label}?`, { ok: 'Collega' })) return;
              await post(`${base}/meetings`, { event_ids: [e.id] });
              toast('Incontro collegato');
              reload();
            } },
          }, h('span', e.subject), e.missing_notes ? h('small', 'senza note') : null);
        })));
  }
  async function loadList() {
    const meetings = await get(`${base}/meetings`).catch(() => []);
    onCount?.(meetings.length, meetings.filter(m => m.missing_notes).length);
    fill(list, meetings.length ? h('div.crm-lines', meetings.map(m => h('div.crm-line',
      h('span.crm-ico', { class: m.missing_notes ? 'warn' : 'meet' }, icon('calendar', { size: 15 })),
      h('div.grow',
        h('div.crm-line-t', m.subject, m.missing_notes ? missingPill() : null, m.auto ? autoPill() : null),
        h('div.t-meta', [when(m), m.location, m.attendees?.length ? m.attendees.map(a => a.name || a.address).slice(0, 4).join(', ') : '', m.note_count ? `${m.note_count} note` : ''].filter(Boolean).join(' · ')),
        via(m.via)),
      m.missing_notes ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(m.id, reload) } }, 'Scrivi le note')
        : h('button.btn.btn-sm', { type: 'button', on: { click: () => openCrmMeeting(m.id, reload) } }, 'Apri'),
      canWrite && !m.via ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Togliere «${m.subject}» da ${label}? Non verrà più collegato da solo.`, { ok: 'Togli', danger: true })) return;
        await del(`${base}/meetings/${m.id}`);
        reload();
      } } }, 'Togli') : null)))
      : h('p.muted.small', 'Nessun incontro. Si collegano dal calendario qui sopra, con «Fissa un incontro», oppure da soli quando un invitato ha un\'email del CRM.'));
  }
  reload();
}

// «Fissa un incontro» come in Outlook: invitati tra i contatti della scheda e i colleghi
function scheduleDialog(base, people, onDone) {
  const subject = h('input.input', { placeholder: 'Titolo', maxlength: 255, autofocus: true });
  const day = h('input.input', { type: 'date', value: today() });
  const from = h('input.input', { type: 'time', value: '10:00' });
  const to = h('input.input', { type: 'time', value: '11:00' });
  const where = h('input.input', { placeholder: 'Luogo' });
  const online = h('input', { type: 'checkbox' });
  const picked = new Set(people.filter(p => p.email && p.preset).map(p => p.email));
  const colleagues = store.users.filter(u => u.active !== false && u.id !== store.me.id).map(u => ({ name: u.name, email: u.email }));
  const chip = p => h('button.pill.en-chip', { type: 'button', class: picked.has(p.email) ? 'on' : '', on: { click: e => {
    picked.has(p.email) ? picked.delete(p.email) : picked.add(p.email);
    e.currentTarget.classList.toggle('on', picked.has(p.email));
  } } }, p.name);
  const colleagueSel = h('select.select', [h('option', { value: '' }, 'Aggiungi un collega…'), ...colleagues.map(c => h('option', { value: c.email }, c.name))]);
  const colleagueBox = h('div.en-chips');
  colleagueSel.addEventListener('change', () => {
    const c = colleagues.find(x => x.email === colleagueSel.value);
    if (c && !picked.has(c.email)) { picked.add(c.email); colleagueBox.append(chip(c)); }
    colleagueSel.value = '';
  });
  const m = modal({
    title: 'Fissa un incontro',
    body: h('div.en-form', subject, h('div.en-row3', day, from, to), where,
      h('label.en-check', online, 'Riunione su Teams'),
      h('div', h('div.crm-h3', 'Contatti'), people.filter(p => p.email).length ? h('div.en-chips', people.filter(p => p.email).map(chip)) : h('p.small.muted', 'Nessun contatto con email.')),
      h('div', h('div.crm-h3', 'Colleghi'), colleagueSel, colleagueBox)),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!subject.value.trim()) return toast('Scrivi il titolo', 'err');
      await post(`${base}/meetings/new`, { title: subject.value.trim(), start: `${day.value}T${from.value}`, end: `${day.value}T${to.value}`,
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
  const body = h('textarea.input', { rows: 5, placeholder: 'Com\'è andato: decisioni, cose da fare, prossimo passo… (@ per avvisare un collega)' });
  const fileIn = h('input', { type: 'file', multiple: true });
  const notesBox = h('div');
  const drawNotes = () => fill(notesBox, mt.notes.length ? h('div.crm-lines', mt.notes.map(n => h('div.crm-line',
    h('span.crm-ico.note', icon('file-text', { size: 15 })),
    h('div.grow', n.title ? h('div.crm-line-t', n.title) : null, h('div.crm-line-b', n.body),
      h('div.t-meta', `${fmtDate(n.note_date, { year: true })} · ${store.users.find(u => u.id === n.author_id)?.name || ''}`), noteFileLinks(n, null, '/api/crm/note-files')))))
    : null);
  drawNotes();
  const m = modal({
    wide: true,
    title: h('div', h('div.en-eyebrow', `Incontro${mt.links.length ? ` · ${mt.links.map(l => l.subject_name || l.contact_name).join(', ')}` : ''}`), h('h2', mt.subject)),
    body: h('div.en-detail',
      h('div.t-meta', [when(mt), mt.location, mt.attendees?.map(a => a.name || a.address).join(', ')].filter(Boolean).join(' · ')),
      h('div.en-chips', mt.missing_notes ? missingPill() : null, mt.links.some(l => l.auto) ? h('span.pill.crm-auto', icon('link', { size: 12 }), 'collegato in automatico da Outlook') : null),
      notesBox,
      h('div.crm-composer', body, h('div.crm-composer-row', fileIn, h('span.grow'),
        h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
          const files = [...fileIn.files];
          if (!body.value.trim() && !files.length) return toast('Scrivi le note', 'err');
          const n = await post(`/api/crm/meetings/${id}/notes`, { body: body.value.trim(), with_files: files.length > 0 });
          if (files.length) await uploadNoteFiles(n.id, files, '/api/crm/notes');
          toast('Note salvate');
          m.close();
          onChange?.();
        } } }, 'Salva le note')))),
    actions: mt.web_link ? [h('a.btn', { href: mt.web_link, target: '_blank', rel: 'noopener' }, 'Apri in Outlook')] : [],
  });
}

// ── note (come negli A3) ─────────────────────────────────────────────────────
export function notesTab(box, base, { onCount, isSubject } = {}) {
  fill(box);
  const wrap = h('section.card.crm-pad');
  box.append(wrap);
  notesPanel(wrap, { url: `${base}/notes`, api: '/api/crm/notes', filesApi: '/api/crm/note-files', onCount,
    openMeetingFn: (mid, reload) => openCrmMeeting(mid, reload), origins: isSubject ? 'Solo dell\'azienda' : null, title: 'Note' });
}

// ── progetti di Alma Project ─────────────────────────────────────────────────
export function projectsTab(box, base, { canWrite = true, onCount, newName = '' } = {}) {
  const grid = h('div.crm-proj-grid', loading());
  fill(box,
    canWrite ? h('div.crm-actions.crm-right',
      h('button.btn.btn-sm', { type: 'button', on: { click: () => linkProjectDialog(base, load) } }, icon('link', { size: 14 }), 'Collega un progetto'),
      h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: async () => {
        const name = newName ? `${newName}` : 'Nuovo progetto';
        const p = await post('/api/projects', { name });
        await post(`${base}/projects`, { project_id: p.id });
        toast('Progetto creato e collegato');
        location.hash = `#/projects/${p.id}`;
      } } }, icon('plus', { size: 14 }), 'Nuovo progetto per questa scheda')) : null,
    grid);
  async function load() {
    const list = await get(`${base}/projects`).catch(() => []);
    onCount?.(list.length);
    fill(grid, list.length ? list.map(p => {
      const done = p.total_tickets ? Math.round(((p.total_tickets - p.open_tickets) / p.total_tickets) * 100) : 0;
      return h('section.card.crm-pad.crm-proj',
        h('a.crm-proj-head', { href: `#/projects/${p.id}` }, h('span.crm-ico', { style: { background: p.color, color: '#fff' } }, icon('folder', { size: 15 })),
          h('div.grow', h('div.crm-line-t', p.name), h('div.t-meta', `Alma Project · ${p.owner_name || '—'}`))),
        h('div.crm-bar', h('i', { style: { width: `${done}%` } })),
        h('div.crm-sec-row', h('span.t-meta', `${p.open_tickets} ticket aperti${p.due_date ? ` · scade ${fmtDate(p.due_date, { year: true })}` : ''}`),
          canWrite ? h('button.btn.btn-ghost.btn-sm', { type: 'button', on: { click: async () => {
            if (!await confirmDialog(`Scollegare «${p.name}»? Il progetto resta in Alma Project.`, { ok: 'Scollega' })) return;
            await del(`${base}/projects/${p.id}`);
            load();
          } } }, 'Scollega') : null));
    }) : h('div.card.empty', 'Nessun progetto collegato.'));
  }
  load();
}
function linkProjectDialog(base, onDone) {
  const sel = h('select.select', [h('option', { value: '' }, 'Scegli il progetto…'), ...store.projects.filter(p => p.status !== 'archived').map(p => h('option', { value: p.id }, p.name))]);
  const m = modal({
    title: 'Collega un progetto', body: h('div.en-form', sel),
    actions: [h('button.btn.btn-primary', { type: 'button', on: { click: async () => {
      if (!sel.value) return toast('Scegli il progetto', 'err');
      await post(`${base}/projects`, { project_id: Number(sel.value) });
      m.close();
      onDone?.();
    } } }, 'Collega')],
  });
}
