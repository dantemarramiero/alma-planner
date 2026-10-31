// Alma Energy: accesso solo ai membri, CRM (aziende con tipi, persone in più aziende), opportunità con lo storico
// degli stadi, collegamenti con un ruolo e simulatore.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, A, T, X;
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
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
  A = as(await login('dante.marramiero@almacis.it')); // membro dalla migrazione
  T = as(await login('tullio@almacis.it'));
  X = as(await login(ADMIN)); // amministratore ma non della BU Energy
});

after(async () => {
  server?.close();
  await db?.close();
});

test('il modulo è solo dei membri: Dante entra, gli altri (anche gli amministratori) no finché non vengono aggiunti', async () => {
  assert.equal((await A('GET', '/api/energy')).status, 200);
  assert.equal((await A('GET', '/api/me')).body.energy, true);
  assert.equal((await T('GET', '/api/energy')).status, 403);
  assert.equal((await T('GET', '/api/me')).body.energy, false);
  assert.equal((await X('GET', '/api/energy/companies')).status, 403);
  assert.equal((await T('POST', '/api/energy/companies', { name: 'X' })).status, 403);

  assert.equal((await A('POST', '/api/energy/members', { email: 'Tullio@almacis.it' })).status, 201);
  assert.equal((await T('GET', '/api/energy')).status, 200);
  const { body } = await A('GET', '/api/energy');
  assert.deepEqual(body.members.map(m => m.email), ['dante.marramiero@almacis.it', 'tullio@almacis.it']);
  assert.ok(body.meta.stages.revamping.some(([k]) => k === 'due_diligence'));
  // non ci si toglie da soli
  assert.equal((await A('DELETE', '/api/energy/members/dante.marramiero@almacis.it')).status, 400);
});

let pilk, spv, studio;
test('aziende: tipi multipli, campi del tipo, filtro per tipo e doppioni di P.IVA', async () => {
  pilk = (await A('POST', '/api/energy/companies', {
    name: 'Pilkington Italia S.p.A.', vat: 'IT 01234567890', types: ['cliente'], city: 'San Salvo', province: 'Chieti', region: 'Abruzzo',
    extra: { consumi_mwh: '12.500', profilo_consumo: 'D1', mw_sviluppo: 5 }, source: 'Screening tetti',
  })).body;
  assert.equal(pilk.vat, '01234567890');
  assert.deepEqual(pilk.extra, { consumi_mwh: 12.5, profilo_consumo: 'D1' }); // mw_sviluppo non è un campo dei clienti
  assert.equal((await A('POST', '/api/energy/companies', { name: 'Doppione', vat: '01234567890' })).status, 409);
  assert.equal((await A('GET', '/api/energy/companies/check?vat=IT01234567890')).body.matches[0].id, pilk.id);

  const group = (await A('POST', '/api/energy/companies', { name: 'Enervita Group', types: ['proprietario', 'investitore'] })).body;
  spv = (await A('POST', '/api/energy/companies', { name: 'Enervitabio Santa Reparata', vat: '01130710955', types: ['proprietario'], group_id: group.id, extra: { convenzioni: 2 } })).body;
  studio = (await T('POST', '/api/energy/companies', { name: 'Studio Rossi Ingegneria', types: ['progettista', 'epc'], region: 'Abruzzo' })).body;
  assert.equal((await A('POST', '/api/energy/companies', { name: 'Tipo sbagliato', types: ['fornaio'] })).status, 400);

  const progettisti = (await A('GET', '/api/energy/companies?type=progettista')).body;
  assert.deepEqual(progettisti.companies.map(c => c.name), ['Studio Rossi Ingegneria']);
  assert.equal(progettisti.byType.proprietario, 2);
  assert.equal((await A('GET', '/api/energy/companies?q=reparata')).body.companies[0].group_name, 'Enervita Group');

  // togliendo un tipo spariscono i suoi campi
  const upd = (await A('PATCH', `/api/energy/companies/${group.id}`, { types: ['investitore'], extra: { ticket_min: '1000000', convenzioni: 4 } })).body;
  assert.deepEqual(upd.extra, { ticket_min: 1000000 });
  assert.equal((await A('PATCH', `/api/energy/companies/${group.id}`, { group_id: group.id })).status, 400);
  assert.equal((await A('GET', `/api/energy/companies/${group.id}`)).body.controlled[0].name, 'Enervitabio Santa Reparata');
});

