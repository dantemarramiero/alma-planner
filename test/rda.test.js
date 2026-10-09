// RDA interna: si chiede lavoro a un'altra funzione con le ore stimate; solo il responsabile della funzione accetta
// (confermando o cambiando le ore, chi ha chiesto viene avvisato) e assegna al suo team, oppure rifiuta.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db;
const cookies = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie').split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: cookies[who], 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const idOf = async who => (await api(who, 'GET', '/api/me')).body.id;

// Marketing: Marta guida, Mario e Mia le rispondono. Commerciale: Carla guida, Rocco chiede.
const MARTA = 'marta@almacis.it', MARIO = 'mario@almacis.it', MIA = 'mia@almacis.it';
const CARLA = 'carla@almacis.it', ROCCO = 'rocco@almacis.it', ADMIN = 'admin@almacis.it';

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000; // più lungo di quello di fetch (undici, ~4 s): sotto carico il server chiudeva una connessione mentre veniva riusata (ECONNRESET)
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const e of [MARTA, MARIO, MIA, CARLA, ROCCO, ADMIN]) await login(e);
  const people = [
    ['o-marta', 'Marta Rossi', MARTA, 'Marketing', 'o-ceo'],
    ['o-mario', 'Mario Bianchi', MARIO, 'Marketing', 'o-marta'],
    ['o-mia', 'Mia Verdi', MIA, 'Marketing', 'o-marta'],
    ['o-carla', 'Carla Neri', CARLA, 'Commerciale', 'o-ceo'],
    ['o-rocco', 'Rocco Gialli', ROCCO, 'Commerciale', 'o-carla'],
    ['o-ceo', 'Amministratore Delegato', 'ceo@almacis.it', 'Direzione', null],
  ];
  for (const [oid, name, email, dept, mgr] of people) {
    await db.query('INSERT INTO org_people (oid, name, email, department, manager_oid) VALUES ($1, $2, $3, $4, $5)', [oid, name, email, dept, mgr]);
  }
});

after(async () => {
  server?.close();
  await db?.close();
});

test('le funzioni sono i reparti dell\'organigramma, con il responsabile ricavato da chi risponde a chi', async () => {
  const list = (await api(ROCCO, 'GET', '/api/rda/functions')).body;
  const mkt = list.find(f => f.name === 'Marketing');
  assert.equal(mkt.head.name, 'Marta Rossi');
  assert.equal(mkt.head_source, 'auto');
  assert.equal(mkt.team, undefined); // il team lo vede solo chi guida la funzione
  assert.equal(list.find(f => f.name === 'Commerciale').mine, true);
  assert.equal(list.find(f => f.name === 'Direzione').head.name, 'Amministratore Delegato'); // reparto di una persona sola
  const forMarta = (await api(MARTA, 'GET', '/api/rda/functions')).body.find(f => f.name === 'Marketing');
  assert.equal(forMarta.i_lead, true);
  assert.deepEqual(forMarta.team.map(m => m.name), ['Mario Bianchi', 'Mia Verdi', 'Marta Rossi'].sort((a, b) => a.localeCompare(b, 'it')));
});

