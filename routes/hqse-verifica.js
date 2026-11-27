// HQSE fase 3 (ALM2-103, tavole 5 e 16–20 approvate da Dante il 27/11/2026): la scrivania di HQSE.
//   GET  /api/hqse/verifica                coda «Da verificare» (filtri, urgenza, approvabili «rapidi»)
//   GET  /api/hqse/documenti/:id           documento con la proposta dell'AI e i controlli (anche incrociati)
//   POST /api/hqse/documenti/:id/esito     approva · respingi · chiedi un'integrazione (nome e ora di chi decide)
//   POST /api/hqse/documenti/:id/rileggi   nuova lettura dell'AI · /segnala conflitto d'interessi alla direzione
//   POST /api/hqse/verifica/rapida         approva insieme gli «approvabili» dei tipi con l'approvazione rapida accesa
//   GET  /api/hqse/qualita                 quante volte HQSE conferma l'AI, per tipo · PUT /doc-types/:id/rapida
//   GET  /api/hqse/fornitori/:id/livello   livello di qualifica proposto, con il perché
// Le rotte stanno sotto /api/hqse: valgono gli stessi accessi del modulo (HQSE_UTENTI).
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hqse');
const S = require('../lib/hqse-stato');
const P = require('../lib/hqse-portale');
const AI = require('../lib/hqse-ai');

const BASE = '/api/hqse';
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const QUICK_MIN = 30;
const QUICK_PCT = 95;
const MOTIVI = ['Manca una firma', 'Documento scaduto', 'Non è il documento richiesto', 'Intestato ad altri', 'Illeggibile o incompleto', 'Formazione non conforme (ore, ente, aggiornamento)', 'Non coerente con le lavorazioni', 'Patente a crediti non valida o sotto 15 crediti', 'Massimale insufficiente', 'Autodichiarazione non ammessa', 'Altro'];

