// App sul telefono e avvisi (11/11/2026): preferenze campanella/telefono/email, nuovo post, ticket assegnato,
// aggiornamento su un A3, notifiche push (mittente finto) e file dell'app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, ANNA, LUCA, anna, luca;
const pushed = [];

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
const kinds = async uid => (await db.query('SELECT kind, body FROM notifications WHERE user_id = $1 ORDER BY id', [uid])).rows;
const wait = () => new Promise(r => setTimeout(r, 150)); // gli avvisi partono dopo la risposta

before(async () => {
  db = await createDb({});
  const sender = async (sub, payload) => { pushed.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); };
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'dante@almacis.it' }), { db, pushSender: sender });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ANNA = as(await login('anna@almacis.it'));
  LUCA = as(await login('luca@almacis.it'));
  anna = (await ANNA('GET', '/api/me')).body;
  luca = (await LUCA('GET', '/api/me')).body;
});

after(async () => {
  server?.close();
  await db?.close();
});

test("file dell'app: manifest con il logo Almacis e service worker", async () => {
  const m = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  const man = await m.json();
  assert.equal(man.name, 'Alma Planet');
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some(i => i.src.split('?')[0] === '/brand/almacis/app-icon-512.png'));
  const mask = man.icons.find(i => i.purpose === 'maskable');
  assert.equal((await fetch(base + mask.src)).status, 200);
  assert.equal((await fetch(`${base}/brand/almacis/app-icon-180.png`)).status, 200);
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /showNotification/);
});

test('preferenze: valori di partenza (email dei post spenta), si cambiano e restano', async () => {
  const p = (await ANNA('GET', '/api/notifiche/preferenze')).body;
  assert.deepEqual(p.kinds.map(k => [k.kind, k.bell, k.push, k.email]),
    [['new_post', true, true, false], ['ticket_assigned', true, true, true], ['a3_update', true, true, true]]);
  assert.equal((await ANNA('PUT', '/api/notifiche/preferenze', { kinds: [{ kind: 'new_post', bell: false, push: true, email: false }] })).status, 200);
  assert.equal((await ANNA('GET', '/api/notifiche/preferenze')).body.kinds[0].bell, false);
  assert.equal((await ANNA('PUT', '/api/notifiche/preferenze', { kinds: [{ kind: 'altro' }] })).status, 400);
  // torna come prima
  await ANNA('PUT', '/api/notifiche/preferenze', { kinds: [{ kind: 'new_post', bell: true, push: true, email: false }] });
});

test('telefono: chiave pubblica, iscrizione, prova; nuovo post e ticket assegnato arrivano in campanella e sul telefono', async () => {
  const key = (await ANNA('GET', '/api/push/key')).body.key;
  assert.match(key, /^[A-Za-z0-9_-]{60,}$/);
  assert.equal((await ANNA('GET', '/api/push/key')).body.key, key); // le chiavi si creano una volta sola
  const { rows: [vap] } = await db.query("SELECT value::text AS v FROM settings WHERE key = 'planet.vapid'");
  assert.ok(vap && !/"private":"[A-Za-z0-9_-]{40,}"/.test(vap.v)); // la privata è cifrata
  assert.equal((await ANNA('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://non-https', keys: {} } })).status, 400);
  const sub = { endpoint: 'https://push.example/anna-1', keys: { p256dh: 'BPx', auth: 'au' } };
  assert.equal((await ANNA('POST', '/api/push/subscribe', { subscription: sub, device: 'iPhone (app)' })).status, 201);
  assert.equal((await ANNA('POST', '/api/push/test', {})).status, 200);
  assert.equal(pushed.at(-1).title, 'Alma Planet');

  // nuovo post di Luca: Anna lo sa in campanella e sul telefono
  pushed.length = 0;
  const post = (await LUCA('POST', '/api/posts', { body: 'Getto del solaio a Pescara' })).body;
  await wait();
  assert.ok((await kinds(anna.id)).some(n => n.kind === 'new_post' && n.body.includes('Getto del solaio')));
  assert.deepEqual(pushed.map(p => [p.endpoint, p.url]), [['https://push.example/anna-1', `/app#/p/${post.id}`]]);

  // Anna non vuole i post sul telefono: arriva solo in campanella
  await ANNA('PUT', '/api/notifiche/preferenze', { kinds: [{ kind: 'new_post', bell: true, push: false, email: false }] });
  pushed.length = 0;
  await LUCA('POST', '/api/posts', { body: 'Secondo post' });
  await wait();
  assert.equal(pushed.length, 0);

  // ticket assegnato da Luca ad Anna
  pushed.length = 0;
  const t = (await LUCA('POST', '/api/tickets', { title: 'Verifica computo', assignee_ids: [anna.id] })).body;
  await wait();
  assert.ok((await kinds(anna.id)).some(n => n.kind === 'ticket_assigned' && n.body === 'ti ha assegnato un ticket: «Verifica computo»'));
  assert.equal(pushed.at(-1).url, `/app#/tickets/${t.id}`);
});

test('A3: contromisura chiusa → avviso a chi è nel progetto dell\'A3, al massimo uno ogni 30 minuti', async () => {
  // A3 collegato a un progetto di cui Anna è responsabile e Luca membro
  const { rows: [y] } = await db.query("INSERT INTO hk_years (year) VALUES (2026) ON CONFLICT (year) DO UPDATE SET year = EXCLUDED.year RETURNING year");
  const { rows: [prj] } = await db.query("INSERT INTO projects (name, owner_id) VALUES ('A3 Reti', $1) RETURNING id", [anna.id]);
  await db.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [prj.id, luca.id]);
  const { rows: [hk] } = await db.query("INSERT INTO hk_projects (year, name, project_id) VALUES ($1, 'Rapportini digitali', $2) RETURNING id", [y.year, prj.id]);
  const { rows: [task] } = await db.query("INSERT INTO hk_tasks (project_id, activity, weight) VALUES ($1, 'Tappa 3', 20) RETURNING id", [hk.id]);

  pushed.length = 0;
  assert.equal((await LUCA('PATCH', `/api/strategy/tasks/${task.id}`, { closed_date: '2026-11-10' })).status, 200);
  await wait();
  const a = (await kinds(anna.id)).filter(n => n.kind === 'a3_update');
  assert.equal(a.length, 1);
  assert.match(a[0].body, /«Rapportini digitali»: contromisura «Tappa 3» chiusa/);
  assert.ok(pushed.some(p => p.url === `/app#/strategy/a3/${hk.id}`));
  // una seconda modifica subito dopo non manda un altro avviso
  await LUCA('PATCH', `/api/strategy/tasks/${task.id}`, { due_date: '2026-11-20' });
  await wait();
  assert.equal((await kinds(anna.id)).filter(n => n.kind === 'a3_update').length, 1);
  // chi modifica non riceve il suo avviso
  assert.equal((await kinds(luca.id)).filter(n => n.kind === 'a3_update').length, 0);
});
