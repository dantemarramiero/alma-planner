// Macro aree personali: ognuno ha le sue e ci mette i progetti che vede; nessun altro le vede o le cambia.
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
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const e of [ANNA, BRUNO, CARLO, CAPO]) await login(e);
});

after(async () => {
  server?.close();
  await db?.close();
});

test('macro aree: personali, progetto in macro aree diverse per persone diverse, cancellazione', async () => {
  const mine = (await api(ANNA, 'POST', '/api/areas', { name: 'Clienti', color: '#0057B8' })).body;
  assert.equal((await api(ANNA, 'POST', '/api/areas', { name: 'clienti' })).status, 400); // nome già usato da Anna
  const his = (await api(BRUNO, 'POST', '/api/areas', { name: 'Clienti' })).body; // Bruno può avere lo stesso nome
  assert.ok(mine.id && his.id && mine.id !== his.id);

  // ognuno vede solo le sue
  assert.deepEqual((await api(ANNA, 'GET', '/api/areas')).body.map(a => a.id), [mine.id]);
  assert.deepEqual((await api(BRUNO, 'GET', '/api/areas')).body.map(a => a.id), [his.id]);
  assert.equal((await api(BRUNO, 'PATCH', `/api/areas/${mine.id}`, { name: 'Mio' })).status, 404);
  assert.equal((await api(CAPO, 'DELETE', `/api/areas/${mine.id}`)).status, 404); // nemmeno l'amministratore

  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Campagna' })).body;
  // il progetto va solo in una macro area mia, e solo se vedo il progetto
  assert.equal((await api(ANNA, 'PUT', `/api/projects/${p.id}/area`, { area_id: his.id })).status, 404);
  assert.equal((await api(BRUNO, 'PUT', `/api/projects/${p.id}/area`, { area_id: his.id })).status, 404);
  assert.equal((await api(ANNA, 'PUT', `/api/projects/${p.id}/area`, { area_id: mine.id })).status, 200);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.area_id, mine.id);
  assert.equal((await api(ANNA, 'GET', '/api/areas')).body[0].project_count, 1);

  // Bruno, membro, lo mette nella sua: per Anna non cambia niente
  await api(ANNA, 'POST', `/api/projects/${p.id}/members`, { user_ids: [await idOf(BRUNO)] });
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}`)).body.area_id, null);
  assert.equal((await api(BRUNO, 'PUT', `/api/projects/${p.id}/area`, { area_id: his.id })).status, 200);
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}`)).body.area_id, his.id);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.area_id, mine.id);

  // toglierlo dalla macro area, e cancellando la macro area il progetto resta senza
  assert.equal((await api(BRUNO, 'PUT', `/api/projects/${p.id}/area`, { area_id: null })).status, 200);
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}`)).body.area_id, null);
  assert.equal((await api(ANNA, 'DELETE', `/api/areas/${mine.id}`)).status, 200);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).status, 200);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.area_id, null);
});

test('progetto Claude: solo indirizzi di claude.ai, e si può togliere', async () => {
  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Con Claude', claude_url: 'https://claude.ai/project/abc' })).body;
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.claude_url, 'https://claude.ai/project/abc');
  assert.equal((await api(ANNA, 'PATCH', `/api/projects/${p.id}`, { claude_url: 'https://altro.it/x' })).status, 400);
  assert.equal((await api(ANNA, 'PATCH', `/api/projects/${p.id}`, { claude_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await api(ANNA, 'PATCH', `/api/projects/${p.id}`, { claude_url: null })).status, 200);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.claude_url, null);
});
