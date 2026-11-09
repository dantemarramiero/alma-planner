// Alma Strategy: dati del 2026 caricati alla prima apertura, modifiche cella per cella, avanzamento dalle contromisure,
// collegamento dell'A3 al suo progetto di Alma Planner e contromisure ↔ ticket nei due versi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { matchUser } = require('../lib/strategy-sync');

let server, base, db, A, R, O;

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

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'dante.marramiero@almacis.it' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login('dante.marramiero@almacis.it');
  A = (method, path, body) => api(cookie, method, path, body);
  const rc = await login('roberto.della.valle@almacis.it'); // proprietario di «Gestione di commessa 2.0» (R. Della Valle)
  R = (method, path, body) => api(rc, method, path, body);
  const oc = await login('ospite.prova@almacis.it'); // nessun A3, non amministratore
  O = (method, path, body) => api(oc, method, path, body);
});

after(async () => {
  server?.close();
  await db?.close();
});

const year = async () => (await A('GET', '/api/strategy?year=2026')).body;
const seismic = d => d.projects.find(p => p.name === 'Tecnologie innovative per il monitoraggio sismico');

test('alla prima apertura c’è il 2026 del file: True North, 3 pillar, 11 KPI, 25 aree, gli A3', async () => {
  const d = await year();
  assert.match(d.true_north, /^Guidare la trasformazione/);
  assert.equal(d.pillars.length, 3);
  assert.equal(d.kpis.length, 11);
  assert.equal(d.areas.length, 25);
  const s = seismic(d);
  assert.equal(s.tasks.length, 7);
  assert.equal(s.tasks.reduce((sum, t) => sum + t.weight, 0), 100);
  // una seconda apertura non duplica niente
  assert.equal((await year()).pillars.length, 3);
});

