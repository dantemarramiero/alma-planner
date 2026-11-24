// Alma Procurement (ALM2-81): capitolato, fornitori con etichette, «Chiedi ad Alma» (ricerca finta senza chiave),
// richiesta di quotazione con bozza nel tono della persona, invio dalla casella (finta), risposta con l'offerta letta,
// sollecito, DDT di BOSS da file → merci proposte.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const R = require('../lib/procurement');

let server, base, db, app, D, U;
const ADMIN = 'direzione@almacis.it';
const USER = 'acquisti@almacis.it';
const B = '/api/crm/procurement';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body, { raw = false } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(cookie ? { cookie } : {}), 'X-Alma': '1', ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  ({ app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db }));
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await login(ADMIN);
  D = (method, path, body, o) => api(a, method, path, body, o);
  const u = await login(USER);
  U = (method, path, body, o) => api(u, method, path, body, o);
});
after(async () => { app?.locals.procurementFake?.stop(); server?.close(); await db?.close(); });

test('categoria dalle parole, offerta dalla risposta, tono sulla barra', () => {
  assert.deepEqual(R.guessCategory('CLS C25/30 XC2 S4 pompato'), { category: 'materiali', subcategory: 'Calcestruzzo' });
  assert.equal(R.guessCategory('Nolo escavatore 25 t con operatore').category, 'noli');
  assert.equal(R.guessCategory('Smaltimento terre e rocce 17 05 04').subcategory, 'Rifiuti e terre da scavo');
  const o = R.offerFromText('Ciao,\nper Roma Sud ti facciamo 96 €/m³ franco cantiere, pompa a parte. Pagamento 60 gg DFFM.');
  assert.equal(o.price, 96);
  assert.match(o.payment, /60 gg/);
  assert.equal(R.offerFromText('la nostra migliore offerta è 104,00 € al m³').price, 104);
  assert.equal(R.offerFromText('prezzo € 1.250,50 a corpo').price, 1250.5);
  assert.equal(R.toneLevel({ n: 0 }), 15);
  assert.equal(R.toneLevel({ n: 3, tu: true }), 85);
  const p = R.parseSuppliers('ecco {"merce":{"nome":"Casseri in alluminio","categoria":"noli"},"fornitori":[{"nome":"Casseforme Srl","piva":"IT 01234567890","sito":"casseforme.it","email":"x","qualita":true},{"nome":"casseforme srl"}]}');
  assert.equal(p.merce.category, 'noli');
  assert.equal(p.suppliers.length, 1, 'i doppioni per nome si tolgono');
  assert.equal(p.suppliers[0].vat, '01234567890');
  assert.equal(p.suppliers[0].website, 'https://casseforme.it');
  assert.equal(p.suppliers[0].email, '', 'un\'email non valida non passa');
  assert.equal(p.suppliers[0].quality, true);
});

test('le righe dei DDT si leggono per nome di colonna', () => {
  const rows = R.ddtRows([['Data DDT', 'Ragione sociale', 'Partita IVA', 'Descrizione articolo', 'Commessa', 'Q.tà', 'UM'],
    ['19/11/2026', 'STRADAIOLI CALCESTRUZZI S.R.L.', 'IT11313381003', 'CLS C25/30 XC2 S4', 'AL1013.0', '12,5', 'mc'], ['', '', '', '', '', '', '']], 'ddt.csv');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].ddt_date, rows[0].vat, rows[0].job_code, rows[0].quantity], ['2026-11-19', '11313381003', 'AL1013.0', 12.5]);
  assert.throws(() => R.ddtRows([['Data', 'Importo'], ['1', '2']]), /Fornitore/);
});

let itemId, stradaioli, heidelberg;
test('capitolato: nuova merce, doppione, fornitore collegato, scheda', async () => {
  let r = await U('POST', `${B}/merci`, { category: 'materiali', subcategory: 'Calcestruzzo', name: 'Calcestruzzo C25/30 XC2', unit: 'm³', specs: 'Rck 30, XC2, S4', bus: ['Edilizia', 'Reti AP'] });
  assert.equal(r.status, 201);
  itemId = r.body.item.id;
  r = await U('POST', `${B}/merci`, { category: 'materiali', name: 'calcestruzzo c25/30 xc2' });
  assert.equal(r.status, 409);
  r = await U('POST', `${B}/merci`, { category: 'niente', name: 'X' });
  assert.equal(r.status, 400);

  const { rows: [u] } = await db.query('SELECT id FROM users WHERE email = $1', [USER]);
  ({ rows: [{ id: stradaioli }] } = await db.query(`INSERT INTO crm_subjects (name, vat, roles, asa, owner_id, created_by) VALUES ('Stradaioli Calcestruzzi S.r.l.', '11313381003', '{fornitore}', '{}', $1, $1) RETURNING id`, [u.id]));
  ({ rows: [{ id: heidelberg }] } = await db.query(`INSERT INTO crm_subjects (name, vat, email, roles, asa, owner_id, created_by) VALUES ('Heidelberg Materials Esempio', '01038320162', 'commerciale@heidelberg-esempio.it', '{cliente}', '{}', $1, $1) RETURNING id`, [u.id]));
  const { rows: [c] } = await db.query(`INSERT INTO crm_contacts (first_name, last_name, email, created_by) VALUES ('Marco', 'Rossi', 'marco@stradaiolicalcestruzzi.it', $1) RETURNING id`, [u.id]);
  await db.query('INSERT INTO crm_contact_links (contact_id, subject_id, is_primary) VALUES ($1, $2, true)', [c.id, stradaioli]);

  for (const sid of [stradaioli, heidelberg]) assert.equal((await U('POST', `${B}/merci/${itemId}/fornitori`, { subject_id: sid })).status, 200);
  const { rows: [h] } = await db.query('SELECT roles, supplier_categories FROM crm_subjects WHERE id = $1', [heidelberg]);
  assert.ok(h.roles.includes('fornitore'), 'collegato a una merce diventa fornitore nel CRM');
  assert.ok(h.supplier_categories.includes('materiali'));

  r = await U('GET', `${B}/capitolato?categoria=materiali`);
  assert.equal(r.status, 200);
  assert.equal(r.body.categories.find(c0 => c0.key === 'materiali').n, 1);
  assert.equal(r.body.items[0].suppliers.length, 2);
  r = await U('GET', `${B}/merci/${itemId}`);
  assert.equal(r.body.item.name, 'Calcestruzzo C25/30 XC2');
});

