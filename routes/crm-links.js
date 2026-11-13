// CRM: email, incontri, note e progetti su aziende e contatti, come negli A3 (canvas del 12–13/11/2026).
// - Email: si collegano dalla propria casella (mai in automatico); la scheda propone quelle scambiate con i contatti.
// - Incontri: dal proprio calendario con un clic, «Fissa un incontro», oppure da soli (lib/crm-sync.js) quando un
//   invitato ha un'email del CRM. «Togli» li stacca e non tornano più.
// - Note: come negli A3 (tipo, data, fissa in alto, @menzioni, file), anche sugli incontri.
// - Tutto quello che è collegato a un contatto ricade sulle aziende dove lavora alla data dell'email, dell'incontro
//   o della nota; sull'azienda si vede con «tramite <contatto>».
// Vede tutto chi vede l'azienda o il contatto (regole delle ASA in routes/crm.js).
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { graph, graphAll, TIMEZONE } = require('../lib/graph');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const NOTE_KINDS = ['nota', 'telefonata', 'riunione', 'decisione'];
const FILE_MAX = 20 * 1024 * 1024;
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENTS = 50 * 1024 * 1024;
const EVENT_SELECT = 'id,subject,start,end,isAllDay,location,organizer,attendees,webLink,onlineMeeting,iCalUId,isCancelled,categories';
const tz = { Prefer: `outlook.timezone="${TIMEZONE}"` };
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const person = r => ({ name: r?.emailAddress?.name || '', address: (r?.emailAddress?.address || '').toLowerCase() });
const local = s => String(s || '').slice(0, 19);
const isAlma = e => (e.categories || []).some(c => c === 'Alma Planet' || c === 'Alma Planner');
const ts = col => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const toBuffer = d => (Buffer.isBuffer(d) ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength));
const safeFilename = s => String(s || 'file').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
const nowRome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);
function readWhen(value, field) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) throw new HttpError(400, `Data «${field}» non valida`);
  return value.length === 10 ? `${value}T00:00:00` : value.length === 16 ? `${value}:00` : value.slice(0, 19);
}
async function msGraph(token, method, path, opts, what) {
  try { return await graph(token, method, path, opts); } catch (err) {
    if (err.status === 403) throw new HttpError(403, `Per ${what} serve il permesso di Microsoft: chiedi all'amministratore di approvarlo`);
    throw err;
  }
}

// Condizione «collegato a questa scheda» su una tabella di collegamenti (alias L) con la data D dell'elemento.
// Per un'azienda: collegato direttamente o a un contatto che ci lavorava a quella data. Per un contatto: solo diretto.
function linkCond(target, p, D) {
  if (target === 'contacts') return `L.contact_id = ${p}`;
  return `(L.subject_id = ${p} OR L.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = ${p}
            AND (cl.date_from IS NULL OR cl.date_from <= ${D}) AND (cl.date_to IS NULL OR cl.date_to >= ${D})))`;
}
const VIA = `CASE WHEN L.contact_id IS NOT NULL THEN (SELECT trim(concat_ws(' ', c.title, c.first_name, c.last_name)) FROM crm_contacts c WHERE c.id = L.contact_id) END`;

const NOTE_SELECT = `
  SELECT n.id, n.subject_id, n.contact_id, n.meeting_id, n.kind, n.title, n.body, n.note_date, n.pinned, n.author_id, n.created_at, n.updated_at,
         m.subject AS meeting_subject, ${ts('m.start_at')} AS meeting_start, m.all_day AS meeting_all_day,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'size', f.size, 'added_by', f.added_by) ORDER BY f.id)
                     FROM crm_note_files f WHERE f.note_id = n.id), '[]') AS files
    FROM crm_notes n LEFT JOIN crm_meetings m ON m.id = n.meeting_id`;
const MEETING_COLS = `m.id, m.ical_uid, m.subject, ${ts('m.start_at')} AS start_at, ${ts('m.end_at')} AS end_at, m.all_day, m.location,
  m.organizer_name, m.organizer_address, m.attendees, m.online_url, m.linked_by`;

