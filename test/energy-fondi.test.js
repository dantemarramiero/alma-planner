// Alma Energy sul CRM centrale, tappa 2 (ALM2-83): fondi che cercano un EPC ed energivori da chiamare come clienti
// potenziali, radar energia che confluisce nel radar centrale.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const F = require('../lib/energy-fondi');
const { reasonForEnergivoro } = require('../routes/energy-crm');

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

test('calcoli: tecnologie e regioni dal testo, abbinamento fondo-progetto, risparmio e punteggio degli energivori', () => {
  assert.deepEqual(F.techsOfText('Fondo compra 120 MW di agrivoltaico'), ['fotovoltaico']);
  assert.deepEqual(F.regionsOfText('progetti RTB in Puglia e al Sud').includes('Molise'), true);
  const p = { project_type: 'fv_nuovo', selection: 'avviato', capex: 3600000, region: 'Abruzzo' };
  assert.equal(F.matchFund({ techs: ['fotovoltaico'], ticket_min: 2e6, ticket_max: 6e7, regions: ['Sud'], phases: ['autorizzato'] }, p).pct, 100);
  assert.ok(F.matchFund({ techs: ['biometano'], regions: ['Lombardia'] }, p).pct < 60);
  // 22.000 m² di tetto: 0,6 × 0,2 kWp × 1.300 kWh = 3.432 MWh, pagati 40 €/MWh in meno della bolletta
  assert.equal(F.savingEur({ consumption_gwh: 58, roof_m2: 22000 }), 137280);
  const big = F.energivoroScore({ consumption_gwh: 120, roof_m2: 22000, region: 'Abruzzo', energy_reason: 'nuovo reparto', energy_reason_on: '2026-11-20' }, { regions: ['Abruzzo'], today: '2026-11-24' });
  const small = F.energivoroScore({ consumption_gwh: 2, roof_m2: 1000, region: 'Lazio' }, { regions: ['Abruzzo'], today: '2026-11-24' });
  assert.ok(big > small && big <= 100);
});

test('il radar energia confluisce nel radar centrale e le decisioni valgono dalle due parti', async () => {
  const s = (await A('POST', '/api/energy/radar', { title: 'Impianto 2 MW in vendita a Lecce', kind: 'cessione', entity: 'Sole Lecce Srl', region: 'Puglia' })).body;
  const { rows: [c] } = await db.query("SELECT * FROM crm_signals WHERE source = 'energy' AND external_id = $1", [`energy:${s.id}`]);
  assert.deepEqual([c.bu, c.sector, c.status, c.kind], ['energy', 'cessione', 'nuovo', 'investimento']);
  assert.match(c.summary, /2 MW/);
  // scartato nel radar centrale → scartato anche in Energy
  await db.query("UPDATE crm_signals SET status = 'scartato', discard_reason = 'Troppo piccolo' WHERE id = $1", [c.id]);
  const back = (await A('GET', '/api/energy/radar?status=scartato')).body.signals.find(x => x.id === s.id);
  assert.equal(back.discard_reason, 'Troppo piccolo');
  // riaperto in Energy → di nuovo nuovo nel centrale
  await A('POST', `/api/energy/radar/${s.id}/riapri`);
  assert.equal((await db.query('SELECT status FROM crm_signals WHERE id = $1', [c.id])).rows[0].status, 'nuovo');
});

