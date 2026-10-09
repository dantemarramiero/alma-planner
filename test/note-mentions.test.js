// @menzioni nelle note: notifica a chi viene taggato, solo se vede il progetto o il ticket; nelle modifiche solo ai nuovi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db;
const cookies = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie').split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: cookies[who], 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const idOf = async who => (await api(who, 'GET', '/api/me')).body.id;

const ANNA = 'anna@almacis.it', BRUNO = 'bruno@almacis.it', CARLO = 'carlo@almacis.it', CAPO = 'capo@almacis.it';

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: CAPO }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000; // più lungo di quello di fetch (undici, ~4 s): sotto carico il server chiudeva una connessione mentre veniva riusata (ECONNRESET)
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const e of [ANNA, BRUNO, CARLO, CAPO]) await login(e);
});

after(async () => {
  server?.close();
  await db?.close();
});

const notifs = async who => (await api(who, 'GET', '/api/notifications')).body.filter(n => n.kind === 'note_mention');

test('menzioni nelle note: notifica a chi vede la nota, avviso per chi non la vede, niente doppioni', async () => {
  const bruno = await idOf(BRUNO);
  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Con note' })).body;
  await api(ANNA, 'POST', `/api/projects/${p.id}/members`, { user_ids: [bruno] });

  // Bruno è membro: notificato; Carlo non vede il progetto: niente notifica, e chi scrive lo sa
  const n = (await api(ANNA, 'POST', `/api/projects/${p.id}/notes`, { body: 'Chiamata col cliente: @bruno e @carlo, e anche @anna' })).body;
  assert.deepEqual(n.mentions.notified, [bruno]);
  assert.deepEqual(n.mentions.cannot_see, [await idOf(CARLO)]);
  const nb = await notifs(BRUNO);
  assert.equal(nb.length, 1);
  assert.equal(nb[0].note_project_id, p.id);
  assert.match(nb[0].note_body, /Chiamata col cliente/);
  assert.equal((await notifs(CARLO)).length, 0);
  assert.equal((await notifs(ANNA)).length, 0); // non a sé stessi
  assert.equal((await api(BRUNO, 'GET', '/api/badges')).body.notifications >= 1, true);

  // modificando, chi era già menzionato non riceve un'altra notifica; l'amministratore aggiunto sì (vede tutto)
  const e = (await api(ANNA, 'PATCH', `/api/notes/${n.id}`, { body: 'Chiamata col cliente: @bruno, @capo' })).body;
  assert.deepEqual(e.mentions.notified, [await idOf(CAPO)]);
  assert.equal((await notifs(BRUNO)).length, 1);
  assert.equal((await notifs(CAPO)).length, 1);

  // nota eliminata: la notifica sparisce
  await api(ANNA, 'DELETE', `/api/notes/${n.id}`);
  assert.equal((await notifs(BRUNO)).length, 0);
});

test('menzioni nelle note di un ticket: notifica a chi vede il ticket', async () => {
  const t = (await api(ANNA, 'POST', '/api/tickets', { title: 'Senza progetto' })).body; // senza progetto lo vedono tutti
  const n = (await api(ANNA, 'POST', `/api/tickets/${t.id}/notes`, { body: 'ci pensa @carlo' })).body;
  assert.deepEqual(n.mentions.notified, [await idOf(CARLO)]);
  const nc = await notifs(CARLO);
  assert.equal(nc[0].note_ticket_id, t.id);
});
