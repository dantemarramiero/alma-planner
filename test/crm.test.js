// CRM: accesso per ASA, soggetti con ruoli e controllo dei doppioni, lead con le fasi e Lead → Cliente alla prima
// commessa, contatti collegati a più soggetti, attività, unione dei doppioni.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, D, E, F, N, G;
const ADMIN = 'direzione@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN)); // direzione
  E = as(await login('edile@almacis.it')); // ASA Edilizia
  F = as(await login('facility@almacis.it')); // ASA Facility
  N = as(await login('nessuno@almacis.it')); // nessuna ASA
  G = as(await login('dante.marramiero@almacis.it')); // membro di Alma Energy → ASA Energy
});

after(async () => {
  server?.close();
  await db?.close();
});

test('entra la direzione e chi ha un\'ASA; i membri di Alma Energy sono dell\'ASA Energy', async () => {
  assert.equal((await N('GET', '/api/crm')).status, 403);
  assert.equal((await N('GET', '/api/me')).body.crm, false);
  assert.equal((await E('GET', '/api/crm')).status, 403);
  assert.equal((await D('POST', '/api/crm/asa/edilizia/members', { email: 'Edile@almacis.it' })).status, 201);
  assert.equal((await D('POST', '/api/crm/asa/facility/members', { email: 'facility@almacis.it' })).status, 201);
  assert.equal((await E('POST', '/api/crm/asa/facility/members', { email: 'edile@almacis.it' })).status, 403);
  const e = await E('GET', '/api/crm');
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.myAsa, ['edilizia']);
  assert.equal(e.body.asa.length, 10);
  assert.equal((await E('GET', '/api/me')).body.crm, true);
  assert.deepEqual((await G('GET', '/api/crm')).body.myAsa, ['energy']);
  const d = await D('GET', '/api/crm');
  assert.equal(d.body.admin, true);
  assert.equal(d.body.myAsa.length, 10);
});

test('P.IVA e codice fiscale controllati; niente doppioni; ASA e ruoli obbligatori', async () => {
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', vat: '12345678901', roles: ['lead'], asa: ['edilizia'] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead'], asa: [] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: [], asa: ['edilizia'] })).status, 400);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead', 'cliente'], asa: ['edilizia'] })).status, 400);
  // non può creare una scheda solo per un'ASA non sua
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', roles: ['lead'], asa: ['facility'] })).status, 400);
  const r = await E('POST', '/api/crm/subjects', { name: 'Rossi Costruzioni', vat: 'IT 0274 386 0690', roles: ['lead'], asa: ['edilizia'], lead_why: 'Fa ristrutturazioni a Pescara' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.vat, '02743860690');
  assert.equal(r.body.lead_stage, 'da_contattare');
  // valore scritto all'italiana o come arriva dal database
  for (const [raw, want] of [['1.200.000', 1200000], ['1200000.00', 1200000], ['1.200.000,50', 1200000.5], ['450000', 450000]]) {
    assert.equal(Number((await E('PATCH', `/api/crm/subjects/${r.body.id}`, { potential_value: raw })).body.potential_value), want, raw);
  }
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'Altro nome', vat: '02743860690', roles: ['cliente'], asa: ['edilizia'] })).status, 409);
  assert.equal((await E('POST', '/api/crm/subjects', { name: 'X', tax_code: 'ABC', roles: ['cliente'], asa: ['edilizia'] })).status, 400);
});

test('ognuno vede la sua ASA; il doppione di un\'altra ASA si segnala e ci si può unire', async () => {
  const { body: list } = await F('GET', '/api/crm/subjects');
  assert.equal(list.subjects.length, 0);
  const { body: chk } = await F('GET', '/api/crm/subjects/check?vat=02743860690');
  assert.equal(chk.matches.length, 1);
  assert.equal(chk.matches[0].visible, false);
  const id = chk.matches[0].id;
  assert.equal((await F('GET', `/api/crm/subjects/${id}`)).status, 404);
  assert.equal((await F('PATCH', `/api/crm/subjects/${id}`, { name: 'Hack' })).status, 404);
  assert.equal((await F('POST', `/api/crm/subjects/${id}/join`, { asa: 'edilizia' })).status, 400); // non è sua
  assert.equal((await F('POST', `/api/crm/subjects/${id}/join`, { asa: 'facility' })).status, 200);
  const s = await F('GET', `/api/crm/subjects/${id}`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.asa.sort(), ['edilizia', 'facility']);
  assert.equal((await D('GET', '/api/crm/subjects?asa=facility')).body.subjects.length, 1);
});

test('fasi del lead con lo storico; diventa cliente solo alla prima commessa', async () => {
  const { body: { subjects: [s] } } = await E('GET', '/api/crm/subjects?role=lead');
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'contattato' })).status, 200);
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'non_interessato' })).status, 400); // serve il motivo
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'non_interessato', lost_reason: 'Prezzi', retry_date: '2027-06-01' })).body.retry_date, '2027-06-01');
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/stage`, { stage: 'diventa_cliente' })).status, 400);
  // a mano no
  assert.equal((await E('PATCH', `/api/crm/subjects/${s.id}`, { roles: ['cliente'] })).status, 400);
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/prima-commessa`, {})).status, 403);
  const c = await D('POST', `/api/crm/subjects/${s.id}/prima-commessa`, { commessa: 'C-2026-014' });
  assert.deepEqual(c.body.roles, ['cliente']);
  assert.ok(c.body.client_since);
  const { body: d } = await E('GET', `/api/crm/subjects/${s.id}`);
  assert.deepEqual(d.history.map(h => h.to_stage), ['cliente', 'non_interessato', 'contattato', 'da_contattare']);
  assert.match(d.history[0].note, /C-2026-014/);
  assert.equal((await E('GET', '/api/crm')).body.counts.cliente, 1);
});

