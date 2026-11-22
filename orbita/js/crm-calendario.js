// Calendario del CRM (ALM2-65, tavola I del canvas «Progetto da email», approvata da Dante il 22/11/2026).
// - calendarioPage: CRM → Calendario. A sinistra «Nuovo incontro», filtri per colore, colleghi libero/occupato e «Da
//   sistemare»; al centro il tuo Outlook (FullCalendar: giorno, settimana, mese, agenda); a destra il pannello dell'incontro.
// - schedaCalendar: lo stesso calendario a tutta larghezza nella tab Incontri delle schede (arancio = collegato qui,
//   grigio = clic per collegarlo, bordo rosso = finito senza note).
// - meetingPanel: chi c'è col suo stato nel CRM, collegamenti, Accetta/Forse/Rifiuta, «Prepara l'incontro» con Alma,
//   note, riepilogo ai partecipanti con la firma, follow-up e prossimo incontro.
// - newMeeting: con chi (colleghi e contatti), quando, «Trova un orario libero», Teams o luogo, collega a, invito (anche
//   con Alma), promemoria. Tasti: N nuovo, T oggi, G giorno, S settimana, M mese, A agenda.
import { h, fill, toast, loading, debounce, fmtDate, today, addDays, toISODate } from './ui.js';
import { get, post, patch } from './api.js';
import { store } from './store.js';
import { ic, pill, cvModal, emptyState } from './crm-v2.js';
import { linkEventToProject } from './project-meetings.js';

const KINDS = [
  ['crm', 'Clienti e aziende del CRM'], ['prj', 'Progetti e trattative'], ['inv', 'Inviti da confermare'],
  ['scad', 'Scadenze del Radar'], ['oth', 'Altri esterni'], ['int', 'Interni (colleghi)'],
];
const pad = n => String(n).padStart(2, '0');
const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hhmm = s => String(s || '').slice(11, 16);
const firstName = n => String(n || '').split(' ').filter(w => !/^(ing|arch|geom|dott|avv)\.?$/i.test(w))[0] || '';
const cents = eur => (!(eur > 0) ? '' : eur * 100 < 0.01 ? 'meno di 0,01 cent' : `${(eur * 100).toLocaleString('it-IT', { maximumFractionDigits: eur * 100 < 0.1 ? 2 : 1 })} cent`);
const RESP = { accepted: ['ha accettato', 'gr'], tentativelyAccepted: ['forse', ''], declined: ['ha rifiutato', 'rd'], organizer: ['organizza', 'bl'], none: ['non ha risposto', ''], notResponded: ['non ha risposto', ''] };
const loadKinds = () => { try { return new Set(JSON.parse(localStorage.getItem('crm-cal-kinds') || 'null') || ['crm', 'prj', 'inv', 'scad', 'oth']); } catch { return new Set(['crm', 'prj', 'inv', 'scad', 'oth']); } };

// finestra con pulsanti { label, primary, onClick } (onClick che restituisce false lascia la finestra aperta)
function dlg({ title, body, actions = [], wide = false }) {
  let m = null;
  const btn = a => {
    const b = h("button.btn", { type: "button", class: a.primary ? "btn-primary" : "", on: { click: async () => {
      if (!a.onClick) return m.close();
      b.disabled = true;
      try { if ((await a.onClick()) !== false) m.close(); } catch (err) { toast(err?.message || "Non riuscito", "err", 8000); } finally { b.disabled = false; }
    } } }, a.label);
    return b;
  };
  m = cvModal({ title, body, wide, actions: actions.map(btn) });
  return m;
}

