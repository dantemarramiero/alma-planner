// Incontri del calendario Outlook nei progetti (come le email): si sceglie un incontro dal proprio calendario
// (Graph, permesso Calendars.ReadWrite che il calendario usa già) e se ne copiano titolo, orari, luogo, organizzatore,
// partecipanti e descrizione, così ogni membro del progetto lo vede. Lo collega chi vede il progetto; lo toglie chi
// l'ha collegato, il responsabile del progetto o un amministratore. Le note e i file dell'incontro sono note del
// progetto (routes/notes.js, meeting_id): restano nel tab Note anche se l'incontro viene tolto.
const { HttpError, v } = require('../lib/http');
const { graph, graphAll, TIMEZONE } = require('../lib/graph');
const { NOTE_SELECT, ORDER } = require('./notes');

const MAX_LINK = 20;            // incontri per richiesta
const MAX_RANGE_DAYS = 120;     // finestra del calendario in cui scegliere
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const EVENT_SELECT = 'id,subject,start,end,isAllDay,location,organizer,attendees,webLink,onlineMeeting,iCalUId,isCancelled,categories,bodyPreview';
const tz = { Prefer: `outlook.timezone="${TIMEZONE}"` };

const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
const local = s => String(s || '').slice(0, 19); // «2026-10-26T09:30:00.0000000» → ora italiana senza frazioni
// Gli eventi creati da Alma per i ticket sono già ticket: non si collegano come incontri.
const isAlma = e => (e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner');
const ts = col => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const MEETING_COLS = `m.id, m.project_id, m.ical_uid, m.subject, ${ts('m.start_at')} AS start_at, ${ts('m.end_at')} AS end_at, m.all_day,
  m.location, m.organizer_name, m.organizer_address, m.attendees, m.online_url, m.linked_by, m.linked_at`;

function readWhen(value, field) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) throw new HttpError(400, `Data «${field}» non valida`);
  return value.length === 10 ? `${value}T00:00:00` : value.slice(0, 19);
}

// Graph risponde 403 se manca il consenso al calendario: lo si dice chiaro.
async function calGraph(token, method, path, opts) {
  try {
    return await graph(token, method, path, opts);
  } catch (err) {
    if (err.status === 403) throw new HttpError(403, 'Per leggere il calendario serve il permesso di Microsoft sul calendario: chiedi all\'amministratore di approvarlo', 'calendar_read');
    throw err;
  }
}

