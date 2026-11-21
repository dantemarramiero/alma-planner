// Organigramma a incarichi (modello di BOSS): chi approva salendo di incarico in incarico, vacanti attraversati, vertice,
// doppio incarico con il principale, proprietario-HR-AD senza ciclo, esterno senza account, controlli (cicli, livelli),
// anteprima di chi cambia approvatore, chi ricopre l'incarico cambia e chi riporta lo segue, import da foglio, storia.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { writeXlsx } = require('../lib/xlsx');
const O = require('../lib/organigramma');

let server, base, db, gov;
const cookies = {};
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie')?.split(';')[0];
}
async function api(who, method, path, body, raw) {
  const res = await fetch(base + path, {
    method, headers: { cookie: cookies[who] || '', 'X-Alma': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const ADMIN = 'dante@almacis.it';
const OP = 'elisa.galli@almacis.it';

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN, ORG_EDITABLE: '1' }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query(`INSERT INTO org_people (oid, name, email, job_title, department, manager_oid) VALUES
    ('o1', 'Giorgio Ferrante', 'giorgio@almacis.it', 'Proprietario', 'Direzione', NULL),
    ('o2', 'Paola Rinaldi', 'paola@almacis.it', 'Amministratore delegato', 'Direzione', 'o1'),
    ('o3', 'Luca Bianchi', 'luca@almacis.it', 'Responsabile Reti BP/MP', 'Reti BP/MP', 'o2'),
    ('o4', 'Elisa Galli', 'elisa.galli@almacis.it', 'Geometra', 'Reti BP/MP', 'o3'),
    ('o5', 'Marco Conti', 'marco@almacis.it', 'Tecnico', 'Reti BP/MP', 'o3'),
    ('o6', 'Dante Marramiero', 'dante@almacis.it', 'CEO', 'Direzione', NULL)`);
  await gov.reload();
  for (const e of [ADMIN, OP]) await login(e);
});
after(async () => { server?.close(); await db?.close(); });

const act = (b) => api(ADMIN, 'POST', '/api/organigramma/azione', b);
const model = async () => (await api(ADMIN, 'GET', '/api/organigramma')).body;
const inc = (m, nome) => m.incarichi.find(i => i.nome === nome);
const lv = (m, nome) => m.livelli.find(l => l.nome === nome).id;
const ar = (m, nome) => m.aree.find(a => a.nome === nome).id;

test('solo gli amministratori; aree e livelli di partenza come BOSS', async () => {
  assert.equal((await api(OP, 'GET', '/api/organigramma')).status, 403);
  const m = await model();
  assert.equal(m.aree.filter(a => a.tipo === 'operativa').length, 8);
  assert.deepEqual(m.livelli.map(l => [l.nome, l.approva]), [['Direzione', true], ['Direttori', true], ['Responsabili', true], ['Capi cantiere', false]]);
  assert.ok(m.daSistemare.some(d => d.email === OP && d.motivo === 'persona_senza_riporto'));
});

test('incarichi, catena, vertice, vacante attraversato, doppio incarico, proprietario-HR senza ciclo', async () => {
  let m = await model();
  assert.equal((await act({ azione: 'creaIncarico', nome: 'Proprietario', livelloOrganigrammaId: lv(m, 'Direzione'), ricopertoDaPersonaleId: 'giorgio@almacis.it' })).status, 200);
  m = await model();
  await act({ azione: 'creaIncarico', nome: 'Amministratore delegato', livelloOrganigrammaId: lv(m, 'Direttori'), riportaAIncaricoId: inc(m, 'Proprietario').id, ricopertoDaPersonaleId: 'paola@almacis.it' });
  m = await model();
  await act({ azione: 'creaIncarico', nome: 'Responsabile HR', livelloOrganigrammaId: lv(m, 'Responsabili'), riportaAIncaricoId: inc(m, 'Amministratore delegato').id, ricopertoDaPersonaleId: 'giorgio@almacis.it' });
  await act({ azione: 'creaIncarico', nome: 'Responsabile Reti BP/MP', livelloOrganigrammaId: lv(m, 'Responsabili'), businessUnitId: ar(m, 'Reti BP/MP'), riportaAIncaricoId: inc(m, 'Amministratore delegato').id, ricopertoDaPersonaleId: 'luca@almacis.it', responsabileArea: true });
  m = await model();
  await act({ azione: 'creaIncarico', nome: 'Capo cantiere Chieti', livelloOrganigrammaId: lv(m, 'Capi cantiere'), businessUnitId: ar(m, 'Reti BP/MP'), riportaAIncaricoId: inc(m, 'Responsabile Reti BP/MP').id, ricopertoDaPersonaleId: 'marco@almacis.it' });
  m = await model();
  await act({ azione: 'cambiaRiportoPersona', email: OP, riportaAIncaricoId: inc(m, 'Capo cantiere Chieti').id });
  m = await model();
  const p = e => m.persone.find(x => x.email === e);
  assert.equal(p(OP).chiApprova.nome, 'Luca Bianchi', 'il capo cantiere non approva: si sale a Reti BP/MP');
  assert.equal(p('marco@almacis.it').chiApprova.nome, 'Luca Bianchi');
  assert.equal(p('luca@almacis.it').chiApprova.nome, 'Paola Rinaldi');
  assert.equal(p('giorgio@almacis.it').chiApprova.tipo, 'vertice', 'il proprietario ha due incarichi: principale il vertice');
  assert.equal(p('paola@almacis.it').chiApprova.nome, 'Giorgio Ferrante');
  assert.equal(inc(m, 'Proprietario').vertice, true);
  assert.equal(inc(m, 'Responsabile Reti BP/MP').nelRamo, 2);
  assert.equal(m.daSistemare.some(d => d.email === OP), false);
  // vacante: si attraversa
  await act({ azione: 'cambiaRicopertoDa', incaricoId: inc(m, 'Responsabile Reti BP/MP').id, ricopertoDaPersonaleId: null });
  m = await model();
  assert.equal(m.persone.find(x => x.email === OP).chiApprova.nome, 'Paola Rinaldi');
});

test('controlli: niente cicli, il livello stretto, un incarico non riporta a sé stesso', async () => {
  const m = await model();
  const ad = inc(m, 'Amministratore delegato');
  const reti = inc(m, 'Responsabile Reti BP/MP');
  let r = await act({ azione: 'cambiaRiportoIncarico', incaricoId: ad.id, riportaAIncaricoId: reti.id });
  assert.equal(r.status, 400);
  r = await act({ azione: 'cambiaRiportoIncarico', incaricoId: reti.id, livelloOrganigrammaId: lv(m, 'Direttori') });
  assert.equal(r.status, 400, 'Reti allo stesso livello dell\'AD');
  assert.match(r.body.error, /livello più alto/);
  r = await act({ azione: 'cambiaRiportoIncarico', incaricoId: reti.id, riportaAIncaricoId: reti.id });
  assert.equal(r.status, 400);
  r = await act({ azione: 'disattivaIncarico', incaricoId: reti.id });
  assert.equal(r.status, 400, 'ha qualcuno sotto');
});

test('anteprima: chi ricopre cambia, chi riporta lo segue; esterno senza account va al personale; storia e registro', async () => {
  let m = await model();
  const reti = inc(m, 'Responsabile Reti BP/MP');
  const pre = (await api(ADMIN, 'POST', '/api/organigramma/anteprima', { azione: 'cambiaRicopertoDa', incaricoId: reti.id, ricopertoDaPersonaleId: 'luca@almacis.it' })).body;
  assert.deepEqual(pre.errori, []);
  assert.ok(pre.cambiano.some(c => c.email === OP && /Luca Bianchi/.test(c.dopo)));
  assert.equal((await act({ azione: 'cambiaRicopertoDa', incaricoId: reti.id, ricopertoDaPersonaleId: 'luca@almacis.it', updatedAt: 'vecchio' })).status, 409);
  await act({ azione: 'cambiaRicopertoDa', incaricoId: reti.id, ricopertoDaPersonaleId: 'luca@almacis.it' });
  // esterno che approva senza account
  assert.equal((await act({ azione: 'registraEsterno', email: 'carlo@studio-marini.it', nome: 'Carlo Marini' })).status, 200);
  m = await model();
  await act({ azione: 'creaIncarico', nome: 'Consulente strategico', livelloOrganigrammaId: lv(m, 'Direttori'), riportaAIncaricoId: inc(m, 'Proprietario').id, ricopertoDaPersonaleId: 'carlo@studio-marini.it' });
  m = await model();
  await act({ azione: 'cambiaRiportoIncarico', incaricoId: inc(m, 'Responsabile Reti BP/MP').id, riportaAIncaricoId: inc(m, 'Consulente strategico').id });
  m = await model();
  const luca = m.persone.find(x => x.email === 'luca@almacis.it');
  assert.equal(luca.chiApprova.tipo, 'personale');
  assert.match(luca.chiApprova.motivo, /Carlo Marini approva ma non ha un account/);
  assert.ok(m.daSistemare.some(d => d.motivo === 'esterno_senza_account'));
  const storia = (await api(ADMIN, 'GET', '/api/organigramma/storia')).body;
  assert.ok(storia.some(s => s.azione === 'Cambiato chi ricopre l\'incarico' && s.persone_cambiate > 0));
  await new Promise(r => setTimeout(r, 100));
  const reg = (await api(ADMIN, 'GET', '/api/impostazioni/registro?tipo=modifiche')).body;
  assert.ok(reg.rows.some(r => /Organigramma: cambiati riporto e livello/.test(r.what)));
});

test('livelli: nuovo, riordino rifiutato se rompe i riporti', async () => {
  assert.equal((await api(ADMIN, 'POST', '/api/organigramma/livelli', { nome: 'Responsabili regionali', approva: true })).status, 201);
  const m = await model();
  const ids = m.livelli.map(l => l.id);
  const r = await api(ADMIN, 'POST', '/api/organigramma/livelli/ordine', { ids: [...ids].reverse() });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Così non si può/);
});

