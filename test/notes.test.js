// Note con data su progetti e ticket.
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
  for (const [k, e] of [['anna', 'anna@almacis.it'], ['luca', 'luca@almacis.it'], ['ext', 'esterno@almacis.it'], ['capo', 'capo@almacis.it']]) {
    const r = await fetch(`${base}/auth/dev-login?email=${e}`, { redirect: 'manual' });
    users[k] = { cookie: r.headers.get('set-cookie').split(';')[0] };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  server?.close();
  await db?.close();
});

test('note del progetto e dei suoi ticket: ordine, data, tipo, visibilità', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Regione Abruzzo' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Offerta tecnica', project_id: p.id })).body;

  const n1 = await api('anna', 'POST', `/api/projects/${p.id}/notes`, { kind: 'riunione', title: 'Kickoff', body: 'Presenti cliente e direzione lavori', note_date: '2026-10-01' });
  assert.equal(n1.status, 201);
  assert.equal(n1.body.note_date, '2026-10-01');
  assert.equal(n1.body.author_id, users.anna.id);
  await api('luca', 'POST', `/api/projects/${p.id}/notes`, { kind: 'telefonata', body: 'Il cliente chiede un rinvio', note_date: '2026-10-05' });
  await api('luca', 'POST', `/api/tickets/${t.id}/notes`, { body: 'Mancano i CV', note_date: '2026-10-03' });
  const pin = (await api('anna', 'POST', `/api/projects/${p.id}/notes`, { kind: 'decisione', body: 'Si consegna il 16', note_date: '2026-09-20', pinned: true })).body;

  const list = (await api('luca', 'GET', `/api/projects/${p.id}/notes`)).body;
  // fissata in alto, poi per data dalla più recente; ci sono anche le note dei ticket
  assert.deepEqual(list.map(n => n.body), ['Si consegna il 16', 'Il cliente chiede un rinvio', 'Mancano i CV', 'Presenti cliente e direzione lavori']);
  assert.equal(list.find(n => n.ticket_id).ticket_title, 'Offerta tecnica');
  assert.equal((await api('anna', 'GET', `/api/tickets/${t.id}/notes`)).body.length, 1);
  // l'admin vede tutto
  assert.equal((await api('capo', 'GET', `/api/projects/${p.id}/notes`)).body.length, 4);

  // chi non vede il progetto non vede né scrive
  assert.equal((await api('ext', 'GET', `/api/projects/${p.id}/notes`)).status, 404);
  assert.equal((await api('ext', 'POST', `/api/projects/${p.id}/notes`, { body: 'x' })).status, 404);
  assert.equal((await api('ext', 'GET', `/api/tickets/${t.id}/notes`)).status, 404);
  assert.equal((await api('ext', 'PATCH', `/api/notes/${pin.id}`, { body: 'x' })).status, 404);

  // dati non validi
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: '' })).status, 400);
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: 'x', kind: 'altro' })).status, 400);
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: 'x', note_date: '2026-13-40' })).status, 400);
  // senza data: oggi
  const today = (await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: 'Senza data' })).body;
  assert.match(today.note_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('modifica ed eliminazione: solo l\'autore o un admin; fissare non conta come modifica; eliminare si annulla', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Comune Pescara' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const n = (await api('anna', 'POST', `/api/projects/${p.id}/notes`, { body: 'Prima versione', note_date: '2026-10-02' })).body;

  assert.equal((await api('luca', 'PATCH', `/api/notes/${n.id}`, { body: 'Cambiata da Luca' })).status, 403);
  assert.equal((await api('luca', 'DELETE', `/api/notes/${n.id}`)).status, 403);

  const pinned = (await api('anna', 'PATCH', `/api/notes/${n.id}`, { pinned: true })).body;
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.updated_at, null);
  const edited = (await api('anna', 'PATCH', `/api/notes/${n.id}`, { body: 'Seconda versione', note_date: '2026-10-04', kind: 'decisione' })).body;
  assert.equal(edited.body, 'Seconda versione');
  assert.equal(edited.note_date, '2026-10-04');
  assert.ok(edited.updated_at);
  assert.equal((await api('capo', 'PATCH', `/api/notes/${n.id}`, { title: 'Corretto dall\'admin' })).status, 200);

  assert.equal((await api('anna', 'DELETE', `/api/notes/${n.id}`)).status, 200);
  assert.equal((await api('anna', 'GET', `/api/projects/${p.id}/notes`)).body.length, 0);
  assert.equal((await api('anna', 'PATCH', `/api/notes/${n.id}`, { body: 'x' })).status, 404);
  assert.equal((await api('luca', 'POST', `/api/notes/${n.id}/restore`)).status, 403);
  assert.equal((await api('anna', 'POST', `/api/notes/${n.id}/restore`)).body.body, 'Seconda versione');
  assert.equal((await api('anna', 'GET', `/api/projects/${p.id}/notes`)).body.length, 1);

  // cancellando il ticket spariscono le sue note
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Da cancellare', project_id: p.id })).body;
  await api('anna', 'POST', `/api/tickets/${t.id}/notes`, { body: 'Nota del ticket' });
  await api('anna', 'DELETE', `/api/tickets/${t.id}`);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM notes WHERE ticket_id = $1', [t.id])).rows[0].n, 0);
});
