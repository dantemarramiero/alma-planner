// Concorrenza dai dati ANAC e «Prima del bando» (17/11/2026): import mensile dagli zip, numeri per BU, stima per una
// gara, scheda dall'impresa, gare vinte da altri come segnali, esito già compilato dal CIG, secondo giro del radar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { parseLine, regionOf, criterionOf } = require('../lib/crm-anac');
const { parseSignals } = require('../lib/crm-radar-ai');

let server, base, db, D, E;
const ADMIN = 'direzione@almacis.it';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const csv = rows => rows.map(r => r.map(x => (x === null ? '' : `"${String(x).replace(/"/g, '""')}"`)).join(';')).join('\n');
// zip con un solo file (intestazione locale + deflate), come quelli di ANAC
function zip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18); h.writeUInt32LE(Buffer.byteLength(text), 22); h.writeUInt16LE(Buffer.byteLength(name), 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, Buffer.from(name), data, Buffer.alloc(22)]);
}
const FILES = {
  aggiudicazioni: csv([['cig', 'data_aggiudicazione_definitiva', 'esito', 'criterio_aggiudicazione', 'data_comunicazione_esito', 'importo_aggiudicazione', 'ribasso_aggiudicazione', 'num_imprese_offerenti', 'flag_subappalto'],
    ['AAAAAAAAA1', day(10), 'AGGIUDICATA', 'PREZZO PIU\' BASSO', day(9), '1500000', '24.5', '12', 'true'],
    ['AAAAAAAAA2', day(20), 'AGGIUDICATA', 'OFFERTA ECONOMICAMENTE PIÙ VANTAGGIOSA: MIGLIOR RAPPORTO QUALITÀ / PREZZO', day(19), '2400000', '18.2', '7', 'false'],
    ['AAAAAAAAA3', day(30), 'AGGIUDICATA', 'PREZZO PIU\' BASSO', day(29), '900000', '28.0', '15', 'false'],
    ['AAAAAAAAA4', day(15), 'AGGIUDICATA', 'PREZZO PIU\' BASSO', day(14), '800000', '21.0', '9', 'false'],
    ['BBBBBBBBB1', day(10), 'AGGIUDICATA', '', '', '5000', '0', '1', 'false'], // sotto il minimo
    ['CCCCCCCCC1', day(10), 'AGGIUDICATA', '', '', '700000', '10', '3', 'false']]), // categoria non nostra
  'categorie-opera': csv([['cig', 'id_categoria', 'descrizione', 'cod_tipo_categoria', 'descrizione_tipo_categoria'],
    ['AAAAAAAAA1', 'OG 1', 'EDIFICI CIVILI', 'P', 'PREVALENTE'], ['AAAAAAAAA1', 'OG 11', 'IMPIANTI', 'S', 'SCORPORABILE'],
    ['AAAAAAAAA2', 'OG 1', 'EDIFICI CIVILI', 'P', 'PREVALENTE'], ['AAAAAAAAA3', 'OG 1', 'EDIFICI CIVILI', 'P', 'PREVALENTE'], ['AAAAAAAAA4', 'OG 1', 'EDIFICI CIVILI', 'P', 'PREVALENTE'],
    ['CCCCCCCCC1', 'OG 3', 'STRADE', 'P', 'PREVALENTE']]),
  cig: csv([['cig', 'oggetto_gara', 'oggetto_lotto', 'importo_lotto', 'oggetto_principale_contratto', 'provincia', 'data_pubblicazione', 'cf_amministrazione_appaltante', 'denominazione_amministrazione_appaltante', 'sezione_regionale', 'cod_cpv', 'flag_pnrr_pnc'],
    ['AAAAAAAAA1', 'Adeguamento sismico ITIS "Volta"', '', '1980000', 'LAVORI', 'PESCARA', day(80), '80000000000', 'PROVINCIA DI PESCARA', 'SEZIONE REGIONALE ABRUZZO', '45454000', '1'],
    ['AAAAAAAAA2', 'Nuova scuola\ndi Ortona', '', '3000000', 'LAVORI', 'CHIETI', day(90), '80000000001', 'COMUNE DI ORTONA', 'SEZIONE REGIONALE ABRUZZO', '45214200', '0'],
    ['AAAAAAAAA3', 'Ampliamento casa di comunità', '', '1200000', 'LAVORI', 'TERAMO', day(70), '80000000002', 'ASL TERAMO', 'SEZIONE REGIONALE CENTRALE', '45215100', '0'],
    ['AAAAAAAAA4', 'Manutenzione scuole', '', '1000000', 'LAVORI', 'CHIETI', day(60), '80000000003', 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '45453000', '0'],
    ['BBBBBBBBB1', 'Piccolo lavoro', '', '5000', 'LAVORI', 'ROMA', day(20), '1', 'X', 'SEZIONE REGIONALE LAZIO', '45000000', '0'],
    ['CCCCCCCCC1', 'Strada', '', '800000', 'LAVORI', 'ROMA', day(20), '1', 'X', 'SEZIONE REGIONALE LAZIO', '45233000', '0']]),
  aggiudicatari: csv([['cig', 'ruolo', 'codice_fiscale', 'denominazione', 'tipo_soggetto', 'id_aggiudicazione'],
    ['AAAAAAAAA1', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '01234567890', 'CMB COSTRUZIONI S.C.A.R.L.', 'IMPRESA', '1'],
    ['AAAAAAAAA2', 'MANDATARIA', '01234567890', 'CMB COSTRUZIONI S.C.A.R.L.', 'IMPRESA', '2'],
    ['AAAAAAAAA2', 'MANDANTE', '09876543210', 'TADDEI S.P.A.', 'IMPRESA', '2'],
    ['AAAAAAAAA2', 'IMPRESA AUSILIARIA', '11111111111', 'PRESTA REQUISITI SRL', 'IMPRESA', '2'],
    ['AAAAAAAAA3', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '02222222222', 'ALMACIS S.R.L.', 'IMPRESA', '3'],
    ['AAAAAAAAA4', 'MANDATARIA', '01234567890', 'CMB COSTRUZIONI S.C.A.R.L.', 'IMPRESA', '4'],
    ['AAAAAAAAA4', 'MANDANTE', '09876543210', 'TADDEI S.P.A.', 'IMPRESA', '4']]),
};
const thisMonth = new Date().toISOString().slice(0, 7).replace('-', '');
async function fakeAnac(url) {
  if (url.includes('package_show')) return { ok: true, json: async () => ({ result: { resources: [{ name: `${thisMonth}01-aggiudicazioni_csv` }, { name: 'aggiudicazioni_csv_logCsv' }] } }) };
  const ds = url.match(/dataset\/([^/]+)\//)[1];
  const buf = zip(`${thisMonth}01-${ds}_csv.csv`, FILES[ds]);
  return { ok: true, body: require('stream').Readable.from([buf.subarray(0, 17), buf.subarray(17)]) }; // a pezzi, come dalla rete
}
const radarCalls = [];
async function fakeOpenAI(url, opts) {
  const body = JSON.parse(opts.body);
  radarCalls.push(body.input);
  const pre = /vengono prima della gara/.test(body.input);
  const items = pre
    ? [{ title: 'Polo scolastico di Chieti nel programma triennale', entity: 'Comune di Chieti', kind: 'opera_finanziata', stage: 'programmata', amount: 4200000, region: 'Abruzzo', place: 'Chieti', url: 'https://example.com/triennale', published_on: day(3), expected_on: '2027-03-01', summary: 'Inserito nel programma 2026-28', why: 'scuole' }]
    : [];
  return { ok: true, json: async () => ({ output_text: JSON.stringify(items), usage: { input_tokens: 1000, output_tokens: 300 } }) };
}
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const meId = async who => { const b = (await who('GET', '/api/me')).body; return b.id ?? b.user?.id; };

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI, anacFetch: fakeAnac });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  const eId = await meId(E);
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  assert.equal((await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, manager_id: eId, regions: ['Abruzzo'], amount_min: 300000 } } })).status, 200);
  { const r = await D('PUT', '/api/crm/commerciale/radar', { value: { ...s.radar, budget_eur: 400, bu: { ...s.radar.bu, edilizia: { on: true, quota_eur: 30 } } } }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  { const r = await D('PUT', '/api/crm/commerciale/concorrenza', { value: { ...s.concorrenza, our_cf: ['02222222222'] } }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
});
after(async () => { server?.close(); await db?.close(); });

test('csv, regioni e criteri di ANAC', () => {
  assert.deepEqual(parseLine('"A";"b ""c""";;"d;e"'), ['A', 'b "c"', '', 'd;e']);
  assert.equal(regionOf('SEZIONE REGIONALE ABRUZZO', ''), 'Abruzzo');
  assert.equal(regionOf('SEZIONE REGIONALE CENTRALE', 'TERAMO'), 'Abruzzo');
  assert.equal(regionOf('SEZIONE REGIONALE PROVINCIA AUTONOMA DI TRENTO', ''), 'Trentino-Alto Adige');
  assert.equal(criterionOf('PREZZO PIU\' BASSO'), 'prezzo');
  assert.equal(criterionOf('OFFERTA ECONOMICAMENTE PIÙ VANTAGGIOSA: CRITERIO DEL MINOR PREZZO'), 'prezzo');
  assert.equal(criterionOf('OFFERTA ECONOMICAMENTE PIÙ VANTAGGIOSA: MIGLIOR RAPPORTO QUALITÀ / PREZZO'), 'oepv');
});

test('import ANAC: solo le nostre categorie sopra il minimo, vincitori e ATI, poi i numeri della BU', async () => {
  assert.equal((await E('POST', '/api/crm/concorrenza/aggiorna', {})).status, 403);
  assert.equal((await D('POST', '/api/crm/concorrenza/aggiorna', {})).status, 200);
  for (let i = 0; i < 100 && (await D('GET', '/api/crm/concorrenza/stato')).body.running; i++) await new Promise(r => setTimeout(r, 50));
  const st = (await D('GET', '/api/crm/concorrenza/stato')).body;
  assert.equal(st.imports[0].month, thisMonth);
  assert.equal(st.imports[0].error, '');
  assert.equal(st.imports[0].kept, 4);
  const a2 = (await db.query("SELECT * FROM crm_anac_awards WHERE cig = 'AAAAAAAAA2'")).rows[0];
  assert.equal(a2.object, 'Nuova scuola\ndi Ortona');
  assert.equal(a2.criterion, 'oepv');
  assert.deepEqual(a2.winners.map(w => w.role), ['mandataria', 'mandante']); // l'ausiliaria non vince
  const o = (await E('GET', '/api/crm/concorrenza?bu=edilizia')).body;
  assert.equal(o.kpi.gare, 4);
  assert.equal(o.kpi.noi, 1);
  assert.equal(o.winners[0].name, 'CMB COSTRUZIONI S.C.A.R.L.');
  assert.equal(o.winners[0].vinte, 3);
  assert.equal(o.winners.find(w => w.cf === '02222222222').noi, true);
  assert.ok(o.kpi.ribasso > 18 && o.kpi.ribasso < 28);
  assert.equal(o.ati[0].name, 'CMB COSTRUZIONI S.C.A.R.L.');
  assert.ok(!o.ati.some(w => w.cf === '02222222222'));
  assert.equal(o.ours[0].cig, 'AAAAAAAAA3');
  // regioni fuori dal profilo: niente
  const s = (await D('GET', '/api/crm/commerciale')).body.settings;
  await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, regions: ['Lazio'] } } });
  assert.equal((await E('GET', '/api/crm/concorrenza?bu=edilizia')).body.kpi.gare, 0);
  assert.equal((await E('GET', '/api/crm/concorrenza?bu=edilizia&regions=tutte')).body.kpi.gare, 4);
  await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: { ...s.profiles.edilizia, regions: ['Abruzzo'] } } });
});

