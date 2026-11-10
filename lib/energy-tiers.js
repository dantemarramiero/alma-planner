// Alma Energy: parametri dei tier regolabili dal software (ALM2-22).
// - Screening dei tetti (PPA on-site): gli stessi parametri del foglio «Ipotesi» del file dello screening. Punteggio =
//   punti taglia (scala logaritmica fra due superfici) + punti del profilo di consumo; A e B sopra le soglie, sotto C.
// - Database Conto Energia (revamping): la priorità A–D del file, oppure le regole di Alma Energy con pesi e soglie
//   (incassi persi, calo, andamento, tipo di proprietario, segnali).
// Applicare i parametri ricalcola le priorità senza toccare stadi, note e responsabili.
const { HttpError } = require('./http');
const { getSettings, saveSetting } = require('./settings');

const PROFILES = ['D1', 'D2', 'D3', 'D4', 'ND', 'X'];
const OWNER_KEY_SQL = "(CASE WHEN owner_vat <> '' THEN owner_vat ELSE 'nome:' || lower(owner_name) END)";

// Valori del file «Screening_FV_tetti_Abruzzo.xlsx»: con questi i punteggi tornano uguali a quelli del file.
const SCREENING_DEFAULTS = {
  usableShare: 0.6, kwpPerM2: 0.2, areaMin: 2000, areaMax: 20000, sizePoints: 50,
  profilePoints: { D1: 50, D2: 35, D3: 20, D4: 0, ND: 15, X: 0 },
  thresholdA: 70, thresholdB: 50, energyPrice: 100, epcPerKwp: 750,
};

// Regole di Alma Energy per il Database CE: proposta di partenza, da tarare.
const CE_DEFAULTS = {
  mode: 'file', // 'file' = priorità del file, 'regole' = regole qui sotto
  minDrop: 0.15, // sotto questo calo la convenzione è D (non perde)
  dropMax: 0.5, dropPoints: 30, // calo fra minDrop e dropMax: da 0 a dropPoints, in proporzione
  lostMin: 10000, lostMax: 200000, lostPoints: 30, // incassi persi €/anno: scala logaritmica
  trendPoints: { Progressivo: 15, Improvviso: 10, 'Solo nel 2025': 5, Irregolare: 5, Rientrato: 0, Stabile: 0 },
  ownerPoints: { Agricola: 15, Immobiliare: 15, Cooperativa: 10, Industriale: 10, Energetica: 0, 'Grande operatore': 0 },
  signalPoints: {
    sottoperformance: 10, in_liquidazione: 15, erogazioni_azzerate: 10, non_strategico: 10, acquisto_blocco: 0,
    cambio_proprieta: 0, piu_beneficiari: 0, operatore_strutturato: -5, acquistato_di_recente: -10,
  },
  thresholdA: 65, thresholdB: 45, thresholdC: 25,
};

const clamp01 = x => Math.min(1, Math.max(0, x));
const round = (x, d = 2) => (x === null || x === undefined ? x : Math.round(x * 10 ** d) / 10 ** d);

