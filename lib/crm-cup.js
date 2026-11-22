// Opere finanziate da OpenCUP (ALM2-49, canvas CRM v14 · V14-OpenCUP, via di Dante 22/11/2026).
// Ogni opera pubblica prende un CUP quando viene decisa e finanziata, mesi prima della gara. OpenCUP pubblica ogni
// mese tutti i CUP in cinque file per area (Nord-ovest, Nord-est, Centro, Sud, Isole: centinaia di MB zippati,
// miliardi di byte di CSV). Una volta al mese, in un thread a parte (lib/crm-cup-worker.js), si scaricano solo le aree
// delle regioni in uso, un file alla volta in una cartella temporanea, e si tengono i lavori pubblici attivi degli
// ultimi anni per i tipi di lavoro delle categorie SOA in uso. Incrociati con ANAC (colonna cup delle gare) dicono
// quali opere sono «ancora senza gara». Le letture: sezione «Opere finanziate» del Mercato e la fonte nel riquadro dati.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { regionOf, parseLine, titleCase, UA } = require('./crm-anac');

const PORTAL = 'https://www.opencup.gov.it/portale/web/opencup';
const YEARS = 4;                         // anni di decisione da tenere (dal 2022 nel 2026)
const AREAS = {
  'nord-ovest': ['Piemonte', 'Valle d\'Aosta', 'Liguria', 'Lombardia'],
  'nord-est': ['Trentino-Alto Adige', 'Veneto', 'Friuli-Venezia Giulia', 'Emilia-Romagna'],
  centro: ['Toscana', 'Umbria', 'Marche', 'Lazio'],
  sud: ['Abruzzo', 'Molise', 'Campania', 'Puglia', 'Basilicata', 'Calabria'],
  isole: ['Sicilia', 'Sardegna'],
};
const HEADERS = { 'User-Agent': UA, Accept: '*/*' };

// Categorie SOA → tipi di lavoro CUP (settore.sottosettore.categoria, bastano le prime cifre). In Impostazioni →
// Concorrenza si aggiungono tipi (settings.concorrenza.cup_types).
const TYPES = {
  OG1: ['05.08', '05.10', '05.30', '05.32', '05.33', '05.34', '05.36'], OG2: ['05.11', '05.31'], OG3: ['01.01', '01.03'],
  OG5: ['02.15.110', '02.15.111'], OG6: ['02.15.112', '02.15.113', '02.15.116', '02.15.118', '02.15.119', '02.15.120', '02.15.122', '03.16.060', '03.16.142'],
  OG7: ['01.04'], OG8: ['02.05.051', '02.05.121'], OG9: ['03.06'],
  OG10: ['03.16.004', '03.16.065', '03.16.066', '03.16.068', '03.16.999', '05.99.193'],
  OG11: ['05.30.111', '05.08.087', '05.08.086', '05.33.003'], OG12: ['02.05.120', '02.12'], OG13: ['02.11', '02.05.122'],
  OS19: ['07.17'], OS22: ['02.15.114', '02.15.115', '02.15.117'], OS24: ['05.99.192', '02.11.119'],
  OS28: ['05.30.111', '05.08.087', '05.08.086'], OS30: ['05.30.111', '05.08.087', '05.08.086', '05.33.003'],
};
const TYPE_LABEL = {
  '05.08': 'edifici sociali e scolastici', '05.10': 'edifici abitativi', '05.30': 'strutture sanitarie', '05.32': 'caserme', '05.33': 'sedi della PA',
  '05.34': 'tribunali e carceri', '05.36': 'pubblica sicurezza', '05.11': 'beni culturali', '05.31': 'edifici di culto', '01.01': 'strade', '01.03': 'ferrovie',
  '02.15.110': 'dighe', '02.15.111': 'bacini irrigui', '02.15.112': 'captazione acqua', '02.15.113': 'adduzione acqua', '02.15.116': 'reti fognarie',
  '02.15.118': 'reti idriche urbane', '02.15.119': 'reti idriche rurali', '02.15.120': 'serbatoi e sollevamenti', '02.15.122': 'acque pluviali',
  '03.16.060': 'reti gas', '03.16.142': 'gasdotti', '01.04': 'porti e opere marittime', '02.05.051': 'corsi d\'acqua', '02.05.121': 'regimazione acque',
  '03.06': 'produzione di energia', '03.16.004': 'efficienza delle reti e risparmio energetico', '03.16.065': 'trasmissione di energia elettrica',
  '03.16.066': 'distribuzione di energia elettrica e termica', '03.16.068': 'elettrificazioni rurali', '03.16.999': 'altri impianti di distribuzione energia',
  '05.99.193': 'illuminazione pubblica', '05.30.111': 'ospedali', '05.08.087': 'scuole', '05.08.086': 'altri edifici scolastici', '05.33.003': 'sedi della PA',
  '02.05.120': 'bonifica di siti', '02.12': 'siti dismessi e contaminati', '02.11': 'ambiente e aree protette', '02.05.122': 'foreste', '07.17': 'telecomunicazioni',
  '02.15.114': 'depuratori', '02.15.115': 'trattamento e riuso acque', '02.15.117': 'potabilizzazione', '05.99.192': 'verde pubblico', '02.11.119': 'infrastrutture verdi',
};