test('etichette e filtro dei fornitori', async () => {
  let r = await U('POST', `${B}/fornitori/${heidelberg}/etichette`, { tag: 'qualita' });
  assert.equal(r.status, 200);
  assert.equal(r.body.tags[0].confirmed, true);
  r = await U('GET', `${B}/fornitori?filtro=qualita`);
  assert.deepEqual(r.body.suppliers.map(s => s.id), [heidelberg]);
  r = await U('GET', `${B}/fornitori`);
  const s = r.body.suppliers.find(x => x.id === stradaioli);
  assert.equal(s.contact.email, 'marco@stradaiolicalcestruzzi.it');
  assert.deepEqual(s.items, ['Calcestruzzo C25/30 XC2']);
});

test('Chiedi ad Alma: i fornitori trovati entrano nel CRM, Da qualificare, con la merce nuova; «Togli» li toglie', async () => {
  const r = await U('POST', `${B}/chiedi`, { domanda: 'Mi serve un fornitore di casseri in alluminio a noleggio per Pescara' });
  assert.equal(r.status, 200);
  assert.equal(r.body.fake, true);
  assert.equal(r.body.found.length, 3);
  assert.ok(r.body.item.created, 'merce nuova creata');
  assert.equal(r.body.item.category, 'noli');
  const first = r.body.found[0];
  assert.ok(first.created);
  assert.ok(first.tags.includes('da_qualificare') && first.tags.includes('qualita'));
  const { rows: [s] } = await db.query('SELECT roles, origin FROM crm_subjects WHERE id = $1', [first.subject_id]);
  assert.deepEqual(s.roles, ['fornitore']);
  assert.equal(s.origin, 'Alma Procurement (web)');
  const again = await U('POST', `${B}/chiedi`, { domanda: 'Mi serve un fornitore di casseri in alluminio a noleggio per Pescara' });
  assert.equal(again.body.found[0].created, false, 'la seconda volta non crea doppioni');
  const t = await U('POST', `${B}/chiedi/${first.subject_id}/togli`, { merce_id: r.body.item.id });
  assert.equal(t.body.removed_from_crm, true);
  assert.equal((await db.query('SELECT 1 FROM crm_subjects WHERE id = $1', [first.subject_id])).rows.length, 0);
  assert.equal((await U('GET', `${B}/ricerche`)).body.searches.length, 2);
});

