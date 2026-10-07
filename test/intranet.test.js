// Test dell'intranet: post, commenti, mi piace, menzioni, storie, profili e tempo reale, con tre colleghi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { purgeMedia } = require('../lib/media');

let server, base, db;
const users = {};

// JPEG minimo valido (1×1).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}

async function api(who, method, path, body, { raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: users[who].cookie, 'X-Alma': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
}

const upload = who => api(who, 'POST', '/api/media?w=1&h=1', JPEG, { raw: true, headers: { 'Content-Type': 'image/jpeg' } });

before(async () => {
  db = await createDb({});
  const config = readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'anna.rossi@almacis.it' });
  const { app } = await createApp(config, { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [key, email] of [['anna', 'anna.rossi@almacis.it'], ['luca', 'luca.bianchi@almacis.it'], ['sara', 'sara.verdi@almacis.it']]) {
    users[key] = { cookie: await login(email) };
    users[key].id = (await api(key, 'GET', '/api/me')).body.id;
  }
});

after(async () => {
  server?.closeAllConnections?.();
  server?.close();
  await db?.close();
});

test('profilo: handle dall\'email, presentazione e foto', async () => {
  const me = (await api('anna', 'GET', '/api/me')).body;
  assert.equal(me.handle, 'anna.rossi');
  assert.equal(me.is_admin, true);
  assert.equal((await api('luca', 'GET', '/api/me')).body.is_admin, false);

  const photo = (await upload('anna')).body;
  const upd = (await api('anna', 'PATCH', '/api/me', { bio: 'Project manager', avatar_id: photo.id })).body;
  assert.equal(upd.bio, 'Project manager');
  assert.equal(upd.avatar_id, photo.id);
  // la foto di un altro non si può usare
  assert.equal((await api('luca', 'PATCH', '/api/me', { avatar_id: photo.id })).status, 400);
});

