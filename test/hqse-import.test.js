// HQSE fase 5 (ALM2-105): pacchetto CSV di Vittoria, abbinamento con il CRM, import (con la prova e il rifare), scarti,
// ondate di benvenuto, reminder solo dopo il benvenuto.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const I = require('../lib/hqse-import');
const Z = require('../lib/hqse-scadenze');

let server, base, db, app, D, importId;
const ADMIN = 'direzione@almacis.it';
const PDF = Buffer.from('%PDF-1.4\n% prova\n').toString('base64');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dmy = s => s.split('-').reverse().join('/');

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie: D, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const outbox = () => app.locals.hqseMailer.outbox;

const FORNITORI = `Codice;Ragione sociale;Partita IVA;Codice fiscale;Email;Referente;Stato;Categoria
V1;EDIL ESEMPIO SRL;IT01234567890;;mario@edilesempio.it;Mario Esempio;Attivo;Lavori: impianti, edilizia
V2;Impianti Nuovi snc;09876543210;;anna@impiantinuovi.it;Anna Nuova;Attivo;Servizi
V3;Scavi Altro Nome;04455667788;;;;Attivo;Lavori
V4;Trasporti Senza;;;;;Attivo;Servizi
V5;Vecchia Ditta;11122233344;;;;Terminato;Lavori`;
const DIPENDENTI = `id_vittoria;id_fornitore;nome;cognome;codice_fiscale;attivo
R1;V1;Luca;Esempio;ESMLCU88A01H501Z;Sì
R2;V1;Paolo;Inattivo;PLINTT80A01H501Z;No
R3;V2;Giada;Nuova;;Sì`;
const documenti = () => `id_vittoria;id_fornitore;id_dipendente;documento;stato;data_documento;scadenza;file
D1;V1;;DURC ON LINE;Approvato;;${dmy(plus(90))};durc-v1.pdf
D2;V1;;DURC ON LINE;Respinto;;${dmy(plus(90))};durc-vecchio.pdf
D3;V1;;Visura camerale;Approvato;${dmy(plus(-400))};;visura.pdf
D4;V1;;Foto mezzo;Approvato;;;foto.jpg
D5;V1;;Documento strano;Approvato;;${dmy(plus(30))};strano.pdf
D6;V2;;DURC ON LINE;Approvato;;${dmy(plus(20))};
D7;V1;R1;Formazione generale lavoratori;Approvato;${dmy(plus(-30))};;form.pdf`;

