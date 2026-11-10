// Alma Planet: Laboratorio delle idee (proposte, sostegno, commenti, comitato e voti) e pagina di benvenuto.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, A, B, C;
const ids = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'admin.prova@almacis.it' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await login('admin.prova@almacis.it');
  const b = await login('bruno.idee@almacis.it');
  const c = await login('carla.comitato@almacis.it');
  A = (m, p, body) => api(a, m, p, body);
  B = (m, p, body) => api(b, m, p, body);
  C = (m, p, body) => api(c, m, p, body);
  ids.b = (await B('GET', '/api/me')).body.id;
  ids.c = (await C('GET', '/api/me')).body.id;
});

after(async () => {
  server?.close();
  await db?.close();
});

test('ognuno propone un\'idea; servono titolo e proposta', async () => {
  assert.equal((await B('POST', '/api/ideas', { title: 'Senza proposta' })).status, 400);
  const r = await B('POST', '/api/ideas', { title: 'Check-list digitale di cantiere', category: 'processi', problem: 'Fogli persi', proposal: 'Una check-list sul telefono', benefits: 'Meno errori' });
  assert.equal(r.status, 201);
  ids.idea = r.body.id;
  const list = (await C('GET', '/api/ideas')).body;
  assert.equal(list.ideas.length, 1);
  assert.equal(list.ideas[0].title, 'Check-list digitale di cantiere');
  assert.equal(list.ideas[0].avg_score, undefined, 'chi non è nel comitato non vede le medie');
  assert.equal(list.voting_open, false);
});

test('sostegno e commenti', async () => {
  assert.equal((await C('POST', `/api/ideas/${ids.idea}/support`)).status, 200);
  await C('POST', `/api/ideas/${ids.idea}/support`); // due volte conta una
  const c = await C('POST', `/api/ideas/${ids.idea}/comments`, { body: 'Ottima, la proverei a Pescara' });
  assert.equal(c.status, 201);
  const d = (await B('GET', `/api/ideas/${ids.idea}`)).body;
  assert.equal(d.support_count, 1);
  assert.equal(d.supported, false);
  assert.equal(d.comments.length, 1);
  assert.equal((await B('DELETE', `/api/idea-comments/${c.body.id}`)).status, 403, 'il commento di un altro non si cancella');
  await C('DELETE', `/api/ideas/${ids.idea}/support`);
  assert.equal((await B('GET', `/api/ideas/${ids.idea}`)).body.support_count, 0);
});

test('solo l\'autore modifica, e solo finché è una proposta', async () => {
  assert.equal((await C('PATCH', `/api/ideas/${ids.idea}`, { title: 'Rubata' })).status, 403);
  assert.equal((await B('PATCH', `/api/ideas/${ids.idea}`, { title: 'Check-list digitale' })).status, 200);
  assert.equal((await B('PATCH', `/api/ideas/${ids.idea}`, { status: 'premiata' })).status, 403, 'lo stato non lo cambia l\'autore');
});

test('il comitato lo sceglie l\'amministratore; vota solo a votazione aperta', async () => {
  assert.equal((await B('PUT', '/api/ideas-settings', { committee: [ids.b] })).status, 403);
  assert.equal((await A('PUT', '/api/ideas-settings', { committee: [ids.b, ids.c] })).status, 200);
  assert.equal((await C('PUT', `/api/ideas/${ids.idea}/vote`, { score: 4 })).status, 409, 'votazione chiusa');
  await A('PUT', '/api/ideas-settings', { voting_open: true });
  assert.equal((await C('PUT', `/api/ideas/${ids.idea}/vote`, { score: 6 })).status, 400);
  assert.equal((await C('PUT', `/api/ideas/${ids.idea}/vote`, { score: 4, note: 'Utile subito' })).status, 200);
  assert.equal((await C('PUT', `/api/ideas/${ids.idea}/vote`, { score: 5 })).status, 200, 'il voto si cambia');
  assert.equal((await B('PUT', `/api/ideas/${ids.idea}/vote`, { score: 5 })).status, 409, 'non si vota la propria idea');
  assert.equal((await A('PUT', `/api/ideas/${ids.idea}/vote`, { score: 5 })).status, 403, 'l\'amministratore fuori dal comitato non vota');
  const list = (await C('GET', '/api/ideas')).body;
  assert.equal(list.me.committee, true);
  assert.equal(list.ideas[0].avg_score, 5);
  assert.equal(list.ideas[0].vote_count, 1);
  assert.deepEqual(list.committee.sort(), [ids.b, ids.c].sort());
  // il comitato premia; poi l'autore non la modifica più
  assert.equal((await C('PATCH', `/api/ideas/${ids.idea}`, { status: 'premiata' })).status, 200);
  assert.equal((await B('PATCH', `/api/ideas/${ids.idea}`, { title: 'Ancora' })).status, 409);
  // tolto dal comitato non vota più
  await A('PUT', '/api/ideas-settings', { committee: [ids.b] });
  assert.equal((await C('PUT', `/api/ideas/${ids.idea}/vote`, { score: 3 })).status, 403);
});

test('benvenuto: scorciatoie predefinite, le cambia solo l\'amministratore', async () => {
  const w = (await B('GET', '/api/welcome')).body;
  assert.equal(w.can_edit, false);
  assert.ok(w.shortcuts.some(s => s.label.includes('Edenred')));
  assert.equal(w.ideas.length, 1);
  assert.equal((await B('PUT', '/api/welcome/shortcuts', { shortcuts: [] })).status, 403);
  assert.equal((await A('PUT', '/api/welcome/shortcuts', { shortcuts: [{ label: 'X', url: 'javascript:alert(1)' }] })).status, 400);
  const ok = await A('PUT', '/api/welcome/shortcuts', { shortcuts: [{ label: 'Welfare', url: 'https://welfare.example.it', icon: 'gift' }] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await B('GET', '/api/welcome')).body.shortcuts, [{ label: 'Welfare', hint: '', url: 'https://welfare.example.it', icon: 'gift' }]);
});

test('l\'autore cancella la sua idea', async () => {
  assert.equal((await C('DELETE', `/api/ideas/${ids.idea}`)).status, 403);
  assert.equal((await B('DELETE', `/api/ideas/${ids.idea}`)).status, 200);
  assert.equal((await B('GET', '/api/ideas')).body.ideas.length, 0);
});
