// Impostazioni uniche: ruoli dall'organigramma, amministratori senza ADMIN_EMAILS, privacy che cambia davvero cosa si
// vede, eccezioni personali, utenti sospesi, registro con prima/dopo, costi AI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { featureOf, describe: describeRow } = require('../routes/impostazioni');

let server, base, db, gov;
const cookies = {};

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  const c = res.headers.get('set-cookie');
  cookies[email] = c ? c.split(';')[0] : null;
  return res.status;
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: cookies[who] || '', 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

const ADMIN = 'dante@almacis.it';
const BOSS = 'luca.bianchi@almacis.it';
const WORKER = 'tommaso.moretti@almacis.it';
const NEWADMIN = 'anna.ricci@almacis.it';

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // organigramma: Dante → Luca (Direttore tecnico) → Tommaso; Anna in Amministrazione
  await db.query(`INSERT INTO org_people (oid, name, email, job_title, department, manager_oid) VALUES
    ('o-dante', 'Dante Marramiero', 'dante@almacis.it', 'CEO', 'Direzione generale', NULL),
    ('o-luca', 'Luca Bianchi', 'luca.bianchi@almacis.it', 'Direttore tecnico', 'Direzione tecnica', 'o-dante'),
    ('o-tom', 'Tommaso Moretti', 'tommaso.moretti@almacis.it', 'Capocantiere', 'BU Costruzioni', 'o-luca'),
    ('o-anna', 'Anna Ricci', 'anna.ricci@almacis.it', 'Contabile', 'Amministrazione e finanza', 'o-dante'),
    ('o-mai', 'Mario Mai', 'mario.mai@almacis.it', 'Geometra', 'BU Costruzioni', 'o-luca')`);
  await gov.reload();
  for (const e of [ADMIN, BOSS, WORKER, NEWADMIN]) await login(e);
});

after(async () => {
  server?.close();
  await db?.close();
});

test('ruoli dalle regole: direzione dalla qualifica, amministrazione dal reparto, responsabile, tutti gli altri', () => {
  assert.equal(gov.roleOf(BOSS).key, 'direzione');
  assert.equal(gov.roleOf(NEWADMIN).key, 'amministrazione');
  assert.equal(gov.roleOf(WORKER).key, 'collaboratore');
  assert.equal(gov.roleOf('esterno@partner.it').key, 'ospite');
  assert.equal(gov.roleOf(ADMIN).key, 'responsabile'); // responsabile di qualcuno; amministratore per ADMIN_EMAILS
  assert.equal(gov.isAdminEmail(ADMIN), true);
  assert.equal(gov.isAdminEmail(BOSS), false);
});

test('solo gli amministratori aprono le impostazioni', async () => {
  assert.equal((await api(WORKER, 'GET', '/api/impostazioni/panoramica')).status, 403);
  const r = await api(ADMIN, 'GET', '/api/impostazioni/panoramica');
  assert.equal(r.status, 200);
  assert.equal(r.body.users.never >= 1, true);
});

