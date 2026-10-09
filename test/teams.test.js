// Messaggi (chat Teams) ed email: Graph è simulato, si verifica cosa mandiamo e come leggiamo le risposte.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { htmlToText, textToHtml } = require('../routes/teams');

let server, base, db, cookie, auth;
const graphCalls = [];
const realFetch = globalThis.fetch;

// Risposte finte di Microsoft Graph
function fakeGraph(url, opts = {}) {
  const u = new URL(url);
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  graphCalls.push({ method: opts.method || 'GET', path: u.pathname, body });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const p = decodeURIComponent(u.pathname.replace('/v1.0', ''));
  if (p === '/me/chats' && (opts.method || 'GET') === 'GET') {
    return json({ value: [
      { id: 'c1', chatType: 'oneOnOne', topic: null, webUrl: 'https://teams/c1', lastUpdatedDateTime: '2026-10-07T10:00:00Z',
        members: [{ userId: 'me-oid', displayName: 'Dante', email: 'dante@almacis.it' }, { userId: 'g-oid', displayName: 'Giulia Rossi', email: 'giulia@almacis.it' }],
        lastMessagePreview: { createdDateTime: '2026-10-07T10:00:00Z', from: { user: { id: 'g-oid', displayName: 'Giulia Rossi' } }, body: { content: '<p>Ciao <b>Dante</b></p>' } },
        viewpoint: { lastMessageReadDateTime: '2026-10-07T09:00:00Z' } },
      { id: 'c2', chatType: 'group', topic: 'Gara Pescara', lastUpdatedDateTime: '2026-10-06T10:00:00Z', members: [],
        lastMessagePreview: { createdDateTime: '2026-10-06T10:00:00Z', from: { user: { id: 'me-oid' } }, body: { content: 'ok' } },
        viewpoint: { lastMessageReadDateTime: '2026-10-06T09:00:00Z' } },
      { id: 'c3', chatType: 'oneOnOne', members: [], viewpoint: { isHidden: true } },
    ] });
  }
  if (p === '/chats/c1/messages' && opts.method === 'POST') {
    return json({ id: 'm9', createdDateTime: '2026-10-07T11:00:00Z', messageType: 'message', from: { user: { id: 'me-oid', displayName: 'Dante' } }, body: { content: body.body.content } }, 201);
  }
  if (p === '/chats' && opts.method === 'POST') return json({ id: 'new-chat' }, 201);
  if (p === '/users/giulia@almacis.it') return json({ id: 'g-oid' });
  if (p.startsWith('/users/')) return json({ error: { message: 'non trovato' } }, 404);
  if (p === '/users' && u.searchParams.get('$filter') === "mail eq 'marco@almacis.it'") return json({ value: [{ id: 'm-oid' }] });
  if (p === '/users') return json({ value: [] });
  if (p === '/me/sendMail') return new Response(null, { status: 202 });
  return json({ error: { message: `non simulato: ${p}` } }, 404);
}

async function api(method, path, body) {
  const res = await realFetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const created = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', MS_TENANT_ID: '' }), { db });
  auth = created.auth;
  server = created.app.listen(0);
  server.keepAliveTimeout = 60000; // vedi gli altri test: evita ECONNRESET sotto carico
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await realFetch(`${base}/auth/dev-login?email=dante@almacis.it`, { redirect: 'manual' });
  cookie = res.headers.get('set-cookie').split(';')[0];
  await db.query("UPDATE users SET oid = 'me-oid' WHERE email = 'dante@almacis.it'");
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await db?.close();
});

test('testo ↔ HTML dei messaggi Teams', () => {
  assert.equal(htmlToText('<p>Ciao <b>Giulia</b>,</p><p>a domani&nbsp;&amp; grazie</p>'), 'Ciao Giulia,\na domani & grazie');
  assert.equal(htmlToText('riga 1<br>riga 2<attachment id="1"></attachment>'), 'riga 1\nriga 2');
  assert.equal(textToHtml('<script>x</script>\nciao'), '&lt;script&gt;x&lt;/script&gt;<br>ciao');
});

