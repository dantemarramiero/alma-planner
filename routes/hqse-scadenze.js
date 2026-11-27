// HQSE fase 4 (ALM2-104, tavole 7, 8 e 21–24 approvate da Dante il 27/11/2026).
//   GET  /api/hqse/cantieri[/:id]                 cantieri aperti con il semaforo · chi può entrare oggi
//   POST /api/hqse/cantieri/:id/associa           fornitore, periodo, lavorazione e dipendenti; checklist di commessa
//   DELETE /api/hqse/cantieri/:id/fornitori/:sid  toglie il fornitore (e i suoi dipendenti) dal cantiere
//   GET  /api/hqse/rinnovi?giorni=30|60|90|scaduti documenti in scadenza con l'ultimo reminder
//   POST /api/hqse/documenti/:id/proroga          proroga (nome, ora, motivo) · POST /api/hqse/deroghe deroga di cantiere
//   GET|PUT /api/hqse/reminder · /registro · /prova · /esegui   impostazioni, registro, prova a sé, giro subito
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hqse');
const S = require('../lib/hqse-stato');
const P = require('../lib/hqse-portale');
const Z = require('../lib/hqse-scadenze');

const BASE = '/api/hqse';
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const iso = d => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

function registerHqseScadenze(app, { db, config, hqsePortale }) {
  const mailer = hqsePortale?.mailer;
  const baseUrl = config?.baseUrl || '';
  const event = (supplierId, text, actorId) => db.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [supplierId, text, actorId || null]);
  const scheduler = Z.createScheduler({ db, mailer, baseUrl });
  app.locals.hqseScheduler = scheduler; // avviato da server.js fuori dai test

  // ── cantieri (tavole 8 e 21) ──────────────────────────────────────────────────────────────────
  app.get(`${BASE}/cantieri`, async (_req, res) => {
    const today = todayRome();
    const { rows } = await db.query(`SELECT k.id, k.code, k.name, k.client, k.chief_email, (SELECT COUNT(DISTINCT l.supplier_id)::int FROM hqse_site_links l WHERE l.cantiere_id = k.id
        AND (l.date_to IS NULL OR l.date_to >= $1)) AS fornitori FROM cantieri k WHERE k.status = 'aperto' ORDER BY k.code`, [today]);
    const out = [];
    for (const k of rows) out.push({ ...k, counts: k.fornitori ? (await Z.siteStatus(db, k.id, today)).counts : null });
    res.json(out);
  });

  app.get(`${BASE}/cantieri/:id`, async (req, res) => {
    const s = await Z.siteStatus(db, Number(req.params.id), todayRome());
    if (!s) throw new HttpError(404, 'Cantiere non trovato');
    const { rows: waivers } = await db.query(`SELECT w.id, w.until, w.reason, w.authorized_by, t.name AS doc, c.name AS supplier FROM hqse_waivers w
       JOIN hqse_doc_types t ON t.id = w.doc_type_id JOIN hqse_suppliers q ON q.id = w.supplier_id JOIN crm_subjects c ON c.id = q.subject_id
       WHERE w.cantiere_id = $1 AND w.until >= $2 ORDER BY w.until`, [s.site.id, todayRome()]);
    const { rows: extra } = await db.query("SELECT code, name FROM hqse_checklists WHERE $1 = ANY(commesse) AND NOT archived", [s.site.code]);
    res.json({ ...s, waivers, checklists_commessa: extra });
  });

  // fornitori da associare (in qualifica) e i loro dipendenti
  app.get(`${BASE}/cantieri/:id/candidati`, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const { rows } = await db.query(`SELECT q.id, c.name, q.status FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id
       WHERE q.status NOT IN ('terminato') ${q ? 'AND c.name ILIKE $1' : ''} ORDER BY lower(c.name) LIMIT 30`, q ? [`%${q}%`] : []);
    res.json(rows);
  });
  app.get(`${BASE}/fornitori/:id/persone-cantiere`, async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await db.query(`SELECT w.id, trim(concat_ws(' ', c.first_name, c.last_name)) AS name, w.answers FROM hqse_workers w JOIN crm_contacts c ON c.id = w.contact_id
       WHERE w.supplier_id = $1 AND w.ended_on IS NULL ORDER BY lower(c.last_name)`, [id]);
    const st = (await S.computeStates(db, [id], todayRome()))[id];
    res.json(rows.map(w => {
      const docs = st.worker_docs[w.id] || [];
      const bad = docs.filter(d => d.blocking && !H.isOk(d.state));
      return { id: w.id, name: w.name, ok: !bad.length, problem: bad[0]?.name || null };
    }));
  });

  app.post(`${BASE}/cantieri/:id/associa`, async (req, res) => {
    const { rows: [site] } = await db.query("SELECT id, code, name FROM cantieri WHERE id = $1 AND status = 'aperto'", [Number(req.params.id)]);
    if (!site) throw new HttpError(404, 'Cantiere non trovato o chiuso');
    const sid = v.int(req.body.supplier_id, 'fornitore', { min: 1 });
    const { rows: [sup] } = await db.query('SELECT q.id, c.name FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.id = $1', [sid]);
    if (!sup) throw new HttpError(404, 'Fornitore non trovato');
    const from = v.date(req.body.date_from, 'dal') ?? null;
    const to = v.date(req.body.date_to, 'al') ?? null;
    if (from && to && to < from) throw new HttpError(400, 'La data di fine viene prima di quella di inizio');
    const lav = v.text(req.body.lavorazione, 'lavorazione', { max: 200 }) || '';
    const workers = (Array.isArray(req.body.worker_ids) ? req.body.worker_ids : []).map(Number).filter(Boolean);
    let added = [];
    await db.tx(async q => {
      await q.query(`INSERT INTO hqse_site_links (cantiere_id, supplier_id, worker_id, date_from, date_to, lavorazione, created_by) VALUES ($1, $2, NULL, $3, $4, $5, $6)
         ON CONFLICT (cantiere_id, supplier_id, COALESCE(worker_id, 0)) DO UPDATE SET date_from = EXCLUDED.date_from, date_to = EXCLUDED.date_to, lavorazione = EXCLUDED.lavorazione`,
      [site.id, sid, from, to, lav, req.user.id]);
      await q.query('DELETE FROM hqse_site_links WHERE cantiere_id = $1 AND supplier_id = $2 AND worker_id IS NOT NULL AND NOT (worker_id = ANY($3::int[]))', [site.id, sid, workers]);
      for (const w of workers) {
        const { rows: [ok] } = await q.query('SELECT 1 FROM hqse_workers WHERE id = $1 AND supplier_id = $2', [w, sid]);
        if (ok) await q.query(`INSERT INTO hqse_site_links (cantiere_id, supplier_id, worker_id, date_from, date_to, created_by) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (cantiere_id, supplier_id, COALESCE(worker_id, 0)) DO NOTHING`, [site.id, sid, w, from, to, req.user.id]);
      }
      // CL7 e le checklist della commessa di questo cantiere
      const { rows: cls } = await q.query(`SELECT id, name FROM hqse_checklists WHERE NOT archived AND kind = 'fornitore' AND (code = 'CL7' OR $1 = ANY(commesse))
           AND id NOT IN (SELECT checklist_id FROM hqse_assignments WHERE supplier_id = $2 AND worker_id IS NULL AND vehicle_id IS NULL)`, [site.code, sid]);
      await S.assign(q, { supplierId: sid, checklistIds: cls.map(c => c.id), origin: 'cantiere', userId: req.user.id });
      added = cls.map(c => c.name);
      await q.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [sid, `Associato al cantiere ${site.code}${workers.length ? ` con ${workers.length} ${workers.length === 1 ? 'dipendente' : 'dipendenti'}` : ''}${added.length ? `; aggiunte ${added.join(', ')}` : ''}`, req.user.id]);
    });
    if (mailer && added.length) {
      const { rows: rcpt } = await db.query('SELECT email FROM hqse_portal_users WHERE supplier_id = $1 AND active AND can_upload', [sid]);
      for (const r of rcpt) await mailer.send({ to: r.email, subject: `Cantiere ${site.code}: servono altri documenti`, html: P.emailHtml(baseUrl, { saluto: 'Buongiorno,', righe: [`${P.esc(sup.name)} lavorerà nel cantiere Almacis <b>${P.esc(site.code)} · ${P.esc(site.name)}</b>. Per entrare servono anche i documenti di: ${added.map(P.esc).join(', ')}.`], bottone: 'Carica i documenti', link: `${baseUrl}/fornitori` }) }).catch(() => {});
    }
    res.status(201).json({ ok: true, checklists_aggiunte: added });
  });

  app.delete(`${BASE}/cantieri/:id/fornitori/:sid`, async (req, res) => {
    const { rowCount } = await db.query('DELETE FROM hqse_site_links WHERE cantiere_id = $1 AND supplier_id = $2', [Number(req.params.id), Number(req.params.sid)]);
    if (rowCount) await event(Number(req.params.sid), `Tolto dal cantiere ${req.params.id}`, req.user.id);
    res.json({ ok: true });
  });

  // ── rinnovi (tavola 7) ────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/rinnovi`, async (req, res) => {
    const today = todayRome();
    const g = String(req.query.giorni || '30');
    const span = g === 'scaduti' ? 0 : Math.min(365, Math.max(1, Number(g) || 30));
    const { rows: sups } = await db.query(`SELECT q.id, c.name FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.status NOT IN ('sospeso', 'terminato')`);
    const st = await S.computeStates(db, sups.map(s => s.id), today);
    const { rows: wn } = await db.query("SELECT w.id, trim(concat_ws(' ', c.first_name, c.last_name)) AS name FROM hqse_workers w JOIN crm_contacts c ON c.id = w.contact_id");
    const wname = Object.fromEntries(wn.map(w => [w.id, w.name]));
    const { rows: last } = await db.query("SELECT DISTINCT ON (supplier_id) supplier_id, sent_at FROM hqse_reminders WHERE kind IN ('rinnovo', 'mancante') ORDER BY supplier_id, sent_at DESC");
    const lastBy = Object.fromEntries(last.map(r => [r.supplier_id, r.sent_at]));
    const rows = [];
    for (const s of sups) {
      const x = st[s.id];
      const items = [
        ...[...new Map(x.checklists.filter(c => !c.optional).flatMap(c => c.docs).map(d => [d.type_id, d])).values()].map(d => ({ ...d, who: s.name })),
        ...Object.entries(x.worker_docs).flatMap(([wid, docs]) => docs.map(d => ({ ...d, who: `${wname[wid] || 'dipendente'} · ${s.name}` }))),
      ];
      for (const d of items) {
        if (!d.until) continue;
        const left = Math.round((Date.parse(d.until) - Date.parse(today)) / 864e5);
        const inRange = g === 'scaduti' ? d.state === 'scaduto' : left >= 0 && left <= span;
        if (!inRange) continue;
        rows.push({ supplier_id: s.id, document_id: d.document_id, doc: d.name, who: d.who, until: d.until, left, state: d.state, renewal_pending: d.renewal_pending, blocking: d.blocking, last_reminder: lastBy[s.id] || null });
      }
    }
    rows.sort((a, b) => a.until.localeCompare(b.until));
    const settings = await Z.loadSettings(db);
    res.json({ rows, steps: settings.fornitore });
  });

  // ── proroga e deroga (tavola 22) ──────────────────────────────────────────────────────────────
  app.post(`${BASE}/documenti/:id/proroga`, async (req, res) => {
    const { rows: [d] } = await db.query(`SELECT d.*, t.name AS type_name, t.grace_days FROM hqse_documents d JOIN hqse_doc_types t ON t.id = d.doc_type_id WHERE d.id = $1`, [Number(req.params.id)]);
    if (!d || d.status !== 'approvato') throw new HttpError(400, 'Si proroga solo un documento approvato');
    const max = d.grace_days > 0 ? d.grace_days : 30;
    const giorni = v.int(req.body.giorni, 'giorni', { min: 1, max });
    if (!giorni) throw new HttpError(400, `Scegli quanti giorni (al massimo ${max})`);
    const reason = v.text(req.body.reason, 'motivo', { required: true, max: 1000 });
    const start = [iso(d.extended_to), iso(d.valid_to), todayRome()].filter(Boolean).sort().pop();
    const until = addDays(start, giorni);
    await db.query('UPDATE hqse_documents SET extended_to = $2, extended_by = $3, extended_at = now(), extended_reason = $4 WHERE id = $1', [d.id, until, req.user.id, reason]);
    await event(d.supplier_id, `Proroga di «${d.type_name}» fino al ${until.split('-').reverse().join('/')} (${reason})`, req.user.id);
    if (req.body.avvisa === true && mailer) {
      const { rows: rcpt } = await db.query('SELECT email FROM hqse_portal_users WHERE supplier_id = $1 AND active AND can_upload', [d.supplier_id]);
      for (const r of rcpt) await mailer.send({ to: r.email, subject: `Proroga: ${d.type_name}`, html: P.emailHtml(baseUrl, { saluto: 'Buongiorno,', righe: [`hai tempo fino al <b>${until.split('-').reverse().join('/')}</b> per caricare il documento nuovo: <b>${P.esc(d.type_name)}</b>.`], bottone: 'Carica il documento', link: `${baseUrl}/fornitori` }) }).catch(() => {});
    }
    res.json({ ok: true, extended_to: until });
  });

  app.post(`${BASE}/deroghe`, async (req, res) => {
    const b = req.body || {};
    const sid = v.int(b.supplier_id, 'fornitore', { min: 1 });
    const cid = v.int(b.cantiere_id, 'cantiere', { min: 1 });
    const tid = v.int(b.doc_type_id, 'documento', { min: 1 });
    const until = v.date(b.until, 'fino al');
    if (!sid || !cid || !tid || !until) throw new HttpError(400, 'Servono fornitore, cantiere, documento e data');
    if (until < todayRome() || until > addDays(todayRome(), 30)) throw new HttpError(400, 'La deroga vale al massimo 30 giorni');
    const reason = v.text(b.reason, 'motivo', { required: true, max: 1000 });
    const by = v.text(b.authorized_by, 'autorizzata da', { required: true, max: 200 });
    const { rows: [w] } = await db.query(`INSERT INTO hqse_waivers (supplier_id, worker_id, cantiere_id, doc_type_id, until, reason, authorized_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [sid, Number(b.worker_id) || null, cid, tid, until, reason, by, req.user.id]);
    const { rows: [names] } = await db.query('SELECT (SELECT name FROM hqse_doc_types WHERE id = $1) AS doc, (SELECT code FROM cantieri WHERE id = $2) AS code', [tid, cid]);
    await event(sid, `Deroga su ${names.code}: «${names.doc}» fino al ${until.split('-').reverse().join('/')}, autorizzata da ${by} (${reason})`, req.user.id);
    res.status(201).json({ id: w.id });
  });
  app.delete(`${BASE}/deroghe/:id`, async (req, res) => {
    await db.query('DELETE FROM hqse_waivers WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  });

  // ── impostazioni dei reminder (tavola 24) ─────────────────────────────────────────────────────
  app.get(`${BASE}/reminder`, async (_req, res) => res.json(await Z.loadSettings(db)));
  app.put(`${BASE}/reminder`, async (req, res) => {
    const b = req.body || {};
    const nums = (list, max) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= max))].sort((a, c) => c - a);
    const f = b.fornitore || {};
    const a = b.almacis || {};
    const s = {
      fornitore: {
        prima: nums(f.prima, 120), dopo_ogni: Math.min(30, Math.max(1, Number(f.dopo_ogni) || 7)),
        mai_caricati_dopo: Math.min(30, Math.max(1, Number(f.mai_caricati_dopo) || 3)), mai_caricati_ogni: Math.min(30, Math.max(1, Number(f.mai_caricati_ogni) || 7)),
        oggetto: v.text(f.oggetto, 'oggetto', { required: true, max: 200 }), testo: v.text(f.testo, 'testo', { required: true, max: 2000 }),
      },
      almacis: {
        hqse_giornaliero: a.hqse_giornaliero !== false, capocommessa_lunedi: a.capocommessa_lunedi !== false, bloccato_subito: a.bloccato_subito !== false,
        hqse_destinatari: (Array.isArray(a.hqse_destinatari) ? a.hqse_destinatari : []).map(x => String(x).trim().toLowerCase()).filter(P.validEmail).slice(0, 10),
      },
    };
    if (!s.fornitore.prima.length) throw new HttpError(400, 'Scegli almeno un giorno prima della scadenza');
    if (!s.fornitore.testo.includes('«elenco»')) throw new HttpError(400, 'Il testo deve contenere «elenco», dove Alma mette i documenti');
    await db.query(`INSERT INTO hqse_reminder_settings (id, settings, updated_by, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(s), req.user.id]);
    res.json(s);
  });
  app.get(`${BASE}/reminder/registro`, async (_req, res) => {
    const { rows } = await db.query(`SELECT r.kind, r.sent_to, r.subject, r.sent_at, c.name AS supplier FROM hqse_reminders r
       LEFT JOIN hqse_suppliers q ON q.id = r.supplier_id LEFT JOIN crm_subjects c ON c.id = q.subject_id ORDER BY r.sent_at DESC LIMIT 50`);
    res.json(rows);
  });
  app.post(`${BASE}/reminder/prova`, async (req, res) => {
    if (!mailer) throw new HttpError(500, 'Email non disponibili');
    const s = await Z.loadSettings(db);
    const elenco = '<ul style="margin:0 0 10px;padding-left:18px"><li><b>DURC</b> · scade il 21/12</li><li><b>Primo soccorso (Luca Esempio)</b> · scade il 16/12</li></ul>';
    const body = P.esc(s.fornitore.testo.replace('«nome»', 'Mario').replace('«numero»', '2').replace('«data»', '16/12').replace('«elenco»', '§§')).replace(/\n/g, '<br>').replace('§§', `</p>${elenco}<p style="margin:0 0 10px">`);
    const subject = `[Prova] ${s.fornitore.oggetto.replace('«numero»', '2').replace('«data»', '16/12')}`;
    await mailer.send({ to: req.user.email, subject, html: P.emailHtml(baseUrl, { righe: [body], bottone: 'Carica i documenti', link: `${baseUrl}/fornitori` }) });
    await db.query("INSERT INTO hqse_reminders (supplier_id, kind, sent_to, subject) VALUES (NULL, 'prova', $1, $2)", [req.user.email, subject]);
    res.json({ ok: true, to: req.user.email });
  });
  app.post(`${BASE}/reminder/esegui`, async (req, res) => {
    const out = await Z.runDaily(db, { mailer, baseUrl, today: todayRome(), weekday: Z.romeNow().weekday, force: req.body?.forza === true });
    res.json(out);
  });
}

module.exports = { registerHqseScadenze };