function registerProjectMeetings(app, { db, auth, access }) {
  async function getMeeting(req, id) {
    const { rows } = await db.query(`SELECT ${MEETING_COLS}, m.body_text, m.web_link FROM project_meetings m WHERE m.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Incontro non trovato');
    await access.assertProject(req, rows[0].project_id); // 404 se il progetto non è visibile
    return rows[0];
  }

  // ── il proprio calendario, per scegliere gli incontri da collegare ─────────
  app.get('/api/meetings/calendar', async (req, res) => {
    const start = readWhen(req.query.start, 'inizio');
    const end = readWhen(req.query.end, 'fine');
    if (end <= start) throw new HttpError(400, 'La fine è prima dell\'inizio');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > MAX_RANGE_DAYS) throw new HttpError(400, `Al massimo ${MAX_RANGE_DAYS} giorni alla volta`);
    const q = (v.text(req.query.q, 'ricerca', { max: 200 }) || '').toLowerCase();
    const projectId = v.int(req.query.project, 'progetto', { min: 1 });
    if (projectId) await access.assertProject(req, projectId);
    const token = await auth.graphToken(req.user.id);
    let list;
    try {
      list = await graphAll(token,
        `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
        `&$select=${EVENT_SELECT}&$top=200&$orderby=start/dateTime`, { max: 1000, headers: tz });
    } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per leggere il calendario serve il permesso di Microsoft sul calendario: chiedi all\'amministratore di approvarlo', 'calendar_read');
      throw err;
    }
    const events = list.filter(e => !isAlma(e) && !e.isCancelled)
      .filter(e => !q || `${e.subject} ${e.location?.displayName || ''} ${e.organizer?.emailAddress?.name || ''}`.toLowerCase().includes(q));

    let linked = new Set();
    if (projectId && events.length) {
      const { rows } = await db.query(
        `SELECT ical_uid || '|' || ${ts('start_at')} AS k FROM project_meetings WHERE project_id = $1 AND ical_uid = ANY($2::text[])`,
        [projectId, [...new Set(events.map(e => e.iCalUId).filter(Boolean))]]);
      linked = new Set(rows.map(r => r.k));
    }
    res.json(events.map(e => ({
      id: e.id,
      subject: e.subject || '(senza titolo)',
      start: local(e.start?.dateTime),
      end: local(e.end?.dateTime),
      all_day: Boolean(e.isAllDay),
      location: e.location?.displayName || '',
      organizer: person(e.organizer),
      attendee_count: (e.attendees || []).length,
      online: Boolean(e.onlineMeeting?.joinUrl),
      linked: linked.has(`${e.iCalUId}|${local(e.start?.dateTime)}`),
    })));
  });

  // ── incontri del progetto ──────────────────────────────────────────────────
  app.get('/api/projects/:id/meetings', async (req, res) => {
    const id = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, id);
    const { rows } = await db.query(
      `SELECT ${MEETING_COLS},
              (SELECT COUNT(*)::int FROM notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL) AS note_count,
              (SELECT COUNT(*)::int FROM note_files f JOIN notes n ON n.id = f.note_id WHERE n.meeting_id = m.id AND n.deleted_at IS NULL) AS file_count
         FROM project_meetings m WHERE m.project_id = $1 ORDER BY m.start_at DESC, m.id DESC`, [id]);
    res.json(rows);
  });

  app.post('/api/projects/:id/meetings', async (req, res) => {
    const projectId = v.int(req.params.id, 'progetto', { min: 1 });
    await access.assertProject(req, projectId);
    const ids = req.body?.event_ids;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Scegli almeno un incontro');
    if (ids.length > MAX_LINK) throw new HttpError(400, `Al massimo ${MAX_LINK} incontri alla volta`);
    const eventIds = [...new Set(ids.map(x => v.text(x, 'incontro', { max: 500, required: true })))];
    const token = await auth.graphToken(req.user.id);

    let added = 0, already = 0;
    const meetingIds = [];
    for (const eid of eventIds) {
      const e = await calGraph(token, 'GET', `/me/events/${encodeURIComponent(eid)}?$select=${EVENT_SELECT},body`,
        { headers: { ...tz, Prefer: `${tz.Prefer}, outlook.body-content-type="text"` } });
      if (isAlma(e)) throw new HttpError(400, `«${e.subject}» è già un ticket di Alma Planet`);
      const uid = e.iCalUId || `outlook:${eid}`;
      const { rows } = await db.query(
        `INSERT INTO project_meetings (project_id, ical_uid, subject, start_at, end_at, all_day, location, organizer_name, organizer_address,
                                       attendees, online_url, body_text, linked_by, outlook_id, web_link)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (project_id, ical_uid, start_at) DO NOTHING RETURNING id`,
        [projectId, uid, (e.subject || '(senza titolo)').slice(0, 1000), local(e.start?.dateTime), local(e.end?.dateTime) || null, Boolean(e.isAllDay),
          (e.location?.displayName || '').slice(0, 500) || null, person(e.organizer).name || null, person(e.organizer).address || null,
          JSON.stringify((e.attendees || []).map(person)), e.onlineMeeting?.joinUrl || null, (e.body?.content || '').trim().slice(0, 100000),
          req.user.id, eid, e.webLink || null]);
      if (rows[0]) { added++; meetingIds.push(rows[0].id); continue; }
      already++; // collegato prima da un collega (o da me)
      const { rows: [old] } = await db.query('SELECT id FROM project_meetings WHERE project_id = $1 AND ical_uid = $2 AND start_at = $3', [projectId, uid, local(e.start?.dateTime)]);
      if (old) meetingIds.push(old.id);
    }
    res.status(201).json({ added, already, ids: meetingIds });
  });

  // Un incontro con le sue note (e i loro file).
  app.get('/api/meetings/:id', async (req, res) => {
    const m = await getMeeting(req, v.int(req.params.id, 'incontro', { min: 1 }));
    const { rows: notes } = await db.query(`${NOTE_SELECT} WHERE n.deleted_at IS NULL AND n.meeting_id = $1 ${ORDER}`, [m.id]);
    const { web_link, ...rest } = m;
    // «Apri in Outlook» funziona solo nel calendario di chi l'ha collegato
    res.json({ ...rest, web_link: m.linked_by === req.user.id ? web_link : null, notes });
  });

  app.delete('/api/meetings/:id', async (req, res) => {
    const m = await getMeeting(req, v.int(req.params.id, 'incontro', { min: 1 }));
    if (m.linked_by !== req.user.id) {
      const role = await access.projectRole(req, m.project_id);
      if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Può toglierlo chi l\'ha collegato, il responsabile del progetto o un amministratore');
    }
    await db.query('DELETE FROM project_meetings WHERE id = $1', [m.id]); // le note restano nel progetto (meeting_id → NULL)
    res.json({ ok: true });
  });
}

module.exports = { registerProjectMeetings };
