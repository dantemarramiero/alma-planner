// HQSE (ALM2-100): catalogo da Vittoria, regole di validità, scadenze, «Checklist e regole», fornitori in qualifica
// presi dal CRM, scheda con lo stato dei documenti.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const H = require('../lib/hqse');
const C = require('../lib/hqse-catalogo');

let server, base, db, app, D;
const ADMIN = 'direzione@almacis.it';
const B = '/api/hqse';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  ({ app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db }));
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await login(ADMIN);
  D = (method, path, body) => api(a, method, path, body);
});
after(async () => { app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

test('regole di validità e stato dei documenti', () => {
  assert.equal(H.validityLabel('firma', 6), '6 mesi dalla firma');
  assert.equal(H.validityLabel('attestato', 60), '5 anni dall\'attestato');
  assert.equal(H.validityLabel('attestato', 12), '1 anno dall\'attestato');
  assert.equal(H.validityLabel('nessuna', null), 'Non scade');
  assert.equal(H.addMonths('2026-08-31', 6), '2027-02-28', 'fine mese che non esiste → ultimo giorno');
  assert.equal(H.computeValidTo({ validity_rule: 'firma', validity_months: 6 }, { issued_on: '2026-05-10' }), '2026-11-10');
  assert.equal(H.computeValidTo({ validity_rule: 'documento' }, { valid_to: '2027-03-01' }), '2027-03-01');
  assert.equal(H.computeValidTo({ validity_rule: 'nessuna' }, { valid_to: '2027-03-01' }), null);
  const t = { notice_days: [30, 15, 7] };
  assert.equal(H.docState(t, null, '2026-11-27').state, 'da_caricare');
  assert.equal(H.docState(t, { status: 'respinto', reason: 'manca la firma' }, '2026-11-27').reason, 'manca la firma');
  assert.equal(H.docState(t, { status: 'approvato', valid_to: '2027-06-01' }, '2026-11-27').state, 'approvato');
  assert.equal(H.docState(t, { status: 'approvato', valid_to: '2026-12-09' }, '2026-11-27').state, 'in_scadenza');
  assert.equal(H.docState(t, { status: 'approvato', valid_to: '2026-11-20' }, '2026-11-27').state, 'scaduto');
  assert.equal(H.docState(t, { status: 'approvato', valid_to: '2026-11-20', extended_to: '2026-12-31' }, '2026-11-27').state, 'approvato', 'la proroga tiene in regola');
  assert.throws(() => H.docTypeFields({ validity_rule: 'firma' }), /quanti mesi/);
  assert.deepEqual(H.docTypeFields({ notice_days: [7, 30, 15, 30] }).notice_days, [30, 15, 7]);
});

test('il catalogo da Vittoria è coerente', () => {
  const codes = new Set(C.DOC_TYPES.map(t => t.code));
  assert.equal(codes.size, C.DOC_TYPES.length, 'codici dei documenti unici');
  for (const cl of C.CHECKLISTS) for (const d of cl.docs) assert.ok(codes.has(d), `${cl.code}: ${d}`);
  assert.equal(C.DOMANDE_RISORSA.length, 23, 'le 23 domande del questionario dei dipendenti');
  assert.ok(C.CHECKLISTS.find(c => c.code === 'CL11').commesse.includes('AL 1001'));
});

test('Checklist e regole: catalogo caricato, documento modificato', async () => {
  const cfg = await D('GET', `${B}/config`);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.checklists.length, C.CHECKLISTS.length);
  assert.deepEqual(cfg.body.tipi_appalto.find(t => t.key === 'lavori').checklists, ['CL1', 'CL3']);
  const cl3 = cfg.body.checklists.find(c => c.code === 'CL3');
  const det = await D('GET', `${B}/checklists/${cl3.id}`);
  const rspp = det.body.docs.find(d => d.code === 'rspp');
  assert.equal(rspp.validity, '5 anni dall\'attestato');
  const up = await D('PUT', `${B}/doc-types/${rspp.id}`, { validity_rule: 'attestato', validity_months: 48, grace_days: 10, ai_checks: [{ text: 'C\'è la nomina', on_fail: 'respingi' }, { text: '' }] });
  assert.equal(up.status, 200);
  assert.equal(up.body.validity, '4 anni dall\'attestato');
  assert.equal(up.body.ai_checks.length, 1);
  assert.equal((await D('PUT', `${B}/doc-types/${rspp.id}`, { validity_rule: 'firma' })).status, 400);
  const nuovo = await D('POST', `${B}/checklists/${cl3.id}/docs`, { name: 'Certificato antincendio del deposito', validity_rule: 'rilascio', validity_months: 12 });
  assert.equal(nuovo.status, 201);
  assert.ok((await D('GET', `${B}/checklists/${cl3.id}`)).body.docs.some(d => d.name === 'Certificato antincendio del deposito'));
});

test('fornitore in qualifica dal CRM: checklist dal tipo di appalto, stato dei documenti, storico', async () => {
  const { rows: [s] } = await db.query("INSERT INTO crm_subjects (name, vat, roles) VALUES ('Edil Esempio S.r.l.', '01234567890', '{cliente}') RETURNING id");
  const found = await D('GET', `${B}/aziende?q=edil esem`);
  assert.equal(found.body[0].id, s.id);
  const created = await D('POST', `${B}/fornitori`, { subject_id: s.id, tipo_appalto: 'lavori' });
  assert.equal(created.status, 201);
  assert.equal((await D('POST', `${B}/fornitori`, { subject_id: s.id })).status, 409, 'una qualifica per azienda');
  const { rows: [crm] } = await db.query('SELECT roles FROM crm_subjects WHERE id = $1', [s.id]);
  assert.ok(crm.roles.includes('fornitore'), 'nel CRM diventa anche fornitore');
  const id = created.body.id;
  let sk = await D('GET', `${B}/fornitori/${id}`);
  assert.deepEqual(sk.body.checklists.map(c => c.code), ['CL1', 'CL3', 'WL']);
  assert.equal(sk.body.docs.ok, 0);
  // un DURC approvato e un DVR respinto
  const types = Object.fromEntries((await db.query('SELECT code, id FROM hqse_doc_types')).rows.map(r => [r.code, r.id]));
  await db.query("INSERT INTO hqse_documents (supplier_id, doc_type_id, status, valid_to) VALUES ($1, $2, 'approvato', '2030-01-01')", [id, types.durc]);
  await db.query("INSERT INTO hqse_documents (supplier_id, doc_type_id, status, reason) VALUES ($1, $2, 'respinto', 'mancano le firme')", [id, types.dvr]);
  sk = await D('GET', `${B}/fornitori/${id}`);
  assert.equal(sk.body.docs.ok, 1);
  assert.equal(sk.body.docs.respinti, 1);
  const dvr = sk.body.checklists.find(c => c.code === 'CL3').docs.find(d => d.name === 'DVR');
  assert.equal(dvr.state, 'respinto');
  assert.equal(dvr.reason, 'mancano le firme');
  // checklist in più, livello e storico
  const cl6 = (await D('GET', `${B}/config`)).body.checklists.find(c => c.code === 'CL6');
  assert.equal((await D('POST', `${B}/fornitori/${id}/checklists`, { checklist_id: cl6.id })).status, 201);
  assert.equal((await D('PATCH', `${B}/fornitori/${id}`, { level: 'buono', risk: 'medio' })).status, 200);
  sk = await D('GET', `${B}/fornitori/${id}`);
  assert.ok(sk.body.checklists.some(c => c.code === 'CL6' && c.optional));
  assert.equal(sk.body.level, 'buono');
  assert.match(sk.body.history.map(h => h.text).join(' | '), /livello «Buono».*|Aggiunta la checklist «Punteggi aggiuntivi»/);
  const list = await D('GET', `${B}/fornitori?q=edil`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].docs.respinti, 1);
});