function typesFor(cats, settings = {}) {
  const extra = settings.concorrenza?.cup_types || {};
  return [...new Set((cats || []).flatMap(c => [...(TYPES[c] || []), ...(extra[c] || [])]))];
}
const typesMap = settings => Object.fromEntries(Object.keys({ ...TYPES, ...(settings.concorrenza?.cup_types || {}) }).sort().map(c => [c, typesFor([c], settings)]));
const labelOf = key => { for (let k = key; k; k = k.slice(0, k.lastIndexOf('.'))) { if (TYPE_LABEL[k]) return TYPE_LABEL[k]; if (!k.includes('.')) break; } return ''; };
const areasFor = regions => (regions?.length ? Object.keys(AREAS).filter(a => AREAS[a].some(r => regions.includes(r))) : Object.keys(AREAS));

// ── lettura dei file ─────────────────────────────────────────────────────────
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const cupDate = s => { const m = String(s || '').toUpperCase().match(/^(\d{2})-([A-Z]{3})-(\d{4})/); return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null; };
const num = s => { const n = Number(String(s || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// Il link al file CSV dell'area cambia ogni mese: si legge dalla pagina dell'area.
async function areaUrl(area, fetchImpl) {
  const res = await fetchImpl(`${PORTAL}/dettaglio-opendata-${area}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`OpenCUP ${res.status} sulla pagina ${area}`);
  const html = await res.text();
  const m = html.match(/href="([^"]*OpendataCsv[^"]*\.zip[^"]*)"/i);
  if (!m) throw new Error(`OpenCUP: file CSV dell'area ${area} non trovato`);
  return m[1].startsWith('http') ? m[1] : `https://www.opencup.gov.it${m[1]}`;
}

// Voci di uno zip (directory centrale in fondo al file): nome, posizione, dimensione compressa
function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 65557));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    let i = tail.length - 22;
    while (i >= 0 && tail.readUInt32LE(i) !== 0x06054b50) i--;
    if (i < 0) throw new Error('OpenCUP: zip non valido');
    const count = tail.readUInt16LE(i + 10), cdSize = tail.readUInt32LE(i + 12), cdOff = tail.readUInt32LE(i + 16);
    if (cdOff === 0xffffffff) throw new Error('OpenCUP: zip troppo grande (ZIP64) da leggere');
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    for (let p = 0, k = 0; k < count; k++) {
      const method = cd.readUInt16LE(p + 10), csz = cd.readUInt32LE(p + 20), n = cd.readUInt16LE(p + 28), e = cd.readUInt16LE(p + 30), c = cd.readUInt16LE(p + 32), lo = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + n).toString();
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, lo);
      out.push({ name, method, csz, start: lo + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28) });
      p += 46 + n + e + c;
    }
    return out.filter(x => /\.csv$/i.test(x.name));
  } finally { fs.closeSync(fd); }
}

