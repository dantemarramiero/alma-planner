// Alma Impianti (ALM2-73, canvas approvato da Dante il 24/11/2026): spazio della BU Impianti sopra il CRM comune.
// Stesse aziende, contatti, passi e segnali del CRM: qui solo le viste della BU e quello che il CRM non aveva
// (mandato dei fondi, dare/avere con i progettisti, email senza risposta, cadenze).
// Le API stanno sotto /api/crm, così valgono gli stessi accessi del CRM (req.crm).
const { HttpError, v } = require('../lib/http');
const { graphAll: realGraphAll } = require('../lib/graph');
const { getSetting, saveSetting } = require('../lib/settings');
const S = require('../lib/crm-scrivo');
const I = require('../lib/impianti');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const SETTINGS_KEY = 'impianti.settings';
const ignoredKey = uid => `impianti.ignora.${uid}`;
const CACHE_MS = 10 * 60 * 1000;

function registerImpianti(app, { db, auth, mailFake }) {
  const graphAll = mailFake ? mailFake.graphAll : realGraphAll;
  const cache = new Map(); // userId → { at, sent, inbox }

  async function settings() { return I.normalizeSettings(await getSetting(db, SETTINGS_KEY, {}) || {}); }

  // che tipo di cliente è (per le pillole): Fondo, Progettista, Energivoro, Ente, Cliente, Lead…
  const kindOf = s => (s.segment === I.SEGMENT_FUND ? 'Fondo' : (s.roles || []).includes('progettista') ? 'Progettista'
    : s.segment === I.SEGMENT_ENERGIVORA ? 'Energivoro' : s.kind === 'ente_pubblico' || s.kind === 'partecipata' ? 'Ente'
    : (s.roles || []).includes('cliente') ? 'Cliente' : (s.roles || []).includes('lead') ? 'Lead' : (s.roles || []).includes('partner') ? 'Partner' : 'Azienda');

  // ultimo contatto con ogni azienda: email collegate, incontri, passi fatti, posta di chiunque coi suoi contatti, scambi
  async function lastContacts(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`
      SELECT s.id, GREATEST(
        (SELECT MAX(e.sent_at) FROM crm_email_links l JOIN crm_emails e ON e.id = l.email_id
          WHERE l.subject_id = s.id OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = s.id)),
        (SELECT MAX(m.start_at)::timestamptz FROM crm_meeting_links l JOIN crm_meetings m ON m.id = l.meeting_id
          WHERE NOT l.removed AND m.start_at <= now() AND (l.subject_id = s.id OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = s.id))),
        (SELECT MAX(st.done_at) FROM crm_steps st WHERE st.subject_id = s.id),
        (SELECT MAX(p.last_at) FROM crm_mail_people p JOIN crm_contacts c ON lower(c.email) = p.email AND c.email <> ''
          JOIN crm_contact_links cl ON cl.contact_id = c.id WHERE cl.subject_id = s.id),
        (SELECT MAX(x.happened_on)::timestamptz FROM crm_exchanges x WHERE x.subject_id = s.id)) AS last_at
        FROM crm_subjects s WHERE s.id = ANY($1::int[])`, [ids]);
    return Object.fromEntries(rows.map(r => [r.id, r.last_at]));
  }
  // posta di chiunque coi contatti dell'azienda (crm_mail_people) e incontri: per lo stato del contatto
  async function mailStats(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`
      SELECT s.id,
        COALESCE((SELECT SUM(p.sent) FROM crm_mail_people p JOIN crm_contacts c ON lower(c.email) = p.email AND c.email <> ''
                   JOIN crm_contact_links cl ON cl.contact_id = c.id WHERE cl.subject_id = s.id), 0)::int AS sent,
        COALESCE((SELECT SUM(p.received) FROM crm_mail_people p JOIN crm_contacts c ON lower(c.email) = p.email AND c.email <> ''
                   JOIN crm_contact_links cl ON cl.contact_id = c.id WHERE cl.subject_id = s.id), 0)::int AS received,
        (SELECT COUNT(*) FROM crm_meeting_links l JOIN crm_meetings m ON m.id = l.meeting_id WHERE NOT l.removed AND m.start_at <= now()
          AND (l.subject_id = s.id OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = s.id)))::int AS meetings,
        (SELECT COUNT(*) FROM crm_email_links l WHERE l.subject_id = s.id OR l.contact_id IN (SELECT contact_id FROM crm_contact_links WHERE subject_id = s.id))::int AS emails
        FROM crm_subjects s WHERE s.id = ANY($1::int[])`, [ids]);
    return Object.fromEntries(rows.map(r => [r.id, r]));
  }
  // primo contatto (persona) dell'azienda, con recapiti
  async function mainContacts(ids) {
    if (!ids.length) return {};
    const { rows } = await db.query(`
      SELECT DISTINCT ON (l.subject_id) l.subject_id, c.id, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name, c.email, c.mobile, c.phone, l.job
        FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id
       WHERE l.subject_id = ANY($1::int[]) AND l.date_to IS NULL
       ORDER BY l.subject_id, l.is_primary DESC, l.id`, [ids]);
    return Object.fromEntries(rows.map(r => [r.subject_id, r]));
  }

  // ── posta: email inviate a persone del CRM senza risposta ─────────────────────────────────────
  async function readMail(req, { fresh = false } = {}) {
    const hit = cache.get(req.user.id);
    if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit;
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 19) + 'Z';
    const token = mailFake ? 'fake' : await auth.graphToken(req.user.id);
    const [sent, inbox] = await Promise.all([
      graphAll(token, `/me/mailFolders/sentitems/messages?$select=id,conversationId,toRecipients,subject,sentDateTime,webLink&$filter=sentDateTime ge ${since}&$orderby=sentDateTime desc&$top=200`, { max: 800 }),
      // tutte le cartelle: la risposta può essere stata spostata in una cartella
      graphAll(token, `/me/messages?$select=conversationId,from,receivedDateTime&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc&$top=500`, { max: 4000 }),
    ]);
    const out = { at: Date.now(), sent, inbox };
    cache.set(req.user.id, out);
    return out;
  }
  async function awaiting(req, cfg, { fresh = false } = {}) {
    let mail;
    try { mail = await readMail(req, { fresh }); } catch (err) { return { list: [], error: err.status === 401 || /token|consenso|accedi/i.test(err.message) ? 'Collega Microsoft 365 per vedere le email senza risposta.' : 'Non riesco a leggere la posta adesso.' }; }
    // contano solo i destinatari del CRM: contatto con quell'email o azienda con quel dominio
    const addresses = [...new Set(mail.sent.flatMap(m => (m.toRecipients || []).map(r => String(r?.emailAddress?.address || '').toLowerCase())).filter(Boolean))];
    const { rows: contacts } = addresses.length ? await db.query(`
      SELECT lower(c.email) AS email, c.id AS contact_id, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS name, c.mobile, c.phone,
             s.id AS subject_id, s.name AS subject_name, s.roles, s.segment, s.kind
        FROM crm_contacts c LEFT JOIN LATERAL (SELECT s.* FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
                                               WHERE l.contact_id = c.id AND l.date_to IS NULL AND s.merged_into IS NULL ORDER BY l.is_primary DESC, l.id LIMIT 1) s ON true
       WHERE lower(c.email) = ANY($1::text[])`, [addresses]) : { rows: [] };
    const byEmail = new Map(contacts.map(c => [c.email, c]));
    const byDomain = await S.subjectsByDomain(db, addresses.map(S.domainOf));
    const own = String(req.user.email || '').toLowerCase();
    const ownDomain = S.domainOf(own);
    const keep = a => S.domainOf(a) !== ownDomain && S.domainOf(a) !== 'almacis.it' && (byEmail.has(a) || byDomain.has(S.domainOf(a)));
    const ignored = (await getSetting(db, ignoredKey(req.user.id), [])) || [];
    const list = I.awaitingReplies(mail.sent, mail.inbox, { waitDays: cfg.wait_days, keep, ownEmail: own, ignored }).map(m => {
      const r = m.to[0];
      const c = byEmail.get(r.address);
      const d = byDomain.get(S.domainOf(r.address));
      const subject = c?.subject_id ? { id: c.subject_id, name: c.subject_name, roles: c.roles, segment: c.segment, kind: c.kind } : d ? { id: d.id, name: d.name, roles: d.roles } : null;
      return { ...m, mail_subject: m.subject, who: c?.name || r.name || r.address, email: r.address, phone: c?.mobile || c?.phone || '', contact_id: c?.contact_id || null, subject };
    });
    return { list, error: null };
  }

  // ── impostazioni ─────────────────────────────────────────────────────────────────────────────
  app.get('/api/crm/impianti/impostazioni', async (_req, res) => res.json({ settings: await settings(), sectors: I.SECTORS.map(({ key, label, color }) => ({ key, label, color })) }));
  app.put('/api/crm/impianti/impostazioni', async (req, res) => {
    if (!req.crm.admin) throw new HttpError(403, 'Le impostazioni di Alma Impianti le cambia la direzione');
    const next = I.normalizeSettings({ ...(await settings()), ...(req.body || {}) });
    await saveSetting(db, SETTINGS_KEY, next, req.user.id);
    res.json({ settings: next });
  });

  // ── Da fare: in attesa di risposta, da chiamare oggi, passi in ritardo, da risentire ─────────
  app.get('/api/crm/impianti/dafare', async (req, res) => {
    const cfg = await settings();
    const today = todayRome();
    const mine = req.query.miei === '1';
    const mail = await awaiting(req, cfg, { fresh: req.query.aggiorna === '1' });
    // passi aperti miei (o dove sono coinvolto)
    const { rows: steps } = await db.query(`
      SELECT st.id, st.title, st.channel, st.due_date::text AS due_date, st.subject_id, st.owner_id, st.note, st.draft, s.name AS subject_name, s.roles, s.segment, s.kind,
             COALESCE((SELECT json_agg(json_build_object('id', sp.user_id)) FROM crm_step_people sp WHERE sp.step_id = st.id AND sp.user_id <> st.owner_id), '[]') AS people,
             c.id AS contact_id, trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS contact_name, c.mobile, c.phone, c.email
        FROM crm_steps st JOIN crm_subjects s ON s.id = st.subject_id LEFT JOIN crm_contacts c ON c.id = st.contact_id
       WHERE st.done_at IS NULL AND st.due_date <= $2::date
         AND (st.owner_id = $1 OR EXISTS (SELECT 1 FROM crm_step_people sp WHERE sp.step_id = st.id AND sp.user_id = $1))
       ORDER BY st.due_date, st.id LIMIT 200`, [req.user.id, today]);
    const contacts = await mainContacts([...new Set(steps.filter(s => !s.contact_id).map(s => s.subject_id))]);
    const stepRow = (st, group) => {
      const c = st.contact_id ? { name: st.contact_name, mobile: st.mobile, phone: st.phone, email: st.email } : contacts[st.subject_id] || {};
      const late = group === 'ritardo' ? Math.round((new Date(today) - new Date(st.due_date)) / 864e5) : 0;
      return { group, step_id: st.id, subject_id: st.subject_id, who: c.name || st.subject_name, org: c.name ? st.subject_name : '', kind: kindOf(st),
        what: group === 'ritardo' ? `Passo scaduto da ${late} ${late === 1 ? 'giorno' : 'giorni'}: ${st.title}` : st.title,
        due_date: st.due_date, channel: st.channel, phone: c.mobile || c.phone || '', email: c.email || '',
        title: st.title, subject_name: st.subject_name, owner_id: st.owner_id, people: st.people, note: st.note, draft: st.draft, contact_id: st.contact_id };
    };
    // da risentire: fondi, progettisti e aziende con un'opportunità aperta della BU, oltre la cadenza
    const { rows: watch } = await db.query(`
      SELECT s.id, s.name, s.roles, s.segment, s.kind, s.owner_id,
             CASE WHEN s.segment = $1 OR EXISTS (SELECT 1 FROM crm_fund_mandates m WHERE m.subject_id = s.id) THEN 'fondo'
                  WHEN 'progettista' = ANY(s.roles) THEN 'progettista' ELSE 'opportunita' END AS cad
        FROM crm_subjects s
       WHERE s.merged_into IS NULL AND s.status = 'attivo'
         AND (s.segment = $1 OR EXISTS (SELECT 1 FROM crm_fund_mandates m WHERE m.subject_id = s.id AND 'impianti' = ANY(m.bus))
              OR ('progettista' = ANY(s.roles) AND ('impianti' = ANY(s.asa) OR EXISTS (SELECT 1 FROM crm_exchanges x WHERE x.subject_id = s.id)))
              OR EXISTS (SELECT 1 FROM crm_signals g WHERE g.subject_id = s.id AND g.bu = 'impianti' AND g.status = 'interessa'))
         ${mine ? 'AND s.owner_id = $2' : ''}
       LIMIT 500`, mine ? [I.SEGMENT_FUND, req.user.id] : [I.SEGMENT_FUND]);
    const last = await lastContacts(watch.map(w => w.id));
    const wc = await mainContacts(watch.map(w => w.id));
    const { rows: ex } = watch.length ? await db.query(`SELECT subject_id, COUNT(*) FILTER (WHERE direction = 'dato')::int AS dato, COUNT(*) FILTER (WHERE direction = 'ricevuto')::int AS ricevuto
      FROM crm_exchanges WHERE subject_id = ANY($1::int[]) GROUP BY subject_id`, [watch.map(w => w.id)]) : { rows: [] };
    const exOf = Object.fromEntries(ex.map(r => [r.subject_id, r]));
    const now = Date.now();
    const risentire = watch.map(w => {
      const lc = last[w.id];
      const days = lc ? Math.floor((now - new Date(lc)) / 864e5) : null;
      const cad = cfg.cadence[w.cad];
      if (days !== null && days <= cad) return null;
      const c = wc[w.id] || {};
      const e = exOf[w.id];
      const extra = w.cad === 'progettista' && e && e.ricevuto > e.dato ? ` Ci ha portato ${e.ricevuto} ${e.ricevuto === 1 ? 'lavoro' : 'lavori'}, noi ${e.dato || 'nessuno'}.` : '';
      return { group: 'risentire', subject_id: w.id, who: c.name || w.name, org: c.name ? w.name : '', kind: kindOf(w), days,
        what: `${days === null ? 'Mai sentito' : `Ultimo contatto ${days} giorni fa`} (ogni ${cad} giorni).${extra}`, phone: c.mobile || c.phone || '', email: c.email || '' };
    }).filter(Boolean).sort((a, b) => (b.days ?? 1e6) - (a.days ?? 1e6));
    const attesa = mail.list.map(m => ({ group: 'attesa', message_id: m.id, subject_id: m.subject?.id || null, who: m.who, org: m.subject?.name || '', kind: m.subject ? kindOf(m.subject) : 'Azienda',
      what: `Email inviata ${m.days} ${m.days === 1 ? 'giorno lavorativo' : 'giorni lavorativi'} fa: «${m.mail_subject}» — nessuna risposta.`,
      mail_subject: m.mail_subject, sent_at: m.sent_at, web_link: m.web_link, phone: m.phone, email: m.email, contact_id: m.contact_id }));
    const groups = {
      attesa,
      oggi: steps.filter(s => s.due_date === today).map(s => stepRow(s, 'oggi')),
      ritardo: steps.filter(s => s.due_date < today).map(s => stepRow(s, 'ritardo')),
      risentire,
    };
    // a che punto sei con i clienti della BU (aziende dell'ASA Impianti o seguite qui)
    const { rows: pool } = await db.query(`SELECT s.id FROM crm_subjects s WHERE s.merged_into IS NULL AND s.status = 'attivo'
      AND ('impianti' = ANY(s.asa) OR s.segment = $1 OR EXISTS (SELECT 1 FROM crm_fund_mandates m WHERE m.subject_id = s.id))
      ${mine ? 'AND s.owner_id = $2' : ''} LIMIT 3000`, mine ? [I.SEGMENT_FUND, req.user.id] : [I.SEGMENT_FUND]);
    const stats = await mailStats(pool.map(p => p.id));
    const waitingIds = new Set(mail.list.map(m => m.subject?.id).filter(Boolean));
    const funnel = Object.fromEntries(I.STATES.map(([k]) => [k, 0]));
    for (const p of pool) {
      const st = stats[p.id] || {};
      funnel[I.contactState({ sent: st.sent + (st.emails ? 1 : 0), received: st.received, meetings: st.meetings, awaiting: waitingIds.has(p.id) })]++;
    }
    res.json({ groups, funnel, states: I.STATES, settings: cfg, mail_error: mail.error });
  });
  // «Lascia stare»: l'email senza risposta non torna più
  app.post('/api/crm/impianti/dafare/ignora', async (req, res) => {
    const id = v.text(req.body?.message_id, 'email', { max: 500, required: true });
    const list = (await getSetting(db, ignoredKey(req.user.id), [])) || [];
    await saveSetting(db, ignoredKey(req.user.id), [...list.filter(x => x !== id), id].slice(-500), req.user.id);
    res.json({ ok: true });
  });

  // ── Fondi e investitori ─────────────────────────────────────────────────────────────────────
  const MANDATE = 'SELECT m.* FROM crm_fund_mandates m WHERE m.subject_id = $1';
  async function openSignals() {
    const { rows } = await db.query(`SELECT g.id, g.title, g.entity, g.sector, g.amount, g.region, g.stage, g.to_gare, g.status, g.subject_id, s.name AS subject_name
      FROM crm_signals g LEFT JOIN crm_subjects s ON s.id = g.subject_id
      WHERE g.bu = 'impianti' AND g.status IN ('nuovo', 'interessa') ORDER BY g.score DESC LIMIT 500`);
    return rows.map(g => ({ ...g, amount: g.amount != null ? Number(g.amount) : null, sector: g.sector || I.sectorOf(g.title), phase: I.phaseOfSignal(g) }));
  }
  const matchesOf = (m, signals) => signals.map(g => ({ g, fit: I.fundFits(m, g) })).filter(x => x.fit.ok).sort((a, b) => b.fit.score - a.fit.score || (b.g.status === 'interessa') - (a.g.status === 'interessa'));
  const mandateOut = m => (m ? { techs: m.techs, ticket_min: m.ticket_min != null ? Number(m.ticket_min) : null, ticket_max: m.ticket_max != null ? Number(m.ticket_max) : null,
    regions: m.regions, phases: m.phases, seeks_epc: m.seeks_epc, bus: m.bus, notes: m.notes, updated_at: m.updated_at } : null);

  app.get('/api/crm/impianti/fondi', async (req, res) => {
    const cfg = await settings();
    const { rows } = await db.query(`
      SELECT s.id, s.name, s.city, s.region, s.roles, s.segment, s.owner_id, u.name AS owner_name, row_to_json(m) AS mandate
        FROM crm_subjects s LEFT JOIN crm_fund_mandates m ON m.subject_id = s.id LEFT JOIN users u ON u.id = s.owner_id
       WHERE s.merged_into IS NULL AND (s.segment = $1 OR m.subject_id IS NOT NULL)
       ORDER BY lower(s.name) LIMIT 1000`, [I.SEGMENT_FUND]);
    const ids = rows.map(r => r.id);
    const [last, contacts, signals, { rows: next }] = await Promise.all([lastContacts(ids), mainContacts(ids), openSignals(),
      ids.length ? db.query(`SELECT DISTINCT ON (subject_id) subject_id, title, due_date::text AS due_date FROM crm_steps WHERE done_at IS NULL AND subject_id = ANY($1::int[]) ORDER BY subject_id, due_date`, [ids]) : { rows: [] }]);
    const nextOf = Object.fromEntries(next.map(r => [r.subject_id, r]));
    const now = Date.now();
    const funds = rows.map(r => {
      const m = r.mandate;
      const lc = last[r.id];
      const days = lc ? Math.floor((now - new Date(lc)) / 864e5) : null;
      return { id: r.id, name: r.name, city: r.city, region: r.region, roles: r.roles, owner_name: r.owner_name, contact: contacts[r.id] || null,
        mandate: mandateOut(m), matches: m ? matchesOf(m, signals).length : 0, last_contact: lc, days, late: days === null || days > cfg.cadence.fondo, next_step: nextOf[r.id] || null };
    });
    const totals = { all: funds.length, impianti: funds.filter(f => !f.mandate || f.mandate.bus.includes('impianti')).length, energy: funds.filter(f => f.mandate?.bus.includes('energy')).length,
      both: funds.filter(f => f.mandate?.bus.includes('energy') && f.mandate?.bus.includes('impianti')).length, with_mandate: funds.filter(f => f.mandate && (f.mandate.techs.length || f.mandate.ticket_min || f.mandate.ticket_max)).length,
      matches: funds.reduce((s, f) => s + f.matches, 0), late: funds.filter(f => f.days !== null && f.days > 60).length };
    res.json({ funds, totals, settings: cfg });
  });
  app.get('/api/crm/impianti/fondi/:id', async (req, res) => {
    const id = v.int(req.params.id, 'fondo', { min: 1 });
    const { rows: [s] } = await db.query('SELECT id, name, city, region, roles, segment, website, owner_id FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [id]);
    if (!s) throw new HttpError(404, 'Fondo non trovato');
    const { rows: [m] } = await db.query(MANDATE, [id]);
    const signals = await openSignals();
    const matches = m ? matchesOf(m, signals).slice(0, 12).map(({ g, fit }) => ({ id: g.id, title: g.title, entity: g.subject_name || g.entity, amount: g.amount, region: g.region,
      sector: g.sector, sector_label: I.sectorLabel(g.sector), status: g.status, score: fit.score, reasons: fit.reasons })) : [];
    const [contacts, last] = await Promise.all([mainContacts([id]), lastContacts([id])]);
    res.json({ fund: { ...s, contact: contacts[id] || null, last_contact: last[id] || null }, mandate: mandateOut(m), matches });
  });
  app.put('/api/crm/impianti/fondi/:id/mandato', async (req, res) => {
    const id = v.int(req.params.id, 'fondo', { min: 1 });
    const { rows: [s] } = await db.query('SELECT id FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [id]);
    if (!s) throw new HttpError(404, 'Fondo non trovato');
    const b = req.body || {};
    const list = (x, allowed) => (Array.isArray(x) ? [...new Set(x.map(String))].filter(k => !allowed || allowed.includes(k)) : []);
    const money = (x, f) => (x === null || x === undefined || x === '' ? null : (() => { const n = Number(x); if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${f} non valido`); return n; })());
    const m = { techs: list(b.techs, I.SECTOR_KEYS), ticket_min: money(b.ticket_min, 'Ticket minimo'), ticket_max: money(b.ticket_max, 'Ticket massimo'),
      regions: list(b.regions).map(r => r.slice(0, 60)).slice(0, 25), phases: list(b.phases, I.PHASES.map(p => p[0])), seeks_epc: b.seeks_epc !== false,
      bus: list(b.bus, ['impianti', 'energy']), notes: v.text(b.notes, 'note', { max: 2000 }) || '' };
    if (!m.bus.length) m.bus = ['impianti'];
    if (m.ticket_min != null && m.ticket_max != null && m.ticket_min > m.ticket_max) throw new HttpError(400, 'Il ticket minimo è più alto del massimo');
    await db.query(`INSERT INTO crm_fund_mandates (subject_id, techs, ticket_min, ticket_max, regions, phases, seeks_epc, bus, notes, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      ON CONFLICT (subject_id) DO UPDATE SET techs = EXCLUDED.techs, ticket_min = EXCLUDED.ticket_min, ticket_max = EXCLUDED.ticket_max, regions = EXCLUDED.regions,
        phases = EXCLUDED.phases, seeks_epc = EXCLUDED.seeks_epc, bus = EXCLUDED.bus, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [id, m.techs, m.ticket_min, m.ticket_max, m.regions, m.phases, m.seeks_epc, m.bus, m.notes, req.user.id]);
    // il tipo cliente diventa «Fondo o investitore» se non ne aveva uno
    await db.query(`UPDATE crm_subjects SET segment = $2, updated_at = now() WHERE id = $1 AND segment = ''`, [id, I.SEGMENT_FUND]);
    res.json({ mandate: m });
  });
  // nuovo fondo: lead con tipo «Fondo o investitore», ASA Impianti, responsabile chi lo crea, e il suo mandato
  app.post('/api/crm/impianti/fondi', async (req, res) => {
    const name = v.text(req.body?.name, 'nome', { max: 200, required: true });
    const { rows: [dup] } = await db.query('SELECT id, name FROM crm_subjects WHERE merged_into IS NULL AND lower(name) = lower($1) LIMIT 1', [name]);
    if (dup) {
      await db.query(`UPDATE crm_subjects SET segment = CASE WHEN segment = '' THEN $2 ELSE segment END, asa = CASE WHEN 'impianti' = ANY(asa) THEN asa ELSE array_append(asa, 'impianti') END, updated_at = now() WHERE id = $1`, [dup.id, I.SEGMENT_FUND]);
      return res.json({ id: dup.id, existing: true });
    }
    const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, kind, roles, asa, segment, owner_id, origin, created_by, city)
      VALUES ($1, 'impresa', '{lead}', '{impianti}', $2, $3, 'Alma Impianti', $3, $4) RETURNING id`, [name, I.SEGMENT_FUND, req.user.id, v.text(req.body?.city, 'città', { max: 120 }) || '']);
    await db.query('INSERT INTO crm_fund_mandates (subject_id, updated_by) VALUES ($1, $2) ON CONFLICT DO NOTHING', [s.id, req.user.id]);
    res.status(201).json({ id: s.id, existing: false });
  });

  // ── Progettisti: dare e avere ──────────────────────────────────────────────────────────────
  app.get('/api/crm/impianti/progettisti', async (req, res) => {
    const cfg = await settings();
    const { rows } = await db.query(`
      SELECT s.id, s.name, s.city, s.province, s.region, s.asa, u.name AS owner_name,
             COALESCE(x.dato, 0)::int AS dato, COALESCE(x.ricevuto, 0)::int AS ricevuto
        FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id
        LEFT JOIN (SELECT subject_id, COUNT(*) FILTER (WHERE direction = 'dato') AS dato, COUNT(*) FILTER (WHERE direction = 'ricevuto') AS ricevuto
                     FROM crm_exchanges GROUP BY subject_id) x ON x.subject_id = s.id
       WHERE s.merged_into IS NULL AND 'progettista' = ANY(s.roles)
       ORDER BY lower(s.name) LIMIT 1500`);
    const ids = rows.map(r => r.id);
    const [last, contacts] = await Promise.all([lastContacts(ids), mainContacts(ids)]);
    const now = new Date();
    const list = rows.map(r => {
      const state = I.exchangeState({ dato: r.dato, ricevuto: r.ricevuto, last_contact: last[r.id], cadence: cfg.cadence.progettista, now });
      return { ...r, last_contact: last[r.id] || null, contact: contacts[r.id] || null, state, state_label: I.EXCHANGE_STATES[state] };
    });
    const count = k => list.filter(x => x.state === k).length;
    res.json({ progettisti: list, totals: { da_ricambiare: count('da_ricambiare'), fermo: count('fermo'), da_conoscere: count('da_conoscere'), forte: count('forte'), all: list.length }, settings: cfg });
  });
  app.get('/api/crm/impianti/progettisti/:id/scambi', async (req, res) => {
    const id = v.int(req.params.id, 'progettista', { min: 1 });
    const { rows } = await db.query(`SELECT x.id, x.direction, x.title, x.note, x.signal_id, x.happened_on::text AS happened_on, u.name AS created_by_name
      FROM crm_exchanges x LEFT JOIN users u ON u.id = x.created_by WHERE x.subject_id = $1 ORDER BY x.happened_on DESC, x.id DESC`, [id]);
    res.json({ scambi: rows });
  });
  app.post('/api/crm/impianti/progettisti/:id/scambi', async (req, res) => {
    const id = v.int(req.params.id, 'progettista', { min: 1 });
    const { rows: [s] } = await db.query('SELECT id FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [id]);
    if (!s) throw new HttpError(404, 'Progettista non trovato');
    const b = req.body || {};
    const direction = v.oneOf(b.direction ?? '', 'verso', ['dato', 'ricevuto']);
    const title = v.text(b.title, 'cosa', { max: 300, required: true });
    const happened = b.happened_on ? v.date(b.happened_on, 'data') : todayRome();
    const signal = b.signal_id ? v.int(b.signal_id, 'segnale', { min: 1 }) : null;
    const { rows: [x] } = await db.query(`INSERT INTO crm_exchanges (subject_id, direction, title, signal_id, happened_on, note, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [id, direction, title, signal, happened, v.text(b.note, 'nota', { max: 2000 }) || '', req.user.id]);
    res.status(201).json({ id: x.id });
  });
  app.delete('/api/crm/impianti/scambi/:id', async (req, res) => {
    const id = v.int(req.params.id, 'scambio', { min: 1 });
    const { rows: [x] } = await db.query('SELECT created_by FROM crm_exchanges WHERE id = $1', [id]);
    if (!x) throw new HttpError(404, 'Scambio non trovato');
    if (x.created_by !== req.user.id && !req.crm.admin) throw new HttpError(403, 'Lo toglie chi l\'ha scritto o la direzione');
    await db.query('DELETE FROM crm_exchanges WHERE id = $1', [id]);
    res.json({ ok: true });
  });
}

module.exports = { registerImpianti };
