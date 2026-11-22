// Attestazioni SOA (ALM2-49, canvas CRM v13 · V13-SOA, via di Dante 21/11/2026).
// Dagli open data ANAC «Attestazioni SOA v2» (due CSV: attestati e categorie rilasciate): per ogni impresa
// l'attestazione valida più recente con le categorie e le classifiche. Il caricamento gira in un thread a parte
// (lib/crm-soa-worker.js: i file sono 100 + 60 MB) e scrive tutto insieme una volta a settimana.
// Le letture: «Chi è qualificato in zona» per un'iniziativa di Nuovi business e il riquadro nella scheda impresa.
const readline = require('readline');
const { Readable } = require('stream');
const { normCat, regionOf, parseLine, UA } = require('./crm-anac');

const BASE = 'https://dati.anticorruzione.it/opendata/download/dataset/attestazioni-soa-v2/filesystem';
const FILES = { att: `${BASE}/attestato_CKAN.csv`, cats: `${BASE}/categorie_rilasciate_CKAN.csv` };
const HEADERS = { 'User-Agent': UA, Accept: 'text/csv,*/*' };
const VALID = new Set(['PUBBLICO']); // attestazione in vigore (le altre: sostituita, scaduta, invalidata, decaduta…)

// classifiche (DPR 207/2010 art. 61): importo massimo dei lavori che l'impresa può fare da sola
const CLASSES = ['I', 'II', 'III', 'III-BIS', 'IV', 'IV-BIS', 'V', 'VI', 'VII', 'VIII'];
const CLASS_MAX = { I: 258000, II: 516000, III: 1033000, 'III-BIS': 1500000, IV: 2582000, 'IV-BIS': 3500000, V: 5165000, VI: 10329000, VII: 15494000, VIII: null };
const normClass = c => {
  const s = String(c || '').toUpperCase().replace(/\s+/g, '').replace(/BIS$/, '-BIS').replace(/--/g, '-');
  return CLASSES.includes(s) ? s : '';
};
const rank = c => CLASSES.indexOf(normClass(c));
const day = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : null);
const titleCase = s => String(s || '').toLowerCase().replace(/(^|[\s'-])\S/g, m => m.toUpperCase());

// righe di un CSV ANAC (separatore «;», virgolette, a capo dentro i campi) come oggetti con le intestazioni
async function* csvRows(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ANAC ${res.status} su ${url.split('/').pop()}`);
  const ct = String(res.headers?.get?.('content-type') || '');
  if (ct.includes('text/html')) throw new Error(`ANAC ha rifiutato ${url.split('/').pop()} (pagina del firewall al posto del file)`);
  const body = typeof res.body?.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
  const rl = readline.createInterface({ input: body, crlfDelay: Infinity });
  let head = null, pending = '', n = 0;
  for await (const raw of rl) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if (((line.match(/"/g) || []).length & 1) === 1 && pending.length < 5000) { pending = line; continue; }
    pending = '';
    if (!head) { head = parseLine(line.replace(/^﻿/, '')); continue; }
    const c = parseLine(line);
    const o = {};
    head.forEach((h, k) => { o[h] = c[k] ?? ''; });
    yield o;
    if (++n % 5000 === 0) await new Promise(r => setImmediate(r)); // lascia respirare chi aspetta
  }
}

// Legge i due file e restituisce una riga per impresa con l'attestazione valida più recente.
async function collect({ fetchImpl = fetch, log = () => {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const atts = new Map();
  for await (const r of csvRows(FILES.att, fetchImpl)) {
    if (!VALID.has(String(r.ATA_attestato_stato || '').trim().toUpperCase())) continue;
    const exp = day(r.ATA_attestato_dataScadenzaValiditaQuinquennale);
    if (exp && exp < today) continue;
    const cf = String(r.ATA_impresa_codiceFiscale || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cf) continue;
    atts.set(r._idAttestazione, {
      cf, name: String(r.ATA_impresa_denominazione || '').trim().slice(0, 300), province: titleCase(r.ATA_provincia_nome).slice(0, 60),
      soa_name: String(r.ATA_soa_denominazione || '').trim().slice(0, 200), issued_on: day(r.ATA_attestato_dataRilascioAttestazioneInCorso),
      mid_check_on: day(r.ATA_attestato_dataScadenzaValiditaTriennale), expires_on: exp, cats: {},
    });
  }
  log(`SOA: ${atts.size} attestazioni valide`);
  for await (const r of csvRows(FILES.cats, fetchImpl)) {
    const a = atts.get(r._idAttestazione);
    if (!a) continue;
    const cat = normCat(r.ATCR_categoria), cl = normClass(r.ATCR_classifica);
    if (!cat || !cl) continue;
    if (!a.cats[cat] || rank(cl) > rank(a.cats[cat])) a.cats[cat] = cl;
  }
  const byCf = new Map();
  for (const a of atts.values()) {
    if (!Object.keys(a.cats).length) continue;
    const old = byCf.get(a.cf);
    if (!old || String(a.issued_on || '') > String(old.issued_on || '')) byCf.set(a.cf, a);
  }
  const out = [...byCf.values()].map(a => ({ ...a, region: regionOf('', a.province) }));
  log(`SOA: ${out.length} imprese con categorie`);
  return out;
}

function collectInWorker({ log = () => {} } = {}) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const w = new Worker(require('path').join(__dirname, 'crm-soa-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 512 } });
    w.on('message', m => { if (m.log) log(m.log); if (m.done) resolve(m.done); if (m.error) reject(new Error(m.error)); });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`il caricamento SOA si è fermato (codice ${code})`)); });
  });
}

async function save(db, list) {
  await db.tx(async q => {
    await q.query('DELETE FROM crm_soa');
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500);
      const vals = [];
      const rows = part.map((a, k) => {
        vals.push(a.cf, a.name, a.province, a.region, a.soa_name, a.issued_on, a.mid_check_on, a.expires_on, JSON.stringify(a.cats));
        const b = k * 9;
        return `(${Array.from({ length: 8 }, (_, n) => `$${b + n + 1}`).join(', ')}, $${b + 9}::jsonb)`;
      });
      await q.query(`INSERT INTO crm_soa (cf, name, province, region, soa_name, issued_on, mid_check_on, expires_on, cats) VALUES ${rows.join(', ')}
        ON CONFLICT (cf) DO NOTHING`, vals);
    }
  });
}

let running = null;
function syncSoa(db, { fetchImpl, log = msg => console.log(`[soa] ${msg}`) } = {}) {
  if (running) return running;
  running = (async () => {
    try {
      const list = fetchImpl ? await collect({ fetchImpl, log }) : await collectInWorker({ log });
      await save(db, list);
      await db.query('INSERT INTO crm_soa_imports (rows) VALUES ($1)', [list.length]);
      return { rows: list.length };
    } catch (err) {
      await db.query('INSERT INTO crm_soa_imports (rows, error) VALUES (0, $1)', [String(err.message).slice(0, 500)]).catch(() => {});
      log(`errore: ${err.message}`);
      throw err;
    } finally { running = null; }
  })();
  return running;
}
const isRunning = () => Boolean(running);

async function lastImport(db) {
  const { rows: [r] } = await db.query(`SELECT max(at) FILTER (WHERE error = '') AS ok, (SELECT rows FROM crm_soa_imports WHERE error = '' ORDER BY at DESC LIMIT 1) AS rows,
      (SELECT error FROM crm_soa_imports ORDER BY at DESC LIMIT 1) AS last_error FROM crm_soa_imports`);
  return { updated_at: r?.ok ? new Date(r.ok).toISOString() : null, rows: r?.rows || 0, last_error: r?.last_error || '' };
}

// ── letture ──────────────────────────────────────────────────────────────────
const isoDay = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

// «Chi è qualificato in zona»: imprese con attestazione valida in almeno una categoria del perimetro e sede nelle regioni.
// scope = scopeOf(...) del Mercato (cats, regions, sql/params delle gare). opts: { filter: tutte|mai|classe|crm, classMin, province, limit }
async function qualified(db, scope, { filter = 'tutte', classMin = '', province = '', limit = 8 } = {}) {
  const cats = scope.cats || [];
  if (!cats.length) return { companies: [], kpi: { total: 0, never: 0, in_crm: 0 }, ladder: [], provinces: [] };
  const params = [cats];
  let where = 's.cats ?| $1::text[]';
  if (scope.regions?.length) { params.push(scope.regions.map(r => r.toLowerCase())); where += ` AND lower(s.region) = ANY($${params.length}::text[])`; }
  const { rows: all } = await db.query(`SELECT s.*, (SELECT json_build_object('id', x.id, 'name', x.name, 'roles', x.roles) FROM crm_subjects x
        WHERE x.merged_into IS NULL AND (upper(x.vat) = s.cf OR upper(x.tax_code) = s.cf) ORDER BY x.id LIMIT 1) AS subject
      FROM crm_soa s WHERE ${where}`, params);
  // gare vinte nel perimetro (stesse regole del Mercato)
  const { rows: wins } = await db.query(`SELECT upper(w->>'cf') AS cf, count(*)::int AS n FROM crm_anac_awards a, jsonb_array_elements(a.winners) w
      WHERE ${scope.sql} GROUP BY 1`, scope.params);
  const won = new Map(wins.map(w => [w.cf, w.n]));
  const best = s => Math.max(...cats.map(c => rank(s.cats[c])));
  const list = all.map(s => ({
    cf: s.cf, name: s.name, province: s.province, region: s.region, soa_name: s.soa_name,
    expires_on: isoDay(s.expires_on), mid_check_on: isoDay(s.mid_check_on),
    classes: cats.map(c => ({ cat: c, cls: s.cats[c] || null, max: s.cats[c] ? CLASS_MAX[s.cats[c]] : null, step: s.cats[c] ? rank(s.cats[c]) + 1 : 0 })),
    best: best(s), won: won.get(s.cf) || 0, subject: s.subject || null,
  }));
  const kpi = { total: list.length, never: list.filter(x => !x.won).length, in_crm: list.filter(x => x.subject).length };
  // quante imprese per classifica, sulla prima categoria del perimetro
  const first = cats[0];
  const ladder = CLASSES.map(c => ({ cls: c, n: all.filter(s => s.cats[first] === c).length }));
  const provinces = [...new Set(list.map(x => x.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  let view = list;
  if (filter === 'mai') view = view.filter(x => !x.won);
  if (filter === 'crm') view = view.filter(x => x.subject);
  const min = rank(classMin || (filter === 'classe' ? 'III' : ''));
  if (min >= 0) view = view.filter(x => x.best >= min);
  if (province) view = view.filter(x => x.province.toLowerCase() === province.toLowerCase());
  view.sort((a, b) => b.best - a.best || (a.won ? 1 : 0) - (b.won ? 1 : 0) || a.name.localeCompare(b.name, 'it'));
  return { category: first, kpi, ladder, provinces, shown: view.length, companies: view.slice(0, Math.min(Number(limit) || 8, 200)) };
}

async function company(db, cf, cats = []) {
  const { rows: [s] } = await db.query('SELECT * FROM crm_soa WHERE cf = $1', [String(cf || '').toUpperCase()]);
  if (!s) return null;
  const order = Object.entries(s.cats).sort((a, b) => (cats.includes(b[0]) - cats.includes(a[0])) || rank(b[1]) - rank(a[1]));
  return { cf: s.cf, name: s.name, province: s.province, soa_name: s.soa_name, issued_on: isoDay(s.issued_on), mid_check_on: isoDay(s.mid_check_on), expires_on: isoDay(s.expires_on),
    cats: order.map(([cat, cls]) => ({ cat, cls, max: CLASS_MAX[cls], ours: cats.includes(cat) })) };
}

module.exports = { collect, csvRows, syncSoa, isRunning, save, lastImport, qualified, company, normClass, rank, CLASSES, CLASS_MAX, FILES };