// Righe tenute da un file zip già scaricato. want = { regions: Set|null, prefixes: [...], minYear }
async function readZip(file, want, { log = () => {} } = {}) {
  const out = new Map();
  let head = null, n = 0;
  for (const en of zipEntries(file)) {
    let rs = fs.createReadStream(file, { start: en.start, end: en.start + en.csz - 1 });
    if (en.method === 8) rs = rs.pipe(zlib.createInflateRaw());
    const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; if (!head) head = parseLine(line.replace(/^﻿/, '')); continue; }
      if (++n % 20000 === 0) await new Promise(r => setImmediate(r));
      // filtro veloce prima di dividere la riga: lavori pubblici attivi
      if (!line.includes('"REALIZZAZIONE DI LAVORI PUBBLICI') || !line.includes('"ATTIVO"')) continue;
      const c = parseLine(line);
      const o = {};
      head.forEach((h, k) => { o[h] = c[k] ?? ''; });
      if (o.CODICE_NATURA_INTERVENTO !== '03' || o.STATO_PROGETTO !== 'ATTIVO') continue;
      if (Number(o.ANNO_DECISIONE) < want.minYear) continue;
      const key = `${o.CODICE_SETTORE_INTERVENTO}.${o.CODICE_SOTTOSETTORE_INTERVENTO}.${o.CODICE_CATEGORIA_INTERVENTO}`;
      if (!want.prefixes.some(p => key.startsWith(p))) continue;
      const region = regionOf(o.REGIONE, '');
      if (want.regions && !want.regions.has(region)) continue;
      if (out.has(o.CUP)) { out.get(o.CUP).places++; continue; } // lo stesso CUP in più comuni: una riga per comune
      out.set(o.CUP, {
        cup: o.CUP, title: clean(o.DESCRIZIONE_INTERVENTO || o.DESCRIZIONE_SINTETICA_CUP).slice(0, 600), year: Number(o.ANNO_DECISIONE) || null,
        cost: num(o.COSTO_PROGETTO), funding: num(o.FINANZIAMENTO_PROGETTO), region,
        // opere su più province o tutta la regione: provincia «-1» e comune «Tutti»
        province: /^[A-Z]{2}$/.test(clean(o.SIGLA_PROVINCIA)) ? clean(o.SIGLA_PROVINCIA) : '', comune: /^(TUTTI|-1)?$/i.test(clean(o.COMUNE)) ? '' : titleCase(o.COMUNE).slice(0, 120),
        // «COMUNE DI VASTO - CH -» → «COMUNE DI VASTO»
        owner: clean(o.SOGGETTO_TITOLARE).replace(/\s+-\s+[^-]{1,40}-\s*$/, '').slice(0, 300), owner_cf: String(o.PIVA_CODFISCALE_SOG_TITOLARE || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16),
        type_key: key, type_label: clean(o.CATEGORIA_INTERVENTO).toLowerCase().slice(0, 200), coverage: titleCase(o.COPERTURA_FINANZIARIA).slice(0, 60),
        program: /^(ALTRO|ASSENTE)$/.test(o.STRUMENTO_PROGRAMMAZIONE) ? '' : titleCase(o.STRUMENTO_PROGRAMMAZIONE).slice(0, 120),
        created_on: cupDate(o.DATA_GENERAZIONE_CUP), oc_link: String(o.LINK_OPENCOESIONE || '').startsWith('http') ? o.LINK_OPENCOESIONE.slice(0, 300) : '', places: 1,
      });
    }
    log(`OpenCUP: ${en.name} letto (${out.size} opere tenute)`);
  }
  return [...out.values()];
}

// Scarica e legge le aree. Ogni file va in una cartella temporanea e si cancella subito dopo.
async function collect({ areas, prefixes, regions, minYear, fetchImpl = fetch, log = () => {}, tmpDir = os.tmpdir(), onArea, stallMs }) {
  const want = { prefixes, regions: regions?.length ? new Set(regions) : null, minYear };
  let total = 0;
  const failed = [];
  for (const area of areas) {
    const file = path.join(tmpDir, `opencup-${area}-${process.pid}.zip`);
    try {
      await download(area, file, { fetchImpl, log, stallMs });
      const rows = await readZip(file, want, { log });
      total += rows.length;
      // ogni area si salva appena letta: se il giro si ferma, le aree già lette restano
      await onArea?.({ area, rows, regions: AREAS[area].filter(r => !want.regions || want.regions.has(r)) });
    } catch (err) { // un'area che non arriva non ferma le altre
      failed.push({ area, message: err.message });
      log(`OpenCUP: area ${area} non caricata (${err.message})`);
    } finally { fs.rm(file, { force: true }, () => {}); }
  }
  return { rows: total, failed };
}

