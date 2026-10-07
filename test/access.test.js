// Membri dei progetti: ognuno vede solo i progetti suoi o dove è stato invitato; gli amministratori vedono tutto.
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

test('un progetto lo vedono solo responsabile, membri e amministratori; i membri li gestisce il responsabile', async () => {
  const [bruno, carlo] = [await idOf(BRUNO), await idOf(CARLO)];
  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Riservato' })).body;
  const t = (await api(ANNA, 'POST', '/api/tickets', { title: 'Interno', project_id: p.id })).body;
  const loose = (await api(ANNA, 'POST', '/api/tickets', { title: 'Senza progetto' })).body;

  // Bruno non vede niente del progetto (404, come se non esistesse) ma vede i ticket senza progetto
  assert.deepEqual((await api(BRUNO, 'GET', '/api/projects')).body.map(x => x.id), []);
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}`)).status, 404);
  assert.equal((await api(BRUNO, 'GET', `/api/tickets/${t.id}`)).status, 404);
  assert.equal((await api(BRUNO, 'PATCH', `/api/tickets/${t.id}`, { title: 'x' })).status, 404);
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}/files`)).status, 404);
  assert.equal((await api(BRUNO, 'POST', '/api/tickets', { title: 'Infiltrato', project_id: p.id })).status, 404);
  const brunoTickets = (await api(BRUNO, 'GET', '/api/tickets')).body.map(x => x.id);
  assert.ok(brunoTickets.includes(loose.id) && !brunoTickets.includes(t.id));

  // l'amministratore vede tutto
  assert.ok((await api(CAPO, 'GET', '/api/projects')).body.some(x => x.id === p.id && x.my_role === 'admin'));
  assert.equal((await api(CAPO, 'GET', `/api/tickets/${t.id}`)).status, 200);

  // Anna invita Bruno: ora lo vede, da membro; non può gestire i membri né modificare il progetto
  assert.equal((await api(ANNA, 'POST', `/api/projects/${p.id}/members`, { user_ids: [bruno] })).status, 201);
  const seen = (await api(BRUNO, 'GET', '/api/projects')).body;
  assert.deepEqual(seen.map(x => [x.id, x.my_role]), [[p.id, 'member']]);
  assert.equal((await api(BRUNO, 'GET', `/api/tickets/${t.id}`)).status, 200);
  assert.equal((await api(BRUNO, 'POST', `/api/projects/${p.id}/members`, { user_ids: [carlo] })).status, 403);
  assert.equal((await api(BRUNO, 'PATCH', `/api/projects/${p.id}`, { name: 'Mio' })).status, 403);
  assert.equal((await api(BRUNO, 'DELETE', `/api/projects/${p.id}`)).status, 403);
  // ma un membro può collegare la cartella OneDrive
  assert.equal((await api(BRUNO, 'PATCH', `/api/projects/${p.id}`, { onedrive_drive_id: 'd', onedrive_item_id: 'i', onedrive_name: 'Cartella' })).status, 200);

  const members = (await api(BRUNO, 'GET', `/api/projects/${p.id}/members`)).body;
  assert.deepEqual(members.map(m => [m.email, m.owner]), [[ANNA, true], [BRUNO, false]]);

  // il responsabile non si toglie; Bruno può uscire da solo
  assert.equal((await api(ANNA, 'DELETE', `/api/projects/${p.id}/members/${await idOf(ANNA)}`)).status, 400);
  assert.equal((await api(BRUNO, 'DELETE', `/api/projects/${p.id}/members/${bruno}`)).status, 200);
  assert.equal((await api(BRUNO, 'GET', `/api/projects/${p.id}`)).status, 404);
});

test('chi viene assegnato a un ticket del progetto entra nel progetto', async () => {
  const carlo = await idOf(CARLO);
  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Cantiere' })).body;
  assert.equal((await api(CARLO, 'GET', `/api/projects/${p.id}`)).status, 404);
  await api(ANNA, 'POST', '/api/tickets', { title: 'Sopralluogo', project_id: p.id, assignee_ids: [carlo] });
  const proj = await api(CARLO, 'GET', `/api/projects/${p.id}`);
  assert.equal(proj.status, 200);
  assert.equal(proj.body.my_role, 'member');
  // anche assegnando dopo, con una modifica
  const t2 = (await api(ANNA, 'POST', '/api/tickets', { title: 'Collaudo', project_id: p.id })).body;
  await api(CARLO, 'DELETE', `/api/projects/${p.id}/members/${carlo}`);
  await api(ANNA, 'PATCH', `/api/tickets/${t2.id}`, { assignee_ids: [carlo] });
  assert.equal((await api(CARLO, 'GET', `/api/projects/${p.id}`)).status, 200);
});

test('calendario: i ticket di un progetto altrui non compaiono tra «tutti i ticket»', async () => {
  const p = (await api(ANNA, 'POST', '/api/projects', { name: 'Segreto' })).body;
  await api(ANNA, 'POST', '/api/tickets', { title: 'Data riservata', project_id: p.id, due_date: '2026-11-03' });
  const cal = (await api(BRUNO, 'GET', '/api/calendar?start=2026-11-01&end=2026-11-30&tickets=all')).body;
  assert.ok(!cal.tickets.some(t => t.title === 'Data riservata'));
  const capo = (await api(CAPO, 'GET', '/api/calendar?start=2026-11-01&end=2026-11-30&tickets=all')).body;
  assert.ok(capo.tickets.some(t => t.title === 'Data riservata'));
});

test('migrazione 007: nei progetti esistenti restano membri assegnatari e autori dei ticket', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { migrate } = require('../lib/db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alma-mig7-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f < '007')) {
    fs.copyFileSync(path.join(__dirname, '..', 'migrations', f), path.join(dir, f));
  }
  const old = await createDb({});
  await migrate(old, dir);
  await old.exec(`
    INSERT INTO users (email, name) VALUES ('o@a.it', 'O'), ('x@a.it', 'X'), ('y@a.it', 'Y'), ('z@a.it', 'Z');
    INSERT INTO projects (name, owner_id) VALUES ('P', 1);
    INSERT INTO tickets (project_id, title, created_by) VALUES (1, 'T', 2);
    INSERT INTO ticket_assignees VALUES (1, 3);`);
  await migrate(old);
  const { rows } = await old.query('SELECT user_id FROM project_members WHERE project_id = 1 ORDER BY user_id');
  assert.deepEqual(rows.map(r => r.user_id), [2, 3]); // Z (4) non c'entra, O è il responsabile
  await old.close();
});