function registerHqseVerifica(app, { db, config, hqsePortale }) {
  const mailer = hqsePortale?.mailer;
  const baseUrl = config?.baseUrl || '';
  const event = (supplierId, text, actorId) => db.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [supplierId, text, actorId || null]);

  // urgenza: il documento blocca un cantiere in cui il fornitore entra presto
  const DOC_SQL = `SELECT d.id, d.supplier_id, d.worker_id, d.vehicle_id, d.doc_type_id, d.status, d.file_name, d.issued_on, d.valid_to, d.created_at,
      d.ai_status, d.ai_proposal, d.ai_result, d.uploaded_by, d.escalated_at, t.name AS type_name, t.blocking, t.quick_approve, t.validity_rule, t.validity_months,
      c.name AS supplier_name, trim(concat_ws(' ', wc.first_name, wc.last_name)) AS worker_name, m.kind AS vehicle_kind,
      (SELECT min(COALESCE(l.date_from, k.starts_on)) FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id
        WHERE l.supplier_id = d.supplier_id AND k.status = 'aperto' AND (l.date_to IS NULL OR l.date_to >= CURRENT_DATE)) AS site_from,
      (SELECT string_agg(k.code, ', ') FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id WHERE l.supplier_id = d.supplier_id AND l.worker_id IS NULL AND k.status = 'aperto') AS sites
    FROM hqse_documents d JOIN hqse_doc_types t ON t.id = d.doc_type_id JOIN hqse_suppliers q ON q.id = d.supplier_id JOIN crm_subjects c ON c.id = q.subject_id
    LEFT JOIN hqse_workers w ON w.id = d.worker_id LEFT JOIN crm_contacts wc ON wc.id = w.contact_id LEFT JOIN hqse_vehicles m ON m.id = d.vehicle_id`;
  const urgency = r => (r.blocking && r.sites ? 0 : r.escalated_at ? 2 : 1);
  const rowOut = r => ({
    id: r.id, supplier_id: r.supplier_id, supplier: r.supplier_name, worker: r.worker_name || null, vehicle: r.vehicle_kind || null, type_id: r.doc_type_id, type: r.type_name,
    blocking: r.blocking, sites: r.sites, site_from: r.site_from, created_at: r.created_at, proposal: r.ai_proposal, ai_status: r.ai_status,
    why: (r.ai_result?.checks || []).filter(c => c.ok === false).map(c => [c.text, c.nota].filter(Boolean).join(': '))[0] || (r.ai_proposal === 'approvabile' ? (r.valid_to ? `valido fino al ${String(r.valid_to).slice(0, 10).split('-').reverse().join('/')}` : 'tutti i controlli superati') : ''),
    quick: r.quick_approve && r.ai_proposal === 'approvabile', escalated: Boolean(r.escalated_at), urgent: urgency(r) === 0,
  });

  app.get(`${BASE}/verifica`, async (req, res) => {
    const { rows } = await db.query(`${DOC_SQL} WHERE d.status = 'in_verifica' ORDER BY d.created_at`);
    const all = rows.map(rowOut).sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.site_from || '9') .localeCompare(b.site_from || '9') || new Date(a.created_at) - new Date(b.created_at));
    const counts = {
      tutti: all.length, bloccanti: all.filter(r => r.urgent).length, approvabili: all.filter(r => r.proposal === 'approvabile').length,
      respingere: all.filter(r => r.proposal === 'respingere').length, incerti: all.filter(r => r.proposal === 'incerto' || !r.proposal).length, rapidi: all.filter(r => r.quick).length,
    };
    const f = String(req.query.filtro || 'tutti');
    const list = f === 'bloccanti' ? all.filter(r => r.urgent) : f === 'approvabili' ? all.filter(r => r.proposal === 'approvabile')
      : f === 'respingere' ? all.filter(r => r.proposal === 'respingere') : f === 'incerti' ? all.filter(r => r.proposal === 'incerto' || !r.proposal) : all;
    const oldest = all.length ? Math.floor((Date.now() - Math.min(...all.map(r => new Date(r.created_at)))) / 864e5) : 0;
    res.json({ rows: list, counts, oldest_days: oldest, motivi: MOTIVI });
  });

  async function docOr404(id) {
    const { rows: [r] } = await db.query(`${DOC_SQL} WHERE d.id = $1`, [id]);
    if (!r) throw new HttpError(404, 'Documento non trovato');
    return r;
  }

  app.get(`${BASE}/documenti/:id`, async (req, res) => {
    const r = await docOr404(Number(req.params.id));
    const { rows: [type] } = await db.query('SELECT id, name, instructions, ai_checks, validity_rule, validity_months, notice_days, blocking FROM hqse_doc_types WHERE id = $1', [r.doc_type_id]);
    const { rows: [prev] } = await db.query(`SELECT id, valid_to, decided_at FROM hqse_documents WHERE supplier_id = $1 AND COALESCE(worker_id, 0) = $2 AND COALESCE(vehicle_id, 0) = $3
       AND doc_type_id = $4 AND status = 'approvato' AND id <> $5 ORDER BY created_at DESC LIMIT 1`, [r.supplier_id, r.worker_id || 0, r.vehicle_id || 0, r.doc_type_id, r.id]);
    const { rows: [q] } = await db.query('SELECT ccnl, medico FROM hqse_suppliers WHERE id = $1', [r.supplier_id]);
    res.json({ ...rowOut(r), status: r.status, file_name: r.file_name, issued_on: r.issued_on, valid_to: r.valid_to, uploaded_by: r.uploaded_by,
      ai: r.ai_result || null, type_info: { ...type, validity: H.validityLabel(type.validity_rule, type.validity_months) }, previous: prev || null, declared: q, motivi: MOTIVI });
  });

  async function supplierRecipients(supplierId) {
    const { rows } = await db.query('SELECT email FROM hqse_portal_users WHERE supplier_id = $1 AND active AND can_upload', [supplierId]);
    return rows.map(r => r.email);
  }
  async function mailSupplier(r, { subject, righe, bottone = 'Apri il portale' }) {
    if (!mailer) return;
    for (const to of await supplierRecipients(r.supplier_id)) {
      await mailer.send({ to, subject, html: P.emailHtml(baseUrl, { saluto: 'Buongiorno,', righe, bottone, link: `${baseUrl}/fornitori` }) }).catch(e => console.warn('[hqse] email esito:', e.message));
    }
  }
  async function mailSiteChiefs(r, text) {
    if (!mailer) return;
    const { rows } = await db.query(`SELECT DISTINCT k.chief_email, k.code FROM hqse_site_links l JOIN cantieri k ON k.id = l.cantiere_id
       WHERE l.supplier_id = $1 AND k.status = 'aperto' AND k.chief_email <> ''`, [r.supplier_id]);
    for (const k of rows) await mailer.send({ to: k.chief_email, subject: `[${k.code}] ${r.supplier_name}: ${text}`, html: P.emailHtml(baseUrl, { righe: [`${P.esc(r.supplier_name)}: ${P.esc(text)}.`] }) }).catch(() => {});
  }

  async function decide(r, { esito, motivi = [], reason = '', validTo = null, userId, userName, quick = false, notifyCm = false }) {
    const agreed = !r.ai_proposal || r.ai_proposal === 'incerto' ? null : (esito === 'approvato') === (r.ai_proposal === 'approvabile');
    const label = r.worker_name ? `«${r.type_name}» di ${r.worker_name}` : r.vehicle_kind ? `«${r.type_name}» (${r.vehicle_kind})` : `«${r.type_name}»`;
    await db.tx(async q => {
      await q.query(`UPDATE hqse_documents SET status = $2, motivi = $3, reason = $4, decided_by = $5, decided_at = now(), ai_agreed = $6, quick = $7, valid_to = COALESCE($8, valid_to)
         WHERE id = $1`, [r.id, esito, motivi, reason, userId, agreed, quick, validTo]);
      if (esito === 'approvato') {
        await q.query(`UPDATE hqse_documents SET status = 'superato' WHERE supplier_id = $1 AND COALESCE(worker_id, 0) = $2 AND COALESCE(vehicle_id, 0) = $3
           AND doc_type_id = $4 AND id <> $5 AND status IN ('approvato', 'respinto', 'integrazione')`, [r.supplier_id, r.worker_id || 0, r.vehicle_id || 0, r.doc_type_id, r.id]);
      }
      const verb = { approvato: quick ? 'Approvato (approvazione rapida)' : 'Approvato', respinto: 'Respinto', integrazione: 'Chiesta un\'integrazione per' }[esito];
      await q.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [r.supplier_id, `${verb} ${label}${motivi.length ? ` (${motivi.join(', ')})` : ''}`, userId]);
    });
    if (esito === 'respinto' || esito === 'integrazione') {
      await mailSupplier(r, { subject: `Da sistemare: ${r.type_name}`, bottone: 'Ricarica il documento',
        righe: [`abbiamo controllato ${P.esc(label)} di <b>${P.esc(r.supplier_name)}</b> e ${esito === 'respinto' ? 'non possiamo approvarlo' : 'manca ancora qualcosa'}:`,
          `<span style="display:block;padding:12px 14px;border-radius:12px;background:#FCEBE9;color:#2C2C2C">${P.esc(reason)}</span>`] });
      if (notifyCm && r.blocking) await mailSiteChiefs(r, `${r.type_name} ${esito === 'respinto' ? 'respinto' : 'da completare'}: non entra finché non è sistemato`);
    }
    return { agreed, by: userName };
  }

  app.post(`${BASE}/documenti/:id/esito`, async (req, res) => {
    const r = await docOr404(Number(req.params.id));
    if (r.status !== 'in_verifica') throw new HttpError(409, 'Questo documento è già stato deciso');
    const esito = v.oneOf(req.body.esito, 'esito', ['approvato', 'respinto', 'integrazione']);
    if (!esito) throw new HttpError(400, 'Scegli l\'esito');
    const motivi = (Array.isArray(req.body.motivi) ? req.body.motivi : []).map(x => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
    const reason = v.text(req.body.reason, 'motivo', { max: 1200 }) || '';
    if (esito !== 'approvato' && !reason) throw new HttpError(400, 'Scrivi cosa deve sistemare il fornitore');
    const validTo = v.date(req.body.valid_to, 'scadenza') ?? null;
    // casi dubbi: prima si sente l'Ufficio QHSE (criteri di Aristide, 27/11/2026); approvare un documento segnalato chiede il suo parere
    const parere = v.text(req.body.parere, 'parere', { max: 600 }) || '';
    if (esito === 'approvato' && r.escalated_at && parere.length < 3) throw new HttpError(400, 'Documento segnalato all\'Ufficio QHSE: scrivi il suo parere prima di approvare');
    if (parere) await event(r.supplier_id, `Parere dell'Ufficio QHSE su «${r.type_name}»: ${parere}`, req.user.id);
    const out = await decide(r, { esito, motivi, reason, validTo, userId: req.user.id, userName: req.user.name, notifyCm: req.body.avvisa_capocommessa === true });
    res.json({ ok: true, ...out });
  });

  app.post(`${BASE}/documenti/:id/rileggi`, async (req, res) => {
    const r = await docOr404(Number(req.params.id));
    const out = await AI.analyze(db, r.id, { userId: req.user.id });
    res.json({ ok: true, status: out?.status || 'spento' });
  });

  app.post(`${BASE}/documenti/:id/segnala`, async (req, res) => {
    const r = await docOr404(Number(req.params.id));
    await db.query('UPDATE hqse_documents SET escalated_at = now() WHERE id = $1', [r.id]);
    const nota = v.text(req.body.nota, 'nota', { max: 300 }) || r.ai_result?.escalate_reason || 'conflitto d\'interessi dichiarato';
    await event(r.supplier_id, `Chiesto il parere dell'Ufficio QHSE su «${r.type_name}» (${nota})`, req.user.id);
    const to = String(process.env.HQSE_DIREZIONE || '').split(/[,;\s]+/).filter(P.validEmail);
    if (mailer) for (const e of to) await mailer.send({ to: e, subject: `HQSE · parere QHSE: ${r.supplier_name}`, html: P.emailHtml(baseUrl, { righe: [`Serve il parere dell'Ufficio QHSE su «${P.esc(r.type_name)}» di ${P.esc(r.supplier_name)} prima dell'approvazione.`, `Il caso: ${P.esc(nota)}.`], bottone: 'Apri in Alma', link: `${baseUrl}/app#/hqse/verifica/${r.id}` }) }).catch(() => {});
    res.json({ ok: true });
  });

  app.post(`${BASE}/verifica/rapida`, async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
    const { rows } = await db.query(`${DOC_SQL} WHERE d.status = 'in_verifica' AND d.ai_proposal = 'approvabile' AND t.quick_approve AND d.escalated_at IS NULL ${ids.length ? 'AND d.id = ANY($1::int[])' : ''}`, ids.length ? [ids] : []);
    for (const r of rows) await decide(r, { esito: 'approvato', userId: req.user.id, userName: req.user.name, quick: true });
    res.json({ ok: true, approvati: rows.length });
  });

  // ── qualità dell'AI (tavola 20) ─────────────────────────────────────────────────────────────────
  app.get(`${BASE}/qualita`, async (_req, res) => {
    const { rows } = await db.query(`SELECT t.id, t.name, t.quick_approve, COUNT(d.id)::int AS n,
        COUNT(d.id) FILTER (WHERE d.ai_agreed)::int AS ok, COUNT(d.id) FILTER (WHERE d.ai_agreed = false)::int AS ko,
        COUNT(d.id) FILTER (WHERE d.quick)::int AS rapidi
       FROM hqse_doc_types t LEFT JOIN hqse_documents d ON d.doc_type_id = t.id AND d.decided_at > now() - interval '90 days' AND d.ai_agreed IS NOT NULL
      GROUP BY t.id HAVING COUNT(d.id) > 0 OR t.quick_approve ORDER BY COUNT(d.id) DESC, t.name`);
    const { rows: why } = await db.query(`SELECT d.doc_type_id, m, COUNT(*)::int AS n FROM hqse_documents d, unnest(d.motivi) m
       WHERE d.ai_agreed = false AND d.decided_at > now() - interval '90 days' GROUP BY d.doc_type_id, m ORDER BY n DESC`);
    const { rows: [tot] } = await db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE ai_agreed)::int AS ok,
        AVG(EXTRACT(EPOCH FROM (decided_at - created_at)) / 86400) AS giorni FROM hqse_documents WHERE decided_at > now() - interval '90 days' AND decided_by IS NOT NULL`);
    const { rows: [cost] } = await db.query("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM assistant_usage WHERE model ~ '^(gpt|o\\d|claude)' AND conversation_id IS NULL AND day > CURRENT_DATE - 90");
    const types = rows.map(r => {
      const pct = r.n ? Math.round((r.ok / r.n) * 100) : null;
      return { ...r, pct, eligible: r.n >= QUICK_MIN && pct >= QUICK_PCT, errore: why.find(w => w.doc_type_id === r.id)?.m || null };
    });
    res.json({ types, total: { n: tot.n, pct: tot.n ? Math.round((tot.ok / tot.n) * 100) : null, giorni: tot.giorni === null ? null : Math.round(Number(tot.giorni) * 10) / 10 },
      cost_usd: Number(cost.usd) || 0, rapidi_accesi: types.filter(t => t.quick_approve).length, soglia: { min: QUICK_MIN, pct: QUICK_PCT } });
  });

  app.put(`${BASE}/doc-types/:id/rapida`, async (req, res) => {
    const id = Number(req.params.id);
    const on = req.body.on === true;
    if (on) {
      const { rows: [s] } = await db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE ai_agreed)::int AS ok FROM hqse_documents
         WHERE doc_type_id = $1 AND ai_agreed IS NOT NULL AND decided_at > now() - interval '90 days'`, [id]);
      const pct = s.n ? (s.ok / s.n) * 100 : 0;
      if (s.n < QUICK_MIN || pct < QUICK_PCT) throw new HttpError(400, `Si accende con almeno ${QUICK_MIN} documenti verificati e il ${QUICK_PCT}% di conferme (ora ${s.n}, ${Math.round(pct)}%)`);
    }
    await db.query('UPDATE hqse_doc_types SET quick_approve = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, on, req.user.id]);
    res.json({ ok: true });
  });

  // ── livello di qualifica proposto (tavola 19); regole da confermare con HQSE ────────────────────
  app.get(`${BASE}/fornitori/:id/livello`, async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [q] } = await db.query('SELECT id, level FROM hqse_suppliers WHERE id = $1', [id]);
    if (!q) throw new HttpError(404, 'Fornitore non trovato');
    const st = (await S.computeStates(db, [id], todayRome()))[id];
    const { rows: codes } = await db.query('SELECT id, code FROM hqse_doc_types');
    const codeOf = Object.fromEntries(codes.map(c => [c.id, c.code]));
    const required = [...new Map(st.checklists.filter(c => !c.optional).flatMap(c => c.docs).map(d => [d.type_id, d])).values()];
    const optional = st.checklists.filter(c => c.optional).flatMap(c => c.docs);
    const certs = optional.filter(d => H.isOk(d.state) && /^iso|^sa8000|^pdr125|^ghc|^mod231/.test(codeOf[d.type_id] || ''));
    const legality = optional.some(d => codeOf[d.type_id] === 'rating_legalita' && H.isOk(d.state));
    const { rows: [rej] } = await db.query("SELECT COUNT(*)::int AS n FROM hqse_documents WHERE supplier_id = $1 AND status IN ('respinto', 'superato') AND motivi <> '{}' AND decided_at > now() - interval '12 months' AND reason <> ''", [id]);
    const killers = required.filter(d => ['durc', 'whitelist', 'antimafia', 'art14'].includes(codeOf[d.type_id]) && (d.state === 'respinto' || d.state === 'scaduto'));
    const allOk = required.length > 0 && required.every(d => H.isOk(d.state));
    const factors = [];
    let level = 'non_valutato';
    if (killers.length) { level = 'non_qualificabile'; factors.push({ tone: 'rd', text: `${killers.map(d => d.name).join(', ')}: respinto o scaduto`, effect: 'non qualificabile' }); }
    else if (allOk) {
      level = 'sufficiente';
      factors.push({ tone: 'gr', text: `Documenti obbligatori tutti approvati (${st.checklists.filter(c => !c.optional).map(c => c.code).join(', ')})`, effect: 'base' });
      if (certs.length >= 2) { level = 'buono'; factors.push({ tone: 'gr', text: `${certs.length} certificazioni della CL6: ${certs.map(d => d.name.replace(/^Certificazione /, '')).join(', ')}`, effect: '+1 livello' }); }
      if ((certs.length >= 3 || legality) && level === 'buono' && !rej.n) { level = 'certificato'; factors.push({ tone: 'gr', text: legality ? 'Rating di legalità valido' : '3 o più certificazioni', effect: '+1 livello' }); }
    } else factors.push({ tone: 'am', text: `${required.filter(d => !H.isOk(d.state)).length} documenti obbligatori non ancora approvati`, effect: 'resta da valutare' });
    if (rej.n) factors.push({ tone: 'am', text: `${rej.n} ${rej.n === 1 ? 'documento respinto' : 'documenti respinti'} negli ultimi 12 mesi`, effect: 'da sapere' });
    res.json({ proposed: level, label: H.LEVELS[level], current: q.level, factors,
      rules: { non_qualificabile: 'DURC, whitelist, antimafia o art. 14 respinti o scaduti', sufficiente: 'tutti i documenti obbligatori approvati', buono: '+ almeno 2 certificazioni della CL6 valide', certificato: '+ 3 certificazioni o rating di legalità, nessun respinto in 12 mesi' } });
  });
}

module.exports = { registerHqseVerifica, MOTIVI };
