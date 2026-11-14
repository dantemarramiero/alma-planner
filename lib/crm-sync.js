// CRM: incontri di Outlook collegati da soli e avviso «incontro senza note» (decisioni di Dante del 13/11/2026).
// - Ogni 15 minuti si leggono i calendari di chi ha fatto accesso con Microsoft (30 giorni indietro, 60 avanti).
//   Se tra gli invitati c'è un'email di un contatto del CRM, l'incontro si collega a quel contatto (e quindi ricade
//   sulle aziende dove lavora). Se c'è un indirizzo del dominio di un'azienda che nel CRM non è ancora un contatto,
//   l'incontro si collega all'azienda e l'indirizzo viene proposto come contatto da creare.
//   I collegamenti tolti a mano (removed) non tornano. Degli incontri automatici non si copia il testo dell'invito.
// - Ogni 5 minuti: un incontro collegato, finito e senza note manda subito l'avviso (campanella e telefono) a chi
//   c'era di Almacis, o a chi l'ha collegato. Uno solo per incontro.
const { graphAll, TIMEZONE } = require('./graph');

const EVENT_SELECT = 'id,subject,start,end,isAllDay,location,organizer,attendees,webLink,onlineMeeting,iCalUId,isCancelled,categories';
const BACK_DAYS = 30, AHEAD_DAYS = 60;
// domini di posta generici: non dicono a quale azienda appartiene un indirizzo
const GENERIC = new Set(['gmail.com', 'googlemail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it',
  'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'fastwebnet.it', 'email.it', 'aruba.it',
  'pec.it', 'legalmail.it', 'pec.aruba.it', 'arubapec.it', 'postecert.it', 'pecimprese.it', 'cert.legalmail.it', 'gigapec.it', 'mypec.eu']);