test('import da foglio: errori per riga, poi applica; proposta da Entra', async () => {
  const bad = writeXlsx({
    Incarichi: [['Incarico', 'Riporta a', 'Livello', 'Area', 'Ricoperto da', "Responsabile dell'area"], ['Responsabile QHSE', 'Amministratore delegato', 'Responsabile', 'QHSE', '', '']],
    Persone: [['Email', 'Nome', 'Riporta a', 'Incarico principale', 'Area', 'Esterno']],
  });
  let r = await api(ADMIN, 'POST', '/api/organigramma/import', null, bad);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.righeConErrori, [2]);
  assert.match(r.body.incarichi[0].problemi[0], /livello «Responsabile» non esiste/);
  assert.equal((await api(ADMIN, 'POST', '/api/organigramma/import?applica=1', null, bad)).status, 400);
  const good = writeXlsx({
    Incarichi: [['Incarico', 'Riporta a', 'Livello', 'Area', 'Ricoperto da', "Responsabile dell'area"], ['Responsabile QHSE', 'Amministratore delegato', 'Responsabili', 'QHSE', 'q.rossi@qhse.it', '']],
    Persone: [['Email', 'Nome', 'Riporta a', 'Incarico principale', 'Area', 'Esterno'], ['q.rossi@qhse.it', 'Quinto Rossi', '', '', 'QHSE', 'sì']],
  });
  r = await api(ADMIN, 'POST', '/api/organigramma/import', null, good);
  assert.deepEqual(r.body.righeConErrori, []);
  assert.equal((await api(ADMIN, 'POST', '/api/organigramma/import?applica=1', null, good)).status, 200);
  const m = await model();
  assert.equal(inc(m, 'Responsabile QHSE').ricopertoDaPersonaleId, 'q.rossi@qhse.it');
  assert.equal(m.persone.find(p => p.email === 'q.rossi@qhse.it').esterno, true);
  const prop = (await api(ADMIN, 'POST', '/api/organigramma/proposta-entra')).body;
  assert.ok(prop.incarichi.some(i => i['ricoperto da'] === 'luca@almacis.it'));
  const tpl = await fetch(`${base}/api/organigramma/modello.xlsx`, { headers: { cookie: cookies[ADMIN] } });
  assert.equal(tpl.status, 200);
});

test('puro: chi approva salta chi ricopre più incarichi nella stessa catena', () => {
  const st = {
    aree: [], livelli: [{ id: 1, nome: 'A', ordine: 1, approva: true }, { id: 2, nome: 'B', ordine: 2, approva: true }],
    incarichi: [{ id: 1, nome: 'Top', livello_id: 1, ricoperto_da: 'a@x.it', attivo: true }, { id: 2, nome: 'Mid', livello_id: 2, riporta_a_id: 1, ricoperto_da: 'b@x.it', attivo: true },
      { id: 3, nome: 'Low', livello_id: 2, riporta_a_id: 2, ricoperto_da: 'b@x.it', attivo: false }],
    entra: [{ email: 'a@x.it', name: 'A' }, { email: 'b@x.it', name: 'B' }, { email: 'c@x.it', name: 'C' }],
    persone: [{ email: 'c@x.it', riporta_a_incarico_id: 2 }], accounts: new Set(),
  };
  const m = O.build(st);
  assert.equal(O.chiApprova(m, 'c@x.it').nome, 'B');
  assert.equal(O.chiApprova(m, 'b@x.it').nome, 'A');
});
