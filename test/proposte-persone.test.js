// ALM2-84: «Collega incontro» / «Collega email» propongono da soli quelli con le persone della scheda
// (progetto o CRM), usando la casella e il calendario finti di test/fake-outlook.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { installFakeOutlook } = require('./fake-outlook');

let server, base, db, fake;
const users = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function contact(email, first, last) {
  const { rows: [c] } = await db.query(`INSERT INTO crm_contacts (first_name, last_name, email) VALUES ($1, $2, $3) RETURNING id`, [first, last, email]);
  return c.id;
}

before(async () => {
  db = await createDb({});
  const { app, auth } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  fake = installFakeOutlook({ auth });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of [['anna', 'anna@almacis.it'], ['luca', 'luca@almacis.it'], ['capo', 'capo@almacis.it']]) {
    users[k] = { cookie: await login(e) };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  fake?.restore();
  server?.closeAllConnections?.();
  server?.close();
  await db?.close();
});

test('progetto senza persone: nessuna proposta', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Vuoto' })).body;
  const m = await api('anna', 'GET', `/api/projects/${p.id}/meeting-proposals`);
  assert.equal(m.status, 200);
  assert.deepEqual(m.body, { people: [], events: [] });
  assert.deepEqual((await api('anna', 'GET', `/api/projects/${p.id}/email-proposals`)).body, { people: [], messages: [] });
});

test('progetto con un contatto CRM: incontri ed email con lui, i colleghi non contano, i collegati spariscono', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Ospedale' })).body;
  const rossi = await contact('Info@StudioRossi.it', 'Mario', 'Rossi');
  const collega = await contact('luca@almacis.it', 'Luca', 'Collega');
  for (const c of [rossi, collega]) await db.query('INSERT INTO crm_project_links (project_id, contact_id) VALUES ($1, $2)', [p.id, c]);

  const m = (await api('anna', 'GET', `/api/projects/${p.id}/meeting-proposals`)).body;
  assert.deepEqual(m.people, [{ address: 'info@studiorossi.it', name: 'Mario Rossi' }]);
  assert.ok(m.events.length > 0);
  const cal = fake.calendar(users.anna.id);
  for (const ev of m.events) {
    const src = cal.find(e => e.id === ev.id);
    assert.ok(src.attendees.some(a => a.emailAddress.address === 'info@studiorossi.it'), ev.subject);
    assert.ok(!src.categories.includes('Alma Planet'));
    assert.deepEqual(ev.with, ['Mario Rossi']);
  }

  const e = (await api('anna', 'GET', `/api/projects/${p.id}/email-proposals`)).body;
  assert.ok(e.messages.length > 0);
  assert.ok(e.messages.every(x => x.from.address === 'info@studiorossi.it' || x.to.some(t => t.address === 'info@studiorossi.it')));

  // collegati: non sono più proposti
  const first = m.events[0];
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [first.id] })).status, 201);
  const again = (await api('anna', 'GET', `/api/projects/${p.id}/meeting-proposals`)).body;
  assert.ok(!again.events.some(x => x.id === first.id));
  // l'organizzatore dell'incontro collegato ora è una persona del progetto: si propongono anche i suoi
  assert.ok(again.people.some(x => x.address === 'p.verdi@regione.abruzzo.it'));
  assert.equal(again.people[0].address, 'info@studiorossi.it'); // il contatto CRM resta il primo
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [e.messages[0].id] })).status, 201);
  assert.ok(!(await api('anna', 'GET', `/api/projects/${p.id}/email-proposals`)).body.messages.some(x => x.id === e.messages[0].id));
});

test('progetto: le persone vengono anche dalle email e dagli incontri già nel progetto', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Comune' })).body;
  const mail = fake.mailbox(users.anna.id).find(x => x.from.emailAddress.address === 'gare@asl.example.it');
  await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [mail.id] });
  const r = (await api('anna', 'GET', `/api/projects/${p.id}/email-proposals`)).body;
  assert.ok(r.people.some(x => x.address === 'gare@asl.example.it'));
  assert.ok(!r.people.some(x => x.address.endsWith('@almacis.it')));
  assert.ok(!r.messages.some(x => x.id === mail.id)); // quella c'è già
});

test('progetto non visibile: 404', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Privato', visibility: 'private' })).body;
  const r = await api('luca', 'GET', `/api/projects/${p.id}/meeting-proposals`);
  assert.ok([403, 404].includes(r.status));
});

test('CRM: incontri ed email proposti per il contatto, tolti quelli già collegati', async () => {
  const id = await contact('m.bianchi@fornitore.example.com', 'Marta', 'Bianchi');
  const r = await api('capo', 'GET', `/api/crm/contacts/${id}/meeting-proposals`);
  assert.equal(r.status, 200);
  assert.ok(r.body.events.length > 0);
  assert.ok(r.body.events.every(x => x.with.includes('Marta Bianchi')));
  assert.equal((await api('capo', 'POST', `/api/crm/contacts/${id}/meetings`, { event_ids: [r.body.events[0].id] })).status, 201);
  const again = (await api('capo', 'GET', `/api/crm/contacts/${id}/meeting-proposals`)).body;
  assert.equal(again.events.length, r.body.events.length - 1);
  const mail = (await api('capo', 'GET', `/api/crm/contacts/${id}/email-proposals`)).body;
  assert.ok(mail.messages.length > 0 && mail.messages.every(x => x.with.includes('Marta Bianchi')));
});
