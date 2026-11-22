// Programmi triennali dei lavori pubblici (canvas v17 · Le fonti del Radar, via di Dante 22/11/2026).
// Gli enti pubblicano sul Servizio Contratti Pubblici del MIT il programma delle opere dei prossimi 3 anni. Il servizio
// pubblico di consultazione (WSConsultProg) dà l'elenco dei programmi per regione e anno e, per ognuno, gli interventi:
// descrizione, categoria CUP (gli stessi codici di OpenCUP), CUP, importo, comune, priorità, annualità e mese di avvio.
// Ogni settimana si caricano i programmi dell'anno in corso e del successivo per le regioni delle BU; per ogni intervento
// (CUI) vale l'ultima versione pubblicata. Poi gli interventi nel perimetro di ogni BU diventano segnali «Programmata».
const { typesFor, labelOf } = require('./crm-cup');

const API = 'https://www.serviziocontrattipubblici.it/WSConsultProg/rest/Programmi';
const HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; AlmaSpace/1.0)', Accept: 'application/json' };
// codici ISTAT delle regioni (come li vuole il servizio)
const REGIONS = { Piemonte: '001', 'Valle d\'Aosta': '002', Lombardia: '003', 'Trentino-Alto Adige': '004', Veneto: '005', 'Friuli-Venezia Giulia': '006', Liguria: '007',
  'Emilia-Romagna': '008', Toscana: '009', Umbria: '010', Marche: '011', Lazio: '012', Abruzzo: '013', Molise: '014', Campania: '015', Puglia: '016', Basilicata: '017',
  Calabria: '018', Sicilia: '019', Sardegna: '020' };
const BY_CODE = Object.fromEntries(Object.entries(REGIONS).map(([n, c]) => [c, n]));
const STAGES = { 1: 'studio di fattibilità', 2: 'progetto di fattibilità', 3: 'progetto definitivo', 4: 'progetto esecutivo' };

// Nei programmi triennali la categoria ha due livelli (settore.sottosettore, es. 03.16), mentre i tipi di lavoro delle
// categorie SOA arrivano fino al terzo (es. 03.16.065). Un tipo a tre livelli vale anche per il suo sottosettore, tranne
// nel gruppo generico «05.99» (altre infrastrutture sociali: cimiteri, arredo urbano, verde, illuminazione…), dove serve
// anche la parola giusta nel titolo.
const KEYWORDS = { '05.99.193': 'illumin', '05.99.192': 'verde', '05.99.191': 'arredo', '05.99.096': 'cimiter' };
function typeMatchSql(types, params, col = 'i.type_key', titleCol = 'i.title') {
  const parts = [];
  for (const t of types) {
    params.push(`${t}%`);
    let cond = `${col} LIKE $${params.length}`;
    const lv = t.split('.');
    if (lv.length >= 3) {
      params.push(lv.slice(0, 2).join('.'));
      const two = `$${params.length}`;
      const kw = KEYWORDS[t] || (lv[0] === '05' && lv[1] === '99' ? null : '');
      if (kw === '') cond += ` OR ${col} = ${two}`;
      else if (kw) { params.push(`%${kw}%`); cond += ` OR (${col} = ${two} AND ${titleCol} ILIKE $${params.length})`; }
    }
    parts.push(`(${cond})`);
  }
  return parts.length ? `(${parts.join(' OR ')})` : 'false';
}

const dmy = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

async function post(path, body, fetchImpl) {
  const res = await fetchImpl(`${API}/${path}`, { method: 'POST', headers: HEADERS, body: typeof body === 'string' ? body : JSON.stringify(body) });
  if (!res.ok) throw new Error(`Programmi triennali ${res.status} su ${path}`);
  return res.json();
}

// programmi di lavori pubblicati in una regione per un anno: [{ id, name, short_description }]
async function listProgrammes(region, year, { fetchImpl = fetch } = {}) {
  const out = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const j = await post('Lista', { limit: 500, offset, regioneSA: REGIONS[region], tipoProg: '1', anno: String(year) }, fetchImpl);
    out.push(...(j.data || []));
    if (!j.data || j.data.length < 500 || out.length >= (j.total || 0)) break;
  }
  return out;
}