// ── controllo dei valori ─────────────────────────────────────────────────────
function numberIn(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label}: serve un numero fra ${min} e ${max}`);
  return n;
}
function pointsMap(value, defaults, label) {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = numberIn(value?.[k], `${label} «${k}»`, -100, 100, defaults[k]);
  return out;
}

function cleanScreening(p = {}, base = SCREENING_DEFAULTS) {
  const out = {
    usableShare: numberIn(p.usableShare, 'Quota utilizzabile', 0.05, 1, base.usableShare),
    kwpPerM2: numberIn(p.kwpPerM2, 'kWp per m²', 0.05, 0.5, base.kwpPerM2),
    areaMin: numberIn(p.areaMin, 'Superficie a 0 punti', 100, 1e6, base.areaMin),
    areaMax: numberIn(p.areaMax, 'Superficie al massimo', 100, 1e7, base.areaMax),
    sizePoints: numberIn(p.sizePoints, 'Punti massimi della taglia', 0, 100, base.sizePoints),
    profilePoints: pointsMap(p.profilePoints, base.profilePoints, 'Punti del profilo'),
    thresholdA: numberIn(p.thresholdA, 'Soglia A', 0, 200, base.thresholdA),
    thresholdB: numberIn(p.thresholdB, 'Soglia B', 0, 200, base.thresholdB),
    energyPrice: numberIn(p.energyPrice, 'Prezzo dell\'energia', 0, 1000, base.energyPrice),
    epcPerKwp: numberIn(p.epcPerKwp, 'Costo EPC', 0, 5000, base.epcPerKwp),
  };
  if (out.areaMax <= out.areaMin) throw new HttpError(400, 'La superficie del massimo deve essere più grande di quella a 0 punti');
  if (out.thresholdB > out.thresholdA) throw new HttpError(400, 'La soglia B non può superare la soglia A');
  return out;
}

function cleanCe(p = {}, base = CE_DEFAULTS) {
  const mode = p.mode === undefined ? base.mode : p.mode;
  if (!['file', 'regole'].includes(mode)) throw new HttpError(400, 'Scegli se usare le priorità del file o le regole di Alma Energy');
  const out = {
    mode,
    minDrop: numberIn(p.minDrop, 'Calo minimo', 0, 1, base.minDrop),
    dropMax: numberIn(p.dropMax, 'Calo al massimo dei punti', 0.01, 1, base.dropMax),
    dropPoints: numberIn(p.dropPoints, 'Punti del calo', 0, 100, base.dropPoints),
    lostMin: numberIn(p.lostMin, 'Incassi persi a 0 punti', 0, 1e8, base.lostMin),
    lostMax: numberIn(p.lostMax, 'Incassi persi al massimo', 1, 1e9, base.lostMax),
    lostPoints: numberIn(p.lostPoints, 'Punti degli incassi persi', 0, 100, base.lostPoints),
    trendPoints: pointsMap(p.trendPoints, base.trendPoints, 'Punti dell\'andamento'),
    ownerPoints: pointsMap(p.ownerPoints, base.ownerPoints, 'Punti del tipo di proprietario'),
    signalPoints: pointsMap(p.signalPoints, base.signalPoints, 'Punti del segnale'),
    thresholdA: numberIn(p.thresholdA, 'Soglia A', 0, 300, base.thresholdA),
    thresholdB: numberIn(p.thresholdB, 'Soglia B', 0, 300, base.thresholdB),
    thresholdC: numberIn(p.thresholdC, 'Soglia C', 0, 300, base.thresholdC),
  };
  if (out.dropMax <= out.minDrop) throw new HttpError(400, 'Il calo del massimo deve essere più grande del calo minimo');
  if (out.lostMax <= Math.max(1, out.lostMin)) throw new HttpError(400, 'Gli incassi persi del massimo devono essere più grandi di quelli a 0 punti');
  if (!(out.thresholdA >= out.thresholdB && out.thresholdB >= out.thresholdC)) throw new HttpError(400, 'Le soglie vanno in ordine: A ≥ B ≥ C');
  return out;
}

// ── punteggi ─────────────────────────────────────────────────────────────────
// Un tetto: dai dati dello screening (superficie, profilo, kWh/kWp) a punteggio, priorità e numeri dell'impianto.
function scoreRoof(d, p) {
  const area = Number(d?.superficie);
  if (!Number.isFinite(area) || area <= 0) return null;
  const profile = PROFILES.includes(d.profilo) ? d.profilo : 'ND';
  const size = p.sizePoints * clamp01(Math.log(area / p.areaMin) / Math.log(p.areaMax / p.areaMin));
  const prof = p.profilePoints[profile] ?? 0;
  const score = size + prof;
  // X = escluso (centrali, stazioni elettriche): resta C qualunque sia il punteggio, come nel file
  const priority = profile !== 'X' && score >= p.thresholdA ? 'A' : profile !== 'X' && score >= p.thresholdB ? 'B' : 'C';
  const kwp = area * p.usableShare * p.kwpPerM2;
  const kwhKwp = Number(d.kwh_kwp) || null;
  const mwh = kwhKwp ? (kwp * kwhKwp) / 1000 : null;
  return {
    priority, mw: kwp / 1000, capex: Math.round(kwp * p.epcPerKwp),
    data: {
      punteggio: round(score), punti_taglia: round(size), punti_profilo: prof, kwp: round(kwp),
      mwh: round(mwh), ricavi_k: mwh === null ? null : round((mwh * p.energyPrice) / 1000),
    },
  };
}

// Una convenzione GSE: punteggio e priorità con le regole. Senza calo né incassi persi: «Dati insufficienti».
function scoreConvention(c, p) {
  const variation = c.variation === null || c.variation === undefined ? null : Number(c.variation);
  const lost = c.lost_per_year === null || c.lost_per_year === undefined ? null : Number(c.lost_per_year);
  if (variation === null && lost === null) return { score: null, priority: 'Dati insufficienti' };
  const drop = variation === null ? 0 : -variation;
  if (drop < p.minDrop) return { score: 0, priority: 'D' };
  let score = p.dropPoints * clamp01((drop - p.minDrop) / (p.dropMax - p.minDrop));
  const lostMin = Math.max(p.lostMin, 1);
  if (lost > 0) score += p.lostPoints * clamp01(Math.log(Math.max(lost, 1) / lostMin) / Math.log(p.lostMax / lostMin));
  // «Improvviso (2024)» → «Improvviso»
  const trend = String(c.trend || '').replace(/\s*\(\d{4}\)$/, '');
  score += p.trendPoints[trend] ?? 0;
  score += p.ownerPoints[c.owner_type] ?? 0;
  for (const s of c.signals || []) score += p.signalPoints[s] ?? 0;
  score = round(score);
  const priority = score >= p.thresholdA ? 'A' : score >= p.thresholdB ? 'B' : score >= p.thresholdC ? 'C' : 'D';
  return { score, priority };
}

// Priorità in uso di una convenzione: quella del file o quella delle regole.
const ceEffective = (c, p) => (p.mode === 'regole' ? scoreConvention(c, p) : { score: null, priority: c.priority_file || c.priority });

// ── lettura e salvataggio ───────────────────────────────────────────────────
async function getParams(db) {
  const rows = await getSettings(db, 'energy', ['screening', 'database_ce']);
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  return {
    screening: cleanScreening(by.screening?.value || {}),
    database_ce: cleanCe(by.database_ce?.value || {}),
    updated: Object.fromEntries(rows.map(r => [r.key, { at: r.updated_at, by: r.updated_by_name }])),
  };
}

async function saveParams(q, key, value, summary, userId) {
  await saveSetting(q, `energy.${key}`, value, userId);
  await q.query('INSERT INTO energy_settings_log (key, value, summary, user_id) VALUES ($1, $2, $3, $4)', [key, JSON.stringify(value), JSON.stringify(summary), userId]);
}

const countBy = list => list.reduce((acc, x) => { acc[x || '—'] = (acc[x || '—'] || 0) + 1; return acc; }, {});

// ── screening dei tetti ─────────────────────────────────────────────────────
// Tetti dello screening già in Alma Energy (quelli con la superficie).
async function roofRows(q) {
  const { rows } = await q.query(
    "SELECT id, priority, data FROM energy_opportunities WHERE kind = 'ppa_onsite' AND data->>'fonte' = 'Screening tetti' AND (data->>'superficie') IS NOT NULL");
  return rows;
}

async function previewScreening(db, params) {
  const p = cleanScreening(params);
  const rows = await roofRows(db);
  const after = rows.map(r => scoreRoof(r.data, p)?.priority ?? r.priority);
  return {
    total: rows.length, before: countBy(rows.map(r => r.priority)), after: countBy(after),
    changed: rows.filter((r, i) => r.priority !== after[i]).length,
  };
}

async function applyScreening(db, params, userId) {
  const p = cleanScreening(params);
  return db.tx(async q => {
    const rows = await roofRows(q);
    const updates = [];
    let changed = 0;
    for (const r of rows) {
      const s = scoreRoof(r.data, p);
      if (!s) continue;
      if (s.priority !== r.priority) changed++;
      updates.push({ id: r.id, priority: s.priority, mw: s.mw, capex: s.capex, data: s.data });
    }
    // rank come nel file: 1 al punteggio più alto, a pari punteggio lo stesso numero
    const scores = [...new Set(updates.map(u => u.data.punteggio))].sort((a, b) => b - a);
    const rankOf = new Map(scores.map((s, i) => [s, i + 1]));
    for (const u of updates) u.data.rank = rankOf.get(u.data.punteggio);
    for (let i = 0; i < updates.length; i += 1000) {
      await q.query(
        `UPDATE energy_opportunities o SET priority = x.priority, mw = x.mw, capex = x.capex, data = o.data || x.data, updated_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS x(id int, priority text, mw float8, capex numeric, data jsonb) WHERE o.id = x.id`,
        [JSON.stringify(updates.slice(i, i + 1000))]);
    }
    const summary = { total: updates.length, changed, after: countBy(updates.map(u => u.priority)) };
    await saveParams(q, 'screening', p, summary, userId);
    return summary;
  });
}

// Punteggio di una sola opportunità (quando cambia il profilo di consumo dalla scheda).
async function rescoreRoof(db, id) {
  const p = (await getParams(db)).screening;
  const { rows: [o] } = await db.query('SELECT data FROM energy_opportunities WHERE id = $1', [id]);
  const s = o && scoreRoof(o.data, p);
  if (!s) return;
  await db.query('UPDATE energy_opportunities SET priority = $2, mw = $3, capex = $4, data = data || $5::jsonb, updated_at = now() WHERE id = $1',
    [id, s.priority, s.mw, s.capex, JSON.stringify(s.data)]);
}

// ── Database Conto Energia ──────────────────────────────────────────────────
async function conventionRows(q) {
  const { rows } = await q.query(
    `SELECT convention, priority, priority_file, variation, lost_per_year, trend, owner_type, signals, opportunity_id, ${OWNER_KEY_SQL} AS owner_key
       FROM energy_conventions`);
  return rows;
}

// Proprietari con almeno una convenzione A o B e nessuna in pipeline.
function ownersOut(rows, priorities) {
  const inPipeline = new Set(rows.filter(c => c.opportunity_id).map(c => c.owner_key));
  return [...new Set(rows.filter((c, i) => ['A', 'B'].includes(priorities[i]) && !inPipeline.has(c.owner_key)).map(c => c.owner_key))];
}

async function previewCe(db, params) {
  const p = cleanCe(params);
  const rows = await conventionRows(db);
  const after = rows.map(c => ceEffective(c, p).priority);
  return {
    total: rows.length, before: countBy(rows.map(c => c.priority)), after: countBy(after),
    changed: rows.filter((c, i) => c.priority !== after[i]).length,
    ownersToPipeline: ownersOut(rows, after).length,
  };
}

// Applica le regole (o torna alle priorità del file) e aggiorna le opportunità del revamping; i proprietari diventati
// A o B si portano in pipeline solo se richiesto (toPipeline).
async function applyCe(db, params, userId, { toPipeline = false } = {}) {
  const p = cleanCe(params);
  const { refreshRevamping, ownersToPipeline } = require('./energy-import'); // energy-import usa questo modulo
  return db.tx(async q => {
    const rows = await conventionRows(q);
    const scored = rows.map(c => ceEffective(c, p));
    for (let i = 0; i < rows.length; i += 1000) {
      await q.query(
        `UPDATE energy_conventions c SET priority = x.priority, score = x.score
           FROM jsonb_to_recordset($1::jsonb) AS x(convention text, priority text, score float8) WHERE c.convention = x.convention`,
        [JSON.stringify(rows.slice(i, i + 1000).map((c, j) => ({ convention: c.convention, ...scored[i + j] })))]);
    }
    const { rows: opps } = await q.query('SELECT DISTINCT opportunity_id AS id FROM energy_conventions WHERE opportunity_id IS NOT NULL');
    await refreshRevamping(q, opps.map(o => o.id));
    const after = scored.map(s => s.priority);
    const waiting = ownersOut(rows, after);
    const moved = toPipeline ? await ownersToPipeline(q, waiting, userId) : { opportunities: 0, companiesCreated: 0 };
    const summary = {
      total: rows.length, changed: rows.filter((c, i) => c.priority !== after[i]).length, after: countBy(after),
      ownersWaiting: toPipeline ? 0 : waiting.length, ...moved,
    };
    await saveParams(q, 'database_ce', p, summary, userId);
    return summary;
  });
}

module.exports = {
  SCREENING_DEFAULTS, CE_DEFAULTS, PROFILES, OWNER_KEY_SQL, cleanScreening, cleanCe, scoreRoof, scoreConvention, ceEffective,
  getParams, previewScreening, applyScreening, rescoreRoof, previewCe, applyCe,
};