test('Gestione: si modifica un campo alla volta, si aggiunge e si toglie', async () => {
  const d = await year();
  const k = d.kpis[0];
  const r = await A('PATCH', `/api/strategy/kpis/${k.id}`, { target: '≥ 70 M€', monthly: ['3,0', '6,6'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.target, '≥ 70 M€');
  assert.equal((await A('PATCH', `/api/strategy/pillars/${d.pillars[0].id}`, { color: 'giallo' })).status, 400);
  const added = await A('POST', '/api/strategy/kpis', { year: 2026, letter: 'Z', name: 'Prova' });
  assert.equal(added.status, 201);
  assert.equal((await A('DELETE', `/api/strategy/kpis/${added.body.id}`)).status, 200);
  assert.equal((await year()).kpis.length, 11);
});

test('l’A3 si collega al suo progetto con un ticket per contromisura, e chiudere l’uno chiude l’altra', async () => {
  let s = seismic(await year());
  const link = await A('POST', `/api/strategy/projects/${s.id}/link`);
  assert.equal(link.status, 200);
  const pid = link.body.project_id;
  // la seconda volta lo stesso progetto
  assert.equal((await A('POST', `/api/strategy/projects/${s.id}/link`)).body.project_id, pid);
  assert.equal((await A('GET', `/api/strategy/by-project/${pid}`)).body.id, s.id);
  const tickets = (await A('GET', `/api/tickets?project=${pid}`)).body;
  assert.equal(tickets.length, 7);
  assert.equal(tickets.filter(t => t.status === 'done').length, 3); // le tre già chiuse
  assert.ok(tickets.every(t => t.start_date && t.due_date), 'tutte con le date, per il Gantt');

  s = seismic(await year());
  const [t4, t5] = [s.tasks[3], s.tasks[4]];
  // ticket in «Fatto» → contromisura chiusa
  assert.equal((await A('PATCH', `/api/tickets/${t4.ticket_id}`, { status: 'done' })).status, 200);
  assert.ok(seismic(await year()).tasks[3].closed_date);
  // contromisura chiusa nell'A3 → ticket in «Fatto»; riaperta → di nuovo da fare
  await A('PATCH', `/api/strategy/tasks/${t5.id}`, { closed_date: '2026-11-09' });
  assert.equal((await A('GET', `/api/tickets/${t5.ticket_id}`)).body.status, 'done');
  await A('PATCH', `/api/strategy/tasks/${t5.id}`, { closed_date: null });
  assert.equal((await A('GET', `/api/tickets/${t5.ticket_id}`)).body.status, 'todo');
  // titolo e scadenza dal ticket all'A3
  await A('PATCH', `/api/tickets/${t5.ticket_id}`, { title: 'Accettazione firmata dal Committente', due_date: '2027-03-15' });
  const after5 = seismic(await year()).tasks[4];
  assert.equal(after5.activity, 'Accettazione firmata dal Committente');
  assert.equal(after5.due_date, '2027-03-15');
  // contromisura nuova → ticket nuovo; tolta → via anche il ticket
  const added = await A('POST', '/api/strategy/tasks', { project_id: s.id, activity: 'Verifica finale', weight: 0, due_date: '2027-10-15' });
  assert.ok(added.body.ticket_id);
  assert.equal((await A('GET', `/api/tickets?project=${pid}`)).body.length, 8);
  await A('DELETE', `/api/strategy/tasks/${added.body.id}`);
  assert.equal((await A('GET', `/api/tickets?project=${pid}`)).body.length, 7);
  // il nome dell'A3 diventa il nome del progetto
  await A('PATCH', `/api/strategy/projects/${s.id}`, { name: 'Monitoraggio sismico in fibra ottica' });
  assert.equal((await A('GET', '/api/projects')).body.find(p => p.id === pid).name, 'Monitoraggio sismico in fibra ottica');
});

test('chi è chi: «A. Erbivendolo» trova Antonio Erbivendolo, i nomi ambigui no', () => {
  const users = [{ id: 1, name: 'Antonio Erbivendolo' }, { id: 2, name: 'Dante Marramiero' }, { id: 3, name: 'Elisa Marramiero' }];
  assert.equal(matchUser(users, 'A. Erbivendolo'), 1);
  assert.equal(matchUser(users, 'antonio erbivendolo'), 1);
  assert.equal(matchUser(users, 'D. Marramiero'), 2);
  assert.equal(matchUser(users, 'Marramiero'), null);
  assert.equal(matchUser(users, ''), null);
});

test('permessi: la struttura la cambiano gli amministratori, un A3 il suo team; gli altri leggono', async () => {
  const d = (await O('GET', '/api/strategy?year=2026')).body;
  assert.equal(d.can_admin, false);
  assert.ok(d.projects.every(p => !p.can_edit), 'chi non ha A3 non ne modifica nessuno');
  // struttura: niente per chi non è amministratore
  assert.equal((await O('PATCH', `/api/strategy/kpis/${d.kpis[0].id}`, { target: 'x' })).status, 403);
  assert.equal((await O('POST', '/api/strategy/pillars', { year: 2026 })).status, 403);
  assert.equal((await O('PATCH', '/api/strategy/year', { year: 2026, true_north: 'x' })).status, 403);
  assert.equal((await O('POST', '/api/strategy/projects', { year: 2026 })).status, 403);
  // un A3 altrui: né i campi, né le contromisure, né il collegamento
  const comm = d.projects.find(p => p.name === 'Gestione di commessa 2.0');
  assert.equal((await O('PATCH', `/api/strategy/projects/${comm.id}`, { background: 'x' })).status, 403);
  assert.equal((await O('PATCH', `/api/strategy/tasks/${comm.tasks[0].id}`, { weight: 1 })).status, 403);
  assert.equal((await O('POST', '/api/strategy/tasks', { project_id: comm.id })).status, 403);
  assert.equal((await O('POST', `/api/strategy/projects/${comm.id}/link`)).status, 403);
  // il proprietario (per nome, finché l'A3 non è collegato) lo modifica e lo collega
  const mine = (await R('GET', '/api/strategy?year=2026')).body.projects.find(p => p.id === comm.id);
  assert.equal(mine.can_edit, true);
  assert.equal((await R('PATCH', `/api/strategy/projects/${comm.id}`, { background: 'Tre processi da rifare' })).status, 200);
  assert.equal((await R('POST', `/api/strategy/projects/${comm.id}/link`)).status, 200);
  // ora conta il progetto: Roberto ne è il responsabile, l'ospite no
  const after = (await R('GET', '/api/strategy?year=2026')).body.projects.find(p => p.id === comm.id);
  assert.equal(after.can_edit, true);
  assert.equal(after.project_visible, true);
  assert.equal((await R('PATCH', `/api/strategy/tasks/${after.tasks[0].id}`, { closed_date: '2026-11-09' })).status, 200);
  assert.equal((await O('GET', '/api/strategy?year=2026')).body.projects.find(p => p.id === comm.id).project_visible, false);
  // ma non la struttura, né eliminare l'A3
  assert.equal((await R('DELETE', `/api/strategy/projects/${comm.id}`)).status, 403);
  assert.equal((await R('PATCH', `/api/strategy/areas/${d.areas[0].id}`, { name: 'x' })).status, 403);
});

