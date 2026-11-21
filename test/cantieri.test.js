// Storie dai cantieri (Dante 21/11/2026; cantieri = commesse BOSS, BSAL-1725): elenco con il più vicino e la mia squadra,
// foto → diario + storia 24 ore + un post al giorno per cantiere in «Dai cantieri», nascondi, zip per il SAL,
// pulizia delle immagini che non tocca il diario, sincronizzazione da BOSS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { purgeMedia } = require('../lib/media');
const { syncFromBoss, meters } = require('../routes/cantieri');

let server, base, db, DIR, LUCA, SARA, ALTRO;
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body, { raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(raw ? { 'Content-Type': 'image/jpeg' } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, buf, body: type.includes('json') ? JSON.parse(buf.toString() || 'null') : buf.toString() };
};
const photo = async who => (await who('POST', '/api/media', null, { raw: JPEG })).body.id;

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'direzione@almacis.it' }), { db, pushSender: async () => {} });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  DIR = as(await login('direzione@almacis.it'));
  LUCA = as(await login('luca.marino@almacis.it'));
  SARA = as(await login('sara.rossi@almacis.it'));
  ALTRO = as(await login('paolo.conti@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('cantieri: li inserisce solo la direzione; il più vicino viene prima, poi quelli della mia squadra', async () => {
  assert.equal((await LUCA('POST', '/api/cantieri', { code: 'X', name: 'X' })).status, 403);
  const a = await DIR('POST', '/api/cantieri', { code: '2026-041', name: 'Montesilvano scuola', lat: 42.5130, lng: 14.1440, chief_email: 'Luca.Marino@almacis.it', member_emails: ['sara.rossi@almacis.it'] });
  assert.equal(a.status, 201);
  assert.equal(a.body.chief_email, 'luca.marino@almacis.it');
  assert.equal((await DIR('POST', '/api/cantieri', { code: '2026-041', name: 'doppione' })).status, 409);
  await DIR('POST', '/api/cantieri', { code: '2026-050', name: 'Pescara porto', lat: 42.4680, lng: 14.2200 });
  await DIR('POST', '/api/cantieri', { code: '2025-009', name: 'Chiuso', status: 'chiuso' });
  // Sara vicino al porto: prima il porto (entro 500 m), poi il suo cantiere
  const near = (await SARA('GET', '/api/cantieri?lat=42.4682&lng=14.2203')).body;
  assert.deepEqual(near.cantieri.map(c => c.code), ['2026-050', '2026-041']);
  assert.ok(near.cantieri[0].distance < 100);
  assert.ok(near.cantieri[1].mine);
  // lontano da tutto: la sua squadra prima
  assert.equal((await SARA('GET', '/api/cantieri')).body.cantieri[0].code, '2026-041');
  assert.equal((await SARA('GET', '/api/cantieri?tutti=1')).body.cantieri.length, 3);
  assert.equal(meters({ lat: 42, lng: 14 }, { lat: 42, lng: 14 }), 0);
});

