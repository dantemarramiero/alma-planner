// HQSE: stato dei documenti richiesti a fornitori, dipendenti e mezzi (lo usano Alma e il portale del fornitore).
// Per ogni documento richiesto si guarda l'ultimo caricato. Se l'ultimo è un rinnovo ancora in verifica e il precedente
// approvato vale ancora, vale il precedente (stato «approvato» o «in scadenza», con renewal_pending): niente blocco.
const H = require('./hqse');

const key = (s, w, m, t) => `${s}:${w || 0}:${m || 0}:${t}`;

async function computeStates(db, supplierIds, today) {
  const blank = () => ({ checklists: [], workers: { total: 0, ok: 0 }, vehicles: { total: 0, ok: 0 }, worker_docs: {}, vehicle_docs: {} });
  const out = Object.fromEntries(supplierIds.map(id => [id, blank()]));
  if (!supplierIds.length) return out;
  const [{ rows: asg }, { rows: latest }, { rows: approved }, { rows: workers }, { rows: vehicles }] = await Promise.all([
    db.query(`SELECT a.supplier_id, a.worker_id, a.vehicle_id, a.origin, c.id AS checklist_id, c.code, c.name, c.kind, c.optional, c.commesse,
                     t.id AS type_id, t.name AS type_name, t.instructions, t.template_name, t.blocking, t.notice_days, t.validity_rule, t.validity_months, cd.sort
                FROM hqse_assignments a JOIN hqse_checklists c ON c.id = a.checklist_id
                JOIN hqse_checklist_docs cd ON cd.checklist_id = c.id JOIN hqse_doc_types t ON t.id = cd.doc_type_id AND NOT t.archived
               WHERE a.supplier_id = ANY($1::int[]) ORDER BY c.sort, cd.sort`, [supplierIds]),
    db.query(`SELECT DISTINCT ON (supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), doc_type_id)
                     id, supplier_id, worker_id, vehicle_id, doc_type_id, status, valid_to, extended_to, reason, created_at
                FROM hqse_documents WHERE supplier_id = ANY($1::int[]) AND status <> 'superato'
               ORDER BY supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), doc_type_id, created_at DESC`, [supplierIds]),
    db.query(`SELECT DISTINCT ON (supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), doc_type_id)
                     id, supplier_id, worker_id, vehicle_id, doc_type_id, status, valid_to, extended_to, reason, created_at
                FROM hqse_documents WHERE supplier_id = ANY($1::int[]) AND status = 'approvato'
               ORDER BY supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), doc_type_id, created_at DESC`, [supplierIds]),
    db.query('SELECT id, supplier_id FROM hqse_workers WHERE supplier_id = ANY($1::int[]) AND ended_on IS NULL', [supplierIds]),
    db.query('SELECT id, supplier_id FROM hqse_vehicles WHERE supplier_id = ANY($1::int[])', [supplierIds]),
  ]);
  const lastBy = new Map(latest.map(d => [key(d.supplier_id, d.worker_id, d.vehicle_id, d.doc_type_id), d]));
  const okBy = new Map(approved.map(d => [key(d.supplier_id, d.worker_id, d.vehicle_id, d.doc_type_id), d]));
  const activeW = new Set(workers.map(w => w.id));
  const activeV = new Set(vehicles.map(m => m.id));
  const subjectOk = new Map();
  const lists = new Map();
  for (const r of asg) {
    if (r.worker_id && !activeW.has(r.worker_id)) continue;
    if (r.vehicle_id && !activeV.has(r.vehicle_id)) continue;
    const k = key(r.supplier_id, r.worker_id, r.vehicle_id, r.type_id);
    const last = lastBy.get(k);
    let st = H.docState(r, last, today);
    let renewal = false;
    if (last && last.status === 'in_verifica' && okBy.get(k)) {
      const prev = H.docState(r, okBy.get(k), today);
      if (H.isOk(prev.state)) { st = prev; renewal = true; }
    }
    const item = {
      type_id: r.type_id, name: r.type_name, instructions: r.instructions, template: r.template_name, blocking: r.blocking,
      validity: H.validityLabel(r.validity_rule, r.validity_months), validity_rule: r.validity_rule, validity_months: r.validity_months, document_id: last?.id || null, renewal_pending: renewal, ...st,
    };
    const s = out[r.supplier_id];
    if (r.worker_id || r.vehicle_id) {
      const bag = r.worker_id ? s.worker_docs : s.vehicle_docs;
      const id = r.worker_id || r.vehicle_id;
      const list = (bag[id] ||= []);
      if (!list.some(x => x.type_id === item.type_id)) list.push({ ...item, checklist: r.name });
      const sk = `${r.supplier_id}:${r.worker_id ? 'w' : 'v'}:${id}`;
      subjectOk.set(sk, (subjectOk.get(sk) ?? true) && (!r.blocking || H.isOk(st.state)));
      continue;
    }
    const lk = `${r.supplier_id}:${r.checklist_id}`;
    if (!lists.has(lk)) {
      const cl = { id: r.checklist_id, code: r.code, name: r.name, optional: r.optional, commesse: r.commesse, origin: r.origin, docs: [] };
      lists.set(lk, cl);
      s.checklists.push(cl);
    }
    lists.get(lk).docs.push(item);
  }
  for (const s of Object.values(out)) for (const cl of s.checklists) Object.assign(cl, H.checklistProgress(cl.docs));
  for (const w of workers) { const o = out[w.supplier_id].workers; o.total++; if (subjectOk.get(`${w.supplier_id}:w:${w.id}`) !== false) o.ok++; }
  for (const m of vehicles) { const o = out[m.supplier_id].vehicles; o.total++; if (subjectOk.get(`${m.supplier_id}:v:${m.id}`) !== false) o.ok++; }
  for (const s of Object.values(out)) {
    const list = [...new Map(s.checklists.filter(c => !c.optional).flatMap(c => c.docs).map(d => [d.type_id, d])).values()];
    s.docs = {
      total: list.length,
      ok: list.filter(d => H.isOk(d.state)).length,
      in_verifica: list.filter(d => d.state === 'in_verifica').length,
      respinti: list.filter(d => d.state === 'respinto' || d.state === 'integrazione').length,
      mancanti: list.filter(d => d.state === 'da_caricare').length,
      scaduti: list.filter(d => d.state === 'scaduto').length,
      in_scadenza: list.filter(d => d.state === 'in_scadenza').length,
      bloccanti: list.filter(d => d.blocking && !H.isOk(d.state)).length,
    };
  }
  return out;
}

// assegna checklist a un fornitore, a un suo dipendente o a un suo mezzo (doppioni ignorati)
async function assign(db, { supplierId, workerId = null, vehicleId = null, checklistIds, origin, userId = null }) {
  for (const cid of checklistIds) {
    await db.query(`INSERT INTO hqse_assignments (supplier_id, worker_id, vehicle_id, checklist_id, origin, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), checklist_id) DO NOTHING`, [supplierId, workerId, vehicleId, cid, origin, userId]);
  }
}

// checklist di un dipendente dalle risposte alle 23 domande (codici → id)
async function workerChecklists(db, answers = {}) {
  const codes = new Set();
  const rapporto = answers.rapporto || 'dipendente';
  codes.add(rapporto === 'datore_lavoratore' ? 'R-DDL' : 'R-DIP');
  if (rapporto === 'distaccato') codes.add('R-DIST');
  for (const d of H.catalogo.DOMANDE_RISORSA) if (d.yes && answers[d.key] === true) codes.add(d.yes);
  const { rows } = await db.query('SELECT id, code FROM hqse_checklists WHERE code = ANY($1::text[]) AND NOT archived', [[...codes]]);
  return rows.map(r => r.id);
}

module.exports = { computeStates, assign, workerChecklists };
