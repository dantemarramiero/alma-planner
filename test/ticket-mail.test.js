// Email a chi riceve un ticket in assegnazione (sendMail di Graph intercettato).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, realFetch;
const users = {};
let sent = [];

async function api(who, method, path, body) {
  const res = await realFetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
}
const settle = () => new Promise(r => setTimeout(r, 150)); // l'invio parte dopo la risposta

before(async () => {
  db = await createDb({});
  const { app, auth } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', BASE_URL: 'https://alma.example.it' }), { db });
  auth.graphToken = async userId => `fake:${userId}`;
  realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (String(url) === 'https://graph.microsoft.com/v1.0/me/sendMail') {
      sent.push({ from: opts.headers.Authorization.replace('Bearer fake:', ''), ...JSON.parse(opts.body) });
      return new Response(null, { status: 202 });
    }
    return realFetch(url, opts);
  };
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, e] of [['anna', 'anna.rossi@almacis.it'], ['luca', 'luca.bianchi@almacis.it'], ['sara', 'sara.verdi@almacis.it']]) {
    const r = await realFetch(`${base}/auth/dev-login?email=${e}`, { redirect: 'manual' });
    users[k] = { cookie: r.headers.get('set-cookie').split(';')[0] };
    users[k].id = (await api(k, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  global.fetch = realFetch;
  server?.close();
  await db?.close();
});

beforeEach(() => { sent = []; });

test('creando un ticket: email a ogni assegnatario tranne chi lo crea, dalla sua casella', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Ospedale Teramo' })).body;
  const t = (await api('anna', 'POST', '/api/tickets', {
    title: 'Verifica <capitolato>', project_id: p.id, assignee_ids: [users.anna.id, users.luca.id, users.sara.id],
    priority: 'urgent', due_date: '2026-10-20', description: 'Controllare le voci 3 e 4',
  })).body;
  await settle();
  assert.deepEqual(sent.map(m => m.message.toRecipients[0].emailAddress.address).sort(), ['luca.bianchi@almacis.it', 'sara.verdi@almacis.it']);
  const m = sent[0];
  assert.equal(m.from, String(users.anna.id));     // parte dalla casella di chi assegna
  assert.equal(m.saveToSentItems, false);
  assert.match(m.message.subject, /^\[Alma Planet\] Anna Rossi ti ha assegnato: Verifica <capitolato>/);
  const html = m.message.body.content;
  assert.match(html, /Verifica &lt;capitolato&gt;/);  // il titolo non diventa HTML
  assert.match(html, /Ospedale Teramo/);
  assert.match(html, /Urgente/);
  assert.match(html, /20 ottobre 2026/);
  assert.match(html, /Controllare le voci 3 e 4/);
  assert.ok(html.includes(`https://alma.example.it/app#/tickets/${t.id}`));
});

test('modificando: email solo a chi viene aggiunto ora', async () => {
  const t = (await api('anna', 'POST', '/api/tickets', { title: 'Report', assignee_ids: [users.luca.id] })).body;
  await settle();
  sent = [];
  await api('anna', 'PATCH', `/api/tickets/${t.id}`, { assignee_ids: [users.luca.id, users.sara.id] });
  await settle();
  assert.deepEqual(sent.map(m => m.message.toRecipients[0].emailAddress.address), ['sara.verdi@almacis.it']);

  sent = [];
  await api('anna', 'PATCH', `/api/tickets/${t.id}`, { status: 'doing', assignee_ids: [users.sara.id] }); // tolto Luca: niente email
  await api('anna', 'PATCH', `/api/tickets/${t.id}`, { title: 'Report di ottobre' });                      // nessun cambio di assegnatari
  await settle();
  assert.equal(sent.length, 0);

  // chi si assegna da solo non riceve email; il collega aggiunto da Luca sì, e parte dalla casella di Luca
  await api('luca', 'PATCH', `/api/tickets/${t.id}`, { assignee_ids: [users.sara.id, users.luca.id, users.anna.id] });
  await settle();
  assert.deepEqual(sent.map(m => [m.from, m.message.toRecipients[0].emailAddress.address]), [[String(users.luca.id), 'anna.rossi@almacis.it']]);
});

test('se Microsoft non risponde il ticket si salva lo stesso', async () => {
  const saved = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes('sendMail') ? new Response('{"error":{"message":"down"}}', { status: 503, headers: { 'Content-Type': 'application/json' } }) : saved(url, opts));
  const r = await api('anna', 'POST', '/api/tickets', { title: 'Comunque salvato', assignee_ids: [users.luca.id] });
  await settle();
  global.fetch = saved;
  assert.equal(r.status, 201);
  assert.equal((await api('anna', 'GET', `/api/tickets/${r.body.id}`)).status, 200);
});
