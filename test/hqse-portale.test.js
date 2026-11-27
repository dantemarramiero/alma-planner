// HQSE fase 2 (ALM2-101): widget, registrazione, accesso con link e codice, questionario, dipendenti, mezzi, documenti,
// colleghi; dal lato di Alma: testi del widget e invito al portale.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');

let server, base, db, app, D;
const ADMIN = 'direzione@almacis.it';
const PDF = Buffer.from('%PDF-1.4\n% prova\n').toString('base64');

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
function client(cookie = '') {
  const jar = { cookie };
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(jar.cookie ? { cookie: jar.cookie } : {}), 'X-Portale': '1', 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set && set.startsWith('hqse_s=')) jar.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return { call, jar };
}
const outbox = () => app.locals.hqseMailer.outbox;
const lastMailTo = to => [...outbox()].reverse().find(m => m.to === to);

before(async () => {
  db = await createDb({});
  ({ app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db }));
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = client(await login(ADMIN));
  D = a.call;
});
after(async () => { app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

test('widget: testi da Alma, CORS solo per i siti ammessi', async () => {
  const put = await D('PUT', '/api/hqse/widget', { titolo: 'Diventa fornitore Almacis', testo: 'Registrati', tipi: ['lavori', 'servizi'], privacy_url: 'https://www.almacis.it/privacy' });
  assert.equal(put.status, 200);
  const anon = client();
  const cfg = await anon.call('GET', '/fornitori/widget/config', null, { Origin: 'http://localhost:8080' });
  assert.equal(cfg.body.titolo, 'Diventa fornitore Almacis');
  assert.deepEqual(cfg.body.tipi.map(t => t.key), ['lavori', 'servizi']);
  assert.equal(cfg.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  const other = await anon.call('GET', '/fornitori/widget/config', null, { Origin: 'https://sito-qualunque.it' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const js = await anon.call('GET', '/fornitori/widget.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('registrazione dal sito → CRM, qualifica «Registrato», email con il link; il link apre il portale', async () => {
  const anon = client();
  const bad = await anon.call('POST', '/fornitori/registrazione', { ragione_sociale: 'X', piva: '123', email: 'a@b.it', referente: 'A', tipo: 'lavori', privacy: true });
  assert.equal(bad.status, 400);
  const robot = await anon.call('POST', '/fornitori/registrazione', { sito: 'spam', ragione_sociale: 'Spam', piva: '00000000000' });
  assert.equal(robot.status, 200, 'il campo esca risponde ok senza fare nulla');
  const r = await anon.call('POST', '/fornitori/registrazione', { ragione_sociale: 'Edil Esempio S.r.l.', piva: 'IT01234567890', referente: 'Mario Esempio', email: 'Mario@EdilEsempio.it', tipo: 'lavori', privacy: true });
  assert.equal(r.status, 201);
  const { rows: [s] } = await db.query("SELECT q.status, q.tipo_appalto, c.roles FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id WHERE c.vat = '01234567890'");
  assert.equal(s.status, 'registrato');
  assert.ok(s.roles.includes('fornitore'));
  const mail = lastMailTo('mario@edilesempio.it');
  assert.match(mail.subject, /Benvenuto/);
  const link = mail.text.replace(/^https?:\/\/[^/]+/, '');
  // stessa P.IVA: nessun doppione, e non si dice niente a chi non è del portale
  const again = await anon.call('POST', '/fornitori/registrazione', { ragione_sociale: 'Edil Esempio', piva: '01234567890', referente: 'Altro', email: 'altro@x.it', tipo: 'lavori', privacy: true });
  assert.equal(again.body.gia, true);
  assert.equal(lastMailTo('altro@x.it'), undefined);
  // il link: una volta sola
  const portal = client();
  const go = await portal.call('GET', link);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), '/fornitori');
  assert.ok(portal.jar.cookie.startsWith('hqse_s='));
  assert.equal((await client().call('GET', link)).headers.get('location'), '/fornitori?link=scaduto');
  const st = await portal.call('GET', '/fornitori/api/stato');
  assert.equal(st.status, 200);
  assert.equal(st.body.supplier.name, 'Edil Esempio S.r.l.');
  assert.equal(st.body.me.role, 'referente');
  assert.equal(st.body.checklists.length, 0, 'le checklist arrivano col questionario');
  assert.equal((await client().call('GET', '/fornitori/api/stato')).status, 401);
});

async function enter(email) {
  const c = client();
  await c.call('POST', '/fornitori/api/codice', { email });
  const code = lastMailTo(email).text;
  const r = await c.call('POST', '/fornitori/api/accedi', { email, codice: code });
  assert.equal(r.status, 200);
  return c;
}

test('codice via email: sbagliato, poi giusto; email sconosciuta senza indizi', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/fornitori/api/codice', { email: 'nessuno@x.it' })).status, 200);
  assert.equal(lastMailTo('nessuno@x.it'), undefined);
  await c.call('POST', '/fornitori/api/codice', { email: 'mario@edilesempio.it' });
  const code = lastMailTo('mario@edilesempio.it').text;
  assert.match(code, /^\d{6}$/);
  assert.equal((await c.call('POST', '/fornitori/api/accedi', { email: 'mario@edilesempio.it', codice: code === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal((await c.call('POST', '/fornitori/api/accedi', { email: 'mario@edilesempio.it', codice: code })).status, 200);
  assert.equal((await c.call('GET', '/fornitori/api/stato')).status, 200);
  assert.equal((await c.call('POST', '/fornitori/api/accedi', { email: 'mario@edilesempio.it', codice: code })).status, 400, 'il codice vale una volta');
  await c.call('POST', '/fornitori/api/esci', {});
  assert.equal((await c.call('GET', '/fornitori/api/stato')).status, 401);
});

test('questionario, dipendenti con le domande, mezzi, documenti caricati, colleghi', async () => {
  const c = await enter('mario@edilesempio.it');
  const prev = await c.call('GET', '/fornitori/api/questionario/anteprima?tipo=lavori');
  assert.equal(prev.body.total, 19, 'CL1 + CL3 senza doppioni');
  assert.equal((await c.call('POST', '/fornitori/api/questionario', { tipo: 'lavori', whitelist: true })).status, 200);
  let st = await c.call('GET', '/fornitori/api/stato');
  assert.equal(st.body.supplier.status, 'in_qualifica');
  assert.deepEqual(st.body.checklists.map(x => x.code), ['CL1', 'CL3', 'WL']);
  // dipendente: elettrico e primo soccorso → 9 + 1 + 2 documenti
  const w = await c.call('POST', '/fornitori/api/dipendenti', { first_name: 'Paolo', last_name: 'Verdi', tax_code: 'vrdpla85m12g482x', hired_on: '2022-03-01', answers: { rapporto: 'dipendente', elettrici: true, primo_soccorso: true, inventata: true } });
  assert.equal(w.status, 201);
  let ws = await c.call('GET', '/fornitori/api/dipendenti');
  assert.equal(ws.body[0].docs.length, 12);
  assert.equal(ws.body[0].tax_code, 'VRDPLA85M12G482X');
  const { rows: [crm] } = await db.query("SELECT c.last_name FROM crm_contacts c JOIN hqse_workers w ON w.contact_id = c.id WHERE w.id = $1", [w.body.id]);
  assert.equal(crm.last_name, 'Verdi', 'il dipendente è una persona del CRM');
  assert.equal((await c.call('PUT', `/fornitori/api/dipendenti/${w.body.id}`, { first_name: 'Paolo', last_name: 'Verdi', answers: { rapporto: 'dipendente', elettrici: true } })).status, 200);
  ws = await c.call('GET', '/fornitori/api/dipendenti');
  assert.equal(ws.body[0].docs.length, 10, 'tolto il primo soccorso, tolti i suoi 2 documenti');
  // mezzo
  const m = await c.call('POST', '/fornitori/api/mezzi', { kind: 'Autocarro con gru', plate: 'EF123GH' });
  assert.equal((await c.call('GET', '/fornitori/api/mezzi')).body[0].docs.length, 4, 'CE, disponibilità, manutenzione e verifiche periodiche (criteri QHSE)');
  // documento: la visura vale 6 mesi dal rilascio, la scadenza la calcoliamo noi
  const { rows: types } = await db.query("SELECT code, id FROM hqse_doc_types WHERE code IN ('cciaa', 'durc', 'r_pes', 'm_ce')");
  const T = Object.fromEntries(types.map(t => [t.code, t.id]));
  const today = new Date().toISOString().slice(0, 10);
  const up = await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.cciaa, issued_on: today, file: { nome: 'visura.pdf', mime: 'application/pdf', base64: PDF } });
  assert.equal(up.status, 201);
  assert.equal(up.body.status, 'in_verifica');
  assert.ok(up.body.valid_to > today);
  assert.equal((await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.durc, file: { nome: 'durc.pdf', mime: 'application/pdf', base64: PDF } })).status, 400, 'il DURC chiede la scadenza scritta');
  assert.equal((await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.cciaa, issued_on: '2020-01-10', file: { nome: 'v.pdf', mime: 'application/pdf', base64: PDF } })).status, 400, 'già scaduta');
  assert.equal((await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.r_pes, file: { nome: 'x.pdf', mime: 'application/pdf', base64: PDF } })).status, 400, 'il PES è del dipendente, non dell\'azienda');
  assert.equal((await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.r_pes, worker_id: w.body.id, issued_on: today, file: { nome: 'pes.pdf', mime: 'application/pdf', base64: PDF } })).status, 201);
  assert.equal((await c.call('POST', '/fornitori/api/documenti', { doc_type_id: T.m_ce, vehicle_id: m.body.id, file: { nome: 'ce.exe', mime: 'application/x-msdownload', base64: PDF } })).status, 400);
  st = await c.call('GET', '/fornitori/api/stato');
  assert.equal(st.body.docs.in_verifica, 1);
  const file = await c.call('GET', `/fornitori/api/documenti/${up.body.id}/file`);
  assert.equal(file.status, 200);
  // Alma vede il file e lo storico
  assert.equal((await D('GET', `/api/hqse/documenti/${up.body.id}/file`)).status, 200);
  // azienda e colleghi
  assert.equal((await c.call('PATCH', '/fornitori/api/azienda', { ccnl: 'Edilizia industria', medico: 'Dott.ssa Anna Esempio', pec: 'edil@pec.it' })).status, 200);
  const inv = await c.call('POST', '/fornitori/api/colleghi', { email: 'laura@edilesempio.it', name: 'Laura', can_upload: false });
  assert.equal(inv.status, 201);
  assert.match(lastMailTo('laura@edilesempio.it').subject, /ti ha invitato/);
  const az = await c.call('GET', '/fornitori/api/azienda');
  assert.equal(az.body.ccnl, 'Edilizia industria');
  assert.equal(az.body.people.length, 2);
  const laura = await enter('laura@edilesempio.it');
  assert.equal((await laura.call('POST', '/fornitori/api/mezzi', { kind: 'Escavatore' })).status, 403, 'solo lettura');
  assert.equal((await laura.call('POST', '/fornitori/api/questionario', { tipo: 'servizi' })).status, 403, 'solo il referente');
  assert.equal((await c.call('DELETE', `/fornitori/api/colleghi/${inv.body.id}`)).status, 200);
  assert.equal((await laura.call('GET', '/fornitori/api/stato')).status, 401, 'tolta: fuori subito');
  const sk = await D('GET', `/api/hqse/fornitori/${st.body.supplier.id}`);
  assert.match(sk.body.history.map(h => h.text).join(' | '), /ha caricato «Visura camerale/);
});

test('invito al portale da Alma per un fornitore messo in qualifica a mano', async () => {
  const { rows: [s] } = await db.query("INSERT INTO crm_subjects (name, vat) VALUES ('Scavi Esempio', '55667788990') RETURNING id");
  const q = await D('POST', '/api/hqse/fornitori', { subject_id: s.id, tipo_appalto: 'servizi' });
  assert.equal((await D('POST', `/api/hqse/fornitori/${q.body.id}/invita`, { email: 'info@scaviesempio.it', name: 'Luca' })).status, 201);
  assert.match(lastMailTo('info@scaviesempio.it').subject, /Benvenuto/);
  const people = await D('GET', `/api/hqse/fornitori/${q.body.id}/persone`);
  assert.equal(people.body[0].role, 'referente');
});
