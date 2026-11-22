// Unire due schede (canvas v15 · V15-Unisci, via di Dante 22/11/2026): dato per dato si sceglie cosa tenere (dove una è
// vuota si prende l'altra), ruoli/ASA/categorie/SOA/note si sommano, e tutto quello che punta alla scheda che si unisce
// passa a quella che resta. L'azienda unita resta raggiungibile (merged_into); il contatto unito si cancella dopo aver
// spostato tutto.

// dati che si scelgono uno per uno (gli altri si sommano o restano quelli della scheda che resta)
const SUBJECT_FIELDS = ['name', 'short_name', 'kind', 'legal_form', 'vat', 'tax_code', 'ipa_code', 'sdi_code', 'pec', 'email', 'phone', 'website', 'linkedin',
  'address', 'zip', 'city', 'province', 'region', 'ateco', 'employees', 'revenue', 'segment', 'owner_id', 'function_name', 'lead_why', 'potential_value', 'priority',
  'origin', 'referred_by', 'boss_code', 'accounting_code', 'zoho_id', 'vittoria_id', 'status'];
const SUBJECT_LABELS = { name: 'Ragione sociale', short_name: 'Nome breve', kind: 'Tipo', legal_form: 'Forma giuridica', vat: 'P.IVA', tax_code: 'Codice fiscale', ipa_code: 'Codice IPA',
  sdi_code: 'Codice SDI', pec: 'PEC', email: 'Email', phone: 'Telefono', website: 'Sito', linkedin: 'LinkedIn', address: 'Indirizzo', zip: 'CAP', city: 'Comune', province: 'Provincia',
  region: 'Regione', ateco: 'ATECO', employees: 'Dipendenti', revenue: 'Fatturato', segment: 'Segmento', owner_id: 'Owner', function_name: 'Funzione', lead_why: 'Perché ci interessa',
  potential_value: 'Valore potenziale', priority: 'Priorità', origin: 'Origine', referred_by: 'Segnalato da', boss_code: 'Codice BOSS', accounting_code: 'Codice contabilità',
  zoho_id: 'Zoho', vittoria_id: 'Codice Vittoria', status: 'Stato' };
const CONTACT_FIELDS = ['title', 'first_name', 'last_name', 'email', 'mobile', 'phone', 'linkedin', 'language', 'owner_id', 'status', 'legal_basis', 'zoho_id'];
const CONTACT_LABELS = { title: 'Titolo', first_name: 'Nome', last_name: 'Cognome', email: 'Email', mobile: 'Cellulare', phone: 'Telefono', linkedin: 'LinkedIn', language: 'Lingua',
  owner_id: 'Owner', status: 'Stato', legal_basis: 'Base giuridica', zoho_id: 'Zoho' };

// tabelle che puntano a un'azienda o a un contatto; per quelle con un vincolo di unicità, la colonna che con l'id fa la coppia unica
const SUBJECT_REFS = { crm_contact_links: 'contact_id', crm_contact_proposals: 'email', crm_email_links: 'email_id', crm_meeting_links: 'meeting_id', crm_project_links: 'project_id',
  crm_signal_links: 'signal_id', assistant_emails: null, crm_initiative_signals: null, crm_initiative_targets: null, crm_notes: null, crm_outcomes: null, crm_plans: null,
  crm_signals: null, crm_stage_history: null, crm_steps: null };
const CONTACT_REFS = { crm_contact_links: 'subject_id', crm_email_links: 'email_id', crm_meeting_links: 'meeting_id', crm_project_links: 'project_id', crm_signal_links: 'signal_id',
  assistant_emails: null, business_card_leads: null, crm_notes: null, crm_steps: null };

const empty = v => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// Quale scheda resta, se nessuno lo dice: quella con il codice BOSS, cliente, più collegamenti, più dati, la più vecchia
function keepFirst(a, b, counts = {}) {
  const w = (s, c) => (s.boss_code ? 1000 : 0) + ((s.roles || []).includes('cliente') ? 500 : 0) + (s.vat ? 200 : 0) + (s.created_quick ? -100 : 0)
    + (c?.total || 0) * 5 + Object.values(s).filter(v => !empty(v) && !(Array.isArray(v) && !v.length)).length;
  const wa = w(a, counts[a.id]), wb = w(b, counts[b.id]);
  return wa === wb ? (a.id < b.id ? a : b) : (wa > wb ? a : b);
}

