// Alma manda email ai contatti del CRM (17/11/2026, canvas «v7 · Alma: email ai clienti dal CRM»; Dante: strada A,
// «come Bacco»: dopo la conferma l'email parte da sola dalla casella Outlook di chi scrive, anche programmata).
//
// - La proposta «proponi_email» (lib/assistente-azioni.js) prepara la bozza; niente parte senza Conferma. Alla conferma
//   execute() chiama POST /api/alma/email con la sessione di chi conferma: qui nasce una riga per destinatario.
// - Destinatari solo dal CRM: si passa contact_id e l'indirizzo si rilegge dalla scheda (mai dal testo della chat).
// - Partenza: subito (la prima ora, le altre di un gruppo una al minuto) o all'ora programmata. Il giro tick() ogni
//   minuto manda le righe arrivate all'ora; una riga parte una volta sola (UPDATE condizionato «programmata» → «invio»).
// - Da /me/sendMail della casella di chi l'ha confermata, con la copia in «Posta inviata»; un'email per persona.
// - Dopo l'invio: nota «Email inviata» sulla scheda CRM (azienda, o il contatto se non ha azienda). Se non parte:
//   riga «errore» e avviso nella campanella di chi l'ha programmata.
// - Tono: GET /tono legge le ultime email mandate a quella persona (Posta inviata, Mail.Read) e ne restituisce solo
//   l'inizio e la fine (saluto, tu/lei, firma). Non si salvano; ad Alma arrivano come dati (lib/assistente-difesa.js).
// - Chi ricontattare: GET /da-ricontattare = aziende del CRM senza note, passi fatti, incontri o email da N giorni.
//
// API (/api/alma/email, ognuno vede e cambia solo le sue):
//   POST /                       { items: [{ contact_id, oggetto, testo }], send_at?, criterio? } → crea (e manda la prima se subito)
//   GET  /                       { programmate, recenti }
//   PATCH /:id                   { oggetto?, testo?, quando? } solo se ancora programmata
//   POST /:id/annulla · /:id/invia-ora · /annulla-gruppo { ids }
//   GET  /tono?contatti=1,2      tono delle email passate
//   GET  /da-ricontattare?ruolo&asa&giorni
const { graph } = require('./graph');
const { HttpError } = require('./http');

const MAX = 10;
const GAP_MS = 60 * 1000; // un gruppo parte una email al minuto
const MAX_AHEAD_DAYS = 120;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const htmlOf = text => `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#222">${esc(text).replace(/\r?\n/g, '<br>')}</div>`;
const plain = s => String(s || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// «AAAA-MM-GG HH:MM» in ora italiana → Date (UTC). null se il formato non va.
function romeOffsetMin(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - date.getTime()) / 60000);
}
function romeToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(guess - romeOffsetMin(new Date(guess)) * 60000);
}
const romeLabel = d => new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// Controllo di «quando» (proposta e PATCH): nel futuro (1 minuto di tolleranza) ed entro 120 giorni.
function whenOf(s) {
  if (s == null || String(s).trim() === '') return null;
  const d = romeToUtc(s);
  if (!d) throw new Error('«quando» deve essere AAAA-MM-GG HH:MM (ora italiana).');
  if (d.getTime() < Date.now() - 60 * 1000) throw new Error('L\'ora di invio è già passata.');
  if (d.getTime() > Date.now() + MAX_AHEAD_DAYS * 864e5) throw new Error(`Si può programmare al massimo ${MAX_AHEAD_DAYS} giorni avanti.`);
  return d;
}

