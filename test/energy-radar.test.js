// Alma Energy · Radar energia (ALM2-74 tappa 3): fonti (Database CE, radar di Alma Impianti, a mano, ricerca web),
// punteggio, «Prendi» che crea azienda, opportunità e bozza di analisi, «Scarta» con motivo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const R = require('../lib/energy-radar');

let server, base, db, A, X;
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = as(await login('dante.marramiero@almacis.it'));
  X = as(await login(ADMIN));
});
after(async () => { server?.close(); await db?.close(); });

test('MW, tipo e punteggio dei segnali', () => {
  assert.equal(R.mwOf('Impianto da 3,4 MW in vendita'), 3.4);
  assert.equal(R.mwOf('tetto con 980 kWp'), 0.98);
  assert.equal(R.kindOf('Fondo cede portafoglio fotovoltaico'), 'cessione');
  assert.equal(R.kindOf('PAS approvata per agrivoltaico'), 'autorizzazione');
  assert.equal(R.kindOf('Graduatoria FER X pubblicata'), 'asta_fer');
  const near = R.scoreOf({ kind: 'cessione', mw: 3, deadline: '2026-12-10', region: 'Puglia' }, { regions: ['Puglia'] }, { today: '2026-11-24', knownCompany: true });
  const far = R.scoreOf({ kind: 'notizia', mw: 200, region: 'Lazio' }, { regions: ['Puglia'] }, { today: '2026-11-24' });
  assert.ok(near.score > far.score);
  assert.deepEqual(Object.keys(near.parts), ['coerenza', 'valore', 'tempi', 'rapporto', 'zona']);
  assert.equal(near.score, 100);
});

test('ricerca web: cessioni e aste FER lette dalla risposta, con i MW e il costo', async () => {
  const fake = async () => ({ ok: true, json: async () => ({
    output_text: JSON.stringify([{ title: 'In vendita impianto FV da 4,2 MW a Brindisi', entity: 'Sole Srl', kind: 'notizia', region: 'Puglia', place: 'Brindisi',
      url: 'https://esempio.it/vendita', summary: 'Data room aperta fino a gennaio', why: 'IPP' }]),
    output: [{ type: 'web_search_call' }], usage: { input_tokens: 1000, output_tokens: 500 } }) });
  const r = await R.searchWeb({ apiKey: 'x', search: R.SEARCHES[0], settings: {}, today: '2026-11-24', fetchImpl: fake });
  assert.equal(r.signals.length, 1);
  assert.deepEqual([r.signals[0].kind, r.signals[0].mw], ['cessione', 4.2]);
  assert.ok(r.costEur > 0);
});

