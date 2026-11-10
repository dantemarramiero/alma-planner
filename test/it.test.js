// Alma IT: «I miei strumenti» per tutti (le mie licenze, richiedi un software, non mi serve più) e le richieste
// che il team IT accetta o rifiuta, con le notifiche a chi ha chiesto.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { applySource } = require('../lib/software-sources');

let server, base, db, A, IT, U, OTHER;

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
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'capo@almacis.it' }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.exec(`
    INSERT INTO org_people (oid, name, email, job_title, department) VALUES
      ('o-tiziana', 'Tiziana IT', 'tiziana@almacis.it', 'ICT Coordinator', 'IT - Sistemi Informativi'),
      ('o-giulia', 'Giulia Tecnica', 'giulia@almacis.it', 'Tecnico', 'Cantieri'),
      ('o-paolo', 'Paolo Altro', 'paolo@almacis.it', 'Tecnico', 'Cantieri');`);
  A = as(await login('capo@almacis.it'));
  IT = as(await login('tiziana@almacis.it'));
  U = as(await login('giulia@almacis.it'));
  OTHER = as(await login('paolo@almacis.it'));
});

after(async () => {
  server?.close();
  await db?.close();
});

let autocad, ms365;
test('i miei strumenti: le mie licenze e cosa posso chiedere; il censimento resta del team IT', async () => {
  const sw = (await A('POST', '/api/software', { name: 'AutoCAD', vendor: 'Autodesk', website: 'https://www.autodesk.com', notes: 'Disegno tecnico' })).body;
  autocad = (await A('POST', `/api/software/${sw.id}/plans`, { name: 'Licenza', seats: 1, unit_cost: '200', billing: 'mese' })).body;
  const zoho = (await A('POST', '/api/software', { name: 'Zoho CRM', vendor: 'Zoho' })).body;
  const std = (await A('POST', `/api/software/${zoho.id}/plans`, { name: 'Standard', seats: 5, unit_cost: '14' })).body;
  await A('POST', `/api/software/plans/${std.id}/assignments`, { oids: ['o-giulia'] });
  await applySource(db, 'microsoft', [{ external_id: 'microsoft-365', name: 'Microsoft 365', vendor: 'Microsoft', category: '', plans: [
    { external_id: 'O365_BUSINESS_PREMIUM', name: 'Microsoft 365 Business Standard', seats: 3, assigned: 0, renewal_date: null, unit_cost: 11.7, people: [] },
    { external_id: 'POWER_BI_STANDARD', name: 'Power BI (gratuito)', seats: null, assigned: 0, renewal_date: null, unit_cost: 0, people: [] }] }], null);
  const all = (await A('GET', '/api/software')).body.software;
  ms365 = all.find(s => s.name === 'Microsoft 365').plans.find(p => p.external_id === 'O365_BUSINESS_PREMIUM');

  const mine = (await U('GET', '/api/it/mine')).body;
  assert.equal(mine.person.oid, 'o-giulia');
  assert.deepEqual(mine.licences.map(l => [l.software_name, l.plan_name, l.vendor]), [['Zoho CRM', 'Standard', 'Zoho']]);
  assert.equal(mine.licences[0].unit_cost, undefined); // i prezzi li vede solo il team IT
  const asks = mine.catalog.map(c => `${c.software_name}/${c.plan_name}`);
  assert.ok(asks.includes('AutoCAD/Licenza') && asks.includes('Microsoft 365/Microsoft 365 Business Standard'));
  assert.ok(!asks.includes('Zoho CRM/Standard')); // ce l'ha già
  assert.ok(!asks.some(x => x.includes('gratuito'))); // le gratuite di Microsoft non si chiedono

  assert.equal((await U('GET', '/api/software')).status, 403);
  assert.equal((await U('GET', '/api/software/requests')).status, 403);
  assert.equal((await IT('GET', '/api/software/requests')).status, 200); // il team IT sì
});

