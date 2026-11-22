// Programmi triennali dei lavori pubblici (canvas v17 · Le fonti del Radar): servizio del MIT finto, ultima versione
// per intervento, segnali «Programmata» per BU con la data prevista, «storia dell'opera» sullo stesso CUP, interruttore.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const P = require('../lib/crm-triennali');

const Y = new Date().getFullYear();
const inter = (cui, extra = {}) => ({ cui, descrizione: `Intervento ${cui}`, anno: 1, cup: '', istat: '013069022', nuts: 'ITF14', priorita: 1, categoria: '05.08', statoProgettazione: '3',
  meseAvvioProcedura: 4, importoTotale: 1200000, ...extra });
const PROGS = {
  // stesso ente, due versioni: nella seconda l'importo cambia
  101: { contri: 101, anno: Y, codiceFiscaleSA: '00146580698', dataPubblicazioneAdozione: '10/01/' + Y, urlAttoAdozione: 'https://albo.example/1', interventi: [inter('L001'), inter('L002', { categoria: '05.12', importoTotale: 500000 })] },
  102: { contri: 102, anno: Y, codiceFiscaleSA: '00146580698', dataPubblicazioneApprovazione: '20/02/' + Y, urlAttoApprovazione: 'https://albo.example/2',
    interventi: [inter('L001', { importoTotale: 1500000 }), inter('L003', { cup: 'J11B24000123456', importoTotale: 900000 }), inter('L004', { anno: 3, importoTotale: 2000000 })] },
};
const asked = [];
const fakeMit = async (url, opts = {}) => {
  asked.push(url);
  if (url.endsWith('/Lista')) {
    const b = JSON.parse(opts.body);
    const data = b.regioneSA === '013' && b.anno === String(Y) ? [{ id: '102', name: 'Comune di Chieti - Lavori pubblici', short_description: 'Approvazione' }, { id: '101', name: 'Comune di Chieti - Lavori pubblici', short_description: 'Adozione' }] : [];
    return new Response(JSON.stringify({ total: data.length, page_limit: 500, offset: 0, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const m = url.match(/Xml\?id=(\d+)/);
  if (m) return new Response(JSON.stringify(PROGS[m[1]]), { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error(`fetch inatteso ${url}`);
};

let server, db, theApp;
before(async () => {
  db = await createDb({});
  theApp = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'direzione@almacis.it' }), { db, triennaliFetch: fakeMit });
  server = theApp.app.listen(0);
  await new Promise(r => server.once('listening', r));
});
after(async () => { server?.close(); await db?.close(); });

test('interventi: anno previsto della gara, mese, categoria CUP, regione dal codice ISTAT', () => {
  const rows = P.rowsOf(PROGS[102]);
  const l4 = rows.find(r => r.cui === 'L004');
  assert.equal(l4.year, Y + 2);
  assert.equal(l4.month, 4);
  assert.equal(l4.region, 'Abruzzo');
  assert.equal(l4.type_key, '05.08');
  assert.equal(l4.design_stage, 'progetto definitivo');
  assert.equal(rows.find(r => r.cui === 'L003').cup, 'J11B24000123456');
});

test('caricamento: per ogni intervento l\'ultima versione del programma, nome dell\'ente dall\'elenco', async () => {
  const out = await P.syncTriennali(db, { fetchImpl: fakeMit, settings: { profiles: { edilizia: { soa: ['OG1'], regions: ['Abruzzo'] } } }, pause: 0, log: () => {} });
  assert.equal(out.programmes, 2);
  assert.ok(!asked.some(u => u.includes('regioneSA')), 'il corpo è JSON');
  const { rows } = await db.query('SELECT cui, amount, prog_id, sa_name, region FROM crm_prog_interventi ORDER BY cui');
  assert.deepEqual(rows.map(r => r.cui), ['L001', 'L002', 'L003', 'L004']);
  assert.equal(Number(rows[0].amount), 1500000); // dalla versione 102
  assert.equal(rows[0].prog_id, 102);
  assert.equal(rows[0].sa_name, 'Comune di Chieti - Lavori pubblici');
  assert.equal(rows[0].region, 'Abruzzo');
});

test('segnali «Programmata» per BU: tipi di lavoro e importi del profilo, data prevista, una volta sola; stesso CUP = stessa scheda', async () => {
  const { loadSettings } = require('../lib/crm-commerciale');
  const base = await loadSettings(db);
  const bu = Object.keys(base.profiles).find(k => (base.profiles[k].soa || []).includes('OG1'));
  const settings = { ...base, profiles: { ...base.profiles, [bu]: { ...base.profiles[bu], regions: ['Abruzzo'], amount_min: 300000, amount_max: 12000000 } }, radar: { ...base.radar, bu: { [bu]: { on: true } } } };
  const radar = theApp.app.locals.crmRadar;
  // un'opera con lo stesso CUP di L003 è già nel Radar (da OpenCUP)
  const { rows: [old] } = await db.query(`INSERT INTO crm_signals (source, external_id, kind, bu, title, stage, cup, status) VALUES ('opencup', 'J11B24000123456', 'opera_finanziata', $1, 'Scuola finanziata', 'finanziata', 'J11B24000123456', 'nuovo') RETURNING id`, [bu]);
  const n = await P.progSignals(db, { settings, radar });
  assert.equal(n, 1); // L001 (scuola, 1,5 M€, quest'anno); L002 è un impianto sportivo, L004 è tra 2 anni, L003 si unisce
  const { rows: [g] } = await db.query(`SELECT * FROM crm_signals WHERE source = 'triennali' AND external_id = 'L001'`);
  assert.equal(g.stage, 'programmata');
  assert.equal(g.kind, 'programma');
  assert.equal(String(g.expected_on instanceof Date ? g.expected_on.toISOString() : g.expected_on).slice(0, 10), `${Y}-04-01`);
  const { rows: [merged] } = await db.query('SELECT expected_on, summary FROM crm_signals WHERE id = $1', [old.id]);
  assert.ok(merged.expected_on);
  assert.match(merged.summary, /programma triennale/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM crm_signals WHERE source = 'triennali' AND external_id = 'L003'`)).rows[0].n, 0);
  assert.equal(await P.progSignals(db, { settings, radar }), 0);
  assert.equal(await P.progSignals(db, { settings: { ...settings, prima_bando: { ...settings.prima_bando, triennali: false } }, radar }), 0);
});

test('tipi di lavoro: il sottosettore dei programmi (due livelli) vale per i tipi a tre livelli; «05.99» solo con la parola giusta', async () => {
  const C = require('../lib/crm-cup');
  await db.query(`INSERT INTO crm_prog_interventi (cui, prog_id, prog_year, title, type_key, region, year) VALUES
    ('T1', 1, ${Y}, 'Nuova cabina MT', '03.16', 'Abruzzo', ${Y}), ('T2', 1, ${Y}, 'Rifacimento illuminazione pubblica', '05.99', 'Abruzzo', ${Y}),
    ('T3', 1, ${Y}, 'Ampliamento del cimitero', '05.99', 'Abruzzo', ${Y})`);
  const params = [];
  const sql = P.typeMatchSql(C.typesFor(['OG10']), params);
  const { rows } = await db.query(`SELECT cui FROM crm_prog_interventi i WHERE cui LIKE 'T%' AND ${sql} ORDER BY cui`, params);
  assert.deepEqual(rows.map(r => r.cui), ['T1', 'T2']);
});

test('secondo giro: si leggono solo i programmi nuovi, gli interventi si aggiornano senza perdere segnali', async () => {
  PROGS[103] = { contri: 103, anno: Y, codiceFiscaleSA: '00146580698', dataPubblicazioneApprovazione: '15/06/' + Y, interventi: [inter('L001', { importoTotale: 1800000 }), inter('L009', { importoTotale: 700000 })] };
  const before = (await db.query(`SELECT signal_id FROM crm_prog_interventi WHERE cui = 'L001'`)).rows[0].signal_id;
  const fakeNew = async (url, opts = {}) => {
    if (url.endsWith('/Lista')) {
      const b = JSON.parse(opts.body);
      const data = b.regioneSA === '013' && b.anno === String(Y) ? ['103', '102', '101'].map(id => ({ id, name: 'Comune di Chieti - Lavori pubblici', short_description: '' })) : [];
      return new Response(JSON.stringify({ total: data.length, data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fakeMit(url, opts);
  };
  asked.length = 0;
  const out = await P.syncTriennali(db, { fetchImpl: fakeNew, settings: { profiles: { edilizia: { soa: ['OG1'], regions: ['Abruzzo'] } } }, pause: 0, log: () => {} });
  assert.equal(out.programmes, 1);
  assert.deepEqual(asked.filter(u => u.includes('Xml')).map(u => u.split('id=')[1]), ['103']);
  const { rows } = await db.query(`SELECT cui, amount, prog_id, signal_id FROM crm_prog_interventi WHERE cui IN ('L001', 'L002', 'L009') ORDER BY cui`);
  assert.deepEqual(rows.map(r => r.cui), ['L001', 'L002', 'L009']);
  assert.equal(Number(rows[0].amount), 1800000);
  assert.equal(rows[0].prog_id, 103);
  assert.equal(rows[0].signal_id, before);
});