test('fonti: Database CE e radar di Alma Impianti; a mano; prendi crea azienda, opportunità e bozza di analisi; scarta', async () => {
  assert.equal((await X('GET', '/api/energy/radar')).status, 403);
  // Database CE: un proprietario fuori pipeline con sottoperformance, uno già in pipeline (non entra), uno senza segnali forti
  await db.query(`INSERT INTO energy_conventions (convention, priority, owner_name, owner_vat, region, province, avg_recent, lost_per_year, variation, signals)
    VALUES ('C1', 'C', 'Sole Spento Srl', '01234567890', 'Abruzzo', 'CH', 80000, 45000, -0.36, ARRAY['sottoperformance']),
           ('C2', 'C', 'Sole Spento Srl', '01234567890', 'Abruzzo', 'CH', 20000, 5000, -0.2, ARRAY['in_liquidazione']),
           ('C3', 'D', 'Tranquillo Spa', '09876543210', 'Lazio', 'RM', 50000, 0, 0.01, ARRAY['operatore_strutturato'])`);
  // radar di Alma Impianti: una PAS approvata (entra come autorizzazione), un depuratore (no)
  await db.query(`INSERT INTO crm_signals (source, kind, bu, sector, title, summary, entity, region, url)
    VALUES ('stampa', 'permesso', 'impianti', 'fotovoltaico', 'PAS approvata per agrivoltaico da 6 MW a Campobasso', 'Lo sviluppatore cerca un partner', 'Green Dev Srl', 'Molise', 'https://esempio.it/pas'),
           ('stampa', 'gara', 'impianti', 'depurazione', 'Gara per il depuratore di Pescara', '', 'ACA', 'Abruzzo', 'https://esempio.it/dep')`);
  const run = (await A('POST', '/api/energy/radar/cerca', { web: false })).body;
  assert.deepEqual([run.added.database_ce, run.added.impianti], [1, 1]);
  assert.equal((await A('POST', '/api/energy/radar/cerca', { web: false })).body.added.database_ce, 0); // niente doppioni

  let list = (await A('GET', '/api/energy/radar')).body;
  const ce = list.signals.find(s => s.source === 'database_ce');
  assert.equal(ce.kind, 'revamping');
  assert.match(ce.title, /Sole Spento Srl: 2 convenzioni/);
  assert.match(ce.why, /Sottoperformance/);
  const pas = list.signals.find(s => s.source === 'impianti');
  assert.deepEqual([pas.kind, Number(pas.mw)], ['autorizzazione', 6]);
  assert.equal(list.counts.revamping, 1);

  // a mano
  const man = await A('POST', '/api/energy/radar', { title: 'Impianto 3,4 MW in vendita a Brindisi', kind: 'cessione', entity: 'Fondo Uscita Srl', region: 'Puglia', deadline: '2027-01-15' });
  assert.equal(man.status, 201);
  assert.equal(Number(man.body.mw), 3.4);
  assert.equal((await A('POST', '/api/energy/radar', { title: 'Impianto 3,4 MW in vendita a Brindisi', kind: 'cessione' })).status, 400); // doppione

  // prendi: cessione → azienda venditore, opportunità revamping, analisi «acquisizione» con 3,4 MW
  const took = (await A('POST', `/api/energy/radar/${man.body.id}/prendi`)).body;
  const opp = (await A('GET', `/api/energy/opportunities/${took.opportunity_id}`)).body;
  assert.deepEqual([opp.kind, opp.stage, opp.company_name], ['revamping', 'da_analizzare', 'Fondo Uscita Srl']);
  const an = (await A('GET', `/api/energy/analyses/${took.analysis_id}`)).body;
  assert.deepEqual([an.project_type, an.opportunity_id, an.versions[0].label], ['acquisizione', took.opportunity_id, 'bozza dal radar']);
  assert.equal(an.versions[0].kpi.mw > 3, true);
  assert.equal((await A('POST', `/api/energy/radar/${man.body.id}/prendi`)).status, 400); // già preso

  // prendi dal Database CE: il proprietario entra con le sue convenzioni
  const tookCe = (await A('POST', `/api/energy/radar/${ce.id}/prendi`)).body;
  const { rows: convs } = await db.query("SELECT opportunity_id FROM energy_conventions WHERE owner_vat = '01234567890'");
  assert.ok(convs.every(c => c.opportunity_id === tookCe.opportunity_id));

  // scarta chiede il motivo; riapri
  assert.equal((await A('POST', `/api/energy/radar/${pas.id}/scarta`, {})).status, 400);
  assert.equal((await A('POST', `/api/energy/radar/${pas.id}/scarta`, { reason: 'Troppo lontano' })).body.status, 'scartato');
  list = (await A('GET', '/api/energy/radar?status=scartato')).body;
  assert.equal(list.signals[0].discard_reason, 'Troppo lontano');
  assert.equal((await A('POST', `/api/energy/radar/${pas.id}/riapri`)).body.status, 'nuovo');
  const presi = (await A('GET', '/api/energy/radar?status=preso')).body;
  assert.equal(presi.signals.length, 2);
  assert.equal(presi.byStatus.preso, 2);

  // impostazioni
  const s = (await A('PUT', '/api/energy/radar/impostazioni', { quota_eur: 30, regions: ['Abruzzo', 'Puglia'], mw_min: 1, mw_max: 10 })).body.settings;
  assert.deepEqual([s.quota_eur, s.regions, s.mw_max], [30, ['Abruzzo', 'Puglia'], 10]);
});
