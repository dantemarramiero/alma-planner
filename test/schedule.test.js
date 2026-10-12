// Gantt come Microsoft Project: collegamenti FS/SS/FF/SF con scarto in giorni lavorativi e programmazione automatica.
// Calendario: ottobre 2026, 12 = lunedì, nessun festivo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { addWorkdays, workdaysBetween } = require('../lib/workdays');
const { backfillLags } = require('../lib/schedule');

let server, base, db, cookie;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
}
const task = async (title, start_date, due_date, extra = {}) => (await api('POST', '/api/tickets', { title, start_date, due_date, ...extra })).body;
const get = async id => (await api('GET', `/api/tickets/${id}`)).body;
const dates = t => [t.start_date, t.due_date];

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/auth/dev-login?email=pm@almacis.it`, { redirect: 'manual' });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  server?.close();
  await db?.close();
});

test('giorni lavorativi: addWorkdays e workdaysBetween sono uno l\'inverso dell\'altro', () => {
  assert.equal(addWorkdays('2026-10-16', 1), '2026-10-19'); // venerdì → lunedì
  assert.equal(workdaysBetween('2026-10-16', '2026-10-19'), 1);
  assert.equal(workdaysBetween('2026-10-19', '2026-10-16'), -1);
  for (const n of [-7, -1, 0, 3, 12]) assert.equal(workdaysBetween('2026-10-14', addWorkdays('2026-10-14', n)), n);
});

test('spostando il capo i collegati lo seguono a catena mantenendo scarti e durata', async () => {
  const a = await task('Rilievo', '2026-10-12', '2026-10-14');
  const b = await task('Progetto', '2026-10-19', '2026-10-21'); // 2 gg lavorativi dopo la fine di A
  const c = await task('Computo', '2026-10-22', '2026-10-23');  // subito dopo B
  // collegamenti di prima della 016 (lag NULL): all'avvio prendono lo scarto di oggi e non si muove niente
  await db.query("INSERT INTO ticket_deps (ticket_id, depends_on_id, type, lag) VALUES ($1, $2, 'FS', NULL), ($3, $1, 'FS', NULL)", [b.id, a.id, c.id]);
  await backfillLags(db);
  assert.deepEqual((await get(b.id)).links, [{ id: a.id, type: 'FS', lag: 2 }]);
  assert.deepEqual(dates(await get(b.id)), ['2026-10-19', '2026-10-21']);

  // A avanti di 3 giorni lavorativi (fine da mercoledì 14 a lunedì 19)
  const r = await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-15', due_date: '2026-10-19' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rescheduled.map(m => m.id).sort(), [b.id, c.id].sort());
  assert.deepEqual(dates(await get(b.id)), ['2026-10-22', '2026-10-26']); // ancora 2 gg dopo, 3 gg di durata (scavalca il weekend)
  assert.deepEqual(dates(await get(c.id)), ['2026-10-27', '2026-10-28']);

  // e indietro: tornano esattamente dov'erano
  await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-12', due_date: '2026-10-14' });
  assert.deepEqual(dates(await get(b.id)), ['2026-10-19', '2026-10-21']);
  assert.deepEqual(dates(await get(c.id)), ['2026-10-22', '2026-10-23']);
});

test('più predecessori: conta il vincolo più tardo; un\'attività completata non si sposta', async () => {
  const a = await task('Muri', '2026-10-12', '2026-10-13');
  const b = await task('Impianti', '2026-10-12', '2026-10-16');
  const c = await task('Collaudo', '2026-10-12', '2026-10-12');
  const r = await api('PATCH', `/api/tickets/${c.id}`, { depends_on: [{ id: a.id, type: 'FS', lag: 0 }, { id: b.id, type: 'FS', lag: 0 }] });
  assert.deepEqual(dates(r.body), ['2026-10-19', '2026-10-19']); // dopo la fine di Impianti (venerdì 16) → lunedì
  assert.deepEqual(r.body.links.map(l => l.id), [a.id, b.id].sort((x, y) => x - y));

  await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-12', due_date: '2026-10-20' }); // Muri ora finisce dopo
  assert.deepEqual(dates(await get(c.id)), ['2026-10-21', '2026-10-21']);

  await api('PATCH', `/api/tickets/${c.id}`, { status: 'done' });
  await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-12', due_date: '2026-10-27' });
  assert.deepEqual(dates(await get(c.id)), ['2026-10-21', '2026-10-21']);
});

test('tipi SS, FF, SF, scarto negativo, milestone; spostare a mano un successore cambia il suo scarto', async () => {
  const a = await task('Fondazioni', '2026-10-12', '2026-10-16');
  const link = (title, s, d, links) => api('POST', '/api/tickets', { title, start_date: s, due_date: d, depends_on: links }).then(r => r.body);
  const ss = await link('Direzione lavori', '2026-10-01', '2026-10-02', [{ id: a.id, type: 'SS', lag: 1 }]);
  assert.deepEqual(dates(ss), ['2026-10-13', '2026-10-14']);
  const ff = await link('Verbale', '2026-10-01', '2026-10-01', [{ id: a.id, type: 'FF', lag: 0 }]);
  assert.deepEqual(dates(ff), ['2026-10-16', '2026-10-16']);
  const sf = await link('Permesso', '2026-10-01', '2026-10-02', [{ id: a.id, type: 'SF', lag: 0 }]);
  assert.deepEqual(dates(sf), ['2026-10-08', '2026-10-09']); // finisce il giorno lavorativo prima dell'inizio di A
  const lead = await link('Ordini', '2026-10-01', '2026-10-01', [{ id: a.id, type: 'FS', lag: -2 }]);
  assert.deepEqual(dates(lead), ['2026-10-15', '2026-10-15']); // anticipo: 2 giorni prima della fine
  const ms = await link('Consegna', null, '2026-10-01', [a.id]);
  assert.deepEqual(dates(ms), [null, '2026-10-16']); // milestone: nel giorno della fine

  // il successore spostato a mano resta lì: il collegamento prende il nuovo scarto e da lì in poi lo mantiene
  await api('PATCH', `/api/tickets/${ss.id}`, { start_date: '2026-10-15', due_date: '2026-10-16' });
  assert.deepEqual((await get(ss.id)).links, [{ id: a.id, type: 'SS', lag: 3 }]);
  await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-19', due_date: '2026-10-23' });
  assert.deepEqual(dates(await get(ss.id)), ['2026-10-22', '2026-10-23']);
  assert.deepEqual(dates(await get(ms.id)), [null, '2026-10-23']);
});

test('barra spostata nel Gantt: la durata resta in giorni lavorativi anche scavalcando il weekend', async () => {
  const a = await task('Scavi', '2026-10-13', '2026-10-16'); // mar–ven, 4 giorni lavorativi
  const b = (await api('POST', '/api/tickets', { title: 'Getto', start_date: '2026-10-19', due_date: '2026-10-19', depends_on: [a.id] })).body;
  const r = await api('PATCH', `/api/tickets/${a.id}`, { start_date: '2026-10-17', due_date: '2026-10-20', keep_duration: true }); // trascinata a sabato
  assert.deepEqual(dates(r.body), ['2026-10-19', '2026-10-22']); // parte lunedì, sempre 4 giorni
  assert.deepEqual(dates(await get(b.id)), ['2026-10-23', '2026-10-23']);
});

test('un client che manda solo gli id non azzera tipo e scarto; i cicli restano vietati', async () => {
  const a = await task('Uno', '2026-10-12', '2026-10-12');
  const b = (await api('POST', '/api/tickets', { title: 'Due', depends_on: [{ id: a.id, type: 'SS', lag: 4 }] })).body;
  await api('PATCH', `/api/tickets/${b.id}`, { title: 'Due bis', depends_on: [a.id] });
  assert.deepEqual((await get(b.id)).links, [{ id: a.id, type: 'SS', lag: 4 }]);
  assert.equal((await api('PATCH', `/api/tickets/${a.id}`, { depends_on: [b.id] })).status, 400);
  assert.equal((await api('PATCH', `/api/tickets/${b.id}`, { depends_on: [{ id: a.id, type: 'XX' }] })).status, 400);
});