// Scarica il file di un'area. Se per «stallMs» non arriva niente si ferma e riprova (fino a 3 volte): senza, un
// download che si pianta terrebbe fermo il caricamento per sempre.
async function download(area, file, { fetchImpl, log, stallMs = 120000 }) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    let timer = null;
    const poke = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error(`OpenCUP: download dell'area ${area} fermo da ${Math.round(stallMs / 1000)} secondi`)), stallMs); };
    try {
      poke();
      const url = await areaUrl(area, (u, o) => fetchImpl(u, { ...o, signal: ctrl.signal }));
      log(`OpenCUP: scarico l'area ${area}${attempt > 1 ? ` (tentativo ${attempt})` : ''}`);
      const res = await fetchImpl(url, { headers: HEADERS, signal: ctrl.signal });
      if (!res.ok) throw new Error(`OpenCUP ${res.status} sul file dell'area ${area}`);
      const body = typeof res.body?.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
      body.on('data', poke);
      await pipeline(body, fs.createWriteStream(file), { signal: ctrl.signal });
      return;
    } catch (err) {
      const why = ctrl.signal.aborted ? (ctrl.signal.reason?.message || err.message) : err.message;
      if (attempt >= 3) throw new Error(why);
      log(`${why}: riprovo`);
      await new Promise(r => setTimeout(r, Math.min(5000, stallMs) * attempt));
    } finally { clearTimeout(timer); }
  }
}

function collectInWorker(opts) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const { areas, prefixes, regions, minYear, tmpDir, onArea } = opts;
    const w = new Worker(path.join(__dirname, 'crm-cup-worker.js'), { workerData: { areas, prefixes, regions, minYear, tmpDir }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    let saving = Promise.resolve(); // le aree si salvano una dopo l'altra, mentre il thread legge la successiva
    w.on('message', m => {
      if (m.log) opts.log?.(m.log);
      if (m.area) saving = saving.then(() => onArea(m.area));
      if (m.done) saving.then(() => resolve(m.done), reject);
      if (m.error) saving.finally(() => reject(new Error(m.error)));
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`il caricamento OpenCUP si è fermato (codice ${code})`)); });
  });
}

async function save(db, rows, regions) {
  await db.tx(async q => {
    // si rifanno le regioni lette, tenendo i segnali già creati
    // e la data in cui ogni opera è arrivata la prima volta (v16: i segnali si fanno solo dalle nuove)
    const { rows: kept } = await q.query('SELECT cup, signal_id, first_seen FROM crm_cup_works WHERE signal_id IS NOT NULL OR region = ANY($1::text[])', [regions]);
    const signals = new Map(kept.filter(r => r.signal_id).map(r => [r.cup, r.signal_id]));
    const seen = new Map(kept.map(r => [r.cup, r.first_seen]));
    await q.query('DELETE FROM crm_cup_works WHERE region = ANY($1::text[])', [regions]);
    const COLS = ['cup', 'title', 'year', 'cost', 'funding', 'region', 'province', 'comune', 'owner', 'owner_cf', 'type_key', 'type_label', 'coverage', 'program', 'created_on', 'oc_link', 'places', 'signal_id', 'first_seen'];
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    for (let i = 0; i < rows.length; i += 300) {
      const vals = [];
      const sql = rows.slice(i, i + 300).map((r, k) => {
        vals.push(...COLS.map(c => (c === 'signal_id' ? signals.get(r.cup) || null : c === 'first_seen' ? seen.get(r.cup) || today : r[c] ?? null)));
        return `(${COLS.map((_, n) => `$${k * COLS.length + n + 1}`).join(', ')})`;
      });
      await q.query(`INSERT INTO crm_cup_works (${COLS.join(', ')}) VALUES ${sql.join(', ')} ON CONFLICT (cup) DO NOTHING`, vals);
    }
  });
}