function readNote(body, { partial, allowEmpty = false }) {
  const out = {
    kind: v.oneOf(body.kind, 'tipo', NOTE_KINDS),
    title: v.text(body.title, 'titolo', { max: 200 }),
    body: v.text(body.body, 'testo', { max: 20000, required: !partial && !allowEmpty }),
    note_date: v.date(body.note_date, 'data'),
    pinned: body.pinned === undefined ? undefined : Boolean(body.pinned),
  };
  if (out.body === '' && !allowEmpty) throw new HttpError(400, 'Scrivi il testo della nota');
  if (out.note_date === null) throw new HttpError(400, 'La data della nota è obbligatoria');
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined));
}

function registerCrmLinks(app, { db, auth, notifier, crmSync, subjectById, contactById, seeSql, contactSeeSql }) {
  const TARGETS = ['subjects', 'contacts'];
  // la scheda (azienda o contatto) da :target/:id, controllando che si veda
  async function target(req, { write = false } = {}) {
    const t = v.oneOf(req.params.target, 'scheda', TARGETS);
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (t === 'subjects') await subjectById(req, id, { forWrite: write }); else await contactById(req, id);
    return { t, id, col: t === 'subjects' ? 'subject_id' : 'contact_id' };
  }
  // un'email o un incontro si vede se almeno una delle schede collegate si vede (o, per un'azienda, tramite i suoi contatti)
  async function canSeeLinked(req, table, fk, itemId) {
    if (req.crm.admin) return true;
    const params = [itemId];
    const seeS = seeSql(req, 's', params);
    const seeC = contactSeeSql(req, 'c', params);
    const { rows: [r] } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM ${table} L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                       WHERE L.${fk} = $1 AND ((L.subject_id IS NOT NULL AND ${seeS}) OR (L.contact_id IS NOT NULL AND ${seeC}))) AS ok`, params);
    return r.ok;
  }
  async function getMeeting(req, id) {
    const { rows: [m] } = await db.query(`SELECT ${MEETING_COLS}, m.body_text, m.web_link FROM crm_meetings m WHERE m.id = $1`, [id]);
    if (!m || !(await canSeeLinked(req, 'crm_meeting_links', 'meeting_id', id))) throw new HttpError(404, 'Incontro non trovato');
    return m;
  }
  async function getEmail(req, id) {
    const { rows: [e] } = await db.query('SELECT * FROM crm_emails WHERE id = $1', [id]);
    if (!e || !(await canSeeLinked(req, 'crm_email_links', 'email_id', id))) throw new HttpError(404, 'Email non trovata');
    return e;
  }
  async function getNote(req, id) {
    const { rows: [n] } = await db.query(`${NOTE_SELECT} WHERE n.id = $1`, [id]);
    if (!n) throw new HttpError(404, 'Nota non trovata');
    if (n.subject_id) await subjectById(req, n.subject_id);
    else if (n.contact_id) await contactById(req, n.contact_id);
    else await getMeeting(req, n.meeting_id);
    return n;
  }
  const canEditNote = (req, n) => n.author_id === req.user.id || req.crm.admin;

  // ── panoramica: ultimi aggiornamenti (email, incontri, note) ────────────────────────────────
  app.get('/api/crm/:target/:id/timeline', async (req, res) => {
    const { t, id } = await target(req);
    const [emails, meetings, notes] = await Promise.all([listEmails(t, id, 15), listMeetings(t, id, 15), listNotes(t, id, 15)]);
    const items = [
      ...emails.map(e => ({ type: 'email', id: e.id, date: e.sent_at, title: e.subject, meta: e.from_name || e.from_address, via: e.via, attachments: e.attachment_count })),
      ...meetings.map(m => ({ type: 'meeting', id: m.id, date: m.start_at, end: m.end_at, title: m.subject, meta: m.location, via: m.via, auto: m.auto, notes: m.note_count, missing: m.missing_notes })),
      ...notes.map(n => ({ type: 'note', id: n.id, date: n.note_date, title: n.title || n.body.slice(0, 120), body: n.body, kind: n.kind, author_id: n.author_id, via: n.via, meeting: n.meeting_subject })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 25);
    res.json({ items });
  });

  // ── email ──────────────────────────────────────────────────────────────────────────────
  async function listEmails(t, id, limit = 500) {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (e.id) e.id, e.subject, e.from_name, e.from_address, e.to_list, e.sent_at, e.assigned_by,
              left(regexp_replace(e.body_text, '\\s+', ' ', 'g'), 200) AS preview,
              (SELECT COUNT(*)::int FROM crm_email_attachments a WHERE a.email_id = e.id) AS attachment_count,
              L.id AS link_id, L.contact_id IS NOT NULL AND ${t === 'subjects' ? 'true' : 'false'} AS indirect, ${VIA} AS via
         FROM crm_email_links L JOIN crm_emails e ON e.id = L.email_id
        WHERE ${linkCond(t, '$1', 'COALESCE(e.sent_at::date, CURRENT_DATE)')}
        ORDER BY e.id, (L.contact_id IS NULL) DESC`, [id]);
    return rows.map(r => ({ ...r, via: r.indirect ? r.via : null }))
      .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at))).slice(0, limit);
  }
  app.get('/api/crm/:target/:id/emails', async (req, res) => {
    const { t, id } = await target(req);
    res.json(await listEmails(t, id));
  });

  // Proposte: email della propria casella scambiate con i contatti della scheda e non ancora collegate.
  app.get('/api/crm/:target/:id/email-proposals', async (req, res) => {
    const { t, id } = await target(req);
    const { rows } = t === 'subjects'
      ? await db.query(`SELECT DISTINCT lower(c.email) AS email FROM crm_contact_links cl JOIN crm_contacts c ON c.id = cl.contact_id
                         WHERE cl.subject_id = $1 AND cl.date_to IS NULL AND c.email <> '' LIMIT 8`, [id])
      : await db.query(`SELECT lower(email) AS email FROM crm_contacts WHERE id = $1 AND email <> ''`, [id]);
    const addrs = rows.map(r => r.email).filter(a => /^[^\s"]+@[^\s"]+$/.test(a));
    if (!addrs.length) return res.json({ messages: [], addresses: [] });
    const token = await auth.graphToken(req.user.id);
    const search = addrs.map(a => `participants:${a}`).join(' OR ');
    const data = await msGraph(token, 'GET', `/me/messages?$search="${encodeURIComponent(search)}"&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,hasAttachments,internetMessageId,isDraft&$top=25`,
      undefined, 'leggere la posta');
    const items = (data.value || []).filter(m => !m.isDraft);
    const { rows: done } = await db.query(
      `SELECT e.internet_message_id FROM crm_emails e JOIN crm_email_links L ON L.email_id = e.id
        WHERE e.internet_message_id = ANY($2::text[]) AND L.${t === 'subjects' ? 'subject_id' : 'contact_id'} = $1`,
      [id, items.map(m => m.internetMessageId).filter(Boolean)]);
    const linked = new Set(done.map(r => r.internet_message_id));
    res.json({
      addresses: addrs,
      messages: items.filter(m => !linked.has(m.internetMessageId)).map(m => ({
        id: m.id, subject: m.subject || '(senza oggetto)', from: person(m.from), to: (m.toRecipients || []).map(person),
        date: m.receivedDateTime || m.sentDateTime, preview: (m.bodyPreview || '').slice(0, 240), has_attachments: Boolean(m.hasAttachments),
      })),
    });
  });

  // Collega email della propria casella (stessa logica dei progetti: testo e allegati copiati una volta).
  app.post('/api/crm/:target/:id/emails', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const ids = req.body?.message_ids;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Scegli almeno una email');
    if (ids.length > 50) throw new HttpError(400, 'Al massimo 50 email alla volta');
    const token = await auth.graphToken(req.user.id);
    let added = 0, already = 0;
    for (const mid of [...new Set(ids.map(x => v.text(x, 'email', { max: 500, required: true })))]) {
      const enc = encodeURIComponent(mid);
      const m = await msGraph(token, 'GET', `/me/messages/${enc}?$select=subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,internetMessageId,hasAttachments,webLink`,
        { headers: { Prefer: 'outlook.body-content-type="text"' } }, 'leggere la posta');
      const imid = m.internetMessageId || `outlook:${mid}`;
      let { rows: [e] } = await db.query('SELECT id FROM crm_emails WHERE internet_message_id = $1', [imid]);
      if (!e) {
        const files = [];
        if (m.hasAttachments) {
          const list = await msGraph(token, 'GET', `/me/messages/${enc}/attachments?$select=id,name,contentType,size,isInline`, undefined, 'leggere la posta');
          let total = 0;
          for (const a of list.value || []) {
            if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline || a.size > MAX_ATTACHMENT || total + a.size > MAX_EMAIL_ATTACHMENTS) continue;
            const r = await fetch(`${GRAPH}/me/messages/${enc}/attachments/${encodeURIComponent(a.id)}/$value`, { headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) continue;
            const data = Buffer.from(await r.arrayBuffer());
            total += data.length;
            files.push({ name: a.name || 'allegato', type: a.contentType || 'application/octet-stream', data });
          }
        }
        e = await db.tx(async q => {
          const { rows: [row] } = await q.query(
            `INSERT INTO crm_emails (internet_message_id, subject, from_name, from_address, to_list, cc_list, sent_at, body_text, assigned_by, outlook_id, web_link)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (internet_message_id) DO UPDATE SET subject = crm_emails.subject RETURNING id`,
            [imid, (m.subject || '(senza oggetto)').slice(0, 1000), person(m.from).name || null, person(m.from).address || null,
              JSON.stringify((m.toRecipients || []).map(person)), JSON.stringify((m.ccRecipients || []).map(person)),
              m.sentDateTime || m.receivedDateTime || null, (m.body?.content || '').slice(0, 500000), req.user.id, mid, m.webLink || null]);
          for (const f of files) {
            await q.query('INSERT INTO crm_email_attachments (email_id, name, content_type, size, data) VALUES ($1, $2, $3, $4, $5)',
              [row.id, f.name.slice(0, 300), f.type.slice(0, 200), f.data.length, f.data]);
          }
          return row;
        });
      }
      const { rowCount } = await db.query(`INSERT INTO crm_email_links (email_id, ${col}, linked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [e.id, id, req.user.id]);
      if (rowCount) added++; else already++;
    }
    res.status(201).json({ added, already });
  });

  app.get('/api/crm/emails/:id', async (req, res) => {
    const e = await getEmail(req, v.int(req.params.id, 'email', { min: 1 }));
    const { rows } = await db.query('SELECT id, name, content_type, size FROM crm_email_attachments WHERE email_id = $1 ORDER BY id', [e.id]);
    const { outlook_id: _o, web_link, ...rest } = e;
    res.json({ ...rest, web_link: e.assigned_by === req.user.id ? web_link : null, attachments: rows });
  });
  app.get('/api/crm/emails/:id/attachments/:aid', async (req, res) => {
    const e = await getEmail(req, v.int(req.params.id, 'email', { min: 1 }));
    const { rows: [a] } = await db.query('SELECT name, data FROM crm_email_attachments WHERE id = $1 AND email_id = $2', [v.int(req.params.aid, 'allegato', { min: 1 }), e.id]);
    if (!a) throw new HttpError(404, 'Allegato non trovato');
    const name = safeFilename(a.name);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
    res.send(toBuffer(a.data));
  });
  // toglie l'email da questa scheda (se non resta collegata a niente, sparisce)
  app.delete('/api/crm/:target/:id/emails/:emailId', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const emailId = v.int(req.params.emailId, 'email', { min: 1 });
    const { rowCount } = await db.query(`DELETE FROM crm_email_links WHERE email_id = $1 AND ${col} = $2`, [emailId, id]);
    if (!rowCount) throw new HttpError(400, 'Questa email arriva da un contatto: si toglie dalla scheda del contatto');
    await db.query('DELETE FROM crm_emails e WHERE e.id = $1 AND NOT EXISTS (SELECT 1 FROM crm_email_links L WHERE L.email_id = e.id)', [emailId]);
    res.json({ ok: true });
  });

  // ── incontri ───────────────────────────────────────────────────────────────────────────
  async function listMeetings(t, id, limit = 500) {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (m.id) ${MEETING_COLS}, L.auto, L.id AS link_id,
              L.contact_id IS NOT NULL AND ${t === 'subjects' ? 'true' : 'false'} AS indirect, ${VIA} AS via,
              (SELECT COUNT(*)::int FROM crm_notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL) AS note_count
         FROM crm_meeting_links L JOIN crm_meetings m ON m.id = L.meeting_id
        WHERE NOT L.removed AND ${linkCond(t, '$1', 'm.start_at::date')}
        ORDER BY m.id, (L.contact_id IS NULL) DESC`, [id]);
    const now = nowRome();
    return rows.map(r => ({ ...r, via: r.indirect ? r.via : null, missing_notes: Boolean(r.end_at && r.end_at <= now && !r.note_count) }))
      .sort((a, b) => String(b.start_at).localeCompare(String(a.start_at))).slice(0, limit);
  }
  app.get('/api/crm/:target/:id/meetings', async (req, res) => {
    const { t, id } = await target(req);
    res.json(await listMeetings(t, id));
  });

  // il proprio calendario per la settimana dell'A3: con gli incontri già collegati a questa scheda
  app.get('/api/crm/:target/:id/calendar', async (req, res) => {
    const { t, id } = await target(req);
    const start = readWhen(req.query.start, 'inizio');
    const end = readWhen(req.query.end, 'fine');
    if (end <= start || (Date.parse(end) - Date.parse(start)) / 86400000 > 42) throw new HttpError(400, 'Settimana non valida');
    const token = await auth.graphToken(req.user.id);
    let list;
    try {
      list = await graphAll(token, `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=${EVENT_SELECT}&$top=200&$orderby=start/dateTime`,
        { max: 500, headers: tz });
    } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per leggere il calendario serve il permesso di Microsoft sul calendario');
      throw err;
    }
    const linked = new Map((await listMeetings(t, id)).map(m => [`${m.ical_uid}|${m.start_at}`, m]));
    res.json(list.filter(e => !isAlma(e) && !e.isCancelled).map(e => {
      const m = linked.get(`${e.iCalUId}|${local(e.start?.dateTime)}`);
      return { id: e.id, subject: e.subject || '(senza titolo)', start: local(e.start?.dateTime), end: local(e.end?.dateTime), all_day: Boolean(e.isAllDay),
        location: e.location?.displayName || '', organizer: person(e.organizer), linked: Boolean(m), meeting_id: m?.id || null, missing_notes: Boolean(m?.missing_notes) };
    }));
  });

  // Copia un evento del calendario di chi collega (ritrova l'incontro se c'è già) e lo collega alla scheda.
  async function linkEvent(token, col, id, eid, userId) {
    const e = await msGraph(token, 'GET', `/me/events/${encodeURIComponent(eid)}?$select=${EVENT_SELECT},body`,
      { headers: { ...tz, Prefer: `${tz.Prefer}, outlook.body-content-type="text"` } }, 'leggere il calendario');
    if (isAlma(e)) throw new HttpError(400, `«${e.subject}» è un ticket di Alma Planet`);
    const meetingId = await crmSync.upsertMeeting(e, { userId, withBody: true, eventId: eid });
    await db.query(`INSERT INTO crm_meeting_links (meeting_id, ${col}, linked_by) VALUES ($1, $2, $3)
                    ON CONFLICT (meeting_id, ${col}) WHERE ${col} IS NOT NULL DO UPDATE SET removed = false, auto = false`, [meetingId, id, userId]);
    return meetingId;
  }
  app.post('/api/crm/:target/:id/meetings', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const ids = req.body?.event_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 20) throw new HttpError(400, 'Scegli da 1 a 20 incontri');
    const token = await auth.graphToken(req.user.id);
    const out = [];
    for (const eid of [...new Set(ids.map(x => v.text(x, 'incontro', { max: 500, required: true })))]) out.push(await linkEvent(token, col, id, eid, req.user.id));
    res.status(201).json({ ids: out });
  });
  // «Fissa un incontro» come in Outlook: nel calendario di chi lo fissa, con gli invitati, già collegato
  app.post('/api/crm/:target/:id/meetings/new', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const b = req.body || {};
    const subject = v.text(b.title, 'titolo', { max: 255, required: true });
    const startAt = readWhen(b.start, 'inizio'), endAt = readWhen(b.end, 'fine');
    if (endAt <= startAt) throw new HttpError(400, 'La fine è prima dell\'inizio');
    const attendees = (Array.isArray(b.attendees) ? b.attendees : []).slice(0, 50).map(a => v.text(a, 'invitato', { max: 300 })).filter(a => a && /^[^@\s]+@[^@\s]+$/.test(a));
    const event = {
      subject, start: { dateTime: startAt, timeZone: TIMEZONE }, end: { dateTime: endAt, timeZone: TIMEZONE },
      location: { displayName: v.text(b.location, 'luogo', { max: 255 }) || '' },
      body: { contentType: 'text', content: v.text(b.body, 'descrizione', { max: 10000 }) || '' },
      attendees: attendees.map(address => ({ type: 'required', emailAddress: { address } })),
    };
    if (b.online) { event.isOnlineMeeting = true; event.onlineMeetingProvider = 'teamsForBusiness'; }
    const token = await auth.graphToken(req.user.id);
    const created = await msGraph(token, 'POST', '/me/events', { body: event, headers: tz }, 'scrivere nel calendario');
    res.status(201).json({ id: await linkEvent(token, col, id, created.id, req.user.id) });
  });
  // «Togli»: stacca l'incontro da questa scheda e non torna più (anche se era automatico)
  app.delete('/api/crm/:target/:id/meetings/:meetingId', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const { rowCount } = await db.query(`UPDATE crm_meeting_links SET removed = true WHERE meeting_id = $1 AND ${col} = $2`, [v.int(req.params.meetingId, 'incontro', { min: 1 }), id]);
    if (!rowCount) throw new HttpError(400, 'Questo incontro arriva da un contatto: si toglie dalla scheda del contatto');
    res.json({ ok: true });
  });

  app.get('/api/crm/meetings/:id', async (req, res) => {
    const m = await getMeeting(req, v.int(req.params.id, 'incontro', { min: 1 }));
    const params = [m.id];
    const seeS = seeSql(req, 's', params);
    const seeC = contactSeeSql(req, 'c', params);
    const [{ rows: notes }, { rows: links }] = await Promise.all([
      db.query(`${NOTE_SELECT} WHERE n.deleted_at IS NULL AND n.meeting_id = $1 ORDER BY n.pinned DESC, n.note_date DESC, n.id DESC`, [m.id]),
      db.query(`SELECT L.id, L.subject_id, L.contact_id, L.auto, s.name AS subject_name, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS contact_name
                  FROM crm_meeting_links L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                 WHERE L.meeting_id = $1 AND NOT L.removed AND ((L.subject_id IS NOT NULL AND ${seeS}) OR (L.contact_id IS NOT NULL AND ${seeC}))`, params),
    ]);
    const { web_link, ...rest } = m;
    res.json({ ...rest, web_link: m.linked_by === req.user.id ? web_link : null, notes, links,
      missing_notes: Boolean(m.end_at && m.end_at <= nowRome() && !notes.length) });
  });
  app.post('/api/crm/meetings/:id/notes', async (req, res) => {
    const m = await getMeeting(req, v.int(req.params.id, 'incontro', { min: 1 }));
    const f = readNote({ kind: 'riunione', note_date: m.start_at.slice(0, 10), ...req.body }, { partial: false, allowEmpty: Boolean(req.body?.with_files) });
    const { rows: [n] } = await db.query(
      'INSERT INTO crm_notes (meeting_id, kind, title, body, note_date, pinned, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [m.id, f.kind || 'riunione', f.title || '', f.body || '', f.note_date, Boolean(f.pinned), req.user.id]);
    res.status(201).json(await afterSave(req, n.id));
  });

  // ── note ───────────────────────────────────────────────────────────────────────────────
  // di un'azienda: le sue, quelle dei contatti che ci lavoravano a quella data e quelle degli incontri che si vedono qui
  async function listNotes(t, id, limit = 1000) {
    const own = t === 'subjects'
      ? `(n.subject_id = $1 OR n.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = $1
            AND (cl.date_from IS NULL OR cl.date_from <= n.note_date) AND (cl.date_to IS NULL OR cl.date_to >= n.note_date)))`
      : 'n.contact_id = $1';
    const meetingIds = (await listMeetings(t, id)).map(m => m.id);
    const { rows } = await db.query(
      `${NOTE_SELECT.replace('SELECT n.id,', `SELECT CASE WHEN n.contact_id IS NOT NULL AND ${t === 'subjects' ? 'true' : 'false'}
             THEN (SELECT trim(concat_ws(' ', c.title, c.first_name, c.last_name)) FROM crm_contacts c WHERE c.id = n.contact_id) END AS via, n.id,`)}
        WHERE n.deleted_at IS NULL AND (${own} OR n.meeting_id = ANY($2::int[]))
        ORDER BY n.pinned DESC, n.note_date DESC, n.id DESC LIMIT ${Number(limit)}`, [id, meetingIds]);
    return rows;
  }
  async function afterSave(req, noteId, before = null) {
    const n = (await db.query(`${NOTE_SELECT} WHERE n.id = $1`, [noteId])).rows[0];
    // @menzioni: avvisa chi è menzionato (e non lo era prima); chi non vede la scheda non riceve niente
    const text = `${n.title}\n${n.body}`;
    const ids = (await notifier.mentionedIds(text)).filter(uid => uid !== req.user.id);
    const prev = before ? await notifier.mentionedIds(`${before.title}\n${before.body}`) : [];
    const fresh = ids.filter(uid => !prev.includes(uid));
    let notified = [];
    if (fresh.length) {
      notified = await notifier.notify({ userIds: fresh, actorId: req.user.id, kind: 'crm', body: `ti ha menzionato in una nota del CRM: «${(n.title || n.body).slice(0, 140)}»`,
        link: n.subject_id ? `/crm/scheda/${n.subject_id}/note` : n.contact_id ? `/crm/contatti/${n.contact_id}` : `/crm/incontro/${n.meeting_id}` });
    }
    return { ...n, mentions: { notified, cannot_see: [] } };
  }
  app.get('/api/crm/:target/:id/notes', async (req, res) => {
    const { t, id } = await target(req);
    res.json(await listNotes(t, id));
  });
  app.post('/api/crm/:target/:id/notes', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const f = readNote(req.body || {}, { partial: false, allowEmpty: Boolean(req.body?.with_files) });
    const { rows: [n] } = await db.query(
      `INSERT INTO crm_notes (${col}, kind, title, body, note_date, pinned, author_id) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7) RETURNING id`,
      [id, f.kind || 'nota', f.title || '', f.body || '', f.note_date || null, Boolean(f.pinned), req.user.id]);
    res.status(201).json(await afterSave(req, n.id));
  });
  app.patch('/api/crm/notes/:id', async (req, res) => {
    const n = await getNote(req, v.int(req.params.id, 'nota', { min: 1 }));
    if (!canEditNote(req, n)) throw new HttpError(403, 'La modifica chi l\'ha scritta o la direzione');
    const f = readNote(req.body || {}, { partial: true });
    const textChanged = ['kind', 'title', 'body', 'note_date'].some(k => k in f && String(f[k]) !== String(n[k]));
    const keys = Object.keys(f);
    if (keys.length) {
      await db.query(`UPDATE crm_notes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}${textChanged ? ', updated_at = now()' : ''} WHERE id = $1`, [n.id, ...keys.map(k => f[k])]);
    }
    res.json(await afterSave(req, n.id, n));
  });
  app.delete('/api/crm/notes/:id', async (req, res) => {
    const n = await getNote(req, v.int(req.params.id, 'nota', { min: 1 }));
    if (!canEditNote(req, n)) throw new HttpError(403, 'La elimina chi l\'ha scritta o la direzione');
    await db.query('UPDATE crm_notes SET deleted_at = now() WHERE id = $1', [n.id]);
    res.json({ ok: true });
  });
  app.post('/api/crm/notes/:id/restore', async (req, res) => {
    const id = v.int(req.params.id, 'nota', { min: 1 });
    const { rows: [raw] } = await db.query('SELECT author_id FROM crm_notes WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
    if (!raw) throw new HttpError(404, 'Nota non trovata');
    await db.query('UPDATE crm_notes SET deleted_at = NULL WHERE id = $1', [id]);
    try {
      const n = await getNote(req, id);
      if (!canEditNote(req, n)) throw new HttpError(403, 'La ripristina chi l\'ha scritta');
      res.json(n);
    } catch (err) {
      await db.query('UPDATE crm_notes SET deleted_at = now() WHERE id = $1', [id]);
      throw err;
    }
  });
  app.post('/api/crm/notes/:id/files', express.raw({ type: () => true, limit: FILE_MAX }), async (req, res) => {
    const n = await getNote(req, v.int(req.params.id, 'nota', { min: 1 }));
    if (!canEditNote(req, n)) throw new HttpError(403, 'I file li aggiunge chi ha scritto la nota');
    const name = v.text(String(req.query.name || ''), 'nome del file', { max: 200, required: true });
    const type = String(req.query.type || 'application/octet-stream').slice(0, 200);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'File vuoto');
    const { rows: [f] } = await db.query('INSERT INTO crm_note_files (note_id, name, content_type, size, data, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, size',
      [n.id, name, type, req.body.length, req.body, req.user.id]);
    res.status(201).json(f);
  });
  app.get('/api/crm/note-files/:id', async (req, res) => {
    const { rows: [f] } = await db.query('SELECT note_id, name, data FROM crm_note_files WHERE id = $1', [v.int(req.params.id, 'file', { min: 1 })]);
    if (!f) throw new HttpError(404, 'File non trovato');
    await getNote(req, f.note_id);
    const name = safeFilename(f.name);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
    res.send(toBuffer(f.data));
  });
  app.delete('/api/crm/note-files/:id', async (req, res) => {
    const { rows: [f] } = await db.query('SELECT note_id, added_by FROM crm_note_files WHERE id = $1', [v.int(req.params.id, 'file', { min: 1 })]);
    if (!f) throw new HttpError(404, 'File non trovato');
    const n = await getNote(req, f.note_id);
    if (f.added_by !== req.user.id && !canEditNote(req, n)) throw new HttpError(403, 'Lo toglie chi l\'ha aggiunto');
    await db.query('DELETE FROM crm_note_files WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });

  // ── progetti di Alma Project ───────────────────────────────────────────────────────────
  app.get('/api/crm/:target/:id/projects', async (req, res) => {
    const { id, col } = await target(req);
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.color, p.status, p.owner_id, u.name AS owner_name, L.linked_by,
              (SELECT COUNT(*)::int FROM tickets t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tickets,
              (SELECT COUNT(*)::int FROM tickets t WHERE t.project_id = p.id) AS total_tickets,
              (SELECT MAX(t.due_date) FROM tickets t WHERE t.project_id = p.id) AS due_date
         FROM crm_project_links L JOIN projects p ON p.id = L.project_id LEFT JOIN users u ON u.id = p.owner_id
        WHERE L.${col} = $1 ORDER BY p.name`, [id]);
    res.json(rows);
  });
  app.post('/api/crm/:target/:id/projects', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    const projectId = v.int(req.body?.project_id, 'progetto', { min: 1 });
    const { rowCount } = await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    if (!rowCount) throw new HttpError(404, 'Progetto non trovato');
    await db.query(`INSERT INTO crm_project_links (project_id, ${col}, linked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [projectId, id, req.user.id]);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/crm/:target/:id/projects/:projectId', async (req, res) => {
    const { id, col } = await target(req, { write: true });
    await db.query(`DELETE FROM crm_project_links WHERE project_id = $1 AND ${col} = $2`, [v.int(req.params.projectId, 'progetto', { min: 1 }), id]);
    res.json({ ok: true });
  });

  // ── contatti proposti dagli incontri (indirizzo del dominio dell'azienda, non ancora nel CRM) ─────────────
  app.get('/api/crm/subjects/:id/proposals', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    const { rows } = await db.query(
      `SELECT p.id, p.email, p.name, p.meeting_id, m.subject AS meeting_subject, ${ts('m.start_at')} AS meeting_start
         FROM crm_contact_proposals p LEFT JOIN crm_meetings m ON m.id = p.meeting_id
        WHERE p.subject_id = $1 AND NOT p.dismissed AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE lower(c.email) = p.email)
        ORDER BY p.created_at DESC`, [id]);
    res.json(rows);
  });
  app.post('/api/crm/proposals/:id/dismiss', async (req, res) => {
    const { rows: [p] } = await db.query('SELECT subject_id FROM crm_contact_proposals WHERE id = $1', [v.int(req.params.id, 'proposta', { min: 1 })]);
    if (!p) throw new HttpError(404, 'Proposta non trovata');
    await subjectById(req, p.subject_id);
    await db.query('UPDATE crm_contact_proposals SET dismissed = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  });
}

module.exports = { registerCrmLinks };
