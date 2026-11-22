// Doppioni e «Unisci» (canvas v15, 22/11): coppie trovate da sole con il perché, «Non sono la stessa» che non torna,
// unione dato per dato (vuoti presi dall'altra, diversi nelle note), collegamenti spostati, contatti uniti e cancellati,
// P.IVA già di un'altra scheda con la scheda nell'errore, nomi simili in «Sembra già presente», chi può unire.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const D = require('../lib/crm-doppioni');

let server, base, db, A, E;
const login = async email => (await fetch(`${base}/auth/dev-login?email=${email}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
const as = cookie => async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: 'direzione@almacis.it' }), { db });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  A = as(await login('direzione@almacis.it'));
  E = as(await login('edile@almacis.it'));
});
after(async () => { server?.close(); await db?.close(); });

test('nomi: forma giuridica in fondo, «Impresa» all\'inizio, nomi simili', () => {
  assert.equal(D.normName('Edil Gamma S.p.A.'), D.normName('EDIL GAMMA SPA'));
  assert.equal(D.normName('Impresa Di Fabio'), 'di fabio');
  assert.equal(D.compact('Termo Abruzzo Srl'), D.compact('Termoabruzzo'));
  assert.ok(D.similarity('costruzionirossi', 'costruzionerossi') > 0.8);
  assert.ok(D.similarity('comunediortona', 'comunediortanova') < 0.8);
});

test('doppioni: trovati, scartati, uniti con i dati e i collegamenti', async () => {
  const me = (await db.query("SELECT id FROM users WHERE email = 'direzione@almacis.it'")).rows[0].id;
  const ins = async (name, extra = {}) => {
    const f = { name, roles: ['partner'], owner_id: me, ...extra };
    const cols = Object.keys(f);
    return (await db.query(`INSERT INTO crm_subjects (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, cols.map(c => f[c]))).rows[0].id;
  };
  const gamma = await ins('Edil Gamma S.p.A.', { vat: '00488410010', city: 'Pescara', phone: '085 111', notes: 'cliente storico' });
  const gamma2 = await ins('EDIL GAMMA SPA', { city: 'Pescara', phone: '085 222', pec: 'edilgamma@pec.it', roles: ['lead'] });
  const termo = await ins('Termo Abruzzo Srl', { website: 'https://www.termoabruzzo.it' });
  const termo2 = await ins('Termoabruzzo', { website: 'termoabruzzo.it/contatti' });
  const altra = await ins('Edil Delta Srl');
  // un contatto in Edil Gamma 2 e due contatti con la stessa email
  const c1 = (await A('POST', '/api/crm/contacts', { first_name: 'Mario', last_name: 'Rossi', email: 'm.rossi@edilgamma.it', links: [{ subject_id: gamma2 }] })).body.id;
  const c2 = (await A('POST', '/api/crm/contacts', { first_name: 'M.', last_name: 'Rossi', email: 'M.Rossi@edilgamma.it', mobile: '347 1234567', links: [{ subject_id: gamma }] })).body.id;
  await A('POST', `/api/crm/subjects/${gamma2}/notes`, { body: 'Incontro in cantiere' });

  const found = (await A('POST', '/api/crm/doppioni/cerca')).body;
  assert.ok(found.subject >= 2 && found.contact >= 1);
  const list = (await A('GET', '/api/crm/doppioni?kind=subject')).body.pairs;
  const pair = (x, y) => list.find(p => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());
  assert.deepEqual(pair(gamma, gamma2).reasons.map(r => r.code), ['nome', 'email', 'citta']); // stesso dominio dei contatti
  assert.ok(pair(termo, termo2).reasons.some(r => r.code === 'sito'));
  assert.ok(!list.some(p => [p.a.id, p.b.id].includes(altra)));
  assert.equal((await A('GET', '/api/crm/doppioni/conteggio?kind=subject&role=lead')).body.n, 1);
  assert.equal((await A('GET', `/api/crm/doppioni/di?kind=subject&id=${gamma}`)).body.pairs[0].other.id, gamma2);

  // «Non sono la stessa»: non torna alla ricerca dopo
  await A('POST', `/api/crm/doppioni/${pair(termo, termo2).id}/scarta`);
  await A('POST', '/api/crm/doppioni/cerca');
  assert.ok(!(await A('GET', '/api/crm/doppioni?kind=subject')).body.pairs.some(p => p.a.id === Math.min(termo, termo2) && p.b.id === Math.max(termo, termo2)));
  assert.equal((await A('GET', '/api/crm/doppioni?kind=subject&stato=dismissed')).body.pairs.length, 1);

  // anteprima: resta quella con la P.IVA; la PEC vuota si prende dall'altra; il telefono è diverso
  const pre = (await A('GET', `/api/crm/unisci/anteprima?kind=subject&a=${gamma2}&b=${gamma}`)).body;
  assert.equal(pre.keep.id, gamma);
  assert.equal(pre.rows.find(r => r.key === 'pec').pick, 'other');
  assert.ok(pre.rows.find(r => r.key === 'phone').differ);
  assert.ok(pre.moves.crm_contact_links >= 1 && pre.moves.crm_notes >= 1);

  // chi non è owner di tutte e due non unisce
  assert.equal((await E('POST', '/api/crm/unisci', { kind: 'subject', keep: gamma, other: gamma2 })).status, 403);
  const r = await A('POST', '/api/crm/unisci', { kind: 'subject', keep: gamma, other: gamma2, values: { name: 'keep', address: { value: 'Via Tiburtina 12, Pescara' } } });
  assert.equal(r.status, 200);
  const s = (await A('GET', `/api/crm/subjects/${gamma}`)).body;
  assert.equal(s.pec, 'edilgamma@pec.it');
  assert.equal(s.phone, '085 111');
  assert.equal(s.address, 'Via Tiburtina 12, Pescara');
  assert.match(s.notes, /cliente storico[\s\S]*Telefono: 085 222/);
  assert.deepEqual(s.roles.sort(), ['lead', 'partner']);
  assert.ok(s.contacts.some(c => c.id === c1));
  assert.equal((await A('GET', `/api/crm/subjects/${gamma}/notes`)).body[0].body, 'Incontro in cantiere');
  assert.equal((await A('GET', `/api/crm/subjects/${gamma2}`)).body.merged_into, gamma);
  assert.ok(s.history.some(h => h.to_stage === 'unione'));

  // contatti con la stessa email: si uniscono, il secondo sparisce e i suoi collegamenti passano
  const cp = (await A('GET', '/api/crm/doppioni?kind=contact')).body.pairs[0];
  assert.equal(cp.reasons[0].code, 'email');
  assert.equal((await A('POST', '/api/crm/unisci', { kind: 'contact', keep: c1, other: c2 })).status, 200);
  const c = (await A('GET', `/api/crm/contacts/${c1}`)).body;
  assert.equal(c.mobile, '347 1234567');
  assert.equal((await A('GET', `/api/crm/contacts/${c2}`)).status, 404);
  assert.ok((c.links || []).some(l => l.subject_id === gamma));
});

test('P.IVA già di un\'altra scheda: l\'errore dice quale; nomi simili in «Sembra già presente»', async () => {
  const me = (await db.query("SELECT id FROM users WHERE email = 'direzione@almacis.it'")).rows[0].id;
  await db.query("INSERT INTO crm_subjects (name, roles, vat, owner_id) VALUES ('Impianti Costa Srl', '{fornitore}', '01234567897', $1)", [me]);
  const { rows: [{ id }] } = await db.query("INSERT INTO crm_subjects (name, roles, owner_id) VALUES ('Impianti Costa', '{lead}', $1) RETURNING id", [me]);
  const p = await A('PATCH', `/api/crm/subjects/${id}`, { vat: '01234567897' });
  assert.equal(p.status, 409);
  assert.equal(p.body.conflict.name, 'Impianti Costa Srl');
  const chk = (await A('GET', '/api/crm/subjects/check?name=Impianticosta')).body.matches;
  assert.ok(chk.some(m => m.name === 'Impianti Costa Srl'));
});
