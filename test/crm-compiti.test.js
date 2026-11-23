// ALM2-71 (canvas CRM v18): compiti a più persone, Condividi con un collega, Persone da aggiungere nella scheda azienda.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const P = require('../lib/crm-persone');

let server, base, db, D, E, F, G;
const ADMIN = 'direzione@almacis.it';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const plus = n => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let prompts = [];
async function fakeOpenAI(url, init) {
  const input = JSON.parse(init.body).input;
  prompts.push(input);
  const persone = [
    { nome: 'Elena Rinaldi', ruolo: 'Responsabile ufficio tecnico', linkedin: 'https://www.linkedin.com/in/elena-rinaldi-123', fonte: 'linkedin', url: 'https://www.linkedin.com/in/elena-rinaldi-123' },
    { nome: 'Giorgio Valli', ruolo: 'RUP', fonte: 'anac', dettaglio: 'CIG A1B2C3 manutenzione reti', url: 'https://ente.example.it/determina.pdf' },
    { nome: 'Mario Bianchi', ruolo: 'Già contatto', fonte: 'sito', url: 'https://acque.example.it/chi-siamo' },
    { nome: 'Senza', ruolo: 'nome solo', fonte: 'sito', url: 'https://acque.example.it' },
  ];
  return { ok: true, json: async () => ({ output_text: JSON.stringify({ persone }), output: [{ type: 'web_search_call' }], usage: { input_tokens: 1000, output_tokens: 300 } }) };
}

async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
const as = cookie => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
const meId = async who => (await who('GET', '/api/me')).body.id ?? (await who('GET', '/api/me')).body.user?.id;
const wait = () => new Promise(r => setTimeout(r, 60));
const notes = async email => (await db.query("SELECT n.body, n.link FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = $1 AND n.kind = 'crm' ORDER BY n.id", [email])).rows;

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, API_WRITE_MAX: '2000' }), { db, crmFetchEvents: async () => [], radarFetch: fakeOpenAI });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
  E = as(await login('edile@almacis.it'));
  F = as(await login('facility@almacis.it'));
  G = as(await login('reti@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('compiti: «Uno per tutti» è uno solo con più persone, «Uno a testa» uno per persona; note e avvisi', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Acque Compiti', roles: ['lead'], asa: ['edilizia'] })).body;
  const [eId, fId, gId] = [await meId(E), await meId(F), await meId(G)];
  const tutti = await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Sopralluogo alla cabina', due_date: plus(3), owner_ids: [eId, fId, gId], note: 'Portate le chiavi', channel: 'sopralluogo' });
  assert.equal(tutti.status, 201);
  assert.equal(tutti.body.created.length, 1);
  assert.equal(tutti.body.owner_id, eId);
  assert.equal(tutti.body.note, 'Portate le chiavi');
  // il compito compare nei Compiti di tutti e tre
  for (const who of [E, F, G]) assert.ok((await who('GET', '/api/crm/steps?di=me')).body.steps.some(x => x.id === tutti.body.id));
  const list = (await E('GET', `/api/crm/subjects/${s.id}/steps`)).body;
  const row = list.open.find(x => x.id === tutti.body.id);
  assert.deepEqual(row.people.map(p => p.id).sort(), [fId, gId].sort());
  assert.equal(row.created_by_name.length > 0, true);
  // basta che uno lo chiuda
  assert.equal((await F('POST', `/api/crm/steps/${tutti.body.id}/done`, { outcome: 'fatto' })).status, 200);
  assert.ok(!(await G('GET', '/api/crm/steps?di=me')).body.steps.some(x => x.id === tutti.body.id));

  const testa = await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Chiamare l\'ufficio acquisti', due_date: plus(1), owner_ids: [fId, gId], mode: 'testa' });
  assert.equal(testa.body.created.length, 2);
  assert.deepEqual(testa.body.created.map(x => x.owner_id).sort(), [fId, gId].sort());
  await wait();
  const nf = await notes('facility@almacis.it');
  assert.ok(nf.some(n => /Sopralluogo alla cabina/.test(n.body) && /insieme a 2 colleghi/.test(n.body) && n.link === `/crm/scheda/${s.id}/compiti`));
  assert.ok(nf.some(n => /Chiamare l'ufficio acquisti/.test(n.body) && !/insieme/.test(n.body)));
  // persona sconosciuta
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'X', due_date: plus(1), owner_ids: [999999] })).status, 400);

  // modifica: aggiungo una persona, le arriva l'avviso
  const solo = (await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Mandare le referenze', due_date: plus(5), owner_ids: [eId] })).body;
  assert.equal((await E('PATCH', `/api/crm/steps/${solo.id}`, { owner_ids: [eId, gId] })).status, 200);
  await wait();
  assert.ok((await notes('reti@almacis.it')).some(n => /Mandare le referenze/.test(n.body)));
  assert.ok((await G('GET', '/api/crm/steps?di=me')).body.steps.some(x => x.id === solo.id));
});

