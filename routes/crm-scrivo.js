// «Persone con cui mi scrivo» (ALM2-46, canvas CRM v10 · V10-Scrivo, via di Dante 19/11/2026).
// Ognuno vede solo le persone della sua casella. Si crea il contatto con le API del CRM (POST /api/crm/contacts,
// /api/crm/subjects/rapida) e si collegano le email già scambiate con POST /api/crm/contacts/:id/emails: qui solo
// lettura della posta, elenco, «Ignora» e proposta dalla firma.
const { HttpError } = require('../lib/http');
const { graph, graphAll } = require('../lib/graph');
const S = require('../lib/crm-scrivo');

const VIEWS = ['da_aggiungere', 'ignorate', 'crm'];
const EMAIL_RE = /^[^\s"@]+@[^\s"@]+\.[^\s"@]+$/;
const cleanEmail = x => { const e = String(x || '').trim().toLowerCase(); if (!EMAIL_RE.test(e) || e.length > 320) throw new HttpError(400, 'Email non valida'); return e; };

function registerCrmScrivo(app, { db, auth, radarFetch, mailFake }) {
  const aiKey = () => process.env.OPENAI_API_KEY || '';
  const fetchImpl = () => radarFetch || fetch;
  const running = new Map(); // userId → promessa della lettura in corso

  async function token(req) { return auth.graphToken(req.user.id); }

  app.get('/api/crm/scrivo', async (req, res) => {
    const view = VIEWS.includes(req.query.vista) ? req.query.vista : 'da_aggiungere';
    const months = [1, 3, 6, 12].includes(Number(req.query.mesi)) ? Number(req.query.mesi) : 12;
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const { rows: [scan] } = await db.query('SELECT scanned_at, messages, error FROM crm_mail_scans WHERE user_id = $1', [req.user.id]);
    const { rows } = await db.query(`
      SELECT p.email, p.name, p.received, p.sent, p.replied, p.last_at, p.ignored_at,
             (SELECT json_build_object('id', c.id, 'name', trim(concat_ws(' ', c.first_name, c.last_name)),
                     'subject', (SELECT s.name FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                                  WHERE l.contact_id = c.id AND l.date_to IS NULL ORDER BY l.is_primary DESC, l.id LIMIT 1))
                FROM crm_contacts c WHERE lower(c.email) = p.email ORDER BY c.id LIMIT 1) AS contact
        FROM crm_mail_people p
       WHERE p.user_id = $1 AND (p.received + p.sent) > 0 AND p.last_at >= now() - ($2 || ' months')::interval
       ORDER BY (p.received + p.sent) DESC, p.last_at DESC`, [req.user.id, String(months)]);
    const byDomain = await S.subjectsByDomain(db, rows.map(r => S.domainOf(r.email)));
    const all = rows.map(r => ({ ...r, company: S.companyOf(r.email, byDomain) }));
    const bucket = r => (r.contact ? 'crm' : r.ignored_at ? 'ignorate' : 'da_aggiungere');
    const counts = { da_aggiungere: 0, ignorate: 0, crm: 0 };
    for (const r of all) counts[bucket(r)]++;
    const match = r => !q || [r.email, r.name, r.company.name, r.company.domain, r.contact?.name, r.contact?.subject].some(x => String(x || '').toLowerCase().includes(q));
    let people = all.filter(r => bucket(r) === view && match(r));
    if (req.query.risposto === '1') people = people.filter(r => r.replied);
    res.json({ people: people.slice(0, 500), total: people.length, counts, months,
      scanned_at: scan?.scanned_at || null, messages: scan?.messages || 0, error: scan?.error || '', running: running.has(req.user.id) });
  });

  // «Aggiorna dalla posta»: legge la casella (può volerci qualche decina di secondi) e salva i conteggi.
  app.post('/api/crm/scrivo/aggiorna', async (req, res) => {
    const uid = req.user.id;
    if (!running.has(uid)) {
      const job = (async () => {
        const t = mailFake ? 'fake' : await token(req);
        const out = await S.readMailbox(t, { graphAll: mailFake ? mailFake.graphAll : graphAll, ownEmail: req.user.email });
        await S.saveScan(db, uid, out);
        return out;
      })();
      running.set(uid, job);
      job.catch(async err => {
        if (err.status === 401 || err.status === 503) return;
        await db.query(`INSERT INTO crm_mail_scans (user_id, error) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET error = EXCLUDED.error`, [uid, String(err.message).slice(0, 300)]).catch(() => {});
      }).finally(() => running.delete(uid));
    }
    try {
      const out = await running.get(uid);
      res.json({ ok: true, people: out ? out.people.length : 0, messages: out ? out.messages : 0 });
    } catch (err) {
      if (err.status === 403) throw new HttpError(403, 'Per leggere la posta serve il permesso di Microsoft: chiedi all\'amministratore di approvarlo');
      throw err;
    }
  });

  // «Ignora» / «Ripristina» (anche più indirizzi insieme)
  app.post('/api/crm/scrivo/ignora', async (req, res) => {
    const list = Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email];
    const emails = [...new Set(list.map(cleanEmail))].slice(0, 200);
    if (!emails.length) throw new HttpError(400, 'Scegli almeno una persona');
    const undo = Boolean(req.body?.ripristina);
    const { rowCount } = await db.query(`UPDATE crm_mail_people SET ignored_at = ${undo ? 'NULL' : 'now()'} WHERE user_id = $1 AND email = ANY($2::text[])`, [req.user.id, emails]);
    res.json({ updated: rowCount });
  });

  // Proposta per «Crea contatto»: firma dell'ultima email (regole, poi Alma se c'è) e azienda dal dominio.
  app.get('/api/crm/scrivo/proposta', async (req, res) => {
    const email = cleanEmail(req.query.email);
    const { rows: [p] } = await db.query('SELECT * FROM crm_mail_people WHERE user_id = $1 AND email = $2', [req.user.id, email]);
    const byDomain = await S.subjectsByDomain(db, [S.domainOf(email)]);
    const company = S.companyOf(email, byDomain);
    let last = null;
    try {
      const t = mailFake ? 'fake' : await token(req);
      const get = mailFake ? mailFake.graph : graph;
      // Outlook vuole il campo dell'ordinamento come primo filtro, altrimenti risponde «The restriction or sort order is
      // too complex for this operation» (Dante 21/11): la data va prima del mittente.
      const filter = `receivedDateTime ge 1900-01-01T00:00:00Z and from/emailAddress/address eq '${email.replace(/'/g, "''")}'`;
      const data = await get(t, 'GET', `/me/messages?$filter=${encodeURIComponent(filter)}&$select=subject,body,receivedDateTime&$top=1&$orderby=receivedDateTime desc`,
        { headers: { Prefer: 'outlook.body-content-type="text"' } });
      last = (data.value || [])[0] || null;
    } catch (err) {
      // se la posta non si legge, la proposta parte dall'intestazione (nome ed email): non deve fermare «Crea contatto»
      if (![401, 403, 404, 502, 503, 400].includes(err.status)) throw err;
      console.warn(`[scrivo] ultima email di ${email} non letta: ${err.message}`);
    }
    const text = last?.body?.content || '';
    let fields = S.fromSignature(text, { name: p?.name || '', email });
    let source = text ? 'firma' : 'intestazione';
    const key = aiKey();
    if (key && text) {
      try {
        const r = await fetchImpl()('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.OPENAI_BUSINESS_MODEL || 'gpt-4.1-mini', input: [
            { role: 'system', content: 'Leggi la firma in fondo a questa email italiana. Rispondi SOLO con JSON {"title":"Ing., Arch., Geom., Dott., Avv. oppure vuoto","first_name":"","last_name":"","job":"ruolo","mobile":"","phone":"","company":"ragione sociale","city":""}. Lascia vuoto ciò che non c\'è: non inventare.' },
            { role: 'user', content: `Intestazione: ${p?.name || ''} <${email}>\n\n${S.ownPart(text).slice(-2500)}` }] }),
        });
        const data = await r.json().catch(() => ({}));
        const raw = data.output_text || (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
        const m = String(raw).match(/\{[\s\S]*\}/);
        if (m) {
          const ai = JSON.parse(m[0]);
          const pick = k => String(ai?.[k] || '').trim().slice(0, k === 'company' ? 200 : 120);
          const merged = { ...fields };
          for (const k of ['title', 'first_name', 'last_name', 'job', 'mobile', 'phone', 'company', 'city']) if (pick(k)) merged[k] = pick(k);
          fields = merged;
          source = 'alma';
        }
      } catch { /* restano le regole */ }
    }
    if (company.kind === 'nuova' && fields.company) company.name = fields.company;
    res.json({ email, name: p?.name || '', received: p?.received || 0, sent: p?.sent || 0, fields, source,
      last: last ? { subject: last.subject || '', date: last.receivedDateTime } : null, company });
  });

  // Gli id Outlook delle email scambiate con un indirizzo (per collegarle alla scheda dopo la creazione)
  app.get('/api/crm/scrivo/messaggi', async (req, res) => {
    const email = cleanEmail(req.query.email);
    if (mailFake) return res.json({ ids: (await mailFake.messages(email)) || [] });
    const t = await token(req);
    const data = await graph(t, 'GET', `/me/messages?$search="${encodeURIComponent(`participants:${email}`)}"&$select=id,isDraft&$top=50`);
    res.json({ ids: (data.value || []).filter(m => !m.isDraft).map(m => m.id) });
  });

  // Aziende e contatti per la finestra Ctrl K (canvas V10-Barra): pochi risultati, leggeri, prima quelli che iniziano così.
  app.get('/api/crm/scrivo/cerca', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ subjects: [], contacts: [] });
    const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
    const start = `${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
    const [{ rows: subjects }, { rows: contacts }] = await Promise.all([
      db.query(`SELECT s.id, s.name, s.roles, s.city, s.asa,
                       (SELECT COUNT(*)::int FROM crm_email_links L WHERE L.subject_id = s.id) AS emails
                  FROM crm_subjects s WHERE s.merged_into IS NULL AND (s.name ILIKE $1 OR s.short_name ILIKE $1 OR s.vat ILIKE $1)
                 ORDER BY (s.name ILIKE $2) DESC, lower(s.name) LIMIT 6`, [like, start]),
      db.query(`SELECT c.id, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name, c.email,
                       (SELECT trim(concat_ws(' · ', NULLIF(l.job, ''), s.name)) FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                         WHERE l.contact_id = c.id AND l.date_to IS NULL ORDER BY l.is_primary DESC, l.id LIMIT 1) AS sub
                  FROM crm_contacts c
                 WHERE c.last_name ILIKE $1 OR c.first_name ILIKE $1 OR (c.first_name || ' ' || c.last_name) ILIKE $1 OR c.email ILIKE $1
                    OR EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = c.id AND l.date_to IS NULL AND s.name ILIKE $1)
                 ORDER BY (c.last_name ILIKE $2 OR c.first_name ILIKE $2) DESC, lower(c.last_name) LIMIT 6`, [like, start]),
    ]);
    // persone della mia posta non ancora nel CRM (riga «Email» → «Crea contatto»)
    const { rows: mail } = await db.query(`SELECT p.email, p.name, p.received + p.sent AS n FROM crm_mail_people p
       WHERE p.user_id = $1 AND p.ignored_at IS NULL AND (p.email ILIKE $2 OR p.name ILIKE $2)
         AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE lower(c.email) = p.email)
       ORDER BY p.received + p.sent DESC LIMIT 3`, [req.user.id, like]);
    res.json({ subjects, contacts, mail });
  });

  return { _running: () => running };
}

module.exports = { registerCrmScrivo };
