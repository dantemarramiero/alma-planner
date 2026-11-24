// Alma Energy · Analisi economico-finanziarie (ALM2-74 tappa 2): analisi libere, versioni dal simulatore e da file,
// allegato a un progetto, analisi di riferimento che porta i numeri sull'opportunità e in testa all'iter.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, A, X, dante;
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body, { raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body, opts) => api(cookie, method, path, body, opts);

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dante = await login('dante.marramiero@almacis.it');
  A = as(dante);
  X = as(await login(ADMIN)); // amministratore fuori dalla BU Energy
});

after(async () => {
  server?.close();
  await db?.close();
});

test('analisi libera dal simulatore: versioni, flussi e sensitività, nuova versione che riparte dalle ipotesi', async () => {
  assert.equal((await X('GET', '/api/energy/analyses')).status, 403);
  assert.equal((await A('POST', '/api/energy/analyses', { title: 'x' })).status, 400); // manca il tipo
  const a = (await A('POST', '/api/energy/analyses', { title: 'PPA capannone Sambuceto', project_type: 'ppa_onsite', label: 'preliminare' })).body;
  assert.equal(a.opportunity_id, null);
  assert.equal(a.versions.length, 1);
  const v1 = a.versions[0];
  assert.equal(v1.source, 'simulatore');
  assert.ok(v1.kpi.irr > 0 && v1.kpi.capex > 0);

  // la scheda della versione: flussi per anno e sensitività
  const d1 = (await A('GET', `/api/energy/analysis-versions/${v1.id}`)).body;
  assert.equal(d1.model, 'ppa_onsite');
  assert.ok(d1.flows.length > 10 && d1.flows[0].fcf < 0);
  assert.ok(Object.keys(d1.sensitivity).length > 0);
  assert.equal(d1.previous, null);

  // il simulatore cambia lo scenario della versione → i numeri dell'analisi cambiano
  await A('PATCH', `/api/energy/scenarios/${v1.scenario_id}`, { input: { roofArea: 30000 } });
  const after1 = (await A('GET', `/api/energy/analyses/${a.id}`)).body.versions[0];
  assert.ok(after1.kpi.mw > v1.kpi.mw);
  assert.deepEqual((await A('GET', `/api/energy/scenarios/${v1.scenario_id}/analysis`)).body.id, a.id);

  // v2 riparte dalle ipotesi di v1
  const two = (await A('POST', `/api/energy/analyses/${a.id}/versions`, { label: 'dopo la DD', note: 'Consumi misurati' })).body;
  assert.equal(two.versions.length, 2);
  const d2 = (await A('GET', `/api/energy/analysis-versions/${two.version_id}`)).body;
  assert.equal(d2.input.roofArea, 30000);
  assert.equal(d2.previous.n, 1);
  assert.equal(d2.note, 'Consumi misurati');
  // con due versioni lo scenario di una versione non si cancella dal simulatore
  assert.equal((await A('DELETE', `/api/energy/scenarios/${v1.scenario_id}`)).status, 400);

  const list = (await A('GET', '/api/energy/analyses?stato=libere')).body;
  const row = list.analyses.find(x => x.id === a.id);
  assert.deepEqual([row.n, row.label, row.versions], [2, 'dopo la DD', 2]);
  assert.ok(list.counts.libere >= 1);
});

