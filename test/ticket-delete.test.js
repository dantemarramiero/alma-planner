// Cancellare un ticket: solo chi l'ha creato; un ticket senza autore lo cancella un amministratore.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db;
const users = {};

async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of [['anna', 'anna@almacis.it'], ['luca', 'luca@almacis.it'], ['capo', 'capo@almacis.it']]) {
    const r = await fetch(`${base}/auth/dev-login?email=${e}`, { redirect: 'manual' });
    users[k] = { cookie: r.headers.get('set-cookie').split(';')[0] };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  server?.close();
  await db?.close();
});

test('solo chi ha creato il ticket lo cancella, anche se gli altri lo vedono o ne sono assegnatari', async () => {
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Report mensile', assignee_ids: [users.luca.id] })).body;
  assert.equal(t.created_by, users.anna.id);

  const no = await api('luca', 'DELETE', `/api/tickets/${t.id}`);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /solo chi l'ha creato/);
  // nemmeno un amministratore cancella il ticket di un altro
  assert.equal((await api('capo', 'DELETE', `/api/tickets/${t.id}`)).status, 403);
  assert.equal((await api('luca', 'GET', `/api/tickets/${t.id}`)).status, 200);

  assert.equal((await api('anna', 'DELETE', `/api/tickets/${t.id}`)).status, 200);
  assert.equal((await api('anna', 'GET', `/api/tickets/${t.id}`)).status, 404);
});

test('un ticket senza autore (persona uscita) lo cancella solo un amministratore', async () => {
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Ticket orfano' })).body;
  await db.query('UPDATE tickets SET created_by = NULL WHERE id = $1', [t.id]);
  assert.equal((await api('anna', 'DELETE', `/api/tickets/${t.id}`)).status, 403);
  assert.equal((await api('luca', 'DELETE', `/api/tickets/${t.id}`)).status, 403);
  assert.equal((await api('capo', 'DELETE', `/api/tickets/${t.id}`)).status, 200);
});
