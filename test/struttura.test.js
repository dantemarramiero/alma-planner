// Nuova struttura (10/11/2026): pagina unica dei Ticket con «Creati da me», Bacheca con i filtri
// «Grazie a…» e «Del mio reparto» (il reparto viene dall'organigramma di Microsoft).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, ANNA, LUCA, SARA;

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.exec(`INSERT INTO org_people (oid, name, email, department) VALUES
    ('o-anna', 'Anna', 'anna@almacis.it', 'Cantieri'), ('o-luca', 'Luca', 'luca@almacis.it', 'Cantieri'), ('o-sara', 'Sara', 'sara@almacis.it', 'Amministrazione')`);
  ANNA = as(await login('anna@almacis.it'));
  LUCA = as(await login('luca@almacis.it'));
  SARA = as(await login('sara@almacis.it'));
});

after(async () => {
  server?.close();
  await db?.close();
});

test('ticket: «Creati da me» mostra quelli che ho aperto, anche se assegnati ad altri', async () => {
  const luca = (await LUCA('GET', '/api/me')).body;
  await ANNA('POST', '/api/tickets', { title: 'Per Luca', assignee_ids: [luca.id] });
  await LUCA('POST', '/api/tickets', { title: 'Di Luca', assignee_ids: [luca.id] });
  const mine = (await ANNA('GET', '/api/tickets?creator=me')).body.map(t => t.title);
  assert.deepEqual(mine, ['Per Luca']);
  const assigned = (await LUCA('GET', '/api/tickets?assignee=me')).body.map(t => t.title).sort();
  assert.deepEqual(assigned, ['Di Luca', 'Per Luca']);
});

test('bacheca: «Del mio reparto» mostra solo i post dei colleghi dello stesso reparto; filtro sconosciuto rifiutato', async () => {
  await LUCA('POST', '/api/posts', { body: 'Foto dal cantiere' });
  await SARA('POST', '/api/posts', { body: 'Chiusura del mese' });
  const reparto = (await ANNA('GET', '/api/feed?filter=reparto')).body;
  assert.deepEqual(reparto.posts.map(p => p.body), ['Foto dal cantiere']);
  assert.deepEqual(reparto.pinned, []);
  assert.equal((await ANNA('GET', '/api/feed?filter=grazie')).body.posts.length, 0);
  assert.equal((await ANNA('GET', '/api/feed?filter=altro')).status, 400);
  assert.equal((await ANNA('GET', '/api/feed')).body.posts.length, 2);
});
