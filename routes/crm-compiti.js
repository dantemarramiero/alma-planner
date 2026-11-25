// Condividi e Persone da aggiungere nelle schede del CRM (ALM2-71, canvas CRM v18, via di Dante 23/11/2026).
// I compiti stanno in routes/crm-commerciale.js (sono i «prossimi passi», con più persone e le note).
//   GET  /api/crm/condividi/persone                       colleghi, con chi può aprire il CRM
//   POST /api/crm/:target(subjects|contacts)/:id/condividi { user_ids, message }  avviso con il link alla scheda
//   POST /api/crm/:target/:id/condivisioni/aperta          chi apre la scheda condivisa con lui (per la cronologia)
//   GET  /api/crm/subjects/:id/persone                     persone da aggiungere: mia posta, incontri, sito/LinkedIn/ANAC
//   POST /api/crm/subjects/:id/persone/cerca               Alma cerca su sito, LinkedIn e negli atti delle gare
//   POST /api/crm/persone-proposte/:id { status }          aggiunta | ignorata
const { HttpError, v } = require('../lib/http');
const S = require('../lib/crm-scrivo');
const P = require('../lib/crm-persone');

const TARGETS = { subjects: 'subject_id', contacts: 'contact_id' };

function registerCrmCompiti(app, { db, gov, notifier, subjectById, contactById, radarFetch }) {
  const apiKey = () => process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '');
  // chi può aprire il CRM: amministratori, oppure privacy CRM diversa da «Niente»; non sospeso
  const canSeeCrm = u => !u.suspended_at && (!gov || gov.isAdminEmail(u.email) || gov.levelsFor(u.email).crm !== 'none');

  app.get('/api/crm/condividi/persone', async (req, res) => {
    const { rows } = await db.query('SELECT id, name, email, suspended_at FROM users WHERE suspended_at IS NULL ORDER BY name');
    res.json(rows.filter(u => u.id !== req.user.id).map(u => ({ id: u.id, name: u.name, crm: canSeeCrm(u) })));
  });

  async function targetOf(req) {
    const col = TARGETS[req.params.target];
    if (!col) throw new HttpError(404, 'Scheda sconosciuta');
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (col === 'subject_id') {
      const s = await subjectById(req, id, { forWrite: true });
      return { col, id, name: s.name, link: `/crm/scheda/${id}` };
    }
    const c = await contactById(req, id);
    return { col, id, name: [c.title, c.first_name, c.last_name].filter(Boolean).join(' ') || c.email, link: `/crm/contatti/${id}` };
  }

  app.post('/api/crm/:target/:id/condividi', async (req, res) => {
    const t = await targetOf(req);
    const ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(x => v.int(x, 'Collega', { min: 1 })))].filter(x => x !== req.user.id).slice(0, 30);
    if (!ids.length) throw new HttpError(400, 'Scegli almeno un collega');
    const message = v.text(req.body?.message, 'Messaggio', { max: 1000 }) || '';
    const { rows: users } = await db.query('SELECT id, name, email, suspended_at FROM users WHERE id = ANY($1::int[])', [ids]);
    if (users.length !== ids.length) throw new HttpError(400, 'Collega non trovato');
    const blocked = users.filter(u => !canSeeCrm(u));
    if (blocked.length && !req.body?.anche_senza_crm) {
      throw Object.assign(new HttpError(409, `${blocked.map(u => u.name).join(', ')} non ${blocked.length === 1 ? 'vede' : 'vedono'} il CRM: ${blocked.length === 1 ? 'toglila' : 'toglile'} o chiedi alla direzione di dare il CRM`, 'senza_crm'), { extra: { blocked: blocked.map(u => u.id) } });
    }
    await db.query(`INSERT INTO crm_shares (${t.col}, kind, ref_id, from_user, to_user, message) SELECT $1, $5, $1, $2, unnest($3::int[]), $4`, [t.id, req.user.id, ids, message, req.params.target]); // schede aperte prima di ALM2-87
    res.status(201).json({ sent: ids.length });
    if (notifier) {
      notifier.notify({ userIds: ids, actorId: req.user.id, kind: 'crm', body: `ti ha condiviso ${t.name}${message ? `: «${message.slice(0, 160)}»` : ''}`, link: t.link })
        .catch(err => console.warn('[crm] avviso della condivisione non inviato', err.message));
    }
  });

  app.post('/api/crm/:target/:id/condivisioni/aperta', async (req, res) => {
    const col = TARGETS[req.params.target];
    if (!col) throw new HttpError(404, 'Scheda sconosciuta');
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query(`UPDATE crm_shares SET opened_at = now() WHERE ${col} = $1 AND to_user = $2 AND opened_at IS NULL`, [id, req.user.id]);
    res.json({ opened: rowCount });
  });

  // ── persone da aggiungere ─────────────────────────────────────────────────────────────────
  // domini dell'azienda: sito, email della scheda, email dei contatti (senza Gmail, PEC e simili)
  async function domainsOf(s) {
    const out = new Set();
    const host = String(s.website || '').toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split(/[/?#:]/)[0];
    if (host.includes('.')) out.add(host);
    if (s.email) out.add(S.domainOf(s.email));
    const { rows } = await db.query(`SELECT DISTINCT split_part(lower(c.email), '@', 2) AS d FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
                                      WHERE l.subject_id = $1 AND l.date_to IS NULL AND c.email LIKE '%@%'`, [s.id]);
    rows.forEach(r => out.add(r.d));
    return [...out].filter(d => d && !S.isPersonal(d));
  }
  async function tendersOf(s) {
    const cfs = [s.vat, s.tax_code].map(x => String(x || '').toUpperCase().replace(/^IT/, '').trim()).filter(Boolean);
    if (!cfs.length) return [];
    const { rows } = await db.query(`SELECT cig, object, awarded_on FROM crm_anac_awards WHERE sa_cf = ANY($1::text[])
                                      ORDER BY awarded_on DESC NULLS LAST LIMIT 6`, [cfs]).catch(() => ({ rows: [] }));
    return rows;
  }

  app.get('/api/crm/subjects/:id/persone', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id);
    const domains = await domainsOf(s);
    // la mia posta: chi mi ha scritto o a cui ho scritto, dal dominio dell'azienda, che non è un contatto e non ho ignorato
    const { rows: mail } = domains.length ? await db.query(
      `SELECT p.email, p.name, p.received, p.sent, p.last_at FROM crm_mail_people p
        WHERE p.user_id = $1 AND p.ignored_at IS NULL AND (p.received + p.sent) > 0
          AND split_part(p.email, '@', 2) = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE lower(c.email) = p.email)
        ORDER BY (p.received + p.sent) DESC, p.last_at DESC LIMIT 20`, [req.user.id, domains]) : { rows: [] };
    const posta = mail.filter(m => !S.isAuto(m.email));
    const { rows: incontri } = await db.query(
      `SELECT p.id, p.email, p.name, m.subject AS meeting_subject FROM crm_contact_proposals p LEFT JOIN crm_meetings m ON m.id = p.meeting_id
        WHERE p.subject_id = $1 AND NOT p.dismissed AND NOT EXISTS (SELECT 1 FROM crm_contacts c WHERE lower(c.email) = p.email)
        ORDER BY p.created_at DESC LIMIT 20`, [id]);
    const { rows: found } = await db.query(
      `SELECT g.id, g.source, g.name, g.job, g.email, g.linkedin, g.detail, g.url, g.created_at FROM crm_people_suggestions g
        WHERE g.subject_id = $1 AND g.status = 'nuova'
          AND NOT EXISTS (SELECT 1 FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
                           WHERE l.subject_id = g.subject_id AND lower(trim(concat_ws(' ', c.first_name, c.last_name))) = lower(g.name))
        ORDER BY CASE g.source WHEN 'anac' THEN 0 WHEN 'sito' THEN 1 ELSE 2 END, g.id`, [id]);
    const { rows: [last] } = await db.query('SELECT x.at, x.found, x.error, u.name AS user_name FROM crm_people_searches x LEFT JOIN users u ON u.id = x.user_id WHERE x.subject_id = $1', [id]);
    const tenders = await tendersOf(s);
    res.json({
      people: [
        ...posta.map(m => ({ source: 'posta', key: m.email, name: m.name && !m.name.includes('@') ? m.name : '', email: m.email, emails: m.received + m.sent, last_at: m.last_at })),
        ...incontri.map(p => ({ source: 'incontri', key: `i${p.id}`, id: p.id, name: p.name && !p.name.includes('@') ? p.name : '', email: p.email, detail: p.meeting_subject ? `dall'incontro «${p.meeting_subject}»` : 'da un incontro' })),
        ...found.map(g => ({ ...g, key: `g${g.id}` })),
      ],
      domains, last_search: last || null, tenders: tenders.length, can_search: Boolean(apiKey()),
    });
  });

  const searching = new Set();
  app.post('/api/crm/subjects/:id/persone/cerca', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id, { forWrite: true });
    if (!apiKey()) throw new HttpError(503, 'La ricerca su internet non è attiva: manca la chiave di OpenAI');
    if (searching.has(id)) throw new HttpError(409, 'Alma sta già cercando le persone di quest\'azienda');
    searching.add(id);
    try {
      const domains = await domainsOf(s);
      const tenders = await tendersOf(s);
      const { rows: k } = await db.query(
        `SELECT trim(concat_ws(' ', c.first_name, c.last_name)) AS n FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id WHERE l.subject_id = $1
          UNION SELECT name FROM crm_people_suggestions WHERE subject_id = $1`, [id]);
      const known = k.map(r => r.n).filter(Boolean);
      let out;
      try {
        out = await P.searchPeople({ apiKey: apiKey(), fetchImpl: radarFetch || fetch, tenders, known,
          subject: { name: s.name, city: s.city, website: s.website, domain: domains[0] || '' } });
      } catch (err) {
        await db.query(`INSERT INTO crm_people_searches (subject_id, user_id, error) VALUES ($1, $2, $3)
                         ON CONFLICT (subject_id) DO UPDATE SET at = now(), user_id = EXCLUDED.user_id, error = EXCLUDED.error`, [id, req.user.id, String(err.message).slice(0, 300)]);
        throw new HttpError(502, 'La ricerca non ha risposto: riprova fra poco');
      }
      let added = 0;
      for (const p of out.people) {
        const r = await db.query(`INSERT INTO crm_people_suggestions (subject_id, source, name, job, email, linkedin, detail, url, found_by)
                                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
        [id, p.source, p.name, p.job, p.email, p.linkedin, p.detail, p.url, req.user.id]);
        added += r.rowCount;
      }
      await db.query(`INSERT INTO crm_people_searches (subject_id, user_id, found, cost_eur, error) VALUES ($1, $2, $3, $4, '')
                       ON CONFLICT (subject_id) DO UPDATE SET at = now(), user_id = EXCLUDED.user_id, found = EXCLUDED.found, cost_eur = EXCLUDED.cost_eur, error = ''`,
      [id, req.user.id, added, out.costEur]);
      res.json({ found: out.people.length, added, cost_eur: out.costEur });
    } finally { searching.delete(id); }
  });

  app.post('/api/crm/persone-proposte/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const status = v.oneOf(req.body?.status, 'Stato', ['aggiunta', 'ignorata']);
    const { rows: [g] } = await db.query('SELECT subject_id FROM crm_people_suggestions WHERE id = $1', [id]);
    if (!g) throw new HttpError(404, 'Proposta non trovata');
    await subjectById(req, g.subject_id);
    await db.query('UPDATE crm_people_suggestions SET status = $2, decided_by = $3 WHERE id = $1', [id, status, req.user.id]);
    res.json({ ok: true });
  });
}

module.exports = { registerCrmCompiti };
