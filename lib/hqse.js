// HQSE · Qualifica fornitori (ALM2-98, fase 1 ALM2-100): la logica senza HTTP.
// - chi vede il modulo (come Alma Procurement: per ora solo Dante, HQSE_UTENTI su Railway per allargarlo);
// - scadenza di un documento dalla regola del suo tipo (6 mesi dalla firma, 5 anni dall'attestato, data sul documento…);
// - stato di ogni documento richiesto: da caricare, in verifica, respinto, approvato, in scadenza, scaduto;
// - caricamento del catalogo di partenza (lib/hqse-catalogo.js) quando le tabelle sono vuote.
const C = require('./hqse-catalogo');

const HQSE_DEFAULT = ['dante.marramiero@almacis.it'];
function hqseUsers() {
  const raw = process.env.HQSE_UTENTI;
  if (raw) return raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return process.env.NODE_TEST_CONTEXT || process.env.DEV_LOGIN === '1' ? null : HQSE_DEFAULT;
}
const canSee = email => { const list = hqseUsers(); return !list || list.includes(String(email || '').toLowerCase()); };

const RULES = {
  firma: 'mesi dalla firma',
  rilascio: 'mesi dal rilascio',
  attestato: 'mesi dall\'attestato',
  documento: 'data scritta sul documento',
  nessuna: 'non scade',
};
const STATUS = { registrato: 'Registrato', in_qualifica: 'In qualifica', attivo: 'Attivo', sospeso: 'Sospeso', terminato: 'Terminato' };
const LEVELS = { non_valutato: 'Non valutato', non_qualificabile: 'Non qualificabile', sufficiente: 'Sufficiente', buono: 'Buono', certificato: 'Certificato' };
const RISKS = { '': '—', basso: 'Basso', medio: 'Medio', alto: 'Alto', altissimo: 'Altissimo' };
const TIPI = Object.fromEntries(C.TIPI_APPALTO.map(t => [t.key, t]));
const DOC_STATES = {
  da_caricare: 'Da caricare', in_verifica: 'In verifica', respinto: 'Respinto', integrazione: 'Integrazione richiesta', approvato: 'Approvato', in_scadenza: 'In scadenza', scaduto: 'Scaduto',
};

// «12 mesi» si legge meglio «1 anno»; 60 mesi «5 anni»
function validityLabel(rule, months) {
  if (!['firma', 'rilascio', 'attestato'].includes(rule)) return rule === 'nessuna' ? 'Non scade' : 'Data sul documento';
  const span = months % 12 === 0 ? (months === 12 ? '1 anno' : `${months / 12} anni`) : `${months} ${months === 1 ? 'mese' : 'mesi'}`;
  return `${span} ${rule === 'firma' ? 'dalla firma' : rule === 'rilascio' ? 'dal rilascio' : 'dall\'attestato'}`;
}

const iso = d => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// scadenza dalla regola; per «documento» vale la data letta dal documento (valid_to), per «nessuna» null
function computeValidTo({ validity_rule: rule, validity_months: months }, { issued_on, valid_to } = {}) {
  if (rule === 'nessuna') return null;
  if (rule === 'documento') return iso(valid_to);
  return issued_on ? addMonths(iso(issued_on), months) : iso(valid_to);
}

// stato di un documento richiesto, dato l'ultimo caricato (o nessuno)
function docState(type, doc, today) {
  if (!doc) return { state: 'da_caricare' };
  if (doc.status === 'in_verifica') return { state: 'in_verifica' };
  if (doc.status === 'respinto') return { state: 'respinto', reason: doc.reason || '' };
  if (doc.status === 'integrazione') return { state: 'integrazione', reason: doc.reason || '' };
  const until = iso(doc.extended_to) || iso(doc.valid_to);
  if (!until) return { state: 'approvato', until: null };
  const left = daysBetween(today, until);
  if (left < 0) return { state: 'scaduto', until, days: left };
  const first = Math.max(...(type.notice_days?.length ? type.notice_days : [30]));
  return { state: left <= first ? 'in_scadenza' : 'approvato', until, days: left };
}
const isOk = s => s === 'approvato' || s === 'in_scadenza';