// ── il calendario (FullCalendar) ─────────────────────────────────────────────────────────────────
function makeCalendar(el, { scheda = '', kinds = null, colleagues = () => [], onEvent, onSelect, onLoaded, initialView = 'timeGridWeek', compact = false }) {
  const mobile = matchMedia('(max-width: 760px)').matches;
  // eslint-disable-next-line no-undef
  const cal = new FullCalendar.Calendar(el, {
    locale: 'it', firstDay: 1, height: 'auto', nowIndicator: true, navLinks: true, dayMaxEvents: 4,
    initialView: mobile ? 'listWeek' : initialView,
    headerToolbar: mobile ? { left: 'prev,next', center: 'title', right: 'today' } : { left: 'prev,next today', center: 'title', right: compact ? 'timeGridWeek,dayGridMonth' : 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' },
    buttonText: { today: 'Oggi', day: 'Giorno', week: 'Settimana', month: 'Mese', list: 'Agenda' },
    slotMinTime: '07:30:00', slotMaxTime: '20:00:00', weekends: false, allDaySlot: true,
    // incontri allo stesso orario uno accanto all'altro (non sovrapposti), righe da mezz'ora leggibili
    slotEventOverlap: false, eventMinHeight: 22, slotDuration: '00:30:00', expandRows: false, eventMaxStack: 3,
    selectable: Boolean(onSelect), selectMirror: true, editable: true, eventStartEditable: true, eventDurationEditable: true,
    events: async (info, ok, ko) => {
      try {
        const start = info.startStr.slice(0, 19), end = info.endStr.slice(0, 19);
        const q = new URLSearchParams({ start, end, ...(scheda ? { scheda } : {}) });
        const [r, busy] = await Promise.all([
          get(`/api/crm/calendario/eventi?${q}`, { quiet: true }),
          colleagues().length ? get(`/api/crm/calendario/occupato?${new URLSearchParams({ start, end, emails: colleagues().map(c => c.address).join(',') })}`, { quiet: true }).catch(() => ({ people: [] })) : { people: [] },
        ]);
        onLoaded?.(r);
        const show = e => (scheda ? true : (kinds ? kinds.has(e.kind) : true));
        ok([
          ...r.events.filter(show).map(e => ({
            // un evento di 8 ore o più (es. «Shooting al casale» 8–23) va nella riga «Tutto il giorno», non copre la colonna
            ...(!e.all_day && (Date.parse(e.end) - Date.parse(e.start)) >= 8 * 36e5 ? { allDay: true, start: e.start.slice(0, 10), end: addDays(e.end.slice(0, 10), e.end.slice(11) > '00:00:00' ? 1 : 0), long: true } : { allDay: e.all_day, start: e.start, end: e.end }),
            id: e.id, title: e.title, editable: e.organizer && e.kind !== 'scad' && !(Date.parse(e.end) - Date.parse(e.start) >= 8 * 36e5),
            classNames: ['kc-ev', scheda ? (e.here ? 'k-here' : 'k-other') : `k-${e.kind}`, e.missing_notes ? 'k-nonotes' : ''].filter(Boolean),
            extendedProps: { ev: e },
          })),
          ...(scheda ? [] : r.deadlines.filter(show).map(d => ({ id: d.id, title: d.title, start: d.start, allDay: true, editable: false, classNames: ['kc-ev', 'k-scad'], extendedProps: { deadline: d } }))),
          ...busy.people.flatMap(p => p.busy.map(b => ({ start: b.start, end: b.end, display: 'background', classNames: ['k-busy'], title: `${(colleagues().find(c => c.address === p.address)?.name || p.address).split(' ')[0]} occupato` }))),
        ]);
      } catch (err) { ko(err); }
    },
    eventContent: arg => {
      if (arg.event.display === 'background') return { html: `<span class="k-busy-l">${arg.event.title}</span>` };
      const e = arg.event.extendedProps.ev;
      if (!e) return undefined;
      // quanto spazio c'è: fino a 45' una riga sola (ora · titolo), da 75' anche luogo/Teams/persone del CRM
      const mins = arg.event.allDay ? 0 : (arg.event.end - arg.event.start) / 60000;
      const timed = arg.view.type.startsWith('timeGrid') && !arg.event.allDay;
      const sub = [e.location, e.online ? 'Teams' : '', e.crm_people?.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
      const start = hhmm(e.start);
      const node = document.createElement('div');
      node.className = `k-in${timed && mins <= 45 ? ' k-one' : ''}`;
      const b = document.createElement('b');
      b.textContent = e.title;
      if (timed && mins <= 45) {
        const t = document.createElement('span'); t.className = 'k-t'; t.textContent = `${start} `;
        node.append(t, b);
      } else {
        if (timed) { const t = document.createElement('span'); t.className = 'k-t'; t.textContent = arg.timeText; node.append(t); }
        node.append(b);
        if (timed && mins >= 75 && sub) { const s = document.createElement('small'); s.textContent = sub; node.append(s); }
      }
      node.title = `${e.kind === 'inv' ? 'Invito da confermare · ' : ''}${e.title}${e.all_day ? '' : ` · ${hhmm(e.start)}–${hhmm(e.end)}`}${sub ? ` · ${sub}` : ''}`;
      return { domNodes: [node] };
    },
    eventClick: info => { info.jsEvent.preventDefault(); const { ev, deadline } = info.event.extendedProps; if (deadline) location.hash = `#/crm/lancio/s/${deadline.signal_id}`; else if (ev) onEvent?.(ev); },
    eventDrop: info => moved(info), eventResize: info => moved(info),
    select: info => { onSelect?.(info); cal.unselect(); },
  });
  async function moved(info) {
    const e = info.event.extendedProps.ev;
    if (!e?.organizer) { info.revert(); toast('Puoi spostare solo gli incontri che organizzi tu', 'err'); return; }
    try {
      await patch(`/api/calendar/events/${encodeURIComponent(e.id)}`, { start: localIso(info.event.start), end: localIso(info.event.end || info.event.start), allDay: info.event.allDay });
      toast(`«${e.title}» spostato: gli invitati ricevono l'aggiornamento`);
    } catch { info.revert(); }
  }
  cal.render();
  return cal;
}

// ── pagina CRM → Calendario ─────────────────────────────────────────────────────────────────────
export async function calendarioPage(container) {
  const kinds = loadKinds();
  const st = { colleagues: [], sel: null, last: null };
  const calEl = h('div.kc-cal');
  const panel = h('aside.kc-panel', { hidden: true }); // compare solo quando si apre un incontro: il calendario ha tutta la larghezza
  const fix = h('div.kc-fix');
  const counts = {};
  const filters = h('div.kc-filters', KINDS.map(([k, l]) => {
    const cb = h('input', { type: 'checkbox', checked: kinds.has(k) });
    cb.addEventListener('change', () => { cb.checked ? kinds.add(k) : kinds.delete(k); try { localStorage.setItem('crm-cal-kinds', JSON.stringify([...kinds])); } catch { /* niente */ } cal.refetchEvents(); });
    counts[k] = h('span.kc-n');
    return h('label', cb, h('i', { class: `k-dot k-${k}` }), h('span', l), counts[k]);
  }));
  const colBox = h('div.kc-cols');
  const colInput = h('input.kc-col-i', { placeholder: '+ aggiungi un collega', 'aria-label': 'Aggiungi un collega' });
  const colList = h('div.pm-sugg', { hidden: true });
  const drawCols = () => fill(colBox, st.colleagues.map(c => h('span.pm-rcpt', c.name, h('button', { type: 'button', 'aria-label': `Togli ${c.name}`, on: { click: () => { st.colleagues = st.colleagues.filter(x => x !== c); drawCols(); cal.refetchEvents(); } } }, '×'))),
    h('span.pm-rcpt-w', colInput, colList));
  colInput.addEventListener('input', debounce(() => {
    const q = colInput.value.trim().toLowerCase();
    const opts = q.length < 2 ? [] : store.users.filter(u => u.id !== store.me.id && u.email && u.active !== false && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && !st.colleagues.some(c => c.address === u.email.toLowerCase())).slice(0, 6);
    colList.hidden = !opts.length;
    fill(colList, opts.map(u => h('button', { type: 'button', on: { mousedown: ev => { ev.preventDefault(); st.colleagues.push({ name: u.name, address: u.email.toLowerCase() }); colInput.value = ''; colList.hidden = true; drawCols(); cal.refetchEvents(); } } }, h('b', u.name), h('small', u.email))));
  }, 150));
  colInput.addEventListener('blur', () => setTimeout(() => { colList.hidden = true; }, 150));
  drawCols();

  const wrap = h('div.kc',
    h('aside.kc-side',
      h('button.btn.btn-primary.kc-new', { type: 'button', title: 'Nuovo incontro (tasto N)', on: { click: () => newMeeting({ onDone: () => cal.refetchEvents() }) } }, ic('plus', 15), 'Nuovo incontro'),
      h('div.kc-sec', h('span.kc-k', 'Mostra'), filters),
      h('div.kc-sec', h('span.kc-k', 'Colleghi · libero/occupato'), colBox),
      fix),
    h('section.kc-main', calEl),
    panel);
  fill(container, wrap);

  const cal = makeCalendar(calEl, {
    kinds, colleagues: () => st.colleagues,
    onEvent: ev => { st.sel = ev.id; openPanel(ev.id); },
    onSelect: info => newMeeting({ start: info.start, end: info.end, onDone: () => cal.refetchEvents() }),
    onLoaded: r => {
      st.last = r;
      for (const [k] of KINDS) counts[k].textContent = String((k === 'scad' ? r.deadlines : r.events.filter(e => e.kind === k)).length || '');
      const noNotes = r.events.filter(e => e.missing_notes);
      const inv = r.events.filter(e => e.kind === 'inv');
      // compatto: due righe coi numeri; il primo senza note si apre, gli inviti portano all'agenda con solo gli inviti
      fill(fix, noNotes.length || inv.length ? h('div.kc-dark', h('span.kc-k', 'Da sistemare'),
        noNotes.length ? h('button', { type: 'button', on: { click: () => openPanel(noNotes[0].id) } }, h('b', String(noNotes.length)), noNotes.length === 1 ? ` incontro senza note · ${noNotes[0].title}` : ' incontri finiti senza note ›') : null,
        inv.length ? h('button', { type: 'button', on: { click: () => onlyInvites() } }, h('b', String(inv.length)), inv.length === 1 ? ' invito da confermare ›' : ' inviti da confermare ›') : null) : null);
    },
  });
  function openPanel(eid) {
    panel.hidden = false;
    wrap.classList.add('with-panel');
    meetingPanel(panel, eid, { onChange: () => cal.refetchEvents(), onClose: closePanel });
    setTimeout(() => cal.updateSize(), 0);
  }
  function closePanel() { panel.hidden = true; wrap.classList.remove('with-panel'); setTimeout(() => cal.updateSize(), 0); }
  function onlyInvites() {
    kinds.clear(); kinds.add('inv');
    filters.querySelectorAll('input').forEach((cb, i) => { cb.checked = KINDS[i][0] === 'inv'; });
    cal.changeView('listWeek');
    cal.refetchEvents();
    toast('Solo gli inviti da confermare: rimetti gli altri dai filtri «Mostra»');
  }

  const keys = ev => {
    if (!container.isConnected) { document.removeEventListener('keydown', keys); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
    const t = ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('#overlay-root > *')) return;
    if (ev.key === 'Escape' && !panel.hidden) { ev.preventDefault(); closePanel(); return; }
    const act = { n: () => newMeeting({ onDone: () => cal.refetchEvents() }), t: () => cal.today(), g: () => cal.changeView('timeGridDay'), s: () => cal.changeView('timeGridWeek'), m: () => cal.changeView('dayGridMonth'), a: () => cal.changeView('listWeek') }[ev.key.toLowerCase()];
    if (act) { ev.preventDefault(); act(); }
  };
  document.addEventListener('keydown', keys);
}

// ── scheda azienda/contatto: sotto-tab Calendario a tutta larghezza ─────────────────────────────
export function schedaCalendar(box, { target, id, label, name, people = [], canWrite = true, onChange }) {
  const calEl = h('div.kc-cal');
  const onlyHere = h('input', { type: 'checkbox' });
  const panel = h('div.kc-scheda-panel', { hidden: true });
  fill(box, h('div.kc-scheda',
    h('div.kc-legend',
      h('span', h('i.k-dot.k-here'), `collegato a ${label}`), h('span', h('i.k-dot.k-other'), 'altro: clicca per collegarlo'), h('span', h('i.k-dot.k-nonotes')), 'finito senza note',
      h('label.kc-only', onlyHere, 'mostra solo i collegati'),
      canWrite ? h('button.btn.btn-primary.btn-sm', { type: 'button', on: { click: () => newMeeting({ people, link: { [target === 'subjects' ? 'subject_id' : 'contact_id']: id, name }, onDone: () => { cal.refetchEvents(); onChange?.(); } }) } }, ic('plus', 14), `Programma con ${name}`) : null),
    panel, calEl));
  const cal = makeCalendar(calEl, {
    scheda: `${target}:${id}`, compact: false,
    onEvent: async ev => {
      if (ev.here) { panel.hidden = false; meetingPanel(panel, ev.id, { onChange: () => { cal.refetchEvents(); onChange?.(); }, onClose: () => { panel.hidden = true; } }); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (!canWrite) return;
      await post(`/api/crm/calendario/evento/${encodeURIComponent(ev.id)}/collega`, { [target === 'subjects' ? 'subject_id' : 'contact_id']: id });
      toast(`«${ev.title}» collegato a ${label}`);
      cal.refetchEvents(); onChange?.();
    },
  });
  onlyHere.addEventListener('change', () => calEl.classList.toggle('only-here', onlyHere.checked));
  return cal;
}

// ── pannello dell'incontro ──────────────────────────────────────────────────────────────────────
export async function meetingPanel(box, eid, { onChange, onClose } = {}) {
  fill(box, loading());
  let e;
  try { e = await get(`/api/crm/calendario/evento/${encodeURIComponent(eid)}`); } catch (err) { fill(box, emptyState('calendar', err?.message || 'Incontro non trovato')); return; }
  const again = () => meetingPanel(box, eid, { onChange, onClose });
  const respond = async tipo => {
    await post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/risposta`, { tipo });
    toast({ accetta: 'Accettato', forse: 'Risposto «forse»', rifiuta: 'Rifiutato' }[tipo]); onChange?.(); again();
  };
  const linkSearch = () => pickCrm(async item => {
    await post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/collega`, item.subject_id ? { subject_id: item.subject_id } : { contact_id: item.contact_id });
    toast(`Collegato a ${item.name}`); onChange?.(); again();
  });
  const prep = h('div.kc-prep');
  const prepBtn = h('button.btn.btn-sm.pm-aib', { type: 'button', on: { click: async () => {
    prepBtn.disabled = true; fill(prep, loading());
    try {
      const r = await post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/prepara`, {});
      const row = (k, v) => (v ? h('p', h('b', `${k}: `), v) : null);
      fill(prep, h('div.kc-prep-h', h('span.kc-k', 'Prepara l\'incontro'), h('small', r.ai ? `costato ${cents(r.eur) || 'meno di 0,01 cent'}` : 'senza AI (regole semplici)')),
        row('Da sapere', r.da_sapere), row('Ultima volta', r.ultima_volta), row('Da chiedere', r.da_chiedere), row('Porta', r.porta));
    } catch (err) { fill(prep); toast(err?.message || 'Non riuscito', 'err', 8000); }
    prepBtn.disabled = false;
  } } }, ic('sparkles', 14), 'Prepara l\'incontro', h('small.pm-est', '≈ 0,05 cent'));
  const noteText = h('textarea.pm-draft-t', { rows: 3, placeholder: 'Scrivi cosa vi siete detti: finisce nella cronologia dell\'azienda e del progetto', 'aria-label': 'Note dell\'incontro' });
  const saveNote = async () => {
    if (!noteText.value.trim()) return noteText.focus();
    await post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/nota`, { testo: noteText.value.trim() });
    toast('Nota salvata'); onChange?.(); again();
  };
  const recap = async () => {
    let r;
    try { r = await post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/riepilogo`, {}); } catch (err) { toast(err?.message || 'Non riuscito', 'err', 8000); return; }
    sendDialog({ title: 'Riepilogo ai partecipanti', to: r.to.map(p => ({ name: p.name, address: p.address })), subject: r.oggetto, text: r.testo, cost: r.ai ? cents(r.eur) : '', send: body => post(`/api/crm/calendario/evento/${encodeURIComponent(eid)}/manda`, body) });
  };
  const ext = e.people.filter(p => !p.internal);
  const past = e.end <= localIso(new Date());
  fill(box,
    h('div.kc-ph',
      h('div', h('h3', e.title), h('small', `${fmtDate(e.start.slice(0, 10))} · ${e.all_day ? 'tutto il giorno' : `${hhmm(e.start)} – ${hhmm(e.end)}`}${e.location ? ` · ${e.location}` : ''}`)),
      onClose ? h('button.btn.btn-sm.cv-ico', { type: 'button', 'aria-label': 'Chiudi', on: { click: onClose } }, ic('x', 14)) : null),
    h('div.kc-row',
      !e.organizer ? [['accetta', 'Accetta', 'accepted'], ['forse', 'Forse', 'tentativelyAccepted'], ['rifiuta', 'Rifiuta', 'declined']].map(([k, l, r]) => h('button.btn.btn-sm', { type: 'button', class: e.response === r ? 'kc-on' : '', on: { click: () => respond(k) } }, l)) : null,
      h('span.pm-sep'),
      e.online_url ? h('a.btn.btn-sm', { href: e.online_url, target: '_blank', rel: 'noopener' }, 'Entra in Teams') : null,
      e.web_link ? h('a.btn.btn-sm', { href: e.web_link, target: '_blank', rel: 'noopener' }, 'Apri in Outlook') : null),
    h('span.kc-k', 'Collegato a'),
    h('div.kc-row',
      e.projects.map(p => h('a.pm-chip', { href: `#/crm/progetto/${p.id}` }, `Progetto · ${p.name} ›`)),
      e.links.map(l => h('a.pm-chip', { href: l.subject_id ? `#/crm/scheda/${l.subject_id}` : `#/crm/contatti/${l.contact_id}` }, `${l.name} ›`)),
      !e.projects.length && !e.links.length ? h('span.cv-muted.cv-small', 'Niente ancora') : null,
      h('button.cv-lnk', { type: 'button', on: { click: linkSearch } }, '+ azienda o contatto'),
      h('button.cv-lnk', { type: 'button', on: { click: () => linkEventToProject({ id: e.id, title: e.title }) } }, '+ progetto')),
    h('span.kc-k', 'Chi c\'è'),
    h('div.kc-people', e.people.map(p => h('div.kc-person',
      h('span', h('b', p.name || p.address), p.internal ? ' · collega' : p.company ? ` · ${p.company}` : ''),
      p.internal ? pill(RESP[p.response]?.[0] || '', RESP[p.response]?.[1] || '')
        : p.contact_id ? pill(`nel CRM · ${RESP[p.response]?.[0] || ''}`, 'gr')
          : h('button.cv-lnk', { type: 'button', on: { click: async () => { const { openContactFromMail } = await import('./crm-scrivo.js'); if (await openContactFromMail({ email: p.address, name: p.name }) === 'ok') again(); } } }, 'non nel CRM · Aggiungi')))),
    h('div.kc-prep-w', prepBtn, prep),
    h('span.kc-k', `Note dell'incontro${e.missing_notes ? ' · mancano' : ''}`),
    e.notes.map(n => h('div.kc-note', h('small', fmtDate(n.date)), h('p', n.title ? `${n.title}: ${n.body}` : n.body))),
    noteText,
    h('div.kc-row',
      h('button.btn.btn-sm', { type: 'button', on: { click: saveNote } }, 'Salva la nota'),
      h('span.pm-sep'),
      past || e.notes.length ? h('button.btn.btn-sm.pm-aib', { type: 'button', on: { click: recap } }, ic('sparkles', 14), 'Riepilogo ai partecipanti', h('small.pm-est', '≈ 0,04 cent')) : null),
    h('div.kc-row',
      h('button.btn.btn-sm', { type: 'button', on: { click: () => followUp(e) } }, ic('plus', 13), 'Attività di follow-up'),
      h('button.btn.btn-sm', { type: 'button', on: { click: () => newMeeting({ people: ext.concat(e.people.filter(p => p.internal)).map(p => ({ name: p.name, address: p.address })), title: e.title, link: e.links[0] ? { ...(e.links[0].subject_id ? { subject_id: e.links[0].subject_id } : { contact_id: e.links[0].contact_id }), name: e.links[0].name } : null, onDone: onChange }) } }, ic('plus', 13), 'Prossimo incontro')));
}

// Attività di follow-up: un ticket per te, dopodomani, col titolo dell'incontro
async function followUp(e) {
  const title = h('input.input', { value: `Follow-up · ${e.title}`, maxlength: 200 });
  const due = h('input.input', { type: 'date', value: addDays(today(), 2) });
  const m = dlg({ title: 'Attività di follow-up', body: h('div.kc-form', h('label.fm-fld', h('span', 'Cosa'), title), h('label.fm-fld', h('span', 'Entro'), due)),
    actions: [{ label: 'Annulla' }, { label: 'Crea', primary: true, onClick: async () => {
      await post('/api/tickets', { title: title.value.trim(), due_date: due.value, assignee_ids: [store.me.id], description: `Dopo l'incontro «${e.title}» del ${fmtDate(e.start.slice(0, 10))}.` });
      toast('Attività creata: la trovi nei tuoi ticket');
    } }] });
}

// cerca un'azienda o un contatto del CRM
function pickCrm(onPick) {
  const q = h('input.input', { type: 'search', placeholder: 'Cerca un\'azienda o un contatto', autofocus: true });
  const list = h('div.pm-pick');
  q.addEventListener('input', debounce(async () => {
    if (q.value.trim().length < 2) return fill(list);
    const r = await get(`/api/crm/calendario/cerca?q=${encodeURIComponent(q.value.trim())}`, { quiet: true });
    fill(list, r.items.length ? r.items.map(i => h('button.pm-pick-i', { type: 'button', on: { click: () => { m.close(); onPick(i); } } }, h('b', i.name), h('small', i.kind))) : emptyState('search', 'Niente nel CRM con questo nome.'));
  }, 200));
  const m = cvModal({ title: 'Collega a…', body: h('div.pm-treebox', q, list) });
  setTimeout(() => q.focus(), 50);
}

// chip di persone (colleghi e contatti del CRM, o un indirizzo)
function peopleInput(list) {
  const box = h('div.pm-rcpt-row.kc-people-in');
  const sugg = h('div.pm-sugg', { hidden: true });
  const field = h('input.pm-rcpt-i', { placeholder: 'cerca nel CRM o tra i colleghi, o scrivi un\'email', 'aria-label': 'Con chi' });
  const add = p => {
    const address = String(p.address || '').trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) { toast('Indirizzo email non valido', 'err'); return; }
    if (!list.some(x => x.address === address)) list.push({ name: p.name || '', address });
    field.value = ''; sugg.hidden = true; draw(); field.focus();
  };
  const draw = () => fill(box, list.map(p => h('span.pm-rcpt', { title: p.address }, p.name || p.address, h('button', { type: 'button', 'aria-label': `Togli ${p.name || p.address}`, on: { click: () => { list.splice(list.indexOf(p), 1); draw(); } } }, '×'))), h('span.pm-rcpt-w', field, sugg));
  field.addEventListener('input', debounce(async () => {
    const q = field.value.trim();
    if (q.length < 2) { sugg.hidden = true; return; }
    const r = await get(`/api/crm/posta/destinatari?q=${encodeURIComponent(q)}`, { quiet: true }).catch(() => ({ people: [] }));
    const opts = r.people.filter(p => !list.some(x => x.address === p.address));
    sugg.hidden = !opts.length;
    fill(sugg, opts.map(p => h('button', { type: 'button', on: { mousedown: ev => { ev.preventDefault(); add(p); } } }, h('b', p.name || p.address), h('small', [p.address, p.kind === 'collega' ? 'collega' : p.company || 'contatto del CRM'].filter(Boolean).join(' · ')))));
  }, 200));
  field.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ',') && field.value.includes('@')) { ev.preventDefault(); add({ address: field.value.replace(/,/g, '') }); } });
  field.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 150));
  draw();
  return box;
}