before(async () => {
  db = await createDb({});
  ({ app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db }));
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  D = res.headers.get('set-cookie').split(';')[0];
  // nel CRM ci sono già Edil Esempio (stessa P.IVA) e una Scavi con nome diverso
  await db.query("INSERT INTO crm_subjects (name, vat) VALUES ('Edil Esempio S.r.l.', '01234567890'), ('Scavi Esempio S.r.l.', '04455667788')");
});
after(async () => { app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

test('CSV: separatore, virgolette, intestazioni con alias, date italiane', () => {
  const rows = I.parseCsv('"Ragione sociale";"P.IVA";Codice\n"Rossi; figli";"IT 0123";X1\n');
  assert.deepEqual(rows, [{ denominazione: 'Rossi; figli', partita_iva: 'IT 0123', id_vittoria: 'X1' }]);
  assert.equal(I.date('03/12/2026'), '2026-12-03');
  assert.equal(I.date('2026-1-5'), '2026-01-05');
  assert.equal(I.date(''), null);
});

test('carica e abbina: CRM per P.IVA, nuovi, dubbi, terminati solo storico', async () => {
  const r = await call('POST', '/api/hqse/import', { source: 'export', fornitori: FORNITORI, dipendenti: DIPENDENTI, documenti: documenti() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  importId = r.body.import.id;
  assert.deepEqual(r.body.preview.fornitori, { tutti: 5, entrano: 4, storico: 1 });
  assert.equal(r.body.preview.dipendenti.entrano, 2);
  assert.deepEqual(r.body.match, { crm: 1, nuovo: 1, dubbio: 2, decisi: 0 });
  const scavi = r.body.suppliers.find(s => s.vittoria_id === 'V3');
  assert.equal(scavi.reason, 'Nome diverso, P.IVA uguale');
  assert.ok(scavi.subject_id);
  assert.equal(r.body.suppliers.find(s => s.vittoria_id === 'V4').reason, 'Manca la P.IVA');
  // tipi: DURC e Visura non hanno lo stesso nome dei nostri finché non si abbinano
  const t = r.body.tipi.list.find(x => x.name === 'DURC ON LINE');
  assert.equal(t.doc_type_id, null);

  // abbina a mano: Scavi è quella del CRM, Trasporti si salta
  assert.equal((await call('PATCH', `/api/hqse/import/${importId}/fornitori/${scavi.id}`, { subject_id: scavi.subject_id })).status, 200);
  const tr = r.body.suppliers.find(s => s.vittoria_id === 'V4');
  assert.equal((await call('PATCH', `/api/hqse/import/${importId}/fornitori/${tr.id}`, { salta: true })).status, 200);
  const types = Object.fromEntries((await db.query('SELECT code, id FROM hqse_doc_types')).rows.map(x => [x.code, x.id]));
  for (const [name, code] of [['DURC ON LINE', 'durc'], ['Visura camerale', 'cciaa']]) assert.equal((await call('PUT', '/api/hqse/import/tipi', { vittoria_name: name, doc_type_id: types[code] })).status, 200);
  assert.equal((await call('PUT', '/api/hqse/import/tipi', { vittoria_name: 'Foto mezzo', skip: true })).status, 200);
  const o = await call('GET', `/api/hqse/import/${importId}`);
  assert.equal(o.body.match.dubbio, 0);
  assert.equal(o.body.tipi.list.find(x => x.name === 'DURC ON LINE').doc_type, 'DURC');
});

test('importa: prova su 1, poi tutto; rifare non duplica; scarti con il motivo', async () => {
  for (const k of ['durc-v1.pdf', 'visura.pdf', 'foto.jpg', 'strano.pdf', 'form.pdf']) assert.equal((await call('POST', `/api/hqse/import/${importId}/file`, { file_key: k, nome: k, mime: 'application/pdf', base64: PDF })).status, 201);
  const prova = await call('POST', `/api/hqse/import/${importId}/esegui`, { prova: 1 });
  assert.equal(prova.status, 200, JSON.stringify(prova.body));
  assert.equal(prova.body.fornitori, 1);
  const all = await call('POST', `/api/hqse/import/${importId}/esegui`, {});
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.fornitori, 3);
  assert.equal(all.body.scarti['Documento approvato senza file'], 1, JSON.stringify(all.body));
  assert.equal(all.body.scarti['Tipo di documento non abbinato'] >= 1, true);
  assert.equal(all.body.scarti['Tipo «Non importare»'], 1);

  const { rows: sups } = await db.query("SELECT q.id, q.vittoria_id, q.from_vittoria, c.name, c.roles FROM hqse_suppliers q JOIN crm_subjects c ON c.id = q.subject_id ORDER BY q.vittoria_id");
  assert.deepEqual(sups.map(s => s.vittoria_id), ['V1', 'V2', 'V3']);
  assert.equal(sups[0].name, 'Edil Esempio S.r.l.', 'il nome del CRM non cambia');
  assert.ok(sups.every(s => s.from_vittoria && s.roles.includes('fornitore')));
  const { rows: subj } = await db.query('SELECT COUNT(*)::int AS n FROM crm_subjects');
  assert.equal(subj[0].n, 3, 'una sola azienda nuova nel CRM');
  const { rows: docs } = await db.query("SELECT d.status, d.vittoria_id, t.code, d.valid_to FROM hqse_documents d JOIN hqse_doc_types t ON t.id = d.doc_type_id ORDER BY d.vittoria_id");
  assert.deepEqual(docs.map(d => d.vittoria_id), ['D1'], 'solo il DURC approvato e valido con il file (visura scaduta, respinto escluso)');
  assert.equal(docs[0].status, 'approvato');
  const { rows: w } = await db.query("SELECT w.vittoria_id, c.first_name FROM hqse_workers w JOIN crm_contacts c ON c.id = w.contact_id ORDER BY w.vittoria_id");
  assert.deepEqual(w.map(x => x.vittoria_id), ['R1', 'R3'], 'solo i dipendenti attivi');
  const { rows: pu } = await db.query("SELECT email FROM hqse_portal_users WHERE invited_by = 'vittoria' ORDER BY email");
  assert.deepEqual(pu.map(x => x.email), ['anna@impiantinuovi.it', 'mario@edilesempio.it']);
  assert.equal(outbox().length, 0, 'nessuna email prima del benvenuto');

  const again = await call('POST', `/api/hqse/import/${importId}/esegui`, {});
  assert.equal(again.body.documenti, 0);
  assert.equal(again.body.gia_presenti, 1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM hqse_documents')).rows[0].n, 1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM hqse_workers')).rows[0].n, 2);

  const csv = await call('GET', `/api/hqse/import/${importId}/scarti.csv`);
  assert.match(csv.body, /Trasporti Senza/);
  assert.match(csv.body, /Documento approvato senza file/);
});

test('benvenuto a ondate, reminder solo dopo, secondo invito dopo 7 giorni', async () => {
  // prima del benvenuto: il giro del mattino non scrive ai fornitori importati
  const who = async () => (await db.query("SELECT sent_to FROM hqse_reminders WHERE kind IN ('rinnovo','mancante') ORDER BY id")).rows.map(r => r.sent_to);
  const pre = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Tue', force: true });
  assert.equal(pre.fornitori, 0);

  const bad = await call('POST', '/api/hqse/benvenuto/ondate', { criterio: 'cantieri' });
  assert.equal(bad.status, 400, 'nessuno nei cantieri aperti');
  const w = await call('POST', '/api/hqse/benvenuto/ondate', { criterio: 'tutti', planned_on: today });
  assert.equal(w.status, 201);
  assert.equal(w.body.fornitori, 3);
  const n0 = outbox().length;
  const sent = await call('POST', `/api/hqse/benvenuto/ondate/${w.body.id}/manda`, {});
  assert.equal(sent.status, 200);
  assert.equal(sent.body.fornitori, 2);
  assert.equal(sent.body.senza_email, 1);
  const mails = outbox().slice(n0);
  const m = mails.find(x => x.to === 'mario@edilesempio.it');
  assert.ok(m && /portale nuovo/.test(m.subject) && /<b>1<\/b> documenti validi/.test(m.html), m?.html);
  assert.equal((await call('POST', `/api/hqse/benvenuto/ondate/${w.body.id}/manda`, {})).status, 409);

  const b = await call('GET', '/api/hqse/benvenuto');
  assert.equal(b.body.totals.invitati, 2);
  assert.equal(b.body.totals.senza_email, 1, 'Scavi non ha email del referente');
  assert.equal(b.body.waves[0].n, 3);
  const prev = await call('GET', '/api/hqse/benvenuto/anteprima');
  assert.match(prev.body.html, /portale/);

  // il giorno stesso del benvenuto ancora niente reminder, dal giorno dopo sì
  const same = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Tue', force: true });
  assert.equal(same.fornitori, 0, JSON.stringify(await who()));
  await db.query("UPDATE hqse_suppliers SET welcomed_at = now() - interval '3 days' WHERE welcomed_at IS NOT NULL");
  const r = await Z.runDaily(db, { mailer: app.locals.hqseMailer, today, weekday: 'Tue', force: true });
  assert.ok(r.fornitori >= 1, 'documenti mai caricati: 3 giorni dopo il benvenuto');

  // secondo invito dopo 7 giorni, una volta sola, solo a chi non è mai entrato
  await db.query("UPDATE hqse_suppliers SET welcomed_at = now() - interval '8 days' WHERE welcomed_at IS NOT NULL");
  await db.query('UPDATE hqse_portal_users SET last_login = now() WHERE email = $1', ['anna@impiantinuovi.it']);
  const n1 = outbox().length;
  await app.locals.hqseScheduler.runExtra({ today });
  const second = outbox().slice(n1);
  assert.deepEqual(second.map(x => x.to), ['mario@edilesempio.it']);
  assert.match(second[0].subject, /Promemoria/);
  await app.locals.hqseScheduler.runExtra({ today });
  assert.equal(outbox().length, n1 + 1, 'una volta sola');
  assert.equal((await call('GET', '/api/hqse/benvenuto')).body.totals.mai_entrati, 1);
});