function createAlmaEmail({ db, auth, notifier, crmAccess, mailer = null, reader = null }) {
  const sendMail = mailer || (async (userId, e) => {
    const token = await auth.graphToken(userId);
    await graph(token, 'POST', '/me/sendMail', { body: {
      message: { subject: e.subject, body: { contentType: 'HTML', content: htmlOf(e.body) }, toRecipients: [{ emailAddress: { address: e.to_email, name: e.to_name } }] },
      saveToSentItems: true } });
  });
  const readSent = reader || (async (userId, email) => {
    const token = await auth.graphToken(userId);
    const r = await graph(token, 'GET', `/me/mailFolders/sentitems/messages?$search=${encodeURIComponent(`"to:${email}"`)}&$top=3&$select=subject,sentDateTime,body`,
      { headers: { ConsistencyLevel: 'eventual', Prefer: 'outlook.body-content-type="text"' } });
    return (r.value || []).map(m => ({ data: m.sentDateTime, oggetto: m.subject, testo: m.body?.content || '' }));
  });

  const contactRow = id => db.query(`SELECT c.id, c.title, c.first_name, c.last_name, c.email,
      (SELECT l.subject_id FROM crm_contact_links l WHERE l.contact_id = c.id ORDER BY l.date_to IS NOT NULL, l.is_primary DESC, l.id LIMIT 1) AS subject_id
    FROM crm_contacts c WHERE c.id = $1`, [id]).then(r => r.rows[0]);
  const nameOf = c => [c.title, c.first_name, c.last_name].filter(Boolean).join(' ');

  // Manda una riga (se è ancora da mandare). Restituisce lo stato finale.
  async function sendOne(id) {
    const { rows: [e] } = await db.query("UPDATE assistant_emails SET status = 'invio' WHERE id = $1 AND status = 'programmata' RETURNING *", [id]);
    if (!e) return null;
    try {
      await sendMail(e.user_id, e);
    } catch (err) {
      const msg = String(err.message || err).slice(0, 300);
      await db.query("UPDATE assistant_emails SET status = 'errore', error = $2 WHERE id = $1", [id, msg]);
      console.warn(`[alma email] ${id} → ${e.to_email}: non partita (${msg})`);
      if (notifier) await notifier.notify({ userIds: [e.user_id], actorId: null, kind: 'crm', body: `l'email di Alma a ${e.to_name || e.to_email} («${e.subject}») non è partita: ${msg}`, link: '/alma/email' }).catch(() => {});
      return 'errore';
    }
    await db.query("UPDATE assistant_emails SET status = 'inviata', sent_at = now(), error = NULL WHERE id = $1", [id]);
    const col = e.subject_id ? 'subject_id' : e.contact_id ? 'contact_id' : null;
    if (col) {
      await db.query(`INSERT INTO crm_notes (${col}, kind, title, body, note_date, author_id) VALUES ($1, 'nota', $2, $3, CURRENT_DATE, $4)`,
        [e[col], `Email inviata: ${e.subject}`.slice(0, 200), `A ${e.to_name} <${e.to_email}>, mandata con Alma.\n\n${e.body.slice(0, 2000)}`, e.user_id]).catch(err => console.warn('[alma email] nota CRM non salvata:', err.message));
    }
    return 'inviata';
  }
  let running = false;
  async function tick(limit = 20) {
    if (running) return 0;
    running = true;
    try {
      const { rows } = await db.query("SELECT id FROM assistant_emails WHERE status = 'programmata' AND send_at <= now() ORDER BY send_at, id LIMIT $1", [limit]);
      for (const { id } of rows) await sendOne(id);
      return rows.length;
    } finally { running = false; }
  }
  let timer = null;
  const start = () => { if (!timer) { timer = setInterval(() => tick().catch(err => console.warn('[alma email] giro:', err.message)), 60 * 1000); timer.unref?.(); } };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  const view = e => ({ id: e.id, batch_id: e.batch_id, a: e.to_name, email: e.to_email, oggetto: e.subject, testo: e.body, stato: e.status, errore: e.error || undefined,
    quando: e.send_at, quando_label: romeLabel(e.send_at), inviata: e.sent_at, subject_id: e.subject_id, contact_id: e.contact_id, criterio: e.criterio || undefined });
  async function own(req) {
    const { rows: [e] } = await db.query('SELECT * FROM assistant_emails WHERE id = $1', [Number(req.params.id) || 0]);
    if (!e || e.user_id !== req.user.id) throw new HttpError(404, 'Email non trovata.');
    return e;
  }
  const crmOnly = async req => { if (crmAccess && !(await crmAccess.canUse(req))) throw new HttpError(403, 'Serve l\'accesso al CRM.'); };

  function register(app, base = '/api/alma/email') {
    app.post(base, async (req, res) => {
      await crmOnly(req);
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length || items.length > MAX) throw new HttpError(400, `Da 1 a ${MAX} email.`);
      let at = null;
      try { at = b.send_at ? new Date(b.send_at) : null; } catch { at = null; }
      if (at && (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + MAX_AHEAD_DAYS * 864e5)) throw new HttpError(400, 'Ora di invio non valida.');
      const rows = [];
      for (const it of items) {
        const c = await contactRow(Number(it.contact_id) || 0);
        if (!c) throw new HttpError(400, 'Un destinatario non c\'è più nel CRM.');
        if (!c.email) throw new HttpError(400, `${nameOf(c)} non ha l'email nel CRM.`);
        const subject = String(it.oggetto || '').trim().slice(0, 250), body = String(it.testo || '').trim().slice(0, 20000);
        if (!subject || !body) throw new HttpError(400, 'Ogni email ha bisogno di oggetto e testo.');
        rows.push({ c, subject, body });
      }
      const start0 = at && at.getTime() > Date.now() ? at.getTime() : Date.now();
      const ids = [];
      for (const [i, r] of rows.entries()) {
        const { rows: [e] } = await db.query(`INSERT INTO assistant_emails (user_id, action_id, batch_id, contact_id, subject_id, to_name, to_email, subject, body, criterio, send_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [req.user.id, Number(b.action_id) || null, ids[0] || null, r.c.id, r.c.subject_id || null,
          nameOf(r.c), r.c.email.toLowerCase(), r.subject, r.body, String(b.criterio || '').slice(0, 300), new Date(start0 + i * GAP_MS)]);
        ids.push(e.id);
      }
      await db.query('UPDATE assistant_emails SET batch_id = $1 WHERE id = ANY($2::int[])', [ids[0], ids]);
      let first = 'programmata', error = null;
      if (start0 <= Date.now()) {
        first = await sendOne(ids[0]);
        if (first === 'errore') error = (await db.query('SELECT error FROM assistant_emails WHERE id = $1', [ids[0]])).rows[0].error;
      }
      res.status(201).json({ ids, batch_id: ids[0], first, error, send_at: new Date(start0).toISOString(), send_label: romeLabel(start0), pending: first === 'programmata' ? ids.length : ids.length - 1 });
    });
    app.get(base, async (req, res) => {
      const { rows } = await db.query(`SELECT * FROM assistant_emails WHERE user_id = $1 AND (status IN ('programmata', 'invio') OR created_at > now() - interval '60 days')
        ORDER BY CASE WHEN status IN ('programmata', 'invio') THEN 0 ELSE 1 END, CASE WHEN status IN ('programmata', 'invio') THEN send_at END, COALESCE(sent_at, created_at) DESC LIMIT 100`, [req.user.id]);
      res.json({ programmate: rows.filter(e => ['programmata', 'invio'].includes(e.status)).map(view), recenti: rows.filter(e => !['programmata', 'invio'].includes(e.status)).map(view) });
    });
    app.patch(`${base}/:id`, async (req, res) => {
      const e = await own(req);
      if (e.status !== 'programmata') throw new HttpError(409, 'Si cambia solo un\'email non ancora partita.');
      const b = req.body || {};
      const sets = [], vals = [e.id];
      const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (b.oggetto !== undefined) { const v = String(b.oggetto).trim().slice(0, 250); if (!v) throw new HttpError(400, 'Serve l\'oggetto.'); set('subject', v); }
      if (b.testo !== undefined) { const v = String(b.testo).trim().slice(0, 20000); if (!v) throw new HttpError(400, 'Serve il testo.'); set('body', v); }
      if (b.quando !== undefined) { let d; try { d = whenOf(b.quando); } catch (err) { throw new HttpError(400, err.message); } set('send_at', d || new Date()); }
      if (!sets.length) throw new HttpError(400, 'Niente da cambiare.');
      const { rows: [r] } = await db.query(`UPDATE assistant_emails SET ${sets.join(', ')} WHERE id = $1 AND status = 'programmata' RETURNING *`, vals);
      if (!r) throw new HttpError(409, 'L\'email è appena partita.');
      res.json(view(r));
    });
    app.post(`${base}/:id/annulla`, async (req, res) => {
      const e = await own(req);
      const { rows: [r] } = await db.query("UPDATE assistant_emails SET status = 'annullata' WHERE id = $1 AND status = 'programmata' RETURNING *", [e.id]);
      if (!r) throw new HttpError(409, 'Questa email è già partita (o era già annullata).');
      res.json(view(r));
    });
    app.post(`${base}/:id/invia-ora`, async (req, res) => {
      const e = await own(req);
      if (e.status !== 'programmata') throw new HttpError(409, 'Questa email non è più da mandare.');
      await db.query('UPDATE assistant_emails SET send_at = now() WHERE id = $1', [e.id]);
      const st = await sendOne(e.id);
      const { rows: [r] } = await db.query('SELECT * FROM assistant_emails WHERE id = $1', [e.id]);
      if (st === 'errore') throw new HttpError(502, `Non è partita: ${r.error}`);
      res.json(view(r));
    });
    app.post(`${base}/annulla-gruppo`, async (req, res) => {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 50);
      const { rows } = await db.query("UPDATE assistant_emails SET status = 'annullata' WHERE id = ANY($1::int[]) AND user_id = $2 AND status = 'programmata' RETURNING id", [ids, req.user.id]);
      res.json({ cancelled: rows.length });
    });

    // Tono delle email passate a queste persone: solo inizio e fine di ognuna, mai salvate.
    app.get(`${base}/tono`, async (req, res) => {
      await crmOnly(req);
      const ids = String(req.query.contatti || '').split(',').map(Number).filter(Boolean).slice(0, MAX);
      const out = [];
      for (const id of ids) {
        const c = await contactRow(id);
        if (!c) continue;
        const base1 = { contatto_id: c.id, nome: nameOf(c), email: c.email || undefined };
        if (!c.email) { out.push({ ...base1, email_passate: 0, nota: 'Senza email nel CRM: non le si può scrivere.' }); continue; }
        try {
          const list = (await readSent(req.user.id, c.email)).slice(0, 3);
          out.push({ ...base1, email_passate: list.length, ultima: list[0] ? String(list[0].data || '').slice(0, 10) : undefined,
            esempi: list.map(m => { const t = plain(m.testo); return { oggetto: String(m.oggetto || '').slice(0, 120), inizio: t.slice(0, 160), fine: t.length > 160 ? t.slice(-200) : '' }; }),
            ...(list.length ? {} : { nota: 'Nessuna email passata: usa il «lei» e un saluto cordiale.' }) });
        } catch (err) {
          out.push({ ...base1, email_passate: 0, nota: err.code === 'ms_not_configured' ? 'Posta Microsoft non collegata: usa il «lei».' : 'La posta inviata non si legge adesso: usa il «lei».' });
        }
      }
      res.json({ contatti: out });
    });

    // Aziende del CRM da ricontattare: nessuna nota, passo fatto, incontro o email da almeno N giorni.
    app.get(`${base}/da-ricontattare`, async (req, res) => {
      await crmOnly(req);
      const days = Math.min(730, Math.max(7, Number(req.query.giorni) || 90));
      const role = ['lead', 'cliente', 'fornitore', 'partner'].includes(String(req.query.ruolo)) ? String(req.query.ruolo) : '';
      let asa = '';
      if (req.query.asa) {
        const q = String(req.query.asa).trim().toLowerCase();
        const { rows: [a] } = await db.query('SELECT key FROM crm_asa WHERE lower(key) = $1 OR lower(label) = $1 OR lower(boss_label) = $1 OR lower(label) LIKE $2 LIMIT 1', [q, `%${q}%`]);
        if (!a) throw new HttpError(400, `Non c'è nessuna ASA «${req.query.asa}».`);
        asa = a.key;
      }
      const { rows } = await db.query(`SELECT * FROM (
          SELECT s.id, s.name, s.roles, s.asa, u.name AS owner_name, GREATEST(
            (SELECT MAX(n.note_date)::timestamptz FROM crm_notes n WHERE n.subject_id = s.id AND n.deleted_at IS NULL),
            (SELECT MAX(st.done_at) FROM crm_steps st WHERE st.subject_id = s.id),
            (SELECT MAX(m.start_at)::timestamptz FROM crm_meeting_links ml JOIN crm_meetings m ON m.id = ml.meeting_id WHERE ml.subject_id = s.id AND NOT ml.removed),
            (SELECT MAX(e.sent_at) FROM crm_email_links el JOIN crm_emails e ON e.id = el.email_id WHERE el.subject_id = s.id),
            (SELECT MAX(a.sent_at) FROM assistant_emails a WHERE a.subject_id = s.id AND a.status = 'inviata')) AS last_touch,
            EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id WHERE l.subject_id = s.id AND l.date_to IS NULL AND COALESCE(c.email, '') <> '') AS has_mail
          FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id
          WHERE s.merged_into IS NULL AND ($1 = '' OR $1 = ANY(s.roles)) AND ($2 = '' OR $2 = ANY(s.asa))) x
        WHERE x.last_touch IS NULL OR x.last_touch < now() - make_interval(days => $3::int)
        ORDER BY x.has_mail DESC, x.last_touch NULLS FIRST, lower(x.name) LIMIT 40`, [role, asa, days]); // prima chi ha un contatto con email
      const ids = rows.map(r => r.id);
      const { rows: people } = ids.length ? await db.query(`SELECT l.subject_id, c.id, c.title, c.first_name, c.last_name, c.email, l.job FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
        WHERE l.subject_id = ANY($1::int[]) AND l.date_to IS NULL ORDER BY (c.email IS NULL OR c.email = ''), l.is_primary DESC, l.id`, [ids]) : { rows: [] };
      res.json({ giorni: days, ruolo: role || undefined, asa: asa || undefined, totale: rows.length, aziende: rows.map(r => {
        const mine = people.filter(p => p.subject_id === r.id);
        const best = mine.find(p => p.email);
        return { id: r.id, nome: r.name, ruoli: r.roles, owner: r.owner_name || undefined, ultimo_contatto: r.last_touch ? new Date(r.last_touch).toISOString().slice(0, 10) : 'mai',
          contatto: best ? { id: best.id, nome: nameOf(best), qualifica: best.job || undefined, email: best.email } : undefined,
          ...(best ? {} : { nota: mine.length ? 'i contatti non hanno email' : 'nessun contatto' }), link: `#/crm/scheda/${r.id}` };
      }) });
    });
  }

  return { register, tick, start, stop, sendOne };
}

module.exports = { createAlmaEmail, romeToUtc, romeLabel, whenOf, htmlOf, MAX };