test('impresa di ANAC → scheda concorrente, poi riconosciuta per P. IVA', async () => {
  const r = await E('POST', '/api/crm/concorrenza/scheda', { name: 'CMB COSTRUZIONI S.C.A.R.L.', cf: '01234567890' });
  assert.equal(r.status, 201);
  const again = await E('POST', '/api/crm/concorrenza/scheda', { name: 'Cmb Costruzioni', cf: '01234567890', role: 'partner' });
  assert.equal(again.body.id, r.body.id);
  const roles = (await db.query('SELECT roles FROM crm_subjects WHERE id = $1', [r.body.id])).rows[0].roles;
  assert.deepEqual(roles.sort(), ['concorrente', 'partner']);
  const o = (await E('GET', '/api/crm/concorrenza?bu=edilizia')).body;
  assert.equal(o.winners[0].subject.id, r.body.id);
});

test('gare vinte da altri → segnali «subappalto o ATI» in Prima del bando; la nostra no', async () => {
  const { rows } = await db.query("SELECT * FROM crm_signals WHERE source = 'anac' ORDER BY amount DESC");
  assert.deepEqual(rows.map(r => r.cig), ['AAAAAAAAA2', 'AAAAAAAAA1', 'AAAAAAAAA4']);
  assert.equal(rows[0].stage, 'vinta_altri');
  assert.equal(rows[0].kind, 'subappalto');
  assert.equal(rows[0].bu, 'edilizia');
  assert.match(rows[0].title, /^CMB COSTRUZIONI S\.C\.A\.R\.L\. ha vinto/);
  assert.match(rows[0].summary, /in ATI con TADDEI/);
  const p = (await E('GET', '/api/crm/prima-del-bando')).body;
  assert.equal(p.vinte_altri.length, 3);
  const plan = (await E('POST', `/api/crm/radar/signals/${rows[0].id}/interessa`, {})).body;
  assert.ok(plan);
});

