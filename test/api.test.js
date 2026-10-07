// Test delle API su PGlite in memoria, con l'accesso di prova (senza Microsoft).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, cookie;

async function api(method, path, body, { headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const config = readConfig({ DEV_LOGIN: '1', PORT: '0' });
  const { app } = await createApp(config, { db });
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

test('senza sessione le API rispondono 401', async () => {
  const res = await fetch(`${base}/api/tickets`);
  assert.equal(res.status, 401);
});

test('le modifiche senza X-Alma sono rifiutate', async () => {
  const res = await api('POST', '/api/projects', { name: 'X' }, { headers: { 'X-Alma': '' } });
  assert.equal(res.status, 403);
});

test('progetto, ticket con più assegnatari, dipendenze e filtri', async () => {
  const me = (await api('GET', '/api/me')).body;
  assert.equal(me.email, 'dante@almacis.it');
  const other = (await api('POST', '/api/users', { email: 'Giulia@almacis.it', name: 'Giulia' })).body;

  const p = (await api('POST', '/api/projects', { name: 'Sito nuovo', start_date: '2026-10-01', end_date: '2026-11-30' })).body;
  const t1 = await api('POST', '/api/tickets', {
    title: 'Wireframe', project_id: p.id, assignee_ids: [me.id, other.id], start_date: '2026-10-05', due_date: '2026-10-09',
  });
  assert.equal(t1.status, 201);
  assert.deepEqual(t1.body.assignee_ids, [me.id, other.id]);
  assert.equal(t1.body.start_date, '2026-10-05');

  const t2 = (await api('POST', '/api/tickets', { title: 'Grafica', project_id: p.id, assignee_ids: [other.id], depends_on: [t1.body.id] })).body;
  assert.deepEqual(t2.depends_on, [t1.body.id]);

  // ciclo vietato
  const cyc = await api('PATCH', `/api/tickets/${t1.body.id}`, { depends_on: [t2.id] });
  assert.equal(cyc.status, 400);

  const mine = (await api('GET', '/api/tickets?assignee=me')).body;
  assert.deepEqual(mine.map(t => t.id), [t1.body.id]);
  const inProject = (await api('GET', `/api/tickets?project=${p.id}`)).body;
  assert.equal(inProject.length, 2);
  const search = (await api('GET', '/api/tickets?q=grafi')).body;
  assert.deepEqual(search.map(t => t.id), [t2.id]);

  const done = (await api('PATCH', `/api/tickets/${t1.body.id}`, { status: 'done' })).body;
  assert.equal(done.progress, 100);

  const bad = await api('PATCH', `/api/tickets/${t1.body.id}`, { due_date: '2026-10-01' });
  assert.equal(bad.status, 400);

  const proj = (await api('GET', `/api/projects/${p.id}`)).body;
  assert.equal(proj.ticket_count, 2);
  assert.equal(proj.done_count, 1);
  assert.equal(proj.tickets_start, '2026-10-05');

  await api('POST', `/api/tickets/${t2.id}/comments`, { body: 'Prima bozza pronta' });
  await api('POST', `/api/tickets/${t2.id}/files`, { drive_id: 'd1', item_id: 'i1', name: 'logo.pdf' });
  const detail = (await api('GET', `/api/tickets/${t2.id}`)).body;
  assert.equal(detail.comments[0].body, 'Prima bozza pronta');
  assert.equal(detail.files[0].name, 'logo.pdf');

  // cancellando il progetto i ticket restano, senza progetto
  await api('DELETE', `/api/projects/${p.id}`);
  const orphan = (await api('GET', `/api/tickets/${t2.id}`)).body;
  assert.equal(orphan.project_id, null);
});

test('senza Microsoft configurato OneDrive risponde 503 e il calendario mostra solo i ticket', async () => {
  const drive = await api('GET', '/api/drive/items');
  assert.equal(drive.status, 503);
  const cal = await api('GET', '/api/calendar?start=2026-10-01&end=2026-10-31');
  assert.equal(cal.status, 200);
  assert.ok(Array.isArray(cal.body.tickets));
  assert.ok(cal.body.outlookError);
});
