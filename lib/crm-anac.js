// Concorrenza dai dati pubblici ANAC (Dante 17/11/2026, punto 5 del win ratio). ANAC pubblica ogni mese, in
// dati.anticorruzione.it, i file delle gare: CIG (oggetto, stazione appaltante, luogo, CPV), categorie d'opera (SOA),
// aggiudicazioni (importo, ribasso, offerenti, criterio) e aggiudicatari (chi ha vinto, anche in ATI). I quattro file
// dello stesso mese sono allineati: si leggono in streaming direttamente dallo zip (niente disco, niente librerie) e
// si tengono solo le gare aggiudicate nelle categorie SOA dei profili BU (o con i CPV indicati per BU), sopra l'importo
// minimo. Il resto si calcola al volo: chi vince, con che ribasso, con chi in ATI, quanto vinciamo noi.
const zlib = require('zlib');
const readline = require('readline');
const { Readable, Transform } = require('stream');
const { REGIONS } = require('./energy-places');

const BASE = 'https://dati.anticorruzione.it/opendata';
// il sito rifiuta i client senza un User-Agent da browser; nessun dato nostro nella richiesta
const UA = 'Mozilla/5.0 (compatible; AlmaPlanet/1.0)';

const CONCORRENZA_DEFAULT = {
  on: true,
  months: 12,            // quanti mesi tenere (e caricare la prima volta)
  min_amount: 40000,     // sotto non serve: affidamenti diretti
  cpv: { facility: ['507', '508', '79993'] }, // per le BU di servizi: prefissi CPV (le categorie SOA vengono dal profilo BU)
  extra_categories: [],  // categorie in più da tenere, oltre a quelle dei profili
  our_cf: [],            // codici fiscali / P. IVA di Almacis e delle società del gruppo
  our_names: ['ALMACIS'],
};

// ── nomi ───────────────────────────────────────────────────────────────────────────────────
const normCat = c => String(c || '').toUpperCase().replace(/\s+/g, '');
const titleCase = s => String(s || '').toLowerCase().replace(/(^|[\s'’(-])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase());
const PROVINCE_REGION = new Map(REGIONS.flatMap(r => r.provinces.map(p => [p.name.toUpperCase(), r.name])));
PROVINCE_REGION.set('MONZA E DELLA BRIANZA', 'Lombardia');
PROVINCE_REGION.set('FORLI\'-CESENA', 'Emilia-Romagna');
const REGION_NAMES = REGIONS.map(r => r.name);
function regionOf(section, province) {
  const s = String(section || '').toUpperCase().replace('SEZIONE REGIONALE ', '').trim();
  if (/TRENTO|BOLZANO/.test(s)) return 'Trentino-Alto Adige';
  if (s && s !== 'CENTRALE' && s !== 'NON CLASSIFICATO') {
    const key = s.replace(/[^A-Z]/g, '');
    return REGION_NAMES.find(r => r.toUpperCase().replace(/[^A-Z]/g, '') === key) || titleCase(s);
  }
  return PROVINCE_REGION.get(String(province || '').toUpperCase().trim()) || '';
}
const sameRegion = (a, b) => String(a || '').toLowerCase().replace(/[^a-z]/g, '') === String(b || '').toLowerCase().replace(/[^a-z]/g, '');
function criterionOf(s) {
  const t = String(s || '').toUpperCase();
  if (!t) return '';
  if (/MINOR PREZZO|PREZZO PIU|PRICE/.test(t)) return 'prezzo';
  return 'oepv';
}
const num = x => { const n = Number(String(x ?? '').replace(',', '.')); return x === '' || x === null || x === undefined || !Number.isFinite(n) ? null : n; };
const date = x => (/^\d{4}-\d{2}-\d{2}/.test(String(x || '')) ? String(x).slice(0, 10) : null);

// ── CSV con «;» e virgolette, anche con a capo dentro un campo ─────────────────────────────
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const openQuotes = s => { let n = 0; for (const c of s) if (c === '"') n++; return n % 2 === 1; };

// Lo zip di ANAC ha un solo file: si salta l'intestazione locale e si decomprime il resto mentre arriva.
function stripZipHeader() {
  let buf = Buffer.alloc(0), done = false;
  return new Transform({
    transform(chunk, _, cb) {
      if (done) return cb(null, chunk);
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 30) return cb();
      if (buf.readUInt32LE(0) !== 0x04034b50) return cb(new Error('Il file ANAC non è uno zip'));
      if (buf.readUInt16LE(8) !== 8) return cb(new Error('Zip ANAC non compresso con deflate'));
      const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
      if (buf.length < start) return cb();
      done = true;
      const rest = buf.subarray(start);
      buf = null;
      cb(null, rest);
    },
  });
}
// righe come oggetti { colonna: valore }; quick(cig) → false salta la riga senza leggerla tutta
async function* rowsOf(stream, quick) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let head = null, pending = '';
  for await (const raw of rl) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if (openQuotes(line)) { pending = line; continue; }
    pending = '';
    if (!head) { head = parseLine(line.replace(/^﻿/, '')).map(h => h.toLowerCase()); continue; }
    if (quick) { const m = line.match(/^"?([A-Z0-9]{10})"?;/i); if (m && !quick(m[1].toUpperCase())) continue; }
    const c = parseLine(line);
    const r = {};
    for (let i = 0; i < head.length; i++) r[head[i]] = c[i] ?? '';
    yield r;
  }
}
async function* fetchRows(url, { fetchImpl = fetch, quick } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`ANAC ${res.status} su ${url.split('/').pop()}`);
  const body = typeof res.body?.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
  const inflate = body.pipe(stripZipHeader()).pipe(zlib.createInflateRaw());
  body.on('error', err => inflate.destroy(err));
  try { yield* rowsOf(inflate, quick); } finally { inflate.destroy(); body.destroy?.(); }
}
const fileUrl = (dataset, month) => `${BASE}/download/dataset/${dataset}/filesystem/${month}01-${dataset}_csv.zip`;