// ── Nuovo incontro ──────────────────────────────────────────────────────────────────────────────
export function newMeeting({ start, end, people = [], title = '', link = null, onDone } = {}) {
  const s0 = start || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
  const mins0 = end ? Math.max(15, Math.round((end - s0) / 60000)) : 60;
  const con = people.slice();
  const titleIn = h('input.input', { value: title ? `Prossimo · ${title}` : '', placeholder: 'Titolo', maxlength: 255, 'aria-label': 'Titolo' });
  const dayIn = h('input.input', { type: 'date', value: toISODate(s0), 'aria-label': 'Giorno' });
  const timeIn = h('input.input', { type: 'time', value: `${pad(s0.getHours())}:${pad(s0.getMinutes())}`, step: 900, 'aria-label': 'Ora' });
  const durIn = h('select.input', { 'aria-label': 'Durata' }, [[30, '30 minuti'], [60, '1 ora'], [90, '1 ora e mezza'], [120, '2 ore'], [180, '3 ore'], [240, 'mezza giornata']].map(([v, l]) => h('option', { value: v, selected: v === mins0 }, l)));
  const teams = h('input', { type: 'checkbox', role: 'switch', checked: true });
  const where = h('input.input', { placeholder: 'oppure il luogo', 'aria-label': 'Luogo' });
  const remind = h('select.input', { 'aria-label': 'Promemoria' }, [[15, '15 minuti prima'], [30, '30 minuti prima'], [60, '1 ora prima'], [1440, '1 giorno prima'], [0, 'nessuno']].map(([v, l]) => h('option', { value: v }, l)));
  const text = h('textarea.pm-draft-t', { rows: 4, placeholder: 'Testo dell\'invito (facoltativo): sotto va la firma Almacis' });
  let target = link;
  const linkBox = h('div.kc-row');
  const drawLink = () => fill(linkBox, target ? h('span.pm-rcpt', target.name, h('button', { type: 'button', 'aria-label': 'Togli', on: { click: () => { target = null; drawLink(); } } }, '×')) : null,
    h('button.cv-lnk', { type: 'button', on: { click: () => pickCrm(i => { target = { ...(i.subject_id ? { subject_id: i.subject_id } : { contact_id: i.contact_id }), name: i.name }; drawLink(); }) } }, target ? 'cambia' : '+ azienda o contatto'));
  drawLink();
  const slotsBox = h('div.kc-row');
  const findSlots = async () => {
    fill(slotsBox, loading());
    const r = await post('/api/crm/calendario/orari', { emails: con.map(p => p.address), minuti: Number(durIn.value), da: today() });
    fill(slotsBox, r.slots.length ? r.slots.map(s => h('button.cv-pill.line', { type: 'button', on: { click: () => { dayIn.value = s.start.slice(0, 10); timeIn.value = s.start.slice(11, 16); } } },
      `${new Date(`${s.start.slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })} ${s.start.slice(11, 16)}`)) : h('small.cv-muted', 'Nessun orario libero per tutti nei prossimi 10 giorni lavorativi.'),
    h('small.cv-muted', r.people > 1 ? `liberi tu e ${r.people - 1} ${r.people === 2 ? 'collega' : 'colleghi'}` : 'libero tu (degli esterni non si vede il calendario)'));
  };
  const almaBtn = h('button.btn.btn-sm.pm-aib', { type: 'button', on: { click: async () => {
    if (!titleIn.value.trim()) return titleIn.focus();
    almaBtn.disabled = true;
    try {
      const r = await post('/api/crm/calendario/invito', { titolo: titleIn.value.trim(), con, quando: `${dayIn.value} ${timeIn.value}`, collega: target?.name || '' });
      text.value = r.testo;
      if (r.ai) toast(`Invito scritto da Alma · ${cents(r.eur) || 'meno di 0,01 cent'}`);
    } catch (err) { toast(err?.message || 'Non riuscito', 'err'); }
    almaBtn.disabled = false;
  } } }, ic('sparkles', 14), 'Scrivi l\'invito con Alma', h('small.pm-est', '≈ 0,03 cent'));
  const m = dlg({
    title: 'Nuovo incontro', wide: true,
    body: h('div.kc-form',
      titleIn,
      h('label.fm-fld', h('span', 'Con chi'), peopleInput(con)),
      h('div.kc-when', h('label.fm-fld', h('span', 'Giorno'), dayIn), h('label.fm-fld', h('span', 'Ora'), timeIn), h('label.fm-fld', h('span', 'Durata'), durIn)),
      h('div.kc-row', h('button.btn.btn-sm', { type: 'button', on: { click: findSlots } }, ic('calendar', 14), 'Trova un orario libero per tutti'), slotsBox),
      h('div.kc-row', h('label.cv-tg', teams, h('span.cv-tg-ui', { 'aria-hidden': 'true' }), h('span', 'Riunione Teams')), where),
      h('label.fm-fld', h('span', 'Collega a'), linkBox),
      text,
      h('div.kc-row', almaBtn, h('span.pm-sep'), h('label.fm-fld.kc-inline', h('span', 'Promemoria'), remind))),
    actions: [{ label: 'Annulla' }, { label: 'Invia l\'invito', primary: true, onClick: async () => {
      if (!titleIn.value.trim()) { toast('Serve il titolo', 'err'); titleIn.focus(); return false; }
      const s = new Date(`${dayIn.value}T${timeIn.value}:00`);
      const e = new Date(s.getTime() + Number(durIn.value) * 60000);
      const r = await post('/api/crm/calendario/nuovo', { titolo: titleIn.value.trim(), inizio: localIso(s), fine: localIso(e), con, teams: teams.checked, luogo: where.value.trim(), testo: text.value, promemoria: Number(remind.value), ...(target ? { subject_id: target.subject_id, contact_id: target.contact_id } : {}) });
      toast(con.length ? `Invito mandato a ${con.length === 1 ? (con[0].name || con[0].address) : `${con.length} persone`}` : 'Incontro nel tuo calendario');
      onDone?.(r);
    } }],
  });
  setTimeout(() => (titleIn.value ? dayIn : titleIn).focus(), 50);
  return m;
}

// Email nuova (riepilogo): A, oggetto, testo, firma
function sendDialog({ title, to, subject, text, cost, send }) {
  const list = to.slice();
  const subj = h('input.input', { value: subject, 'aria-label': 'Oggetto' });
  const body = h('textarea.pm-draft-t', { rows: 10, 'aria-label': 'Testo' });
  body.value = text;
  const m = dlg({ title, wide: true,
    body: h('div.kc-form', h('label.fm-fld', h('span', 'A'), peopleInput(list)), h('label.fm-fld', h('span', 'Oggetto'), subj), body,
      h('small.cv-muted', `+ firma Almacis${cost ? ` · scritto da Alma, costato ${cost}` : ''}`)),
    actions: [{ label: 'Annulla' }, { label: 'Invia', primary: true, onClick: async () => {
      const r = await send({ a: list, oggetto: subj.value.trim(), testo: body.value });
      toast(`Riepilogo inviato a ${r.to.length} ${r.to.length === 1 ? 'persona' : 'persone'}`);
    } }] });
  return m;
}
