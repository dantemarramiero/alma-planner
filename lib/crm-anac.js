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
const DATA_VER = 2; // 2 = con categorie scorporabili, tipo di lavoro e partecipanti (ALM2-49, 21/11/2026)
// il firewall di ANAC rifiuta i client che non sembrano un browser (pagina «Request Rejected», 20/11/2026: nessun mese
// caricato dal 17/11): serve uno User-Agent da browser completo e l'Accept. Nessun dato nostro nella richiesta.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'it-IT,it;q=0.9' };
const rejected = res => String(res.headers?.get?.('content-type') || '').toLowerCase().includes('text/html');

const CONCORRENZA_DEFAULT = {
  on: true,
  months: 24,            // quanti mesi tenere (e caricare la prima volta); 24 dal 21/11 (Dante)
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
const quoteParity = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 34) n++; return n & 1; };

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
  let head = null, pending = '', odd = 0, joined = 0, n = 0;
  for await (const raw of rl) {
    // ogni 5.000 righe si cede il turno: i file di un mese sono centinaia di MB e senza pause il server non risponde (21/11)
    if (++n % 5000 === 0) await new Promise(ok => setImmediate(ok));
    // un campo tra virgolette può andare a capo: si uniscono le righe finché le virgolette non tornano pari. Si conta solo
    // la riga nuova (prima si ricontava tutto il pezzo unito: con una virgoletta sbagliata nel file diventava lentissimo
    // e ANAC chiudeva la connessione, 21/11); un record che non si chiude entro 50 righe si scarta.
    const q = quoteParity(raw);
    const line = pending ? `${pending}\n${raw}` : raw;
    odd = pending ? odd ^ q : q;
    if (odd) {
      if (++joined > 50) { pending = ''; odd = 0; joined = 0; continue; }
      pending = line;
      continue;
    }
    pending = '';
    joined = 0;
    if (!head) { head = parseLine(line.replace(/^﻿/, '')).map(h => h.toLowerCase()); continue; }
    if (quick) { const m = line.match(/^"?([A-Z0-9]{10})"?;/i); if (m && !quick(m[1].toUpperCase())) continue; }
    const c = parseLine(line);
    const r = {};
    for (let i = 0; i < head.length; i++) r[head[i]] = c[i] ?? '';
    yield r;
  }
}
async function* fetchRows(url, { fetchImpl = fetch, quick } = {}) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ANAC ${res.status} su ${url.split('/').pop()}`);
  if (rejected(res)) throw new Error(`ANAC ha rifiutato la richiesta di ${url.split('/').pop()} (pagina del firewall al posto del file)`);
  const body = typeof res.body?.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
  const inflate = body.pipe(stripZipHeader()).pipe(zlib.createInflateRaw());
  body.on('error', err => inflate.destroy(err));
  try { yield* rowsOf(inflate, quick); } finally { inflate.destroy(); body.destroy?.(); }
}
const fileUrl = (dataset, month) => `${BASE}/download/dataset/${dataset}/filesystem/${month}01-${dataset}_csv.zip`;

// mesi pubblicati (AAAAMM), dal più vecchio
async function monthsAvailable({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE}/api/3/action/package_show?id=aggiudicazioni`, { headers: HEADERS });
  if (!res.ok) throw new Error(`ANAC ${res.status} sull'elenco dei file`);
  if (rejected(res)) throw new Error('ANAC ha rifiutato la richiesta dell’elenco dei file (pagina del firewall al posto dei dati)');
  const data = await res.json();
  return [...new Set((data?.result?.resources || []).map(r => String(r.name || '').match(/^(\d{6})01-aggiudicazioni_csv$/)?.[1]).filter(Boolean))].sort();
}