// regioni e categorie in uso: profili delle BU, iniziative di Nuovi business, «Categorie in più»
async function usedScope(db, settings) {
  const cats = new Set([...(settings.concorrenza?.extra_categories || [])]);
  const regions = new Set();
  let everywhere = false;
  for (const p of Object.values(settings.profiles || {})) {
    for (const c of p.soa || []) cats.add(c);
    if (p.soa?.length) { if (p.regions?.length) p.regions.forEach(r => regions.add(r)); else everywhere = true; }
  }
  const { rows } = await db.query(`SELECT profile FROM crm_initiatives WHERE jsonb_typeof(profile->'soa') = 'array'`);
  for (const r of rows) {
    const p = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile;
    for (const c of p.soa || []) cats.add(String(c).toUpperCase().replace(/\s+/g, ''));
    if (p.regions?.length) p.regions.forEach(x => regions.add(x)); else everywhere = true;
  }
  return { cats: [...cats], regions: everywhere ? [] : [...regions] };
}

let running = null;
function syncCup(db, { fetchImpl, settings, log = msg => console.log(`[opencup] ${msg}`), tmpDir, stallMs } = {}) {
  if (running) return running;
  running = (async () => {
    try {
      const st = settings || await require('./crm-commerciale').loadSettings(db);
      const scope = await usedScope(db, st);
      const prefixes = typesFor(scope.cats, st);
      if (!prefixes.length) { await db.query('INSERT INTO crm_cup_imports (rows, areas) VALUES (0, \'{}\')'); return { rows: 0 }; }
      const areas = areasFor(scope.regions);
      const saved = [];
      const onArea = async ({ area, rows, regions }) => { await save(db, rows, regions); saved.push(area); log(`OpenCUP: area ${area} salvata (${rows.length} opere)`); };
      const opts = { areas, prefixes, regions: scope.regions, minYear: new Date().getFullYear() - YEARS, tmpDir, onArea, stallMs };
      let out, failure = null;
      try { out = fetchImpl ? await collect({ ...opts, fetchImpl, log }) : await collectInWorker({ ...opts, log }); } catch (err) { failure = err; }
      if (!failure && out.failed?.length) failure = new Error(out.failed.map(f => f.message).join('; '));
      if (failure && !saved.length) throw failure;
      const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM crm_cup_works');
      // giro riuscito anche a metà: le aree salvate contano, l'errore resta scritto per le altre
      await db.query('INSERT INTO crm_cup_imports (rows, areas, error) VALUES ($1, $2, $3)', [n.n, saved, failure ? `aree non caricate: ${areas.filter(a => !saved.includes(a)).join(', ')} (${failure.message})`.slice(0, 500) : '']);
      if (failure) { log(`errore: ${failure.message}`); return { rows: out?.rows || 0, partial: true }; }
      log(`OpenCUP: ${n.n} opere in tutto`);
      return { rows: out.rows };
    } catch (err) {
      await db.query('INSERT INTO crm_cup_imports (rows, error) VALUES (0, $1)', [String(err.message).slice(0, 500)]).catch(() => {});
      log(`errore: ${err.message}`);
      throw err;
    } finally { running = null; }
  })();
  return running;
}
const isRunning = () => Boolean(running);

async function lastImport(db) {
  // conta anche un giro a metà (alcune aree salvate): i dati ci sono
  const { rows: [r] } = await db.query(`SELECT max(at) FILTER (WHERE error = '' OR cardinality(areas) > 0) AS ok, (SELECT error FROM crm_cup_imports ORDER BY at DESC LIMIT 1) AS last_error,
      (SELECT count(*)::int FROM crm_cup_works) AS works FROM crm_cup_imports`);
  return { updated_at: r?.ok ? new Date(r.ok).toISOString() : null, last_error: r?.last_error || '', works: r?.works || 0 };
}

// ── letture ──────────────────────────────────────────────────────────────────
const isoDay = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

