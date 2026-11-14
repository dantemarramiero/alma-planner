// Lavoro commerciale del CRM: prossimi passi, key account, «La mia settimana», impostazioni modificabili dall'app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E, F, crmSync;
const ADMIN = 'direzione@almacis.it';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [] });
  crmSync = out.crmSync;
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  F = as(await login('facility@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

const meId = async who => (await who('GET', '/api/me')).body.id ?? (await who('GET', '/api/me')).body.user?.id;

test('prossimi passi: più d\'uno, il primo aperto resta sulla scheda; «Fatto» con il passo dopo; avviso se scade', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Logistica Sud', roles: ['lead'], asa: ['edilizia'] })).body;
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: '' , due_date: plus(1) })).status, 400);
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Chiamare' })).status, 400);
  const a = await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Mandare referenze', due_date: plus(5), channel: 'email' });
  assert.equal(a.status, 201);
  const b = (await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Chiamare l\'ufficio tecnico', due_date: plus(-2), channel: 'telefonata' })).body;
  let sub = (await E('GET', `/api/crm/subjects/${s.id}`)).body;
  assert.equal(sub.next_step, 'Chiamare l\'ufficio tecnico'); // il primo per data
  assert.equal(sub.next_step_date, plus(-2));
  // scaduto: avviso una volta sola a chi lo deve fare (l'owner dell'azienda)
  assert.equal(await crmSync.stepTick(), 1);
  assert.equal(await crmSync.stepTick(), 0);
  const { rows } = await db.query("SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = 'edile@almacis.it' AND n.kind = 'crm'");
  assert.ok(rows.some(r => /Chiamare l'ufficio tecnico/.test(r.body) && r.link === `/crm/scheda/${s.id}`));
  // fatto, con esito e passo dopo
  const done = await E('POST', `/api/crm/steps/${b.id}/done`, { outcome: 'Interessati', next: { title: 'Sopralluogo', due_date: plus(3) } });
  assert.equal(done.status, 200);
  assert.equal(done.body.next.title, 'Sopralluogo');
  sub = (await E('GET', `/api/crm/subjects/${s.id}`)).body;
  assert.equal(sub.next_step, 'Sopralluogo');
  const steps = (await E('GET', `/api/crm/subjects/${s.id}/steps`)).body;
  assert.equal(steps.open.length, 2);
  assert.equal(steps.done[0].outcome, 'Interessati');
  // spostato in avanti, poi cancellato
  assert.equal((await E('PATCH', `/api/crm/steps/${a.body.id}`, { due_date: plus(1) })).status, 200);
  assert.equal((await E('GET', `/api/crm/subjects/${s.id}`)).body.next_step, 'Mandare referenze');
  assert.equal((await E('DELETE', `/api/crm/steps/${a.body.id}`)).status, 200);
  assert.equal((await E('GET', `/api/crm/subjects/${s.id}`)).body.next_step, 'Sopralluogo');
});

test('La mia settimana: passi miei, lead senza passo, key account non sentiti oltre il ritmo', async () => {
  const lead = (await E('POST', '/api/crm/subjects', { name: 'Senza Passo Srl', roles: ['lead'], asa: ['edilizia'] })).body;
  const key = (await E('POST', '/api/crm/subjects', { name: 'Cliente Chiave Spa', roles: ['cliente'], asa: ['edilizia'] })).body;
  assert.equal((await E('POST', `/api/crm/subjects/${key.id}/key-account`, { key_account: true, key_rhythm_days: 7 })).status, 200);
  assert.equal((await E('POST', `/api/crm/subjects/${key.id}/key-account`, { key_account: true, key_rhythm_days: 6 })).status, 400);
  const w = (await E('GET', '/api/crm/settimana')).body;
  assert.ok(w.steps.some(x => x.title === 'Sopralluogo'));
  assert.ok(w.leadsWithoutStep.list.some(x => x.id === lead.id));
  assert.ok(!w.leadsWithoutStep.list.some(x => x.name === 'Logistica Sud'));
  assert.ok(w.keyAccounts.silent.some(x => x.id === key.id && x.days === null)); // mai sentito
  // una nota di oggi: sentito, sparisce
  assert.equal((await E('POST', `/api/crm/subjects/${key.id}/notes`, { body: 'Telefonata con il direttore' })).status, 201);
  assert.ok(!(await E('GET', '/api/crm/settimana')).body.keyAccounts.silent.some(x => x.id === key.id));
  // la settimana di un altro la guarda solo la direzione
  const fid = await meId(F);
  assert.equal((await E('GET', `/api/crm/settimana?user=${fid}`)).status, 403);
  assert.equal((await D('GET', `/api/crm/settimana?user=${fid}`)).status, 200);
});