test('contatti in più soggetti, controllo per email, visibili solo con la propria ASA', async () => {
  const { body: { subjects: [cli] } } = await E('GET', '/api/crm/subjects?role=cliente');
  const { body: comune } = await E('POST', '/api/crm/subjects', { name: 'Comune di Pescara', kind: 'ente_pubblico', roles: ['lead'], asa: ['edilizia'], ipa_code: 'c_g482' });
  assert.equal((await E('POST', '/api/crm/contacts', { last_name: 'Bianchi' })).status, 400); // senza anagrafica
  const c = await E('POST', '/api/crm/contacts', {
    title: 'Ing.', first_name: 'Mario', last_name: 'Bianchi', email: 'M.Bianchi@example.it',
    links: [{ subject_id: cli.id, job: 'Direttore tecnico', is_primary: true }, { subject_id: comune.id, job: 'RUP' }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.email, 'm.bianchi@example.it');
  assert.equal((await E('GET', '/api/crm/contacts/check?email=m.bianchi@example.it')).body.matches.length, 1);
  const { body: det } = await E('GET', `/api/crm/contacts/${c.body.id}`);
  assert.deepEqual(det.links.map(l => l.job), ['Direttore tecnico', 'RUP']);
  // Facility vede il cliente (ASA aggiunta) ma non il Comune: del contatto vede solo il collegamento al cliente
  const { body: f } = await F('GET', `/api/crm/contacts/${c.body.id}`);
  assert.deepEqual(f.links.map(l => l.job), ['Direttore tecnico']);
  // e salvando non toglie il collegamento al Comune che non vede
  assert.equal((await F('PATCH', `/api/crm/contacts/${c.body.id}`, { links: [{ subject_id: cli.id, job: 'Direttore tecnico' }] })).status, 200);
  assert.equal((await E('GET', `/api/crm/contacts/${c.body.id}`)).body.links.length, 2);
  assert.equal((await G('GET', `/api/crm/contacts/${c.body.id}`)).status, 404);
  assert.equal((await G('GET', '/api/crm/contacts')).body.contacts.length, 0);
  const { body: sc } = await E('GET', `/api/crm/subjects/${comune.id}`);
  assert.equal(sc.contacts[0].job, 'RUP');
});

test('attività su soggetto e contatto; le cancella solo chi le ha scritte', async () => {
  const { body: { subjects } } = await E('GET', '/api/crm/subjects?q=pescara');
  const s = subjects[0];
  const a = await E('POST', '/api/crm/activities', { subject_id: s.id, kind: 'chiamata', body: 'Sentito il RUP per il bando scuole' });
  assert.equal(a.status, 201);
  assert.equal((await E('POST', '/api/crm/activities', { subject_id: s.id, kind: 'fax', body: 'x' })).status, 400);
  assert.equal((await F('POST', '/api/crm/activities', { subject_id: s.id, body: 'x' })).status, 404);
  assert.equal((await E('GET', `/api/crm/subjects/${s.id}`)).body.activities[0].kind, 'chiamata');
  assert.equal((await G('DELETE', `/api/crm/activities/${a.body.id}`)).status, 403);
  assert.equal((await E('DELETE', `/api/crm/activities/${a.body.id}`)).status, 200);
});

test('unione dei doppioni (direzione): contatti e attività passano alla scheda buona', async () => {
  const { body: a } = await E('POST', '/api/crm/subjects', { name: 'Verdi Srl', roles: ['fornitore'], asa: ['edilizia'], supplier_categories: ['noli'] });
  const { body: b } = await E('POST', '/api/crm/subjects', { name: 'Verdi S.r.l.', vat: '00488410010', roles: ['fornitore'], asa: ['edilizia'] });
  await E('POST', '/api/crm/contacts', { last_name: 'Neri', links: [{ subject_id: a.id, job: 'Commerciale' }] });
  await E('POST', '/api/crm/activities', { subject_id: a.id, body: 'Preventivo nolo gru' });
  assert.equal((await E('POST', `/api/crm/subjects/${a.id}/merge`, { into: b.id })).status, 403);
  assert.equal((await D('POST', `/api/crm/subjects/${a.id}/merge`, { into: b.id })).status, 200);
  const { body: good } = await E('GET', `/api/crm/subjects/${b.id}`);
  assert.equal(good.contacts[0].last_name, 'Neri');
  assert.equal(good.activities[0].body, 'Preventivo nolo gru');
  assert.equal((await E('GET', `/api/crm/subjects/${a.id}`)).body.merged_into, b.id);
  assert.equal((await E('PATCH', `/api/crm/subjects/${a.id}`, { name: 'x' })).status, 409);
  assert.ok(!(await E('GET', '/api/crm/subjects?role=fornitore')).body.subjects.some(s => s.id === a.id));
});

test('la direzione crea nuove ASA', async () => {
  const r = await D('POST', '/api/crm/asa', { label: 'Manutenzione strade' });
  assert.equal(r.body.key, 'manutenzione_strade');
  assert.equal((await D('POST', '/api/crm/asa', { label: 'Manutenzione strade' })).status, 409);
  assert.equal((await E('POST', '/api/crm/asa', { label: 'Mia' })).status, 403);
  const { body } = await D('GET', '/api/crm/asa');
  assert.equal(body.asa.find(a => a.key === 'energy').energyMembers[0].email, 'dante.marramiero@almacis.it');
});
