// Posta a voce in macchina (ALM2-57): solo Dante; coda delle email da persone; bozza dal dettato; si manda solo con
// un «sì» controllato dal server (o col tocco su Manda); l'originale diventa letta; le saltate restano non lette.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createPostaVoceFake } = require('../lib/posta-voce-fake');
const PV = require('../lib/posta-voce');

let server, base, db, fake, D, other;
const DANTE = 'dante.marramiero@almacis.it';

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const realtime = { secret: async () => 'segreto-finto', connect: async () => ({ sdp: 'v=0 risposta', call_id: 'call-1' }), hangup: async () => {} };

before(async () => {
  db = await createDb({});
  fake = createPostaVoceFake();
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: DANTE }), { db, postaVoceFake: fake, postaVoceRealtime: realtime, crmFetchEvents: async () => [] });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const c = await login(DANTE);
  D = (m, p, b) => api(c, m, p, b);
  const o = await login('marco.bianchi@almacis.it');
  other = (m, p, b) => api(o, m, p, b);
});
after(async () => { server?.close(); await db?.close(); });

const tool = async (name, args = {}) => { const r = await D('POST', '/api/posta-voce/strumento', { name, arguments: JSON.stringify(args) }); assert.equal(r.status, 200); return { ...r.body, out: JSON.parse(r.body.output) }; };
const say = (role, text) => D('POST', '/api/posta-voce/trascritto', { role, text });

test('il «sì» vale solo dopo la domanda di Alma', () => {
  const L = [{ role: 'assistant', text: 'Rispondo: … Mando?', at: 10, seq: 1 }, { role: 'user', text: 'manda', at: 11, seq: 2 }];
  assert.equal(PV.yesAfter(L, 5).ok, true);
  assert.equal(PV.yesAfter(L, 20).ready, false); // la domanda è venuta prima della bozza
  assert.equal(PV.yesAfter([L[0], { role: 'user', text: 'no aspetta', at: 11, seq: 2 }], 5).ok, false);
  assert.equal(PV.yesAfter([L[0], { role: 'user', text: 'sì', at: 11, seq: 2 }], 5).ok, true);
});

test('gli altri non vedono niente', async () => {
  assert.equal((await other('GET', '/api/posta-voce/coda')).status, 404);
  assert.equal((await other('GET', '/api/me')).body.posta_voce, false);
  assert.equal((await D('GET', '/api/me')).body.posta_voce, true);
});

test('coda: solo email da persone, non lette, senza quelle già risposte', async () => {
  const r = await D('GET', '/api/posta-voce/coda');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.email.map(e => e.id), ['pv-1', 'pv-2', 'pv-old']);
  assert.equal(r.body.tolte, 3); // newsletter, noreply, già risposta
});

