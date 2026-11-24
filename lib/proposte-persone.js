// Proposte per «Collega email» e «Collega incontro» (ALM2-84): le persone di una scheda (progetto, azienda o contatto
// del CRM) e, nella propria casella e nel proprio calendario, le email e gli incontri con loro non ancora collegati.
// Persone di un progetto = contatti CRM collegati al progetto (e quelli delle aziende collegate) + gli esterni già
// presenti nelle email e negli incontri del progetto. I colleghi (domini degli utenti di Alma Space) non contano.
const { graph, graphAll, TIMEZONE } = require('./graph');

const MAX_PEOPLE = 10;
const MEETING_BACK_DAYS = 90;
const MEETING_AHEAD_DAYS = 30;
const EVENT_SELECT = 'id,subject,start,end,isAllDay,location,organizer,attendees,onlineMeeting,iCalUId,isCancelled,categories';
const MAIL_SELECT = 'id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,hasAttachments,internetMessageId,isDraft';
const EMAIL_RE = /^[^\s"@]+@[^\s"@]+\.[^\s"@]+$/;
const tz = { Prefer: `outlook.timezone="${TIMEZONE}"` };
const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
const local = s => String(s || '').slice(0, 19);
const isAlma = e => (e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner');
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// domini interni: quelli degli utenti di Alma Space (almacis.it e simili)
async function internalDomains(db) {
  const { rows } = await db.query(`SELECT DISTINCT lower(split_part(email, '@', 2)) AS d FROM users WHERE email LIKE '%@%'`);
  return new Set(['almacis.it', ...rows.map(r => r.d).filter(Boolean)]);
}

// [{ address, name, w }] → le persone esterne più importanti, una per indirizzo
async function rank(db, rows, me) {
  const internal = await internalDomains(db);
  const mine = String(me?.email || '').toLowerCase();
  const by = new Map();
  for (const r of rows) {
    const address = String(r.address || '').trim().toLowerCase();
    if (!EMAIL_RE.test(address) || address === mine || internal.has(address.split('@')[1])) continue;
    const old = by.get(address) || { address, name: '', w: 0 };
    old.w += Number(r.w) || 1;
    if (!old.name && r.name && r.name.toLowerCase() !== address) old.name = String(r.name).trim();
    by.set(address, old);
  }
  return [...by.values()].sort((a, b) => b.w - a.w || a.address.localeCompare(b.address)).slice(0, MAX_PEOPLE)
    .map(({ address, name }) => ({ address, name }));
}

const CONTACT_NAME = `trim(concat_ws(' ', c.first_name, c.last_name))`;

async function projectPeople(db, projectId, me) {
  const { rows } = await db.query(
    `SELECT lower(c.email) AS address, ${CONTACT_NAME} AS name, 5 AS w
       FROM crm_project_links pl JOIN crm_contacts c ON c.id = pl.contact_id
      WHERE pl.project_id = $1 AND c.email <> ''
     UNION ALL
     SELECT lower(c.email), ${CONTACT_NAME}, 3
       FROM crm_project_links pl JOIN crm_contact_links cl ON cl.subject_id = pl.subject_id AND cl.date_to IS NULL
       JOIN crm_contacts c ON c.id = cl.contact_id
      WHERE pl.project_id = $1 AND c.email <> ''
     UNION ALL
     SELECT lower(from_address), from_name, 2 FROM project_emails WHERE project_id = $1 AND from_address IS NOT NULL
     UNION ALL
     SELECT lower(x->>'address'), x->>'name', 1 FROM project_emails e, jsonb_array_elements(e.to_list || e.cc_list) x WHERE e.project_id = $1
     UNION ALL
     SELECT lower(organizer_address), organizer_name, 2 FROM project_meetings WHERE project_id = $1 AND organizer_address IS NOT NULL
     UNION ALL
     SELECT lower(a->>'address'), a->>'name', 1 FROM project_meetings m, jsonb_array_elements(m.attendees) a WHERE m.project_id = $1`,
    [projectId]);
  return rank(db, rows, me);
}

// t = 'subjects' | 'contacts'
async function crmPeople(db, t, id, me) {
  const { rows } = t === 'subjects'
    ? await db.query(`SELECT lower(c.email) AS address, ${CONTACT_NAME} AS name, 1 AS w
                        FROM crm_contact_links cl JOIN crm_contacts c ON c.id = cl.contact_id
                       WHERE cl.subject_id = $1 AND cl.date_to IS NULL AND c.email <> ''`, [id])
    : await db.query(`SELECT lower(c.email) AS address, ${CONTACT_NAME} AS name, 1 AS w FROM crm_contacts c WHERE c.id = $1 AND c.email <> ''`, [id]);
  return rank(db, rows, me);
}

// Email della propria casella scambiate con queste persone (le più recenti). Ritorna i messaggi con internet_message_id.
async function mailWith(token, people) {
  if (!people.length) return [];
  const search = people.map(p => `participants:${p.address}`).join(' OR ');
  const data = await graph(token, 'GET', `/me/messages?$search="${encodeURIComponent(search)}"&$select=${MAIL_SELECT}&$top=30`);
  return (data.value || []).filter(m => !m.isDraft).map(m => ({
    id: m.id, internet_message_id: m.internetMessageId || `outlook:${m.id}`,
    subject: m.subject || '(senza oggetto)', from: person(m.from), to: (m.toRecipients || []).map(person),
    date: m.receivedDateTime || m.sentDateTime, preview: (m.bodyPreview || '').slice(0, 240), has_attachments: Boolean(m.hasAttachments),
    with: people.filter(p => p.address === person(m.from).address || (m.toRecipients || []).some(r => person(r).address === p.address)).map(p => p.name || p.address),
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Incontri del proprio calendario (ultimi 90 giorni e prossimi 30) a cui partecipa almeno una di queste persone.
async function meetingsWith(token, people, now = new Date()) {
  if (!people.length) return [];
  const start = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - MEETING_BACK_DAYS));
  const end = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MEETING_AHEAD_DAYS + 1));
  const list = await graphAll(token,
    `/me/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$select=${EVENT_SELECT}&$top=200&$orderby=start/dateTime`,
    { max: 1500, headers: tz });
  return list.filter(e => !isAlma(e) && !e.isCancelled).map(e => {
    const parts = [person(e.organizer), ...(e.attendees || []).map(person)];
    const hit = people.filter(p => parts.some(x => x.address === p.address));
    if (!hit.length) return null;
    return {
      id: e.id, ical_uid: e.iCalUId || `outlook:${e.id}`, subject: e.subject || '(senza titolo)',
      start: local(e.start?.dateTime), end: local(e.end?.dateTime), all_day: Boolean(e.isAllDay),
      location: e.location?.displayName || '', organizer: person(e.organizer), attendee_count: (e.attendees || []).length,
      online: Boolean(e.onlineMeeting?.joinUrl), with: hit.map(p => p.name || p.address),
    };
  }).filter(Boolean)
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

module.exports = { projectPeople, crmPeople, mailWith, meetingsWith, MEETING_BACK_DAYS, MEETING_AHEAD_DAYS };