test('richiedi un software: al team IT arriva una notifica; doppioni e licenze già avute rifiutati', async () => {
  const r = await U('POST', '/api/it/requests', { plan_id: autocad.id, reason: 'Disegni del cantiere', due_date: '2026-11-20' });
  assert.equal(r.status, 201);
  assert.equal((await U('POST', '/api/it/requests', { plan_id: autocad.id })).status, 400); // già chiesta
  assert.equal((await U('POST', '/api/it/requests', {})).status, 400);
  const notif = (await IT('GET', '/api/notifications')).body;
  assert.ok(notif.some(n => n.kind === 'it' && /chiede «AutoCAD»: Disegni del cantiere/.test(n.body) && n.link === '/it/richieste'));
  assert.equal((await U('POST', '/api/it/requests', { name: 'Lumion', reason: 'Render' })).status, 201); // non in elenco
  assert.equal((await U('POST', '/api/it/requests', { plan_id: ms365.id })).status, 201);
  const totals = (await IT('GET', '/api/software')).body.totals;
  assert.equal(totals.requests, 3);
});

test('il team IT accetta (assegna o lascia da fare in Microsoft), rifiuta con un motivo; chi ha chiesto è avvisato', async () => {
  const list = (await IT('GET', '/api/software/requests')).body;
  const byName = n => list.find(r => r.software_name.startsWith(n));
  assert.equal(byName('AutoCAD').free, 1);

  const ok = (await IT('POST', `/api/software/requests/${byName('AutoCAD').id}/accept`, { answer: 'Installata' })).body;
  assert.deepEqual([ok.added, ok.todo], [1, null]);
  assert.ok((await U('GET', '/api/it/mine')).body.licences.some(l => l.software_name === 'AutoCAD'));
  assert.equal((await IT('POST', `/api/software/requests/${byName('AutoCAD').id}/accept`, {})).status, 400); // già decisa

  const ms = (await IT('POST', `/api/software/requests/${byName('Microsoft 365').id}/accept`, {})).body;
  assert.equal(ms.added, 0);
  assert.match(ms.todo, /in Microsoft 365/);

  assert.equal((await IT('POST', `/api/software/requests/${byName('Lumion').id}/reject`, { answer: 'Usiamo già Twinmotion' })).status, 200);
  const mine = (await U('GET', '/api/it/mine')).body.requests;
  assert.deepEqual(mine.map(r => [r.software_name, r.status]).sort(),
    [['AutoCAD', 'accettata'], ['Lumion', 'rifiutata'], ['Microsoft 365 · Microsoft 365 Business Standard', 'accettata']]);
  const notif = (await U('GET', '/api/notifications')).body.filter(n => n.kind === 'it');
  assert.ok(notif.some(n => /accettato la tua richiesta di «AutoCAD»: Installata/.test(n.body) && n.link === '/it/strumenti'));
  assert.ok(notif.some(n => /non ha accettato .*Lumion.*Twinmotion/.test(n.body)));
});

test('non mi serve più: solo per le mie licenze; accettata, la licenza messa a mano si toglie; annullare una richiesta', async () => {
  const mine = (await U('GET', '/api/it/mine')).body;
  const zoho = mine.licences.find(l => l.software_name === 'Zoho CRM');
  assert.equal((await OTHER('POST', '/api/it/release', { assignment_id: zoho.assignment_id })).status, 404); // non è sua
  assert.equal((await U('POST', '/api/it/release', { assignment_id: zoho.assignment_id, reason: 'Cambio ruolo' })).status, 201);
  assert.equal((await U('POST', '/api/it/release', { assignment_id: zoho.assignment_id })).status, 400); // già segnalata
  const rel = (await IT('GET', '/api/software/requests')).body.find(r => r.kind === 'rilascio');
  assert.equal((await IT('POST', `/api/software/requests/${rel.id}/accept`, {})).body.removed, 1);
  assert.ok(!(await U('GET', '/api/it/mine')).body.licences.some(l => l.software_name === 'Zoho CRM'));

  const r = (await OTHER('POST', '/api/it/requests', { plan_id: autocad.id })).body;
  assert.equal((await U('POST', `/api/it/requests/${r.id}/cancel`, {})).status, 404); // non è sua
  assert.equal((await OTHER('POST', `/api/it/requests/${r.id}/cancel`, {})).status, 200);
  assert.equal((await IT('GET', '/api/software')).body.totals.requests, 0);
});
