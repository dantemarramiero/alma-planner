// Alma Energy sul CRM centrale (ALM2-83 tappa 1): ogni azienda e persona di Energy è una scheda e un contatto del CRM
// centrale (BU energy), allineati nei due sensi; i doppioni si agganciano per P.IVA o nome; tessere-filtro.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, A, X;
const ADMIN = 'admin@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);
const subject = async id => (await db.query('SELECT * FROM crm_subjects WHERE id = $1', [id])).rows[0];

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = as(await login('dante.marramiero@almacis.it'));
  X = as(await login(ADMIN));
});
after(async () => { server?.close(); await db?.close(); });

test('azienda di Energy = scheda del CRM centrale con la BU Energy, allineate nei due sensi', async () => {
  const c = (await A('POST', '/api/energy/companies', { name: 'Sole Spento Srl', vat: '01234567890', types: ['proprietario'], city: 'Chieti', region: 'Abruzzo' })).body;
  const { rows: [e] } = await db.query('SELECT subject_id FROM energy_companies WHERE id = $1', [c.id]);
  const s = await subject(e.subject_id);
  assert.deepEqual([s.name, s.vat, s.city, s.asa, s.roles, s.segment, s.origin], ['Sole Spento Srl', '01234567890', 'Chieti', ['energy'], ['lead'], 'Energia', 'Alma Energy']);

  // Energy → centrale
  await A('PATCH', `/api/energy/companies/${c.id}`, { city: 'Lanciano' });
  assert.equal((await subject(e.subject_id)).city, 'Lanciano');
  // centrale → Energy
  await db.query("UPDATE crm_subjects SET name = 'Sole Spento S.r.l.', phone = '0871 1234' WHERE id = $1", [e.subject_id]);
  const back = (await A('GET', `/api/energy/companies/${c.id}`)).body;
  assert.deepEqual([back.name, back.phone], ['Sole Spento S.r.l.', '0871 1234']);
});

test('si aggancia alla scheda che c\'è già (stessa P.IVA o stesso nome) senza sovrascriverla; un fondo è «Fondo o investitore»', async () => {
  const { rows: [old] } = await db.query(
    "INSERT INTO crm_subjects (name, vat, city, roles, asa, segment) VALUES ('Elios Solare Spa', '09999999999', 'Foggia', ARRAY['cliente'], ARRAY['impianti'], 'Industria') RETURNING id");
  const c = (await A('POST', '/api/energy/companies', { name: 'Elios Solare', vat: '09999999999', types: ['proprietario'], city: 'Bari' })).body;
  const { rows: [e] } = await db.query('SELECT subject_id FROM energy_companies WHERE id = $1', [c.id]);
  assert.equal(e.subject_id, old.id);
  const s = await subject(old.id);
  assert.deepEqual([s.name, s.city, s.roles, s.asa, s.segment], ['Elios Solare Spa', 'Foggia', ['cliente'], ['impianti', 'energy'], 'Industria']);

  const f = (await A('POST', '/api/energy/companies', { name: 'Infra Green Fund II', types: ['investitore'] })).body;
  const { rows: [fe] } = await db.query('SELECT subject_id FROM energy_companies WHERE id = $1', [f.id]);
  assert.equal((await subject(fe.subject_id)).segment, 'Fondo o investitore');
});

test('persone di Energy = contatti del CRM centrale, con l\'azienda dove lavorano', async () => {
  const c = (await A('POST', '/api/energy/companies', { name: 'Green Dev Srl', types: ['sviluppatore'] })).body;
  const p = (await A('POST', '/api/energy/people', { first_name: 'Marco', last_name: 'Verdi', email: 'marco@greendev.it', companies: [{ company_id: c.id, role: 'Amministratore' }] })).body;
  const { rows: [pe] } = await db.query('SELECT contact_id FROM energy_people WHERE id = $1', [p.id]);
  const { rows: [ct] } = await db.query('SELECT * FROM crm_contacts WHERE id = $1', [pe.contact_id]);
  assert.deepEqual([ct.first_name, ct.last_name, ct.email], ['Marco', 'Verdi', 'marco@greendev.it']);
  const { rows: links } = await db.query('SELECT l.job, s.name FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.contact_id = $1', [pe.contact_id]);
  assert.deepEqual(links.map(l => [l.name, l.job]), [['Green Dev Srl', 'Amministratore']]);
  await db.query("UPDATE crm_contacts SET mobile = '333 1234567' WHERE id = $1", [pe.contact_id]);
  assert.equal((await A('GET', `/api/energy/people/${p.id}`)).body.mobile, '333 1234567');
});

test('tessere-filtro del CRM di Energy: conteggi ed elenchi dal CRM centrale', async () => {
  assert.equal((await X('GET', '/api/energy/crm/tessere')).status, 403);
  const t = (await A('GET', '/api/energy/crm/tessere')).body;
  const by = Object.fromEntries(t.tiles.map(x => [x.key, x.count]));
  assert.ok(by.proprietari >= 2);
  assert.ok(by.sviluppatori >= 1);
  assert.ok(by.fondi >= 1);
  assert.ok('energivori' in by && 'progettisti' in by && 'altri' in by);
  const list = (await A('GET', '/api/energy/crm/elenco?filtro=proprietari')).body;
  assert.ok(list.rows.some(r => r.name === 'Sole Spento S.r.l.' && r.subject_id && r.energy_id));
  const fondi = (await A('GET', '/api/energy/crm/elenco?filtro=fondi')).body;
  assert.ok(fondi.rows.some(r => r.name === 'Infra Green Fund II'));
  assert.equal((await A('GET', '/api/energy/crm/elenco?filtro=boh')).status, 400);
});
