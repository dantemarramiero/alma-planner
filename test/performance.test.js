// Alma Strategy · performance management: chi vede e modifica cosa (persona, responsabile, amministratore),
// valutazione in tre passi, obiettivi con approvazione del responsabile, mansionario proposta → conferma.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, L, X, ids = {};
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
  D = as(await login('dante.marramiero@almacis.it'));
  L = as(await login('luca.bianchi@almacis.it'));
  X = as(await login(ADMIN));
  for (const [k, who] of [['dante', D], ['luca', L], ['admin', X]]) ids[k] = (await who('GET', '/api/me')).body.id;
});

after(async () => {
  server?.close();
  await db?.close();
});

test('la scheda di Dante viene dal file: ruolo da CIO, 12 obiettivi con pesi a 100, valutazione in corso', async () => {
  const { body } = await D('GET', '/api/pm/person');
  assert.equal(body.role.title, 'CIO');
  assert.equal(body.role.responsibilities.length, 5);
  assert.equal(body.role.status, 'review'); // c'è una proposta da confermare
  assert.equal(body.objectives.length, 12);
  assert.equal(body.objectives.reduce((s, o) => s + o.weight, 0), 100);
  assert.ok(body.objectives.find(o => o.source === 'Hoshin Kanri').hk_kpi_id, 'collegato al KPI N di livello 0');
  assert.equal(body.review.status, 'manager');
  assert.equal(body.soft_skills.length, 8);
});

test('ognuno vede solo la sua scheda; il responsabile e l’amministratore anche quella degli altri', async () => {
  assert.equal((await L('GET', `/api/pm/person?user=${ids.dante}`)).status, 403);
  assert.equal((await X('GET', `/api/pm/person?user=${ids.dante}`)).status, 200);
  assert.equal((await L('GET', '/api/pm/admin/roles')).status, 403);
  assert.equal((await L('GET', '/api/pm/admin/team')).status, 403);
  // l'amministratore mette Dante responsabile di Luca: ora Dante vede Luca
  assert.equal((await X('PUT', `/api/pm/admin/profiles/${ids.luca}`, { manager_id: ids.dante, team: 'ICT' })).status, 200);
  assert.equal((await D('GET', `/api/pm/person?user=${ids.luca}`)).status, 200);
  assert.equal((await L('GET', `/api/pm/person?user=${ids.dante}`)).status, 403);
});

test('valutazione: la persona si autovaluta e invia, il responsabile valuta e chiude', async () => {
  // Luca si autovaluta; il voto del responsabile non lo può dare
  assert.equal((await L('PATCH', `/api/pm/reviews/${ids.luca}`, { self_scores: { 'Gestione dello stress': 4 } })).status, 200);
  assert.equal((await L('PATCH', `/api/pm/reviews/${ids.luca}`, { manager_scores: { 'Gestione dello stress': 5 } })).status, 403);
  assert.equal((await L('PATCH', `/api/pm/reviews/${ids.luca}`, { self_scores: { 'Gestione dello stress': 9 } })).status, 400);
  // il responsabile non può chiudere prima dell'invio
  assert.equal((await D('PATCH', `/api/pm/reviews/${ids.luca}`, { status: 'closed' })).status, 403);
  assert.equal((await L('PATCH', `/api/pm/reviews/${ids.luca}`, { status: 'manager' })).status, 200);
  // dopo l'invio l'autovalutazione non si cambia più
  assert.equal((await L('PATCH', `/api/pm/reviews/${ids.luca}`, { self_scores: { 'Gestione dello stress': 2 } })).status, 403);
  assert.equal((await D('PATCH', `/api/pm/reviews/${ids.luca}`, { manager_scores: { 'Gestione dello stress': 5 } })).status, 200);
  assert.equal((await D('PATCH', `/api/pm/reviews/${ids.luca}`, { status: 'closed' })).status, 200);
  const { body } = await D('GET', `/api/pm/person?user=${ids.luca}`);
  assert.equal(body.review.status, 'closed');
  assert.equal(body.review.self_scores['Gestione dello stress'], 4);
  assert.equal(body.review.manager_scores['Gestione dello stress'], 5);
});

test('obiettivi: la persona li scrive, solo il responsabile li approva', async () => {
  const o = await L('POST', '/api/pm/objectives', { objective: 'Ridurre i ticket aperti', weight: 30, target: '≤ 10' });
  assert.equal(o.status, 201);
  assert.equal((await L('PATCH', `/api/pm/objectives/${o.body.id}`, { achievement: 70, last_value: '13' })).body.achievement, 70);
  assert.equal((await L('PATCH', `/api/pm/objectives/${o.body.id}`, { approved: true })).status, 403);
  assert.equal((await D('PATCH', `/api/pm/objectives/${o.body.id}`, { approved: true })).body.approved, true);
  // chi non è né la persona né il responsabile non tocca
  assert.equal((await X('PATCH', `/api/pm/objectives/${o.body.id}`, { weight: 40 })).status, 200); // l'amministratore sì
  const stranger = as(await login('paolo.verdi@almacis.it'));
  assert.equal((await stranger('PATCH', `/api/pm/objectives/${o.body.id}`, { weight: 50 })).status, 403);
  assert.equal((await stranger('DELETE', `/api/pm/objectives/${o.body.id}`)).status, 403);
});

test('mansionario: la persona propone, l’amministratore conferma e la scheda mostra la versione confermata', async () => {
  const roles = (await X('GET', '/api/pm/admin/roles')).body;
  const cio = roles.find(r => r.title === 'CIO');
  assert.ok(roles.some(r => r.title === 'Responsabile Engineering' && r.status === 'missing'));
  // Luca non ha il ruolo di CIO: non può proporre
  assert.equal((await L('POST', `/api/pm/roles/${cio.id}/proposal`, { description: 'x' })).status, 403);
  assert.equal((await D('POST', `/api/pm/roles/${cio.id}/proposal`, { description: 'Guido l’IT di Almacis.', responsibilities: ['Strategia IT', 'Sicurezza'] })).status, 200);
  // finché non è confermata, la scheda mostra la versione in vigore
  let me = (await D('GET', '/api/pm/person')).body;
  assert.equal(me.role.status, 'review');
  assert.match(me.role.description, /^Come IT Manager/);
  assert.equal((await D('POST', `/api/pm/admin/roles/${cio.id}/confirm`, {})).status, 403);
  assert.equal((await X('POST', `/api/pm/admin/roles/${cio.id}/confirm`, { description: 'Guido l’IT di Almacis e la sua sicurezza.', responsibilities: ['Strategia IT', 'Sicurezza informatica', 'Crescita del team'] })).status, 200);
  me = (await D('GET', '/api/pm/person')).body;
  assert.equal(me.role.status, 'confirmed');
  assert.equal(me.role.description, 'Guido l’IT di Almacis e la sua sicurezza.');
  assert.deepEqual(me.role.responsibilities, ['Strategia IT', 'Sicurezza informatica', 'Crescita del team']);
  assert.equal(me.role.proposal, null);
  // al massimo 5 responsabilità
  assert.equal((await X('POST', `/api/pm/admin/roles/${cio.id}/confirm`, { responsibilities: ['1', '2', '3', '4', '5', '6'] })).status, 400);
});

test('la dashboard dei team: chi ha un profilo o degli obiettivi', async () => {
  const { body } = await X('GET', '/api/pm/admin/team');
  const names = body.people.map(p => p.name);
  assert.ok(names.includes('Dante Marramiero'));
  assert.ok(names.includes('Luca Bianchi'));
  assert.equal(body.people.find(p => p.name === 'Dante Marramiero').objectives.length, 12);
});