test('file esterno con i numeri a mano, allegata a un progetto selezionato come analisi di riferimento', async () => {
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'revamping', title: 'Impianto Brindisi 3,4 MW' })).body;
  await A('POST', `/api/energy/opportunities/${opp.id}/target`, { project_type: 'acquisizione' });

  const bad = await A('POST', '/api/energy/analyses', { title: 'Modello banca', project_type: 'acquisizione', source: 'file', kpi: { irr: 'boh' } });
  assert.equal(bad.status, 400);
  const a = (await A('POST', '/api/energy/analyses', { title: 'Modello della banca', project_type: 'acquisizione', source: 'file',
    kpi: { irr: '0,121', npv: 4020000, capex: 8100000, mw: 3.4, payback: 8.6 } })).body;
  const v1 = a.versions[0];
  assert.equal(v1.kpi.irr, 0.121);
  // il file
  const up = await A('POST', `/api/energy/analysis-versions/${v1.id}/file?name=${encodeURIComponent('Modello banca.xlsx')}&type=application/vnd.ms-excel`, null, { raw: Buffer.from('ciao') });
  assert.equal(up.status, 201);
  assert.equal(up.body.versions[0].file_name, 'Modello banca.xlsx');
  const dl = await fetch(`${base}/api/energy/analysis-versions/${v1.id}/file`, { headers: { cookie: dante } });
  assert.equal(await dl.text(), 'ciao');
  assert.equal((await X('GET', `/api/energy/analysis-versions/${v1.id}/file`)).status, 403);
  // i numeri di un file si cambiano a mano, quelli del simulatore no
  assert.equal((await A('PATCH', `/api/energy/analysis-versions/${v1.id}`, { kpi: { irr: 0.125, npv: 4020000, capex: 8100000, mw: 3.4 } })).status, 200);

  // di riferimento senza progetto: no
  assert.equal((await A('PATCH', `/api/energy/analyses/${a.id}`, { reference: true })).status, 400);
  const att = (await A('PATCH', `/api/energy/analyses/${a.id}`, { opportunity_id: opp.id, reference: true })).body;
  assert.equal(att.reference, true);
  let o = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(o.data.scenario.analysis_id, a.id);
  assert.equal(o.data.scenario.irr, 0.125);
  assert.equal(Number(o.capex), 8100000);
  // la pipeline e l'iter leggono i numeri dell'analisi di riferimento
  const card = (await A('GET', '/api/energy/selected')).body.columns[0].cards.find(c => c.id === opp.id);
  assert.equal(card.irr, 0.125);
  const it = (await A('GET', `/api/energy/opportunities/${opp.id}/iter`)).body;
  assert.equal(it.analyses[0].id, a.id);
  assert.equal(it.analyses[0].reference, true);

  // una seconda analisi dal simulatore diventa di riferimento: la prima smette di esserlo
  const b = (await A('POST', '/api/energy/analyses', { title: 'Acquisizione Brindisi', project_type: 'acquisizione', opportunity_id: opp.id, reference: true })).body;
  assert.equal(b.reference, true);
  assert.equal((await A('GET', `/api/energy/analyses/${a.id}`)).body.reference, false);
  o = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(o.data.scenario.analysis_id, b.id);
  // una nuova versione dell'analisi di riferimento aggiorna l'opportunità
  const nv = (await A('POST', `/api/energy/analyses/${b.id}/versions`, { source: 'file', kpi: { irr: 0.2 }, label: 'offerta finale' })).body;
  assert.equal(nv.versions.length, 2);
  o = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(o.data.scenario.irr, 0.2);
  assert.match(o.data.scenario.name, /v2$/);
  // togliere la versione riporta i numeri della v1
  await A('DELETE', `/api/energy/analysis-versions/${nv.version_id}`);
  o = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.notEqual(o.data.scenario.irr, 0.2);
  assert.equal((await A('DELETE', `/api/energy/analysis-versions/${b.versions[0].id}`)).status, 400); // l'ultima no

  // staccata dal progetto torna libera e l'opportunità perde i numeri dell'analisi
  await A('PATCH', `/api/energy/analyses/${b.id}`, { opportunity_id: null });
  o = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.equal(o.data.scenario, undefined);
  assert.equal((await A('DELETE', `/api/energy/analyses/${a.id}`)).status, 200);
  assert.equal((await A('GET', `/api/energy/analyses/${a.id}`)).status, 404);
});

test('gli scenari salvati prima diventano analisi: lo scenario scelto è l\'analisi di riferimento', async () => {
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Tetto di prima' })).body;
  // uno scenario «vecchio», salvato senza analisi, poi scelto
  const s = (await A('POST', '/api/energy/scenarios', { opportunity_id: opp.id, name: 'Base di ottobre', model: 'ppa_onsite', input: {} })).body;
  assert.ok(s.analysis_id); // salvato dal simulatore: è già un'analisi
  await db.query('DELETE FROM energy_analyses WHERE id = $1', [s.analysis_id]); // come prima della tappa 2
  await db.query("UPDATE energy_scenarios SET chosen = true WHERE id = $1", [s.id]);
  await db.query("DELETE FROM schema_migrations WHERE name = '111_energy_analyses.sql'");
  const { migrate } = require('../lib/db');
  if (migrate) await migrate(db);
  else await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'migrations', '111_energy_analyses.sql'), 'utf8'));
  const list = (await A('GET', `/api/energy/analyses?opportunity=${opp.id}`)).body.analyses;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].title, list[0].reference, list[0].n], ['Base di ottobre', true, 1]);
  // «scegli» su uno scenario di un'analisi rende di riferimento l'analisi
  const other = (await A('POST', '/api/energy/analyses', { title: 'Alternativa', project_type: 'ppa_onsite', opportunity_id: opp.id })).body;
  await A('POST', `/api/energy/scenarios/${other.versions[0].scenario_id}/scegli`);
  assert.equal((await A('GET', `/api/energy/analyses/${other.id}`)).body.reference, true);
  assert.equal((await A('GET', `/api/energy/analyses/${list[0].id}`)).body.reference, false);
});