test('stima per una gara ed esito già compilato dal CIG', async () => {
  const sig = await E('POST', '/api/crm/radar/signals', { title: 'Gara manutenzione scuole', entity: 'Provincia di Chieti', bu: 'edilizia', amount: 1000000, region: 'Abruzzo', cig: 'AAAAAAAAA4', soa: ['OG1'] });
  assert.equal(sig.status, 201, JSON.stringify(sig.body));
  const st = (await E('GET', `/api/crm/concorrenza/stima?signal_id=${sig.body.id}`)).body;
  assert.equal(st.category, 'OG1');
  assert.ok(st.estimate.n >= 1);
  assert.equal(st.award.cig, 'AAAAAAAAA4');
  assert.equal(st.award.ours, false);
  const pre = (await E('GET', `/api/crm/esiti/nuovo?signal_id=${sig.body.id}`)).body;
  assert.equal(pre.result, 'persa');
  assert.equal(pre.winner_name, 'CMB COSTRUZIONI S.C.A.R.L.');
  assert.equal(Number(pre.winner_discount), 21);
  assert.equal(pre.bidders, 9);
  assert.equal(pre.anac, true);
});

test('radar: secondo giro «prima del bando» con fase e data attesa', async () => {
  const r = (await D('POST', '/api/crm/radar/run', { bu: 'edilizia' })).body;
  assert.equal(r.runs[0].added, 1);
  assert.ok(radarCalls.some(t => /vengono prima della gara/.test(t)));
  const p = (await E('GET', '/api/crm/prima-del-bando')).body;
  assert.equal(p.stages.programmata.length, 1);
  assert.equal(p.stages.programmata[0].expected_on.slice(0, 7), '2027-03');
  assert.deepEqual(parseSignals('[{"title":"x","url":"https://a.it","stage":"boh","expected_on":"2027-01-01"}]')[0].stage, '');
});

