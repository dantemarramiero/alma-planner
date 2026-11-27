// HQSE fase 5 (ALM2-105): import da Vittoria con il pacchetto neutro (tavole 25–27).
//   fornitori.csv  id_vittoria; denominazione; partita_iva; codice_fiscale; email; referente; telefono; citta; stato; categoria
//   dipendenti.csv id_vittoria; id_fornitore; nome; cognome; codice_fiscale; assunto_il; attivo
//   documenti.csv  id_vittoria; id_fornitore; id_dipendente; documento; stato; data_documento; scadenza; file
// Entra: fornitori non terminati, dipendenti attivi, documenti approvati e ancora validi con il loro file.
// Il CRM resta l'anagrafica unica: P.IVA per le aziende, codice fiscale per le persone. Rifare l'import aggiorna, non duplica.
const crypto = require('node:crypto');
const H = require('./hqse');
const S = require('./hqse-stato');

const norm = s => String(s ?? '').trim();
const key = s => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const docKey = s => norm(s).toLowerCase().replace(/\s+/g, ' ');
const digits = s => String(s || '').replace(/^IT/i, '').replace(/\D/g, '');
const firmName = s => String(s || '').toLowerCase().replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc\.?\s*coop\.?|unipersonale|ditta|impresa)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const ALIASES = {
  id_vittoria: ['id_vittoria', 'id', 'codice', 'cod', 'codice_vittoria'],
  denominazione: ['denominazione', 'ragione_sociale', 'nome_azienda', 'fornitore', 'azienda'],
  partita_iva: ['partita_iva', 'piva', 'p_iva', 'p_i', 'vat'],
  codice_fiscale: ['codice_fiscale', 'cf', 'c_f'],
  email: ['email', 'e_mail', 'mail', 'email_referente', 'pec'],
  referente: ['referente', 'responsabile', 'contatto'],
  telefono: ['telefono', 'tel', 'cellulare'],
  citta: ['citta', 'comune', 'localita'],
  stato: ['stato', 'status', 'stato_documento', 'esito'],
  categoria: ['categoria', 'tipo', 'tipologia', 'tipo_appalto', 'categoria_registrazione'],
  id_fornitore: ['id_fornitore', 'codice_fornitore', 'fornitore_id'],
  id_dipendente: ['id_dipendente', 'id_risorsa', 'codice_risorsa', 'risorsa_id'],
  nome: ['nome'], cognome: ['cognome'],
  assunto_il: ['assunto_il', 'data_assunzione'],
  attivo: ['attivo', 'attiva'],
  documento: ['documento', 'tipo_documento', 'nome_documento'],
  data_documento: ['data_documento', 'data_rilascio', 'data_emissione', 'data_firma', 'data'],
  scadenza: ['scadenza', 'data_scadenza', 'valido_fino_al', 'valido_al'],
  file: ['file', 'nome_file', 'allegato', 'percorso'],
};

// CSV con ; o , e virgolette; prima riga = intestazioni
function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  if (!src.trim()) return [];
  const firstLine = src.slice(0, src.indexOf('\n') > -1 ? src.indexOf('\n') : src.length);
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(key);
  const col = {};
  for (const [k, list] of Object.entries(ALIASES)) { const i = head.findIndex(h => list.includes(h)); if (i >= 0) col[k] = i; }
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(Object.entries(col).map(([k, i]) => [k, norm(r[i])])));
}

