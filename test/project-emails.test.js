// Email di Outlook nei progetti, con una casella Outlook finta (test/fake-outlook.js).
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
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

before(async () => {
  db = await createDb({});
  const { app, auth } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  fake = installFakeOutlook({ auth, mailboxSize: 40 });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of [['anna', 'anna@almacis.it'], ['luca', 'luca@almacis.it'], ['ext', 'esterno@almacis.it'], ['capo', 'capo@almacis.it']]) {
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

test('casella: cartelle, ricerca, pagine; le email già nel progetto sono segnate', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Ospedale Teramo' })).body;
  const inbox = (await api('anna', 'GET', `/api/mail/messages?folder=inbox&project=${p.id}`)).body;
  assert.equal(inbox.messages.length, 25);
  assert.ok(inbox.next);
  assert.ok(inbox.messages.every(m => !m.assigned));
  const more = (await api('anna', 'GET', `/api/mail/messages?next=${encodeURIComponent(inbox.next)}`)).body;
  assert.ok(more.messages.length > 0);
  assert.ok(!more.messages.some(m => inbox.messages.some(x => x.id === m.id)));
  const sent = (await api('anna', 'GET', '/api/mail/messages?folder=sent')).body;
  assert.ok(sent.messages.length > 0 && sent.messages.length < inbox.messages.length);
  const found = (await api('anna', 'GET', '/api/mail/messages?folder=all&q=collaudo')).body;
  assert.ok(found.messages.length > 0 && found.messages.every(m => /collaudo/i.test(m.subject)));
  // la pagina successiva deve restare sulla propria casella
  assert.equal((await api('anna', 'GET', `/api/mail/messages?next=${encodeURIComponent('https://evil.example.com/x')}`)).status, 400);
});

test('assegnare: testo e allegati copiati, doppioni saltati, segnate nella casella', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Regione Abruzzo' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const box = fake.mailbox(users.anna.id);
  const withFile = box.find(m => m.hasAttachments && m.folder === 'inbox');
  const plain = box.find(m => !m.hasAttachments && m.folder === 'inbox');
  const r = await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [withFile.id, plain.id] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { added: 2, already: 0, skipped_attachments: [] });
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [plain.id] })).body.already, 1);

  // Luca è membro: le legge, anche se l'originale è nella casella di Anna
  const list = (await api('luca', 'GET', `/api/projects/${p.id}/emails`)).body;
  assert.equal(list.length, 2);
  const row = list.find(e => e.subject === withFile.subject);
  assert.equal(row.attachment_count, 1); // il logo nella firma non conta
  assert.match(row.preview, /^Buongiorno/);
  const detail = (await api('luca', 'GET', `/api/project-emails/${row.id}`)).body;
  assert.equal(detail.from_address, withFile.from.emailAddress.address);
  assert.match(detail.body_text, /Cordiali saluti/);
  assert.equal(detail.web_link, null); // «Apri in Outlook» solo per chi l'ha assegnata
  assert.ok((await api('anna', 'GET', `/api/project-emails/${row.id}`)).body.web_link);
  const file = await api('luca', 'GET', `/api/project-emails/${row.id}/attachments/${detail.attachments[0].id}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /^attachment;/);
  assert.equal(file.headers.get('content-type'), 'application/octet-stream');
  assert.equal(file.body.toString(), withFile.attachments[0].data.toString());

  // nella casella risultano già assegnate
  const inbox = (await api('anna', 'GET', `/api/mail/messages?folder=inbox&project=${p.id}`)).body;
  assert.ok(inbox.messages.find(m => m.id === withFile.id).assigned);

  // la stessa email (stesso internetMessageId) assegnata da Luca dalla sua casella: una sola
  const sharedAnna = box.find(m => m.internetMessageId.startsWith('<condivisa'));
  const sharedLuca = fake.mailbox(users.luca.id).find(m => m.internetMessageId === sharedAnna.internetMessageId);
  await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [sharedAnna.id] });
  assert.equal((await api('luca', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [sharedLuca.id] })).body.already, 1);
});

test('permessi: chi non vede il progetto non vede né assegna; toglie chi ha assegnato, il responsabile o un admin', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Comune Pescara' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const [m1, m2] = fake.mailbox(users.luca.id).filter(m => m.folder === 'inbox');
  await api('luca', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [m1.id, m2.id] });
  const [e1, e2] = (await api('anna', 'GET', `/api/projects/${p.id}/emails`)).body;

  assert.equal((await api('ext', 'GET', `/api/projects/${p.id}/emails`)).status, 404);
  assert.equal((await api('ext', 'GET', `/api/project-emails/${e1.id}`)).status, 404);
  assert.equal((await api('ext', 'POST', `/api/projects/${p.id}/emails`, { message_ids: ['x'] })).status, 404);
  assert.equal((await api('ext', 'DELETE', `/api/project-emails/${e1.id}`)).status, 404);
  assert.equal((await api('ext', 'GET', `/api/mail/messages?project=${p.id}`)).status, 404);

  // l'admin vede tutto
  assert.equal((await api('capo', 'GET', `/api/projects/${p.id}/emails`)).body.length, 2);
  // Anna (responsabile) toglie quella di Luca; Luca toglie la sua
  assert.equal((await api('anna', 'DELETE', `/api/project-emails/${e1.id}`)).status, 200);
  assert.equal((await api('luca', 'DELETE', `/api/project-emails/${e2.id}`)).status, 200);
  assert.equal((await api('anna', 'GET', `/api/projects/${p.id}/emails`)).body.length, 0);

  // un membro non toglie quelle assegnate da altri
  await api('anna', 'POST', `/api/projects/${p.id}/emails`, { message_ids: [fake.mailbox(users.anna.id)[1].id] });
  const [e3] = (await api('luca', 'GET', `/api/projects/${p.id}/emails`)).body;
  assert.equal((await api('luca', 'DELETE', `/api/project-emails/${e3.id}`)).status, 403);

  // cancellando il progetto spariscono anche email e allegati
  await api('anna', 'DELETE', `/api/projects/${p.id}`);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM project_emails WHERE project_id = $1', [p.id])).rows[0].n, 0);
});

test('senza consenso a Mail.Read: messaggio chiaro', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Senza consenso' })).body;
  fake.restore();
  const auth = { graphToken: async () => 'x' };
  const f2 = installFakeOutlook({ auth, denyMailRead: true });
  const r = await api('anna', 'GET', `/api/mail/messages?project=${p.id}`);
  f2.restore();
  // (il token finto di Anna resta quello installato prima; qui conta la risposta di Graph)
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'mail_read');
  assert.match(r.body.error, /Mail\.Read/);
});