test('categorie delle iniziative aperte di Nuovi business: il mese si ricarica con la categoria nuova (20/11)', async () => {
  const { categoryCoverage } = require('../lib/crm-anac');
  const { loadSettings } = require('../lib/crm-commerciale');
  const before = await categoryCoverage(db, await loadSettings(db));
  assert.ok(before.loaded.includes('OG1') && !before.loaded.includes('OG3'));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM crm_anac_awards WHERE cig = 'CCCCCCCCC1'")).rows[0].n, 0);
  // iniziativa aperta con OG3 (le strade): al prossimo giro il mese si ricarica e la gara CCCCCCCCC1 entra
  await db.query(`INSERT INTO crm_initiatives (name, phase, profile) VALUES ('Strade', 'analisi', '{"soa": ["OG 3"]}'), ('Vecchia', 'abbandonata', '{"soa": ["OS30"]}')`);
  const mid = await categoryCoverage(db, await loadSettings(db));
  assert.ok(mid.pending.includes('OG3') && !mid.pending.includes('OS30'));
  assert.equal((await D('POST', '/api/crm/concorrenza/aggiorna', {})).status, 200);
  for (let i = 0; i < 100 && (await D('GET', '/api/crm/concorrenza/stato')).body.running; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM crm_anac_awards WHERE cig = 'CCCCCCCCC1'")).rows[0].n, 1);
  const after = await categoryCoverage(db, await loadSettings(db));
  assert.ok(after.loaded.includes('OG3'));
  assert.deepEqual(after.pending, []);
});

test('«Cerca un\'impresa» (v11): per nome o P.IVA tra chi ha vinto, anche fuori dal CRM', async () => {
  const r = (await E('GET', '/api/crm/concorrenza/cerca?q=taddei')).body;
  assert.equal(r.imprese[0].name, 'TADDEI S.P.A.');
  assert.equal(r.imprese[0].vinte, 2);
  assert.equal((await E('GET', '/api/crm/concorrenza/cerca?q=0987654')).body.imprese[0].cf, '09876543210');
  assert.deepEqual((await E('GET', '/api/crm/concorrenza/cerca?q=x')).body.imprese, []);
});