let rossi;
test('persone: in più aziende con qualifiche diverse, opposizione al contatto', async () => {
  rossi = (await A('POST', '/api/energy/people', {
    first_name: 'Mario', last_name: 'Rossi', title: 'Ing.', influence: 'decisore', email: 'M.Rossi@studiorossi.it',
    companies: [{ company_id: studio.id, role: 'Titolare' }, { company_id: spv.id, role: 'Amministratore' }],
  })).body;
  assert.equal(rossi.email, 'm.rossi@studiorossi.it');
  const card = (await A('GET', `/api/energy/people/${rossi.id}`)).body;
  assert.deepEqual(card.companies.map(c => [c.name, c.role]), [['Enervitabio Santa Reparata', 'Amministratore'], ['Studio Rossi Ingegneria', 'Titolare']]);
  assert.equal((await A('GET', `/api/energy/companies/${studio.id}`)).body.people[0].role, 'Titolare');

  const bianchi = (await A('POST', '/api/energy/people', { last_name: 'Bianchi', opt_out: true, companies: [{ company_id: pilk.id, role: 'Energy manager' }] })).body;
  assert.equal((await A('GET', '/api/energy/people?type=cliente')).body.people[0].id, bianchi.id);
  assert.equal((await A('GET', '/api/energy/people?type=cliente&contactable=1')).body.people.length, 0);
  assert.equal((await A('GET', '/api/energy/people?q=mario rossi')).body.people[0].id, rossi.id);
  assert.equal((await A('POST', '/api/energy/people', { first_name: 'Senza cognome' })).status, 400);
});

test('opportunità: stadio iniziale del tipo, storico, «perso» con motivo, collegamenti con un ruolo dai due lati', async () => {
  const opp = (await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'Pilkington San Salvo', company_id: pilk.id, mw: 21.1, priority: 'A' })).body;
  assert.equal(opp.stage, 'da_qualificare');
  assert.equal((await A('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title: 'X', stage: 'due_diligence' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'target' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'primo_contatto', note: 'chiamato l\'energy manager' })).status, 200);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/stage`, { stage: 'perso' })).status, 400); // manca il motivo

  // collegamenti: l'azienda principale è già collegata come cliente
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, role: 'progettista' })).status, 201);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, role: 'progettista' })).status, 409);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { person_id: rossi.id, company_id: pilk.id, role: 'altro' })).status, 400);
  assert.equal((await A('POST', `/api/energy/opportunities/${opp.id}/links`, { company_id: studio.id, role: 'boh' })).status, 400);
  const card = (await A('GET', `/api/energy/opportunities/${opp.id}`)).body;
  assert.deepEqual(card.links.map(l => [l.company_name || l.last_name, l.role]), [['Pilkington Italia S.p.A.', 'cliente'], ['Rossi', 'progettista']]);
  assert.deepEqual(card.history.map(h => h.to_stage), ['primo_contatto', 'da_qualificare']);
  assert.equal((await A('GET', `/api/energy/people/${rossi.id}`)).body.opportunities[0].title, 'Pilkington San Salvo');
  const pc = (await A('GET', `/api/energy/companies/${pilk.id}`)).body;
  assert.deepEqual(pc.opportunities?.[0]?.roles, ['cliente'], JSON.stringify(pc));

  const rev = (await T('POST', '/api/energy/opportunities', { kind: 'revamping', title: 'Enervitabio (2 convenzioni)', company_id: spv.id, priority: 'A' })).body;
  assert.equal(rev.stage, 'da_analizzare');
  assert.equal((await T('POST', `/api/energy/opportunities/${rev.id}/stage`, { stage: 'perso', lost_reason: 'Non vende' })).body.lost_reason, 'Non vende');
  assert.equal((await A('GET', '/api/energy/opportunities?kind=revamping&stage=perso')).body.opportunities.length, 1);
  const byCompany = (await A('GET', `/api/energy/opportunities?company=${spv.id}`)).body;
  assert.equal(byCompany.opportunities?.[0]?.id, rev.id, JSON.stringify(byCompany));

  // cancellando un'azienda i collegamenti spariscono, l'opportunità resta
  await A('DELETE', `/api/energy/companies/${studio.id}`);
  assert.equal((await A('GET', `/api/energy/people/${rossi.id}`)).body.companies.length, 1);
});

test('simulatore: calcolo con le ipotesi del Modello fotovoltaico e input non validi', async () => {
  const r = (await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { sizeMw: 3.25, capex: { acquisto: 1375000, revamping: 975000 } }, sensitivity: true })).body;
  assert.ok(Math.abs(r.kpi.irrUnlevered - 0.12956) < 1e-4);
  assert.equal(r.rows.length, 31);
  assert.equal(r.sensitivity.prezzo.length, 5);
  assert.ok(Math.abs((await A('POST', '/api/energy/simulate', { model: 'brs', input: {} })).body.kpi.roe - 0.8052) < 1e-4);
  assert.equal((await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { capex: {} } })).status, 400);
  assert.equal((await A('POST', '/api/energy/simulate', { model: 'cashflows', input: { sizeMw: 'tanti' } })).status, 400);
  assert.equal((await X('POST', '/api/energy/simulate', { model: 'brs', input: {} })).status, 403);
});
