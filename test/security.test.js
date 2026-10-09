// Sicurezza: ricontrollo della sessione, uscita, chiave dei token, limiti di frequenza e registro delle azioni.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');

let server, base, db;
let confirmResult = true; // cosa «risponde Microsoft» al ricontrollo: true, false, oppure un Error
const confirmCalls = [];

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}

async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

const userId = async email => (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const ageSessions = id => db.query("UPDATE sessions SET validated_at = now() - interval '13 hours' WHERE user_id = $1", [id]);

before(async () => {
  db = await createDb({});
  const config = readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'admin@almacis.it' });
  const { app } = await createApp(config, {
    db,
    confirmAccount: async id => {
      confirmCalls.push(id);
      if (confirmResult instanceof Error) throw confirmResult;
      return confirmResult;
    },
  });
  server = app.listen(0);
  server.keepAliveTimeout = 60000; // più lungo di quello di fetch (undici, ~4 s): sotto carico il server chiudeva una connessione mentre veniva riusata (ECONNRESET)
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await db?.close();
});

test('sessione ricontrollata da meno di 12 ore: nessuna chiamata a Microsoft', async () => {
  const cookie = await login('fresca@almacis.it');
  confirmCalls.length = 0;
  assert.equal((await api(cookie, 'GET', '/api/me')).status, 200);
  assert.equal(confirmCalls.length, 0);
});

test('account confermato da Microsoft: la sessione resta e il ricontrollo si aggiorna', async () => {
  const cookie = await login('attiva@almacis.it');
  const id = await userId('attiva@almacis.it');
  await ageSessions(id);
  confirmResult = true;
  confirmCalls.length = 0;
  assert.equal((await api(cookie, 'GET', '/api/me')).status, 200);
  assert.deepEqual(confirmCalls, [id]);
  const { rows } = await db.query("SELECT validated_at > now() - interval '1 minute' AS fresh FROM sessions WHERE user_id = $1", [id]);
  assert.equal(rows[0].fresh, true);
  assert.equal((await api(cookie, 'GET', '/api/me')).status, 200);
  assert.equal(confirmCalls.length, 1); // già ricontrollata: non si richiama Microsoft
});

test('account disattivato in Entra: tutte le sessioni e i token vengono revocati', async () => {
  const cookieA = await login('uscita@almacis.it');
  const cookieB = await login('uscita@almacis.it'); // secondo dispositivo
  const id = await userId('uscita@almacis.it');
  await db.query("UPDATE users SET token_cache = 'x' WHERE id = $1", [id]);
  await ageSessions(id);
  confirmResult = false;
  assert.equal((await api(cookieA, 'GET', '/api/me')).status, 401);
  assert.equal((await api(cookieB, 'GET', '/api/me')).status, 401);
  const { rows } = await db.query('SELECT token_cache, (SELECT COUNT(*)::int FROM sessions WHERE user_id = $1) AS n FROM users WHERE id = $1', [id]);
  assert.equal(rows[0].token_cache, null);
  assert.equal(rows[0].n, 0);
  const log = await db.query("SELECT action FROM audit_log WHERE user_id = $1 AND action = 'session_revoked'", [id]);
  assert.equal(log.rows.length, 1);
  confirmResult = true;
});

test('Microsoft irraggiungibile: la sessione resta e non si riprova a ogni richiesta', async () => {
  const cookie = await login('rete@almacis.it');
  const id = await userId('rete@almacis.it');
  await ageSessions(id);
  confirmResult = new Error('ECONNRESET');
  confirmCalls.length = 0;
  assert.equal((await api(cookie, 'GET', '/api/me')).status, 200);
  assert.equal((await api(cookie, 'GET', '/api/me')).status, 200);
  assert.equal(confirmCalls.length, 1);
  confirmResult = true;
});

