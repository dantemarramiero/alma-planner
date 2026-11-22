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

test('giro: legge, prepara, chiede il sì, manda, salta', async () => {
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
  await say('user', 'manda');
  const ok = await tool('manda_risposta');
  assert.equal(ok.out.inviata, true);
  assert.equal(ok.out.prossima.da, 'Giulia Russo');
  assert.equal(fake.outbox.length, 1);
  assert.equal(fake.outbox[0].all, false);
  assert.match(fake.outbox[0].body.content, /Ciao Marco/);
  assert.match(fake.outbox[0].body.content, /Da: Marco Di Pietro/); // con la citazione dell'email
  assert.equal(fake.inbox.find(m => m.id === 'pv-1').isRead, true);

  const sk = await tool('salta_email');
  assert.equal(sk.out.prossima.da, 'Paolo Lanci');
  assert.equal(fake.inbox.find(m => m.id === 'pv-2').isRead, false);

  // il tocco su Manda vale come conferma
  await tool('prepara_risposta', { dettato: 'li mando lunedì', a_tutti: true });
  const t = await D('POST', '/api/posta-voce/invia', {});
  assert.equal(t.body.prossima.finite, true);
  assert.equal(fake.outbox.length, 2);

  const f = await D('POST', '/api/posta-voce/fine', {});
  assert.equal(f.body.inviate.length, 2);
  assert.equal(f.body.saltate.length, 1);
  assert.equal((await D('POST', '/api/posta-voce/strumento', { name: 'prossima_email' })).status, 409);
});
