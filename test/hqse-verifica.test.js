// HQSE fase 3 (ALM2-103): lettura dell'AI (con un lettore finto), proposta con regole fisse, coda «Da verificare»,
// esiti (approva, respingi, integrazione) con email al fornitore, rinnovo che sostituisce il vecchio, approvazione
// rapida, qualità dell'AI, livello di qualifica proposto.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const AI = require('../lib/hqse-ai');

let server, base, db, app, D, portal, T, supplierId;
const ADMIN = 'direzione@almacis.it';
const PDF = Buffer.from('%PDF-1.4\n% prova\n').toString('base64');
const today = new Date().toISOString().slice(0, 10);
const plusDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// il lettore finto risponde in base al nome del file
AI.setReader(async ({ file }) => {
  const n = file.name;
  if (n.startsWith('dvr')) return { json: { tipo_ok: true, intestatario: 'EDIL ESEMPIO SRL', piva_o_cf: '01234567890', campi: { firme_mancanti: ['RLS', 'medico competente'] } }, model: 'finto', cost: 0.01 };
  if (n.startsWith('durc')) return { json: { tipo_ok: true, intestatario: 'Edil Esempio S.r.l.', piva_o_cf: 'IT01234567890', scadenza: plusDays(100) }, model: 'finto', cost: 0.01 };
  if (n.startsWith('visura')) return { json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', data_documento: today }, model: 'finto', cost: 0.01 };
  if (n.startsWith('aut')) return { json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', data_documento: today, campi: { conflitto_interessi: true } }, model: 'finto', cost: 0.01 };
  return null;
});

function client(cookie = '') {
  const jar = { cookie };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(jar.cookie ? { cookie: jar.cookie } : {}), 'X-Portale': '1', 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set && set.startsWith('hqse_s=')) jar.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return { call, jar };
}
const outbox = () => app.locals.hqseMailer.outbox;

before(async () => {
  db = await createDb({});
  ({ app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db }));
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  D = client(res.headers.get('set-cookie').split(';')[0]).call;
  // un fornitore registrato, con il questionario fatto, e il referente dentro il portale
  const anon = client();
  await anon.call('POST', '/fornitori/registrazione', { ragione_sociale: 'Edil Esempio S.r.l.', piva: '01234567890', referente: 'Mario Esempio', email: 'mario@edilesempio.it', tipo: 'lavori', privacy: true });
  portal = client();
  await portal.call('POST', '/fornitori/api/codice', { email: 'mario@edilesempio.it' });
  const code = [...outbox()].reverse().find(m => m.to === 'mario@edilesempio.it').text;
  await portal.call('POST', '/fornitori/api/accedi', { email: 'mario@edilesempio.it', codice: code });
  await portal.call('POST', '/fornitori/api/questionario', { tipo: 'lavori', whitelist: true });
  supplierId = (await portal.call('GET', '/fornitori/api/stato')).body.supplier.id;
  T = Object.fromEntries((await db.query('SELECT code, id FROM hqse_doc_types')).rows.map(r => [r.code, r.id]));
});
after(async () => { AI.setReader(null); app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

const upload = (code, nome, extra = {}) => portal.call('POST', '/fornitori/api/documenti', { doc_type_id: T[code], file: { nome, mime: 'application/pdf', base64: PDF }, ...extra });

test('proposta con regole fisse: firme mancanti, scaduto, CCNL diverso, conflitto d\'interessi', () => {
  const type = { name: 'DVR', validity_rule: 'nessuna', ai_checks: [{ text: 'Pagina delle firme completa', on_fail: 'respingi' }] };
  const exp = { supplier: 'Edil Esempio S.r.l.', vat: '01234567890' };
  let r = AI.decide({ type, json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', controlli: [{ n: 1, ok: false, nota: 'manca RLS' }] }, expected: exp });
  assert.equal(r.proposal, 'respingere');
  assert.match(r.reason, /Pagina delle firme completa/);
  r = AI.decide({ type: { name: 'Visura', validity_rule: 'rilascio', validity_months: 6 }, json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', data_documento: '2025-01-10' }, expected: exp });
  assert.equal(r.proposal, 'respingere', 'scaduta');
  r = AI.decide({ type: { name: 'UNILAV', validity_rule: 'nessuna' }, json: { tipo_ok: true, intestatario: 'Luca Esempio', piva_o_cf: 'ESMLCU88', campi: { ccnl: 'Metalmeccanico industria' } }, expected: { ...exp, worker: 'Luca Esempio', taxCode: 'ESMLCU88', ccnl: 'Edilizia industria' } });
  assert.equal(r.proposal, 'incerto', 'CCNL diverso: si chiede');
  r = AI.decide({ type: { name: 'Autodichiarazione Unica', validity_rule: 'firma', validity_months: 6 }, json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', data_documento: today, campi: { conflitto_interessi: true } }, expected: exp });
  assert.equal(r.proposal, 'incerto');
  assert.equal(r.escalate, true);
  r = AI.decide({ type: { name: 'DURC', validity_rule: 'documento' }, json: { tipo_ok: true, intestatario: 'Edil Esempio', piva_o_cf: '01234567890', scadenza: plusDays(90) }, expected: exp });
  assert.equal(r.proposal, 'approvabile');
});

test('lettura prima dell\'invio, poi coda con le proposte', async () => {
  const pre = await portal.call('POST', '/fornitori/api/leggi', { doc_type_id: T.cciaa, file: { nome: 'visura.pdf', mime: 'application/pdf', base64: PDF } });
  assert.equal(pre.body.status, 'fatto');
  assert.equal(pre.body.data_documento, today);
  assert.ok(pre.body.valid_to > today);
  assert.equal((await upload('cciaa', 'visura.pdf', { issued_on: today })).status, 201);
  assert.equal((await upload('dvr', 'dvr.pdf')).status, 201);
  assert.equal((await upload('durc', 'durc.pdf', { valid_to: plusDays(100) })).status, 201);
  assert.equal((await upload('aut_unica', 'aut.pdf', { issued_on: today })).status, 201);
  const q = await D('GET', '/api/hqse/verifica');
  assert.equal(q.status, 200);
  assert.equal(q.body.counts.tutti, 4);
  const by = Object.fromEntries(q.body.rows.map(r => [r.type.split(' ')[0], r]));
  assert.equal(by.Visura.proposal, 'approvabile');
  assert.equal(by.DVR.proposal, 'respingere');
  assert.match(by.DVR.why, /Firme complete/);
  assert.equal(by.Autodichiarazione.proposal, 'incerto');
  assert.equal((await D('GET', '/api/hqse/verifica?filtro=respingere')).body.rows.length, 1);
});

test('esiti: respingi con email e motivo nel portale, integrazione, rinnovo approvato che sostituisce il vecchio', async () => {
  const q = (await D('GET', '/api/hqse/verifica')).body.rows;
  const dvr = q.find(r => r.type === 'DVR');
  const det = await D('GET', `/api/hqse/documenti/${dvr.id}`);
  assert.ok(det.body.ai.checks.some(c => c.ok === false));
  assert.equal((await D('POST', `/api/hqse/documenti/${dvr.id}/esito`, { esito: 'respinto' })).status, 400, 'serve il motivo');
  const r = await D('POST', `/api/hqse/documenti/${dvr.id}/esito`, { esito: 'respinto', motivi: ['Manca una firma'], reason: 'Mancano le firme di RLS e medico competente: ricarica il DVR completo.' });
  assert.equal(r.body.agreed, true, 'HQSE ha confermato la proposta');
  assert.match([...outbox()].reverse().find(m => m.to === 'mario@edilesempio.it').subject, /Da sistemare: DVR/);
  assert.equal((await D('POST', `/api/hqse/documenti/${dvr.id}/esito`, { esito: 'approvato' })).status, 409, 'già deciso');
  const st = await portal.call('GET', '/fornitori/api/stato');
  const d = st.body.checklists.flatMap(c => c.docs).find(x => x.name === 'DVR');
  assert.equal(d.state, 'respinto');
  assert.match(d.reason, /RLS/);
  // integrazione sull'autodichiarazione (dopo la segnalazione alla direzione)
  const aut = q.find(r => r.type === 'Autodichiarazione Unica');
  assert.equal((await D('POST', `/api/hqse/documenti/${aut.id}/segnala`, {})).status, 200);
  assert.equal((await D('POST', `/api/hqse/documenti/${aut.id}/esito`, { esito: 'integrazione', reason: 'Indica nella sezione 6 con chi è il conflitto.' })).status, 200);
  assert.equal((await portal.call('GET', '/fornitori/api/stato')).body.checklists.flatMap(c => c.docs).find(x => x.name === 'Autodichiarazione Unica').state, 'integrazione');
  // DURC approvato, poi un rinnovo: finché è in verifica vale il vecchio, approvato lo sostituisce
  const durc = q.find(r => r.type === 'DURC');
  await D('POST', `/api/hqse/documenti/${durc.id}/esito`, { esito: 'approvato' });
  assert.equal((await upload('durc', 'durc2.pdf', { valid_to: plusDays(200) })).status, 201);
  let s2 = await portal.call('GET', '/fornitori/api/stato');
  const ren = s2.body.checklists.flatMap(c => c.docs).find(x => x.name === 'DURC');
  assert.equal(ren.state, 'approvato');
  assert.equal(ren.renewal_pending, true);
  const newDurc = (await D('GET', '/api/hqse/verifica')).body.rows.find(r => r.type === 'DURC');
  await D('POST', `/api/hqse/documenti/${newDurc.id}/esito`, { esito: 'approvato' });
  const { rows } = await db.query("SELECT status FROM hqse_documents WHERE doc_type_id = $1 ORDER BY id", [T.durc]);
  assert.deepEqual(rows.map(r => r.status), ['superato', 'approvato']);
});

test('approvazione rapida solo sopra la soglia; qualità dell\'AI; livello proposto', async () => {
  const qa = await D('GET', '/api/hqse/qualita');
  assert.equal(qa.status, 200);
  const durc = qa.body.types.find(t => t.name === 'DURC');
  assert.equal(durc.n, 2);
  assert.equal(durc.pct, 100);
  assert.equal(durc.eligible, false, 'servono almeno 30 documenti');
  assert.equal((await D('PUT', `/api/hqse/doc-types/${T.durc}/rapida`, { on: true })).status, 400);
  // con la rapida accesa a mano sul tipo: la visura «approvabile» si approva dalla coda
  await db.query('UPDATE hqse_doc_types SET quick_approve = true WHERE id = $1', [T.cciaa]);
  const quick = await D('POST', '/api/hqse/verifica/rapida', {});
  assert.equal(quick.body.approvati, 1);
  assert.equal((await D('GET', '/api/hqse/verifica')).body.counts.tutti, 0);
  const lv = await D('GET', `/api/hqse/fornitori/${supplierId}/livello`);
  assert.equal(lv.status, 200);
  assert.equal(lv.body.proposed, 'non_valutato', 'mancano ancora documenti obbligatori');
  assert.ok(lv.body.factors.some(f => /non ancora approvati/.test(f.text)));
  const sk = await D('GET', `/api/hqse/fornitori/${supplierId}`);
  assert.match(sk.body.history.map(h => h.text).join(' | '), /Respinto «DVR»/);
});