// Sezione «Opere finanziate». opts: { types, regions, view: senza|con|tutte, since (anno), province, limit }
async function works(db, { types, regions = [], view = 'senza', since = null, province = '', limit = 10, amountMin = null, amountMax = null }) {
  const empty = { types: [], kpi: { without: 0, with: 0, cost: 0, owners_in_crm: 0 }, rows: [], shown: 0, provinces: [] };
  if (!types.length) return empty;
  const params = [types.map(t => `${t}%`)];
  let where = 'w.type_key LIKE ANY($1::text[])';
  if (regions.length) { params.push(regions); where += ` AND w.region = ANY($${params.length}::text[])`; }
  if (since) { params.push(Number(since)); where += ` AND w.year >= $${params.length}`; }
  if (amountMin) { params.push(Number(amountMin)); where += ` AND w.cost >= $${params.length}`; }   // importi del profilo BU (v16)
  if (amountMax) { params.push(Number(amountMax)); where += ` AND w.cost <= $${params.length}`; }
  const base = where;
  if (province) { params.push(province.toUpperCase()); where += ` AND w.province = $${params.length}`; }
  // Sottoquery non correlate: Postgres le legge una volta sola (tabella hash) invece di rifarle per ognuna delle decine di
  // migliaia di opere (con EXISTS correlati la pagina superava i 40 secondi in produzione, 23/11).
  const awarded = `w.cup IN (SELECT a.cup FROM crm_anac_awards a WHERE a.cup <> '')`;
  const inCrm = `w.owner_cf IN (SELECT upper(s.vat) FROM crm_subjects s WHERE s.merged_into IS NULL AND s.vat <> ''
      UNION SELECT upper(s.tax_code) FROM crm_subjects s WHERE s.merged_into IS NULL AND s.tax_code <> '')`;
  const { rows: [k] } = await db.query(`SELECT count(*) FILTER (WHERE NOT x.aw)::int AS without, count(*) FILTER (WHERE x.aw)::int AS with,
      COALESCE(sum(x.cost), 0)::float AS cost, count(DISTINCT x.owner_cf) FILTER (WHERE x.crm)::int AS owners_in_crm
    FROM (SELECT w.cost, w.owner_cf, ${awarded} AS aw, (w.owner_cf <> '' AND ${inCrm}) AS crm FROM crm_cup_works w WHERE ${where}) x`, params);
  const viewSql = view === 'con' ? ` AND ${awarded}` : view === 'tutte' ? '' : ` AND NOT ${awarded}`;
  const lim = Math.min(Number(limit) || 10, 200);
  // prima la pagina (25 opere), poi azienda del CRM e gara ANAC solo per quelle
  const { rows } = await db.query(`WITH page AS (SELECT w.*, count(*) OVER ()::int AS total FROM crm_cup_works w WHERE ${where}${viewSql}
      ORDER BY w.cost DESC NULLS LAST, w.cup LIMIT ${lim})
    SELECT p.*,
      (SELECT json_build_object('id', s.id, 'name', s.name, 'roles', s.roles) FROM crm_subjects s WHERE s.merged_into IS NULL AND p.owner_cf <> ''
        AND (upper(s.vat) = p.owner_cf OR upper(s.tax_code) = p.owner_cf) ORDER BY s.id LIMIT 1) AS subject,
      (SELECT json_build_object('cig', a.cig, 'winners', a.winners, 'discount', a.discount, 'awarded_on', a.awarded_on, 'amount', a.amount)
        FROM crm_anac_awards a WHERE a.cup <> '' AND a.cup = p.cup ORDER BY a.awarded_on DESC LIMIT 1) AS award
    FROM page p ORDER BY p.cost DESC NULLS LAST, p.cup`, params);
  const { rows: provs } = await db.query(`SELECT DISTINCT w.province FROM crm_cup_works w WHERE ${base} AND w.province <> '' ORDER BY 1`, params.slice(0, province ? -1 : undefined));
  return {
    types, kpi: k, shown: rows[0]?.total || 0, provinces: provs.map(p => p.province),
    rows: rows.map(r => ({
      cup: r.cup, title: r.title, year: r.year, cost: r.cost === null ? null : Number(r.cost), funding: r.funding === null ? null : Number(r.funding),
      region: r.region, province: r.province, comune: r.comune, places: r.places, owner: r.owner, owner_cf: r.owner_cf, subject: r.subject || null,
      type_key: r.type_key, type_label: labelOf(r.type_key) || r.type_label, coverage: r.coverage, program: r.program, created_on: isoDay(r.created_on),
      signal_id: r.signal_id || null, oc_link: r.oc_link,
      award: r.award ? { ...r.award, awarded_on: isoDay(r.award.awarded_on), winners: (typeof r.award.winners === 'string' ? JSON.parse(r.award.winners) : r.award.winners) || [] } : null,
      url: `${PORTAL}/home/progetto/-/cup/${encodeURIComponent(r.cup)}`,
    })),
  };
}