test('richiesta: da accettare non è ancora lavoro; solo il responsabile accetta, cambia le ore e assegna al suo team', async () => {
  const [rocco, mario] = [await idOf(ROCCO), await idOf(MARIO)];
  const bad = await api(ROCCO, 'POST', '/api/rda', { title: 'Brochure', function: 'Marketing' });
  assert.equal(bad.status, 400); // le ore stimate servono
  const r = await api(ROCCO, 'POST', '/api/rda', { title: 'Brochure fiera', function: 'Marketing', hours_estimated: '4,5', due_date: '2026-11-10' });
  assert.equal(r.status, 201);
  const t = r.body;
  assert.equal(t.rda_state, 'pending');
  assert.equal(Number(t.hours_estimated), 4.5);

  // non compare tra i ticket di nessuno, nemmeno di chi l'ha chiesta
  assert.ok(!(await api(ROCCO, 'GET', '/api/tickets')).body.some(x => x.id === t.id));
  // ma la vedono chi l'ha chiesta e la responsabile: lui tra le inviate, lei tra quelle da accettare
  assert.ok((await api(ROCCO, 'GET', '/api/rda')).body.sent.some(x => x.id === t.id));
  const marta = (await api(MARTA, 'GET', '/api/rda')).body;
  assert.deepEqual(marta.led, ['Marketing']);
  assert.ok(marta.inbox.some(x => x.id === t.id));
  // notifica alla responsabile
  assert.ok((await api(MARTA, 'GET', '/api/notifications')).body.some(n => n.kind === 'rda_new' && n.ticket_id === t.id));

  // da accettare: niente assegnatari, stato o ore confermate passando dal ticket
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { assignee_ids: [rocco] })).status, 400);
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { status: 'done' })).status, 400);
  // chi chiede può ancora correggere la stima; gli altri no
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { hours_estimated: 5 })).status, 200);

  // accetta solo la responsabile di Marketing, non un membro né un altro responsabile
  assert.equal((await api(MARIO, 'POST', `/api/rda/${t.id}/accept`, { assignee_ids: [mario] })).status, 403);
  assert.equal((await api(CARLA, 'POST', `/api/rda/${t.id}/accept`, { assignee_ids: [mario] })).status, 403);
  // si assegna solo al proprio team
  assert.equal((await api(MARTA, 'POST', `/api/rda/${t.id}/accept`, { assignee_ids: [rocco] })).status, 400);
  const ok = await api(MARTA, 'POST', `/api/rda/${t.id}/accept`, { assignee_ids: [mario], hours_approved: 8, note: 'Servono anche le foto' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rda_state, 'accepted');
  assert.equal(Number(ok.body.hours_approved), 8);
  assert.equal((await api(MARTA, 'POST', `/api/rda/${t.id}/accept`, { assignee_ids: [mario] })).status, 400); // già decisa

  // chi ha chiesto è avvisato con le ore (stimate 5 → confermate 8), senza dover riapprovare
  const n = (await api(ROCCO, 'GET', '/api/notifications')).body.find(x => x.kind === 'rda_accepted' && x.ticket_id === t.id);
  assert.equal(Number(n.hours_estimated), 5);
  assert.equal(Number(n.hours_approved), 8);

  // ora è un ticket come gli altri: Mario lo vede tra i suoi, con la nota nei commenti
  const mine = (await api(MARIO, 'GET', '/api/tickets?assignee=me')).body;
  assert.ok(mine.some(x => x.id === t.id));
  const full = (await api(MARIO, 'GET', `/api/tickets/${t.id}`)).body;
  assert.equal(full.comments[0].body, 'Servono anche le foto');

  // le ore confermate le cambia solo la responsabile; la stima non si tocca più
  assert.equal((await api(MARIO, 'PATCH', `/api/tickets/${t.id}`, { hours_approved: 2 })).status, 403);
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { hours_estimated: 1 })).status, 400);
  assert.equal((await api(MARTA, 'PATCH', `/api/tickets/${t.id}`, { hours_approved: 7.5 })).status, 200);

  // fatto: le ore effettive partono da quelle confermate, e si possono correggere
  const done = (await api(MARIO, 'PATCH', `/api/tickets/${t.id}`, { status: 'done' })).body;
  assert.equal(Number(done.hours_actual), 7.5);
  assert.equal(Number((await api(MARIO, 'PATCH', `/api/tickets/${t.id}`, { hours_actual: 9 })).body.hours_actual), 9);
});

test('rifiutata con un motivo: chi ha chiesto lo sa, e non diventa lavoro', async () => {
  const t = (await api(ROCCO, 'POST', '/api/rda', { title: 'Video aziendale', function: 'Marketing', hours_estimated: 40 })).body;
  assert.equal((await api(MARTA, 'POST', `/api/rda/${t.id}/reject`, {})).status, 400); // il motivo serve
  const r = await api(MARTA, 'POST', `/api/rda/${t.id}/reject`, { reason: 'Fuori budget quest\'anno' });
  assert.equal(r.body.rda_state, 'rejected');
  const n = (await api(ROCCO, 'GET', '/api/notifications')).body.find(x => x.kind === 'rda_rejected' && x.ticket_id === t.id);
  assert.equal(n.rda_reject_reason, 'Fuori budget quest\'anno');
  assert.ok(!(await api(ROCCO, 'GET', '/api/tickets')).body.some(x => x.id === t.id));
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { status: 'doing' })).status, 400);
  // ritirarla (cancellarla) resta possibile a chi l'ha fatta
  assert.equal((await api(ROCCO, 'DELETE', `/api/tickets/${t.id}`)).status, 200);
});

test('un amministratore può scegliere il responsabile di una funzione', async () => {
  assert.equal((await api(MARTA, 'PUT', '/api/rda/functions/Marketing/head', { head_oid: 'o-mia' })).status, 403);
  assert.equal((await api(ADMIN, 'PUT', '/api/rda/functions/Marketing/head', { head_oid: 'o-mia' })).status, 200);
  const mkt = (await api(MIA, 'GET', '/api/rda/functions')).body.find(f => f.name === 'Marketing');
  assert.equal(mkt.head.name, 'Mia Verdi');
  assert.equal(mkt.head_source, 'manual');
  await api(ADMIN, 'PUT', '/api/rda/functions/Marketing/head', { head_oid: null });
  assert.equal((await api(MIA, 'GET', '/api/rda/functions')).body.find(f => f.name === 'Marketing').head.name, 'Marta Rossi');
});

test('le ore si usano solo nelle RDA; un ticket normale non cambia', async () => {
  const t = (await api(ROCCO, 'POST', '/api/tickets', { title: 'Normale' })).body;
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { hours_actual: 3 })).status, 400);
  assert.equal((await api(ROCCO, 'PATCH', `/api/tickets/${t.id}`, { status: 'done' })).status, 200);
});
