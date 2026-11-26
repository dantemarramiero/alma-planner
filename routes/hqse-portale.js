// HQSE fase 2 (ALM2-101, tavole 1, 3, 4, 10–15 approvate da Dante): il fornitore si registra dal widget su almacis.it e
// lavora nel suo portale, senza login di Microsoft e senza password.
//   /fornitori                      pagina del portale (orbita/portale.html): accesso o portale
//   /fornitori/widget.js            widget da incollare sul sito; /fornitori/widget/config i suoi testi (CORS)
//   /fornitori/registrazione        registrazione dal widget (CORS, limite per IP, campo esca contro i robot)
//   /fornitori/l/:token             link dell'email → sessione di 30 giorni
//   /fornitori/api/codice|accedi|esci   codice di 6 cifre via email quando la sessione è scaduta
//   /fornitori/api/*                il portale (sessione del fornitore): stato, questionario, dipendenti, mezzi, cantieri,
//                                   azienda, colleghi, documenti
// I fornitori restano aziende del CRM centrale e i dipendenti persone del CRM.
const path = require('path');
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { rateLimit } = require('../lib/security');
const H = require('../lib/hqse');
const S = require('../lib/hqse-stato');
const P = require('../lib/hqse-portale');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const MAX_FILE = 8 * 1024 * 1024;
const ACCEPT = /^(application\/pdf|image\/(png|jpeg|webp|heic)|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;

function registerHqsePortale(app, { db, auth, config, hqseMailer }) {
  const mailer = hqseMailer || P.createMailer({ db, auth });
  app.locals.hqseMailer = mailer; // nei test: le email mandate (outbox)
  const baseUrl = config.baseUrl || '';
  const secure = baseUrl.startsWith('https://');
  const router = express.Router();
  const publicLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: config.production ? 10 : 200, key: rq => rq.ip, message: 'Troppe richieste da questa rete: riprova tra qualche minuto.' });

  // ── pezzi comuni ───────────────────────────────────────────────────────────────────────────────
  const readCookie = req => {
    const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${P.COOKIE}=`));
    return m ? decodeURIComponent(m.slice(P.COOKIE.length + 1)) : '';
  };
  const setCookie = (res, value, days) => res.append('Set-Cookie', [`${P.COOKIE}=${encodeURIComponent(value)}`, 'Path=/fornitori', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(days * 86400)}`, secure ? 'Secure' : ''].filter(Boolean).join('; '));
  const event = (supplierId, text) => db.query('INSERT INTO hqse_events (supplier_id, text) VALUES ($1, $2)', [supplierId, text]);
  async function startSession(res, portalUserId) {
    const token = P.newToken();
    await db.query(`INSERT INTO hqse_portal_sessions (hash, portal_user_id, expires_at) VALUES ($1, $2, now() + interval '${P.SESSION_DAYS} days')`, [P.sha(token), portalUserId]);
    await db.query('UPDATE hqse_portal_users SET last_login = now() WHERE id = $1', [portalUserId]);
    setCookie(res, token, P.SESSION_DAYS);
  }
  async function sendLink(pu, { subject, saluto, righe }) {
    const token = P.newToken();
    await db.query(`INSERT INTO hqse_portal_tokens (portal_user_id, kind, hash, expires_at) VALUES ($1, 'link', $2, now() + interval '${P.LINK_DAYS} days')`, [pu.id, P.sha(token)]);
    const link = `${baseUrl}/fornitori/l/${token}`;
    await mailer.send({ to: pu.email, subject, text: link, html: P.emailHtml(baseUrl, { saluto, righe, bottone: 'Entra nel portale', link, nota: `Il link vale ${P.LINK_DAYS} giorni. Non serve una password: quando scade, chiedi un codice dal portale.` }) });
    return link;
  }
  const welcome = (pu, supplierName, tipoLabel) => sendLink(pu, {
    subject: 'Benvenuto tra i fornitori Almacis: ecco il tuo accesso',
    saluto: pu.name ? `Buongiorno ${pu.name.split(' ')[0]},` : 'Buongiorno,',
    righe: [`grazie per aver registrato <b>${P.esc(supplierName)}</b>. Per completare la qualifica${tipoLabel ? ` come «${P.esc(tipoLabel)}»` : ''} entra nel portale e carica i documenti richiesti.`],
  });

  // ── pagina del portale e widget ────────────────────────────────────────────────────────────────
  router.get('/', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, '..', 'orbita', 'portale.html')));
  router.get('/widget.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, '..', 'orbita', 'js', 'hqse-widget.js')));

  function cors(req, res, next) {
    const origin = req.get('Origin');
    if (origin && P.originAllowed(origin)) {
      res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin').set('Access-Control-Allow-Headers', 'Content-Type').set('Access-Control-Allow-Methods', 'GET, POST');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && P.originAllowed(origin) ? 204 : 403);
    next();
  }
  async function widgetRow() {
    const { rows: [r] } = await db.query('SELECT settings FROM hqse_widget WHERE id = 1');
    return P.widgetSettings(r?.settings);
  }
  router.get('/widget/config', cors, async (_req, res) => {
    const w = await widgetRow();
    res.json({ titolo: w.titolo, testo: w.testo, grazie: w.grazie, privacy_url: w.privacy_url, portale: `${baseUrl}/fornitori`,
      tipi: H.catalogo.TIPI_APPALTO.filter(t => w.tipi.includes(t.key)).map(t => ({ key: t.key, label: t.label, hint: t.hint })) });
  });
  router.options('/registrazione', cors);
  router.post('/registrazione', cors, publicLimit, express.json({ limit: '32kb' }), async (req, res) => {
    const b = req.body || {};
    const w = await widgetRow();
    if (b.sito) return res.json({ ok: true, messaggio: w.grazie }); // campo esca: lo compilano solo i robot
    const name = v.text(b.ragione_sociale, 'ragione sociale', { required: true, max: 200 });
    const vat = P.vatOf(b.piva);
    if (!P.validVat(vat)) throw new HttpError(400, 'La partita IVA deve avere 11 cifre');
    const email = P.cleanEmail(b.email);
    if (!P.validEmail(email)) throw new HttpError(400, 'Scrivi un indirizzo email valido');
    const referente = v.text(b.referente, 'referente', { required: true, max: 120 });
    const tipo = H.TIPI[b.tipo] && w.tipi.includes(b.tipo) ? b.tipo : null;
    if (!tipo) throw new HttpError(400, 'Scegli il tipo di appalto');
    if (b.privacy !== true) throw new HttpError(400, 'Serve il consenso al trattamento dei dati');

    const { rows: [found] } = await db.query(`SELECT q.id, c.name FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id
       WHERE regexp_replace(c.vat, '\\D', '', 'g') = $1 AND c.merged_into IS NULL`, [vat]);
    if (found) { // già registrata: il link parte solo se l'email è di una persona del portale (non si dice chi è fornitore)
      const { rows: [pu] } = await db.query('SELECT * FROM hqse_portal_users WHERE supplier_id = $1 AND email = $2 AND active', [found.id, email]);
      if (pu) await sendLink(pu, { subject: 'Il tuo accesso al portale fornitori Almacis', saluto: 'Buongiorno,', righe: ['ecco il link per entrare nel portale fornitori di Almacis.'] });
      return res.json({ ok: true, gia: true, messaggio: 'Questa partita IVA è già registrata: se l\'email è tra quelle dell\'azienda ti abbiamo mandato il link per entrare.' });
    }
    const supplier = await db.tx(async q => {
      let { rows: [subj] } = await q.query("SELECT id, name FROM crm_subjects WHERE regexp_replace(vat, '\\D', '', 'g') = $1 AND merged_into IS NULL", [vat]);
      if (subj) await q.query(`UPDATE crm_subjects SET roles = array_append(roles, 'fornitore') WHERE id = $1 AND NOT ('fornitore' = ANY(roles))`, [subj.id]);
      else ({ rows: [subj] } = await q.query("INSERT INTO crm_subjects (name, vat, email, phone, roles) VALUES ($1, $2, $3, $4, '{fornitore}') RETURNING id, name", [name, vat, email, v.text(b.telefono, 'telefono', { max: 40 }) || '']));
      const { rows: [s] } = await q.query("INSERT INTO hqse_suppliers (subject_id, tipo_appalto, status) VALUES ($1, $2, 'registrato') RETURNING id", [subj.id, tipo]);
      const { rows: [pu] } = await q.query("INSERT INTO hqse_portal_users (supplier_id, email, name, role, invited_by) VALUES ($1, $2, $3, 'referente', 'sito') RETURNING *", [s.id, email, referente]);
      await q.query('INSERT INTO hqse_events (supplier_id, text) VALUES ($1, $2)', [s.id, `Registrato dal sito da ${referente} (${email}) come «${H.TIPI[tipo].label}»`]);
      return { id: s.id, name: subj.name, pu };
    });
    await welcome(supplier.pu, supplier.name, H.TIPI[tipo].label);
    if (w.avvisa && P.validEmail(w.avvisa)) {
      mailer.send({ to: w.avvisa, subject: `Nuovo fornitore registrato: ${supplier.name}`, html: P.emailHtml(baseUrl, { righe: [`<b>${P.esc(supplier.name)}</b> (P.IVA ${vat}) si è registrato dal sito come «${H.TIPI[tipo].label}».`], bottone: 'Apri in Alma Space', link: `${baseUrl}/app#/hqse/fornitore/${supplier.id}` }) }).catch(e => console.warn('[hqse] avviso registrazione:', e.message));
    }
    res.status(201).json({ ok: true, messaggio: w.grazie });
  });

  // ── accesso ───────────────────────────────────────────────────────────────────────────────────
  router.get('/l/:token', async (req, res) => {
    const { rows: [t] } = await db.query(`UPDATE hqse_portal_tokens SET used_at = now() WHERE hash = $1 AND kind = 'link' AND used_at IS NULL AND expires_at > now()
       RETURNING portal_user_id`, [P.sha(req.params.token)]);
    const { rows: [pu] } = t ? await db.query('SELECT id FROM hqse_portal_users WHERE id = $1 AND active', [t.portal_user_id]) : { rows: [] };
    if (!pu) return res.redirect('/fornitori?link=scaduto');
    await startSession(res, pu.id);
    res.redirect('/fornitori');
  });
  router.use('/api', express.json({ limit: '12mb' }));
  router.use('/api', (req, _res, next) => next(['GET', 'HEAD'].includes(req.method) || req.get('X-Portale') === '1' ? undefined : new HttpError(403, 'Richiesta non valida')));
  router.post('/api/codice', publicLimit, async (req, res) => {
    const email = P.cleanEmail(req.body?.email);
    if (!P.validEmail(email)) throw new HttpError(400, 'Scrivi un indirizzo email valido');
    const { rows: users } = await db.query('SELECT id FROM hqse_portal_users WHERE email = $1 AND active', [email]);
    if (users.length) {
      const code = P.newCode();
      for (const u of users) {
        await db.query(`INSERT INTO hqse_portal_tokens (portal_user_id, kind, hash, expires_at) VALUES ($1, 'codice', $2, now() + interval '${P.CODE_MINUTES} minutes')`, [u.id, P.sha(`${email}:${code}`)]);
      }
      await mailer.send({ to: email, subject: `${code} è il tuo codice per il portale fornitori Almacis`, text: code,
        html: P.emailHtml(baseUrl, { saluto: 'Buongiorno,', righe: [`il tuo codice per entrare nel portale fornitori di Almacis è <b style="font-size:22px;letter-spacing:4px">${code}</b>.`], nota: `Vale ${P.CODE_MINUTES} minuti. Se non l'hai chiesto tu, ignora questa email.` }) });
    }
    res.json({ ok: true }); // sempre la stessa risposta: non si dice quali email sono di un fornitore
  });
  router.post('/api/accedi', publicLimit, async (req, res) => {
    const email = P.cleanEmail(req.body?.email);
    const code = String(req.body?.codice || '').replace(/\D/g, '');
    if (!P.validEmail(email) || code.length !== 6) throw new HttpError(400, 'Scrivi le 6 cifre del codice');
    const { rows: open } = await db.query(`SELECT t.id, t.hash, t.attempts, t.portal_user_id FROM hqse_portal_tokens t JOIN hqse_portal_users u ON u.id = t.portal_user_id
       WHERE u.email = $1 AND u.active AND t.kind = 'codice' AND t.used_at IS NULL AND t.expires_at > now() ORDER BY t.created_at DESC`, [email]);
    const hit = open.find(t => t.hash === P.sha(`${email}:${code}`) && t.attempts < P.CODE_ATTEMPTS);
    if (!hit) {
      if (open.length) await db.query('UPDATE hqse_portal_tokens SET attempts = attempts + 1 WHERE id = ANY($1::int[])', [open.map(t => t.id)]);
      throw new HttpError(400, 'Codice sbagliato o scaduto: chiedine uno nuovo');
    }
    await db.query('UPDATE hqse_portal_tokens SET used_at = now() WHERE id = ANY($1::int[])', [open.map(t => t.id)]);
    await startSession(res, hit.portal_user_id);
    res.json({ ok: true });
  });
  router.post('/api/esci', async (req, res) => {
    const token = readCookie(req);
    if (token) await db.query('DELETE FROM hqse_portal_sessions WHERE hash = $1', [P.sha(token)]);
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  // da qui in poi serve la sessione del fornitore
  router.use('/api', async (req, _res, next) => {
    const token = readCookie(req);
    const { rows: [s] } = token ? await db.query(`SELECT u.id, u.supplier_id, u.email, u.name, u.role, u.can_upload FROM hqse_portal_sessions x
       JOIN hqse_portal_users u ON u.id = x.portal_user_id AND u.active JOIN hqse_suppliers q ON q.id = u.supplier_id AND q.status <> 'terminato'
       WHERE x.hash = $1 AND x.expires_at > now()`, [P.sha(token)]) : { rows: [] };
    if (!s) return next(new HttpError(401, 'Accesso scaduto: chiedi un codice', 'login'));
    req.portal = s;
    next();
  });
  const sid = req => req.portal.supplier_id;
  const needUpload = req => { if (!req.portal.can_upload) throw new HttpError(403, 'Il tuo accesso è solo in lettura: chiedi al referente'); };
  const needReferente = req => { if (req.portal.role !== 'referente') throw new HttpError(403, 'Solo il referente dell\'azienda può farlo'); };

  async function supplierInfo(id) {
    const { rows: [s] } = await db.query(`SELECT q.id, q.tipo_appalto, q.status, q.whitelist, q.ccnl, q.medico, q.questionario_at, c.name, c.vat, c.pec, c.phone, c.address, c.city, c.province
       FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.id = $1`, [id]);
    return s;
  }

  router.get('/api/stato', async (req, res) => {
    const s = await supplierInfo(sid(req));
    const st = (await S.computeStates(db, [s.id], todayRome()))[s.id];
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM hqse_workers WHERE supplier_id = $1 AND ended_on IS NULL', [s.id]);
    const workersMissing = Object.entries(st.worker_docs).filter(([, docs]) => docs.some(d => !H.isOk(d.state) && d.state !== 'in_verifica')).length;
    res.json({
      me: { name: req.portal.name, email: req.portal.email, role: req.portal.role, can_upload: req.portal.can_upload },
      supplier: { ...s, tipo_label: H.TIPI[s.tipo_appalto]?.label },
      tipi: H.catalogo.TIPI_APPALTO.map(t => ({ key: t.key, label: t.label, hint: t.hint })),
      checklists: st.checklists, docs: st.docs, workers: { total: n, missing: workersMissing },
    });
  });

  // anteprima del questionario: quanti documenti con quel tipo di appalto
  router.get('/api/questionario/anteprima', async (req, res) => {
    const tipo = H.TIPI[req.query.tipo] ? req.query.tipo : 'lavori';
    const { rows } = await db.query(`SELECT DISTINCT t.id, t.name, t.validity_rule, t.validity_months, t.template_name FROM hqse_appalto_checklists a
       JOIN hqse_checklist_docs d ON d.checklist_id = a.checklist_id JOIN hqse_doc_types t ON t.id = d.doc_type_id AND NOT t.archived
       JOIN hqse_checklists c ON c.id = a.checklist_id AND NOT c.optional WHERE a.tipo = $1 ORDER BY t.name`, [tipo]);
    res.json({ tipo, total: rows.length, docs: rows.map(t => ({ name: t.name, validity: H.validityLabel(t.validity_rule, t.validity_months), template: Boolean(t.template_name) })) });
  });
  router.post('/api/questionario', async (req, res) => {
    needReferente(req);
    const tipo = v.oneOf(req.body.tipo, 'tipo di appalto', Object.keys(H.TIPI));
    if (!tipo) throw new HttpError(400, 'Scegli il tipo di appalto');
    const whitelist = req.body.whitelist === true ? true : req.body.whitelist === false ? false : null;
    const id = sid(req);
    await db.tx(async q => {
      await q.query(`UPDATE hqse_suppliers SET tipo_appalto = $2, whitelist = $3, questionario_at = now(), updated_at = now(),
          status = CASE WHEN status = 'registrato' THEN 'in_qualifica' ELSE status END WHERE id = $1`, [id, tipo, whitelist]);
      await q.query("DELETE FROM hqse_assignments WHERE supplier_id = $1 AND worker_id IS NULL AND vehicle_id IS NULL AND origin = 'questionario'", [id]);
      const { rows: cls } = await q.query("SELECT checklist_id AS id FROM hqse_appalto_checklists WHERE tipo = $1 UNION SELECT id FROM hqse_checklists WHERE code = 'WL'", [tipo]);
      await S.assign(q, { supplierId: id, checklistIds: cls.map(c => c.id), origin: 'questionario' });
      await q.query('INSERT INTO hqse_events (supplier_id, text) VALUES ($1, $2)', [id, `Questionario compilato da ${req.portal.name || req.portal.email}: «${H.TIPI[tipo].label}», whitelist ${whitelist === null ? 'non indicata' : whitelist ? 'sì' : 'no'}`]);
    });
    res.json({ ok: true });
  });

  // ── dipendenti ────────────────────────────────────────────────────────────────────────────────
  const workerFields = b => ({
    first_name: v.text(b.first_name, 'nome', { required: true, max: 80 }),
    last_name: v.text(b.last_name, 'cognome', { required: true, max: 120 }),
    tax_code: (v.text(b.tax_code, 'codice fiscale', { max: 16 }) || '').toUpperCase(),
    hired_on: v.date(b.hired_on, 'data di assunzione') ?? null,
    answers: Object.fromEntries(Object.entries(b.answers && typeof b.answers === 'object' ? b.answers : {})
      .filter(([k]) => k === 'rapporto' || H.catalogo.DOMANDE_RISORSA.some(d => d.key === k)).map(([k, x]) => [k, k === 'rapporto' ? String(x) : x === true])),
  });
  const kindOf = answers => (answers.rapporto === 'datore_lavoratore' ? 'datore_lavoratore' : answers.rapporto === 'distaccato' ? 'distaccato' : 'dipendente');
  async function reassignWorker(q, supplierId, workerId, answers) {
    await q.query("DELETE FROM hqse_assignments WHERE supplier_id = $1 AND worker_id = $2 AND origin = 'questionario'", [supplierId, workerId]);
    await S.assign(q, { supplierId, workerId, checklistIds: await S.workerChecklists(q, answers), origin: 'questionario' });
  }
  router.get('/api/domande', (_req, res) => res.json(H.catalogo.DOMANDE_RISORSA.slice(1).map(d => ({ key: d.key, text: d.text }))));
  router.get('/api/dipendenti', async (req, res) => {
    const id = sid(req);
    const { rows } = await db.query(`SELECT w.id, w.kind, w.tax_code, w.hired_on, w.answers, c.first_name, c.last_name FROM hqse_workers w
       JOIN crm_contacts c ON c.id = w.contact_id WHERE w.supplier_id = $1 AND w.ended_on IS NULL ORDER BY lower(c.last_name), lower(c.first_name)`, [id]);
    const st = (await S.computeStates(db, [id], todayRome()))[id];
    res.json(rows.map(r => {
      const docs = st.worker_docs[r.id] || [];
      return { ...r, docs, missing: docs.filter(d => d.state === 'da_caricare' || d.state === 'respinto' || d.state === 'scaduto').length, ok: docs.length && docs.every(d => H.isOk(d.state)) };
    }));
  });
  router.post('/api/dipendenti', async (req, res) => {
    needUpload(req);
    const f = workerFields(req.body || {});
    const id = sid(req);
    const out = await db.tx(async q => {
      const { rows: [s] } = await q.query('SELECT subject_id FROM hqse_suppliers WHERE id = $1', [id]);
      const { rows: [c] } = await q.query('INSERT INTO crm_contacts (first_name, last_name) VALUES ($1, $2) RETURNING id', [f.first_name, f.last_name]);
      await q.query("INSERT INTO crm_contact_links (contact_id, subject_id, job, date_from) VALUES ($1, $2, 'dipendente (qualifica HQSE)', $3) ON CONFLICT DO NOTHING", [c.id, s.subject_id, f.hired_on]);
      const { rows: [w] } = await q.query('INSERT INTO hqse_workers (supplier_id, contact_id, tax_code, kind, hired_on, answers) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [id, c.id, f.tax_code, kindOf(f.answers), f.hired_on, JSON.stringify(f.answers)]);
      await reassignWorker(q, id, w.id, f.answers);
      await q.query('INSERT INTO hqse_events (supplier_id, text) VALUES ($1, $2)', [id, `Aggiunto il dipendente ${f.first_name} ${f.last_name}`]);
      return w;
    });
    res.status(201).json(out);
  });
  router.put('/api/dipendenti/:id', async (req, res) => {
    needUpload(req);
    const id = sid(req);
    const f = workerFields(req.body || {});
    const { rows: [w] } = await db.query('SELECT id, contact_id FROM hqse_workers WHERE id = $1 AND supplier_id = $2', [Number(req.params.id), id]);
    if (!w) throw new HttpError(404, 'Dipendente non trovato');
    await db.tx(async q => {
      await q.query('UPDATE crm_contacts SET first_name = $2, last_name = $3 WHERE id = $1', [w.contact_id, f.first_name, f.last_name]);
      await q.query('UPDATE hqse_workers SET tax_code = $2, hired_on = $3, kind = $4, answers = $5 WHERE id = $1', [w.id, f.tax_code, f.hired_on, kindOf(f.answers), JSON.stringify(f.answers)]);
      await reassignWorker(q, id, w.id, f.answers);
    });
    res.json({ ok: true });
  });
  router.delete('/api/dipendenti/:id', async (req, res) => {
    needUpload(req);
    const { rowCount } = await db.query('UPDATE hqse_workers SET ended_on = $3 WHERE id = $1 AND supplier_id = $2 AND ended_on IS NULL', [Number(req.params.id), sid(req), todayRome()]);
    if (!rowCount) throw new HttpError(404, 'Dipendente non trovato');
    res.json({ ok: true });
  });

  // ── mezzi ─────────────────────────────────────────────────────────────────────────────────────
  router.get('/api/mezzi', async (req, res) => {
    const id = sid(req);
    const { rows } = await db.query('SELECT id, kind, plate FROM hqse_vehicles WHERE supplier_id = $1 ORDER BY id', [id]);
    const st = (await S.computeStates(db, [id], todayRome()))[id];
    res.json(rows.map(m => ({ ...m, docs: st.vehicle_docs[m.id] || [] })));
  });
  router.post('/api/mezzi', async (req, res) => {
    needUpload(req);
    const kind = v.text(req.body.kind, 'mezzo', { required: true, max: 120 });
    const plate = v.text(req.body.plate, 'targa o matricola', { max: 40 }) || '';
    const id = sid(req);
    const { rows: [m] } = await db.query('INSERT INTO hqse_vehicles (supplier_id, kind, plate) VALUES ($1, $2, $3) RETURNING id', [id, kind, plate]);
    const { rows: cls } = await db.query("SELECT id FROM hqse_checklists WHERE kind = 'mezzo' AND NOT archived");
    await S.assign(db, { supplierId: id, vehicleId: m.id, checklistIds: cls.map(c => c.id), origin: 'questionario' });
    res.status(201).json(m);
  });
  router.delete('/api/mezzi/:id', async (req, res) => {
    needUpload(req);
    await db.query('DELETE FROM hqse_vehicles WHERE id = $1 AND supplier_id = $2', [Number(req.params.id), sid(req)]);
    res.json({ ok: true });
  });

  // ── cantieri (l'associazione la fa Almacis, fase 4) ───────────────────────────────────────────
  router.get('/api/cantieri', async (req, res) => {
    const { rows } = await db.query(`SELECT k.id, k.code, k.name, l.date_from, l.date_to FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id
       WHERE l.supplier_id = $1 AND l.worker_id IS NULL ORDER BY k.code`, [sid(req)]);
    res.json(rows);
  });

  // ── azienda e colleghi ────────────────────────────────────────────────────────────────────────
  router.get('/api/azienda', async (req, res) => {
    const s = await supplierInfo(sid(req));
    const { rows: people } = await db.query('SELECT id, email, name, role, can_upload, last_login, created_at FROM hqse_portal_users WHERE supplier_id = $1 AND active ORDER BY role DESC, created_at', [s.id]);
    res.json({ ...s, tipo_label: H.TIPI[s.tipo_appalto]?.label, people });
  });
  router.patch('/api/azienda', async (req, res) => {
    needReferente(req);
    const b = req.body || {};
    const id = sid(req);
    const s = await supplierInfo(id);
    const crm = { pec: v.text(b.pec, 'PEC', { max: 200 }), phone: v.text(b.phone, 'telefono', { max: 40 }), address: v.text(b.address, 'indirizzo', { max: 300 }) };
    const own = { ccnl: v.text(b.ccnl, 'CCNL', { max: 200 }), medico: v.text(b.medico, 'medico competente', { max: 200 }) };
    const ck = Object.keys(crm).filter(k => crm[k] !== undefined);
    const ok = Object.keys(own).filter(k => own[k] !== undefined);
    if (ck.length) await db.query(`UPDATE crm_subjects SET ${ck.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = (SELECT subject_id FROM hqse_suppliers WHERE id = $1)`, [id, ...ck.map(k => crm[k])]);
    if (ok.length) await db.query(`UPDATE hqse_suppliers SET ${ok.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...ok.map(k => own[k])]);
    if (ck.length || ok.length) await event(id, `${req.portal.name || req.portal.email} ha aggiornato i dati dell'azienda (${[...ck, ...ok].join(', ')})`);
    res.json({ ok: true, name: s.name });
  });
  router.post('/api/colleghi', async (req, res) => {
    needReferente(req);
    const email = P.cleanEmail(req.body.email);
    if (!P.validEmail(email)) throw new HttpError(400, 'Scrivi un indirizzo email valido');
    const name = v.text(req.body.name, 'nome', { max: 120 }) || '';
    const id = sid(req);
    const { rows: [pu] } = await db.query(`INSERT INTO hqse_portal_users (supplier_id, email, name, role, can_upload, invited_by) VALUES ($1, $2, $3, 'collega', $4, $5)
       ON CONFLICT (supplier_id, email) DO UPDATE SET active = true, can_upload = EXCLUDED.can_upload RETURNING *`, [id, email, name, req.body.can_upload !== false, req.portal.email]);
    const s = await supplierInfo(id);
    await sendLink(pu, { subject: `${req.portal.name || req.portal.email} ti ha invitato nel portale fornitori Almacis`, saluto: 'Buongiorno,',
      righe: [`${P.esc(req.portal.name || req.portal.email)} ti ha invitato a gestire i documenti di <b>${P.esc(s.name)}</b> nel portale fornitori di Almacis.`] });
    await event(id, `${req.portal.name || req.portal.email} ha invitato ${email}`);
    res.status(201).json({ id: pu.id });
  });
  router.delete('/api/colleghi/:id', async (req, res) => {
    needReferente(req);
    const { rowCount } = await db.query("UPDATE hqse_portal_users SET active = false WHERE id = $1 AND supplier_id = $2 AND role <> 'referente'", [Number(req.params.id), sid(req)]);
    if (!rowCount) throw new HttpError(404, 'Collega non trovato');
    await db.query('DELETE FROM hqse_portal_sessions WHERE portal_user_id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  });

  // ── documenti ─────────────────────────────────────────────────────────────────────────────────
  router.post('/api/documenti', async (req, res) => {
    needUpload(req);
    const b = req.body || {};
    const id = sid(req);
    const workerId = Number(b.worker_id) || null;
    const vehicleId = Number(b.vehicle_id) || null;
    const typeId = Number(b.doc_type_id);
    // il documento deve essere richiesto a quel soggetto (azienda, dipendente o mezzo)
    const { rows: [t] } = await db.query(`SELECT t.* FROM hqse_assignments a JOIN hqse_checklist_docs d ON d.checklist_id = a.checklist_id
       JOIN hqse_doc_types t ON t.id = d.doc_type_id WHERE a.supplier_id = $1 AND COALESCE(a.worker_id, 0) = $2 AND COALESCE(a.vehicle_id, 0) = $3 AND t.id = $4 LIMIT 1`,
    [id, workerId || 0, vehicleId || 0, typeId]);
    if (!t) throw new HttpError(400, 'Questo documento non è tra quelli richiesti');
    const f = b.file || {};
    const mime = String(f.mime || '').toLowerCase();
    if (!ACCEPT.test(mime)) throw new HttpError(400, 'Carica un PDF, una foto o un documento Word');
    const data = Buffer.from(String(f.base64 || ''), 'base64');
    if (!data.length || data.length > MAX_FILE) throw new HttpError(400, 'Il file è vuoto o supera 8 MB');
    const issued = v.date(b.issued_on, 'data del documento') ?? null;
    const readTo = v.date(b.valid_to, 'scadenza') ?? null;
    if (['firma', 'rilascio', 'attestato'].includes(t.validity_rule) && !issued) throw new HttpError(400, 'Scrivi la data del documento: la scadenza la calcoliamo noi');
    if (t.validity_rule === 'documento' && !readTo) throw new HttpError(400, 'Scrivi fino a quando vale il documento');
    const validTo = H.computeValidTo(t, { issued_on: issued, valid_to: readTo });
    if (validTo && validTo < todayRome()) throw new HttpError(400, `Questo documento è già scaduto (il ${validTo.split('-').reverse().join('/')}): carica quello nuovo`);
    const name = v.text(String(f.nome || 'documento'), 'nome del file', { max: 200 }) || 'documento';
    const doc = await db.tx(async q => {
      const { rows: [file] } = await q.query('INSERT INTO hqse_files (supplier_id, name, mime, size, sha256, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [id, name, mime, data.length, require('crypto').createHash('sha256').update(data).digest('hex'), data]);
      // un caricamento nuovo sostituisce quelli respinti o ancora da guardare; l'approvato resta finché il nuovo non è approvato
      await q.query(`UPDATE hqse_documents SET status = 'superato' WHERE supplier_id = $1 AND COALESCE(worker_id, 0) = $2 AND COALESCE(vehicle_id, 0) = $3
          AND doc_type_id = $4 AND status IN ('in_verifica', 'respinto')`, [id, workerId || 0, vehicleId || 0, typeId]);
      const { rows: [d] } = await q.query(`INSERT INTO hqse_documents (supplier_id, worker_id, vehicle_id, doc_type_id, status, file_name, file_id, issued_on, valid_to, uploaded_by, portal_user_id)
          VALUES ($1, $2, $3, $4, 'in_verifica', $5, $6, $7, $8, $9, $10) RETURNING id, status, valid_to`, [id, workerId, vehicleId, typeId, name, file.id, issued, validTo, req.portal.email, req.portal.id]);
      await q.query('INSERT INTO hqse_events (supplier_id, text) VALUES ($1, $2)', [id, `${req.portal.name || req.portal.email} ha caricato «${t.name}»`]);
      return d;
    });
    res.status(201).json(doc);
  });
  router.get('/api/documenti/:id/file', async (req, res) => {
    const { rows: [f] } = await db.query(`SELECT f.name, f.mime, f.data FROM hqse_documents d JOIN hqse_files f ON f.id = d.file_id
       WHERE d.id = $1 AND d.supplier_id = $2`, [Number(req.params.id), sid(req)]);
    if (!f) throw new HttpError(404, 'File non trovato');
    res.set('Content-Type', f.mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`).send(f.data);
  });

  router.use('/api', (_req, _res, next) => next(new HttpError(404, 'Risorsa non trovata')));
  // errori del portale sempre in JSON (fuori da /api il gestore di Alma risponderebbe in testo)
  router.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(`[hqse portale] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Errore interno, riprova' : err.message, code: err.code });
  });

  app.use('/fornitori', router);
  return { mailer, sendWelcome: welcome };
}

module.exports = { registerHqsePortale };