// mesi pubblicati (AAAAMM), dal più vecchio
async function monthsAvailable({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE}/api/3/action/package_show?id=aggiudicazioni`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`ANAC ${res.status} sull'elenco dei file`);
  const data = await res.json();
  return [...new Set((data?.result?.resources || []).map(r => String(r.name || '').match(/^(\d{6})01-aggiudicazioni_csv$/)?.[1]).filter(Boolean))].sort();
}

// Che gare tenere: categorie SOA dei profili BU (più quelle in più) o CPV delle BU di servizi.
function keepRules(settings) {
  const cats = new Set((settings.concorrenza.extra_categories || []).map(normCat));
  for (const p of Object.values(settings.profiles || {})) for (const s of p.soa || []) cats.add(normCat(s));
  const cpv = [...new Set(Object.values(settings.concorrenza.cpv || {}).flat().map(c => String(c).replace(/\D/g, '')).filter(Boolean))];
  return { cats, cpv, min: Number(settings.concorrenza.min_amount) || 0 };
}
const keeps = (rules, a) => (a.amount ?? a.base_amount ?? 0) >= rules.min && (rules.cats.has(a.category) || rules.cpv.some(p => a.cpv.startsWith(p)));

// Un mese: i quattro file, poi le righe tenute nel database. Restituisce { awards, kept }.
async function importMonth(db, month, settings, { fetchImpl = fetch, log = () => {} } = {}) {
  const rules = keepRules(settings);
  const aw = new Map();
  for await (const r of fetchRows(fileUrl('aggiudicazioni', month), { fetchImpl })) {
    const cig = String(r.cig || '').toUpperCase();
    if (!cig || String(r.esito || '').toUpperCase() !== 'AGGIUDICATA') continue;
    const day = date(r.data_aggiudicazione_definitiva) || date(r.data_comunicazione_esito);
    const amt = num(r.importo_aggiudicazione);
    if (amt !== null && amt < rules.min) continue; // affidamenti piccoli: fuori subito, la memoria resta bassa anche nei mesi grandi
    const old = aw.get(cig);
    if (old && old.awarded_on && day && old.awarded_on > day) continue;
    aw.set(cig, { cig, awarded_on: day, amount: num(r.importo_aggiudicazione), discount: num(r.ribasso_aggiudicazione),
      bidders: num(r.num_imprese_offerenti) ?? num(r.numero_offerte_ammesse), criterion: criterionOf(r.criterio_aggiudicazione),
      subcontract: String(r.flag_subappalto).toLowerCase() === 'true', category: '', cpv: '', winners: [] });
  }
  log(`${month}: ${aw.size} aggiudicazioni`);
  for await (const r of fetchRows(fileUrl('categorie-opera', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (a && r.cod_tipo_categoria === 'P') a.category = normCat(r.id_categoria);
  }
  for await (const r of fetchRows(fileUrl('cig', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (!a) continue;
    Object.assign(a, { object: String(r.oggetto_lotto || r.oggetto_gara || '').slice(0, 500), sa_cf: String(r.cf_amministrazione_appaltante || ''),
      sa_name: String(r.denominazione_amministrazione_appaltante || '').slice(0, 300), province: titleCase(r.provincia || ''),
      region: regionOf(r.sezione_regionale, r.provincia), cpv: String(r.cod_cpv || '').replace(/\D/g, ''), kind: String(r.oggetto_principale_contratto || '').toUpperCase().slice(0, 20),
      base_amount: num(r.importo_lotto), published_on: date(r.data_pubblicazione), pnrr: String(r.flag_pnrr_pnc) === '1', seen: true });
  }
  for (const [cig, a] of aw) if (!a.seen || !keeps(rules, a)) aw.delete(cig);
  for await (const r of fetchRows(fileUrl('aggiudicatari', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (!a || !r.denominazione) continue;
    const role = /MANDATARIA/i.test(r.ruolo) ? 'mandataria' : /MANDANTE/i.test(r.ruolo) ? 'mandante' : /AUSILIARIA/i.test(r.ruolo) ? 'ausiliaria' : /CONSORZ/i.test(r.ruolo) ? 'consorzio' : '';
    if (role === 'ausiliaria') continue; // l'impresa ausiliaria presta i requisiti, non vince
    const cf = String(r.codice_fiscale || '').toUpperCase().trim();
    if (a.winners.some(w => w.cf === cf && cf)) continue;
    a.winners.push({ cf, name: String(r.denominazione).trim().slice(0, 200), role });
  }
  const rows = [...aw.values()];
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const cols = ['cig', 'object', 'sa_cf', 'sa_name', 'region', 'province', 'category', 'cpv', 'kind', 'base_amount', 'amount', 'discount', 'bidders', 'criterion', 'awarded_on', 'published_on', 'pnrr', 'subcontract', 'winners', 'month'];
    const vals = [];
    const ph = part.map((a, j) => `(${cols.map((c, k) => `$${j * cols.length + k + 1}`).join(', ')})`);
    for (const a of part) vals.push(a.cig, a.object || '', a.sa_cf || '', a.sa_name || '', a.region || '', a.province || '', a.category, a.cpv, a.kind || '', a.base_amount, a.amount,
      a.discount, a.bidders === null ? null : Math.round(a.bidders), a.criterion, a.awarded_on, a.published_on, Boolean(a.pnrr), a.subcontract, JSON.stringify(a.winners), month);
    await db.query(`INSERT INTO crm_anac_awards (${cols.join(', ')}) VALUES ${ph.join(', ')}
      ON CONFLICT (cig) DO UPDATE SET ${cols.filter(c => c !== 'cig').map(c => `${c} = EXCLUDED.${c}`).join(', ')}`, vals);
  }
  return { awards: aw.size, kept: rows.length };
}

// Mesi mancanti (negli ultimi N mesi), uno dopo l'altro. Un mese con errore si riprova al giro dopo.
let running = null;
function syncAnac(db, settings, opts = {}) {
  if (running) return running;
  running = (async () => {
    const out = [];
    try {
      const months = await monthsAvailable(opts);
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - Number(settings.concorrenza.months || 12) + 1, 1)).toISOString().slice(0, 7).replace('-', '');
      const { rows: done } = await db.query("SELECT month FROM crm_anac_imports WHERE error = ''");
      const have = new Set(done.map(r => r.month));
      for (const m of months.filter(x => x >= from && !have.has(x)).slice(0, opts.max ?? 24)) {
        try {
          const r = await importMonth(db, m, settings, opts);
          await db.query(`INSERT INTO crm_anac_imports (month, awards, kept, error, at) VALUES ($1, $2, $3, '', now())
                          ON CONFLICT (month) DO UPDATE SET awards = EXCLUDED.awards, kept = EXCLUDED.kept, error = '', at = now()`, [m, r.awards, r.kept]);
          out.push({ month: m, ...r });
        } catch (err) {
          await db.query(`INSERT INTO crm_anac_imports (month, error, at) VALUES ($1, $2, now()) ON CONFLICT (month) DO UPDATE SET error = EXCLUDED.error, at = now()`, [m, String(err.message).slice(0, 500)]);
          out.push({ month: m, error: err.message });
        }
      }
      // via le gare più vecchie della finestra
      await db.query(`DELETE FROM crm_anac_awards WHERE awarded_on < CURRENT_DATE - ($1 || ' months')::interval`, [String(Number(settings.concorrenza.months || 12) + 1)]);
    } finally { running = null; }
    return out;
  })();
  return running;
}
const isRunning = () => Boolean(running);

module.exports = { CONCORRENZA_DEFAULT, normCat, regionOf, sameRegion, criterionOf, parseLine, rowsOf, stripZipHeader, fetchRows, monthsAvailable, keepRules, keeps, importMonth, syncAnac, isRunning, UA };