let rfqId;
test('quotazione: un\'email per referente nel tono, approva, invia, risposta con il prezzo, sollecito', async () => {
  let r = await U('POST', `${B}/quotazioni`, { merce_id: itemId, fornitori: [stradaioli, heidelberg], quantita: '1.200', cantiere: 'Roma Sud · AL1013', consegna: 'dal 15 gennaio per 8 settimane', entro: '2026-12-05' });
  assert.equal(r.status, 201);
  rfqId = r.body.rfq.id;
  const [a, b] = r.body.recipients;
  assert.equal(a.email, 'marco@stradaiolicalcestruzzi.it');
  assert.equal(a.tone.tu, true, 'con Marco vi date del tu (dalle email passate)');
  assert.equal(a.tone.level, 85);
  assert.match(a.body, /Ciao Marco/);
  assert.equal(b.tone.n, 0, 'con Heidelberg nessuna email: primo contatto');
  assert.match(a.mail_subject, /Calcestruzzo C25\/30 XC2/);

  r = await U('POST', `${B}/quotazioni/${rfqId}/invia`);
  assert.equal(r.status, 400, 'senza approvazione non parte niente');
  r = await D('POST', `${B}/quotazioni/${rfqId}/approva-tutte`);
  assert.equal(r.status, 403, 'le email partono solo dalla casella di chi ha preparato la richiesta');
  r = await U('PUT', `${B}/quotazioni/${rfqId}/destinatari/${a.id}`, { testo: `${a.body}\n\nP.S. il pompaggio a parte.`, approvata: true });
  assert.equal(r.status, 200);
  r = await U('POST', `${B}/quotazioni/${rfqId}/approva-tutte`);
  assert.ok(r.body.recipients.every(x => x.approved));
  r = await U('POST', `${B}/quotazioni/${rfqId}/invia`);
  assert.equal(r.body.sent, 2);
  r = await U('PUT', `${B}/quotazioni/${rfqId}/destinatari/${a.id}`, { testo: 'cambio' });
  assert.equal(r.status, 409, 'un\'email partita non si cambia');

  const fake = app.locals.procurementFake;
  const sent = fake.sent.find(m => m.toRecipients?.[0]?.emailAddress?.address === 'marco@stradaiolicalcestruzzi.it' && /Calcestruzzo/.test(m.subject));
  assert.ok(sent, 'email nella posta inviata');
  fake.arrive(sent.conversationId, { from: 'marco@stradaiolicalcestruzzi.it', text: 'Ciao,\nti facciamo 96 €/m³ franco cantiere, pompa a parte.\nPagamento 60 gg DFFM.\n\nMarco' });
  r = await U('GET', `${B}/quotazioni/${rfqId}`);
  const ra = r.body.recipients.find(x => x.id === a.id);
  assert.equal(ra.status, 'risposta');
  assert.equal(ra.offer.price, 96);
  assert.equal(r.body.recipients.find(x => x.id === b.id).status, 'inviata');

  r = await U('POST', `${B}/quotazioni/${rfqId}/sollecita`);
  assert.equal(r.body.reminded, 1, 'si sollecita solo chi non ha risposto');
  r = await U('GET', `${B}/home`);
  assert.equal(r.body.totals.replies, 1);
  assert.equal(r.body.last_reply.id, rfqId);
  assert.equal((await U('GET', `${B}/quotazioni`)).body.rfqs[0].replies, 1);
});

test('fornitore senza email: la richiesta lo segnala invece di inventare', async () => {
  const { rows: [s] } = await db.query(`INSERT INTO crm_subjects (name, roles, asa) VALUES ('Senza Email Srl', '{fornitore}', '{}') RETURNING id`);
  const r = await U('POST', `${B}/quotazioni`, { merce_id: itemId, fornitori: [s.id] });
  assert.equal(r.body.recipients[0].status, 'errore');
  assert.match(r.body.recipients[0].error, /email/);
  const p = await U('PUT', `${B}/quotazioni/${r.body.rfq.id}/destinatari/${r.body.recipients[0].id}`, { email: 'ufficio@senzaemail.it' });
  assert.equal(p.body.recipient.status, 'bozza');
});

test('DDT di BOSS da file: merci proposte, aggiunte con i fornitori per P.IVA, o ignorate', async () => {
  const csv = 'Data DDT;Fornitore;P.IVA;Descrizione;Commessa;BU\n19/11/2026;STRADAIOLI CALCESTRUZZI S.R.L.;11313381003;Conglomerato bituminoso binder 0/20;AL1013.0;Reti AP\n'
    + '18/11/2026;ASFALTI ESEMPIO SRL;09876543210;conglomerato bituminoso binder 0/20;AL1001.0;Reti AP\n17/11/2026;BAR CENTRALE;;Caffè;AL1001.0;\n';
  let r = await U('POST', `${B}/ddt?nome=ddt.csv`, Buffer.from(csv), { raw: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 3);
  r = await U('GET', `${B}/ddt/proposte`);
  const bit = r.body.list.find(x => /binder/i.test(x.name));
  assert.equal(bit.n, 2);
  assert.equal(bit.category, 'materiali');
  assert.equal(bit.subcategory, 'Bitumi');
  r = await U('POST', `${B}/ddt/proposte/aggiungi`, { key: bit.key, name: 'Conglomerato bituminoso binder', category: 'materiali', subcategory: 'Bitumi', unit: 't' });
  assert.equal(r.body.suppliers, 2);
  const { rows } = await db.query('SELECT s.name, l.source FROM proc_item_suppliers l JOIN crm_subjects s ON s.id = l.subject_id WHERE l.item_id = $1 ORDER BY s.name', [r.body.item.id]);
  assert.deepEqual(rows.map(x => x.source), ['boss', 'boss']);
  assert.ok(rows.some(x => x.name === 'Stradaioli Calcestruzzi S.r.l.'), 'Stradaioli riconosciuto per P.IVA, niente doppione');
  const caffe = (await U('GET', `${B}/ddt/proposte`)).body.list.find(x => /caff/i.test(x.name));
  await U('POST', `${B}/ddt/proposte/ignora`, { key: caffe.key });
  assert.equal((await U('GET', `${B}/ddt/proposte`)).body.total, 0);
  r = await U('GET', `${B}/fornitori?q=stradaioli`);
  assert.equal(r.body.suppliers[0].ddt.n, 1);
});
