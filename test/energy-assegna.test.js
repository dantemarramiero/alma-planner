// ALM2-78: assegnare le opportunità di Alma Energy in un clic e crearle dalla Posta.
// Responsabile dalla pagina/elenco/in blocco con storico e avviso, filtri «Le mie» e «Senza responsabile»,
// «+ Opportunità» dalla email verso la pipeline (solo membri) con la conversazione collegata e le risposte da approvare.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { createPostaFake } = require('../lib/crm-posta-fake');
const E = require('../lib/energy-posta');

let server, base, db, fake, D, T, X, dante, tullio;
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const as = cookie => (method, path, body) => api(cookie, method, path, body);
const userId = async email => (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const notes = async uid => (await db.query("SELECT body, link FROM notifications WHERE user_id = $1 AND kind = 'energy' ORDER BY id", [uid])).rows;

before(async () => {
  db = await createDb({});
  fake = createPostaFake();
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'admin@almacis.it' }), { db, postaFake: fake, crmFetchEvents: async () => [] });
  server = app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login('dante.marramiero@almacis.it'));
  T = as(await login('tullio@almacis.it'));
  X = as(await login('marco.bianchi@almacis.it')); // in Alma Space, non nella BU Energy
  assert.equal((await D('POST', '/api/energy/members', { email: 'tullio@almacis.it' })).status, 201);
  dante = await userId('dante.marramiero@almacis.it');
  tullio = await userId('tullio@almacis.it');
});
after(async () => { server?.close(); await db?.close(); });

const newOpp = async (title, extra = {}) => (await D('POST', '/api/energy/opportunities', { kind: 'revamping', title, ...extra })).body;

test('regole senza Alma: MW, tipo e luogo dal testo dell\'email', () => {
  assert.equal(E.mwOf('impianto da 1,8 MWp a terra'), 1.8);
  assert.equal(E.mwOf('tetto da 980 kW'), 0.98);
  assert.equal(E.mwOf('3.400 kWp'), 3.4);
  assert.equal(E.mwOf('nessuna potenza'), null);
  assert.equal(E.kindOf('cede un impianto in esercizio'), 'revamping');
  assert.equal(E.kindOf('PPA on-site per il capannone'), 'ppa_onsite');
  assert.equal(E.kindOf('terreno con PAS approvata'), 'fv_classico');
  assert.deepEqual(E.placeOf('a Lanciano (CH), in esercizio'), { city: 'Lanciano', province: 'Chieti', region: 'Abruzzo' });
});