// avanzamento di una checklist: quanti documenti in regola su quanti richiesti
function checklistProgress(docs) {
  const ok = docs.filter(d => isOk(d.state)).length;
  const blocked = docs.filter(d => d.blocking && !isOk(d.state)).length;
  return { ok, total: docs.length, blocked, pct: docs.length ? Math.round((ok / docs.length) * 100) : 100 };
}

// carica tipi di documento, checklist e regole del questionario la prima volta (idempotente)
async function ensureCatalog(db) {
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM hqse_checklists');
  if (n) return false;
  const typeId = {};
  for (const t of C.DOC_TYPES) {
    const { rows: [r] } = await db.query(
      `INSERT INTO hqse_doc_types (code, name, scope, instructions, validity_rule, validity_months, blocking, template_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [t.code, t.name, t.scope, t.instructions, t.rule, t.months, t.blocking, t.template]);
    typeId[t.code] = r.id;
  }
  const clId = {};
  for (const [i, c] of C.CHECKLISTS.entries()) {
    const { rows: [r] } = await db.query(
      `INSERT INTO hqse_checklists (code, name, kind, commesse, optional, sort, vittoria_name) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [c.code, c.name, c.kind, c.commesse, c.optional, i, c.vittoria]);
    clId[c.code] = r.id;
    for (const [j, code] of c.docs.entries()) {
      if (!typeId[code]) throw new Error(`hqse: tipo di documento sconosciuto ${code} in ${c.code}`);
      await db.query('INSERT INTO hqse_checklist_docs (checklist_id, doc_type_id, sort) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [r.id, typeId[code], j]);
    }
  }
  for (const t of C.TIPI_APPALTO) for (const code of t.checklists) {
    await db.query('INSERT INTO hqse_appalto_checklists (tipo, checklist_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.key, clId[code]]);
  }
  return true;
}

// catalogo pronto prima della prima richiesta, da Alma o dal portale (una volta per database)
const readyBy = new WeakMap();
function ready(db) {
  if (!readyBy.has(db)) readyBy.set(db, ensureCatalog(db).catch(err => { readyBy.delete(db); throw err; }));
  return readyBy.get(db);
}

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// campi modificabili di un tipo di documento (da «Checklist e regole»)
function docTypeFields(b = {}) {
  const out = {};
  if (b.name !== undefined) { out.name = clean(b.name, 200); if (!out.name) throw bad('Scrivi il nome del documento'); }
  if (b.instructions !== undefined) out.instructions = String(b.instructions ?? '').trim().slice(0, 2000);
  if (b.template_name !== undefined) out.template_name = clean(b.template_name, 200);
  if (b.blocking !== undefined) out.blocking = Boolean(b.blocking);
  if (b.grace_days !== undefined) {
    const g = Number(b.grace_days);
    if (!Number.isInteger(g) || g < 0 || g > 365) throw bad('La proroga va da 0 a 365 giorni');
    out.grace_days = g;
  }
  if (b.notice_days !== undefined) {
    const list = (Array.isArray(b.notice_days) ? b.notice_days : []).map(Number);
    if (!list.length || list.some(x => !Number.isInteger(x) || x < 0 || x > 365)) throw bad('I giorni dei reminder vanno da 0 a 365');
    out.notice_days = [...new Set(list)].sort((a, b) => b - a).slice(0, 6);
  }
  if (b.validity_rule !== undefined) {
    if (!RULES[b.validity_rule]) throw bad('Regola di validità non valida');
    out.validity_rule = b.validity_rule;
    const needs = ['firma', 'rilascio', 'attestato'].includes(b.validity_rule);
    const m = needs ? Number(b.validity_months) : null;
    if (needs && (!Number.isInteger(m) || m < 1 || m > 240)) throw bad('Scrivi quanti mesi vale (da 1 a 240)');
    out.validity_months = m;
  }
  if (b.ai_checks !== undefined) {
    const list = Array.isArray(b.ai_checks) ? b.ai_checks : [];
    out.ai_checks = list.map(x => ({ text: clean(x?.text, 300), on_fail: x?.on_fail === 'chiedi' ? 'chiedi' : 'respingi' })).filter(x => x.text).slice(0, 20);
  }
  return out;
}

module.exports = {
  canSee, RULES, STATUS, LEVELS, RISKS, TIPI, DOC_STATES, validityLabel, addMonths, computeValidTo, docState, isOk,
  checklistProgress, ensureCatalog, ready, docTypeFields, catalogo: C,
};
