// «Persone con cui mi scrivo» (ALM2-46): lettura della posta (casella finta), filtri, ignora/ripristina, proposta dalla
// firma, azienda dal dominio e ricerca della finestra Ctrl K.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const S = require('../lib/crm-scrivo');

let server, base, db, D;
const ADMIN = 'direzione@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(ADMIN);
  D = (method, path, body) => api(cookie, method, path, body);
});
after(async () => { server?.close(); await db?.close(); });

test('firma: nome, titolo, ruolo, telefoni, azienda e città', () => {
  const f = S.fromSignature('Buongiorno,\nok.\n\nCordiali saluti\nIng. Luca Rossi · Direttore tecnico\nStudio Tecnico Rossi s.r.l. · Via Roma 12, 65121 Pescara (PE)\nTel. 085 123 4567 · Cell. 333 765 4321\n\nIl giorno 12/11 Mario ha scritto:\n> vecchio', { name: 'Luca Rossi' });
  assert.equal(f.title, 'Ing.');
  assert.equal(f.first_name, 'Luca');
  assert.equal(f.last_name, 'Rossi');
  assert.equal(f.job, 'Direttore tecnico');
  assert.equal(f.mobile, '333 765 4321');
  assert.equal(f.phone, '085 123 4567');
  assert.match(f.company, /Studio Tecnico Rossi/);
  assert.equal(f.city, 'Pescara');
});

test('fuori: no-reply, newsletter e domini personali senza azienda', () => {
  assert.ok(S.isAuto('no-reply@microsoft.com'));
  assert.ok(S.isAuto('newsletter@ance.it'));
  assert.ok(!S.isAuto('l.rossi@studiotecnicorossi.it'));
  assert.ok(S.isPersonal('gmail.com'));
  assert.ok(S.isPersonal('pec.aruba.it'));
  assert.equal(S.nameFromDomain('studiopace-ing.com'), 'Studiopace Ing');
});

test('prima della lettura: elenco vuoto e nessuna data', async () => {
  const r = await D('GET', '/api/crm/scrivo');
  assert.equal(r.status, 200);
  assert.equal(r.body.scanned_at, null);
  assert.deepEqual(r.body.people, []);
});

test('lettura della posta: contati per indirizzo, fuori colleghi, no-reply e newsletter', async () => {
  const up = await D('POST', '/api/crm/scrivo/aggiorna', {});
  assert.equal(up.status, 200);
  assert.equal(up.body.people, 5);
  const r = await D('GET', '/api/crm/scrivo');
  assert.equal(r.body.counts.da_aggiungere, 5);
  const emails = r.body.people.map(p => p.email);
  assert.ok(!emails.some(e => e.endsWith('@almacis.it') || e.startsWith('no-reply') || e.startsWith('newsletter')));
  const luca = r.body.people[0];
  assert.equal(luca.email, 'l.rossi@studiotecnicorossi.it', 'prima chi ha più email');
  assert.equal(luca.received + luca.sent, 12);
  assert.equal(luca.replied, true);
  assert.equal(luca.company.kind, 'nuova');
  assert.equal(r.body.people.find(p => p.email.endsWith('@gmail.com')).company.kind, 'personale');
  const only = await D('GET', '/api/crm/scrivo?risposto=1');
  assert.ok(only.body.people.every(p => p.replied));
  assert.ok(!only.body.people.some(p => p.email === 'info@studioverdi.it'));
  const q = await D('GET', '/api/crm/scrivo?q=pace');
  assert.deepEqual(q.body.people.map(p => p.email), ['andrea.pace@studiopace-ing.com']);
});

test('ignora e ripristina', async () => {
  const ig = await D('POST', '/api/crm/scrivo/ignora', { emails: ['info@studioverdi.it'] });
  assert.equal(ig.body.updated, 1);
  let r = await D('GET', '/api/crm/scrivo');
  assert.equal(r.body.counts.ignorate, 1);
  assert.ok(!r.body.people.some(p => p.email === 'info@studioverdi.it'));
  r = await D('GET', '/api/crm/scrivo?vista=ignorate');
  assert.deepEqual(r.body.people.map(p => p.email), ['info@studioverdi.it']);
  await D('POST', '/api/crm/scrivo/aggiorna', {});
  r = await D('GET', '/api/crm/scrivo?vista=ignorate');
  assert.equal(r.body.people.length, 1, 'dopo una nuova lettura resta ignorata');
  await D('POST', '/api/crm/scrivo/ignora', { emails: ['info@studioverdi.it'], ripristina: true });
  r = await D('GET', '/api/crm/scrivo');
  assert.equal(r.body.counts.ignorate, 0);
  assert.equal((await D('POST', '/api/crm/scrivo/ignora', { emails: ['non-email'] })).status, 400);
});

test('proposta: dati dalla firma e azienda nuova dal dominio', async () => {
  const r = await D('GET', '/api/crm/scrivo/proposta?email=l.rossi@studiotecnicorossi.it');
  assert.equal(r.status, 200);
  assert.equal(r.body.fields.last_name, 'Rossi');
  assert.equal(r.body.fields.mobile, '333 765 4321');
  assert.equal(r.body.company.kind, 'nuova');
  assert.match(r.body.company.name, /Studio Tecnico Rossi/);
});

test('creato il contatto con la sua azienda, passa in «Già nel CRM» e i colleghi dello stesso dominio vanno lì', async () => {
  const s = await D('POST', '/api/crm/subjects/rapida', { name: 'Studio Tecnico Rossi s.r.l.', website: 'studiotecnicorossi.it' });
  assert.equal(s.status, 201);
  const c = await D('POST', '/api/crm/contacts', { first_name: 'Luca', last_name: 'Rossi', email: 'l.rossi@studiotecnicorossi.it', links: [{ subject_id: s.body.id, job: 'Direttore tecnico', is_primary: true }] });
  assert.equal(c.status, 201);
  const r = await D('GET', '/api/crm/scrivo?vista=crm');
  assert.equal(r.body.people[0].contact.id, c.body.id);
  assert.equal(r.body.people[0].contact.subject, 'Studio Tecnico Rossi s.r.l.');
  const p = await D('GET', '/api/crm/scrivo/proposta?email=a.bianchi@studiotecnicorossi.it');
  assert.equal(p.body.company.kind, 'crm');
  assert.equal(p.body.company.subject_id, s.body.id);
});

test('ricerca della finestra Ctrl K: aziende, contatti e persone della posta', async () => {
  const r = await D('GET', '/api/crm/scrivo/cerca?q=rossi');
  assert.equal(r.status, 200);
  assert.ok(r.body.subjects.some(s => s.name.startsWith('Studio Tecnico Rossi')));
  assert.ok(r.body.contacts.some(c => c.name.includes('Rossi') && c.sub.includes('Direttore tecnico')));
  const m = await D('GET', '/api/crm/scrivo/cerca?q=pace');
  assert.deepEqual(m.body.mail.map(x => x.email), ['andrea.pace@studiopace-ing.com']);
  assert.deepEqual((await D('GET', '/api/crm/scrivo/cerca?q=r')).body, { subjects: [], contacts: [] });
});
