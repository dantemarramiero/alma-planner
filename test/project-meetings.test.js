// Incontri del calendario nei progetti, con note e file, usando il calendario finto di test/fake-outlook.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { installFakeOutlook } = require('./fake-outlook');

let server, base, db, fake;
const users = {};
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(who, method, path, body, { raw = false } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const calendar = (who, project) => api(who, 'GET', `/api/meetings/calendar?start=${day(-30)}&end=${day(31)}${project ? `&project=${project}` : ''}`);

before(async () => {
  db = await createDb({});
  const { app, auth } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  fake = installFakeOutlook({ auth });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
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

test('calendario: incontri del periodo, senza quelli creati da Alma; ricerca; finestra limitata', async () => {
  const r = await calendar('anna');
  assert.equal(r.status, 200);
  assert.ok(r.body.length > 20);
  const alma = fake.calendar(users.anna.id).filter(e => e.categories.includes('Alma Planet'));
  assert.ok(alma.length > 0);
  assert.ok(!r.body.some(e => alma.some(a => a.id === e.id)));
  assert.match(r.body[0].start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const found = (await api('anna', 'GET', `/api/meetings/calendar?start=${day(-30)}&end=${day(31)}&q=cantiere`)).body;
  assert.ok(found.length > 0 && found.every(e => /cantiere/i.test(`${e.subject} ${e.location}`)));
  assert.equal((await api('anna', 'GET', `/api/meetings/calendar?start=${day(-200)}&end=${day(1)}`)).status, 400);
  assert.equal((await api('anna', 'GET', '/api/meetings/calendar?start=ieri&end=oggi')).status, 400);
});

test('collegare: dati copiati, doppioni saltati anche tra colleghi, occorrenze diverse restano distinte', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Ospedale Teramo' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const cal = fake.calendar(users.anna.id);
  const weekly = cal.filter(e => e.iCalUId === 'cal-cantiere-settimanale' && !e.categories.length).slice(0, 2);
  const one = cal.find(e => e.iCalUId.startsWith('cal-shared-') && !e.categories.length);
  const r = await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [...weekly.map(e => e.id), one.id] });
  assert.equal(r.status, 201);
  assert.equal(r.body.added, 3); // le due occorrenze della riunione settimanale sono due incontri
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [one.id] })).body.already, 1);
  // lo stesso invito nel calendario di Luca: uno solo
  const lucaCopy = fake.calendar(users.luca.id).find(e => e.iCalUId === one.iCalUId && e.start.dateTime === one.start.dateTime);
  assert.equal((await api('luca', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [lucaCopy.id] })).body.already, 1);

  const list = (await api('luca', 'GET', `/api/projects/${p.id}/meetings`)).body;
  assert.equal(list.length, 3);
  const m = list.find(x => x.subject === one.subject && x.start_at === one.start.dateTime.slice(0, 19));
  assert.ok(m);
  const detail = (await api('luca', 'GET', `/api/meetings/${m.id}`)).body;
  assert.equal(detail.organizer_address, 'p.verdi@regione.abruzzo.it');
  assert.equal(detail.attendees.length, 2);
  assert.match(detail.body_text, /Ordine del giorno/);
  assert.equal(detail.web_link, null); // «Apri in Outlook» solo per chi l'ha collegato
  assert.ok((await api('anna', 'GET', `/api/meetings/${m.id}`)).body.web_link);
  // nel calendario risultano già collegati
  const marked = (await calendar('anna', p.id)).body;
  assert.ok(marked.find(e => e.id === one.id).linked);
  assert.ok(marked.some(e => !e.linked));
  // un evento creato da Alma non si collega
  const alma = cal.find(e => e.categories.includes('Alma Planet'));
  assert.equal((await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [alma.id] })).status, 400);
});

