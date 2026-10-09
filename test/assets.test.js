// I file dell'interfaccia arrivano da /b/<deploy>/ così un browser non riusa JS vecchi dopo un aggiornamento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, cookie;

before(async () => {
  process.env.RAILWAY_DEPLOYMENT_ID = 'dep-abc123';
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000; // più lungo di quello di fetch (undici, ~4 s): sotto carico il server chiudeva una connessione mentre veniva riusata (ECONNRESET)
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login`, { redirect: 'manual' });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  server?.close();
  await db?.close();
});

test('la pagina punta a JS e CSS del deploy corrente, che arrivano', async () => {
  const html = await (await fetch(`${base}/app`, { headers: { cookie } })).text();
  assert.match(html, /src="\/b\/dep-abc123\/js\/main\.js"/);
  assert.match(html, /href="\/b\/dep-abc123\/css\/app\.css"/);
  assert.doesNotMatch(html, /src="\/js\//);
  const js = await fetch(`${base}/b/dep-abc123/js/main.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  // un deploy vecchio (scheda aperta prima dell'aggiornamento) riceve comunque i file, da ricontrollare
  const old = await fetch(`${base}/b/dep-vecchio/js/gantt.js`);
  assert.equal(old.status, 200);
  assert.equal(old.headers.get('cache-control'), 'no-cache');
});
