// Doppioni nel CRM (canvas v15 · V15-Doppioni, via di Dante 22/11/2026): il CRM confronta aziende e contatti e propone
// le coppie da unire, con il perché e quanto è sicuro. Non unisce mai da solo.
// Aziende: stesso nome (senza forma giuridica, punti e maiuscole), nomi simili (lettere quasi uguali), stesso sito,
// stesso dominio email (non i domini di posta comuni), stesso codice fiscale.
// Contatti: stessa email, oppure stesso nome e cognome nella stessa azienda o con lo stesso cellulare.

const LEGAL = new Set(['srl', 'srls', 'spa', 'sas', 'snc', 'sapa', 'scarl', 'scrl', 'sc', 'soc', 'societa', 'coop', 'cooperativa', 'arl', 'rl', 'unipersonale', 'ss', 'sp', 'a', 'r', 'l', 's', 'p', 'in', 'liquidazione', 'di', 'e', 'c', 'the', 'ltd', 'gmbh', 'sa', 'sl', 'inc', 'impresa', 'ditta']);
const COMMON_MAIL = new Set(['gmail.com', 'libero.it', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'yahoo.com', 'yahoo.it', 'virgilio.it', 'alice.it', 'tin.it', 'tiscali.it', 'live.com', 'live.it', 'icloud.com', 'me.com', 'msn.com', 'fastwebnet.it', 'email.it', 'aruba.it', 'pec.it', 'legalmail.it', 'pec.aruba.it', 'postacert.it', 'arubapec.it', 'gigapec.it', 'cert.legalmail.it', 'almacis.it']);

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// «Edil Gamma S.p.A.» → «edil gamma»; «S.R.L.» si legge come «srl» prima di toglierlo
function normName(name) {
  const s = plain(name).replace(/&/g, ' e ').replace(/\b([a-z])\.\s?(?=[a-z]\.)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  // forma giuridica solo in fondo («… S.r.l. in liquidazione») e «Impresa», «Ditta», «Società» solo all'inizio:
  // «Impresa Di Fabio» → «di fabio», non «fabio»
  const kept = [...words];
  while (kept.length > 1 && LEGAL.has(kept[kept.length - 1])) kept.pop();
  while (kept.length > 1 && ['impresa', 'ditta', 'societa', 'soc'].includes(kept[0])) kept.shift();
  return kept.join(' ');
}
const compact = s => normName(s).replace(/\s/g, '');
const host = u => plain(u).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
const mailDomain = e => { const d = plain(e).split('@')[1] || ''; return d && !COMMON_MAIL.has(d) && !/(^|\.)pec\./.test(d) ? d : ''; };

// somiglianza fra 0 e 1 (Dice sulle coppie di lettere)
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let both = 0;
  for (const [g, n] of A) both += Math.min(n, B.get(g) || 0);
  return (2 * both) / (a.length - 1 + b.length - 1);
}

const SIMILAR = 0.8;
// Coppie di aziende: [{ a, b, score, reasons: [{ code, label }] }] con a < b
function subjectPairs(subs, contactDomains = new Map()) {
  const pairs = new Map();
  const add = (x, y, code, label, score) => {
    if (x.id === y.id) return;
    const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
    const k = `${a}:${b}`;
    const p = pairs.get(k) || { a, b, score: 0, reasons: [] };
    if (!p.reasons.some(r => r.code === code)) p.reasons.push({ code, label });
    p.score = Math.max(p.score, score);
    pairs.set(k, p);
  };
  const items = subs.map(s => ({ ...s, n: compact(s.name), host: host(s.website), mail: mailDomain(s.email), doms: contactDomains.get(s.id) || new Set() }));
  // stesso nome / nomi simili: si confrontano solo i nomi che iniziano con le stesse 3 lettere
  const byStart = new Map();
  for (const s of items) if (s.n.length >= 3) { const k = s.n.slice(0, 3); (byStart.get(k) || byStart.set(k, []).get(k)).push(s); }
  for (const group of byStart.values()) {
    if (group.length > 400) continue; // prefissi troppo comuni («com» di Comune…): solo nome identico, sotto
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const x = group[i], y = group[j];
      if (x.n === y.n) { add(x, y, 'nome', 'Stesso nome', 95); continue; }
      const sim = similarity(x.n, y.n);
      if (sim >= SIMILAR && Math.min(x.n.length, y.n.length) >= 5) add(x, y, 'simile', `Nomi simili ${Math.round(sim * 100)}%`, Math.round(sim * 90));
    }
  }
  const sameKey = (key, code, label, score) => {
    const m = new Map();
    for (const s of items) for (const v of [].concat(key(s)).filter(Boolean)) (m.get(v) || m.set(v, []).get(v)).push(s);
    for (const [v, list] of m) {
      if (list.length < 2 || list.length > 6) continue; // un dominio usato da tanti (es. un gruppo) non è un doppione
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], code, typeof label === 'function' ? label(v) : label, score);
    }
  };
  sameKey(s => s.n.length >= 3 && s.n, 'nome', 'Stesso nome', 95);
  sameKey(s => s.host, 'sito', 'Stesso sito', 85);
  sameKey(s => [s.mail, ...s.doms], 'email', d => `Stesso dominio email @${d}`, 75);
  sameKey(s => s.tax_code, 'cf', 'Stesso codice fiscale', 99);
  // la stessa città rende più sicura una coppia che c'è già (non ne crea)
  const byId = new Map(items.map(s => [s.id, s]));
  for (const p of pairs.values()) {
    const x = byId.get(p.a), y = byId.get(p.b);
    if (x.city && y.city && plain(x.city) === plain(y.city)) { p.reasons.push({ code: 'citta', label: 'stessa città' }); p.score = Math.min(99, p.score + 3); }
    // due enti diversi dello stesso comune (es. Comune e Ufficio tecnico) con P.IVA diverse non sono doppioni
    if (x.vat && y.vat && x.vat !== y.vat) pairs.delete(`${p.a}:${p.b}`);
  }
  return [...pairs.values()];
}