test('immagini: solo formati veri, lette con la sessione', async () => {
  const bad = await api('anna', 'POST', '/api/media', Buffer.from('<svg/>'), { raw: true, headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal(bad.status, 400);
  const m = (await upload('anna')).body;
  const got = await api('luca', 'GET', `/api/media/${m.id}`);
  assert.equal(got.type, 'image/jpeg');
  assert.ok(got.body.equals(JPEG));
  assert.equal((await fetch(`${base}/api/media/${m.id}`)).status, 401);
});

test('post con foto, mi piace, commenti e risposte con notifiche', async () => {
  const m1 = (await upload('anna')).body, m2 = (await upload('anna')).body;
  const created = await api('anna', 'POST', '/api/posts', { body: 'Kickoff del #ProgettoAlfa con @luca.bianchi!', media_ids: [m1.id, m2.id] });
  assert.equal(created.status, 201);
  const p = created.body;
  assert.deepEqual(p.media.map(x => x.id), [m1.id, m2.id]);

  // vuoto o con la foto di un altro: rifiutato
  assert.equal((await api('luca', 'POST', '/api/posts', { body: '' })).status, 400);
  assert.equal((await api('luca', 'POST', '/api/posts', { media_ids: [m1.id] })).status, 400);

  // menzione → notifica a Luca
  let notes = (await api('luca', 'GET', '/api/notifications')).body;
  assert.equal(notes[0].kind, 'mention');
  assert.equal(notes[0].actor_id, users.anna.id);

  // mi piace (due volte = uno), poi tolto: la notifica sparisce
  await api('luca', 'POST', `/api/posts/${p.id}/like`);
  const liked = (await api('luca', 'POST', `/api/posts/${p.id}/like`)).body;
  assert.deepEqual(liked, { liked: true, like_count: 1 });
  assert.equal((await api('anna', 'GET', '/api/badges')).body.notifications, 1);
  await api('luca', 'DELETE', `/api/posts/${p.id}/like`);
  assert.equal((await api('anna', 'GET', '/api/badges')).body.notifications, 0);
  await api('sara', 'POST', `/api/posts/${p.id}/like`);

  // commento di Luca, risposta di Sara alla risposta → resta di un livello
  const c1 = (await api('luca', 'POST', `/api/posts/${p.id}/comments`, { body: 'Ci sono!' })).body;
  const r1 = (await api('anna', 'POST', `/api/posts/${p.id}/comments`, { body: '@luca.bianchi perfetto', parent_id: c1.id })).body;
  const r2 = (await api('sara', 'POST', `/api/posts/${p.id}/comments`, { body: 'Anche io', parent_id: r1.id })).body;
  assert.equal(r1.parent_id, c1.id);
  assert.equal(r2.parent_id, c1.id);

  notes = (await api('luca', 'GET', '/api/notifications')).body;
  // a Luca: la risposta di Anna, una sola notifica anche se è pure menzionato; Sara ha risposto ad Anna, non a lui
  assert.deepEqual(notes.slice(0, 2).map(n => [n.kind, n.actor_id]), [['reply', users.anna.id], ['mention', users.anna.id]]);
  assert.equal(notes.filter(n => n.comment_id === r1.id).length, 1);
  const annaNotes = (await api('anna', 'GET', '/api/notifications')).body;
  assert.deepEqual(annaNotes.slice(0, 2).map(n => [n.kind, n.actor_id]), [['reply', users.sara.id], ['comment', users.luca.id]]);

  await api('anna', 'POST', `/api/comments/${c1.id}/like`);
  const detail = (await api('anna', 'GET', `/api/posts/${p.id}`)).body;
  assert.equal(detail.comment_count, 3);
  assert.equal(detail.like_count, 1);
  assert.equal(detail.comments.find(c => c.id === c1.id).like_count, 1);
  assert.equal(detail.recent_comments.length, 2);

  // cancellare: Sara non può cancellare il commento di Luca, Anna sì (è il suo post)
  assert.equal((await api('sara', 'DELETE', `/api/comments/${c1.id}`)).status, 403);
  assert.equal((await api('anna', 'DELETE', `/api/comments/${c1.id}`)).status, 200);
  assert.equal((await api('anna', 'GET', `/api/posts/${p.id}`)).body.comment_count, 0); // le risposte vanno con il commento

  // hashtag e profilo
  const tagged = (await api('sara', 'GET', '/api/feed?tag=progettoalfa')).body;
  assert.deepEqual(tagged.posts.map(x => x.id), [p.id]);
  assert.equal((await api('sara', 'GET', '/api/feed?tag=progetto')).body.posts.length, 0);
  const prof = (await api('sara', 'GET', `/api/profiles/${users.anna.id}`)).body;
  assert.equal(prof.post_count, 1);
  assert.equal(prof.likes_received, 1);
  assert.equal(prof.posts[0].media_count, 2);
});

test('bacheca a pagine, post in evidenza solo per gli amministratori', async () => {
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push((await api('luca', 'POST', '/api/posts', { body: `Post ${i}` })).body.id);
  const page1 = (await api('sara', 'GET', '/api/feed')).body;
  assert.equal(page1.posts.length, 10);
  assert.equal(page1.posts[0].id, ids[11]);
  const page2 = (await api('sara', 'GET', `/api/feed?before=${page1.next}`)).body;
  assert.ok(page2.posts.every(p => p.id < page1.next));

  assert.equal((await api('luca', 'POST', `/api/posts/${ids[0]}/pin`)).status, 403);
  assert.ok((await api('anna', 'POST', `/api/posts/${ids[0]}/pin`)).body.pinned_at);
  const feed = (await api('sara', 'GET', '/api/feed')).body;
  assert.deepEqual(feed.pinned.map(p => p.id), [ids[0]]);
  assert.ok(!feed.posts.some(p => p.id === ids[0]));
  assert.equal((await api('luca', 'GET', '/api/notifications')).body[0].kind, 'pin');

  // cancellare: Sara no, l'amministratrice sì
  assert.equal((await api('sara', 'DELETE', `/api/posts/${ids[1]}`)).status, 403);
  assert.equal((await api('anna', 'DELETE', `/api/posts/${ids[1]}`)).status, 200);
});

test('storie: le proprie per prime, viste, scadute nascoste', async () => {
  const m = (await upload('luca')).body;
  const s = (await api('luca', 'POST', '/api/stories', { media_id: m.id, caption: 'In cantiere' })).body;
  const m2 = (await upload('sara')).body;
  await api('sara', 'POST', '/api/stories', { media_id: m2.id });

  let list = (await api('sara', 'GET', '/api/stories')).body;
  assert.deepEqual(list.map(g => g.user_id), [users.sara.id, users.luca.id]);
  assert.equal(list[1].all_seen, false);
  await api('sara', 'POST', `/api/stories/${s.id}/view`);
  list = (await api('sara', 'GET', '/api/stories')).body;
  assert.equal(list[1].all_seen, true);
  const viewers = (await api('luca', 'GET', `/api/stories/${s.id}/viewers`)).body;
  assert.deepEqual(viewers.map(x => x.user_id), [users.sara.id]);
  assert.deepEqual((await api('sara', 'GET', `/api/stories/${s.id}/viewers`)).body, []);

  await db.query("UPDATE stories SET expires_at = now() - interval '2 days' WHERE id = $1", [s.id]);
  list = (await api('sara', 'GET', '/api/stories')).body;
  assert.ok(!list.some(g => g.user_id === users.luca.id));
  await db.query("UPDATE media SET created_at = now() - interval '2 days' WHERE id = $1", [m.id]);
  await purgeMedia(db);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM media WHERE id = $1', [m.id])).rows[0].n, 0);
});

test('migrazione 006: la chat interna non c\'è più', async () => {
  for (const table of ['conversations', 'conversation_members', 'messages']) {
    assert.equal((await db.query(`SELECT to_regclass('${table}') AS t`)).rows[0].t, null);
  }
  assert.equal((await api('anna', 'GET', '/api/conversations')).status, 404);
  assert.deepEqual(Object.keys((await api('anna', 'GET', '/api/badges')).body), ['notifications']);
});

test('tempo reale: un nuovo post arriva agli altri collegati', async () => {
  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/stream`, { headers: { cookie: users.luca.cookie }, signal: ctrl.signal });
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const reader = stream.body.getReader();
  let received = '';
  const waitFor = async text => {
    const until = Date.now() + 3000;
    while (!received.includes(text) && Date.now() < until) {
      const { value } = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({}), 200))]);
      if (value) received += Buffer.from(value).toString();
    }
    return received.includes(text);
  };
  await waitFor('retry');
  const p = (await api('anna', 'POST', '/api/posts', { body: 'Ciao a tutti' })).body;
  assert.ok(await waitFor('event: post'));
  assert.ok(received.includes(`"id":${p.id}`));
  ctrl.abort();
});