// Righe del confronto per la finestra: per ogni dato i due valori e la scelta proposta ('keep' = di chi resta, 'other')
function compare(keep, other, fields, labels) {
  return fields.map(k => {
    const a = keep[k], b = other[k];
    if (empty(a) && empty(b)) return null;
    if (!empty(a) && !empty(b) && same(a, b)) return null; // uguali: niente da scegliere
    const pick = empty(a) ? 'other' : 'keep';
    return { key: k, label: labels[k] || k, keep: a ?? null, other: b ?? null, pick, differ: !empty(a) && !empty(b) && !same(a, b) };
  }).filter(Boolean);
}

// Quanti collegamenti ha una scheda (per la finestra: «si spostano 1 contatto, 2 incontri…»)
async function refCounts(db, kind, id) {
  const refs = kind === 'subject' ? SUBJECT_REFS : CONTACT_REFS;
  const col = kind === 'subject' ? 'subject_id' : 'contact_id';
  const out = {};
  for (const t of Object.keys(refs)) {
    const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [id]);
    if (r.n) out[t] = r.n;
  }
  out.total = Object.values(out).reduce((s, n) => s + n, 0);
  return out;
}

async function moveRefs(q, kind, from, to) {
  const refs = kind === 'subject' ? SUBJECT_REFS : CONTACT_REFS;
  const col = kind === 'subject' ? 'subject_id' : 'contact_id';
  for (const [t, uniq] of Object.entries(refs)) {
    if (uniq) await q.query(`DELETE FROM ${t} x USING ${t} y WHERE x.${col} = $1 AND y.${col} = $2 AND x.${uniq} = y.${uniq}`, [from, to]);
    if (t === 'crm_contact_links' && kind === 'subject') await q.query(`UPDATE ${t} SET ${col} = $2, is_primary = false WHERE ${col} = $1`, [from, to]);
    else await q.query(`UPDATE ${t} SET ${col} = $2 WHERE ${col} = $1`, [from, to]);
  }
}

// values: { campo: 'keep' | 'other' | { value } } (un valore scritto, es. da internet). Senza scelta: si tiene, o si prende l'altro se vuoto.
function chosen(keep, other, fields, values = {}) {
  const out = {};
  for (const k of fields) {
    const v = values[k];
    const val = v && typeof v === 'object' ? v.value : v === 'other' ? other[k] : v === 'keep' ? keep[k] : (empty(keep[k]) ? other[k] : keep[k]);
    if (!same(val, keep[k]) || (empty(keep[k]) && !empty(val))) out[k] = empty(val) ? (typeof keep[k] === 'number' ? null : '') : val;
  }
  return out;
}
const unionBy = (a = [], b = [], key = x => x) => { const seen = new Set(); return [...a, ...b].filter(x => { const k = key(x); return seen.has(k) ? false : seen.add(k); }); };

