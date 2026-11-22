// Calendario finto per il Calendario del CRM (ALM2-65) in locale e nei test: la settimana del data center del canvas.
// Risponde come Graph a calendarView, events/{id} (lettura, PATCH, accept/tentativelyAccept/decline), POST /me/events
// e calendar/getSchedule.
const { HttpError } = require('./http');

const P = (name, address) => ({ emailAddress: { name, address } });
const ME = P('Dante Marramiero', 'direzione@almacis.it');
const MARCO = P('Marco Bianchi', 'marco.bianchi@almacis.it');
const ROSSI = P('Luca Rossi', 'l.rossi@studiotecnicorossi.it');
const SARA = P('Sara Marini', 's.marini@studiotecnicorossi.it');
const PACE = P('Andrea Pace', 'andrea.pace@studiopace-ing.com');
const BARB = P('Giulia Rossi', 'g.rossi@barberini.eu');

const romeDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = () => { const t = romeDay(); const wd = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; return addDays(t, -wd); };
const att = (p, response = 'none') => ({ type: 'required', status: { response }, emailAddress: p.emailAddress });

function base() {
  const m = monday();
  const ev = (id, day, from, to, subject, extra = {}) => ({
    id, iCalUId: `ical-${id}`, subject, isAllDay: false, isCancelled: false, categories: [],
    start: { dateTime: `${addDays(m, day)}T${from}:00.0000000`, timeZone: 'Europe/Rome' }, end: { dateTime: `${addDays(m, day)}T${to}:00.0000000`, timeZone: 'Europe/Rome' },
    location: { displayName: '' }, organizer: ME, isOrganizer: true, responseStatus: { response: 'organizer' }, attendees: [], onlineMeeting: null,
    webLink: `https://outlook.office.com/calendar/item/${id}`, body: { contentType: 'text', content: '' }, ...extra,
  });
  return [
    ev('ev-dir', 0, '09:00', '09:30', 'Riunione di direzione', { attendees: [att(MARCO, 'accepted')] }),
    ev('ev-dc-call', 1, '10:00', '11:30', 'Data center Chieti · allineamento offerta', { attendees: [att(ROSSI, 'accepted'), att(SARA), att(MARCO, 'accepted')], onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fake' } }),
    ev('ev-bess', 1, '15:30', '16:30', 'BESS · nuova proposta Almacis', { organizer: BARB, isOrganizer: false, responseStatus: { response: 'notResponded' }, attendees: [att(ME), att(BARB, 'accepted')] }),
    ev('ev-sopr', 3, '10:00', '12:00', 'Sopralluogo data center', { location: { displayName: 'Chieti Scalo, lotto 7' }, attendees: [att(ROSSI, 'accepted'), att(SARA), att(MARCO, 'tentativelyAccepted')] }),
    ev('ev-pace', 4, '14:00', '15:00', 'Capannone Val Pescara · call', { attendees: [att(PACE, 'accepted')] }),
    ev('ev-old', -5, '11:00', '12:00', 'Studio Rossi · contratti quadro', { attendees: [att(ROSSI, 'accepted')] }),
  ];
}

function createCalendarioFake() {
  const events = base();
  const created = [];
  const responses = [];
  return {
    events, created, responses,
    async graph(_t, method, path, opts = {}) {
      const p = decodeURIComponent(path);
      if (p.startsWith('/me/calendarView')) {
        const s = (p.match(/startDateTime=([^&]+)/) || [])[1] || '';
        const e = (p.match(/endDateTime=([^&]+)/) || [])[1] || '9999';
        return { value: events.filter(x => x.end.dateTime.slice(0, 19) > s.slice(0, 19) && x.start.dateTime.slice(0, 19) < e.slice(0, 19)) };
      }
      if (method === 'POST' && p === '/me/calendar/getSchedule') {
        const { schedules = [] } = opts.body || {};
        const m = monday();
        return { value: schedules.map(addr => ({ scheduleId: addr, scheduleItems: addr === MARCO.emailAddress.address
          ? [{ status: 'busy', start: { dateTime: `${addDays(m, 4)}T09:00:00.0000000` }, end: { dateTime: `${addDays(m, 4)}T12:00:00.0000000` } },
            { status: 'busy', start: { dateTime: `${addDays(m, 1)}T10:00:00.0000000` }, end: { dateTime: `${addDays(m, 1)}T11:30:00.0000000` } }] : [] })) };
      }
      if (method === 'POST' && p === '/me/events') {
        const b = opts.body;
        const e = { id: `ev-new-${created.length + 1}`, iCalUId: `ical-new-${created.length + 1}`, isAllDay: false, isCancelled: false, categories: [], organizer: ME, isOrganizer: true,
          responseStatus: { response: 'organizer' }, webLink: 'https://outlook.office.com/calendar/item/new', ...b,
          attendees: (b.attendees || []).map(a => ({ ...a, status: { response: 'none' } })),
          onlineMeeting: b.isOnlineMeeting ? { joinUrl: 'https://teams.microsoft.com/l/meetup-join/new' } : null };
        events.push(e); created.push(e);
        return e;
      }
      const m = p.match(/^\/me\/events\/([^/?]+)(\/(accept|tentativelyAccept|decline))?/);
      if (m) {
        const e = events.find(x => x.id === m[1]);
        if (!e) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
        if (method === 'POST' && m[3]) { e.responseStatus = { response: { accept: 'accepted', tentativelyAccept: 'tentativelyAccepted', decline: 'declined' }[m[3]] }; responses.push({ id: e.id, kind: m[3], comment: opts.body?.comment }); return null; }
        if (method === 'PATCH') { Object.assign(e, opts.body); return e; }
        if (method === 'GET') return e;
      }
      throw new HttpError(404, `Calendario finto: ${method} ${p}`);
    },
  };
}

module.exports = { createCalendarioFake };
