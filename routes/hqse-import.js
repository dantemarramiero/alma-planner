// HQSE fase 5 (ALM2-105, tavole 25–28 approvate da Dante il 27/11/2026): import da Vittoria e passaggio al portale.
//   GET  /api/hqse/import                      ultimi import · POST /api/hqse/import carica il pacchetto (CSV) e abbina
//   GET  /api/hqse/import/:id                  anteprima, abbinamento, tipi di documento
//   PATCH /api/hqse/import/:id/fornitori/:row  abbina a mano: azienda del CRM, nuova o salta
//   PUT  /api/hqse/import/tipi                 tipo di documento di Vittoria → nostro (o «Non importare»)
//   POST /api/hqse/import/:id/file             un file del pacchetto (export, script o API lo mandano uno alla volta)
//   POST /api/hqse/import/:id/esegui           importa (anche solo i primi N: la prova) · GET /scarti.csv
//   GET  /api/hqse/benvenuto · POST /ondate · POST /ondate/:id/manda · GET /anteprima   passaggio al portale
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hqse');
const P = require('../lib/hqse-portale');
const I = require('../lib/hqse-import');

const BASE = '/api/hqse';
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (err) { if (err.status && !(err instanceof HttpError)) throw new HttpError(err.status, err.message); throw err; }
};

