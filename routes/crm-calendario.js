// Calendario del CRM (ALM2-65, tavola I del canvas «Progetto da email», approvata da Dante il 22/11/2026).
// - I1 è il calendario Outlook di chi lo apre (letto e scritto da qui); dei colleghi solo libero/occupato (getSchedule).
// - I2 colori dal CRM: crm = clienti/aziende (link o invitati che sono contatti del CRM), prj = progetti e trattative,
//   inv = inviti da confermare, int = solo colleghi, oth = il resto; scad = scadenze del Radar seguite.
// - I3 Alma solo al clic col costo (prepara, riepilogo, invito), spesa in crm_mail_spend (Costi AI).
// - I4 note, follow-up e prossimo incontro: le note sono quelle degli incontri del CRM (crm_notes, /api/crm/meetings).
// Le schede (azienda/contatto) usano lo stesso elenco con ?scheda=subjects:ID per sapere cosa è già collegato lì.
const { HttpError, v } = require('../lib/http');
const { graph, TIMEZONE } = require('../lib/graph');
const F = require('../lib/firma');
const C = require('../lib/crm-calendario-ai');

const SELECT = 'id,subject,start,end,isAllDay,location,organizer,attendees,webLink,onlineMeeting,iCalUId,isCancelled,categories,responseStatus,isOrganizer';
const tz = { Prefer: `outlook.timezone="${TIMEZONE}"` };
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const local = s => String(s || '').slice(0, 19);
const person = r => ({ name: r?.emailAddress?.name || '', address: String(r?.emailAddress?.address || '').toLowerCase() });
const isAlma = e => (e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner');
const nowRome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);
const month = () => nowRome().slice(0, 7);
const EMAIL_RE = /^[^\s"@<>]+@[^\s"@<>]+\.[^\s"@<>]+$/;
function when(value, field) {
  if (typeof value !== 'string' || !ISO.test(value)) throw new HttpError(400, `Data «${field}» non valida`);
  return value.length === 10 ? `${value}T00:00:00` : value.length === 16 ? `${value}:00` : value.slice(0, 19);
}

function registerCrmCalendario(app, { db, auth, crmSync, radarFetch, calFake, mailFake, config = {} }) {
  const token = async uid => (calFake ? 'fake' : auth.graphToken(uid));
  async function cal(t, method, path, opts = {}) {
    try { return await (calFake ? calFake.graph(t, method, path, opts) : graph(t, method, path, { ...opts, headers: { ...tz, ...(opts.headers || {}) } })); } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per il calendario serve il permesso di Microsoft sul calendario: esci e rientra in Alma Space', 'calendar');
      throw err;
    }
  }
  const mailSend = (t, body) => (mailFake ? mailFake.graph(t, 'POST', '/me/sendMail', { body }) : graph(t, 'POST', '/me/sendMail', { body }));
  const ai = () => ({ key: process.env.OPENAI_API_KEY || '', fetchImpl: radarFetch || fetch });
  async function spend(eur) {
    if (!eur) return;
    await db.query('INSERT INTO crm_mail_spend (month, eur) VALUES ($1, $2) ON CONFLICT (month) DO UPDATE SET eur = crm_mail_spend.eur + EXCLUDED.eur', [month(), eur]).catch(() => {});
  }
  // chi è collega: email degli utenti e i loro domini
  async function internalFn() {
    const { rows } = await db.query('SELECT name, email FROM users WHERE email IS NOT NULL');
    const emails = new Set(rows.map(u => u.email.toLowerCase()));
    const domains = new Set([...emails].map(e => e.split('@')[1]).filter(d => d && !/^(gmail|outlook|hotmail|yahoo|libero|icloud|live)\./.test(d)));
    return a => emails.has(a) || domains.has(String(a).split('@')[1]);
  }
  async function contactsByEmail(addresses) {
    if (!addresses.length) return new Map();
    const { rows } = await db.query(`SELECT c.id, lower(c.email) AS email, trim(concat_ws(' ', c.first_name, c.last_name)) AS name,
                                            (SELECT s.name FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = c.id ORDER BY l.id DESC LIMIT 1) AS company,
                                            (SELECT l.subject_id FROM crm_contact_links l WHERE l.contact_id = c.id ORDER BY l.id DESC LIMIT 1) AS subject_id
                                       FROM crm_contacts c WHERE lower(c.email) = ANY($1::text[])`, [addresses]);
    return new Map(rows.map(r => [r.email, r]));
  }

  // ── elenco: eventi del proprio Outlook con i colori del CRM ─────────────────────────────────────
  app.get('/api/crm/calendario/eventi', async (req, res) => {
    const start = when(req.query.start, 'inizio'), end = when(req.query.end, 'fine');
    if (end <= start || (Date.parse(end) - Date.parse(start)) / 864e5 > 45) throw new HttpError(400, 'Intervallo non valido');
    const t = await token(req.user.id);
    const data = await cal(t, 'GET', `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=${SELECT}&$top=250&$orderby=start/dateTime`);
    const list = (data.value || []).filter(e => !isAlma(e) && !e.isCancelled);
    const keys = list.map(e => [e.iCalUId, local(e.start?.dateTime)]);
    const uids = keys.map(k => k[0]);
    const [{ rows: ms }, { rows: ps }] = await Promise.all([
      db.query(`SELECT m.id, m.ical_uid, to_char(m.start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at, to_char(m.end_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_at,
                       (SELECT count(*)::int FROM crm_notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL) AS notes,
                       COALESCE((SELECT json_agg(json_build_object('subject_id', L.subject_id, 'contact_id', L.contact_id, 'name', COALESCE(s.name, trim(concat_ws(' ', c.first_name, c.last_name)))))
                                   FROM crm_meeting_links L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                                  WHERE L.meeting_id = m.id AND NOT L.removed), '[]') AS links
                  FROM crm_meetings m WHERE m.ical_uid = ANY($1::text[])`, [uids]),
      db.query(`SELECT pm.ical_uid, to_char(pm.start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at, p.id, p.name FROM project_meetings pm JOIN projects p ON p.id = pm.project_id
                 WHERE pm.ical_uid = ANY($1::text[]) AND p.status <> 'archived'`, [uids]),
    ]);
    const meetingOf = (u, s) => ms.find(m => m.ical_uid === u && m.start_at === s);
    // scheda: cosa è collegato qui (direttamente o, per un'azienda, ai suoi contatti)
    let here = null;
    const sch = String(req.query.scheda || '').match(/^(subjects|contacts):(\d+)$/);
    if (sch) {
      const id = Number(sch[2]);
      const { rows } = await db.query(sch[1] === 'subjects'
        ? `SELECT DISTINCT L.meeting_id FROM crm_meeting_links L WHERE NOT L.removed AND (L.subject_id = $1 OR L.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = $1))`
        : 'SELECT DISTINCT meeting_id FROM crm_meeting_links WHERE NOT removed AND contact_id = $1', [id]);
      here = new Set(rows.map(r => r.meeting_id));
    }
    const internal = await internalFn();
    const contacts = await contactsByEmail([...new Set(list.flatMap(e => (e.attendees || []).map(a => person(a).address).concat(person(e.organizer).address)))].filter(Boolean));
    const me = String(req.user.email || '').toLowerCase();
    const now = nowRome();
    const events = list.map(e => {
      const s = local(e.start?.dateTime);
      const m = meetingOf(e.iCalUId, s);
      const projects = ps.filter(p => p.ical_uid === e.iCalUId && p.start_at === s).map(p => ({ id: p.id, name: p.name }));
      const people = [...(e.attendees || []).map(person), person(e.organizer)].filter(p => p.address && p.address !== me);
      const crmPeople = people.filter(p => contacts.has(p.address));
      const resp = e.responseStatus?.response || 'none';
      const invite = !e.isOrganizer && (resp === 'none' || resp === 'notResponded');
      const kind = invite ? 'inv' : projects.length ? 'prj' : (m?.links?.length || crmPeople.length) ? 'crm' : people.length && people.every(p => internal(p.address)) ? 'int' : !people.length ? 'int' : 'oth';
      return {
        id: e.id, title: e.subject || '(senza titolo)', start: s, end: local(e.end?.dateTime), all_day: Boolean(e.isAllDay), kind,
        location: e.location?.displayName || '', online: Boolean(e.onlineMeeting?.joinUrl), organizer: e.isOrganizer, response: resp,
        meeting_id: m?.id || null, links: m?.links || [], projects, crm_people: crmPeople.map(p => contacts.get(p.address).name || p.name),
        missing_notes: Boolean(m && (m.links || []).length && m.notes === 0 && local(e.end?.dateTime) <= now),
        ...(here ? { here: Boolean(m && here.has(m.id)) } : {}),
      };
    });
    // scadenze del Radar che segui (interessa), come giornate intere
    const { rows: dl } = await db.query(`SELECT id, title, to_char(deadline, 'YYYY-MM-DD') AS day FROM crm_signals
                                          WHERE status = 'interessa' AND deadline >= $1::date AND deadline < $2::date AND (decided_by = $3 OR created_by = $3)
                                          ORDER BY deadline LIMIT 50`, [start.slice(0, 10), end.slice(0, 10), req.user.id]);
    res.json({ events, deadlines: dl.map(d => ({ id: `sig-${d.id}`, signal_id: d.id, title: `Scadenza · ${d.title}`, start: d.day, all_day: true, kind: 'scad' })) });
  });

  // libero/occupato dei colleghi (solo le fasce, niente titoli)
  app.get('/api/crm/calendario/occupato', async (req, res) => {
    const start = when(req.query.start, 'inizio'), end = when(req.query.end, 'fine');
    const emails = String(req.query.emails || '').split(',').map(s => s.trim().toLowerCase()).filter(s => EMAIL_RE.test(s)).slice(0, 10);
    if (!emails.length) return res.json({ people: [] });
    const t = await token(req.user.id);
    const r = await cal(t, 'POST', '/me/calendar/getSchedule', { body: { schedules: emails, startTime: { dateTime: start, timeZone: TIMEZONE }, endTime: { dateTime: end, timeZone: TIMEZONE }, availabilityViewInterval: 30 } });
    res.json({ people: (r.value || []).map(s => ({ address: String(s.scheduleId).toLowerCase(), busy: (s.scheduleItems || []).filter(i => i.status !== 'free').map(i => ({ start: local(i.start?.dateTime), end: local(i.end?.dateTime), status: i.status })) })) });
  });

  // ── un incontro: dettaglio, persone col loro stato nel CRM, collegamenti, note ─────────────────
  async function eventOf(req, eid) {
    const t = await token(req.user.id);
    const e = await cal(t, 'GET', `/me/events/${encodeURIComponent(eid)}?$select=${SELECT},body`, { headers: { Prefer: `${tz.Prefer}, outlook.body-content-type="text"` } });
    return { t, e };
  }
  async function detail(req, eid) {
    const { e } = await eventOf(req, eid);
    const me = String(req.user.email || '').toLowerCase();
    const internal = await internalFn();
    const s = local(e.start?.dateTime);
    const raw = [person(e.organizer), ...(e.attendees || []).map(a => ({ ...person(a), response: a.status?.response || 'none' }))]
      .filter((p, i, a) => p.address && a.findIndex(x => x.address === p.address) === i);
    const contacts = await contactsByEmail(raw.map(p => p.address));
    const { rows: [m] } = await db.query(`SELECT id FROM crm_meetings WHERE ical_uid = $1 AND start_at = $2::timestamp`, [e.iCalUId, s]);
    const [{ rows: links }, { rows: notes }, { rows: projects }] = await Promise.all([
      m ? db.query(`SELECT L.subject_id, L.contact_id, L.auto, COALESCE(s.name, trim(concat_ws(' ', c.first_name, c.last_name))) AS name
                      FROM crm_meeting_links L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                     WHERE L.meeting_id = $1 AND NOT L.removed`, [m.id]) : { rows: [] },
      m ? db.query(`SELECT id, title, body, to_char(note_date, 'YYYY-MM-DD') AS date FROM crm_notes WHERE meeting_id = $1 AND deleted_at IS NULL ORDER BY note_date DESC, id DESC`, [m.id]) : { rows: [] },
      db.query(`SELECT p.id, p.name, pm.id AS meeting_id FROM project_meetings pm JOIN projects p ON p.id = pm.project_id WHERE pm.ical_uid = $1 AND pm.start_at = $2::timestamp AND p.status <> 'archived'`, [e.iCalUId, s]),
    ]);
    return {
      e, m,
      out: {
        id: e.id, title: e.subject || '(senza titolo)', start: s, end: local(e.end?.dateTime), all_day: Boolean(e.isAllDay),
        location: e.location?.displayName || '', online_url: e.onlineMeeting?.joinUrl || null, web_link: e.webLink || null,
        organizer: e.isOrganizer, response: e.responseStatus?.response || 'none', body: String(e.body?.content || '').slice(0, 4000),
        people: raw.filter(p => p.address !== me).map(p => {
          const c = contacts.get(p.address);
          return { name: c?.name || p.name, address: p.address, response: p.response || (p.address === person(e.organizer).address ? 'organizer' : 'none'),
            internal: internal(p.address), contact_id: c?.id || null, company: c?.company || '', subject_id: c?.subject_id || null };
        }),
        meeting_id: m?.id || null, links, notes, projects,
        missing_notes: Boolean(m && links.length && !notes.length && local(e.end?.dateTime) <= nowRome()),
      },
    };
  }
  app.get('/api/crm/calendario/evento/:eid', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    res.json((await detail(req, eid)).out);
  });

  // Accetta / Forse / Rifiuta
  app.post('/api/crm/calendario/evento/:eid/risposta', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    const tipo = { accetta: 'accept', forse: 'tentativelyAccept', rifiuta: 'decline' }[req.body?.tipo];
    if (!tipo) throw new HttpError(400, 'Risposta non valida: accetta, forse o rifiuta');
    const t = await token(req.user.id);
    await cal(t, 'POST', `/me/events/${encodeURIComponent(eid)}/${tipo}`, { body: { sendResponse: true, ...(req.body?.commento ? { comment: v.text(req.body.commento, 'commento', { max: 1000 }) } : {}) } });
    res.json({ ok: true, response: { accept: 'accepted', tentativelyAccept: 'tentativelyAccepted', decline: 'declined' }[tipo] });
  });

  // Collega a un'azienda o a un contatto del CRM (per i progetti c'è già /api/projects/:id/meetings)
  async function linkTo(req, e, eid, { subject_id, contact_id }) {
    const meetingId = await crmSync.upsertMeeting(e, { userId: req.user.id, withBody: true, eventId: eid });
    const col = subject_id ? 'subject_id' : 'contact_id';
    await db.query(`INSERT INTO crm_meeting_links (meeting_id, ${col}, linked_by) VALUES ($1, $2, $3)
                    ON CONFLICT (meeting_id, ${col}) WHERE ${col} IS NOT NULL DO UPDATE SET removed = false, auto = false`, [meetingId, subject_id || contact_id, req.user.id]);
    return meetingId;
  }
  app.post('/api/crm/calendario/evento/:eid/collega', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    const subject_id = req.body?.subject_id ? v.int(req.body.subject_id, 'azienda', { min: 1 }) : null;
    const contact_id = !subject_id && req.body?.contact_id ? v.int(req.body.contact_id, 'contatto', { min: 1 }) : null;
    if (!subject_id && !contact_id) throw new HttpError(400, 'Scegli un\'azienda o un contatto');
    const { rows: [ok] } = await db.query(subject_id ? 'SELECT id FROM crm_subjects WHERE id = $1' : 'SELECT id FROM crm_contacts WHERE id = $1', [subject_id || contact_id]);
    if (!ok) throw new HttpError(404, 'Non trovato nel CRM');
    const { e } = await eventOf(req, eid);
    if (isAlma(e)) throw new HttpError(400, `«${e.subject}» è un ticket di Alma Space`);
    res.status(201).json({ meeting_id: await linkTo(req, e, eid, { subject_id, contact_id }) });
  });
  // Note: si scrivono anche su un incontro non ancora collegato (si copia nel CRM e si collega agli invitati che sono contatti)
  app.post('/api/crm/calendario/evento/:eid/nota', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    const body = v.text(req.body?.testo, 'nota', { max: 20000, required: true });
    const { out, e } = await detail(req, eid);
    let meetingId = out.meeting_id;
    if (!meetingId || !out.links.length) {
      const target = out.people.find(p => p.subject_id) || out.people.find(p => p.contact_id);
      if (!target) throw new HttpError(400, 'Collega prima l\'incontro a un\'azienda o a un contatto del CRM: le note vanno nella sua cronologia');
      meetingId = await linkTo(req, e, eid, target.subject_id ? { subject_id: target.subject_id } : { contact_id: target.contact_id });
    }
    const { rows: [n] } = await db.query(`INSERT INTO crm_notes (meeting_id, kind, title, body, note_date, author_id) VALUES ($1, 'riunione', '', $2, $3::date, $4) RETURNING id`,
      [meetingId, body, out.start.slice(0, 10), req.user.id]);
    res.status(201).json({ id: n.id, meeting_id: meetingId });
  });

  // ── Alma: prepara, riepilogo, invito ─────────────────────────────────────────────────────────
  app.post('/api/crm/calendario/evento/:eid/prepara', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    const { out } = await detail(req, eid);
    const subjectIds = [...new Set([...out.links.map(l => l.subject_id), ...out.people.map(p => p.subject_id)].filter(Boolean))];
    const contactIds = [...new Set([...out.links.map(l => l.contact_id), ...out.people.map(p => p.contact_id)].filter(Boolean))];
    const projectIds = out.projects.map(p => p.id);
    const [{ rows: subs }, { rows: notes }, { rows: emails }, { rows: signals }, { rows: projs }] = await Promise.all([
      db.query('SELECT name FROM crm_subjects WHERE id = ANY($1::int[])', [subjectIds]),
      db.query(`SELECT to_char(n.note_date, 'YYYY-MM-DD') AS date, n.title, n.body FROM crm_notes n
                 WHERE n.deleted_at IS NULL AND (n.subject_id = ANY($1::int[]) OR n.contact_id = ANY($2::int[])
                       OR n.meeting_id IN (SELECT meeting_id FROM crm_meeting_links WHERE NOT removed AND (subject_id = ANY($1::int[]) OR contact_id = ANY($2::int[]))))
                 ORDER BY n.note_date DESC, n.id DESC LIMIT 6`, [subjectIds, contactIds]),
      db.query(`SELECT to_char(e.sent_at, 'YYYY-MM-DD') AS date, COALESCE(e.from_name, e.from_address) AS "from", e.subject, e.body_text AS body FROM crm_emails e
                 WHERE e.id IN (SELECT email_id FROM crm_email_links WHERE subject_id = ANY($1::int[]) OR contact_id = ANY($2::int[]))
                    OR e.internet_message_id IN (SELECT internet_message_id FROM project_emails WHERE project_id = ANY($3::int[]))
                 ORDER BY e.sent_at DESC NULLS LAST LIMIT 5`, [subjectIds, contactIds, projectIds]),
      db.query(`SELECT title, to_char(deadline, 'YYYY-MM-DD') AS deadline FROM crm_signals WHERE subject_id = ANY($1::int[]) AND status IN ('nuovo', 'interessa') ORDER BY deadline NULLS LAST LIMIT 4`, [subjectIds]),
      db.query(`SELECT p.name, COALESCE(NULLIF(p.crm_deal->'state'->>'summary', ''), p.description, '') AS summary FROM projects p WHERE (p.id = ANY($1::int[])
                 OR p.id IN (SELECT project_id FROM crm_project_links WHERE subject_id = ANY($2::int[])))
                 AND p.status <> 'archived' LIMIT 4`, [projectIds, subjectIds]).catch(() => ({ rows: [] })),
    ]);
    // le email del progetto non sempre sono in crm_emails: quelle dei progetti hanno la loro tabella
    let pe = [];
    if (projectIds.length && emails.length < 5) {
      pe = (await db.query(`SELECT to_char(sent_at, 'YYYY-MM-DD') AS date, COALESCE(from_name, from_address) AS "from", subject, body_text AS body FROM project_emails
                             WHERE project_id = ANY($1::int[]) ORDER BY sent_at DESC NULLS LAST LIMIT $2`, [projectIds, 5 - emails.length]).catch(() => ({ rows: [] }))).rows;
    }
    const r = await C.prepare({
      event: { subject: out.title, start: out.start, location: out.location, attendees: out.people.map(p => ({ name: p.name, address: p.address, crm: p.company || (p.internal ? 'collega' : '') })) },
      subjects: subs.map(s => s.name), notes, emails: [...emails, ...pe], signals, projects: projs,
    }, ai());
    await spend(r.eur);
    res.json(r);
  });

  app.post('/api/crm/calendario/evento/:eid/riepilogo', async (req, res) => {
    const eid = v.text(req.params.eid, 'incontro', { max: 500, required: true });
    const { out } = await detail(req, eid);
    if (!out.notes.length) throw new HttpError(400, 'Scrivi prima le note dell\'incontro: il riepilogo parte da lì');
    const r = await C.recap({ event: { subject: out.title, start: out.start, attendees: out.people }, notes: out.notes, meName: req.user.name, tu: false }, ai());
    await spend(r.eur);
    res.json({ ...r, to: out.people.filter(p => p.response !== 'declined') });
  });

  // Manda il riepilogo (email nuova, con la firma Almacis e il logo dentro l'email)
  app.post('/api/crm/calendario/evento/:eid/manda', async (req, res) => {
    const b = req.body || {};
    const list = x => (Array.isArray(x) ? x : []).slice(0, 50).map(p => ({ address: String(p?.address || '').trim().toLowerCase(), name: String(p?.name || '').slice(0, 120) })).filter(p => EMAIL_RE.test(p.address));
    const to = list(b.a), cc = list(b.cc).filter(p => !to.some(x => x.address === p.address));
    if (!to.length) throw new HttpError(400, 'Scegli almeno un destinatario');
    const subject = v.text(b.oggetto, 'oggetto', { max: 250, required: true });
    const text = v.text(b.testo, 'testo', { max: 20000, required: true });
    const sig = await F.signatureOf({ db, userId: req.user.id });
    const r = p => ({ emailAddress: { address: p.address, ...(p.name ? { name: p.name } : {}) } });
    const t = mailFake ? 'fake' : await auth.graphToken(req.user.id);
    await mailSend(t, { saveToSentItems: true, message: {
      subject, toRecipients: to.map(r), ccRecipients: cc.map(r),
      body: { contentType: 'html', content: `${F.bodyHtml(text)}${sig.enabled && b.firma !== false ? F.html(sig) : ''}` },
      attachments: sig.enabled && b.firma !== false ? [F.logoAttachment()] : [],
    } });
    res.json({ ok: true, to });
  });

  app.post('/api/crm/calendario/invito', async (req, res) => {
    const b = req.body || {};
    const internal = await internalFn();
    const con = (Array.isArray(b.con) ? b.con : []).slice(0, 30).map(p => ({ name: String(p?.name || ''), address: String(p?.address || '').toLowerCase() })).map(p => ({ ...p, internal: internal(p.address) }));
    const r = await C.invite({ titolo: v.text(b.titolo, 'titolo', { max: 255, required: true }), quando: v.text(b.quando, 'quando', { max: 80 }) || '', con, collega: v.text(b.collega, 'argomento', { max: 255 }) || '', meName: req.user.name }, ai());
    await spend(r.eur);
    res.json(r);
  });

  // Trova un orario libero per tutti (io + invitati colleghi; degli esterni non si vede il calendario)
  app.post('/api/crm/calendario/orari', async (req, res) => {
    const b = req.body || {};
    const minutes = Math.min(480, Math.max(15, Number(b.minuti) || 60));
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b.da || '')) ? b.da : nowRome().slice(0, 10);
    const internal = await internalFn();
    const me = String(req.user.email || '').toLowerCase();
    const emails = [me, ...(Array.isArray(b.emails) ? b.emails : []).map(x => String(x).toLowerCase()).filter(x => EMAIL_RE.test(x) && internal(x) && x !== me)].slice(0, 10);
    const end = new Date(`${from}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 10);
    const t = await token(req.user.id);
    const r = await cal(t, 'POST', '/me/calendar/getSchedule', { body: { schedules: emails, startTime: { dateTime: `${from}T00:00:00`, timeZone: TIMEZONE }, endTime: { dateTime: `${end.toISOString().slice(0, 10)}T00:00:00`, timeZone: TIMEZONE }, availabilityViewInterval: 30 } });
    const busy = (r.value || []).flatMap(s => (s.scheduleItems || []).filter(i => i.status !== 'free').map(i => ({ start: local(i.start?.dateTime).slice(0, 16), end: local(i.end?.dateTime).slice(0, 16) })));
    // il mio calendario anche dagli eventi (getSchedule a volte non ha il proprietario)
    const mine = await cal(t, 'GET', `/me/calendarView?startDateTime=${from}T00:00:00&endDateTime=${end.toISOString().slice(0, 10)}T00:00:00&$select=start,end,showAs,isCancelled&$top=250`).catch(() => ({ value: [] }));
    for (const e of mine.value || []) if (!e.isCancelled && e.showAs !== 'free') busy.push({ start: local(e.start?.dateTime).slice(0, 16), end: local(e.end?.dateTime).slice(0, 16) });
    res.json({ slots: C.freeSlots(busy, { from, minutes, days: 10, now: nowRome().slice(0, 16) }), people: emails.length });
  });

  // ── Nuovo incontro: invitati dal CRM, Teams o luogo, testo con firma, promemoria, collegato al CRM ──
  app.post('/api/crm/calendario/nuovo', async (req, res) => {
    const b = req.body || {};
    const subject = v.text(b.titolo, 'titolo', { max: 255, required: true });
    const startAt = when(b.inizio, 'inizio'), endAt = when(b.fine, 'fine');
    if (endAt <= startAt) throw new HttpError(400, 'La fine è prima dell\'inizio');
    const con = (Array.isArray(b.con) ? b.con : []).slice(0, 50).map(p => ({ name: String(p?.name || '').slice(0, 120), address: String(p?.address || '').trim().toLowerCase() })).filter(p => EMAIL_RE.test(p.address));
    const text = v.text(b.testo, 'testo', { max: 10000 }) || '';
    const sig = b.firma === false ? null : await F.signatureOf({ db, userId: req.user.id });
    const logo = `${String(config.baseUrl || '').replace(/\/$/, '')}/brand/almacis/almacis-logo.png`;
    const reminder = [0, 15, 30, 60, 1440].includes(Number(b.promemoria)) ? Number(b.promemoria) : 15;
    const event = {
      subject, start: { dateTime: startAt, timeZone: TIMEZONE }, end: { dateTime: endAt, timeZone: TIMEZONE },
      location: { displayName: v.text(b.luogo, 'luogo', { max: 255 }) || '' },
      body: { contentType: 'html', content: `${text ? F.bodyHtml(text) : ''}${sig?.enabled ? F.html(sig, { logoSrc: logo }) : ''}` },
      attendees: con.map(p => ({ type: 'required', emailAddress: { address: p.address, ...(p.name ? { name: p.name } : {}) } })),
      isReminderOn: reminder > 0, reminderMinutesBeforeStart: reminder,
      ...(b.teams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    };
    const t = await token(req.user.id);
    const created = await cal(t, 'POST', '/me/events', { body: event });
    let meetingId = null;
    const subject_id = b.subject_id ? v.int(b.subject_id, 'azienda', { min: 1 }) : null;
    const contact_id = !subject_id && b.contact_id ? v.int(b.contact_id, 'contatto', { min: 1 }) : null;
    if (subject_id || contact_id) meetingId = await linkTo(req, created, created.id, { subject_id, contact_id });
    res.status(201).json({ id: created.id, meeting_id: meetingId, web_link: created.webLink || null });
  });

  // aziende e contatti per «Collega a» (anche le aziende senza email)
  app.get('/api/crm/calendario/cerca', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ items: [] });
    const like = `%${q.toLowerCase()}%`;
    const [{ rows: s }, { rows: c }] = await Promise.all([
      db.query(`SELECT id, name FROM crm_subjects WHERE merged_into IS NULL AND lower(name) LIKE $1 ORDER BY name LIMIT 8`, [like]),
      db.query(`SELECT id, trim(concat_ws(' ', first_name, last_name)) AS name FROM crm_contacts WHERE lower(first_name || ' ' || last_name) LIKE $1 OR lower(last_name || ' ' || first_name) LIKE $1 ORDER BY last_name LIMIT 6`, [like]),
    ]);
    res.json({ items: [...s.map(x => ({ kind: 'azienda', subject_id: x.id, name: x.name })), ...c.map(x => ({ kind: 'contatto', contact_id: x.id, name: x.name }))] });
  });
}

module.exports = { registerCrmCalendario };