async function mergeSubjects(db, { keep, other, values = {}, userId }) {
  const set = chosen(keep, other, SUBJECT_FIELDS, values);
  const roles = unionBy(keep.roles, other.roles);
  set.roles = roles.includes('cliente') ? roles.filter(r => r !== 'lead') : roles;
  set.asa = unionBy(keep.asa, other.asa);
  set.supplier_categories = unionBy(keep.supplier_categories, other.supplier_categories);
  set.supplier_subcategories = unionBy(keep.supplier_subcategories, other.supplier_subcategories);
  set.supplier_zones = unionBy(keep.supplier_zones, other.supplier_zones);
  set.soa = JSON.stringify(unionBy(keep.soa, other.soa, x => x.cat));
  if (other.key_account) set.key_account = true;
  if (!keep.client_since && other.client_since) set.client_since = other.client_since;
  // i telefoni ed email non tenuti finiscono nelle note, per non perderli
  const lost = ['phone', 'email', 'pec', 'address'].filter(k => !empty(other[k]) && !same(other[k], set[k] ?? keep[k]) && !same(other[k], keep[k])).map(k => `${SUBJECT_LABELS[k]}: ${other[k]}`);
  const notes = [keep.notes, other.notes, lost.length ? `Da «${other.name}» (unita): ${lost.join(' · ')}` : ''].filter(Boolean).join('\n\n');
  if (notes !== (keep.notes || '')) set.notes = notes;
  const wf = { ...(other.web_fields || {}), ...(keep.web_fields || {}) };
  set.web_fields = JSON.stringify(wf);
  await db.tx(async q => {
    // P.IVA e codice fiscale sono unici: si liberano sulla scheda che si unisce prima di metterli su quella che resta
    if (set.vat || set.tax_code) await q.query("UPDATE crm_subjects SET vat = CASE WHEN $2 THEN '' ELSE vat END, tax_code = CASE WHEN $3 THEN '' ELSE tax_code END WHERE id = $1",
      [other.id, Boolean(set.vat) && set.vat === other.vat, Boolean(set.tax_code) && set.tax_code === other.tax_code]);
    await moveRefs(q, 'subject', other.id, keep.id);
    await q.query('UPDATE crm_subjects SET group_id = $2 WHERE group_id = $1', [other.id, keep.id]);
    if (keep.group_id === other.id) set.group_id = other.group_id || null;
    const cols = Object.keys(set);
    await q.query(`UPDATE crm_subjects SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [keep.id, ...cols.map(c => set[c])]);
    await q.query('UPDATE crm_subjects SET merged_into = $2, updated_at = now() WHERE id = $1', [other.id, keep.id]);
    await q.query("INSERT INTO crm_stage_history (subject_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, 'unione', $2, $3)", [keep.id, `Unita «${other.name}»`, userId]);
    await q.query(`UPDATE crm_duplicates SET status = 'merged', decided_by = $3, decided_at = now() WHERE kind = 'subject' AND status = 'open' AND ((a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1))`, [keep.id, other.id, userId]);
    await q.query("DELETE FROM crm_duplicates WHERE kind = 'subject' AND status = 'open' AND (a_id = $1 OR b_id = $1)", [other.id]);
  });
}

async function mergeContacts(db, { keep, other, values = {}, userId }) {
  const set = chosen(keep, other, CONTACT_FIELDS, values);
  const lost = ['email', 'mobile', 'phone'].filter(k => !empty(other[k]) && !same(other[k], set[k] ?? keep[k]) && !same(other[k], keep[k])).map(k => `${CONTACT_LABELS[k]}: ${other[k]}`);
  const notes = [keep.notes, other.notes, lost.length ? `Dal contatto unito: ${lost.join(' · ')}` : ''].filter(Boolean).join('\n\n');
  if (notes !== (keep.notes || '')) set.notes = notes;
  if (other.newsletter && !keep.newsletter) set.newsletter = true;
  await db.tx(async q => {
    await moveRefs(q, 'contact', other.id, keep.id);
    const cols = Object.keys(set);
    if (cols.length) await q.query(`UPDATE crm_contacts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [keep.id, ...cols.map(c => set[c])]);
    const name = [other.first_name, other.last_name].filter(Boolean).join(' ') || other.email;
    await q.query(`UPDATE crm_duplicates SET status = 'merged', decided_by = $3, decided_at = now(), note = $4 WHERE kind = 'contact' AND ((a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1))`, [keep.id, other.id, userId, `unito: ${name}`]);
    await q.query("DELETE FROM crm_duplicates WHERE kind = 'contact' AND status = 'open' AND (a_id = $1 OR b_id = $1)", [other.id]);
    await q.query('DELETE FROM crm_contacts WHERE id = $1', [other.id]);
  });
}

module.exports = { SUBJECT_FIELDS, SUBJECT_LABELS, CONTACT_FIELDS, CONTACT_LABELS, keepFirst, compare, refCounts, mergeSubjects, mergeContacts, chosen };