// date: 2026-03-01, 01/03/2026, 1-3-26
function date(s) {
  const t = norm(s);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const yes = s => !/^(no|n|0|false|falso|inattivo|non attivo)$/i.test(norm(s));
const STATUS = s => { const t = norm(s).toLowerCase(); return t.startsWith('sospes') ? 'sospeso' : t.startsWith('termin') || t.startsWith('cessat') ? 'terminato' : t.includes('valutazione') ? 'in_qualifica' : 'attivo'; };
const TIPO = s => { const t = norm(s).toLowerCase(); return t.includes('professionist') ? 'professionista' : t.includes('material') ? 'materiali' : t.includes('servizi') && t.includes('lavori') ? 'lavori_servizi' : t.includes('servizi') ? 'servizi' : 'lavori'; };
const APPROVED = s => /approvat|valid|conforme|ok/i.test(norm(s)) && !/non/i.test(norm(s));

// ── 1 · carica il pacchetto e abbina ──────────────────────────────────────────────────────────────
async function stage(db, { source = 'export', fornitori = '', dipendenti = '', documenti = '', userId = null }) {
  const F = parseCsv(fornitori), W = parseCsv(dipendenti), D = parseCsv(documenti);
  if (!F.length) throw Object.assign(new Error('Il file dei fornitori è vuoto o senza intestazioni'), { status: 400 });
  if (!F.every(f => f.id_vittoria && f.denominazione)) throw Object.assign(new Error('Ogni fornitore deve avere id_vittoria e denominazione'), { status: 400 });
  const counts = { fornitori: F.length, dipendenti: W.length, documenti: D.length, file: D.filter(d => d.file).length };
  return db.tx(async q => {
    const { rows: [imp] } = await q.query('INSERT INTO hqse_imports (source, counts, created_by) VALUES ($1, $2, $3) RETURNING id', [source, JSON.stringify(counts), userId]);
    for (const f of F) {
      const vat = digits(f.partita_iva);
      const cf = norm(f.codice_fiscale).toUpperCase();
      const st = STATUS(f.stato);
      let match = 'nuovo', reason = 'P.IVA non c\'è nel CRM', subjectId = null;
      if (st === 'terminato') { match = 'storico'; reason = 'Terminato in Vittoria: solo storico'; }
      else if (!vat && /^[A-Z]{6}\d{2}/.test(cf)) {
        const { rows: [s] } = await q.query("SELECT id FROM crm_subjects WHERE (upper(tax_code) = $1 OR upper(vat) = $1) AND merged_into IS NULL LIMIT 1", [cf]);
        match = 'dubbio'; reason = 'Codice fiscale al posto della P.IVA'; subjectId = s?.id || null;
      } else if (vat.length !== 11) { match = 'dubbio'; reason = vat ? 'P.IVA non valida' : 'Manca la P.IVA'; }
      else {
        const { rows: [s] } = await q.query("SELECT id, name FROM crm_subjects WHERE regexp_replace(vat, '\\D', '', 'g') = $1 AND merged_into IS NULL ORDER BY id LIMIT 1", [vat]);
        if (s) {
          subjectId = s.id;
          const a = firmName(s.name), b = firmName(f.denominazione);
          if (a === b || a.includes(b) || b.includes(a)) { match = 'crm'; reason = 'Stessa P.IVA'; } else { match = 'dubbio'; reason = 'Nome diverso, P.IVA uguale'; }
        }
      }
      await q.query(`INSERT INTO hqse_import_suppliers (import_id, vittoria_id, name, vat, tax_code, email, referente, phone, city, status_v, tipo, match, reason, subject_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (import_id, vittoria_id) DO NOTHING`,
      [imp.id, f.id_vittoria, f.denominazione.slice(0, 300), vat, cf, (f.email || '').toLowerCase(), f.referente || '', f.telefono || '', f.citta || '', f.stato || '', TIPO(f.categoria), match, reason, subjectId]);
    }
    for (const w of W) {
      if (!w.id_vittoria || !w.id_fornitore) continue;
      await q.query(`INSERT INTO hqse_import_workers (import_id, vittoria_id, supplier_vittoria_id, first_name, last_name, tax_code, hired_on, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (import_id, vittoria_id) DO NOTHING`,
      [imp.id, w.id_vittoria, w.id_fornitore, w.nome || '', w.cognome || '', (w.codice_fiscale || '').toUpperCase(), date(w.assunto_il), w.attivo === undefined ? true : yes(w.attivo)]);
    }
    let n = 0;
    for (const d of D) {
      if (!d.id_fornitore || !d.documento) continue;
      await q.query(`INSERT INTO hqse_import_docs (import_id, vittoria_id, supplier_vittoria_id, worker_vittoria_id, doc_name, status_v, issued_on, valid_to, file_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (import_id, vittoria_id) DO NOTHING`,
      [imp.id, d.id_vittoria || `riga-${++n}`, d.id_fornitore, d.id_dipendente || '', d.documento.slice(0, 300), d.stato || '', date(d.data_documento), date(d.scadenza), d.file || '']);
    }
    return imp.id;
  });
}

// tipo di documento di Vittoria → nostro: mappa salvata, poi nome uguale (nostro o di Vittoria)
async function typeMap(db) {
  const { rows: types } = await db.query('SELECT id, code, name, scope, validity_rule, validity_months FROM hqse_doc_types WHERE NOT archived');
  const { rows: saved } = await db.query('SELECT vittoria_name, doc_type_id, skip FROM hqse_doc_type_map');
  const byName = new Map(types.map(t => [docKey(t.name), t]));
  const byId = new Map(types.map(t => [t.id, t]));
  const savedBy = new Map(saved.map(s => [s.vittoria_name, s]));
  return name => {
    const k = docKey(name);
    const s = savedBy.get(k);
    if (s) return s.skip ? { skip: true } : { type: byId.get(s.doc_type_id) };
    const t = byName.get(k);
    return t ? { type: t } : null;
  };
}

// ── anteprima e abbinamento (tavole 25 e 26) ──────────────────────────────────────────────────────
async function overview(db, id, today) {
  const { rows: [imp] } = await db.query('SELECT * FROM hqse_imports WHERE id = $1', [id]);
  if (!imp) return null;
  const { rows: sup } = await db.query(`SELECT s.*, c.name AS crm_name FROM hqse_import_suppliers s LEFT JOIN crm_subjects c ON c.id = s.subject_id WHERE s.import_id = $1 ORDER BY s.match = 'dubbio' AND NOT s.decided DESC, lower(s.name)`, [id]);
  const { rows: [w] } = await db.query(`SELECT COUNT(*) FILTER (WHERE active)::int AS attivi, COUNT(*) FILTER (WHERE active AND tax_code = '')::int AS senza_cf, COUNT(*)::int AS tutti FROM hqse_import_workers WHERE import_id = $1`, [id]);
  const { rows: names } = await db.query('SELECT doc_name, COUNT(*)::int AS n FROM hqse_import_docs WHERE import_id = $1 GROUP BY doc_name ORDER BY COUNT(*) DESC', [id]);
  const map = await typeMap(db);
  const tipi = names.map(r => { const m = map(r.doc_name); return { name: r.doc_name, n: r.n, doc_type_id: m?.type?.id || null, doc_type: m?.type?.name || null, skip: Boolean(m?.skip) }; });
  const { rows: [d] } = await db.query(`SELECT COUNT(*)::int AS tutti, COUNT(*) FILTER (WHERE (valid_to IS NULL OR valid_to >= $2))::int AS validi,
      COUNT(*) FILTER (WHERE file_key <> '')::int AS con_file,
      (SELECT COUNT(*)::int FROM hqse_import_files f WHERE f.import_id = $1) AS file_arrivati FROM hqse_import_docs WHERE import_id = $1`, [id, today]);
  const approvedValid = (await db.query('SELECT status_v, valid_to FROM hqse_import_docs WHERE import_id = $1', [id])).rows.filter(r => APPROVED(r.status_v) && (!r.valid_to || iso(r.valid_to) >= today)).length;
  const c = k => sup.filter(s => s.match === k).length;
  return {
    import: { id: imp.id, source: imp.source, status: imp.status, created_at: imp.created_at, run_at: imp.run_at, summary: imp.summary },
    preview: {
      fornitori: { tutti: sup.length, entrano: sup.length - c('storico'), storico: c('storico') },
      dipendenti: { tutti: w.tutti, entrano: w.attivi, senza_cf: w.senza_cf },
      documenti: { tutti: d.tutti, entrano: approvedValid },
      file: { indicati: d.con_file, arrivati: d.file_arrivati },
    },
    match: { crm: c('crm'), nuovo: c('nuovo'), dubbio: sup.filter(s => s.match === 'dubbio' && !s.decided).length, decisi: sup.filter(s => s.decided).length },
    tipi: { tutti: tipi.length, abbinati: tipi.filter(t => t.doc_type_id || t.skip).length, list: tipi },
    suppliers: sup.map(s => ({ id: s.id, vittoria_id: s.vittoria_id, name: s.name, vat: s.vat || s.tax_code, match: s.match, reason: s.reason, decided: s.decided, subject_id: s.subject_id, crm_name: s.crm_name })),
  };
}
const iso = d => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

// ── 2 · importa (tavola 27) ───────────────────────────────────────────────────────────────────────
async function run(db, id, { userId = null, today, limit = null } = {}) {
  const { rows: [imp] } = await db.query("UPDATE hqse_imports SET status = 'in_corso', run_started = now(), run_by = $2 WHERE id = $1 AND status <> 'in_corso' RETURNING *", [id, userId]);
  if (!imp) throw Object.assign(new Error('Import non trovato o già in corso'), { status: 409 });
  try {
    await H.ready(db);
    const map = await typeMap(db);
    const out = { fornitori: 0, collegati: 0, nuovi: 0, aggiornati: 0, dipendenti: 0, senza_cf: 0, documenti: 0, gia_presenti: 0, scarti: {} };
    const drop = (why) => { out.scarti[why] = (out.scarti[why] || 0) + 1; };
    const { rows: sups } = await db.query("SELECT * FROM hqse_import_suppliers WHERE import_id = $1 AND match <> 'storico' AND NOT (match = 'dubbio' AND NOT decided) ORDER BY id", [id]);
    const { rows: [skipped] } = await db.query("SELECT COUNT(*)::int AS n FROM hqse_import_suppliers WHERE import_id = $1 AND match = 'dubbio' AND NOT decided", [id]);
    if (skipped.n) out.scarti['Fornitore da abbinare a mano'] = skipped.n;
    const when = today.split('-').reverse().join('/');
    for (const f of limit ? sups.slice(0, limit) : sups) {
      await db.tx(async q => {
        // azienda nel CRM
        let subjectId = f.subject_id;
        if (!subjectId) { // già importato in un giro precedente, o arrivato nel CRM nel frattempo
          const { rows: [ex] } = await q.query('SELECT subject_id FROM hqse_suppliers WHERE vittoria_id = $1', [f.vittoria_id]);
          const { rows: [byVat] } = ex || !f.vat ? { rows: [] } : await q.query("SELECT id FROM crm_subjects WHERE regexp_replace(vat, '\\D', '', 'g') = $1 AND merged_into IS NULL LIMIT 1", [f.vat]);
          subjectId = ex?.subject_id || byVat?.id || null;
          if (subjectId) await q.query('UPDATE hqse_import_suppliers SET subject_id = $2 WHERE id = $1', [f.id, subjectId]);
        }
        if (subjectId) await q.query("UPDATE crm_subjects SET roles = array_append(roles, 'fornitore') WHERE id = $1 AND NOT ('fornitore' = ANY(roles))", [subjectId]);
        else {
          const { rows: [s] } = await q.query("INSERT INTO crm_subjects (name, vat, tax_code, email, phone, city, roles) VALUES ($1, $2, $3, $4, $5, $6, '{fornitore}') RETURNING id",
            [f.name.slice(0, 200), f.vat, f.vat ? '' : f.tax_code, f.email, f.phone, f.city]);
          subjectId = s.id; out.nuovi++;
          await q.query('UPDATE hqse_import_suppliers SET subject_id = $2 WHERE id = $1', [f.id, subjectId]);
        }
        // fornitore in qualifica
        let { rows: [sup] } = await q.query('SELECT id FROM hqse_suppliers WHERE vittoria_id = $1 OR subject_id = $2 ORDER BY vittoria_id = $1 DESC LIMIT 1', [f.vittoria_id, subjectId]);
        if (sup) { await q.query("UPDATE hqse_suppliers SET vittoria_id = $2, from_vittoria = true, updated_at = now() WHERE id = $1", [sup.id, f.vittoria_id]); out.aggiornati++; }
        else {
          ({ rows: [sup] } = await q.query(`INSERT INTO hqse_suppliers (subject_id, tipo_appalto, status, vittoria_id, from_vittoria, created_by) VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
            [subjectId, f.tipo, STATUS(f.status_v), f.vittoria_id, userId]));
          const { rows: cls } = await q.query(`SELECT c.id FROM hqse_appalto_checklists a JOIN hqse_checklists c ON c.id = a.checklist_id WHERE a.tipo = $1 UNION SELECT id FROM hqse_checklists WHERE code = 'WL'`, [f.tipo]);
          await S.assign(q, { supplierId: sup.id, checklistIds: cls.map(c => c.id), origin: 'vittoria', userId });
          if (f.subject_id) out.collegati++;
        }
        await q.query('UPDATE hqse_import_suppliers SET supplier_id = $2 WHERE id = $1', [f.id, sup.id]);
        if (require('./hqse-portale').validEmail(f.email)) {
          await q.query(`INSERT INTO hqse_portal_users (supplier_id, email, name, role, invited_by) VALUES ($1, $2, $3, 'referente', 'vittoria') ON CONFLICT (supplier_id, email) DO NOTHING`, [sup.id, f.email, f.referente]);
        }
        // dipendenti attivi: contatti del CRM collegati all'azienda
        const { rows: ws } = await q.query('SELECT * FROM hqse_import_workers WHERE import_id = $1 AND supplier_vittoria_id = $2 AND active', [id, f.vittoria_id]);
        const workerOf = {};
        const base = await S.workerChecklists(q, {});
        for (const w of ws) {
          let { rows: [hw] } = await q.query("SELECT id FROM hqse_workers WHERE supplier_id = $1 AND (vittoria_id = $2 OR (tax_code <> '' AND tax_code = $3)) LIMIT 1", [sup.id, w.vittoria_id, w.tax_code]);
          if (!hw) {
            const { rows: [c] } = await q.query('INSERT INTO crm_contacts (first_name, last_name) VALUES ($1, $2) RETURNING id', [w.first_name || '-', w.last_name || '-']);
            await q.query("INSERT INTO crm_contact_links (contact_id, subject_id, job, date_from) VALUES ($1, $2, 'dipendente (qualifica HQSE)', $3) ON CONFLICT DO NOTHING", [c.id, subjectId, w.hired_on]);
            ({ rows: [hw] } = await q.query('INSERT INTO hqse_workers (supplier_id, contact_id, tax_code, hired_on, vittoria_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [sup.id, c.id, w.tax_code, w.hired_on, w.vittoria_id]));
            await S.assign(q, { supplierId: sup.id, workerId: hw.id, checklistIds: base, origin: 'vittoria', userId });
            out.dipendenti++;
            if (!w.tax_code) out.senza_cf++;
          }
          workerOf[w.vittoria_id] = hw.id;
          await q.query('UPDATE hqse_import_workers SET worker_id = $2 WHERE id = $1', [w.id, hw.id]);
        }
        // documenti approvati e validi, con il file
        const { rows: ds } = await q.query('SELECT * FROM hqse_import_docs WHERE import_id = $1 AND supplier_vittoria_id = $2', [id, f.vittoria_id]);
        for (const d of ds) {
          const set = (outcome, reason, docId = null) => q.query('UPDATE hqse_import_docs SET outcome = $2, skip_reason = $3, document_id = $4 WHERE id = $1', [d.id, outcome, reason, docId]);
          if (!APPROVED(d.status_v)) { await set('non_valido', 'Non approvato in Vittoria'); continue; }
          const m = map(d.doc_name);
          if (m?.skip) { await set('scartato', 'Tipo «Non importare»'); drop('Tipo «Non importare»'); continue; }
          if (!m?.type) { await set('scartato', 'Tipo di documento non abbinato'); drop('Tipo di documento non abbinato'); continue; }
          const workerId = d.worker_vittoria_id ? workerOf[d.worker_vittoria_id] : null;
          if (d.worker_vittoria_id && !workerId) { await set('scartato', 'Dipendente non attivo o non trovato'); drop('Dipendente non attivo o non trovato'); continue; }
          const validTo = iso(d.valid_to) || H.computeValidTo(m.type, { issued_on: iso(d.issued_on) });
          if (m.type.validity_rule !== 'nessuna' && !validTo) { await set('scartato', 'Data di scadenza mancante'); drop('Data di scadenza mancante'); continue; }
          if (validTo && validTo < today) { await set('non_valido', 'Scaduto'); continue; }
          const { rows: [dup] } = await q.query('SELECT id FROM hqse_documents WHERE supplier_id = $1 AND vittoria_id = $2', [sup.id, d.vittoria_id]);
          if (dup) { await set('importato', '', dup.id); out.gia_presenti++; continue; }
          const { rows: [file] } = d.file_key ? await q.query('SELECT * FROM hqse_import_files WHERE import_id = $1 AND file_key = $2', [id, d.file_key]) : { rows: [] };
          if (!file) { await set('scartato', 'Documento approvato senza file'); drop('Documento approvato senza file'); continue; }
          if (!file.size) { await set('scartato', 'File illeggibile o vuoto'); drop('File illeggibile o vuoto'); continue; }
          const { rows: [hf] } = await q.query('INSERT INTO hqse_files (supplier_id, name, mime, size, sha256, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [sup.id, file.name, file.mime, file.size, file.sha256, file.data]);
          const { rows: [doc] } = await q.query(`INSERT INTO hqse_documents (supplier_id, worker_id, doc_type_id, status, file_name, file_id, issued_on, valid_to, decided_by, decided_at, vittoria_id, uploaded_by, reason)
             VALUES ($1, $2, $3, 'approvato', $4, $5, $6, $7, $8, now(), $9, 'Vittoria', 'Approvato in Vittoria') RETURNING id`,
          [sup.id, workerId, m.type.id, file.name, hf.id, iso(d.issued_on), validTo, userId, d.vittoria_id]);
          await set('importato', '', doc.id);
          out.documenti++;
        }
        await q.query('INSERT INTO hqse_events (supplier_id, text, actor_id) VALUES ($1, $2, $3)', [sup.id, `Importato da Vittoria il ${when}`, userId]);
      });
      out.fornitori++;
    }
    out.da_caricare = await missingCount(db, id, today);
    await db.query("UPDATE hqse_imports SET status = 'importato', run_at = now(), summary = $2 WHERE id = $1", [id, JSON.stringify(out)]);
    return out;
  } catch (err) {
    await db.query("UPDATE hqse_imports SET status = 'caricato' WHERE id = $1", [id]);
    throw err;
  }
}

// documenti richiesti ancora da caricare dai fornitori importati
async function missingCount(db, id, today) {
  const { rows } = await db.query('SELECT DISTINCT supplier_id FROM hqse_import_suppliers WHERE import_id = $1 AND supplier_id IS NOT NULL', [id]);
  if (!rows.length) return 0;
  const st = await S.computeStates(db, rows.map(r => r.supplier_id), today);
  return Object.values(st).reduce((n, s) => n + (s.docs?.mancanti || 0) + (s.docs?.scaduti || 0), 0);
}

async function addFile(db, id, { file_key: fk, nome, mime, base64 }) {
  const k = norm(fk);
  if (!k || !nome) throw Object.assign(new Error('Servono file_key e nome'), { status: 400 });
  const data = Buffer.from(String(base64 || ''), 'base64');
  if (data.length > 25 * 1024 * 1024) throw Object.assign(new Error('File troppo grande (massimo 25 MB)'), { status: 413 });
  await db.query(`INSERT INTO hqse_import_files (import_id, file_key, name, mime, size, sha256, data) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (import_id, file_key) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, size = EXCLUDED.size, sha256 = EXCLUDED.sha256, data = EXCLUDED.data`,
  [id, k, String(nome).slice(0, 200), String(mime || 'application/pdf').slice(0, 100), data.length, crypto.createHash('sha256').update(data).digest('hex'), data]);
}

module.exports = { parseCsv, date, stage, overview, run, addFile, typeMap, docKey, digits, APPROVED, STATUS, TIPO };
