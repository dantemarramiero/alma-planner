// Ticket IT (11/11/2026): chi segnala, il team IT che smista (prendo io, rispondi e chiudi, manda a Linear) e
// lo stato che torna da Linear con la notifica a chi ha segnalato. Linear è simulato.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { suggest, refreshLinear } = require('../lib/it-tickets');
const linear = require('../lib/linear');

let server, base, db, ADMIN, ANNA, anna;
const ADMIN_EMAIL = 'dante@almacis.it';

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

before(async () => {
  delete process.env.LINEAR_API_KEY;
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN_EMAIL }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.exec(`INSERT INTO org_people (oid, name, email, department) VALUES ('o-anna', 'Anna Rossi', 'anna@almacis.it', 'Cantieri'),
    ('o-dante', 'Dante', 'dante@almacis.it', 'IT - Sistemi Informativi')`); // il team IT riceve le segnalazioni
  ADMIN = as(await login(ADMIN_EMAIL));
  ANNA = as(await login('anna@almacis.it'));
  anna = (await ANNA('GET', '/api/me')).body;
});

after(async () => {
  server?.close();
  await db?.close();
  delete process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_TEAM;
});

const notes = async userId => (await db.query("SELECT body FROM notifications WHERE user_id = $1 AND kind = 'it' ORDER BY id", [userId])).rows.map(r => r.body);

test('proposta di tipo e priorità dal testo', () => {
  assert.deepEqual(suggest('Il portatile non si collega alla VPN'), { category: 'Rete e VPN', priority: 'alta' });
  assert.deepEqual(suggest('Stampante del secondo piano', 'è bloccata, urgente'), { category: 'Stampanti', priority: 'urgente' });
  assert.deepEqual(suggest('Mi serve una mano col monitor'), { category: 'Computer e telefono', priority: 'media' });
  assert.equal(suggest('Domanda generica').category, 'Altro');
});

test('senza Linear: segnalo, il team IT prende in carico e chiude con una risposta; solo il team vede la pagina', async () => {
  const r = await ANNA('POST', '/api/it/tickets', { title: 'Il portatile non si collega alla VPN', body: 'Da stamattina' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.category, r.body.priority], ['Rete e VPN', 'alta']);
  assert.equal((await ANNA('POST', '/api/it/tickets', { title: '' })).status, 400);
  assert.equal((await ANNA('GET', '/api/software/tickets')).status, 403);

  const admin = (await ADMIN('GET', '/api/me')).body;
  assert.ok((await notes(admin.id)).some(b => b.includes('Il portatile non si collega alla VPN')));
  const page = (await ADMIN('GET', '/api/software/tickets')).body;
  assert.deepEqual([page.linear.configured, page.board], [false, null]);
  const t = page.tickets.find(x => x.id === r.body.id);
  assert.deepEqual([t.person_name, t.department, t.status], ['Anna Rossi', 'Cantieri', 'nuovo']);
  assert.equal((await ADMIN('GET', '/api/software')).body.totals.tickets, 1);
  // senza Linear «Manda a Linear» lo dice
  const nolin = await ADMIN('POST', `/api/software/tickets/${t.id}/linear`, {});
  assert.equal(nolin.status, 400);
  assert.match(nolin.body.error, /LINEAR_API_KEY/);

  assert.equal((await ADMIN('POST', `/api/software/tickets/${t.id}/take`)).status, 200);
  assert.equal((await ANNA('POST', `/api/it/tickets/${t.id}/cancel`)).status, 404); // già preso in carico
  assert.equal((await ADMIN('POST', `/api/software/tickets/${t.id}/close`, { answer: 'Rifatto il profilo VPN' })).status, 200);
  const mine = (await ANNA('GET', '/api/it/mine')).body.tickets;
  assert.deepEqual([mine[0].status, mine[0].answer], ['chiuso', 'Rifatto il profilo VPN']);
  assert.deepEqual((await notes(anna.id)).slice(-2), [
    'Dante del team IT ha preso in carico «Il portatile non si collega alla VPN»'.replace('Dante', admin.name),
    `Il team IT ha risolto «Il portatile non si collega alla VPN»: Rifatto il profilo VPN`]);

  // annullare si può finché è nuovo
  const r2 = (await ANNA('POST', '/api/it/tickets', { title: 'Mouse rotto' })).body;
  assert.equal((await ANNA('POST', `/api/it/tickets/${r2.id}/cancel`)).status, 200);
  assert.equal((await ADMIN('GET', '/api/software')).body.totals.tickets, 0);
});

