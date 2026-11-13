// App 2.0 sul telefono (13/11/2026): numero «da decidere» dell'Inbox, aggiornamento del mese di un A3,
// opportunità di Alma Energy vicino a me.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, ANNA, LUCA, DANTE, anna, luca;

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
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'dante@almacis.it' }), { db, pushSender: async () => {} });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ANNA = as(await login('anna@almacis.it'));
  LUCA = as(await login('luca@almacis.it'));
  DANTE = as(await login('dante.marramiero@almacis.it')); // della BU Energy
  anna = (await ANNA('GET', '/api/me')).body;
  luca = (await LUCA('GET', '/api/me')).body;
});

after(async () => {
  server?.close();
  await db?.close();
});

test('Inbox: il numero «da decidere» conta gli inviti agli A3', async () => {
  assert.equal((await ANNA('GET', '/api/badges')).body.decide, 0);
  await db.query("INSERT INTO hk_years (year) VALUES (2026) ON CONFLICT (year) DO NOTHING");
  const { rows: [hk] } = await db.query("INSERT INTO hk_projects (year, name) VALUES (2026, 'Invito') RETURNING id");
  await db.query("INSERT INTO hk_invites (hk_project_id, user_id, invited_by, status) VALUES ($1, $2, $3, 'pending')", [hk.id, anna.id, luca.id]);
  assert.equal((await ANNA('GET', '/api/badges')).body.decide, 1);
});

test('A3: aggiornamento del mese solo da chi è nel progetto, poi lo vedono tutti', async () => {
  const { rows: [prj] } = await db.query("INSERT INTO projects (name, owner_id) VALUES ('A3 Mese', $1) RETURNING id", [anna.id]);
  const { rows: [hk] } = await db.query("INSERT INTO hk_projects (year, name, project_id) VALUES (2026, 'Rapportini', $1) RETURNING id", [prj.id]);
  assert.equal((await LUCA('POST', `/api/strategy/projects/${hk.id}/checkins`, { status: 'in_linea' })).status, 403);
  assert.equal((await ANNA('POST', `/api/strategy/projects/${hk.id}/checkins`, { status: 'boh' })).status, 400);
  assert.equal((await ANNA('POST', `/api/strategy/projects/${hk.id}/checkins`, { status: 'a_rischio', note: 'Manca il fornitore' })).status, 201);
  const list = (await LUCA('GET', `/api/strategy/projects/${hk.id}/checkins`)).body;
  assert.deepEqual(list.map(c => [c.status, c.note, c.user_id]), [['a_rischio', 'Manca il fornitore', anna.id]]);
});

test('Energy: vicino a me, dal più vicino, entro i km chiesti', async () => {
  const mk = (title, lat, lon) => DANTE('POST', '/api/energy/opportunities', { kind: 'ppa_onsite', title, lat, lon });
  await mk('Lontano Milano', 45.46, 9.19);
  await mk('Vicino 2', 42.43, 14.17);
  await mk('Vicino 1', 42.455, 14.19);
  await mk('Senza coordinate');
  const r = await DANTE('GET', '/api/energy/opportunities?near=42.46,14.21&km=25');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.opportunities.map(o => o.title), ['Vicino 1', 'Vicino 2']);
  assert.ok(r.body.opportunities[0].km < r.body.opportunities[1].km);
  assert.equal((await DANTE('GET', '/api/energy/opportunities?near=abc')).status, 400);
});