test('amministratore dato dalle impostazioni, senza toccare ADMIN_EMAILS; e non ci si toglie da soli', async () => {
  assert.equal((await api(NEWADMIN, 'GET', '/api/impostazioni/organigramma')).status, 403);
  const r = await api(ADMIN, 'PUT', '/api/impostazioni/ruoli-assegnati', { email: NEWADMIN, role_key: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role.source, 'manual');
  const me = await api(NEWADMIN, 'GET', '/api/me');
  assert.equal(me.body.is_admin, true);
  const org = await api(NEWADMIN, 'GET', '/api/impostazioni/organigramma');
  assert.equal(org.status, 200);
  assert.equal(org.body.people, 5);
  assert.equal(org.body.manual.length, 1);
  assert.equal(org.body.manual[0].differs, true);
  const self = await api(NEWADMIN, 'PUT', '/api/impostazioni/ruoli-assegnati', { email: NEWADMIN, role_key: null });
  assert.equal(self.status, 400);
  assert.equal((await api(ADMIN, 'PUT', '/api/impostazioni/ruoli-assegnati', { email: NEWADMIN, role_key: null })).status, 200);
  assert.equal((await api(NEWADMIN, 'GET', '/api/me')).body.is_admin, false);
});

test('nuovo ruolo con regola sul reparto, modificato ed eliminato', async () => {
  const c = await api(ADMIN, 'POST', '/api/impostazioni/ruoli', { label: 'Costruzioni', rule: 'department', rule_value: 'Costruzioni', position: 40 });
  assert.equal(c.status, 201);
  assert.equal(gov.roleOf(WORKER).key, 'costruzioni');
  assert.equal((await api(ADMIN, 'PATCH', `/api/impostazioni/ruoli/${c.body.key}`, { rule_value: 'Impianti' })).status, 200);
  assert.equal(gov.roleOf(WORKER).key, 'collaboratore');
  assert.equal((await api(ADMIN, 'DELETE', '/api/impostazioni/ruoli/collaboratore')).status, 400);
  assert.equal((await api(ADMIN, 'DELETE', `/api/impostazioni/ruoli/${c.body.key}`)).status, 200);
});

test('privacy: Mezzi e Persone su «Niente» chiudono le API; il registro tiene prima e dopo', async () => {
  assert.equal((await api(WORKER, 'GET', '/api/org')).status, 200);
  const p = await api(ADMIN, 'GET', '/api/impostazioni/privacy');
  assert.equal(p.body.matrix.collaboratore.persone, 'all');
  const put = await api(ADMIN, 'PUT', '/api/impostazioni/privacy', { matrix: { collaboratore: { persone: 'none', mezzi: 'none' } } });
  assert.equal(put.status, 200);
  assert.equal(put.body.changes, 2);
  assert.equal((await api(WORKER, 'GET', '/api/org')).status, 403);
  assert.equal((await api(WORKER, 'GET', '/api/mezzi')).status, 403);
  assert.equal((await api(ADMIN, 'GET', '/api/org')).status, 200);
  // la riga dell'amministratore non si cambia (tranne Energy) e i documenti mai
  assert.equal((await api(ADMIN, 'PUT', '/api/impostazioni/privacy', { matrix: { admin: { crm: 'none' } } })).status, 400);
  assert.equal((await api(ADMIN, 'PUT', '/api/impostazioni/privacy', { matrix: { collaboratore: { documenti: 'all' } } })).status, 400);
  await new Promise(r => setTimeout(r, 100)); // il registro si scrive a risposta inviata
  const reg = await api(ADMIN, 'GET', '/api/impostazioni/registro?tipo=impostazioni');
  const row = reg.body.rows.find(x => x.what === 'Ha cambiato 2 permessi');
  assert.ok(row, 'riga del registro con il cambio dei permessi');
  assert.equal(row.module, 'Impostazioni');
  assert.deepEqual(row.detail.after.sort(), ['Collaboratore · Mezzi: Niente', 'Collaboratore · Persone e organigramma: Niente'].sort());
  await api(ADMIN, 'PUT', '/api/impostazioni/privacy', { matrix: { collaboratore: { persone: 'all', mezzi: 'all' } } });
  assert.equal((await api(WORKER, 'GET', '/api/org')).status, 200);
});

test('eccezione personale: vale più del ruolo, si vede in «Prova come…», si toglie', async () => {
  const e = await api(ADMIN, 'POST', '/api/impostazioni/privacy/eccezioni', { email: WORKER, area: 'mezzi', level: 'none' });
  assert.equal(e.status, 201);
  assert.equal((await api(WORKER, 'GET', '/api/mezzi')).status, 403);
  const prova = await api(ADMIN, 'GET', `/api/impostazioni/privacy/prova?email=${WORKER}`);
  assert.equal(prova.body.levels.mezzi, 'none');
  const list = (await api(ADMIN, 'GET', '/api/impostazioni/privacy')).body.exceptions;
  assert.equal(list.length, 1);
  assert.equal((await api(ADMIN, 'POST', `/api/impostazioni/privacy/eccezioni/${list[0].id}/conferma`)).status, 200);
  assert.equal((await api(ADMIN, 'DELETE', `/api/impostazioni/privacy/eccezioni/${list[0].id}`)).status, 200);
  assert.equal((await api(WORKER, 'GET', '/api/mezzi')).status, 200);
  // un'eccezione scaduta non vale più
  await db.query("INSERT INTO privacy_exceptions (email, area, level, until) VALUES ($1, 'mezzi', 'none', '2020-01-01')", [WORKER]);
  await gov.reload();
  assert.equal((await api(WORKER, 'GET', '/api/mezzi')).status, 200);
  await db.query('DELETE FROM privacy_exceptions');
  await gov.reload();
});

test('progetti: con «Tutto» si vedono anche quelli degli altri, in sola lettura', async () => {
  const created = await api(BOSS, 'POST', '/api/projects', { name: 'Cantiere riservato' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await api(WORKER, 'GET', `/api/projects/${id}`)).status, 404);
  await api(ADMIN, 'POST', '/api/impostazioni/privacy/eccezioni', { email: WORKER, area: 'progetti', level: 'all' });
  assert.equal((await api(WORKER, 'GET', `/api/projects/${id}`)).status, 200);
  assert.equal((await api(WORKER, 'PATCH', `/api/projects/${id}`, { name: 'Cambiato' })).status, 403);
  await db.query('DELETE FROM privacy_exceptions');
  await gov.reload();
});

test('utente sospeso: esce subito e non rientra; riattivato rientra', async () => {
  const list = (await api(ADMIN, 'GET', '/api/impostazioni/utenti')).body;
  assert.equal(list.kpi.never, 1); // Mario Mai
  const tom = list.users.find(u => u.email === WORKER);
  assert.ok(tom);
  assert.equal(tom.role_label, 'Collaboratore');
  const me = list.users.find(u => u.email === ADMIN);
  assert.equal((await api(ADMIN, 'POST', `/api/impostazioni/utenti/${me.id}/sospendi`)).status, 400);
  assert.equal((await api(ADMIN, 'POST', `/api/impostazioni/utenti/${tom.id}/sospendi`)).status, 200);
  assert.equal((await api(WORKER, 'GET', '/api/me')).status, 401);
  assert.equal(await login(WORKER), 403);
  await new Promise(r => setTimeout(r, 100));
  const reg = await api(ADMIN, 'GET', '/api/impostazioni/registro?tipo=accessi');
  assert.ok(reg.body.rows.some(r => r.action === 'login_refused' && r.target === WORKER));
  assert.equal((await api(ADMIN, 'POST', `/api/impostazioni/utenti/${tom.id}/riattiva`)).status, 200);
  assert.equal(await login(WORKER), 302);
  assert.equal((await api(WORKER, 'GET', '/api/me')).status, 200);
});

test('costi AI: per funzione e per persona, in euro, con i tetti che si salvano', async () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const uid = (await db.query('SELECT id FROM users WHERE email = $1', [BOSS])).rows[0].id;
  await db.query(`INSERT INTO assistant_usage (user_id, model, cost_usd, day) VALUES
    ($1, 'gpt-5.1', 2, $2), ($1, 'gpt-realtime-mini', 1, $2), ($1, 'gpt-4o-mini-transcribe', 0.5, $2)`, [uid, today]);
  assert.equal((await api(WORKER, 'GET', '/api/impostazioni/costi')).status, 403);
  const c = (await api(ADMIN, 'GET', '/api/impostazioni/costi')).body;
  assert.equal(c.cap_eur, 150);
  assert.equal(c.month_eur, 3.22); // 3,5 $ × 0,92
  assert.equal(c.features.find(f => f.key === 'voce').eur, 0.92);
  assert.equal(c.people[0].name, 'Luca Bianchi');
  assert.equal(c.people[0].cap_days, 1); // 3,22 € ≥ 3 € del tetto giornaliero
  assert.equal((await api(ADMIN, 'PUT', '/api/impostazioni/costi', { monthly_eur: 200, daily_eur: 5, alert_pct: 75 })).status, 200);
  const c2 = (await api(ADMIN, 'GET', '/api/impostazioni/costi')).body;
  assert.equal(c2.cap_eur, 200);
  assert.equal(c2.daily_eur, 5);
  assert.equal(c2.alert_pct, 75);
  // «Costi AI: Tutto» li apre in sola lettura
  await api(ADMIN, 'POST', '/api/impostazioni/privacy/eccezioni', { email: WORKER, area: 'costi_ai', level: 'all' });
  const w = await api(WORKER, 'GET', '/api/impostazioni/costi');
  assert.equal(w.status, 200);
  assert.equal(w.body.can_edit, false);
  assert.equal((await api(WORKER, 'PUT', '/api/impostazioni/costi', { monthly_eur: 1, daily_eur: 1 })).status, 403);
});

test('integrazioni e CSV del registro', async () => {
  const i = (await api(ADMIN, 'GET', '/api/impostazioni/integrazioni')).body;
  assert.equal(i.microsoft.configured, false);
  assert.equal(i.microsoft.secret_expires, '2028-10');
  const res = await fetch(`${base}/api/impostazioni/registro.csv?giorni=30`, { headers: { cookie: cookies[ADMIN] } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"Quando";"Chi";"Azione"/);
});

test('funzione AI dal modello e frasi del registro', () => {
  assert.equal(featureOf('gpt-4o-mini-transcribe'), 'trascrizioni');
  assert.equal(featureOf('gpt-realtime-2.1-mini'), 'voce');
  assert.equal(featureOf('gpt-5.1-mini'), 'scritto');
  assert.equal(describeRow({ action: 'DELETE /api/tickets/12' }).what, 'Ha eliminato un ticket');
  assert.equal(describeRow({ action: 'login' }).kind, 'accessi');
  assert.equal(describeRow({ action: 'PUT /api/impostazioni/privacy', detail: { label: 'Ha cambiato un permesso' } }).what, 'Ha cambiato un permesso');
});