test('foto: diario per sempre, storia 24 ore, un post al giorno per cantiere in «Dai cantieri»', async () => {
  const c = (await SARA('GET', '/api/cantieri')).body.cantieri.find(x => x.code === '2026-041');
  const altrui = await photo(LUCA);
  assert.equal((await SARA('POST', `/api/cantieri/${c.id}/foto`, { media_id: altrui })).status, 400); // la foto deve essere mia
  const r1 = await SARA('POST', `/api/cantieri/${c.id}/foto`, { media_id: await photo(SARA), caption: 'Getto del solaio', lat: 42.513, lng: 14.144 });
  assert.equal(r1.status, 201);
  const r2 = await LUCA('POST', `/api/cantieri/${c.id}/foto`, { media_id: altrui });
  assert.equal(r2.body.post_id, r1.body.post_id); // stesso giorno, stesso post
  const feed = (await ALTRO('GET', '/api/feed?filter=cantieri')).body;
  const posts = feed.posts || feed;
  const p = posts.find(x => x.id === r1.body.post_id);
  assert.ok(p, 'il post del cantiere è in «Dai cantieri»');
  assert.equal(p.kind, 'cantiere');
  assert.equal(p.cantiere_name, 'Montesilvano scuola');
  assert.equal(p.media.length, 2);
  assert.equal(p.cantiere_people, 2);
  assert.match(p.body, /^Sara: Getto del solaio/); // il nome e non il cognome (lib/nome.js)
  const storie = (await ALTRO('GET', '/api/cantieri/storie')).body.storie;
  assert.equal(storie.length, 1);
  assert.equal(storie[0].photos.length, 2);
  const diario = (await ALTRO('GET', `/api/cantieri/${c.id}/diario`)).body;
  assert.equal(diario.stats.photos, 2);
  assert.equal(diario.stats.people, 2);
  assert.equal(diario.days.length, 1);
  assert.equal(diario.can_hide_all, false);
  assert.equal((await LUCA('GET', `/api/cantieri/${c.id}/diario`)).body.can_hide_all, true); // capo cantiere
  const zip = await ALTRO('GET', `/api/cantieri/${c.id}/zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.type, 'application/zip');
  assert.equal(zip.buf.readUInt32LE(0), 0x04034b50);
  // un cantiere chiuso non prende foto
  const chiuso = (await SARA('GET', '/api/cantieri?tutti=1')).body.cantieri.find(x => x.code === '2025-009');
  assert.equal((await SARA('POST', `/api/cantieri/${chiuso.id}/foto`, { media_id: await photo(SARA) })).status, 400);
});

test('nascondi: chi ha scattato, il capo cantiere o la direzione; sparisce da post, storia e diario', async () => {
  const c = (await SARA('GET', '/api/cantieri')).body.cantieri.find(x => x.code === '2026-041');
  const d = (await SARA('GET', `/api/cantieri/${c.id}/diario`)).body;
  const sua = d.days[0].photos.find(x => x.caption === 'Getto del solaio');
  const diLuca = d.days[0].photos.find(x => x.caption === '');
  assert.equal((await ALTRO('POST', `/api/cantieri/foto/${sua.id}/nascondi`)).status, 403);
  assert.equal((await LUCA('POST', `/api/cantieri/foto/${sua.id}/nascondi`)).status, 200); // capo cantiere
  const dopo = (await ALTRO('GET', `/api/cantieri/${c.id}/diario`)).body;
  assert.equal(dopo.stats.photos, 1);
  const feed = (await ALTRO('GET', '/api/feed?filter=cantieri')).body;
  const p = (feed.posts || feed).find(x => x.kind === 'cantiere');
  assert.equal(p.media.length, 1);
  assert.doesNotMatch(p.body, /Getto/);
  // l'ultima foto nascosta: il post del giorno sparisce
  assert.equal((await LUCA('POST', `/api/cantieri/foto/${diLuca.id}/nascondi`)).status, 200);
  const feed2 = (await ALTRO('GET', '/api/feed?filter=cantieri')).body;
  assert.ok(!(feed2.posts || feed2).some(x => x.kind === 'cantiere'));
});

test('la pulizia delle immagini non tocca le foto del diario, nemmeno quelle nascoste', async () => {
  await db.query("UPDATE media SET created_at = now() - interval '3 days'");
  const before = (await db.query('SELECT COUNT(*)::int AS n FROM cantiere_foto')).rows[0].n;
  await purgeMedia(db);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM cantiere_foto')).rows[0].n, before);
});

test('sincronizzazione da BOSS: unisce per codice commessa, BOSS comanda nome, squadra e stato', async () => {
  assert.equal((await syncFromBoss(db, { url: '', token: '' })).ok, false);
  const fake = async () => ({ ok: true, json: async () => ({ commesse: [
    { code: '2026-041', name: 'Scuola Via Roma — Montesilvano', client: 'Comune di Montesilvano', members: ['andrea@almacis.it'], status: 'aperto', chief_email: 'luca.marino@almacis.it' },
    { code: '2026-077', name: 'Nuovo da BOSS', status: 'aperto' },
    { name: 'senza codice' },
  ] }) });
  const out = await syncFromBoss(db, { url: 'http://boss.test/commesse', token: 't', fetchImpl: fake });
  assert.deepEqual(out, { ok: true, cantieri: 2 });
  const { rows } = await db.query("SELECT code, name, source, member_emails, lat FROM cantieri WHERE code IN ('2026-041', '2026-077') ORDER BY code");
  assert.equal(rows[0].name, 'Scuola Via Roma — Montesilvano');
  assert.equal(rows[0].source, 'boss');
  assert.deepEqual(rows[0].member_emails, ['andrea@almacis.it']);
  assert.equal(rows[0].lat, 42.513); // la posizione messa a mano resta se BOSS non la manda
  assert.equal(rows[1].source, 'boss');
  // da BOSS il nome non si cambia in Alma Space
  const c = (await DIR('GET', '/api/cantieri')).body.cantieri.find(x => x.code === '2026-041');
  const p = await DIR('PATCH', `/api/cantieri/${c.id}`, { name: 'altro', address: 'Via Roma 1' });
  assert.equal(p.body.name, 'Scuola Via Roma — Montesilvano');
  assert.equal(p.body.address, 'Via Roma 1');
});
