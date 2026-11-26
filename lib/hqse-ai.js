// HQSE fase 3 (ALM2-103): l'AI legge il documento e propone; decide sempre una persona HQSE.
// - Lettura con il modello di Alma (OpenAI, come i CV di Alma HR): tipo, intestatario, date, campi utili ai controlli
//   (CCNL, medico, massimale, conflitto d'interessi), e l'esito di ogni controllo scritto in «Checklist e regole».
// - La proposta finale la calcola questo file con regole fisse sopra la lettura (scaduto, intestatario sbagliato,
//   controllo «respingi» fallito, CCNL o medico diversi da quelli dichiarati…), così non dipende solo dal modello.
// - Senza chiave (in locale e nei test) nessuna lettura: proposta «incerto», tutto a mano. I test possono mettere un
//   lettore finto con setReader().
// - Il costo va in assistant_usage (budget AI di Alma), con l'utente HQSE che rilegge oppure senza utente (portale).
const crypto = require('crypto');
const H = require('./hqse');

const iso = d => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const vatOf = s => String(s || '').replace(/\D/g, '');
const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

let customReader = null;
const setReader = fn => { customReader = fn; };

function prompt({ type, expected }) {
  const checks = (type.ai_checks || []).map((c, i) => `${i + 1}. ${c.text}`).join('\n') || '(nessuno: guarda solo tipo, intestatario e date)';
  return [
    'Sei l\'ufficio HQSE di Almacis (impresa di costruzioni e impianti). Controlli i documenti caricati dai fornitori per la qualifica.',
    `Documento richiesto: «${type.name}».`,
    type.instructions ? `Istruzioni date al fornitore: ${type.instructions}` : '',
    `Regola di validità: ${H.validityLabel(type.validity_rule, type.validity_months)}.`,
    `Azienda attesa: ${expected.supplier} (P.IVA ${expected.vat || 'non nota'}).`,
    expected.worker ? `Dipendente atteso: ${expected.worker}${expected.taxCode ? ` (CF ${expected.taxCode})` : ''}.` : '',
    expected.ccnl ? `CCNL dichiarato dall'azienda: ${expected.ccnl}.` : '',
    expected.medico ? `Medico competente dichiarato dall'azienda: ${expected.medico}.` : '',
    `Controlli da fare:\n${checks}`,
    'Rispondi SOLO con JSON valido, senza testo intorno:',
    '{"tipo_ok": true|false, "tipo_letto": "che documento è", "intestatario": "nome sul documento", "piva_o_cf": "se c\'è", "data_documento": "AAAA-MM-GG di firma, rilascio o attestato, o null", "scadenza": "AAAA-MM-GG scritta sul documento, o null",',
    ' "campi": {"ccnl": "se c\'è", "medico": "se c\'è chi firma come medico", "massimale_eur": numero o null, "conflitto_interessi": true|false|null, "firme_mancanti": ["…"]},',
    ' "controlli": [{"n": numero del controllo, "ok": true|false|null, "nota": "breve"}], "motivo": "se qualcosa non va: 1-3 frasi per il fornitore, cortesi, che dicono cosa ricaricare; altrimenti stringa vuota"}',
    'Mai inventare: se un dato non si legge, null. Le date in formato AAAA-MM-GG.',
  ].filter(Boolean).join('\n');
}

async function modelReader({ type, file, expected }) {
  const { apiKey, openaiCall, textOf, MODELS, costOf } = require('./assistente-openai');
  if (!apiKey()) return null;
  const b64 = file.data.toString('base64');
  let part;
  if (file.mime === 'application/pdf') part = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: file.name };
  else if (/^image\/(png|jpeg|webp)$/.test(file.mime)) part = { type: 'image', source: { type: 'base64', media_type: file.mime, data: b64 } };
  else return null; // Word e HEIC: da guardare a mano
  const model = process.env.HQSE_AI_MODEL || MODELS.sonnet;
  const r = await openaiCall({ model, max_tokens: 1200, system: 'Rispondi solo con JSON valido.', messages: [{ role: 'user', content: [part, { type: 'text', text: prompt({ type, expected }) }] }] });
  const json = JSON.parse((textOf(r.content).match(/\{[\s\S]*\}/) || ['{}'])[0]);
  return { json, model, cost: costOf(r.usage || {}, model) };
}