// il programma completo con gli interventi (l'endpoint si chiama «Xml» ma risponde in JSON)
async function programme(id, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/Xml?id=${encodeURIComponent(id)}`, { headers: { 'User-Agent': HEADERS['User-Agent'], Accept: 'application/json' } }); // GET: senza Content-Type (altrimenti 415)
  if (!res.ok) throw new Error(`Programmi triennali ${res.status} sul programma ${id}`);
  return res.json();
}

// interventi di un programma → righe da salvare
function rowsOf(p) {
  const year = Number(p.anno) || null;
  const published = dmy(p.dataPubblicazioneApprovazione) || dmy(p.dataPubblicazioneAdozione);
  return (p.interventi || []).filter(i => i.cui).map(i => {
    const annualita = Number(i.anno) || null;
    const nuts = String(i.nuts || '');
    const regCode = String(i.istat || '').slice(0, 3);
    return {
      cui: String(i.cui).slice(0, 40), prog_id: Number(p.contri) || 0, prog_year: year || 0, sa_cf: String(p.codiceFiscaleSA || '').toUpperCase().slice(0, 16),
      sa_name: '', title: clean(i.descrizione).slice(0, 600), annualita, year: year && annualita ? year + annualita - 1 : year,
      month: Number(i.meseAvvioProcedura) >= 1 && Number(i.meseAvvioProcedura) <= 12 ? Number(i.meseAvvioProcedura) : null,
      cup: String(i.cup || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15), istat: String(i.istat || '').slice(0, 9), nuts: nuts.slice(0, 5),
      region: BY_CODE[regCode] || '', type_key: String(i.categoria || '').slice(0, 12), priority: Number(i.priorita) || null,
      design_stage: STAGES[Number(i.statoProgettazione)] || '', amount: Number(i.importoTotale) > 0 ? Number(i.importoTotale) : null,
      published_on: published, act_url: String(p.urlAttoApprovazione || p.urlAttoAdozione || '').slice(0, 400),
    };
  });
}

// regioni in uso: quelle dei profili delle BU (una BU senza regioni = tutta Italia)
function usedRegions(settings) {
  const set = new Set();
  for (const p of Object.values(settings.profiles || {})) {
    if (!(p.soa || []).length) continue;
    if (!p.regions?.length) return Object.keys(REGIONS);
    p.regions.forEach(r => { if (REGIONS[r]) set.add(r); });
  }
  return [...set];
}

async function save(db, rows, regions) {
  await db.tx(async q => {
    // si tengono la data di arrivo e il segnale già creato; si rifanno le regioni lette
    const { rows: kept } = await q.query('SELECT cui, signal_id, first_seen FROM crm_prog_interventi WHERE region = ANY($1::text[]) OR signal_id IS NOT NULL', [regions]);
    const old = new Map(kept.map(r => [r.cui, r]));
    await q.query('DELETE FROM crm_prog_interventi WHERE region = ANY($1::text[])', [regions]);
    const COLS = ['cui', 'prog_id', 'prog_year', 'sa_cf', 'sa_name', 'title', 'annualita', 'year', 'month', 'cup', 'istat', 'nuts', 'region', 'type_key', 'priority', 'design_stage', 'amount', 'published_on', 'act_url', 'first_seen', 'signal_id'];
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    for (let i = 0; i < rows.length; i += 250) {
      const vals = [];
      const sql = rows.slice(i, i + 250).map((r, k) => {
        const o = old.get(r.cui);
        vals.push(...COLS.map(c => (c === 'first_seen' ? o?.first_seen || today : c === 'signal_id' ? o?.signal_id || null : r[c] ?? null)));
        return `(${COLS.map((_, n) => `$${k * COLS.length + n + 1}`).join(', ')})`;
      });
      await q.query(`INSERT INTO crm_prog_interventi (${COLS.join(', ')}) VALUES ${sql.join(', ')} ON CONFLICT (cui) DO NOTHING`, vals);
    }
  });
}

// Giri successivi: si aggiungono o aggiornano gli interventi dei programmi nuovi (vince la versione più recente),
// tenendo data di arrivo e segnale; via quelli con la gara prevista in anni già passati.
async function upsert(db, rows, region, year) {
  await db.tx(async q => {
    const COLS = ['cui', 'prog_id', 'prog_year', 'sa_cf', 'sa_name', 'title', 'annualita', 'year', 'month', 'cup', 'istat', 'nuts', 'region', 'type_key', 'priority', 'design_stage', 'amount', 'published_on', 'act_url'];
    for (let i = 0; i < rows.length; i += 250) {
      const vals = [];
      const sql = rows.slice(i, i + 250).map((r, k) => { vals.push(...COLS.map(c => r[c] ?? null)); return `(${COLS.map((_, n) => `$${k * COLS.length + n + 1}`).join(', ')})`; });
      await q.query(`INSERT INTO crm_prog_interventi (${COLS.join(', ')}) VALUES ${sql.join(', ')}
        ON CONFLICT (cui) DO UPDATE SET ${COLS.filter(c => c !== 'cui').map(c => `${c} = EXCLUDED.${c}`).join(', ')}
        WHERE EXCLUDED.prog_id >= crm_prog_interventi.prog_id`, vals);
    }
    await q.query('DELETE FROM crm_prog_interventi WHERE region = $1 AND year < $2', [region, year]);
  });
}

let running = null;
// Carica le regioni in uso (anno in corso e successivo). Una regione che non risponde non ferma le altre.
function syncTriennali(db, { fetchImpl = fetch, settings, log = msg => console.log(`[triennali] ${msg}`), pause = 120 } = {}) {
  if (running) return running;
  running = (async () => {
    const st = settings || await require('./crm-commerciale').loadSettings(db);
    const regions = usedRegions(st);
    const y = new Date().getFullYear();
    let programmes = 0, total = 0;
    const done = [], failed = [];
    try {
      for (const region of regions) {
        try {
          const all = [...await listProgrammes(region, y, { fetchImpl }), ...await listProgrammes(region, y + 1, { fetchImpl })];
          // dalla seconda volta solo i programmi nuovi o aggiornati: il servizio li numera in ordine crescente
          const { rows: [seen] } = await db.query('SELECT max(prog_id)::int AS id FROM crm_prog_interventi WHERE region = $1', [region]);
          const incremental = Boolean(seen?.id);
          const list = incremental ? all.filter(p => Number(p.id) > seen.id) : all;
          // per ogni intervento vale l'ultima versione: si leggono i programmi dal più vecchio al più nuovo
          const byCui = new Map();
          let skipped = 0;
          for (const p of list.sort((a, b) => Number(a.id) - Number(b.id))) {
            // un programma che non risponde si salta: non ferma la regione
            let full;
            try { full = await programme(p.id, { fetchImpl }); } catch { skipped++; continue; }
            for (const r of rowsOf(full)) byCui.set(r.cui, { ...r, sa_name: clean(p.name).slice(0, 300), region: r.region || region });
            programmes++;
            if (pause) await new Promise(res => setTimeout(res, pause));
          }
          if (skipped) log(`${region}: ${skipped} programmi non letti`);
          if (list.length && skipped === list.length) throw new Error('nessun programma letto');
          const rows = [...byCui.values()].filter(r => r.region === region);
          if (incremental) await upsert(db, rows, region, y); else await save(db, rows, [region]);
          total += rows.length;
          done.push(region);
          log(`${region}: ${list.length} programmi ${incremental ? 'nuovi' : 'letti'}, ${rows.length} interventi`);
        } catch (err) { failed.push(`${region} (${err.message})`); log(`${region} non caricata: ${err.message}`); }
      }
      if (!done.length && failed.length) throw new Error(failed.join('; '));
      await db.query('INSERT INTO crm_prog_imports (programmes, rows, regions, error) VALUES ($1, $2, $3, $4)', [programmes, total, done, failed.length ? `non caricate: ${failed.join('; ')}`.slice(0, 500) : '']);
      return { programmes, rows: total, failed };
    } catch (err) {
      await db.query('INSERT INTO crm_prog_imports (error) VALUES ($1)', [String(err.message).slice(0, 500)]).catch(() => {});
      throw err;
    } finally { running = null; }
  })();
  return running;
}
const isRunning = () => Boolean(running);

async function lastImport(db) {
  const { rows: [r] } = await db.query(`SELECT max(at) FILTER (WHERE cardinality(regions) > 0) AS ok, (SELECT error FROM crm_prog_imports ORDER BY id DESC LIMIT 1) AS last_error,
      (SELECT count(*)::int FROM crm_prog_interventi) AS rows FROM crm_prog_imports`);
  return { updated_at: r?.ok ? new Date(r.ok).toISOString() : null, last_error: r?.last_error || '', rows: r?.rows || 0 };
}

// Interventi → segnali «Programmata» (gara prevista quest'anno o il prossimo), per BU: categoria CUP dei tipi di lavoro
// delle sue categorie SOA, zone e importi del profilo; prima annualità e priorità più alte; al massimo «triennali_max»
// per BU. Se un'opera con lo stesso CUP è già nel Radar (es. da OpenCUP) non si fa un doppione: quella scheda prende
// la data prevista e la nota del programma triennale («storia dell'opera»).
async function progSignals(db, { settings, radar, log = () => {} }) {
  const pb = settings.prima_bando || {};
  if (pb.triennali === false || !radar?.addSignal) return 0;
  const max = Number(pb.triennali_max) || 5;
  const y = new Date().getFullYear();
  const { rows: users } = await db.query('SELECT id, name, email FROM users');
  const { managerOf } = require('./crm-commerciale');
  const c = { settings, users, managerId: bu => managerOf(settings.profiles[bu], users)?.id || null };
  const taken = new Set();
  let added = 0, merged = 0;
  for (const [bu, b] of Object.entries(settings.radar?.bu || {})) {
    if (!b.on) continue;
    const p = settings.profiles?.[bu] || {};
    const cats = (p.soa || []).map(x => String(x).toUpperCase().replace(/\s+/g, ''));
    const types = typesFor(cats, settings);
    if (!types.length) continue;
    const params = [y];
    let where = `${typeMatchSql(types, params)} AND i.signal_id IS NULL AND i.year BETWEEN $1 AND $1 + 1
      AND NOT EXISTS (SELECT 1 FROM crm_signals g WHERE g.source = 'triennali' AND g.external_id = i.cui)`;
    if (p.regions?.length) { params.push(p.regions); where += ` AND i.region = ANY($${params.length}::text[])`; }
    if (p.amount_min) { params.push(Number(p.amount_min)); where += ` AND i.amount >= $${params.length}`; }
    if (p.amount_max) { params.push(Number(p.amount_max)); where += ` AND i.amount <= $${params.length}`; }
    const { rows } = await db.query(`SELECT i.* FROM crm_prog_interventi i WHERE ${where}
      ORDER BY i.year, i.priority NULLS LAST, i.amount DESC NULLS LAST LIMIT ${max * 4}`, params);
    let n = 0;
    for (const i of rows) {
      if (n >= max) break;
      if (taken.has(i.cui)) continue;
      taken.add(i.cui);
      const when = i.year ? `${i.year}-${String(i.month || 6).padStart(2, '0')}-${i.month ? '01' : '30'}` : null;
      const note = `Nel programma triennale ${i.prog_year}/${i.prog_year + 2} di ${i.sa_name}: gara prevista ${i.month ? `${String(i.month).padStart(2, '0')}/` : 'nel '}${i.year}${i.priority ? `, priorità ${i.priority}` : ''}${i.design_stage ? `, ${i.design_stage}` : ''} (CUI ${i.cui})`;
      // storia dell'opera: stesso CUP già nel Radar → niente doppione
      if (i.cup) {
        const { rows: [same] } = await db.query(`SELECT id, expected_on, summary FROM crm_signals WHERE cup = $1 ORDER BY id LIMIT 1`, [i.cup]);
        if (same) {
          await db.query(`UPDATE crm_signals SET expected_on = COALESCE(expected_on, $2::date), summary = left(CASE WHEN summary = '' THEN $3 ELSE summary || ' · ' || $3 END, 3000) WHERE id = $1`, [same.id, when, note]);
          await db.query('UPDATE crm_prog_interventi SET signal_id = $2 WHERE cui = $1', [i.cui, same.id]);
          merged++;
          continue;
        }
      }
      const sig = await radar.addSignal({ source: 'triennali', external_id: i.cui, kind: 'programma', stage: 'programmata', bu,
        title: i.title.slice(0, 500), entity: i.sa_name, amount: i.amount === null ? null : Number(i.amount), region: i.region, place: '',
        url: i.act_url || 'https://www.serviziocontrattipubblici.it/it/consultazione/programmazione-triennale-lavori-beni-e-servizi/', expected_on: when, soa: cats,
        summary: [note, labelOf(i.type_key)].filter(Boolean).join(' · '), why: 'Opera nel programma triennale dell\'ente: la gara è in calendario, è il momento di farsi conoscere.' }, c, null);
      if (sig) {
        if (i.cup) await db.query('UPDATE crm_signals SET cup = $2 WHERE id = $1', [sig.id, i.cup]);
        await db.query('UPDATE crm_prog_interventi SET signal_id = $2 WHERE cui = $1', [i.cui, sig.id]);
        n++; added++;
      }
    }
    if (n) log(`${n} segnali per la BU ${bu}`);
  }
  await db.query('UPDATE crm_prog_imports SET signals = $1 WHERE id = (SELECT max(id) FROM crm_prog_imports)', [added]);
  if (merged) log(`${merged} interventi uniti a opere già nel Radar (stesso CUP)`);
  return added;
}

module.exports = { REGIONS, typeMatchSql, rowsOf, listProgrammes, programme, usedRegions, save, syncTriennali, isRunning, lastImport, progSignals };