const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
const local = s => String(s || '').slice(0, 19);
const isAlma = e => (e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner');
const domainOf = a => String(a || '').toLowerCase().split('@')[1] || '';
const hostOf = url => { try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const romeIso = d => d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);

function createCrmSync({ db, auth, notifier, push, fetchEvents, log = console }) {
  // eventi del calendario di una persona tra start e end (ora italiana); nei test si passa fetchEvents finto
  const readEvents = fetchEvents || (async (userId, start, end) => {
    const token = await auth.graphToken(userId);
    return graphAll(token, `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=${EVENT_SELECT}&$top=200`,
      { max: 2000, headers: { Prefer: `outlook.timezone="${TIMEZONE}"` } });
  });

  // copia (o ritrova) un incontro; restituisce l'id
  async function upsertMeeting(e, { userId = null, withBody = false, eventId = null } = {}) {
    const uid = e.iCalUId || `outlook:${eventId || e.id}`;
    const attendees = JSON.stringify((e.attendees || []).map(person));
    const { rows: [m] } = await db.query(
      `INSERT INTO crm_meetings (ical_uid, start_at, end_at, all_day, subject, location, organizer_name, organizer_address, attendees, online_url, body_text, linked_by, outlook_id, web_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (ical_uid, start_at) DO UPDATE SET end_at = EXCLUDED.end_at, subject = EXCLUDED.subject, location = EXCLUDED.location, attendees = EXCLUDED.attendees,
         body_text = CASE WHEN EXCLUDED.body_text <> '' THEN EXCLUDED.body_text ELSE crm_meetings.body_text END,
         linked_by = COALESCE(crm_meetings.linked_by, EXCLUDED.linked_by),
         outlook_id = COALESCE(crm_meetings.outlook_id, EXCLUDED.outlook_id), web_link = COALESCE(crm_meetings.web_link, EXCLUDED.web_link)
       RETURNING id`,
      [uid, local(e.start?.dateTime), local(e.end?.dateTime) || null, Boolean(e.isAllDay), (e.subject || '(senza titolo)').slice(0, 1000),
        (e.location?.displayName || '').slice(0, 500) || null, person(e.organizer).name || null, person(e.organizer).address || null, attendees,
        e.onlineMeeting?.joinUrl || null, withBody ? (e.body?.content || '').trim().slice(0, 100000) : '', userId, eventId || e.id || null, e.webLink || null]);
    return m.id;
  }

  // indirizzi conosciuti: email dei contatti → contatto; domini delle aziende → aziende; domini interni (colleghi)
  async function directory() {
    const [{ rows: contacts }, { rows: subjects }, { rows: users }] = await Promise.all([
      db.query("SELECT id, lower(email) AS email FROM crm_contacts WHERE email <> ''"),
      db.query(`SELECT s.id, s.email, s.website, ARRAY(SELECT lower(c.email) FROM crm_contact_links cl JOIN crm_contacts c ON c.id = cl.contact_id
                  WHERE cl.subject_id = s.id AND c.email <> '') AS contact_emails FROM crm_subjects s WHERE s.merged_into IS NULL`),
      db.query('SELECT lower(email) AS email FROM users'),
    ]);
    const internal = new Set(users.map(u => domainOf(u.email)).filter(Boolean));
    const byEmail = new Map(contacts.map(c => [c.email, c.id]));
    const byDomain = new Map(); // dominio → [aziende]
    for (const s of subjects) {
      const domains = new Set([domainOf(s.email), hostOf(s.website), ...s.contact_emails.map(domainOf)]);
      for (const d of domains) {
        if (!d || GENERIC.has(d) || internal.has(d)) continue;
        if (!byDomain.has(d)) byDomain.set(d, new Set());
        byDomain.get(d).add(s.id);
      }
    }
    return { byEmail, byDomain, internal };
  }

  async function linkAuto(meetingId, col, id) {
    await db.query(`INSERT INTO crm_meeting_links (meeting_id, ${col}, auto) VALUES ($1, $2, true) ON CONFLICT (meeting_id, ${col}) WHERE ${col} IS NOT NULL DO NOTHING`, [meetingId, id]);
  }

  // un calendario: restituisce quanti incontri ha collegato
  async function syncUser(userId, now = new Date()) {
    const start = romeIso(new Date(now.getTime() - BACK_DAYS * 86400000));
    const end = romeIso(new Date(now.getTime() + AHEAD_DAYS * 86400000));
    const events = (await readEvents(userId, start, end)).filter(e => !isAlma(e) && !e.isCancelled);
    if (!events.length) return 0;
    const dir = await directory();
    let linked = 0;
    for (const e of events) {
      const people = [person(e.organizer), ...(e.attendees || []).map(person)].filter(p => p.address && !dir.internal.has(domainOf(p.address)));
      const contacts = new Set(), subjects = new Map(); // azienda → indirizzi sconosciuti
      for (const p of people) {
        const cid = dir.byEmail.get(p.address);
        if (cid) { contacts.add(cid); continue; }
        for (const sid of dir.byDomain.get(domainOf(p.address)) || []) {
          if (!subjects.has(sid)) subjects.set(sid, []);
          subjects.get(sid).push(p);
        }
      }
      if (!contacts.size && !subjects.size) continue;
      const meetingId = await upsertMeeting(e, { eventId: e.id });
      for (const cid of contacts) await linkAuto(meetingId, 'contact_id', cid);
      for (const [sid, unknown] of subjects) {
        await linkAuto(meetingId, 'subject_id', sid);
        for (const p of unknown) {
          await db.query(`INSERT INTO crm_contact_proposals (subject_id, email, name, meeting_id) VALUES ($1, $2, $3, $4) ON CONFLICT (subject_id, email) DO NOTHING`,
            [sid, p.address, p.name.slice(0, 200), meetingId]);
        }
      }
      linked++;
    }
    return linked;
  }

  async function syncAll() {
    const { rows } = await db.query('SELECT id FROM users WHERE token_cache IS NOT NULL');
    for (const u of rows) {
      let status = 'ok';
      try { await syncUser(u.id); } catch (err) { status = err.code === 'reauth' ? 'no_token' : 'failed'; if (status === 'failed') log.warn?.('[crm] calendario non letto', u.id, err.message); }
      await db.query(`INSERT INTO crm_calendar_sync (user_id, synced_at, status) VALUES ($1, now(), $2)
                      ON CONFLICT (user_id) DO UPDATE SET synced_at = now(), status = EXCLUDED.status`, [u.id, status]);
    }
  }

  // incontri finiti senza note: avviso subito, una volta sola (negli ultimi 14 giorni, per non svegliare il passato)
  async function alertTick(now = new Date()) {
    const nowIso = romeIso(now);
    const since = romeIso(new Date(now.getTime() - 14 * 86400000));
    const { rows } = await db.query(
      `SELECT m.id, m.subject, m.attendees, m.organizer_address, m.linked_by,
              (SELECT string_agg(DISTINCT COALESCE(s.name, trim(concat_ws(' ', c.first_name, c.last_name))), ', ')
                 FROM crm_meeting_links L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                WHERE L.meeting_id = m.id AND NOT L.removed) AS who
         FROM crm_meetings m
        WHERE m.end_at <= $1::timestamp AND m.end_at >= $2::timestamp
          AND EXISTS (SELECT 1 FROM crm_meeting_links L WHERE L.meeting_id = m.id AND NOT L.removed)
          AND NOT EXISTS (SELECT 1 FROM crm_notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM crm_meeting_alerts a WHERE a.meeting_id = m.id)`, [nowIso, since]);
    let sent = 0;
    for (const m of rows) {
      const addrs = [m.organizer_address, ...(m.attendees || []).map(a => a.address)].filter(Boolean).map(a => a.toLowerCase());
      const { rows: us } = await db.query('SELECT id FROM users WHERE lower(email) = ANY($1::text[])', [addrs]);
      const ids = us.length ? us.map(u => u.id) : (m.linked_by ? [m.linked_by] : []);
      await db.query('INSERT INTO crm_meeting_alerts (meeting_id) VALUES ($1) ON CONFLICT DO NOTHING', [m.id]);
      if (!ids.length) continue;
      const body = `Mancano le note dell'incontro «${m.subject}»${m.who ? ` con ${m.who}` : ''}: scrivi com'è andato.`;
      await notifier.notify({ userIds: ids, actorId: null, kind: 'crm', body, link: `/crm/incontro/${m.id}` });
      try { await push?.send(ids, { title: 'Note dell\'incontro', body, url: `/app#/crm/incontro/${m.id}`, tag: `crm-meeting-${m.id}` }); } catch { /* il telefono non è obbligatorio */ }
      sent++;
    }
    return sent;
  }


  // prossimi passi scaduti: avviso a chi li deve fare, una volta sola (si riazzera se la data si sposta)
  async function stepTick(now = new Date()) {
    const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const { rows } = await db.query(
      `SELECT st.id, st.title, st.owner_id, st.subject_id, s.name FROM crm_steps st JOIN crm_subjects s ON s.id = st.subject_id
        WHERE st.done_at IS NULL AND st.alerted_at IS NULL AND st.owner_id IS NOT NULL AND st.due_date < $1::date LIMIT 500`, [today]);
    for (const st of rows) {
      await db.query('UPDATE crm_steps SET alerted_at = now() WHERE id = $1', [st.id]);
      const body = `Prossimo passo scaduto: «${st.title}» con ${st.name}.`;
      await notifier.notify({ userIds: [st.owner_id], actorId: null, kind: 'crm', body, link: `/crm/scheda/${st.subject_id}` });
      try { await push?.send([st.owner_id], { title: 'Prossimo passo scaduto', body, url: `/app#/crm/scheda/${st.subject_id}`, tag: `crm-step-${st.id}` }); } catch { /* il telefono non è obbligatorio */ }
    }
    return rows.length;
  }

  let timers = [];
  function start() {
    const safe = fn => () => fn().catch(err => log.warn?.('[crm]', err.message));
    timers = [setInterval(safe(syncAll), 15 * 60000), setInterval(safe(() => alertTick()), 5 * 60000), setInterval(safe(() => stepTick()), 5 * 60000)];
    timers.forEach(t => t.unref?.());
    setTimeout(safe(syncAll), 60000).unref?.();
  }

  return { upsertMeeting, syncUser, syncAll, alertTick, stepTick, start };
}

module.exports = { createCrmSync, GENERIC };