// regole fisse sopra la lettura → proposta, controlli con l'esito, motivo per il fornitore
function decide({ type, json, expected, issuedOn, validTo, today = todayRome() }) {
  const out = { checks: [], notes: [], proposal: 'approvabile', reason: String(json.motivo || '').trim().slice(0, 1200) };
  const add = (text, ok, nota = '', onFail = 'respingi') => out.checks.push({ text, ok, nota, on_fail: onFail });
  if (json.tipo_ok === false) add(`È un «${type.name}»`, false, json.tipo_letto ? `sembra: ${json.tipo_letto}` : '');
  else if (json.tipo_ok === true) add(`È un «${type.name}»`, true);
  const vat = vatOf(json.piva_o_cf);
  const nameOk = json.intestatario ? norm(json.intestatario).includes(norm(expected.worker || expected.supplier).split(' ')[0]) : null;
  const idOk = vat ? (vat === vatOf(expected.vat) || (expected.taxCode && norm(json.piva_o_cf).replace(/ /g, '') === norm(expected.taxCode).replace(/ /g, ''))) : null;
  if (nameOk === false && idOk !== true) add(`Intestato a ${expected.worker || expected.supplier}`, false, `sul documento: ${json.intestatario}`);
  else if (nameOk || idOk) add(`Intestato a ${expected.worker || expected.supplier}`, true);
  const until = validTo || (isIso(json.scadenza) ? json.scadenza : null) || (isIso(json.data_documento) && type.validity_months ? H.addMonths(json.data_documento, type.validity_months) : null);
  if (until) add('In corso di validità', until >= today, `fino al ${until.split('-').reverse().join('/')}`);
  const c = json.campi || {};
  if (expected.ccnl && c.ccnl && !norm(c.ccnl).includes(norm(expected.ccnl).split(' ')[0])) add('CCNL uguale a quello dichiarato dall\'azienda', false, `sul documento: ${c.ccnl}; dichiarato: ${expected.ccnl}`, 'chiedi');
  if (expected.medico && c.medico && !norm(c.medico).split(' ').some(w => w.length > 3 && norm(expected.medico).includes(w))) add('Firmato dal medico competente dichiarato', false, `firma: ${c.medico}; dichiarato: ${expected.medico}`);
  if (/1\.000\.000/.test(type.name) && Number(c.massimale_eur) && Number(c.massimale_eur) <= 1000000) add('Massimale superiore a 1.000.000 €', false, `massimale: ${Number(c.massimale_eur).toLocaleString('it-IT')} €`);
  if (Array.isArray(c.firme_mancanti) && c.firme_mancanti.length) add('Firme complete', false, `mancano: ${c.firme_mancanti.join(', ')}`);
  if (c.conflitto_interessi === true) { add('Nessun conflitto d\'interessi dichiarato', false, 'da segnalare ad Almacis prima di decidere', 'chiedi'); out.escalate = true; }
  for (const [i, ch] of (type.ai_checks || []).entries()) {
    const got = (json.controlli || []).find(x => Number(x.n) === i + 1);
    add(ch.text, got ? (got.ok === true ? true : got.ok === false ? false : null) : null, got?.nota || '', ch.on_fail === 'chiedi' ? 'chiedi' : 'respingi');
  }
  const failed = out.checks.filter(x => x.ok === false);
  if (failed.some(x => x.on_fail === 'respingi')) out.proposal = 'respingere';
  else if (failed.length || out.checks.some(x => x.ok === null) || json.tipo_ok == null) out.proposal = 'incerto';
  if (out.proposal === 'respingere' && !out.reason) out.reason = failed.filter(x => x.on_fail === 'respingi').map(x => `${x.text}: no${x.nota ? ` (${x.nota})` : ''}.`).join(' ');
  out.read = { tipo_letto: json.tipo_letto || null, intestatario: json.intestatario || null, data_documento: isIso(json.data_documento) ? json.data_documento : null, scadenza: isIso(json.scadenza) ? json.scadenza : null, campi: c };
  out.valid_to = until;
  return out;
}