test('uscita: i token Microsoft si cancellano solo quando non restano altre sessioni', async () => {
  const cookieA = await login('logout@almacis.it');
  const cookieB = await login('logout@almacis.it');
  const id = await userId('logout@almacis.it');
  await db.query("UPDATE users SET token_cache = 'x' WHERE id = $1", [id]);
  const tokens = async () => (await db.query('SELECT token_cache FROM users WHERE id = $1', [id])).rows[0].token_cache;

  assert.equal((await api(cookieA, 'POST', '/auth/logout')).status, 200);
  assert.equal(await tokens(), 'x');
  assert.equal((await api(cookieA, 'GET', '/api/me')).status, 401);
  assert.equal((await api(cookieB, 'GET', '/api/me')).status, 200);

  assert.equal((await api(cookieB, 'POST', '/auth/logout')).status, 200);
  assert.equal(await tokens(), null);
});

test('esci da tutti i dispositivi', async () => {
  const cookieA = await login('tutti@almacis.it');
  const cookieB = await login('tutti@almacis.it');
  assert.equal((await api(cookieA, 'POST', '/auth/logout-all')).status, 200);
  assert.equal((await api(cookieB, 'GET', '/api/me')).status, 401);
});

test('TOKEN_ENC_KEY: le cache cifrate con la chiave vecchia si ricifrano all\'avvio', async () => {
  const config = readConfig({ PORT: '0', SESSION_SECRET: 's1' });
  const old = createAuth({ db, config });
  await db.query("INSERT INTO users (email, name, token_cache) VALUES ('chiave@almacis.it', 'Chiave', $1)", [old.encrypt('{"segreto":1}')]);
  await db.query("INSERT INTO users (email, name, token_cache) VALUES ('rotta@almacis.it', 'Rotta', 'aaa.bbb.ccc')");

  const auth = createAuth({ db, config: { ...config, tokenKey: 'nuova-chiave' } });
  assert.ok(await auth.rekeyTokenCaches() >= 2);
  const { rows } = await db.query("SELECT email, token_cache FROM users WHERE email IN ('chiave@almacis.it', 'rotta@almacis.it') ORDER BY email");
  assert.match(rows[0].token_cache, /^v2\./);
  assert.equal(auth.decrypt(rows[0].token_cache), '{"segreto":1}');
  assert.throws(() => old.decrypt(rows[0].token_cache)); // senza la chiave nuova non si legge
  assert.equal(rows[1].token_cache, null); // illeggibile: l'utente rifà l'accesso
  assert.equal(await auth.rekeyTokenCaches(), 0);
});

test('registro delle azioni: le modifiche si registrano, solo gli amministratori lo leggono', async () => {
  const cookie = await login('autore@almacis.it');
  const p = await api(cookie, 'POST', '/api/projects', { name: 'Registro' });
  assert.equal(p.status, 201);
  await new Promise(r => setTimeout(r, 50)); // la scrittura del registro avviene a risposta inviata

  assert.equal((await api(cookie, 'GET', '/api/admin/audit')).status, 403);
  const admin = await login('admin@almacis.it');
  const log = await api(admin, 'GET', `/api/admin/audit?user=${await userId('autore@almacis.it')}`);
  assert.equal(log.status, 200);
  assert.ok(log.body.some(r => r.action === 'POST /api/projects' && r.status === 201 && r.email === 'autore@almacis.it'));
});

test('limite di frequenza sulle modifiche: oltre 120 al minuto risponde 429', async () => {
  const cookie = await login('fretta@almacis.it');
  let last;
  for (let i = 0; i < 121; i++) last = await api(cookie, 'POST', '/api/notifications/read');
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'rate_limited');
  // un altro utente non è toccato
  const other = await login('calmo@almacis.it');
  assert.notEqual((await api(other, 'POST', '/api/notifications/read')).status, 429);
});

test('limite di frequenza sull\'accesso: oltre 30 al minuto per IP risponde 429', async () => {
  let status;
  for (let i = 0; i < 40; i++) {
    status = (await fetch(`${base}/auth/dev-login?email=raffica@almacis.it`, { redirect: 'manual' })).status;
  }
  assert.equal(status, 429);
});
