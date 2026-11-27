// HQSE fase 4 (ALM2-104): associazione al cantiere con le checklist di commessa, chi può entrare, rinnovi,
// proroga, deroga, impostazioni dei reminder e giro giornaliero (una email per fornitore, una volta al giorno).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const AI = require('../lib/hqse-ai');
const Z = require('../lib/hqse-scadenze');

let server, base, db, app, D, portal, T, supplierId, siteId;
const ADMIN = 'direzione@almacis.it';
const PDF = Buffer.from('%PDF-1.4\n% prova\n').toString('base64');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plusDays = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

AI.setReader(async () => null); // niente AI: decide HQSE

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
  const anon = client();
  await anon.call('POST', '/fornitori/registrazione', { ragione_sociale: 'Edil Esempio S.r.l.', piva: '01234567890', referente: 'Mario Esempio', email: 'mario@edilesempio.it', tipo: 'lavori', privacy: true });
  portal = client();
  await portal.call('POST', '/fornitori/api/codice', { email: 'mario@edilesempio.it' });
  const code = [...outbox()].reverse().find(m => m.to === 'mario@edilesempio.it').text;
  await portal.call('POST', '/fornitori/api/accedi', { email: 'mario@edilesempio.it', codice: code });
  await portal.call('POST', '/fornitori/api/questionario', { tipo: 'lavori', whitelist: true });
  supplierId = (await portal.call('GET', '/fornitori/api/stato')).body.supplier.id;
  T = Object.fromEntries((await db.query('SELECT code, id FROM hqse_doc_types')).rows.map(r => [r.code, r.id]));
  siteId = (await db.query("INSERT INTO cantieri (code, name, client, chief_email) VALUES ('AL 3015', 'Stabilimento Dompé', 'Dompé', 'capo@almacis.it') RETURNING id")).rows[0].id;
});
after(async () => { AI.setReader(null); app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

test('associa al cantiere: CL7 e checklist della commessa, email al fornitore, semaforo', async () => {
  const before = outbox().length;
  const r = await D('POST', `/api/hqse/cantieri/${siteId}/associa`, { supplier_id: supplierId, date_from: today, date_to: plusDays(60), lavorazione: 'Scavi', worker_ids: [] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.checklists_aggiunte.includes('Commessa Dompé'), r.body.checklists_aggiunte.join());
  assert.ok(r.body.checklists_aggiunte.length >= 2, 'anche la CL7');
  assert.ok(outbox().slice(before).some(m => m.to === 'mario@edilesempio.it' && /AL 3015/.test(m.subject)));
  // una seconda volta non aggiunge niente
  const again = await D('POST', `/api/hqse/cantieri/${siteId}/associa`, { supplier_id: supplierId, lavorazione: 'Scavi e reinterri' });
  assert.deepEqual(again.body.checklists_aggiunte, []);

  const list = await D('GET', '/api/hqse/cantieri');
  assert.equal(list.body.find(k => k.id === siteId).fornitori, 1);
  const s = await D('GET', `/api/hqse/cantieri/${siteId}`);
  assert.equal(s.status, 200);
  const firm = s.body.firms[0];
  assert.equal(firm.lavorazione, 'Scavi e reinterri');
  assert.equal(firm.ok, false, 'mancano i documenti');
  assert.ok(firm.blockers.length > 0 && firm.blockers[0].type_id);

  // deroga: quel documento non blocca più in questo cantiere
  const b = firm.blockers[0];
  const bad = await D('POST', '/api/hqse/deroghe', { supplier_id: supplierId, cantiere_id: siteId, doc_type_id: b.type_id, until: plusDays(60), reason: 'In arrivo', authorized_by: 'Dante' });
  assert.equal(bad.status, 400, 'oltre 30 giorni');
  const w = await D('POST', '/api/hqse/deroghe', { supplier_id: supplierId, cantiere_id: siteId, doc_type_id: b.type_id, until: plusDays(10), reason: 'Documento richiesto, arriva in settimana', authorized_by: 'Dante Marramiero' });
  assert.equal(w.status, 201);
  const s2 = await D('GET', `/api/hqse/cantieri/${siteId}`);
  assert.ok(!s2.body.firms[0].blockers.some(x => x.type_id === b.type_id));
  assert.equal(s2.body.waivers.length, 1);
  const f = await D('GET', `/api/hqse/fornitori/${supplierId}`);
  assert.ok(f.body.history.some(e => /Deroga su AL 3015/.test(e.text)));
  assert.equal(f.body.sites[0].code, 'AL 3015');
});

test('rinnovi, proroga e giro giornaliero dei reminder', async () => {
  // DURC approvato che scade fra 7 giorni
  const up = await portal.call('POST', '/fornitori/api/documenti', { doc_type_id: T.durc, file: { nome: 'durc.pdf', mime: 'application/pdf', base64: PDF }, valid_to: plusDays(7) });
  assert.ok(up.status < 300, JSON.stringify(up.body));
  const docId = (await db.query('SELECT id FROM hqse_documents WHERE supplier_id = $1 AND doc_type_id = $2', [supplierId, T.durc])).rows[0].id;
  const ok = await D('POST', `/api/hqse/documenti/${docId}/esito`, { esito: 'approvato', valid_to: plusDays(7) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const r = await D('GET', '/api/hqse/rinnovi?giorni=30');
  const row = r.body.rows.find(x => x.document_id === docId);
  assert.ok(row, 'il DURC è nei rinnovi');
  assert.equal(row.left, 7);

  // giro: una sola email al fornitore con il DURC
  const n0 = outbox().length;
  const out = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Tue' });
  assert.equal(out.fornitori, 1);
  const mail = outbox().slice(n0).find(m => m.to === 'mario@edilesempio.it');
  assert.ok(mail && /DURC/.test(mail.html), 'elenco con il DURC');
  const again = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Tue' });
  assert.equal(again.fornitori, 0, 'una volta al giorno');
  const reg = await D('GET', '/api/hqse/reminder/registro');
  assert.ok(reg.body.some(x => x.kind === 'rinnovo' && x.sent_to === 'mario@edilesempio.it'));

  // proroga: oltre il massimo no, poi 10 giorni dalla scadenza
  assert.equal((await D('POST', `/api/hqse/documenti/${docId}/proroga`, { giorni: 400, reason: 'troppo' })).status, 400);
  assert.equal((await D('POST', `/api/hqse/documenti/${docId}/proroga`, { giorni: 10 })).status, 400, 'serve il motivo');
  const p = await D('POST', `/api/hqse/documenti/${docId}/proroga`, { giorni: 10, reason: 'DURC richiesto all\'INPS', avvisa: true });
  assert.equal(p.status, 200);
  assert.equal(p.body.extended_to, plusDays(17));
  const d = (await db.query('SELECT extended_by, extended_reason FROM hqse_documents WHERE id = $1', [docId])).rows[0];
  assert.ok(d.extended_by);
  assert.match(d.extended_reason, /INPS/);
});

test('documento bloccante che scade oggi: avviso al capocommessa', async () => {
  const docId = (await db.query('SELECT id FROM hqse_documents WHERE supplier_id = $1 AND doc_type_id = $2', [supplierId, T.durc])).rows[0].id;
  await db.query('UPDATE hqse_documents SET valid_to = $2, extended_to = NULL WHERE id = $1', [docId, today]);
  const n0 = outbox().length;
  const out = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Mon', force: true });
  const sent = outbox().slice(n0);
  assert.ok(out.bloccati >= 1, JSON.stringify(out));
  assert.ok(sent.some(m => m.to === 'capo@almacis.it' && /DURC/.test(m.html)), 'avviso al capocommessa');
  assert.ok(sent.some(m => m.to === 'capo@almacis.it' && /settimana/.test(m.subject)), 'riepilogo del lunedì');
});

test('impostazioni dei reminder: validazione, salvataggio e prova', async () => {
  const g = await D('GET', '/api/hqse/reminder');
  assert.deepEqual(g.body.fornitore.prima, [30, 15, 7, 0]);
  const bad = await D('PUT', '/api/hqse/reminder', { fornitore: { ...g.body.fornitore, testo: 'Buongiorno senza elenco' }, almacis: g.body.almacis });
  assert.equal(bad.status, 400);
  const ok = await D('PUT', '/api/hqse/reminder', { fornitore: { ...g.body.fornitore, prima: [60, 30, 7], dopo_ogni: 3 }, almacis: { ...g.body.almacis, hqse_destinatari: ['qualifica@almacis.it', 'non-email'] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.fornitore.prima, [60, 30, 7]);
  assert.deepEqual(ok.body.almacis.hqse_destinatari, ['qualifica@almacis.it']);
  assert.equal((await D('GET', '/api/hqse/reminder')).body.fornitore.dopo_ogni, 3);
  const n0 = outbox().length;
  const p = await D('POST', '/api/hqse/reminder/prova', {});
  assert.equal(p.status, 200);
  assert.ok(outbox().slice(n0).some(m => m.to === ADMIN && /^\[Prova\]/.test(m.subject)));
  // togliere il fornitore dal cantiere
  assert.equal((await D('DELETE', `/api/hqse/cantieri/${siteId}/fornitori/${supplierId}`)).status, 200);
  assert.equal((await D('GET', `/api/hqse/cantieri/${siteId}`)).body.firms.length, 0);
});
