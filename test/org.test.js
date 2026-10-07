// Organigramma: lettura dei dati salvati, conteggio ticket per persona, filtro delle persone vere.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { isPerson } = require('../routes/org');

let server, base, db, cookie;

async function api(method, path, body) {
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
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=dante@almacis.it`, { redirect: 'manual' });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  server?.close();
  await db?.close();
});

test('solo persone vere: niente ospiti, account disattivati o senza posta', () => {
  assert.equal(isPerson({ accountEnabled: true, userType: 'Member', mail: 'a@almacis.it' }), true);
  assert.equal(isPerson({ accountEnabled: true, userType: 'Guest', mail: 'x@esterno.it' }), false);
  assert.equal(isPerson({ accountEnabled: false, userType: 'Member', mail: 'b@almacis.it' }), false);
  assert.equal(isPerson({ accountEnabled: true, userType: 'Member', mail: null }), false);
});

test('organigramma: persone con responsabile e ticket aperti di chi usa Alma Planner', async () => {
  const empty = (await api('GET', '/api/org')).body;
  assert.deepEqual(empty, { people: [], sync: null });

  await db.exec(`
    INSERT INTO org_people (oid, name, email, job_title, department, manager_oid) VALUES
      ('ceo', 'Anna Capo', 'anna@almacis.it', 'Amministratore delegato', 'Direzione', NULL),
      ('d1', 'Dante', 'dante@almacis.it', 'Responsabile IT', 'IT', 'ceo'),
      ('m1', 'Marco Tecnico', 'marco@almacis.it', 'Tecnico', 'IT', 'd1');`);
  const me = (await api('GET', '/api/me')).body;
  const done = (await api('POST', '/api/tickets', { title: 'Chiuso', assignee_ids: [me.id], status: 'done' })).body;
  await api('POST', '/api/tickets', { title: 'Aperto', assignee_ids: [me.id] });
  assert.equal(done.status, 'done');

  const { people } = (await api('GET', '/api/org')).body;
  assert.deepEqual(people.map(p => [p.name, p.manager_oid]), [['Anna Capo', null], ['Dante', 'ceo'], ['Marco Tecnico', 'd1']]);
  const dante = people.find(p => p.oid === 'd1');
  assert.equal(dante.user_id, me.id); // collegato all'account di Alma Planner per email
  assert.equal(dante.open_tickets, 1);
  assert.equal(people.find(p => p.oid === 'm1').user_id, null);
});

test('senza Microsoft configurato la lettura da Microsoft risponde 503', async () => {
  const r = await api('POST', '/api/org/sync', {});
  assert.equal(r.status, 503);
});