test('impostazioni: valori di partenza del doc, le cambia solo la direzione, controlli sui pesi e sulle quote', async () => {
  const s = (await E('GET', '/api/crm/commerciale')).body;
  assert.equal(s.settings.radar.budget_eur, 200);
  assert.deepEqual(Object.entries(s.settings.radar.bu).filter(([, b]) => b.on).map(([k]) => k).sort(), ['facility', 'restauro', 'reti_ap']);
  assert.equal(s.settings.profiles.reti_ap.manager_name, 'Simone Recchia');
  assert.ok(s.settings.profiles.edilizia.clients.some(c => c.name === 'Cliente Chiave Spa')); // clienti dalle anagrafiche, non scritti a mano
  assert.equal(s.settings.scoring.weights.fit, 35);
  assert.equal((await E('PUT', '/api/crm/commerciale/scoring', { value: s.settings.scoring })).status, 403);
  assert.equal((await D('PUT', '/api/crm/commerciale/scoring', { value: { weights: { fit: 40, concreteness: 25, timing: 15, relationship: 15, value: 10 }, min: 50, highlight: 70 } })).status, 400);
  const ok = await D('PUT', '/api/crm/commerciale/scoring', { value: { weights: { fit: 40, concreteness: 20, timing: 15, relationship: 15, value: 10 }, min: 55, highlight: 75 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.scoring.min, 55);
  // quote oltre il budget: no
  const radar = structuredClone(s.settings.radar);
  radar.bu.edilizia = { on: true, quota_eur: 150 };
  assert.equal((await D('PUT', '/api/crm/commerciale/radar', { value: radar })).status, 400);
  radar.budget_eur = 400;
  const r = await D('PUT', '/api/crm/commerciale/radar', { value: radar });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.radar.bu.edilizia.on, true);
  // profilo di una BU: il responsabile scelto tra le persone; le altre BU restano com'erano
  const eid = await meId(E);
  const prof = { ...s.settings.profiles.edilizia, manager_id: eid, keywords: ['capannone'] };
  const p = await D('PUT', '/api/crm/commerciale/profiles', { value: { edilizia: prof } });
  assert.equal(p.status, 200);
  assert.equal(p.body.settings.profiles.edilizia.manager.id, eid);
  assert.equal(p.body.settings.profiles.reti_ap.manager_name, 'Simone Recchia');
  assert.deepEqual((await E('GET', '/api/crm/settimana')).body.bus, ['edilizia']);
  // Go/No-Go: pesi a 100; playbook con almeno un passo; torna ai valori di partenza
  const rules = structuredClone(s.settings.rules);
  rules.gonogo_questions[0].weight = 50;
  assert.equal((await D('PUT', '/api/crm/commerciale/rules', { value: rules })).status, 400);
  assert.equal((await D('PUT', '/api/crm/commerciale/playbooks', { value: [{ name: 'Vuoto', steps: [] }] })).status, 400);
  assert.equal((await D('PUT', '/api/crm/commerciale/playbooks', { value: [{ name: 'Nuovo stabilimento', bu: ['impianti'], steps: ['Chiamare', 'Incontro'], check: 'Trattativa?' }] })).body.settings.playbooks[0].id, 'nuovo_stabilimento');
  assert.equal((await D('DELETE', '/api/crm/commerciale/scoring')).body.settings.scoring.min, 50);
});