// lettura di un file (anche prima del caricamento, dal portale): niente database, solo il risultato
async function read({ type, file, expected }) {
  const reader = customReader || modelReader;
  let got = null;
  try { got = await reader({ type, file, expected }); } catch (err) { return { status: 'errore', error: err.message }; }
  if (!got) return { status: 'spento' };
  const res = decide({ type, json: got.json || {}, expected });
  return { status: 'fatto', ...res, model: got.model || null, cost: got.cost || 0 };
}

async function expectedFor(db, doc) {
  const { rows: [s] } = await db.query(`SELECT c.name, c.vat, q.ccnl, q.medico FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE q.id = $1`, [doc.supplier_id]);
  let worker = null, taxCode = null;
  if (doc.worker_id) {
    const { rows: [w] } = await db.query('SELECT w.tax_code, c.first_name, c.last_name FROM hqse_workers w JOIN crm_contacts c ON c.id = w.contact_id WHERE w.id = $1', [doc.worker_id]);
    if (w) { worker = `${w.first_name} ${w.last_name}`.trim(); taxCode = w.tax_code; }
  }
  return { supplier: s.name, vat: s.vat, ccnl: s.ccnl, medico: s.medico, worker, taxCode };
}

// lettura di un documento caricato: salva proposta e controlli sul documento
async function analyze(db, documentId, { userId = null, cached = null } = {}) {
  const { rows: [d] } = await db.query(`SELECT d.*, f.data, f.mime, f.name AS file_name2 FROM hqse_documents d LEFT JOIN hqse_files f ON f.id = d.file_id WHERE d.id = $1`, [documentId]);
  if (!d || !d.data) return null;
  const { rows: [type] } = await db.query('SELECT * FROM hqse_doc_types WHERE id = $1', [d.doc_type_id]);
  const expected = await expectedFor(db, d);
  const r = cached || await read({ type, file: { data: d.data, mime: d.mime, name: d.file_name2 }, expected });
  if (r.status !== 'fatto') {
    await db.query("UPDATE hqse_documents SET ai_status = $2, ai_proposal = 'incerto', ai_result = $3, ai_at = now() WHERE id = $1", [d.id, r.status, JSON.stringify({ checks: [], notes: [r.error ? `Lettura non riuscita: ${r.error}` : 'Senza AI: da guardare a mano'] })]);
    return r;
  }
  const result = { checks: r.checks, read: r.read, reason: r.reason, escalate: Boolean(r.escalate), model: r.model };
  const fillValid = !d.valid_to && r.valid_to ? r.valid_to : null;
  await db.query(`UPDATE hqse_documents SET ai_status = 'fatto', ai_proposal = $2, ai_result = $3, ai_at = now(),
      issued_on = COALESCE(issued_on, $4), valid_to = COALESCE(valid_to, $5) WHERE id = $1`, [d.id, r.proposal, JSON.stringify(result), r.read.data_documento, fillValid]);
  if (r.cost && !cached) {
    await db.query('INSERT INTO assistant_usage (user_id, conversation_id, model, cost_usd, day) VALUES ($1, NULL, $2, $3, $4)', [userId, r.model || 'hqse', r.cost, todayRome()]).catch(() => {});
  }
  return r;
}

// letture fatte dal portale prima di inviare (stesso file = stessa lettura, niente seconda spesa)
const cache = new Map();
const cacheKey = (typeId, data) => `${typeId}:${crypto.createHash('sha256').update(data).digest('hex')}`;
function remember(typeId, data, r) {
  cache.set(cacheKey(typeId, data), { r, at: Date.now() });
  for (const [k, v] of cache) if (Date.now() - v.at > 30 * 60 * 1000) cache.delete(k);
}
const recall = (typeId, data) => cache.get(cacheKey(typeId, data))?.r || null;

module.exports = { prompt, decide, read, analyze, expectedFor, setReader, remember, recall };
