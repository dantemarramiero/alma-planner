// Calendario: eventi Outlook dell'utente + scadenze dei ticket, nello stesso intervallo.
const { HttpError, v } = require('../lib/http');
const { graph, graphAll, TIMEZONE } = require('../lib/graph');

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/;

function readWhen(value, field) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) throw new HttpError(400, `Data «${field}» non valida`);
  return value.slice(0, 19).length === 10 ? `${value}T00:00:00` : value.slice(0, 19);
}

function mapEvent(e) {
  return {
    id: e.id,
    title: e.subject || '(senza titolo)',
    start: e.start?.dateTime,
    end: e.end?.dateTime,
    allDay: e.isAllDay,
    location: e.location?.displayName || '',
    organizer: e.organizer?.emailAddress?.name || '',
    webLink: e.webLink,
    showAs: e.showAs,
    isOrganizer: e.isOrganizer,
    onlineUrl: e.onlineMeeting?.joinUrl || null,
  };
}

function registerCalendar(app, { db, auth, access }) {
  app.get('/api/calendar', async (req, res) => {
    const start = readWhen(req.query.start, 'inizio');
    const end = readWhen(req.query.end, 'fine');
    const scope = req.query.tickets === 'all' ? 'all' : 'mine';

    const ticketsQuery = db.query(
      `SELECT t.id, t.title, t.status, t.start_date, t.due_date, p.name AS project_name, p.color AS project_color
         FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
        WHERE COALESCE(t.due_date, t.start_date) >= $1::date AND COALESCE(t.start_date, t.due_date) <= $2::date
          AND (t.rda_state IS NULL OR t.rda_state = 'accepted')
          AND ${scope === 'mine' ? 'EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = $3)' : access.ticketFilter(req, 't', '$3')}`,
      // il filtro di un amministratore è TRUE e non usa $3: in quel caso il parametro non si passa
      scope === 'all' && access.isAdmin(req) ? [start.slice(0, 10), end.slice(0, 10)] : [start.slice(0, 10), end.slice(0, 10), req.user.id]);

    let events = [], outlookError = null;
    if (auth.msConfigured) {
      try {
        const token = await auth.graphToken(req.user.id);
        const list = await graphAll(token,
          `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
          '&$select=id,subject,start,end,isAllDay,location,organizer,webLink,showAs,isOrganizer,onlineMeeting,categories&$top=200&$orderby=start/dateTime',
          { max: 1000, headers: { Prefer: `outlook.timezone="${TIMEZONE}"` } });
        // Gli eventi creati da Alma per i ticket li mostriamo già come ticket.
        events = list.filter(e => !(e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner') /* 'Alma Planner': eventi creati prima del cambio di nome */).map(mapEvent);
      } catch (err) {
        if (err.code === 'reauth') throw err;
        outlookError = err.message;
      }
    } else {
      outlookError = 'non ancora collegato (manca la registrazione dell\'app Microsoft)';
    }
    res.json({ events, tickets: (await ticketsQuery).rows, outlookError });
  });

  function readEvent(b) {
    const subject = v.text(b.title, 'titolo', { max: 255, required: true });
    const isAllDay = Boolean(b.allDay);
    const start = readWhen(b.start, 'inizio');
    const end = readWhen(b.end, 'fine');
    if (end <= start) throw new HttpError(400, 'La fine è prima dell\'inizio');
    const out = {
      subject,
      isAllDay,
      start: { dateTime: start, timeZone: TIMEZONE },
      end: { dateTime: end, timeZone: TIMEZONE },
    };
    if (b.location !== undefined) out.location = { displayName: v.text(b.location, 'luogo', { max: 255 }) || '' };
    if (b.body !== undefined) out.body = { contentType: 'text', content: v.text(b.body, 'note', { max: 10000 }) || '' };
    if (Array.isArray(b.attendees)) {
      out.attendees = b.attendees.slice(0, 50).map(a => ({ type: 'required', emailAddress: { address: v.text(a, 'invitato', { max: 300, required: true }) } }));
    }
    if (b.online) { out.isOnlineMeeting = true; out.onlineMeetingProvider = 'teamsForBusiness'; }
    return out;
  }

  app.post('/api/calendar/events', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    const event = await graph(token, 'POST', '/me/events', { body: readEvent(req.body || {}), headers: { Prefer: `outlook.timezone="${TIMEZONE}"` } });
    res.status(201).json(mapEvent(event));
  });

  // Spostamento/ridimensionamento dal calendario: cambia solo orari (e titolo se passato).
  app.patch('/api/calendar/events/:id', async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.start || b.end) {
      const start = readWhen(b.start, 'inizio'), end = readWhen(b.end, 'fine');
      if (end <= start) throw new HttpError(400, 'La fine è prima dell\'inizio');
      patch.start = { dateTime: start, timeZone: TIMEZONE };
      patch.end = { dateTime: end, timeZone: TIMEZONE };
      if (b.allDay !== undefined) patch.isAllDay = Boolean(b.allDay);
    }
    if (b.title !== undefined) patch.subject = v.text(b.title, 'titolo', { max: 255, required: true });
    const token = await auth.graphToken(req.user.id);
    const event = await graph(token, 'PATCH', `/me/events/${encodeURIComponent(req.params.id)}`, { body: patch, headers: { Prefer: `outlook.timezone="${TIMEZONE}"` } });
    res.json(mapEvent(event));
  });

  app.delete('/api/calendar/events/:id', async (req, res) => {
    const token = await auth.graphToken(req.user.id);
    await graph(token, 'DELETE', `/me/events/${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  });
}

module.exports = { registerCalendar };