// Coppie di contatti
function contactPairs(contacts, links = new Map()) {
  const pairs = new Map();
  const add = (x, y, code, label, score) => {
    const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
    const k = `${a}:${b}`;
    const p = pairs.get(k) || { a, b, score: 0, reasons: [] };
    if (!p.reasons.some(r => r.code === code)) p.reasons.push({ code, label });
    p.score = Math.max(p.score, score);
    pairs.set(k, p);
  };
  const group = (key, fn) => {
    const m = new Map();
    for (const c of contacts) { const v = key(c); if (v) (m.get(v) || m.set(v, []).get(v)).push(c); }
    for (const list of m.values()) if (list.length > 1 && list.length <= 6) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) fn(list[i], list[j]);
  };
  group(c => plain(c.email).trim(), (x, y) => add(x, y, 'email', 'Stessa email', 98));
  const nameKey = c => (c.last_name && c.first_name ? `${normName(c.first_name)}|${normName(c.last_name)}` : '');
  group(nameKey, (x, y) => {
    const lx = links.get(x.id) || new Set(), ly = links.get(y.id) || new Set();
    if ([...lx].some(s => ly.has(s))) add(x, y, 'nome_azienda', 'Stesso nome nella stessa azienda', 90);
    const mx = String(x.mobile || '').replace(/\D/g, '').slice(-9), my = String(y.mobile || '').replace(/\D/g, '').slice(-9);
    if (mx.length >= 8 && mx === my) add(x, y, 'nome_cell', 'Stesso nome e cellulare', 92);
  });
  return [...pairs.values()];
}

// Ricerca completa: aggiorna crm_duplicates (le coppie scartate o già unite restano come sono) → { subject, contact }
async function findDuplicates(db) {
  const { rows: subs } = await db.query("SELECT id, name, vat, tax_code, website, email, city FROM crm_subjects WHERE merged_into IS NULL");
  const { rows: cl } = await db.query("SELECT l.subject_id, l.contact_id, c.email FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id WHERE l.date_to IS NULL");
  const doms = new Map();
  const links = new Map();
  for (const r of cl) {
    const d = mailDomain(r.email);
    if (d) (doms.get(r.subject_id) || doms.set(r.subject_id, new Set()).get(r.subject_id)).add(d);
    (links.get(r.contact_id) || links.set(r.contact_id, new Set()).get(r.contact_id)).add(r.subject_id);
  }
  const { rows: contacts } = await db.query('SELECT id, first_name, last_name, email, mobile FROM crm_contacts');
  const out = {};
  for (const [kind, list] of [['subject', subjectPairs(subs, doms)], ['contact', contactPairs(contacts, links)]]) {
    await db.tx(async q => {
      const keep = list.map(p => `${p.a}:${p.b}`);
      // le coppie aperte che non tornano più (una delle due unita o cambiata) si tolgono
      await q.query(`DELETE FROM crm_duplicates WHERE kind = $1 AND status = 'open' AND NOT ((a_id::text || ':' || b_id::text) = ANY($2::text[]))`, [kind, keep]);
      for (let i = 0; i < list.length; i += 300) {
        const part = list.slice(i, i + 300);
        await q.query(`INSERT INTO crm_duplicates (kind, a_id, b_id, score, reasons)
          SELECT $1, x.a, x.b, x.s, x.r::jsonb FROM unnest($2::int[], $3::int[], $4::int[], $5::text[]) AS x(a, b, s, r)
          ON CONFLICT (kind, a_id, b_id) DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons WHERE crm_duplicates.status = 'open'`,
        [kind, part.map(p => p.a), part.map(p => p.b), part.map(p => p.score), part.map(p => JSON.stringify(p.reasons))]);
      }
    });
    out[kind] = list.length;
  }
  return out;
}

// Somiglianti a un nome che si sta scrivendo («Sembra già presente»): aziende con lo stesso nome o un nome simile
function similarNames(name, subs, limit = 5) {
  const n = compact(name);
  if (n.length < 4) return [];
  return subs.map(s => ({ s, sim: similarity(n, compact(s.name)) })).filter(x => x.sim >= SIMILAR).sort((a, b) => b.sim - a.sim).slice(0, limit)
    .map(x => ({ ...x.s, similar: x.sim < 1 }));
}

module.exports = { normName, compact, similarity, subjectPairs, contactPairs, findDuplicates, similarNames, host, mailDomain };
