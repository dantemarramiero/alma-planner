// SOA delle aziende del CRM da ANAC (canvas CRM v14 · V14-SOA-CRM, via di Dante 22/11/2026).
// Le attestazioni di crm_soa (lib/crm-soa.js, ricaricate ogni lunedì) si collegano alle aziende con la P.IVA o il codice
// fiscale; mai per nome. In crm_subjects.soa_anac si tiene la copia: { cf, found, gone, cats: [{ cat, cls }], soa_name,
// issued_on, mid_check_on, expires_on, checked_at }. Le SOA scritte a mano (crm_subjects.soa) non si toccano da sole:
// se si sovrappongono a quelle di ANAC si mostrano le differenze e si sceglie.
const { CLASS_MAX } = require('./crm-soa');

const cfOf = s => {
  const vat = String(s.vat || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^IT(?=\d{11}$)/, '');
  return vat || String(s.tax_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
};
// gli altri codici con cui l'impresa può stare in ANAC: il codice fiscale se diverso dalla P.IVA, la P.IVA senza «IT»
const altOf = s => {
  const vat = String(s.vat || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tax = String(s.tax_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return [...new Set([tax, vat.replace(/^IT/, ''), vat])].filter(x => x && x !== cfOf(s));
};
// classifica di ANAC («III-BIS») nella forma delle SOA a mano («III-bis»)
const cls = c => String(c || '').toUpperCase().replace(/-BIS$/, '-bis');
const day = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const RANK = ['I', 'II', 'III', 'III-bis', 'IV', 'IV-bis', 'V', 'VI', 'VII', 'VIII'];
const rank = c => RANK.indexOf(c);

const snapshot = (cf, a, now) => ({
  cf, found: true, gone: false, soa_name: a.soa_name || '', issued_on: day(a.issued_on), mid_check_on: day(a.mid_check_on), expires_on: day(a.expires_on),
  cats: Object.entries(a.cats || {}).map(([cat, c]) => ({ cat, cls: cls(c) })).sort((x, y) => rank(y.cls) - rank(x.cls) || x.cat.localeCompare(y.cat)), checked_at: now,
});

// Aggiorna soa_anac delle aziende (ids = solo quelle; onlyMissing = solo quelle mai controllate o con P.IVA cambiata).
// Non fa niente finché crm_soa è vuota (il primo caricamento ANAC non è ancora finito). → { checked, found, changed }
async function syncSubjectsSoa(db, { ids = null, onlyMissing = false } = {}) {
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM crm_soa');
  if (!n) return { checked: 0, found: 0, changed: 0, skipped: 'ANAC non ancora caricato' };
  const params = [];
  let where = "merged_into IS NULL AND (vat <> '' OR tax_code <> '' OR soa_anac IS NOT NULL)";
  if (ids) { params.push(ids); where += ` AND id = ANY($${params.length}::int[])`; }
  const { rows: subs } = await db.query(`SELECT id, vat, tax_code, soa_anac FROM crm_subjects WHERE ${where}`, params);
  const todo = subs.map(s => ({ ...s, cf: cfOf(s), alt: altOf(s) })).filter(s => !onlyMissing || !s.soa_anac || s.soa_anac.cf !== s.cf);
  const now = new Date().toISOString();
  let found = 0, changed = 0;
  for (let i = 0; i < todo.length; i += 500) {
    const part = todo.slice(i, i + 500);
    // ANAC registra l'attestazione sul codice fiscale dell'impresa, che a volte è diverso dalla P.IVA (consorzi,
    // cooperative, società nate prima della P.IVA): si cerca con tutti e due (Dante 23/11: «non mi collega più le SOA»)
    const { rows: soa } = await db.query('SELECT * FROM crm_soa WHERE cf = ANY($1::text[])', [part.flatMap(s => [s.cf, ...s.alt]).filter(Boolean)]);
    const byCf = new Map(soa.map(a => [a.cf, a]));
    const upd = [];
    for (const s of part) {
      const a = s.cf ? (byCf.get(s.cf) || s.alt.map(x => byCf.get(x)).find(Boolean) || null) : null;
      const old = s.soa_anac;
      let next;
      if (a) { next = snapshot(s.cf, a, now); found++; }
      else if (old?.found && old.cf === s.cf) next = { ...old, gone: true, checked_at: now }; // sparita da ANAC: si mostra scaduta
      else next = s.cf ? { cf: s.cf, found: false, cats: [], checked_at: now } : null;
      const same = JSON.stringify({ ...(old || {}), checked_at: 0 }) === JSON.stringify({ ...(next || {}), checked_at: 0 });
      if (!same) changed++;
      upd.push([s.id, next ? JSON.stringify(next) : null]);
    }
    if (upd.length) {
      await db.query(`UPDATE crm_subjects s SET soa_anac = v.j::jsonb FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS j) v WHERE s.id = v.id`,
        [upd.map(u => u[0]), upd.map(u => u[1])]);
    }
  }
  return { checked: todo.length, found, changed };
}

// Stato dell'attestazione di ANAC: valida, in scadenza (60 giorni), scaduta (data passata o sparita da ANAC), nessuna
function anacState(a, now = today()) {
  if (!a || !a.found) return a ? 'nessuna' : null;
  if (a.gone || (a.expires_on && a.expires_on < now)) return 'scaduta';
  if (a.expires_on && a.expires_on <= addDays(now, 60)) return 'in_scadenza';
  return 'valida';
}

// Le SOA che contano per l'azienda: quelle di ANAC valide più quelle a mano che ANAC non ha; con «Tieni le mie» vince
// la mano sulle categorie in comune. Le scadute di ANAC restano nell'elenco con expired: true (non contano per le ATI).
function effectiveSoa(s, now = today()) {
  const st = anacState(s.soa_anac, now);
  const anac = (s.soa_anac?.cats || []).map(x => ({ cat: x.cat, cls: x.cls, expires: s.soa_anac.expires_on, source: 'anac', expired: st === 'scaduta' }));
  const mine = (s.soa || []).map(x => ({ cat: x.cat, cls: x.cls, expires: x.expires || null, source: 'mano', expired: Boolean(x.expires && x.expires < now) }));
  const validAnac = anac.filter(x => !x.expired);
  const out = s.soa_choice === 'mine'
    ? [...mine, ...validAnac.filter(x => !mine.some(m => m.cat === x.cat))]
    : [...validAnac, ...mine.filter(m => !validAnac.some(x => x.cat === m.cat))];
  for (const x of anac) if (x.expired && !out.some(o => o.cat === x.cat)) out.push(x);
  return out.sort((a, b) => Number(a.expired) - Number(b.expired) || rank(b.cls) - rank(a.cls) || a.cat.localeCompare(b.cat));
}

// Differenze tra le SOA a mano e quelle di ANAC (solo se ANAC è valida e non si è già scelto «Tieni le mie»)
function soaConflict(s, now = today()) {
  if (s.soa_choice === 'mine' || !(s.soa || []).length || !['valida', 'in_scadenza'].includes(anacState(s.soa_anac, now))) return null;
  const anac = new Map(s.soa_anac.cats.map(x => [x.cat, x.cls]));
  const mine = s.soa || [];
  const differ = mine.filter(m => anac.has(m.cat) && anac.get(m.cat) !== m.cls).map(m => ({ cat: m.cat, mine: m.cls, anac: anac.get(m.cat) }));
  const onlyMine = mine.filter(m => !anac.has(m.cat)).map(m => ({ cat: m.cat, cls: m.cls }));
  const onlyAnac = s.soa_anac.cats.filter(x => !mine.some(m => m.cat === x.cat));
  const same = mine.filter(m => anac.get(m.cat) === m.cls).length;
  if (!differ.length && !same) return null; // niente in comune: le mie sono in più, si vedono «a mano» senza chiedere
  return { mine: mine.map(m => ({ cat: m.cat, cls: m.cls })), differ, only_mine: onlyMine, only_anac: onlyAnac };
}

// «Usa ANAC» toglie le SOA a mano; «aggiungi» tiene a mano solo quelle che ANAC non ha; «mine» tiene le mie
async function chooseSoa(db, id, choice) {
  const { rows: [s] } = await db.query('SELECT soa, soa_anac FROM crm_subjects WHERE id = $1', [id]);
  const anac = new Set((s?.soa_anac?.cats || []).map(x => x.cat));
  if (choice === 'anac') await db.query("UPDATE crm_subjects SET soa = '[]', soa_choice = '', updated_at = now() WHERE id = $1", [id]);
  else if (choice === 'aggiungi') await db.query("UPDATE crm_subjects SET soa = $2, soa_choice = '', updated_at = now() WHERE id = $1", [id, JSON.stringify((s?.soa || []).filter(x => !anac.has(x.cat)))]);
  else await db.query("UPDATE crm_subjects SET soa_choice = 'mine', updated_at = now() WHERE id = $1", [id]);
}

const maxOf = c => (CLASS_MAX[String(c).toUpperCase()] ?? null);
const withSoa = s => ({ ...s, soa_effective: effectiveSoa(s), soa_state: anacState(s.soa_anac), soa_conflict: soaConflict(s) });

module.exports = { syncSubjectsSoa, effectiveSoa, soaConflict, anacState, chooseSoa, cfOf, withSoa, maxOf, RANK };