// ── per BU (canvas v16) ──────────────────────────────────────────────────────
const NOT_AWARDED = 'NOT EXISTS (SELECT 1 FROM crm_anac_awards a WHERE a.cup = w.cup)';
// Perimetro di una BU: tipi di lavoro dalle categorie SOA del profilo, regioni e importi del profilo.
function buScope(settings, bu, { allItaly = false } = {}) {
  const p = settings.profiles?.[bu] || {};
  const cats = (p.soa || []).map(c => String(c).toUpperCase().replace(/\s+/g, ''));
  return { bu, cats, types: typesFor(cats, settings), regions: allItaly ? [] : (p.regions || []), amountMin: p.amount_min || null, amountMax: p.amount_max || null };
}

// Una scheda per BU: opere ancora senza gara nel suo perimetro e quanto valgono
async function buCards(db, settings, bus, { since = null } = {}) {
  const out = [];
  for (const bu of bus) {
    const s = buScope(settings, bu);
    if (!s.types.length) { out.push({ bu, cats: s.cats, regions: s.regions, without: 0, cost: 0, no_types: true }); continue; }
    const params = [s.types.map(t => `${t}%`)];
    let where = `w.type_key LIKE ANY($1::text[]) AND ${NOT_AWARDED}`;
    if (s.regions.length) { params.push(s.regions); where += ` AND w.region = ANY($${params.length}::text[])`; }
    if (since) { params.push(Number(since)); where += ` AND w.year >= $${params.length}`; }
    if (s.amountMin) { params.push(Number(s.amountMin)); where += ` AND w.cost >= $${params.length}`; }
    if (s.amountMax) { params.push(Number(s.amountMax)); where += ` AND w.cost <= $${params.length}`; }
    const { rows: [k] } = await db.query(`SELECT count(*)::int AS n, COALESCE(sum(w.cost), 0)::float AS cost FROM crm_cup_works w WHERE ${where}`, params);
    out.push({ bu, cats: s.cats, regions: s.regions, without: k.n, cost: k.cost });
  }
  return out;
}