test('con Linear: manda a Linear crea l\'issue nel team IT, lo stato torna da solo e chi ha segnalato è avvisato', async () => {
  process.env.LINEAR_API_KEY = 'lin_api_prova';
  process.env.LINEAR_TEAM = 'it';
  linear._reset();
  const issue = { id: 'iss-1', identifier: 'IT-41', title: 'Stampante bloccata', url: 'https://linear.app/almacis/issue/IT-41', priority: 1,
    state: { name: 'Todo', type: 'unstarted' }, assignee: null };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url) !== 'https://api.linear.app/graphql') return realFetch(url, opts);
    const { query, variables } = JSON.parse(opts.body);
    sent.push({ auth: opts.headers.Authorization, query, variables });
    const json = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (query.includes('teams(')) return json({ teams: { nodes: [{ id: 'team-x', key: 'OPS', name: 'Operations' }, { id: 'team-it', key: 'IT', name: 'Sistemi informativi' }] } });
    if (query.includes('issueCreate')) return json({ issueCreate: { success: true, issue } });
    if (query.includes('filter: { id:')) return json({ issues: { nodes: [issue] } });
    return json({ issues: { nodes: [issue] } }); // bacheca del team
  };
  try {
    const t = (await ANNA('POST', '/api/it/tickets', { title: 'Stampante bloccata', body: 'Carta inceppata', priority: 'urgente' })).body;
    const r = (await ADMIN('POST', `/api/software/tickets/${t.id}/linear`, { priority: 'urgente', category: 'Stampanti' })).body;
    assert.deepEqual(r, { identifier: 'IT-41', url: issue.url });
    const create = sent.find(s => s.query.includes('issueCreate'));
    assert.equal(create.auth, 'lin_api_prova');
    assert.deepEqual([create.variables.input.teamId, create.variables.input.priority, create.variables.input.title], ['team-it', 1, 'Stampante bloccata']);
    assert.match(create.variables.input.description, /Segnalato da\*\* Anna Rossi · Cantieri/);

    let page = (await ADMIN('GET', '/api/software/tickets')).body;
    assert.deepEqual([page.linear.configured, page.linear.team.key, page.board.length], [true, 'IT', 1]);
    assert.equal(page.tickets.find(x => x.id === t.id).linear_identifier, 'IT-41');
    // si chiude su Linear, non qui
    assert.equal((await ADMIN('POST', `/api/software/tickets/${t.id}/close`, {})).status, 400);

    // su Linear qualcuno ci lavora, poi lo chiude
    issue.state = { name: 'In Progress', type: 'started' };
    issue.assignee = { name: 'Tiziana' };
    assert.equal(await refreshLinear(db, null), 1);
    assert.equal(await refreshLinear(db, null), 0); // niente di nuovo
    let mine = (await ANNA('GET', '/api/it/mine')).body.tickets.find(x => x.id === t.id);
    assert.deepEqual([mine.status, mine.linear_state, mine.linear_assignee], ['linear', 'In Progress', 'Tiziana']);
    issue.state = { name: 'Done', type: 'completed' };
    page = (await ADMIN('GET', '/api/software/tickets')).body; // anche aprire la pagina allinea
    mine = (await ANNA('GET', '/api/it/mine')).body.tickets.find(x => x.id === t.id);
    assert.equal(mine.status, 'chiuso');
    assert.ok((await notes(anna.id)).includes('Il team IT ha risolto «Stampante bloccata»'));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_TEAM;
    linear._reset();
  }
});