test('compiti del contatto: quelli con quella persona; la cronologia dice chi ha dato il compito', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Contatto Compiti Srl', roles: ['lead'], asa: ['edilizia'] })).body;
  const c = (await E('POST', '/api/crm/contacts', { first_name: 'Paolo', last_name: 'Ferri', email: 'p.ferri@contattocompiti.it', links: [{ subject_id: s.id, job: 'Acquisti' }] })).body;
  const fId = await meId(F);
  const st = (await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Chiedere dell\'albo fornitori', due_date: plus(2), owner_ids: [fId], contact_id: c.id })).body;
  await E('POST', `/api/crm/subjects/${s.id}/steps`, { title: 'Senza contatto', due_date: plus(2) });
  const r = (await E('GET', `/api/crm/contacts/${c.id}/steps`)).body;
  assert.deepEqual(r.open.map(x => x.id), [st.id]);
  const tl = (await E('GET', `/api/crm/subjects/${s.id}/timeline`)).body.items;
  assert.ok(tl.some(i => i.type === 'task' && /ha dato un compito a .*«Chiedere dell'albo fornitori»/.test(i.title)));
});

test('condividi: avviso con il link e il messaggio, nella cronologia con «aperta»; chi non vede il CRM è bloccato', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Condivisa Spa', roles: ['lead'], asa: ['edilizia'] })).body;
  const [fId, gId] = [await meId(F), await meId(G)];
  const people = (await E('GET', '/api/crm/condividi/persone')).body;
  assert.ok(people.some(u => u.id === fId && u.crm === true));
  const eId = await meId(E);
  assert.ok(!people.some(u => u.id === eId));
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/condividi`, { user_ids: [] })).status, 400);
  const ok = await E('POST', `/api/crm/subjects/${s.id}/condividi`, { user_ids: [fId], message: 'Rifanno l\'albo a gennaio' });
  assert.equal(ok.status, 201);
  await wait();
  assert.ok((await notes('facility@almacis.it')).some(n => n.link === `/crm/scheda/${s.id}` && /ti ha condiviso Condivisa Spa: «Rifanno l'albo a gennaio»/.test(n.body)));
  let tl = (await E('GET', `/api/crm/subjects/${s.id}/timeline`)).body.items;
  const sh = tl.find(i => i.type === 'share');
  assert.ok(sh && /ha condiviso la scheda con/.test(sh.title) && !sh.opened && sh.body === 'Rifanno l\'albo a gennaio');
  assert.equal((await F('POST', `/api/crm/subjects/${s.id}/condivisioni/aperta`, {})).body.opened, 1);
  tl = (await E('GET', `/api/crm/subjects/${s.id}/timeline`)).body.items;
  assert.ok(tl.find(i => i.type === 'share').opened);
  // un collega sospeso (o senza CRM) non riceve: si dice prima
  await db.query("UPDATE users SET suspended_at = now() WHERE email = 'reti@almacis.it'");
  const no = await E('POST', `/api/crm/subjects/${s.id}/condividi`, { user_ids: [gId] });
  assert.equal(no.status, 409);
  assert.equal(no.body.code, 'senza_crm');
  assert.deepEqual(no.body.blocked, [gId]);
  await db.query("UPDATE users SET suspended_at = NULL WHERE email = 'reti@almacis.it'");
  // anche un contatto
  const c = (await E('POST', '/api/crm/contacts', { first_name: 'Sara', last_name: 'Colombo', links: [{ subject_id: s.id }] })).body;
  assert.equal((await E('POST', `/api/crm/contacts/${c.id}/condividi`, { user_ids: [fId] })).status, 201);
  await wait();
  assert.ok((await notes('facility@almacis.it')).some(n => n.link === `/crm/contatti/${c.id}` && /Sara Colombo/.test(n.body)));
});

test('persone da aggiungere: dalla mia posta (solo mia), dagli incontri, e Alma su sito, LinkedIn e RUP delle gare', async () => {
  const s = (await E('POST', '/api/crm/subjects', { name: 'Acque Persone Spa', roles: ['lead'], asa: ['edilizia'], website: 'https://www.acquepersone.it', vat: '01234567897' })).body;
  await E('POST', '/api/crm/contacts', { first_name: 'Mario', last_name: 'Bianchi', email: 'm.bianchi@acquepersone.it', links: [{ subject_id: s.id }] });
  const [eId, fId] = [await meId(E), await meId(F)];
  await db.query(`INSERT INTO crm_mail_people (user_id, email, name, received, sent, last_at) VALUES
    ($1, 's.colombo@acquepersone.it', 'Sara Colombo', 5, 2, now()), ($1, 'noreply@acquepersone.it', 'Avvisi', 9, 0, now()),
    ($1, 'm.bianchi@acquepersone.it', 'Mario Bianchi', 3, 3, now()), ($1, 'altro@altrove.it', 'Altro', 3, 3, now()),
    ($2, 'l.verdi@acquepersone.it', 'Luca Verdi', 4, 1, now())`, [eId, fId]);
  await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_cf, sa_name, month) VALUES ('A1B2C3', 'Manutenzione reti idriche', '01234567897', 'Acque Persone', '202610')`);
  let r = (await E('GET', `/api/crm/subjects/${s.id}/persone`)).body;
  assert.deepEqual(r.people.filter(p => p.source === 'posta').map(p => p.email), ['s.colombo@acquepersone.it']); // né no-reply, né già contatto, né la posta di altri
  assert.equal(r.tenders, 1);
  assert.ok(r.domains.includes('acquepersone.it'));
  const rf = (await F('GET', `/api/crm/subjects/${s.id}/persone`)).body;
  assert.deepEqual(rf.people.filter(p => p.source === 'posta').map(p => p.email), ['l.verdi@acquepersone.it']);
  // Alma cerca: il prompt porta i CIG delle gare; chi è già contatto e chi non ha cognome non entrano
  prompts = [];
  const found = await E('POST', `/api/crm/subjects/${s.id}/persone/cerca`, {});
  assert.equal(found.status, 200);
  assert.equal(found.body.added, 2);
  assert.match(prompts[0], /A1B2C3/);
  assert.match(prompts[0], /Mario Bianchi/);
  r = (await E('GET', `/api/crm/subjects/${s.id}/persone`)).body;
  const anac = r.people.find(p => p.source === 'anac');
  const li = r.people.find(p => p.source === 'linkedin');
  assert.equal(anac.name, 'Giorgio Valli');
  assert.equal(li.linkedin, 'https://www.linkedin.com/in/elena-rinaldi-123');
  assert.equal(r.last_search.found, 2);
  // una seconda ricerca non rimette le stesse
  assert.equal((await E('POST', `/api/crm/subjects/${s.id}/persone/cerca`, {})).body.added, 0);
  // Ignora: non torna; Aggiunta: sparisce
  assert.equal((await E('POST', `/api/crm/persone-proposte/${anac.id}`, { status: 'ignorata' })).status, 200);
  assert.equal((await E('POST', `/api/crm/persone-proposte/${li.id}`, { status: 'boh' })).status, 400);
  await E('POST', '/api/crm/scrivo/ignora', { email: 's.colombo@acquepersone.it' });
  r = (await E('GET', `/api/crm/subjects/${s.id}/persone`)).body;
  assert.ok(!r.people.some(p => p.source === 'anac' || p.source === 'posta'));
  await E('POST', '/api/crm/contacts', { first_name: 'Elena', last_name: 'Rinaldi', links: [{ subject_id: s.id }] });
  r = (await E('GET', `/api/crm/subjects/${s.id}/persone`)).body;
  assert.ok(!r.people.some(p => p.name === 'Elena Rinaldi'), 'chi è già contatto non è più proposto');
});

test('parsePeople: solo persone con nome e cognome, la fonte giusta, LinkedIn solo /in/', () => {
  const out = P.parsePeople(JSON.stringify({ persone: [
    { nome: 'Anna Neri', fonte: 'linkedin', url: 'https://www.linkedin.com/in/anna-neri', linkedin: 'https://www.linkedin.com/in/anna-neri?trk=x' },
    { nome: 'Anna  Neri', fonte: 'sito', url: 'https://x.it' },
    { nome: 'Bruno', fonte: 'sito', url: 'https://x.it' },
    { nome: 'Carla Blu', fonte: 'boh', url: 'https://x.it/chi-siamo', email: 'non-una-email' },
    { nome: 'Dario Rossi', fonte: 'linkedin', linkedin: 'https://www.linkedin.com/company/acme' },
  ] }), [{ url: 'https://fallback.it' }], { known: ['dario rossi'] });
  assert.deepEqual(out.map(p => p.name), ['Anna Neri', 'Carla Blu']);
  assert.equal(out[0].linkedin, 'https://www.linkedin.com/in/anna-neri');
  assert.equal(out[1].source, 'sito');
  assert.equal(out[1].email, '');
});