// Segnali automatici «opera finanziata» (colonna «Finanziata» di Prima del bando) dopo il caricamento del mese:
// opere nuove, ancora senza gara, mai segnalate, nel perimetro della BU; al massimo opere_max per BU, le più grandi prima.
// La prima volta (nessun giro di segnali fatto) solo le opere decise nell'ultimo anno.
async function cupSignals(db, { settings, radar, log = () => {} }) {
  const pb = settings.prima_bando || {};
  if (pb.opere_cup === false || !radar?.addSignal) return 0;
  const max = Number(pb.opere_max) || 5;
  const { rows: [prev] } = await db.query(`SELECT count(*) FILTER (WHERE signals IS NOT NULL)::int AS runs,
      max(at) FILTER (WHERE signals IS NOT NULL) AS last FROM crm_cup_imports`);
  const first = !prev.runs;
  const since = first ? null : new Date(prev.last).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const { rows: users } = await db.query('SELECT id, name, email FROM users');
  const { managerOf } = require('./crm-commerciale');
  const c = { settings, users, managerId: bu => managerOf(settings.profiles[bu], users)?.id || null };
  const taken = new Set();
  let added = 0;
  for (const [bu, b] of Object.entries(settings.radar?.bu || {})) {
    if (!b.on) continue;
    const s = buScope(settings, bu);
    if (!s.types.length) continue;
    const params = [s.types.map(t => `${t}%`)];
    let where = `w.type_key LIKE ANY($1::text[]) AND ${NOT_AWARDED} AND w.signal_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM crm_signals g WHERE g.source = 'opencup' AND g.external_id = w.cup)`;
    if (s.regions.length) { params.push(s.regions); where += ` AND w.region = ANY($${params.length}::text[])`; }
    if (s.amountMin) { params.push(Number(s.amountMin)); where += ` AND w.cost >= $${params.length}`; }
    if (s.amountMax) { params.push(Number(s.amountMax)); where += ` AND w.cost <= $${params.length}`; }
    if (first) { params.push(new Date().getFullYear() - 1); where += ` AND w.year >= $${params.length}`; }
    else { params.push(since); where += ` AND w.first_seen >= $${params.length}::date`; }
    const { rows } = await db.query(`SELECT w.* FROM crm_cup_works w WHERE ${where} ORDER BY w.cost DESC NULLS LAST LIMIT ${max * 4}`, params);
    let n = 0;
    for (const w of rows) {
      if (n >= max) break;
      if (taken.has(w.cup)) continue;
      const owner = String(w.owner || '').replace(/\s+-\s+[^-]{1,40}-\s*$/, '');
      // storia dell'opera (v17): la stessa opera già nel Radar con lo stesso CUP (es. dal programma triennale) → niente
      // doppione: la scheda passa a «Finanziata» se era ancora «Programmata» e prende la nota di OpenCUP
      const { rows: [same] } = await db.query('SELECT id FROM crm_signals WHERE cup = $1 ORDER BY id LIMIT 1', [w.cup]);
      if (same) {
        const note = `Finanziata: CUP ${w.cup}${w.coverage ? `, finanziamento ${w.coverage.toLowerCase()}` : ''} (OpenCUP)`;
        await db.query(`UPDATE crm_signals SET stage = CASE WHEN stage IN ('', 'programmata') THEN 'finanziata' ELSE stage END,
            summary = left(CASE WHEN summary = '' THEN $2 ELSE summary || ' · ' || $2 END, 3000) WHERE id = $1`, [same.id, note]);
        await db.query('UPDATE crm_cup_works SET signal_id = $2 WHERE cup = $1', [w.cup, same.id]);
        taken.add(w.cup);
        continue;
      }
      const sig = await radar.addSignal({ source: 'opencup', external_id: w.cup, kind: 'opera_finanziata', stage: 'finanziata', bu,
        title: String(w.title || '').slice(0, 500), entity: owner, amount: w.cost === null ? null : Number(w.cost), region: w.region, place: w.comune,
        url: `${PORTAL}/home/progetto/-/cup/${encodeURIComponent(w.cup)}`, published_on: w.created_on || null, soa: s.cats,
        summary: [`CUP ${w.cup}`, w.year ? `decisa nel ${w.year}` : '', w.coverage ? `finanziamento ${w.coverage.toLowerCase()}` : '', labelOf(w.type_key) || w.type_label].filter(Boolean).join(' · '),
        why: 'Opera finanziata ancora senza gara (OpenCUP): contatta l\'ente prima che esca il bando.' }, c, null);
      taken.add(w.cup);
      if (sig) { await db.query('UPDATE crm_signals SET cup = $2 WHERE id = $1', [sig.id, w.cup]); await db.query('UPDATE crm_cup_works SET signal_id = $2 WHERE cup = $1', [w.cup, sig.id]); n++; added++; }
    }
    if (n) log(`OpenCUP: ${n} segnali per la BU ${bu}`);
  }
  await db.query('UPDATE crm_cup_imports SET signals = $1 WHERE id = (SELECT max(id) FROM crm_cup_imports)', [added]);
  return added;
}

module.exports = { TYPES, TYPE_LABEL, AREAS, YEARS, typesFor, typesMap, labelOf, areasFor, cupDate, zipEntries, readZip, collect, save, usedScope, syncCup, isRunning, lastImport, works, buScope, buCards, cupSignals };