test('note e file dell\'incontro: stanno nell\'incontro e nelle note del progetto', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Regione Abruzzo' })).body;
  await api('anna', 'POST', `/api/projects/${p.id}/members`, { user_ids: [users.luca.id] });
  const ev = fake.calendar(users.anna.id).find(e => !e.categories.length && e.start.dateTime.slice(0, 10) < day(0));
  const { ids: [mid] } = (await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [ev.id] })).body;

  // nota con testo e menzione
  const n1 = await api('luca', 'POST', `/api/meetings/${mid}/notes`, { body: 'Deciso di anticipare il getto. @anna prepara il verbale' });
  assert.equal(n1.status, 201);
  assert.equal(n1.body.kind, 'riunione');
  assert.equal(n1.body.note_date, ev.start.dateTime.slice(0, 10));
  assert.equal(n1.body.title, ev.subject);
  assert.equal(n1.body.meeting_id, mid);
  assert.deepEqual(n1.body.mentions.notified, [users.anna.id]);

  // solo file: la nota nasce vuota e poi riceve il file
  assert.equal((await api('anna', 'POST', `/api/meetings/${mid}/notes`, { body: '' })).status, 400);
  const n2 = (await api('anna', 'POST', `/api/meetings/${mid}/notes`, { body: '', with_files: true })).body;
  const up = await api('anna', 'POST', `/api/notes/${n2.id}/files?name=${encodeURIComponent('verbale sopralluogo.pdf')}&type=application/pdf`, Buffer.from('%PDF-1.4 verbale'), { raw: true });
  assert.equal(up.status, 201);
  // i file li aggiunge chi ha scritto la nota
  assert.equal((await api('luca', 'POST', `/api/notes/${n2.id}/files?name=x.txt`, Buffer.from('x'), { raw: true })).status, 403);

  const detail = (await api('luca', 'GET', `/api/meetings/${mid}`)).body;
  assert.equal(detail.notes.length, 2);
  const withFile = detail.notes.find(n => n.id === n2.id);
  assert.equal(withFile.files.length, 1);
  assert.equal(withFile.files[0].name, 'verbale sopralluogo.pdf');

  // le stesse note nel tab Note del progetto, con il richiamo all'incontro e i file
  const notes = (await api('luca', 'GET', `/api/projects/${p.id}/notes`)).body;
  const same = notes.find(n => n.id === n2.id);
  assert.equal(same.meeting_id, mid);
  assert.equal(same.meeting_subject, ev.subject);
  assert.equal(same.meeting_start, ev.start.dateTime.slice(0, 19));
  assert.equal(same.files.length, 1);
  const list = (await api('luca', 'GET', `/api/projects/${p.id}/meetings`)).body;
  assert.equal(list[0].note_count, 2);
  assert.equal(list[0].file_count, 1);

  // scaricare: chi vede il progetto sì, gli altri no
  const file = await api('luca', 'GET', `/api/note-files/${up.body.id}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/octet-stream');
  assert.match(file.headers.get('content-disposition'), /^attachment;/);
  assert.equal(file.body.toString(), '%PDF-1.4 verbale');
  assert.equal((await api('ext', 'GET', `/api/note-files/${up.body.id}`)).status, 404);
  assert.equal((await api('luca', 'DELETE', `/api/note-files/${up.body.id}`)).status, 403);
  assert.equal((await api('anna', 'DELETE', `/api/note-files/${up.body.id}`)).status, 200);

  // togliere l'incontro non cancella le note: restano nel progetto
  assert.equal((await api('luca', 'DELETE', `/api/meetings/${mid}`)).status, 403); // l'ha collegato Anna
  assert.equal((await api('anna', 'DELETE', `/api/meetings/${mid}`)).status, 200);
  const after = (await api('anna', 'GET', `/api/projects/${p.id}/notes`)).body;
  assert.equal(after.filter(n => n.id === n1.body.id || n.id === n2.id).length, 2);
  assert.ok(after.every(n => n.meeting_id === null));
});

test('permessi: chi non vede il progetto non vede, non collega e non scrive', async () => {
  const p = (await api('anna', 'POST', '/api/projects', { name: 'Comune Pescara' })).body;
  const ev = fake.calendar(users.anna.id).find(e => !e.categories.length);
  const { ids: [mid] } = (await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [ev.id] })).body;
  assert.equal((await api('ext', 'GET', `/api/projects/${p.id}/meetings`)).status, 404);
  assert.equal((await api('ext', 'GET', `/api/meetings/${mid}`)).status, 404);
  assert.equal((await api('ext', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: ['x'] })).status, 404);
  assert.equal((await api('ext', 'POST', `/api/meetings/${mid}/notes`, { body: 'ciao' })).status, 404);
  assert.equal((await api('ext', 'DELETE', `/api/meetings/${mid}`)).status, 404);
  assert.equal((await api('ext', 'GET', `/api/meetings/calendar?start=${day(-3)}&end=${day(3)}&project=${p.id}`)).status, 404);
  // l'amministratore vede e toglie
  assert.equal((await api('capo', 'GET', `/api/projects/${p.id}/meetings`)).body.length, 1);
  assert.equal((await api('capo', 'DELETE', `/api/meetings/${mid}`)).status, 200);
  // cancellando il progetto spariscono anche gli incontri
  await api('anna', 'POST', `/api/projects/${p.id}/meetings`, { event_ids: [ev.id] });
  await api('anna', 'DELETE', `/api/projects/${p.id}`);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM project_meetings WHERE project_id = $1', [p.id])).rows[0].n, 0);
});