test('senza Microsoft: le chat rispondono 503 e il contatore 0', async () => {
  assert.equal((await api('GET', '/api/teams/chats')).status, 503);
  assert.deepEqual((await api('GET', '/api/teams/unread')).body, { chats: 0 });
});

test('chat Teams: elenco con non letti, invio, nuova chat 1:1 e di gruppo; email', async () => {
  auth.graphToken = async () => 'token-finto';
  auth.msConfigured = true;
  globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.microsoft.com/') ? fakeGraph(String(url), opts) : realFetch(url, opts));
  try {
    const chats = (await api('GET', '/api/teams/chats')).body;
    assert.deepEqual(chats.map(c => [c.id, c.unread]), [['c1', true], ['c2', false]]); // c3 nascosta
    assert.equal(chats[0].last.text, 'Ciao Dante');
    assert.equal(chats[0].last.mine, false);
    const listCalls = () => graphCalls.filter(c => c.path === '/v1.0/me/chats').length;
    const before = listCalls();
    assert.deepEqual((await api('GET', '/api/teams/unread')).body, { chats: 1 });
    assert.equal(listCalls(), before, 'il contatore riusa l\'elenco appena letto, senza chiedere di nuovo a Microsoft');
    await api('GET', '/api/teams/chats?fresh=1');
    assert.equal(listCalls(), before + 1);

    const sent = await api('POST', '/api/teams/chats/c1/messages', { text: 'Ok <arrivo>\nalle 10' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.mine, true);
    assert.equal(sent.body.text, 'Ok <arrivo>\nalle 10');
    assert.equal(graphCalls.at(-1).body.body.content, 'Ok &lt;arrivo&gt;<br>alle 10');

    await api('POST', '/api/teams/chats', { oids: ['g-oid'] });
    const one = graphCalls.at(-1).body;
    assert.equal(one.chatType, 'oneOnOne');
    assert.deepEqual(one.members.map(m => m['user@odata.bind']), ["https://graph.microsoft.com/v1.0/users('me-oid')", "https://graph.microsoft.com/v1.0/users('g-oid')"]);
    await api('POST', '/api/teams/chats', { oids: ['g-oid', 'm-oid'], topic: 'Cantiere' });
    assert.equal(graphCalls.at(-1).body.chatType, 'group');
    assert.equal(graphCalls.at(-1).body.topic, 'Cantiere');
    assert.equal((await api('POST', '/api/teams/chats', { oids: ['me-oid'] })).status, 400);

    // dalle email: UPN diretto, poi ricerca per indirizzo di posta; chi non è nel tenant → 404
    await api('POST', '/api/teams/chats', { emails: ['Giulia@almacis.it'] });
    assert.equal(graphCalls.at(-1).body.members[1]['user@odata.bind'], "https://graph.microsoft.com/v1.0/users('g-oid')");
    await api('POST', '/api/teams/chats', { emails: ['giulia@almacis.it', 'marco@almacis.it'] });
    assert.equal(graphCalls.at(-1).body.chatType, 'group');
    assert.equal((await api('POST', '/api/teams/chats', { emails: ['esterno@gmail.com'] })).status, 404);

    assert.equal((await api('POST', '/api/mail/send', { to: [], subject: 'x' })).status, 400);
    assert.equal((await api('POST', '/api/mail/send', { to: ['non-email'], subject: 'x' })).status, 400);
    const mail = await api('POST', '/api/mail/send', { to: ['Giulia@almacis.it'], subject: 'Gara', text: 'Ciao\nGiulia' });
    assert.equal(mail.status, 200);
    const m = graphCalls.at(-1);
    assert.equal(m.path, '/v1.0/me/sendMail');
    assert.equal(m.body.message.toRecipients[0].emailAddress.address, 'giulia@almacis.it');
    assert.match(m.body.message.body.content, /Ciao<br>Giulia/);
    assert.equal(m.body.saveToSentItems, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
