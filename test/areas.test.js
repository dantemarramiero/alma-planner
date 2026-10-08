// Macro aree: raggruppano i progetti; il conteggio segue la visibilità dei progetti, le cambia chi le ha create o un amministratore.
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

test('macro aree: creazione, progetti dentro, conteggi per chi vede, permessi, cancellazione', async () => {
  const area = (await api(ANNA, 'POST', '/api/areas', { name: 'Marketing', color: '#0057B8' })).body;
  assert.ok(area.id);
  assert.equal((await api(BRUNO, 'POST', '/api/areas', { name: 'marketing' })).status, 400); // nome già usato

  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Campagna', area_id: area.id })).body;
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.area_id, area.id);
  assert.equal((await api(ANNA, 'POST', '/api/projects', { name: 'X', area_id: 99999 })).status, 400);

  // tutti vedono la macro area, ma contano solo i progetti che vedono
  const of = async who => (await api(who, 'GET', '/api/areas')).body.find(a => a.id === area.id);
  assert.equal((await of(ANNA)).project_count, 1);
  assert.equal((await of(BRUNO)).project_count, 0);
  assert.equal((await of(CAPO)).project_count, 1);
  assert.equal((await of(ANNA)).can_edit, true);
  assert.equal((await of(BRUNO)).can_edit, false);
  assert.equal((await of(CAPO)).can_edit, true);

  // solo chi l'ha creata (o un amministratore) la cambia
  assert.equal((await api(BRUNO, 'PATCH', `/api/areas/${area.id}`, { name: 'Mio' })).status, 403);
  assert.equal((await api(CAPO, 'PATCH', `/api/areas/${area.id}`, { name: 'Comunicazione' })).status, 200);
  assert.equal((await of(ANNA)).name, 'Comunicazione');

  // un membro non sposta il progetto in un'altra macro area: lo fa il responsabile
  await api(ANNA, 'POST', `/api/projects/${p.id}/members`, { user_ids: [await idOf(BRUNO)] });
  assert.equal((await api(BRUNO, 'PATCH', `/api/projects/${p.id}`, { area_id: null })).status, 403);
  assert.equal((await of(BRUNO)).project_count, 1);

  // cancellando la macro area il progetto resta, senza macro area
  assert.equal((await api(BRUNO, 'DELETE', `/api/areas/${area.id}`)).status, 403);
  assert.equal((await api(ANNA, 'DELETE', `/api/areas/${area.id}`)).status, 200);
  assert.equal((await api(ANNA, 'GET', `/api/projects/${p.id}`)).body.area_id, null);
  assert.equal(await of(ANNA), undefined);
});
