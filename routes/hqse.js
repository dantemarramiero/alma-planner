// HQSE · Qualifica fornitori (ALM2-98, fase 1 ALM2-100; canvas approvato da Dante il 26/11/2026, tavole 6 e 9).
// - «Checklist e regole»: checklist (azienda, dipendenti, mezzi, per commessa) e tipi di documento con validità,
//   reminder, proroga, «blocca il cantiere», istruzioni per il fornitore e controlli dell'AI. Catalogo iniziale da Vittoria.
// - «Fornitori»: le aziende del CRM centrale messe in qualifica; scheda con livello, checklist, dipendenti, cantieri, storico.
// Le altre fasi (portale, verifica con AI, reminder, cantieri, import) usano le stesse tabelle.
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hqse');
const S = require('../lib/hqse-stato');

const BASE = '/api/hqse';
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

function registerHqse(app, { db, hqsePortale }) {
  let catalog = null; // il catalogo si carica alla prima richiesta (dopo le migrazioni)
  const ready = () => (catalog ||= H.ensureCatalog(db).catch(err => { catalog = null; throw err; }));

  app.use(BASE, (req, _res, next) => next(req.user && H.canSee(req.user.email) ? undefined : new HttpError(403, 'HQSE non è ancora aperto a te')));
  app.use(BASE, (_req, _res, next) => ready().then(() => next(), next));

  const event = (supplierId, text, actorId) => db.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [supplierId, text, actorId || null]);
  const typeOut = t => ({ ...t, validity: H.validityLabel(t.validity_rule, t.validity_months) });

  const states = ids => S.computeStates(db, ids, todayRome());

  async function supplierOr404(id) {
    const { rows: [s] } = await db.query(`SELECT q.*, c.name, c.vat, c.city, c.province, c.roles FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.id = $1`, [id]);
    if (!s) throw new HttpError(404, 'Fornitore non trovato');
    return s;
  }
  const assign = (supplierId, checklistIds, origin, userId) => S.assign(db, { supplierId, checklistIds, origin, userId });

  // ── configurazione: checklist, tipi di documento, regole ──────────────────────────────────────
  app.get(`${BASE}/config`, async (_req, res) => {
    const { rows: checklists } = await db.query(`SELECT c.id, c.code, c.name, c.kind, c.commesse, c.optional, c.description,
        (SELECT COUNT(*)::int FROM hqse_checklist_docs d WHERE d.checklist_id = c.id) AS docs,
        (SELECT COUNT(DISTINCT a.supplier_id)::int FROM hqse_assignments a WHERE a.checklist_id = c.id) AS suppliers
       FROM hqse_checklists c WHERE NOT c.archived ORDER BY c.sort, c.id`);
    const { rows: tipi } = await db.query(`SELECT a.tipo, array_agg(c.code ORDER BY c.sort) AS codes FROM hqse_appalto_checklists a JOIN hqse_checklists c ON c.id = a.checklist_id GROUP BY a.tipo`);
    const byTipo = Object.fromEntries(tipi.map(t => [t.tipo, t.codes]));
    res.json({
      checklists,
      tipi_appalto: H.catalogo.TIPI_APPALTO.map(t => ({ key: t.key, label: t.label, hint: t.hint, checklists: byTipo[t.key] || [] })),
      rules: H.RULES, status: H.STATUS, levels: H.LEVELS, risks: H.RISKS, doc_states: H.DOC_STATES,
      domande_risorsa: H.catalogo.DOMANDE_RISORSA.length,
    });
  });

  app.get(`${BASE}/checklists/:id`, async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [cl] } = await db.query('SELECT * FROM hqse_checklists WHERE id = $1 AND NOT archived', [id]);
    if (!cl) throw new HttpError(404, 'Checklist non trovata');
    const { rows: docs } = await db.query(`SELECT t.* FROM hqse_checklist_docs d JOIN hqse_doc_types t ON t.id = d.doc_type_id
       WHERE d.checklist_id = $1 AND NOT t.archived ORDER BY d.sort, t.name`, [id]);
    const { rows: tipi } = await db.query('SELECT tipo FROM hqse_appalto_checklists WHERE checklist_id = $1', [id]);
    res.json({ ...cl, tipi: tipi.map(t => t.tipo), docs: docs.map(typeOut) });
  });

  app.post(`${BASE}/checklists`, async (req, res) => {
    const name = v.text(req.body.name, 'nome', { required: true, max: 120 });
    const kind = v.oneOf(req.body.kind ?? 'fornitore', 'tipo', ['fornitore', 'risorsa', 'mezzo']);
    const commesse = (Array.isArray(req.body.commesse) ? req.body.commesse : []).map(x => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 50);
    const { rows: [{ n }] } = await db.query('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM hqse_checklists');
    const code = `C${Date.now().toString(36).toUpperCase()}`;
    const { rows: [cl] } = await db.query('INSERT INTO hqse_checklists (code, name, kind, commesse, sort) VALUES ($1, $2, $3, $4, $5) RETURNING *', [code, name, kind, commesse, n]);
    res.status(201).json(cl);
  });

  app.post(`${BASE}/checklists/:id/docs`, async (req, res) => {
    const id = Number(req.params.id);
    let typeId = Number(req.body.doc_type_id) || null;
    if (!typeId) { // documento nuovo: nasce col nome e le regole di base
      const { rows: [cl] } = await db.query('SELECT kind FROM hqse_checklists WHERE id = $1', [id]);
      if (!cl) throw new HttpError(404, 'Checklist non trovata');
      const f = H.docTypeFields({ name: req.body.name ?? '', ...req.body });
      const { rows: [t] } = await db.query(`INSERT INTO hqse_doc_types (code, name, scope, instructions, validity_rule, validity_months, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [`d_${Date.now().toString(36)}`, f.name, cl.kind, f.instructions || '', f.validity_rule || 'documento', f.validity_months ?? null, req.user.id]);
      typeId = t.id;
    }
    const { rows: [{ n }] } = await db.query('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM hqse_checklist_docs WHERE checklist_id = $1', [id]);
    await db.query('INSERT INTO hqse_checklist_docs (checklist_id, doc_type_id, sort) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, typeId, n]);
    res.status(201).json({ ok: true, doc_type_id: typeId });
  });

  app.delete(`${BASE}/checklists/:id/docs/:typeId`, async (req, res) => {
    await db.query('DELETE FROM hqse_checklist_docs WHERE checklist_id = $1 AND doc_type_id = $2', [Number(req.params.id), Number(req.params.typeId)]);
    res.json({ ok: true });
  });

  app.get(`${BASE}/doc-types/:id`, async (req, res) => {
    const { rows: [t] } = await db.query('SELECT * FROM hqse_doc_types WHERE id = $1', [Number(req.params.id)]);
    if (!t) throw new HttpError(404, 'Documento non trovato');
    const { rows: used } = await db.query(`SELECT c.id, c.code, c.name FROM hqse_checklist_docs d JOIN hqse_checklists c ON c.id = d.checklist_id
       WHERE d.doc_type_id = $1 AND NOT c.archived ORDER BY c.sort`, [t.id]);
    const { rows: [{ n }] } = await db.query("SELECT COUNT(DISTINCT supplier_id)::int AS n FROM hqse_documents WHERE doc_type_id = $1 AND status <> 'superato'", [t.id]);
    res.json({ ...typeOut(t), checklists: used, uploaded_by_suppliers: n });
  });

  app.put(`${BASE}/doc-types/:id`, async (req, res) => {
    const id = Number(req.params.id);
    let f;
    try { f = H.docTypeFields(req.body || {}); } catch (err) { throw new HttpError(err.status || 400, err.message); }
    const keys = Object.keys(f);
    if (!keys.length) throw new HttpError(400, 'Niente da salvare');
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const vals = keys.map(k => (k === 'ai_checks' ? JSON.stringify(f[k]) : f[k]));
    const { rows: [t] } = await db.query(`UPDATE hqse_doc_types SET ${sets.join(', ')}, updated_by = $${keys.length + 2}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals, req.user.id]);
    if (!t) throw new HttpError(404, 'Documento non trovato');
    res.json(typeOut(t));
  });

  // ── fornitori in qualifica ────────────────────────────────────────────────────────────────────
  // aziende del CRM da mettere in qualifica (quelle già in HQSE escluse)
  app.get(`${BASE}/aziende`, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const { rows } = await db.query(`SELECT s.id, s.name, s.vat, s.city, s.province, s.roles FROM crm_subjects s
       WHERE s.merged_into IS NULL AND NOT EXISTS (SELECT 1 FROM hqse_suppliers h WHERE h.subject_id = s.id)
         AND (s.name ILIKE $1 OR s.short_name ILIKE $1 OR s.vat ILIKE $1)
       ORDER BY ('fornitore' = ANY(s.roles)) DESC, lower(s.name) LIMIT 12`, [`%${q}%`]);
    res.json(rows);
  });

  app.get(`${BASE}/fornitori`, async (req, res) => {
    const params = [];
    const where = ['TRUE'];
    if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where.push(`(c.name ILIKE $${params.length} OR c.vat ILIKE $${params.length})`); }
    if (req.query.status && H.STATUS[req.query.status]) { params.push(req.query.status); where.push(`q.status = $${params.length}`); }
    const { rows } = await db.query(`SELECT q.id, q.subject_id, q.tipo_appalto, q.status, q.level, q.risk, q.whitelist, c.name, c.vat, c.city, c.province
       FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE ${where.join(' AND ')} ORDER BY lower(c.name) LIMIT 2000`, params);
    const st = await states(rows.map(r => r.id));
    res.json(rows.map(r => ({ ...r, docs: st[r.id].docs, workers: st[r.id].workers })));
  });

  app.post(`${BASE}/fornitori`, async (req, res) => {
    const subjectId = v.int(req.body.subject_id, 'azienda', { min: 1 });
    if (!subjectId) throw new HttpError(400, 'Scegli l\'azienda dal CRM');
    const tipo = v.oneOf(req.body.tipo_appalto ?? 'lavori', 'tipo di appalto', Object.keys(H.TIPI));
    const { rows: [subj] } = await db.query('SELECT id, name FROM crm_subjects WHERE id = $1 AND merged_into IS NULL', [subjectId]);
    if (!subj) throw new HttpError(404, 'Azienda non trovata nel CRM');
    const { rows: [s] } = await db.query(`INSERT INTO hqse_suppliers (subject_id, tipo_appalto, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (subject_id) DO NOTHING RETURNING *`, [subjectId, tipo, req.user.id]);
    if (!s) throw new HttpError(409, `${subj.name} è già in qualifica`);
    // nel CRM diventa (anche) fornitore
    await db.query(`UPDATE crm_subjects SET roles = array_append(roles, 'fornitore') WHERE id = $1 AND NOT ('fornitore' = ANY(roles))`, [subjectId]);
    const { rows: cls } = await db.query(`SELECT c.id FROM hqse_appalto_checklists a JOIN hqse_checklists c ON c.id = a.checklist_id WHERE a.tipo = $1
       UNION SELECT id FROM hqse_checklists WHERE code = 'WL'`, [tipo]);
    await assign(s.id, cls.map(c => c.id), 'questionario', req.user.id);
    await event(s.id, `Messo in qualifica come «${H.TIPI[tipo].label}»`, req.user.id);
    res.status(201).json(s);
  });

  app.get(`${BASE}/fornitori/:id`, async (req, res) => {
    const s = await supplierOr404(Number(req.params.id));
    const [st, { rows: sites }, { rows: history }] = await Promise.all([
      states([s.id]),
      db.query(`SELECT k.id, k.code, k.name, l.date_from, l.date_to FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id
                 WHERE l.supplier_id = $1 AND l.worker_id IS NULL ORDER BY k.code`, [s.id]),
      db.query(`SELECT e.text, e.at, u.name AS actor FROM hqse_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.supplier_id = $1 ORDER BY e.at DESC LIMIT 30`, [s.id]),
    ]);
    const { rows: vehicles } = await db.query('SELECT id, kind, plate FROM hqse_vehicles WHERE supplier_id = $1 ORDER BY id', [s.id]);
    res.json({ ...s, tipo_label: H.TIPI[s.tipo_appalto]?.label || s.tipo_appalto, ...st[s.id], sites, history, vehicle_list: vehicles });
  });

  // invito al portale (fornitori messi in qualifica da Alma): il referente riceve il link
  app.post(`${BASE}/fornitori/:id/invita`, async (req, res) => {
    const s = await supplierOr404(Number(req.params.id));
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!require('../lib/hqse-portale').validEmail(email)) throw new HttpError(400, 'Scrivi un indirizzo email valido');
    const name = v.text(req.body.name, 'nome', { max: 120 }) || '';
    const { rows: [has] } = await db.query("SELECT 1 FROM hqse_portal_users WHERE supplier_id = $1 AND role = 'referente' AND active", [s.id]);
    const { rows: [pu] } = await db.query(`INSERT INTO hqse_portal_users (supplier_id, email, name, role, invited_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (supplier_id, email) DO UPDATE SET active = true RETURNING *`, [s.id, email, name, has ? 'collega' : 'referente', req.user.email]);
    if (!hqsePortale) throw new HttpError(500, 'Portale non disponibile');
    await hqsePortale.sendWelcome(pu, s.name, H.TIPI[s.tipo_appalto]?.label);
    await event(s.id, `Invitato al portale ${email}`, req.user.id);
    res.status(201).json({ ok: true });
  });

  app.get(`${BASE}/fornitori/:id/persone`, async (req, res) => {
    const { rows } = await db.query('SELECT id, email, name, role, can_upload, last_login FROM hqse_portal_users WHERE supplier_id = $1 AND active ORDER BY role DESC, created_at', [Number(req.params.id)]);
    res.json(rows);
  });

  app.get(`${BASE}/documenti/:id/file`, async (req, res) => {
    const { rows: [f] } = await db.query('SELECT f.name, f.mime, f.data FROM hqse_documents d JOIN hqse_files f ON f.id = d.file_id WHERE d.id = $1', [Number(req.params.id)]);
    if (!f) throw new HttpError(404, 'File non trovato');
    res.set('Content-Type', f.mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`).send(f.data);
  });

  // widget sul sito (tavola 2): testi, tipi di appalto mostrati, privacy, chi avvisare
  app.get(`${BASE}/widget`, async (_req, res) => {
    const P = require('../lib/hqse-portale');
    const { rows: [r] } = await db.query('SELECT settings, updated_at FROM hqse_widget WHERE id = 1');
    const { rows: [n] } = await db.query(`SELECT COUNT(*) FILTER (WHERE q.created_at > now() - interval '30 days')::int AS nuovi,
        COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hqse_portal_users u WHERE u.supplier_id = q.id AND u.last_login IS NOT NULL))::int AS mai
       FROM hqse_suppliers q WHERE q.status = 'registrato' OR q.created_at > now() - interval '30 days'`);
    res.json({ settings: P.widgetSettings(r?.settings), updated_at: r?.updated_at || null, origins: P.widgetOrigins(), stats: n,
      tipi: H.catalogo.TIPI_APPALTO.map(t => ({ key: t.key, label: t.label, hint: t.hint })) });
  });
  app.put(`${BASE}/widget`, async (req, res) => {
    const P = require('../lib/hqse-portale');
    const b = req.body || {};
    const s = {
      titolo: v.text(b.titolo, 'titolo', { required: true, max: 120 }),
      testo: v.text(b.testo, 'testo', { max: 600 }) || '',
      grazie: v.text(b.grazie, 'messaggio dopo l\'invio', { max: 300 }) || P.WIDGET_DEFAULT.grazie,
      privacy_url: v.text(b.privacy_url, 'link alla privacy', { max: 300 }) || '',
      tipi: (Array.isArray(b.tipi) ? b.tipi : []).filter(k => H.TIPI[k]),
      avvisa: String(b.avvisa || '').trim().toLowerCase().slice(0, 200),
    };
    if (!s.tipi.length) throw new HttpError(400, 'Lascia almeno un tipo di appalto');
    if (s.privacy_url && !/^https?:\/\//.test(s.privacy_url)) throw new HttpError(400, 'Il link alla privacy deve iniziare con https://');
    await db.query(`INSERT INTO hqse_widget (id, settings, updated_by, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`, [JSON.stringify(s), req.user.id]);
    res.json({ ok: true, settings: s });
  });

  app.patch(`${BASE}/fornitori/:id`, async (req, res) => {
    const s = await supplierOr404(Number(req.params.id));
    const b = req.body || {};
    const f = {
      status: v.oneOf(b.status, 'stato', Object.keys(H.STATUS)),
      level: v.oneOf(b.level, 'livello', Object.keys(H.LEVELS)),
      risk: v.oneOf(b.risk, 'rischio', Object.keys(H.RISKS)),
      whitelist: b.whitelist === undefined ? undefined : b.whitelist === null ? null : Boolean(b.whitelist),
      notes: v.text(b.notes, 'note', { max: 4000 }),
    };
    const keys = Object.keys(f).filter(k => f[k] !== undefined);
    if (!keys.length) throw new HttpError(400, 'Niente da salvare');
    await db.query(`UPDATE hqse_suppliers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [s.id, ...keys.map(k => f[k])]);
    const said = [];
    if (f.status && f.status !== s.status) said.push(`stato «${H.STATUS[f.status]}»`);
    if (f.level && f.level !== s.level) said.push(`livello «${H.LEVELS[f.level]}»`);
    if (f.risk !== undefined && f.risk !== s.risk) said.push(`rischio «${H.RISKS[f.risk]}»`);
    if (said.length) await event(s.id, `Cambiato ${said.join(', ')}`, req.user.id);
    res.json({ ok: true });
  });

  app.post(`${BASE}/fornitori/:id/checklists`, async (req, res) => {
    const s = await supplierOr404(Number(req.params.id));
    const cid = v.int(req.body.checklist_id, 'checklist', { min: 1 });
    const { rows: [cl] } = await db.query("SELECT id, code, name FROM hqse_checklists WHERE id = $1 AND kind = 'fornitore' AND NOT archived", [cid]);
    if (!cl) throw new HttpError(404, 'Checklist non trovata');
    await assign(s.id, [cl.id], 'manuale', req.user.id);
    await event(s.id, `Aggiunta la checklist «${cl.name}»`, req.user.id);
    res.status(201).json({ ok: true });
  });

  app.delete(`${BASE}/fornitori/:id/checklists/:checklistId`, async (req, res) => {
    const s = await supplierOr404(Number(req.params.id));
    const { rows: [cl] } = await db.query('SELECT name FROM hqse_checklists WHERE id = $1', [Number(req.params.checklistId)]);
    const { rowCount } = await db.query('DELETE FROM hqse_assignments WHERE supplier_id = $1 AND checklist_id = $2 AND worker_id IS NULL AND vehicle_id IS NULL', [s.id, Number(req.params.checklistId)]);
    if (rowCount && cl) await event(s.id, `Tolta la checklist «${cl.name}»`, req.user.id);
    res.json({ ok: true });
  });
}

module.exports = { registerHqse };
