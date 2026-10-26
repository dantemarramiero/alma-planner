// Calendario: eventi del calendario Outlook + ticket (dall'inizio alla scadenza), nello stesso calendario.
// Trascinare un ticket ne cambia le date; trascinare un evento Outlook di cui si è organizzatori lo sposta.
import { h, clear, modal, confirmDialog, toast, fmtDateTime, toISODate, addDays, isMobile } from './ui.js';
import { icon } from './icons.js';
import { get, post, patch, del, qs } from './api.js';
import { store } from './store.js';
import { openTicket } from './tickets.js';
import { linkEventToProject } from './project-meetings.js';

const SCOPE_KEY = 'alma.calScope';
const GANTT_KEY = 'alma.calGantt';

// params: ?new=1 apre subito «Nuovo evento» (dal tasto + del telefono).
export function calendarView(container, params = new URLSearchParams()) {
  const mobile = isMobile();
  let scope = (() => { try { return localStorage.getItem(SCOPE_KEY) || 'mine'; } catch { return 'mine'; } })();
  // attività dei Gantt = ticket che stanno in un progetto; si possono nascondere per vedere solo Outlook e i ticket sciolti
  let showGantt = (() => { try { return localStorage.getItem(GANTT_KEY) !== '0'; } catch { return true; } })();
  const ganttToggle = h('label.check.m-hide', h('input', { type: 'checkbox', checked: showGantt, on: { change: e => {
    showGantt = e.target.checked;
    try { localStorage.setItem(GANTT_KEY, showGantt ? '1' : '0'); } catch { /* niente */ }
    cal.refetchEvents();
  } } }), 'Attività dei Gantt');
  const banner = h('div.banner', { hidden: true });
  const calEl = h('div');

  const scopeSeg = h('div.seg', [['mine', 'I miei ticket'], ['all', 'Tutti i ticket']].map(([k, l]) =>
    h('button', { type: 'button', 'data-k': k, class: k === scope ? 'on' : '', on: { click: () => {
      scope = k;
      try { localStorage.setItem(SCOPE_KEY, k); } catch { /* niente */ }
      scopeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
      cal.refetchEvents();
    } } }, l)));

  clear(container).append(
    h('div.page-head',
      h('div', h('h1', 'Calendario'), h('div.sub', 'Il tuo calendario Outlook insieme ai ticket. Seleziona uno spazio vuoto per creare un evento.')),
      h('div.row', ganttToggle, scopeSeg, h('button.btn.btn-primary', { type: 'button', on: { click: () => newEvent() } }, '+ Evento'))),
    banner,
    h('div.card.cal-card', calEl));

  // eslint-disable-next-line no-undef
  const cal = new FullCalendar.Calendar(calEl, {
    locale: 'it',
    // sul telefono: elenco della settimana (agenda), frecce e «oggi»
    initialView: mobile ? 'listWeek' : 'timeGridWeek',
    headerToolbar: mobile
      ? { left: 'prev,next', center: 'title', right: 'today' }
      : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
    firstDay: 1,
    height: 'auto',
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    nowIndicator: true,
    weekNumbers: false,
    navLinks: true,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: 4,
    editable: true,
    eventStartEditable: true,
    eventDurationEditable: true,
    events: async (info, success, failure) => {
      try {
        const data = await get(`/api/calendar${qs({ start: info.startStr.slice(0, 19), end: info.endStr.slice(0, 19), tickets: scope })}`);
        banner.hidden = !data.outlookError;
        banner.textContent = data.outlookError ? `Outlook: ${data.outlookError}. Vedi solo i ticket.` : '';
        success([
          ...data.events.map(e => ({
            id: `o-${e.id}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay,
            editable: e.isOrganizer, classNames: e.showAs === 'free' ? ['ev-free'] : [],
            extendedProps: { kind: 'outlook', ev: e },
          })),
          ...data.tickets.filter(t => showGantt || !t.project_name).map(t => ({
            id: `t-${t.id}`, title: t.title, allDay: true,
            start: t.start_date || t.due_date, end: addDays(t.due_date || t.start_date, 1),
            backgroundColor: t.status === 'done' ? 'var(--green-soft)' : 'var(--ap-orange-tint)',
            borderColor: t.project_color || 'var(--ap-accent)', textColor: 'var(--ap-text-strong)',
            classNames: ['ev-ticket'],
            extendedProps: { kind: 'ticket', ticket: t },
          })),
        ]);
      } catch (err) { failure(err); }
    },
    eventClick: info => {
      info.jsEvent.preventDefault();
      const { kind, ticket, ev } = info.event.extendedProps;
      if (kind === 'ticket') openTicket(ticket.id, { onSaved: () => cal.refetchEvents() });
      else showEvent(ev);
    },
    eventDrop: info => moved(info),
    eventResize: info => moved(info),
    select: info => {
      newEvent({ start: info.start, end: info.end, allDay: info.allDay });
      cal.unselect();
    },
  });
  cal.render();

  async function moved(info) {
    const { kind, ticket, ev } = info.event.extendedProps;
    try {
      if (kind === 'ticket') {
        const s = toISODate(info.event.start);
        const e = info.event.end ? addDays(toISODate(info.event.end), -1) : s;
        if (!info.event.allDay) { info.revert(); toast('I ticket stanno nella riga «Tutto il giorno»', 'err'); return; }
        await patch(`/api/tickets/${ticket.id}`, ticket.start_date ? { start_date: s, due_date: e } : { due_date: e });
        toast('Date del ticket aggiornate');
      } else {
        const allDay = info.event.allDay;
        const fmt = d => (allDay ? `${toISODate(d)}T00:00:00` : localISO(d));
        const end = info.event.end || new Date(info.event.start.getTime() + (allDay ? 86400000 : 3600000));
        await patch(`/api/calendar/events/${encodeURIComponent(ev.id)}`, { start: fmt(info.event.start), end: fmt(end), allDay });
        toast('Evento spostato in Outlook');
      }
      cal.refetchEvents();
    } catch {
      info.revert();
    }
  }

  function showEvent(ev) {
    const m = modal({
      title: ev.title,
      body: [
        h('div', ev.allDay ? `${ev.start.slice(0, 10)} · tutto il giorno` : `${fmtDateTime(ev.start)} → ${fmtDateTime(ev.end)}`),
        ev.location ? h('div.muted.row', icon('map-pin', { size: 16 }), ev.location) : null,
        ev.organizer ? h('div.muted', `Organizzatore: ${ev.organizer}`) : null,
        ev.onlineUrl ? h('a', { href: ev.onlineUrl, target: '_blank', rel: 'noopener' }, 'Partecipa su Teams') : null,
      ],
      left: ev.isOrganizer ? [h('button.btn.btn-danger', { type: 'button', on: { click: async () => {
        if (!await confirmDialog(`Cancellare «${ev.title}» dal calendario Outlook?`, { ok: 'Cancella', danger: true })) return;
        await del(`/api/calendar/events/${encodeURIComponent(ev.id)}`);
        m.close(); toast('Evento cancellato'); cal.refetchEvents();
      } } }, 'Cancella')] : [],
      actions: [h('button.btn', { type: 'button', on: { click: () => { m.close(); linkEventToProject(ev); } } }, icon('folder', { size: 15 }), 'Collega a un progetto'),
        h('a.btn', { href: ev.webLink, target: '_blank', rel: 'noopener' }, 'Apri in Outlook ↗'),
        h('button.btn.btn-primary', { type: 'button', on: { click: () => m.close() } }, 'Chiudi')],
    });
  }

  function newEvent(range) {
    if (!store.me.microsoft) { toast('Outlook non è ancora collegato', 'err'); return; }
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const r = range || { start: now, end: new Date(now.getTime() + 3600000), allDay: false };
    const title = h('input.input', { autofocus: true, placeholder: 'Titolo' });
    const allDay = h('input', { type: 'checkbox', checked: r.allDay });
    const startI = h('input.input', { type: 'datetime-local', value: localISO(r.start).slice(0, 16) });
    const endI = h('input.input', { type: 'datetime-local', value: localISO(r.end).slice(0, 16) });
    const startD = h('input.input', { type: 'date', value: toISODate(r.start) });
    const endD = h('input.input', { type: 'date', value: r.allDay ? addDays(toISODate(r.end), -1) : toISODate(r.end) });
    const timeRow = h('div.grid-2', h('label.field', h('span', 'Inizio'), startI), h('label.field', h('span', 'Fine'), endI));
    const dayRow = h('div.grid-2', h('label.field', h('span', 'Dal'), startD), h('label.field', h('span', 'Al'), endD));
    const sync = () => { timeRow.hidden = allDay.checked; dayRow.hidden = !allDay.checked; };
    allDay.addEventListener('change', sync);
    sync();
    const place = h('input.input', { placeholder: 'Luogo (facoltativo)' });
    const attendees = h('input.input', { placeholder: 'email separate da virgola' });
    const teams = h('input', { type: 'checkbox' });
    const notes = h('textarea.input', { rows: 3 });

    const m = modal({
      title: 'Nuovo evento Outlook',
      body: [
        h('label.field', h('span', 'Titolo'), title),
        h('label.check', allDay, 'Tutto il giorno'),
        timeRow, dayRow,
        h('label.field', h('span', 'Luogo'), place),
        h('label.field', h('span', 'Invitati'), attendees),
        h('div.muted.small', 'Persone del team: ', ...store.users.slice(0, 12).map(u => h('a', { href: '#', style: { marginRight: '8px' }, on: { click: e => {
          e.preventDefault();
          const list = attendees.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!list.includes(u.email)) attendees.value = [...list, u.email].join(', ');
        } } }, u.name.split(' ')[0]))),
        h('label.check', teams, 'Riunione Teams'),
        h('label.field', h('span', 'Note'), notes),
      ],
      actions: [h('button.btn', { type: 'button', on: { click: () => m.close() } }, 'Annulla'),
        h('button.btn.btn-primary', { type: 'button', on: { click: save } }, 'Crea in Outlook')],
    });

    async function save() {
      if (!title.value.trim()) { toast('Scrivi un titolo', 'err'); return; }
      const payload = {
        title: title.value, allDay: allDay.checked,
        start: allDay.checked ? startD.value : startI.value,
        end: allDay.checked ? addDays(endD.value, 1) : endI.value,
        location: place.value, body: notes.value, online: teams.checked,
        attendees: attendees.value.split(',').map(s => s.trim()).filter(s => s.includes('@')),
      };
      await post('/api/calendar/events', payload);
      m.close();
      toast(payload.attendees.length ? 'Evento creato, inviti inviati' : 'Evento creato');
      cal.refetchEvents();
    }
  }

  if (params.get('new')) {
    history.replaceState(null, '', '#/calendar');
    newEvent();
  }

  return { destroy: () => cal.destroy() };
}

function localISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

