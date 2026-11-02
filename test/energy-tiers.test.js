// Alma Energy: parametri dei tier regolabili (ALM2-22). Punteggio dei tetti uguale al file dello screening con i
// valori predefiniti, regole del Database CE, anteprima e applicazione con ricalcolo delle priorità.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { writeXlsx, readXlsx } = require('../lib/xlsx');
const { scoreRoof, scoreConvention, SCREENING_DEFAULTS, CE_DEFAULTS, cleanCe } = require('../lib/energy-tiers');

const SCREENING_HEAD = ['Rank', 'Priorità', 'Punteggio', 'Punti taglia', 'Punti profilo', 'Profilo consumi', 'Azienda', 'Attività', 'Giorni/sett', 'Turni',
  'Motivazione profilo', 'Confidenza', 'Provincia', 'Comune', 'Area produttiva', 'Superficie tetto (m²)', 'kWp stimati', 'kWh/kWp anno', 'MWh/anno',
  'Capex indicativo (k€)', 'Ricavi lordi (k€/anno)', 'FV già mappato OSM', 'Fonte', 'Vista satellite', 'Lat', 'Lon', 'ID OSM'];
const roof = (prio, profilo, azienda, mq, osm) => [1, prio, 0, 0, 0, profilo, azienda, '', 5, '', '', 'alta', 'Chieti', 'Chieti', '', mq, 0, 1300, 0, 0, 0, 'No', 'OSM', 'Apri', 42.3, 14.1, osm];
const screening = rows => writeXlsx({ Ipotesi: [['Screening tetti']], Edifici: [SCREENING_HEAD, ...rows] });

const CE_HEAD = ['N.', 'Priorità', 'Convenzione GSE', 'Proprietario', 'P.IVA', 'Provincia (sede)', 'Regione (sede)', 'Tipo di proprietario', 'Classe di incasso',
  ...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(y => `Incasso ${y} €`), 'Incasso medio 2016-2019 €', 'Incasso medio 2023-2025 €',
  'Variazione', 'Incassi persi €/anno', 'Andamento', 'Note', 'Note', 'Ultimo cambio proprietà', 'Proprietario precedente'];
const conv = (n, prio, id, owner, vat, { type = 'Industriale', variation = -0.3, lost = 50000, trend = 'Progressivo', note = '' } = {}) => [n, prio, id, owner, vat, 'Chieti', 'Abruzzo', type,
  '60.000-400.000 €', 100, 100, 100, 100, 90, 80, 70, 60, 60, 60, 100, 60, variation, lost, trend, note, null, null, null];
const database = rows => writeXlsx({ Impianti: [['IMPIANTI in Conto Energia'], CE_HEAD, ...rows] });

