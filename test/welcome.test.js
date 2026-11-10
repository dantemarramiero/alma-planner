// Alma Planet: la nuova pagina di benvenuto. Riepilogo in un colpo solo, «Grazie a…», sondaggi, eventi,
// organigramma in PDF, compleanni e anniversari (chi può mettere le date).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { daysUntil } = require('../routes/welcome');

let server, base, db, X, L, M, ids = {};
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body, raw) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(raw ? { 'Content-Type': 'application/pdf' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  return { status: res.status, body: text && type.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body, raw) => api(cookie, method, path, body, raw);
const iso = d => d.toISOString().slice(0, 10);

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  X = as(await login(ADMIN));
  L = as(await login('luca.bianchi@almacis.it'));
  M = as(await login('marta.verdi@almacis.it'));
  for (const [k, who] of [['admin', X], ['luca', L], ['marta', M]]) ids[k] = (await who('GET', '/api/me')).body.id;
});

after(async () => {
  server?.close();
  await db?.close();
});

test('giorni al prossimo compleanno, anche a cavallo dell’anno', () => {
  const today = new Date(Date.UTC(2026, 11, 30));
  assert.equal(daysUntil('1990-12-30', today), 0);
  assert.equal(daysUntil('1985-01-02', today), 3);
  assert.equal(daysUntil('1985-12-29', today), 364);
});

test('il riepilogo della pagina si apre per tutti, con la mia giornata', async () => {
  const r = await L('GET', '/api/welcome/home');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.people.arrivals));
  assert.equal(r.body.my.scheda, 'missing');
  assert.equal(r.body.can_admin, false);
  assert.ok(r.body.review.quarter >= 1 && r.body.review.quarter <= 4);
});

test('compleanni e anniversari: la data di nascita la mette la persona, l’assunzione un amministratore', async () => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const birthday = `1990-${iso(today).slice(5)}`;
  assert.equal((await L('PATCH', `/api/users/${ids.marta}/dates`, { birthday })).status, 403);
  assert.equal((await M('PATCH', `/api/users/${ids.marta}/dates`, { birthday })).status, 200);
  assert.equal((await M('PATCH', `/api/users/${ids.marta}/dates`, { hired_on: '2020-01-01' })).status, 403);
  // Luca è arrivato 5 giorni fa, Marta compie 3 anni in azienda fra 2 giorni
  const fiveAgo = iso(new Date(today.getTime() - 5 * 86400000));
  assert.equal((await X('PATCH', `/api/users/${ids.luca}/dates`, { hired_on: fiveAgo })).status, 200);
  const inTwo = new Date(today.getTime() + 2 * 86400000);
  const hired = `${inTwo.getUTCFullYear() - 3}-${iso(inTwo).slice(5)}`;
  assert.equal((await X('PATCH', `/api/users/${ids.marta}/dates`, { hired_on: hired })).status, 200);
  const h = (await L('GET', '/api/welcome/home')).body.people;
  assert.ok(h.arrivals.some(p => p.id === ids.luca));
  const b = h.birthdays.find(p => p.id === ids.marta);
  assert.equal(b.in_days, 0);
  assert.equal(b.birthday, undefined, 'l’anno di nascita non esce mai');
  const a = h.anniversaries.find(p => p.id === ids.marta);
  assert.equal(a.in_days, 2);
  assert.equal(a.years, 3);
});

test('«Grazie a…»: un post verso un collega, con il pillar', async () => {
  assert.equal((await L('POST', '/api/welcome/grazie', { user_id: ids.luca, body: 'x' })).status, 400, 'non a sé stessi');
  const r = await L('POST', '/api/welcome/grazie', { user_id: ids.marta, body: 'per aver chiuso la consegna in anticipo', pillar: 'E2E value & reliability' });
  assert.equal(r.status, 201);
  const g = (await M('GET', '/api/welcome/home')).body.grazie.find(p => p.id === r.body.id);
  assert.equal(g.thanked_id, ids.marta);
  assert.equal(g.pillar, 'E2E value & reliability');
  assert.match(g.body, /^Grazie a @marta\.verdi: per aver chiuso/);
});

test('sondaggio: lo crea un amministratore, ognuno vota una volta (può cambiare), poi si chiude', async () => {
  assert.equal((await L('POST', '/api/welcome/polls', { question: 'x', options: ['a', 'b'] })).status, 403);
  assert.equal((await X('POST', '/api/welcome/polls', { question: 'x', options: ['solo una'] })).status, 400);
  const p = (await X('POST', '/api/welcome/polls', { question: 'Dove facciamo la cena di Natale?', options: ['Al mare', 'In collina', 'In sede'] })).body;
  assert.equal(p.open, true);
  assert.equal((await L('POST', `/api/welcome/polls/${p.id}/vote`, { choice: 0 })).body.counts[0], 1);
  const changed = (await L('POST', `/api/welcome/polls/${p.id}/vote`, { choice: 2 })).body;
  assert.deepEqual(changed.counts, [0, 0, 1]);
  assert.equal(changed.my_vote, 2);
  await M('POST', `/api/welcome/polls/${p.id}/vote`, { choice: 2 });
  assert.equal((await M('GET', '/api/welcome/home')).body.poll.total, 2);
  assert.equal((await X('POST', `/api/welcome/polls/${p.id}/close`)).status, 200);
  assert.equal((await L('POST', `/api/welcome/polls/${p.id}/vote`, { choice: 1 })).status, 409);
});

test('eventi aziendali: li aggiunge e li toglie un amministratore', async () => {
  const day = iso(new Date(Date.now() + 10 * 86400000));
  assert.equal((await L('POST', '/api/welcome/events', { title: 'x', starts_on: day })).status, 403);
  const e = (await X('POST', '/api/welcome/events', { title: 'Formazione sicurezza', starts_on: day, place: 'Pescara' })).body;
  assert.ok((await L('GET', '/api/welcome/home')).body.events.some(x => x.id === e.id));
  assert.equal((await X('DELETE', `/api/welcome/events/${e.id}`)).status, 200);
  assert.ok(!(await L('GET', '/api/welcome/home')).body.events.some(x => x.id === e.id));
});

test('organigramma: un PDF caricato da un amministratore, lo aprono tutti', async () => {
  assert.equal((await L('GET', '/api/welcome/orgchart')).status, 404);
  const pdf = Buffer.from('%PDF-1.4\n% organigramma di prova\n%%EOF\n');
  assert.equal((await L('PUT', '/api/welcome/orgchart?name=Organigramma.pdf', null, pdf)).status, 403);
  assert.equal((await X('PUT', '/api/welcome/orgchart?name=x.pdf', null, Buffer.from('non un pdf'))).status, 400);
  const meta = (await X('PUT', '/api/welcome/orgchart?name=Organigramma%202026.pdf', null, pdf)).body;
  assert.equal(meta.name, 'Organigramma 2026.pdf');
  assert.equal(meta.size, pdf.length);
  const got = await L('GET', '/api/welcome/orgchart?download=1');
  assert.equal(got.status, 200);
  assert.ok(got.body.equals(pdf));
  assert.match(got.headers.get('content-disposition'), /attachment/);
  assert.equal((await L('GET', '/api/welcome/home')).body.orgchart.name, 'Organigramma 2026.pdf');
});