test('responsabile dalla pagina: storico «Assegnata a …», progetto allineato, avviso solo a chi la riceve', async () => {
  const o = await newOpp('Convenzione GSE Chieti');
  assert.equal(o.owner_id, dante, 'chi la crea la segue');
  const r = await D('PATCH', `/api/energy/opportunities/${o.id}`, { owner_id: tullio });
  assert.equal(r.status, 200);
  assert.equal(r.body.owner_id, tullio);
  const full = (await D('GET', `/api/energy/opportunities/${o.id}`)).body;
  const h = full.history.find(x => x.to_stage === 'owner');
  assert.match(h.note, /^Assegnata a /);
  assert.equal(h.from_stage, null, 'non conta come cambio di stadio');
  const n = await notes(tullio);
  assert.equal(n.length, 1);
  assert.match(n[0].body, /ti ha assegnato l'opportunità «Convenzione GSE Chieti»/);
  assert.equal(n[0].link, `/energy/opportunita/${o.id}`);
  // stesso responsabile: niente storico né avviso in più
  await D('PATCH', `/api/energy/opportunities/${o.id}`, { owner_id: tullio, notes: 'ok' });
  assert.equal((await notes(tullio)).length, 1);
  // togliere il responsabile
  await D('PATCH', `/api/energy/opportunities/${o.id}`, { owner_id: null });
  const after = (await D('GET', `/api/energy/opportunities/${o.id}`)).body;
  assert.equal(after.owner_id, null);
  assert.equal(after.history.find(x => x.to_stage === 'owner').note, 'Senza responsabile');
});

test('solo i membri del modulo possono essere responsabili', async () => {
  const o = await newOpp('Tetto Pescara');
  await login('marco.bianchi@almacis.it');
  const marco = await userId('marco.bianchi@almacis.it');
  const r = await D('POST', '/api/energy/opportunities/assign', { ids: [o.id], owner_id: marco });
  assert.equal(r.status, 400);
  assert.match(r.body.error || r.body.message || '', /non è tra i membri/);
  assert.equal((await X('POST', '/api/energy/opportunities/assign', { ids: [o.id], owner_id: 'me' })).status, 403);
});

test('in blocco: «Assegna a me» non avvisa, «Assegna a…» manda un solo avviso; filtri Le mie e Senza responsabile', async () => {
  const a = await newOpp('Blocco A', { owner_id: null });
  const b = await newOpp('Blocco B', { owner_id: null });
  const none = (await D('GET', '/api/energy/opportunities?owner=none')).body.opportunities.map(o => o.id);
  assert.ok(none.includes(a.id) && none.includes(b.id));
  // «Prendo io» di Tullio
  const before = (await notes(tullio)).length;
  const r1 = await T('POST', '/api/energy/opportunities/assign', { ids: [a.id, b.id], owner_id: 'me' });
  assert.deepEqual(r1.body, { changed: 2, ids: r1.body.ids });
  assert.equal((await notes(tullio)).length, before, 'chi se le assegna da solo non riceve avvisi');
  const mine = (await T('GET', '/api/energy/opportunities?owner=me')).body.opportunities.map(o => o.id);
  assert.ok(mine.includes(a.id) && mine.includes(b.id));
  // Dante le passa a sé e poi di nuovo a Tullio: un avviso solo, con il numero
  await D('POST', '/api/energy/opportunities/assign', { ids: [a.id, b.id], owner_id: dante });
  await D('POST', '/api/energy/opportunities/assign', { ids: [a.id, b.id], owner_id: tullio });
  const n = await notes(tullio);
  assert.equal(n.length, before + 1);
  assert.match(n.at(-1).body, /ti ha assegnato 2 opportunità: «Blocco [AB]» e altre 1/);
  // i membri portano le opportunità aperte
  const m = (await D('GET', '/api/energy')).body.members.find(x => x.user_id === tullio);
  assert.ok(m.open >= 2);
  assert.equal((await D('POST', '/api/energy/opportunities/assign', { ids: [], owner_id: 'me' })).status, 400);
});

test('Posta → pipeline di Alma Energy: solo membri, proposta dalle regole, creazione con azienda, persona ed email', async () => {
  assert.equal((await D('GET', '/api/crm/posta-energia')).body.can, true);
  assert.equal((await X('GET', '/api/crm/posta-energia')).body.can, false);
  assert.equal((await X('POST', '/api/crm/posta-energia/proposta', { message_id: 'm-fv-1' })).status, 403);

  const p = await D('POST', '/api/crm/posta-energia/proposta', { message_id: 'm-fv-1' });
  assert.equal(p.status, 200);
  assert.equal(p.body.fields.kind, 'revamping');
  assert.equal(p.body.fields.mw, 1.8);
  assert.equal(p.body.fields.city, 'Lanciano');
  assert.equal(p.body.person.kind, 'nuova');
  assert.equal(p.body.person.email, 'g.verdi@adriatica-advisors.it');
  assert.equal(p.body.company.kind, 'nuova');

  const c = await D('POST', '/api/crm/posta-energia/crea', { message_id: 'm-fv-1', title: 'Impianto FV 1,8 MWp a terra, Lanciano', kind: 'revamping', mw: '1,8',
    city: 'Lanciano', province: 'Chieti', region: 'Abruzzo', owner_id: tullio, new_mode: 'approva' });
  assert.equal(c.status, 201);
  const o = (await D('GET', `/api/energy/opportunities/${c.body.id}`)).body;
  assert.equal(o.owner_id, tullio);
  assert.equal(Number(o.mw), 1.8);
  assert.ok(o.company_id, 'azienda creata e collegata');
  assert.ok(o.links.some(l => l.person_id && l.email === 'g.verdi@adriatica-advisors.it' && l.role === 'referente'));
  assert.equal(o.history[0].note, 'creata da una email');
  assert.match((await notes(tullio)).at(-1).body, /ti ha assegnato l'opportunità «Impianto FV 1,8 MWp/);

  // la stessa conversazione non diventa due opportunità
  assert.deepEqual((await D('POST', '/api/crm/posta-energia/proposta', { message_id: 'm-fv-1' })).body, { already: { opportunity_id: c.body.id } });

  let em = (await D('GET', `/api/energy/opportunities/${c.body.id}/emails`)).body;
  assert.equal(em.emails.length, 1);
  assert.equal(em.mine.new_mode, 'approva');

  // arriva una risposta: aspetta il sì di chi ha collegato la conversazione, gli altri non la vedono
  fake.reply('conv-fv-lanciano', { id: 'm-fv-2', body: 'Vi mando i dati di produzione in allegato.' });
  await db.query('UPDATE energy_mail_threads SET checked_at = NULL');
  em = (await D('GET', `/api/energy/opportunities/${c.body.id}/emails`)).body;
  const waiting = em.emails.filter(e => e.status === 'da_approvare');
  assert.equal(waiting.length, 1);
  assert.equal((await T('GET', `/api/energy/opportunities/${c.body.id}/emails`)).body.emails.length, 1, 'Tullio vede solo quelle dentro');
  assert.equal((await T('POST', `/api/energy/opportunities/${c.body.id}/emails/${waiting[0].id}`, { ok: true })).status, 404);
  assert.equal((await D('POST', `/api/energy/opportunities/${c.body.id}/emails/${waiting[0].id}`, { ok: true })).status, 200);
  assert.equal((await T('GET', `/api/energy/opportunities/${c.body.id}/emails`)).body.emails.length, 2);
  assert.equal((await D('PATCH', `/api/energy/opportunities/${c.body.id}/emails`, { new_mode: 'auto' })).status, 200);
  assert.equal((await T('PATCH', `/api/energy/opportunities/${c.body.id}/emails`, { new_mode: 'auto' })).status, 404);
});