test('fondi: chi cerca un EPC dalle notizie, abbinato ai nostri progetti; «aggiungi al CRM» col mandato; «proponi»', async () => {
  assert.equal((await X('GET', '/api/energy/crm/fondi')).status, 403);
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'fv_classico', title: 'FV Atessa 4,8 MW', mw: 4.8, capex: 3600000, region: 'Abruzzo' })).body;
  await A('POST', `/api/energy/opportunities/${opp.id}/target`, { project_type: 'fv_nuovo' });
  const sig = (await A('POST', '/api/energy/radar', { title: 'Infra Green Fund II compra 120 MW di fotovoltaico pronto in Abruzzo', kind: 'fondo', entity: 'Infra Green Fund II', region: 'Abruzzo' })).body;
  let d = (await A('GET', '/api/energy/crm/fondi')).body;
  const n = d.nuovi.find(x => x.id === sig.id);
  assert.deepEqual(n.techs, ['fotovoltaico']);
  assert.equal(n.match.project_id, opp.id);
  assert.ok(n.match.pct >= 80);
  assert.ok(d.kpi.da_chiamare >= 1);

  const added = (await A('POST', `/api/energy/crm/fondi/segnali/${sig.id}/aggiungi`)).body;
  const { rows: [s] } = await db.query('SELECT segment, asa, lead_stage FROM crm_subjects WHERE id = $1', [added.subject_id]);
  assert.deepEqual([s.segment, s.asa.includes('energy')], ['Fondo o investitore', true]);
  const { rows: [m] } = await db.query('SELECT techs, regions, seeks_epc, bus FROM crm_fund_mandates WHERE subject_id = $1', [added.subject_id]);
  assert.deepEqual([m.techs, m.regions, m.seeks_epc, m.bus], [['fotovoltaico'], ['Abruzzo'], true, ['energy']]);
  assert.equal((await A('POST', `/api/energy/crm/fondi/segnali/${sig.id}/aggiungi`)).status, 400); // già deciso
  d = (await A('GET', '/api/energy/crm/fondi')).body;
  assert.ok(d.fondi.some(f => f.subject_id === added.subject_id && f.match.pct >= 80));
  assert.ok(d.abbinamenti.find(a => a.project_id === opp.id).funds.some(f => f.subject_id === added.subject_id));

  await A('POST', `/api/energy/crm/fondi/${added.subject_id}/proponi`, { project: 'FV Atessa 4,8 MW' });
  const { rows: [after] } = await db.query('SELECT lead_stage, next_step FROM crm_subjects WHERE id = $1', [added.subject_id]);
  assert.deepEqual([after.lead_stage, after.next_step], ['contattato', 'Proporre Almacis come EPC per FV Atessa 4,8 MW']);
});

test('energivori: chi chiamare per primo (motivo e punteggio), risparmio stimato, approccia e non ora', async () => {
  await db.query(`INSERT INTO crm_energivori (name, city, region, sector, consumption_gwh, roof_m2) VALUES
    ('Cartiera Adriatica Spa', 'Pescara', 'Abruzzo', 'carta', 58, 22000), ('Vetreria del Sangro Srl', 'Chieti', 'Abruzzo', 'vetro', 31, 14500),
    ('Piccola Officina', 'Roma', 'Lazio', 'meccanica', 1.2, 800)`);
  assert.equal(await reasonForEnergivoro(db, { entity: 'Vetreria del Sangro', title: 'Diagnosi energetica entro dicembre', published_on: '2026-11-22', url: 'https://esempio.it/v' }), true);
  let d = (await A('GET', '/api/energy/crm/energivori')).body;
  assert.equal(d.top[0].name, 'Vetreria del Sangro Srl'); // il motivo per chiamare adesso viene prima
  assert.equal(d.top[0].reason, 'Diagnosi energetica entro dicembre');
  const cart = d.elenco.find(e => e.name === 'Cartiera Adriatica Spa');
  assert.equal(cart.saving, 137280);
  assert.ok(d.kpi.risparmio > 0 && d.kpi.totale === 3);

  const took = (await A('POST', `/api/energy/crm/energivori/${cart.id}/approccia`)).body;
  const o = (await A('GET', `/api/energy/opportunities/${took.opportunity_id}`)).body;
  assert.deepEqual([o.kind, o.stage, o.company_name], ['ppa_onsite', 'da_qualificare', 'Cartiera Adriatica Spa']);
  const a = (await A('GET', `/api/energy/analyses/${took.analysis_id}`)).body;
  assert.equal(a.project_type, 'ppa_onsite');
  const { rows: [s] } = await db.query('SELECT segment, asa FROM crm_subjects WHERE id = $1', [took.subject_id]);
  assert.deepEqual([s.segment, s.asa.includes('energy')], ['Azienda energivora', true]);
  assert.equal((await A('POST', `/api/energy/crm/energivori/${cart.id}/approccia`)).status, 400); // già approcciato

  const small = d.elenco.find(e => e.name === 'Piccola Officina');
  await A('POST', `/api/energy/crm/energivori/${small.id}/non-ora`);
  d = (await A('GET', '/api/energy/crm/energivori')).body;
  assert.ok(!d.top.some(e => e.id === small.id || e.id === cart.id));
  assert.equal(d.elenco.find(e => e.id === small.id).snoozed, true);
});