let server, base, db, cookie;
async function api(method, url, body, { raw = false } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=dante.marramiero@almacis.it`, { redirect: 'manual' });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  server?.close();
  await db?.close();
});

test('tetti: con i valori predefiniti il punteggio è quello del file dello screening', () => {
  // riga 801 del file vero: 3.814 m², profilo D3 → 14,02 + 20 = 34,02, priorità C
  const s = scoreRoof({ superficie: 3814, profilo: 'D3', kwh_kwp: 1323.64 }, SCREENING_DEFAULTS);
  assert.equal(s.priority, 'C');
  assert.equal(s.data.punteggio, 34.02);
  assert.equal(s.data.punti_taglia, 14.02);
  assert.equal(s.data.kwp, 457.68);
  assert.equal(s.capex, 343260);
  assert.equal(s.data.ricavi_k, 60.58);
  // sopra i 20.000 m² la taglia vale il massimo; X resta C anche con tanti punti
  assert.equal(scoreRoof({ superficie: 175949, profilo: 'D1' }, SCREENING_DEFAULTS).data.punteggio, 100);
  assert.equal(scoreRoof({ superficie: 175949, profilo: 'X' }, { ...SCREENING_DEFAULTS, profilePoints: { ...SCREENING_DEFAULTS.profilePoints, X: 50 } }).priority, 'C');
  assert.equal(scoreRoof({ profilo: 'D1' }, SCREENING_DEFAULTS), null);

  // con il file vero, se c'è su questo computer: tutti i 1.547 edifici tornano uguali
  const real = path.join(os.homedir(), 'Documents', 'Screening_FV_Abruzzo', 'Screening_FV_tetti_Abruzzo.xlsx');
  if (!fs.existsSync(real)) return;
  const rows = readXlsx(fs.readFileSync(real)).Edifici;
  const hi = rows.findIndex(r => r.includes('ID OSM'));
  const H = rows[hi];
  const at = (r, k) => r[H.indexOf(k)];
  for (const r of rows.slice(hi + 1)) {
    const x = scoreRoof({ superficie: at(r, 'Superficie tetto (m²)'), profilo: at(r, 'Profilo consumi') }, SCREENING_DEFAULTS);
    assert.equal(x.priority, at(r, 'Priorità'), `edificio ${at(r, 'ID OSM')}`);
    assert.ok(Math.abs(x.data.punteggio - at(r, 'Punteggio')) < 0.01);
  }
});

test('Database CE: regole con calo, incassi persi, andamento, tipo di proprietario e segnali', () => {
  const p = cleanCe({ mode: 'regole' });
  assert.deepEqual(scoreConvention({ variation: null, lost_per_year: null }, p), { score: null, priority: 'Dati insufficienti' });
  assert.equal(scoreConvention({ variation: -0.1, lost_per_year: 50000 }, p).priority, 'D'); // sotto il calo minimo
  // calo 50% = 30, persi 200.000 = 30, progressivo 15, agricola 15 → 90, A
  assert.deepEqual(scoreConvention({ variation: -0.5, lost_per_year: 200000, trend: 'Progressivo', owner_type: 'Agricola', signals: [] }, p), { score: 90, priority: 'A' });
  // «Improvviso (2024)» vale come «Improvviso»; un acquisto recente toglie punti
  const sudden = scoreConvention({ variation: -0.5, lost_per_year: 200000, trend: 'Improvviso (2024)', owner_type: 'Energetica', signals: ['acquistato_di_recente'] }, p);
  assert.equal(sudden.score, 60);
  assert.equal(sudden.priority, 'B');
  assert.throws(() => cleanCe({ thresholdA: 10, thresholdB: 50 }), /ordine/);
  assert.throws(() => cleanCe({ mode: 'boh' }), /file o le regole/);
  assert.equal(CE_DEFAULTS.mode, 'file');
});

test('parametri dello screening: anteprima, applicazione che ricalcola le priorità senza toccare gli stadi, profilo dalla scheda', async () => {
  await api('POST', '/api/energy/import/screening', screening([
    roof('A', 'D1', 'Grande Spa', 40000, 'w1'), // 50 + 50 = 100 → A
    roof('B', 'D2', 'Media Srl', 6000, 'w2'), // 23,86 + 35 = 58,86 → B
    roof('C', 'ND', null, 3000, 'w3'), // 8,8 + 15 → C
  ]), { raw: true });
  const { opportunities } = (await api('GET', '/api/energy/opportunities?kind=ppa_onsite')).body;
  const media = opportunities.find(o => o.title === 'Media Srl');
  assert.equal(media.priority, 'B');
  await api('POST', `/api/energy/opportunities/${media.id}/stage`, { stage: 'primo_contatto' });

  const cur = (await api('GET', '/api/energy/parametri')).body;
  assert.equal(cur.screening.thresholdA, 70);
  assert.deepEqual(cur.profiles, ['D1', 'D2', 'D3', 'D4', 'ND', 'X']);

  const params = { ...cur.screening, thresholdA: 55 };
  const prev = (await api('POST', '/api/energy/parametri/screening/anteprima', { params })).body;
  assert.deepEqual([prev.total, prev.changed, prev.after.A], [3, 1, 2]);
  // l'anteprima non cambia niente
  assert.equal((await api('GET', `/api/energy/opportunities/${media.id}`)).body.priority, 'B');

  const done = (await api('POST', '/api/energy/parametri/screening', { params })).body;
  assert.equal(done.changed, 1);
  const after1 = (await api('GET', `/api/energy/opportunities/${media.id}`)).body;
  assert.deepEqual([after1.priority, after1.stage], ['A', 'primo_contatto']);

  // profilo corretto sulla scheda: punteggio e priorità con i parametri in uso
  const fixed = (await api('PATCH', `/api/energy/opportunities/${media.id}`, { data: { profilo: 'D4' } })).body;
  assert.deepEqual([fixed.priority, fixed.data.punti_profilo, fixed.data.punteggio], ['C', 0, 23.86]);

  const log = (await api('GET', '/api/energy/parametri')).body;
  assert.equal(log.screening.thresholdA, 55);
  assert.equal(log.updated.screening.by, 'Dante Marramiero');
  assert.ok(log.log.some(l => l.key === 'screening' && l.summary.changed === 1));

  assert.equal((await api('POST', '/api/energy/parametri/screening', { params: { ...params, thresholdB: 90 } })).status, 400);
  assert.equal((await api('POST', '/api/energy/parametri/boh/anteprima', { params })).status, 404);
});

test('parametri del Database CE: regole di Alma Energy, proprietari da portare in pipeline e ritorno alle priorità del file', async () => {
  await api('POST', '/api/energy/import/database-ce', database([
    conv(1, 'A', 'T1', 'Uno Spa', '111', { variation: -0.5, lost: 200000 }), // regole: 30 + 30 + 15 + 10 = 85 → A
    conv(2, 'D', 'T2', 'Due Agricola', '222', { type: 'Agricola', variation: -0.4, lost: 100000, trend: 'Improvviso (2024)' }), // file D, regole A/B
    conv(3, 'B', 'T3', 'Tre Srl', '333', { variation: -0.16, lost: 11000, trend: 'Stabile', type: 'Energetica' }), // file B, regole D
  ]), { raw: true });
  let { opportunities } = (await api('GET', '/api/energy/opportunities?kind=revamping')).body;
  assert.deepEqual(opportunities.map(o => o.title).sort(), ['Tre Srl', 'Uno Spa']);

  const params = { ...(await api('GET', '/api/energy/parametri')).body.database_ce, mode: 'regole' };
  const prev = (await api('POST', '/api/energy/parametri/database_ce/anteprima', { params })).body;
  assert.equal(prev.changed, 2);
  assert.equal(prev.ownersToPipeline, 1);

  const done = (await api('POST', '/api/energy/parametri/database_ce', { params, to_pipeline: true })).body;
  assert.deepEqual([done.changed, done.opportunities], [2, 1]);
  ({ opportunities } = (await api('GET', '/api/energy/opportunities?kind=revamping')).body);
  assert.ok(opportunities.some(o => o.title === 'Due Agricola'));
  assert.equal(opportunities.find(o => o.title === 'Tre Srl').priority, 'D'); // resta in pipeline, con la priorità nuova
  const conv3 = (await db.query("SELECT priority, priority_file, score FROM energy_conventions WHERE convention = 'T3'")).rows[0];
  assert.deepEqual([conv3.priority, conv3.priority_file, conv3.score], ['D', 'B', 1.81]); // calo appena sopra il minimo: pochi punti, D

  // un nuovo import usa le regole in uso; la priorità del file resta a parte
  await api('POST', '/api/energy/import/database-ce', database([conv(3, 'B', 'T3', 'Tre Srl', '333', { variation: -0.16, lost: 11000, trend: 'Stabile', type: 'Energetica' })]), { raw: true });
  assert.equal((await db.query("SELECT priority FROM energy_conventions WHERE convention = 'T3'")).rows[0].priority, 'D');

  // di nuovo le priorità del file
  await api('POST', '/api/energy/parametri/database_ce', { params: { ...params, mode: 'file' } });
  assert.equal((await db.query("SELECT priority FROM energy_conventions WHERE convention = 'T3'")).rows[0].priority, 'B');
  ({ opportunities } = (await api('GET', '/api/energy/opportunities?kind=revamping')).body);
  assert.equal(opportunities.find(o => o.title === 'Tre Srl').priority, 'B');
});