// Che gare tenere: categorie SOA dei profili BU (più quelle in più e quelle delle iniziative aperte di Nuovi business,
// 20/11) o CPV delle BU di servizi.
function keepRules(settings, initiativeCats = []) {
  const cats = new Set((settings.concorrenza.extra_categories || []).map(normCat));
  for (const p of Object.values(settings.profiles || {})) for (const s of p.soa || []) cats.add(normCat(s));
  for (const c of initiativeCats) cats.add(normCat(c));
  cats.delete('');
  const cpv = [...new Set(Object.values(settings.concorrenza.cpv || {}).flat().map(c => String(c).replace(/\D/g, '')).filter(Boolean))];
  return { cats, cpv, min: Number(settings.concorrenza.min_amount) || 0 };
}
const keeps = (rules, a) => (a.amount ?? a.base_amount ?? 0) >= rules.min && (rules.cats.has(a.category) || rules.cpv.some(p => a.cpv.startsWith(p)));

// Un mese: i quattro file letti e filtrati → le gare da tenere. Gira in un thread a parte (collectInWorker) perché sono
// centinaia di MB di testo: nel processo del server lo bloccherebbe per decine di minuti (21/11).
async function collectMonth(month, settings, { fetchImpl = fetch, log = () => {}, initiativeCats = [] } = {}) {
  const rules = keepRules(settings, initiativeCats);
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
      subcontract: String(r.flag_subappalto).toLowerCase() === 'true', category: '', cats_sec: [], cpv: '', winners: [] });
  }
  log(`${month}: ${aw.size} aggiudicazioni`);
  for await (const r of fetchRows(fileUrl('categorie-opera', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (!a) continue;
    if (r.cod_tipo_categoria === 'P') a.category = normCat(r.id_categoria);
    else addSecondary(a, r);
  }
  // senza CPV da tenere conta solo la categoria: via subito le gare fuori categoria, così la memoria resta bassa (21/11)
  if (!rules.cpv.length) for (const [cig, a] of aw) if (!rules.cats.has(a.category)) aw.delete(cig);
  log(`${month}: ${aw.size} nelle categorie`);
  for await (const r of fetchRows(fileUrl('cig', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (!a) continue;
    // si decide subito se tenerla (categoria o CPV, importo): i testi lunghi si copiano solo per quelle tenute (21/11)
    const cpv = String(r.cod_cpv || '').replace(/D/g, ''), base = num(r.importo_lotto);
    if (!keeps(rules, { ...a, cpv, base_amount: base })) { aw.delete(a.cig); continue; }
    Object.assign(a, { object: String(r.oggetto_lotto || r.oggetto_gara || '').slice(0, 500), sa_cf: String(r.cf_amministrazione_appaltante || ''),
      sa_name: String(r.denominazione_amministrazione_appaltante || '').slice(0, 300), province: titleCase(r.provincia || ''),
      region: regionOf(r.sezione_regionale, r.provincia), cpv: String(r.cod_cpv || '').replace(/\D/g, ''), kind: String(r.oggetto_principale_contratto || '').toUpperCase().slice(0, 20),
      base_amount: num(r.importo_lotto), published_on: date(r.data_pubblicazione), pnrr: String(r.flag_pnrr_pnc) === '1', seen: true });
  }
  for (const [cig, a] of aw) if (!a.seen || !keeps(rules, a)) aw.delete(cig);
  log(`${month}: ${aw.size} da tenere`);
  for await (const r of fetchRows(fileUrl('aggiudicatari', month), { fetchImpl, quick: cig => aw.has(cig) })) {
    const a = aw.get(String(r.cig).toUpperCase());
    if (a) addWinner(a, r);
  }
  await addExtras(aw, ds => fileUrl(ds, month), { fetchImpl, log, label: month });
  return { rows: [...aw.values()], cats: [...rules.cats].sort() };
}
// categoria scorporabile o secondaria (categorie-opera tipo diverso da P), senza doppioni
function addSecondary(a, r) {
  const c = normCat(r.id_categoria);
  if (c && c !== a.category && !a.cats_sec.includes(c)) a.cats_sec.push(c);
}
// Dati in più sulle gare tenute (ALM2-49): tipo di lavoro (lavorazioni) e chi ha partecipato (partecipanti, anche chi ha
// perso). Un file che manca o non si legge non ferma il mese: si segna nel log.
async function addExtras(aw, urlOf, { fetchImpl = fetch, log = () => {}, label = '' } = {}) {
  if (!aw.size) return;
  const tryRead = async (ds, fn) => {
    try { for await (const r of fetchRows(urlOf(ds), { fetchImpl, quick: cig => aw.has(cig) })) { const a = aw.get(String(r.cig || '').toUpperCase()); if (a) fn(a, r); } }
    catch (e) { log(`${label}: ${ds} non letto (${e.message})`); }
  };
  await tryRead('lavorazioni', (a, r) => { if (!a.work_type && r.tipo_lavorazione) a.work_type = titleCase(r.tipo_lavorazione).slice(0, 40); });
  await tryRead('partecipanti', (a, r) => {
    const cf = String(r.codice_fiscale || '').toUpperCase().trim();
    if (!cf || /AUSILIARIA/i.test(r.ruolo)) return;
    a.parts = a.parts || [];
    if (a.parts.length >= 60 || a.parts.some(p => p.cf === cf)) return;
    const role = /MANDATARIA/i.test(r.ruolo) ? 'mandataria' : /MANDANTE/i.test(r.ruolo) ? 'mandante' : /CONSORZ/i.test(r.ruolo) ? 'consorzio' : '';
    a.parts.push({ cf, name: String(r.denominazione || '').trim().slice(0, 200), role });
  });
  log(`${label}: tipo di lavoro e partecipanti letti`);
}
// Un aggiudicatario sulla gara (anche in ATI); l'impresa ausiliaria presta i requisiti, non vince.
function addWinner(a, r) {
  if (!r.denominazione) return;
  const role = /MANDATARIA/i.test(r.ruolo) ? 'mandataria' : /MANDANTE/i.test(r.ruolo) ? 'mandante' : /AUSILIARIA/i.test(r.ruolo) ? 'ausiliaria' : /CONSORZ/i.test(r.ruolo) ? 'consorzio' : '';
  if (role === 'ausiliaria') return;
  const cf = String(r.codice_fiscale || '').toUpperCase().trim();
  if (a.winners.some(w => w.cf === cf && cf)) return;
  a.winners.push({ cf, name: String(r.denominazione).trim().slice(0, 200), role });
}

// Il lavoro in un worker_thread: il server resta libero; se il thread finisce la memoria si ferma solo lui.
// job: { kind: 'mese', month } · { kind: 'storico', from, to } · { kind: 'extra', cigs, files, cup }.
function collectInWorker(job, settings, { log = () => {}, initiativeCats = [] } = {}) {
  const { Worker } = require('worker_threads');
  const label = job.kind === 'storico' ? `lo storico ${job.from}–${job.to}` : job.kind === 'extra' ? 'subappalti e CUP' : job.month;
  return new Promise((ok, ko) => {
    let settled = false;
    const end = (fn, v) => { if (settled) return; settled = true; fn(v); w.terminate().catch(() => {}); };
    const w = new Worker(require('path').join(__dirname, 'crm-anac-worker.js'), { workerData: { ...job, settings, initiativeCats },
      resourceLimits: { maxOldGenerationSizeMb: job.kind === 'mese' ? 512 : 768 } });
    w.on('message', m => { if (m.log) log(m.log); else if (m.done) end(ok, m.done); else if (m.error) end(ko, new Error(m.error)); });
    w.on('error', e => end(ko, e));
    w.on('exit', code => end(ko, new Error(`Il caricamento ANAC di ${label} si è fermato (codice ${code})`)));
  });
}
// fetchImpl diverso da quello di sistema = test: si legge nel processo (il worker non può usare un fetch finto)
const inProcess = opts => Boolean(opts.fetchImpl) && opts.fetchImpl !== fetch;

// Un mese: le gare tenute nel database.
async function importMonth(db, month, settings, opts = {}) {
  const { rows, cats } = await (inProcess(opts) ? collectMonth(month, settings, opts) : collectInWorker({ kind: 'mese', month }, settings, opts));
  await saveRows(db, rows, () => month);
  return { awards: rows.length, kept: rows.length, cats };
}
// Storico: i mesi from…to dal file unico e dai CIG per anno; ogni gara col mese della sua aggiudicazione. Le gare già
// arrivate da un file mensile (più recente) restano come sono.
async function importHistory(db, from, to, settings, opts = {}) {
  const S = require('./crm-anac-storico');
  const { rows, cats } = await (inProcess(opts) ? S.collectHistory(settings, { ...opts, from, to }) : collectInWorker({ kind: 'storico', from, to }, settings, opts));
  await saveRows(db, rows, a => a.awarded_on.slice(0, 7).replace('-', ''), { keepExisting: true });
  const perMonth = {};
  for (const a of rows) { const m = a.awarded_on.slice(0, 7).replace('-', ''); perMonth[m] = (perMonth[m] || 0) + 1; }
  return { kept: rows.length, perMonth, cats };
}
// Subappalti e CUP per le gare nel database (nel worker): solo i file che mancano (lib/crm-anac-extra.js)
async function importExtra(db, months, opts = {}) {
  const X = require('./crm-anac-extra');
  const todo = await X.extraTodo(db, months);
  if (!todo.files.length && !todo.cup) return null;
  const cigs = (await db.query('SELECT cig FROM crm_anac_awards')).rows.map(r => r.cig);
  if (!cigs.length) return null;
  const job = { cigs, files: todo.files, cup: todo.cup };
  const r = await (inProcess(opts) ? X.collectExtra(job, opts) : collectInWorker({ kind: 'extra', ...job }, {}, opts));
  await X.saveExtra(db, r);
  return { subappalti: r.subs.length, cup: r.cups.length, errori: Object.keys(r.errors).length };
}
async function saveRows(db, rows, monthOf, { keepExisting = false } = {}) {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const cols = ['cig', 'object', 'sa_cf', 'sa_name', 'region', 'province', 'category', 'cpv', 'kind', 'base_amount', 'amount', 'discount', 'bidders', 'criterion', 'awarded_on', 'published_on', 'pnrr', 'subcontract', 'winners', 'month', 'cats_sec', 'work_type', 'bidders_counted'];
    const vals = [];
    const ph = part.map((a, j) => `(${cols.map((c, k) => `$${j * cols.length + k + 1}`).join(', ')})`);
    for (const a of part) vals.push(a.cig, a.object || '', a.sa_cf || '', a.sa_name || '', a.region || '', a.province || '', a.category, a.cpv, a.kind || '', a.base_amount, a.amount,
      a.discount ?? null, a.bidders == null ? null : Math.round(a.bidders), a.criterion ?? null, a.awarded_on, a.published_on, Boolean(a.pnrr), Boolean(a.subcontract), JSON.stringify(a.winners), monthOf(a), a.cats_sec || [], a.work_type || '', false);
    await db.query(`INSERT INTO crm_anac_awards (${cols.join(', ')}) VALUES ${ph.join(', ')}
      ON CONFLICT (cig) DO UPDATE SET ${(keepExisting ? ['cats_sec', 'work_type'] : cols.filter(c => c !== 'cig')).map(c => `${c} = EXCLUDED.${c}`).join(', ')}`, vals);
  }
  await saveBidders(db, rows);
  await countBidders(db, rows.map(a => a.cig));
}
// Offerenti non dichiarati: si contano i partecipanti (un'ATI una volta sola: mandataria, consorzio o impresa da sola)
async function countBidders(db, cigs) {
  for (let i = 0; i < cigs.length; i += 2000) {
    await db.query(`UPDATE crm_anac_awards a SET bidders = x.n, bidders_counted = true
        FROM (SELECT cig, count(DISTINCT cf) FILTER (WHERE role <> 'mandante')::int AS n FROM crm_anac_bidders WHERE cig = ANY($1::text[]) GROUP BY cig) x
       WHERE a.cig = x.cig AND x.n > 0 AND (a.bidders IS NULL OR a.bidders_counted)`, [cigs.slice(i, i + 2000)]);
  }
}
// chi ha partecipato (crm_anac_bidders): si riscrivono quelli delle gare di questo giro
async function saveBidders(db, rows) {
  const withParts = rows.filter(a => a.parts && a.parts.length);
  for (let i = 0; i < withParts.length; i += 100) {
    const part = withParts.slice(i, i + 100);
    await db.query('DELETE FROM crm_anac_bidders WHERE cig = ANY($1::text[])', [part.map(a => a.cig)]);
    const flat = part.flatMap(a => a.parts.map(p => [a.cig, p.cf, p.name, p.role]));
    for (let j = 0; j < flat.length; j += 500) {
      const chunk = flat.slice(j, j + 500);
      await db.query(`INSERT INTO crm_anac_bidders (cig, cf, name, role) VALUES ${chunk.map((_, k) => `($${k * 4 + 1}, $${k * 4 + 2}, $${k * 4 + 3}, $${k * 4 + 4})`).join(', ')} ON CONFLICT DO NOTHING`, chunk.flat());
    }
  }
}

// Categorie SOA dei profili delle iniziative aperte di Nuovi business (crm_initiatives.profile.soa)
async function initiativeCategories(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT jsonb_array_elements_text(profile->'soa') AS c FROM crm_initiatives
      WHERE phase <> 'abbandonata' AND jsonb_typeof(profile->'soa') = 'array'`);
  return [...new Set(rows.map(r => normCat(r.c)).filter(Boolean))];
}

// Quali categorie sono caricate in tutti i mesi della finestra (per chi legge crm_anac_awards filtrando per categoria):
// { window: ['202512', …], loaded: ['OG1', …], pending: ['OG10', …] } — pending = da caricare al prossimo giro.
async function categoryCoverage(db, settings) {
  const from = windowStart(settings);
  const { rows } = await db.query("SELECT month, cats FROM crm_anac_imports WHERE error = '' AND month >= $1 ORDER BY month", [from]);
  const base = [...keepRules(settings).cats];
  const want = [...keepRules(settings, await initiativeCategories(db)).cats];
  const covers = r => new Set(r.cats || base);
  const loaded = rows.length ? want.filter(c => rows.every(r => covers(r).has(c))) : [];
  return { window: rows.map(r => r.month), loaded: loaded.sort(), pending: want.filter(c => !loaded.includes(c)).sort() };
}
const windowStart = settings => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - Number(settings.concorrenza.months || 12) + 1, 1)).toISOString().slice(0, 7).replace('-', '');
};

// Mesi mancanti (negli ultimi N mesi), uno dopo l'altro. Un mese con errore si riprova al giro dopo.
let running = null;
function syncAnac(db, settings, opts = {}) {
  if (running) return running;
  running = (async () => {
    const out = [];
    try {
      const months = await monthsAvailable(opts);
      const from = windowStart(settings);
      // un mese va (ri)caricato se manca o se non ha tutte le categorie di adesso (es. una categoria nuova di un'iniziativa)
      const initiativeCats = await initiativeCategories(db);
      const want = [...keepRules(settings, initiativeCats).cats];
      const base = [...keepRules(settings).cats];
      const { rows: done } = await db.query("SELECT month, cats, ver FROM crm_anac_imports WHERE error = ''");
      const have = new Map(done.map(r => [r.month, new Set(r.cats || base)]));
      const ver = new Map(done.map(r => [r.month, Number(r.ver) || 1]));
      // da (ri)caricare: manca, non ha tutte le categorie, o è di prima dei dati in più (versione 2, ALM2-49)
      const stale = x => !have.has(x) || want.some(c => !have.get(x).has(c)) || (ver.get(x) || 1) < DATA_VER;
      const todo = months.filter(x => x >= from && stale(x));
      for (const m of todo.slice(0, opts.max ?? 24)) {
        try {
          const r = await importMonth(db, m, settings, { log: x => console.log(`[anac] ${x}`), ...opts, initiativeCats });
          await db.query(`INSERT INTO crm_anac_imports (month, awards, kept, error, at, cats, ver) VALUES ($1, $2, $3, '', now(), $4, $5)
                          ON CONFLICT (month) DO UPDATE SET awards = EXCLUDED.awards, kept = EXCLUDED.kept, error = '', at = now(), cats = EXCLUDED.cats, ver = EXCLUDED.ver`, [m, r.awards, r.kept, r.cats, DATA_VER]);
          out.push({ month: m, ...r });
        } catch (err) {
          await db.query(`INSERT INTO crm_anac_imports (month, error, at) VALUES ($1, $2, now()) ON CONFLICT (month) DO UPDATE SET error = EXCLUDED.error, at = now()`, [m, String(err.message).slice(0, 500)]);
          out.push({ month: m, error: err.message });
        }
      }
      // Storico (21/11): i mesi della finestra prima dei file mensili, dal file unico di ANAC (aggiornato fino a dicembre 2025)
      const end = await require('./crm-anac-storico').historyEnd(opts).catch(() => null);
      const hist = end && from <= end ? require('./crm-anac-storico').monthsBetween(from, end).filter(x => !months.includes(x) && stale(x)) : [];
      if (hist.length && opts.history !== false) {
        const hFrom = hist[0];
        const span = require('./crm-anac-storico').monthsBetween(hFrom, end).filter(x => !months.includes(x));
        try {
          const r = await importHistory(db, hFrom, end, settings, { log: x => console.log(`[anac] ${x}`), ...opts, initiativeCats });
          for (const m of span) {
            await db.query(`INSERT INTO crm_anac_imports (month, awards, kept, error, at, cats, ver) VALUES ($1, $2, $2, '', now(), $3, $4)
                            ON CONFLICT (month) DO UPDATE SET awards = EXCLUDED.awards, kept = EXCLUDED.kept, error = '', at = now(), cats = EXCLUDED.cats, ver = EXCLUDED.ver`, [m, r.perMonth[m] || 0, r.cats, DATA_VER]);
          }
          out.push({ storico: `${hFrom}–${end}`, kept: r.kept });
        } catch (err) {
          for (const m of span) await db.query(`INSERT INTO crm_anac_imports (month, error, at) VALUES ($1, $2, now()) ON CONFLICT (month) DO UPDATE SET error = EXCLUDED.error, at = now()`, [m, `Storico: ${String(err.message).slice(0, 480)}`]);
          out.push({ storico: `${hFrom}–${end}`, error: err.message });
        }
      }
      // Subappalti e CUP (ALM2-49): arrivano dopo l'aggiudicazione, si cercano per tutte le gare già caricate
      if (opts.extra !== false) {
        try { const r = await importExtra(db, months, { log: x => console.log(`[anac] ${x}`), ...opts }); if (r) out.push({ extra: r }); }
        catch (err) { console.warn('[anac] subappalti e CUP:', err.message); out.push({ extra: { error: err.message } }); }
      }
      // via le gare più vecchie della finestra
      await db.query(`DELETE FROM crm_anac_awards WHERE awarded_on < CURRENT_DATE - ($1 || ' months')::interval`, [String(Number(settings.concorrenza.months || 12) + 1)]);
    } finally { running = null; }
    return out;
  })();
  return running;
}
const isRunning = () => Boolean(running);

module.exports = { initiativeCategories, categoryCoverage, CONCORRENZA_DEFAULT, normCat, regionOf, sameRegion, criterionOf, parseLine, rowsOf, stripZipHeader, fetchRows, monthsAvailable, keepRules, keeps, collectMonth, importMonth, importHistory, importExtra, DATA_VER, addWinner, addSecondary, addExtras, num, date, titleCase, syncAnac, isRunning, UA };