test('giro: legge, prepara, destinatari, email nuova, chiede il sì, manda, salta', async () => {
  // contatti del CRM per i destinatari detti a voce (due Giorgio Neri in aziende diverse)
  const subj = async n => (await db.query('INSERT INTO crm_subjects (name) VALUES ($1) RETURNING id', [n])).rows[0].id;
  const contact = async (f, l, e, sid) => { const { rows: [c] } = await db.query('INSERT INTO crm_contacts (first_name, last_name, email) VALUES ($1, $2, $3) RETURNING id', [f, l, e]); if (sid) await db.query('INSERT INTO crm_contact_links (contact_id, subject_id, is_primary) VALUES ($1, $2, true)', [c.id, sid]); };
  await contact('Sara', 'Conti', 's.conti@studioconti.it', await subj('Studio Conti'));
  await contact('Giorgio', 'Neri', 'g.neri@snam.it', await subj('Snam'));
  await contact('Giorgio', 'Neri', 'g.neri@terna.it', await subj('Terna'));
  const s = await D('POST', '/api/posta-voce/sessione', {});
  assert.equal(s.status, 200);
  assert.equal(s.body.totale, 3);
  assert.equal((await D('POST', '/api/posta-voce/collega', { sdp: 'v=0 offerta' })).body.sdp, 'v=0 risposta');

  const e1 = await tool('prossima_email');
  assert.equal(e1.out.da, 'Marco Di Pietro');
  assert.equal(e1.out.numero, 1);
  assert.ok(e1.out.chiede);

  await say('user', 'sì giovedì alle 10, porto io Luca');
  const b = await tool('prepara_risposta', { dettato: 'sì giovedì alle 10, porto io Luca' });
  assert.ok(b.out.succo);
  assert.match(b.stato.bozza.testo, /Ciao Marco/);

  // un «no» detto dopo la domanda: non parte niente
  await say('assistant', `Rispondo: ${b.out.succo}. Mando?`);
  await say('user', 'no aspetta');
  const no = await tool('manda_risposta');
  assert.equal(no.out.non_mandata, true);
  assert.equal(fake.outbox.length, 0);

  const c = await tool('modifica_risposta', { correzione: 'aggiungi che portiamo il drone' });
  assert.ok(c.out.succo);
  await say('assistant', 'Rispondo: giovedì alle 10 con Luca e il drone. Mando?');
  // destinatari a voce: in copia una persona del CRM; le persone sconosciute non si inventano
  const cc = await tool('destinatari', { copia: ['Sara Conti'] });
  assert.deepEqual(cc.out.a, ['Marco Di Pietro']);
  assert.deepEqual(cc.out.copia, ['Sara Conti']);
  const ghost = await tool('destinatari', { copia: ['Topolino'] });
  assert.deepEqual(ghost.out.non_trovati, ['Topolino']);
  assert.ok(ghost.out.da_leggere);
  await say('assistant', 'A Marco Di Pietro, in copia Sara Conti. Ciao Marco… Mando?');
  await say('user', 'manda');
  const ok = await tool('manda_risposta');
  assert.equal(ok.out.inviata, true);
  assert.equal(ok.out.prossima.da, 'Giulia Russo');
  assert.equal(fake.outbox.length, 1);
  assert.equal(fake.outbox[0].all, false);
  assert.match(fake.outbox[0].body.content, /Ciao Marco/);
  assert.match(fake.outbox[0].body.content, /Da: Marco Di Pietro/); // con la citazione dell'email
  assert.equal(fake.inbox.find(m => m.id === 'pv-1').isRead, true);
  assert.deepEqual(fake.outbox[0].toRecipients.map(r => r.emailAddress.address), ['marco.dipietro@snam.it']);
  assert.deepEqual(fake.outbox[0].ccRecipients.map(r => r.emailAddress.address), ['s.conti@studioconti.it']);

  const sk = await tool('salta_email');
  assert.equal(sk.out.prossima.da, 'Paolo Lanci');
  assert.equal(fake.inbox.find(m => m.id === 'pv-2').isRead, false);

  // email nuova dai concetti: due persone con lo stesso nome → Alma chiede quale
  const amb = await tool('nuova_email', { a: ['Giorgio Neri'], concetti: 'ci vediamo martedì per il preventivo' });
  assert.equal(amb.out.scegli[0].opzioni.length, 2);
  assert.equal(amb.stato.bozza, null);
  const nw = await tool('nuova_email', { a: ['Giorgio Neri Terna'], concetti: 'ci vediamo martedì per il preventivo' });
  assert.deepEqual(nw.out.a, ['Giorgio Neri']);
  assert.ok(nw.out.oggetto);
  assert.equal(nw.stato.bozza.nuova, true);
  await say('assistant', `A Giorgio Neri. Oggetto: ${nw.out.oggetto}. ${nw.out.da_leggere}. Mando?`);
  await say('user', 'sì');
  const sentNew = await tool('manda_risposta');
  assert.equal(sentNew.out.inviata, true);
  assert.equal(sentNew.out.torna_a.da, 'Paolo Lanci'); // torna all'email dove eri
  const n = fake.outbox[fake.outbox.length - 1];
  assert.equal(n.nuova, true);
  assert.deepEqual(n.toRecipients.map(r => r.emailAddress.address), ['g.neri@terna.it']);
  assert.equal(fake.inbox.find(m => m.id === 'pv-old').isRead, false);

  // parola per parola, a tutti; il tocco su Manda vale come conferma
  const ex = await tool('prepara_risposta', { dettato: 'li mando lunedì', a_tutti: true, esatto: true });
  assert.match(ex.stato.bozza.testo, /Li mando lunedì./);
  const t = await D('POST', '/api/posta-voce/invia', {});
  assert.equal(t.body.prossima.finite, true);
  assert.equal(fake.outbox.length, 3);

  const f = await D('POST', '/api/posta-voce/fine', {});
  assert.equal(f.body.inviate.length, 3);
  assert.equal(f.body.saltate.length, 1);
  assert.equal((await D('POST', '/api/posta-voce/strumento', { name: 'prossima_email' })).status, 409);
});