function registerHqseImport(app, { db, config, hqsePortale }) {
  const baseUrl = config?.baseUrl || '';
  const mailer = hqsePortale?.mailer;

  // ── import (tavole 25–27) ─────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/import`, async (_req, res) => {
    const { rows } = await db.query(`SELECT i.id, i.source, i.status, i.counts, i.summary, i.created_at, i.run_at, u.name AS by FROM hqse_imports i
       LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 20`);
    res.json(rows);
  });

  app.post(`${BASE}/import`, wrap(async (req, res) => {
    const b = req.body || {};
    const source = v.oneOf(b.source ?? 'export', 'origine', ['export', 'api', 'script']);
    const id = await I.stage(db, { source, fornitori: String(b.fornitori || ''), dipendenti: String(b.dipendenti || ''), documenti: String(b.documenti || ''), userId: req.user.id });
    res.status(201).json(await I.overview(db, id, todayRome()));
  }));

  app.get(`${BASE}/import/:id`, async (req, res) => {
    const o = await I.overview(db, Number(req.params.id), todayRome());
    if (!o) throw new HttpError(404, 'Import non trovato');
    res.json(o);
  });

  app.patch(`${BASE}/import/:id/fornitori/:row`, async (req, res) => {
    const b = req.body || {};
    let match, subjectId = null;
    if (b.salta === true) match = 'storico';
    else if (b.nuovo === true) match = 'nuovo';
    else {
      subjectId = v.int(b.subject_id, 'azienda', { min: 1 });
      const { rows: [s] } = await db.query('SELECT id FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [subjectId || 0]);
      if (!s) throw new HttpError(400, 'Scegli un\'azienda del CRM, «Nuova» o «Salta»');
      match = 'crm';
    }
    const { rowCount } = await db.query(`UPDATE hqse_import_suppliers SET match = $3, subject_id = $4, decided = true,
        reason = CASE WHEN $3 = 'storico' THEN 'Saltato a mano' ELSE reason END WHERE id = $2 AND import_id = $1`, [Number(req.params.id), Number(req.params.row), match, subjectId]);
    if (!rowCount) throw new HttpError(404, 'Riga non trovata');
    res.json({ ok: true });
  });

  app.get(`${BASE}/import-tipi`, async (_req, res) => {
    const { rows } = await db.query('SELECT id, name, scope FROM hqse_doc_types WHERE NOT archived ORDER BY scope, lower(name)');
    res.json(rows);
  });
  app.put(`${BASE}/import/tipi`, async (req, res) => {
    const name = I.docKey(v.text(req.body.vittoria_name, 'documento di Vittoria', { required: true, max: 300 }));
    const skip = req.body.skip === true;
    const typeId = skip ? null : v.int(req.body.doc_type_id, 'tipo di documento', { min: 1 });
    if (!skip && !typeId) throw new HttpError(400, 'Scegli il tipo di documento o «Non importare»');
    await db.query(`INSERT INTO hqse_doc_type_map (vittoria_name, doc_type_id, skip, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (vittoria_name) DO UPDATE SET doc_type_id = EXCLUDED.doc_type_id, skip = EXCLUDED.skip, updated_by = EXCLUDED.updated_by, updated_at = now()`, [name, typeId, skip, req.user.id]);
    res.json({ ok: true });
  });

  app.post(`${BASE}/import/:id/file`, wrap(async (req, res) => {
    const { rows: [imp] } = await db.query('SELECT id FROM hqse_imports WHERE id = $1', [Number(req.params.id)]);
    if (!imp) throw new HttpError(404, 'Import non trovato');
    await I.addFile(db, imp.id, req.body || {});
    res.status(201).json({ ok: true });
  }));

  app.post(`${BASE}/import/:id/esegui`, wrap(async (req, res) => {
    const limit = v.int(req.body?.prova, 'prova', { min: 1, max: 1000 }) || null;
    const out = await I.run(db, Number(req.params.id), { userId: req.user.id, today: todayRome(), limit });
    res.json(out);
  }));

  app.get(`${BASE}/import/:id/scarti.csv`, async (req, res) => {
    const id = Number(req.params.id);
    const { rows: s } = await db.query("SELECT vittoria_id, name, vat, reason FROM hqse_import_suppliers WHERE import_id = $1 AND (match = 'storico' OR (match = 'dubbio' AND NOT decided)) ORDER BY name", [id]);
    const { rows: d } = await db.query("SELECT d.vittoria_id, d.doc_name, d.skip_reason, s.name FROM hqse_import_docs d LEFT JOIN hqse_import_suppliers s ON s.import_id = d.import_id AND s.vittoria_id = d.supplier_vittoria_id WHERE d.import_id = $1 AND d.outcome = 'scartato' ORDER BY s.name, d.doc_name", [id]);
    const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = ['cosa;id_vittoria;fornitore;documento;motivo', ...s.map(r => ['fornitore', r.vittoria_id, r.name, '', r.reason].map(q).join(';')), ...d.map(r => ['documento', r.vittoria_id, r.name, r.doc_name, r.skip_reason].map(q).join(';'))];
    res.set('Content-Disposition', `attachment; filename="scarti-import-${id}.csv"`).type('text/csv; charset=utf-8').send(`﻿${lines.join('\r\n')}`);
  });

  // ── passaggio al portale (tavola 28) ──────────────────────────────────────────────────────────
  const welcomeText = async supplierId => {
    const { rows: [n] } = await db.query("SELECT COUNT(*)::int AS n FROM hqse_documents WHERE supplier_id = $1 AND status = 'approvato' AND vittoria_id <> ''", [supplierId]);
    const st = (await require('../lib/hqse-stato').computeStates(db, [supplierId], todayRome()))[supplierId];
    const manca = (st.docs?.mancanti || 0) + (st.docs?.scaduti || 0);
    return [`da oggi i documenti per lavorare con Almacis si caricano qui, non più su Vittoria. Abbiamo già portato i tuoi <b>${n.n}</b> documenti validi${manca ? `: ti ${manca === 1 ? 'manca' : 'mancano'} <b>${manca}</b> ${manca === 1 ? 'documento' : 'documenti'}` : ''}.`,
      'Non serve una password: entri con il link qui sotto e, dopo 30 giorni, con un codice che ti arriva via email.'];
  };
  async function welcomeOne(s, { secondo = false } = {}) {
    const { rows: users } = await db.query("SELECT * FROM hqse_portal_users WHERE supplier_id = $1 AND active AND role = 'referente'", [s.id]);
    if (!users.length || !hqsePortale) return 0;
    const righe = await welcomeText(s.id);
    for (const pu of users) {
      const subject = secondo ? 'Promemoria: il nuovo portale Almacis per i documenti' : 'Almacis ha un portale nuovo per i documenti';
      await hqsePortale.sendLink(pu, { subject, saluto: pu.name ? `Buongiorno ${pu.name.split(' ')[0]},` : 'Buongiorno,', righe });
      await db.query("INSERT INTO hqse_reminders (supplier_id, kind, sent_to, subject) VALUES ($1, 'benvenuto', $2, $3)", [s.id, pu.email, subject]);
    }
    return users.length;
  }

  app.get(`${BASE}/benvenuto`, async (_req, res) => {
    const { rows: [t] } = await db.query(`SELECT COUNT(*)::int AS importati, COUNT(*) FILTER (WHERE welcomed_at IS NOT NULL)::int AS invitati,
        COUNT(*) FILTER (WHERE welcomed_at IS NOT NULL AND EXISTS (SELECT 1 FROM hqse_portal_users u WHERE u.supplier_id = q.id AND u.last_login IS NOT NULL))::int AS entrati,
        COUNT(*) FILTER (WHERE welcomed_at IS NOT NULL AND EXISTS (SELECT 1 FROM hqse_documents d WHERE d.supplier_id = q.id AND d.vittoria_id = '' AND d.created_at > q.welcomed_at))::int AS caricato,
        COUNT(*) FILTER (WHERE welcomed_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM hqse_portal_users u WHERE u.supplier_id = q.id AND u.last_login IS NOT NULL))::int AS mai_entrati,
        COUNT(*) FILTER (WHERE welcomed_at IS NULL AND NOT EXISTS (SELECT 1 FROM hqse_portal_users u WHERE u.supplier_id = q.id AND u.role = 'referente' AND u.active))::int AS senza_email
       FROM hqse_suppliers q WHERE from_vittoria`);
    const { rows: waves } = await db.query(`SELECT w.id, w.name, w.criterio, w.planned_on, w.sent_at, cardinality(w.supplier_ids) AS n,
        (SELECT COUNT(*)::int FROM hqse_portal_users u WHERE u.supplier_id = ANY(w.supplier_ids) AND u.last_login IS NOT NULL AND u.role = 'referente') AS entrati
       FROM hqse_welcome_waves w ORDER BY w.id`);
    const { rows: [left] } = await db.query('SELECT COUNT(*)::int AS n FROM hqse_suppliers WHERE from_vittoria AND welcomed_at IS NULL AND welcome_wave IS NULL');
    res.json({ totals: t, waves, da_assegnare: left.n });
  });

  app.post(`${BASE}/benvenuto/ondate`, async (req, res) => {
    const criterio = v.oneOf(req.body.criterio, 'chi', ['cantieri', 'scadenze', 'tutti']);
    if (!criterio) throw new HttpError(400, 'Scegli chi entra nell\'ondata');
    const planned = v.date(req.body.planned_on, 'quando') ?? null;
    const today = todayRome();
    const where = {
      cantieri: `EXISTS (SELECT 1 FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id WHERE l.supplier_id = q.id AND k.status = 'aperto' AND (l.date_to IS NULL OR l.date_to >= $1))`,
      scadenze: `EXISTS (SELECT 1 FROM hqse_documents d WHERE d.supplier_id = q.id AND d.status = 'approvato' AND COALESCE(d.extended_to, d.valid_to) BETWEEN $1::date AND $1::date + 60)`,
      tutti: 'true',
    }[criterio];
    const { rows } = await db.query(`SELECT q.id FROM hqse_suppliers q WHERE q.from_vittoria AND q.welcomed_at IS NULL AND q.welcome_wave IS NULL AND q.status NOT IN ('sospeso', 'terminato') AND ${where}`, criterio === 'tutti' ? [] : [today]);
    if (!rows.length) throw new HttpError(400, 'Nessun fornitore da mettere in questa ondata');
    const { rows: [n] } = await db.query('SELECT COUNT(*)::int + 1 AS n FROM hqse_welcome_waves');
    const name = v.text(req.body.name, 'nome', { max: 120 }) || { cantieri: 'Fornitori dei cantieri aperti', scadenze: 'Con documenti che scadono entro 60 giorni', tutti: 'Tutti gli altri attivi' }[criterio];
    const ids = rows.map(r => r.id);
    const { rows: [w] } = await db.query('INSERT INTO hqse_welcome_waves (name, criterio, supplier_ids, planned_on, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id', [`${n.n} · ${name}`, criterio, ids, planned, req.user.id]);
    await db.query('UPDATE hqse_suppliers SET welcome_wave = $2 WHERE id = ANY($1::int[])', [ids, w.id]);
    res.status(201).json({ id: w.id, fornitori: ids.length });
  });

  app.post(`${BASE}/benvenuto/ondate/:id/manda`, async (req, res) => {
    const { rows: [w] } = await db.query('UPDATE hqse_welcome_waves SET sent_at = now(), sent_by = $2 WHERE id = $1 AND sent_at IS NULL RETURNING *', [Number(req.params.id), req.user.id]);
    if (!w) throw new HttpError(409, 'Ondata non trovata o già mandata');
    const { rows: sups } = await db.query('SELECT id FROM hqse_suppliers WHERE id = ANY($1::int[]) AND welcomed_at IS NULL', [w.supplier_ids]);
    let email = 0, senza = 0;
    for (const s of sups) {
      const n = await welcomeOne(s);
      if (!n) { senza++; continue; }
      email += n;
      await db.query('UPDATE hqse_suppliers SET welcomed_at = now() WHERE id = $1', [s.id]);
      await db.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [s.id, `Benvenuto nel portale (${w.name})`, req.user.id]);
    }
    res.json({ ok: true, fornitori: sups.length - senza, email, senza_email: senza });
  });

  app.get(`${BASE}/benvenuto/anteprima`, async (_req, res) => {
    const { rows: [s] } = await db.query("SELECT q.id, c.name FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.from_vittoria ORDER BY q.welcomed_at NULLS FIRST, q.id LIMIT 1");
    if (!s) return res.json({ html: '' });
    const righe = await welcomeText(s.id);
    res.json({ supplier: s.name, subject: 'Almacis ha un portale nuovo per i documenti', html: P.emailHtml(baseUrl, { saluto: 'Buongiorno Mario,', righe, bottone: 'Entra nel portale', link: `${baseUrl}/fornitori` }) });
  });

  // secondo invito in automatico a chi non è entrato dopo 7 giorni (una volta sola), nel giro del mattino
  app.locals.hqseScheduler?.addDaily(async () => {
    if (!mailer) return;
    const { rows } = await db.query(`SELECT q.id FROM hqse_suppliers q WHERE q.from_vittoria AND q.welcomed_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM hqse_portal_users u WHERE u.supplier_id = q.id AND u.last_login IS NOT NULL)`);
    for (const s of rows) {
      const { rows: [ok] } = await db.query('INSERT INTO send_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [`hqse:benvenuto2:${s.id}`]);
      if (ok) await welcomeOne(s, { secondo: true });
    }
  });
  app.locals.hqseWelcomeOne = welcomeOne; // nei test
}

module.exports = { registerHqseImport };
