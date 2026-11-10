// Alma Strategy: inviti all'A3 (email con l'A3 e la nota), un solo Gantt (inizio della contromisura = inizio del
// ticket), Hoshin Kanri di più anni e decisione di fine anno sugli A3. Usa l'Outlook finto per le email.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { installFakeOutlook } = require('./fake-outlook');

let server, base, db, fake, A, L, O, ids = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);

before(async () => {
  db = await createDb({});
  const { app, auth } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'dante.marramiero@almacis.it' }), { db });
  fake = installFakeOutlook({ auth });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = as(await login('dante.marramiero@almacis.it'));
  L = as(await login('luca.bianchi@almacis.it'));
  O = as(await login('ospite.prova@almacis.it'));
  for (const [k, who] of [['dante', A], ['luca', L], ['ospite', O]]) ids[k] = (await who('GET', '/api/me')).body.id;
});

after(async () => {
  fake?.restore();
  server?.closeAllConnections?.();
  server?.close();
  await db?.close();
});

const year = async (y = 2026) => (await A('GET', `/api/strategy?year=${y}`)).body;

test('invito all’A3: entra nel team e riceve una email allegra con l’A3 e la nota', async () => {
  const p = (await year()).projects.find(x => x.name === 'Gestione di commessa 2.0');
  assert.equal((await O('POST', `/api/strategy/projects/${p.id}/invite`, { user_ids: [ids.luca] })).status, 403, 'solo chi lavora sull’A3 invita');
  const prev = await A('POST', `/api/strategy/projects/${p.id}/invite/preview`, { note: 'Ci serve il tuo occhio sui costi', user_id: ids.luca });
  assert.match(prev.body.html, /Ci serve il tuo occhio sui costi/);
  const before = fake.sentMail.length;
  const r = await A('POST', `/api/strategy/projects/${p.id}/invite`, { user_ids: [ids.luca], note: 'Ci serve il tuo occhio sui costi' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.invited, r.body.emailed], [1, 1]);
  const mail = fake.sentMail.slice(before).find(m => m.message.toRecipients[0].emailAddress.address === 'luca.bianchi@almacis.it');
  assert.ok(mail, 'email partita dalla casella di chi invita');
  assert.equal(mail.from, ids.dante);
  assert.match(mail.message.subject, /ti invita nell’A3 «Gestione di commessa 2\.0»/);
  const html = mail.message.body.content;
  assert.match(html, /benvenuto a bordo/);
  assert.match(html, /Ci serve il tuo occhio sui costi/);
  assert.match(html, /Countermeasures/);
  assert.match(html, /#\/strategy\/a3\//);
  // ora Luca è nel team: vede il progetto da membro e può lavorare sull'A3
  assert.equal((await L('GET', `/api/projects/${r.body.project_id}`)).body.my_role, 'member');
  assert.equal((await L('GET', '/api/strategy?year=2026')).body.projects.find(x => x.id === p.id).can_edit, true);
  const inv = (await A('GET', `/api/strategy/projects/${p.id}/invites`)).body;
  assert.equal(inv[0].name, 'Luca Bianchi');
  assert.equal(inv[0].emailed, true);
});

test('un solo Gantt: l’inizio della contromisura e quello del ticket sono la stessa data, nei due versi', async () => {
  const p = (await year()).projects.find(x => x.name === 'Gestione di commessa 2.0');
  const t = (await year()).projects.find(x => x.id === p.id).tasks[0];
  assert.ok(t.ticket_id);
  assert.equal((await A('PATCH', `/api/strategy/tasks/${t.id}`, { start_date: '2026-02-02' })).status, 200);
  assert.equal((await A('GET', `/api/tickets/${t.ticket_id}`)).body.start_date, '2026-02-02');
  // spostato nel Gantt del progetto → la contromisura segue
  assert.equal((await A('PATCH', `/api/tickets/${t.ticket_id}`, { start_date: '2026-02-09' })).status, 200);
  assert.equal((await year()).projects.find(x => x.id === p.id).tasks.find(x => x.id === t.id).start_date, '2026-02-09');
});

test('anni dell’Hoshin Kanri: il 2027 si crea dal 2026 (struttura sì, A3 no) e non nasce da solo', async () => {
  assert.equal((await A('GET', '/api/strategy?year=2027')).status, 404, 'aprire un anno non lo crea');
  assert.equal((await L('POST', '/api/strategy/years', { year: 2027 })).status, 403);
  assert.equal((await A('POST', '/api/strategy/years', { year: 2027 })).status, 201);
  assert.equal((await A('POST', '/api/strategy/years', { year: 2027 })).status, 409);
  const y26 = await year(2026), y27 = await year(2027);
  assert.equal(y27.true_north, y26.true_north);
  assert.equal(y27.pillars.length, y26.pillars.length);
  assert.equal(y27.functions.length, y26.functions.length);
  assert.equal(y27.areas.length, y26.areas.length);
  assert.deepEqual(y27.kpis.map(k => k.letter), y26.kpis.map(k => k.letter));
  assert.ok(y27.kpis.every(k => !k.monthly?.length), 'i valori mensili ripartono da zero');
  assert.equal(y27.projects.length, 0);
  assert.equal(y26.next_year_exists, true);
  const years = (await A('GET', '/api/strategy/years')).body.years.map(r => r.year);
  assert.deepEqual(years, [2026, 2027]);
});

test('fine anno: chiudere, proseguire fuori o entrare nel 2027 (stesse contromisure e stessi ticket)', async () => {
  const y26 = await year(2026);
  const [a, b, c] = y26.projects.filter(p => p.status !== 'concluso');
  assert.equal((await O('POST', `/api/strategy/projects/${a.id}/carry`, { decision: 'chiuso' })).status, 403);
  assert.equal((await A('POST', `/api/strategy/projects/${a.id}/carry`, { decision: 'chiuso' })).body.carry, 'chiuso');
  assert.equal((await year(2026)).projects.find(p => p.id === a.id).status, 'concluso');
  // fuori: resta del 2026, ma il 2027 lo mostra tra gli A3 che proseguono fuori dall'Hoshin Kanri
  assert.equal((await A('POST', `/api/strategy/projects/${b.id}/carry`, { decision: 'fuori' })).body.carry, 'fuori');
  assert.ok((await year(2027)).outside.some(p => p.id === b.id));
  assert.ok(!(await year(2027)).projects.some(p => p.id === b.id));
  // inserito: copia nel 2027 nella stessa funzione, con le stesse contromisure collegate agli stessi ticket
  await A('POST', `/api/strategy/projects/${c.id}/link`);
  const rr = await A('POST', `/api/strategy/projects/${c.id}/carry`, { decision: 'inserito' });
  const r = rr.body;
  assert.equal(r.carry, 'inserito');
  const y27 = await year(2027);
  const copy = y27.projects.find(p => p.id === r.next_id);
  const orig = (await year(2026)).projects.find(p => p.id === c.id);
  assert.equal(copy.name, orig.name);
  assert.equal(copy.carried_from, c.id);
  assert.equal(copy.project_id, orig.project_id);
  assert.equal(y27.functions.find(f => f.id === y27.areas.find(x => x.id === copy.area_id).function_id).name,
    y26.functions.find(f => f.id === y26.areas.find(x => x.id === orig.area_id).function_id).name);
  assert.deepEqual(copy.tasks.map(t => t.ticket_id), orig.tasks.map(t => t.ticket_id));
  // chiudere la contromisura nel 2027 la chiude anche nel 2026 (e il ticket)
  const t27 = copy.tasks.find(t => !t.closed_date);
  if (t27) {
    await A('PATCH', `/api/strategy/tasks/${t27.id}`, { closed_date: '2027-01-15' });
    assert.equal((await year(2026)).projects.find(p => p.id === c.id).tasks.find(t => t.ticket_id === t27.ticket_id).closed_date, '2027-01-15');
    assert.equal((await A('GET', `/api/tickets/${t27.ticket_id}`)).body.status, 'done');
  }
  // inserito una volta sola; e non si «chiude» più dal 2026
  assert.equal((await A('POST', `/api/strategy/projects/${c.id}/carry`, { decision: 'inserito' })).body.next_id, r.next_id);
  assert.equal((await A('POST', `/api/strategy/projects/${c.id}/carry`, { decision: 'chiuso' })).status, 409);
  const und = (await A('GET', '/api/strategy/years')).body.years.find(x => x.year === 2026).undecided;
  assert.ok(und < y26.projects.length);
});
