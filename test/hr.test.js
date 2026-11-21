// Alma HR, Fase 1: griglia per tutti senza nomi né RAL; RAL e mappatura solo al team HR; import dell'export di BOSS
// (part-time a tempo pieno, esclusi); import v11 → proposte sugli incarichi; conferma dei ruoli; il mio percorso;
// pannello: controlli (minimo CCNL blocca), bozza, impatto, applica; registro degli accessi; logica pura.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const { writeXlsx } = require('../lib/xlsx');
const H = require('../lib/hr');
const { syncPeopleFromBoss } = require('../routes/hr');

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
const HRP = 'giulia.hr@almacis.it';
const ELENA = 'elena.rossi@almacis.it';

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query("INSERT INTO role_assignments (email, role_key) VALUES ($1, 'hr')", [HRP]);
  await db.query(`INSERT INTO org_incarichi (nome, area_id, ricoperto_da) VALUES
    ('Gestore di commessa', (SELECT id FROM org_aree WHERE nome = 'Impianti'), $1),
    ('Capo zona Toscana', (SELECT id FROM org_aree WHERE nome = 'Reti BP/MP'), 'paolo.neri@almacis.it'),
    ('Capo zona Puglia', (SELECT id FROM org_aree WHERE nome = 'Reti BP/MP'), NULL)`, [ELENA]);
  await gov.reload();
  for (const e of [ADMIN, HRP, ELENA]) await login(e);
});
after(async () => { server?.close(); await db?.close(); });

const bossExport = () => writeXlsx({ Personale: [
  ['Cognome', 'Nome', 'Email', 'Società', 'Settore', 'Qualifica', 'CCNL', 'Livello', 'Contratto', 'Part time', 'Data assunzione', 'Sesso', 'RAL'],
  ['Rossi', 'Elena', ELENA, 'Alma C.I.S.', 'Impianti', 'Gestore di commessa', 'Metalmeccanico', 'C3', 'Tempo indeterminato', '', '01/09/2022', 'F', 34000],
  ['Neri', 'Paolo', 'paolo.neri@almacis.it', 'Alma C.I.S.', 'Reti', 'Area Toscana', 'Metalmeccanico', 'C2', 'Tempo indeterminato', 60, '10/03/2019', 'M', 19200],
  ['Bianchi', 'Luca', 'luca.b@almacis.it', 'Alma C.I.S.', 'Reti', 'Muratore', 'Edilizia', '2', 'Tempo indeterminato', '', '', 'M', 27000],
  ['Verdi', 'Anna', 'anna.v@almacis.it', 'Alma C.I.S.', 'Staff', 'Amministrazione', 'Metalmeccanico', 'C2', 'Apprendistato', '', '', 'F', 21000],
] });

test('logica pura: leve, posizione a tempo pieno, controlli, merito, promozione', () => {
  const b = H.generateBands(H.DEFAULT_PARAMS);
  assert.equal(b.length, 8);
  assert.equal(b[0].mid, 26);
  assert.ok(b[7].mid > 85 && b[7].mid < 90);
  const g2 = H.bandOf(H.DEFAULT_BANDS, 2);
  assert.deepEqual(H.position(19200, 60, g2).ralFte, 32000);
  assert.equal(H.position(19200, 60, g2).zone, 'linea');
  assert.equal(H.position(25000, 100, g2).zone, 'sotto');
  assert.equal(H.position(25000, 100, g2).toMin, 3000);
  assert.deepEqual(H.checkBands(H.DEFAULT_BANDS).errors, []);
  const low = H.DEFAULT_BANDS.map(x => (x.grade === 1 ? { ...x, min: 20 } : x));
  assert.match(H.checkBands(low).errors[0], /minimo CCNL/);
  const flat = H.DEFAULT_BANDS.map(x => (x.grade === 3 ? { ...x, mid: 31, min: 29, max: 35 } : x));
  assert.ok(H.checkBands(flat).errors.some(e => /deve crescere/.test(e)));
  assert.equal(H.meritPct(9.5, 'ingresso'), 7);
  assert.equal(H.meritPct(6, 'alta'), 1);
  assert.equal(H.promotionRal(34000, H.bandOf(H.DEFAULT_BANDS, 3)), 36720);
  assert.equal(H.offerApprover(55000, H.bandOf(H.DEFAULT_BANDS, 4)), 'direzione');
  assert.equal(H.offerApprover(47000, H.bandOf(H.DEFAULT_BANDS, 4)), 'hr');
  assert.equal(H.offerApprover(50000, H.bandOf(H.DEFAULT_BANDS, 4)), 'bu');
});

test('la griglia la vedono tutti, senza nomi né RAL; il resto solo il team HR', async () => {
  const g = await api(ELENA, 'GET', '/api/hr/griglia');
  assert.equal(g.status, 200);
  assert.equal(g.body.bands.length, 8);
  assert.ok(g.body.bands.find(b => b.grade === 3).roles.some(r => r.title === 'Project Manager · Junior'));
  assert.ok(!JSON.stringify(g.body).includes('ral'));
  for (const p of ['/api/hr/persone', '/api/hr/mappatura', '/api/hr/pannello', '/api/hr/incarichi', '/api/hr/registro']) {
    assert.equal((await api(ELENA, 'GET', p)).status, 403, p);
    assert.equal((await api(ADMIN, 'GET', p)).status, 403, `${p} anche l'amministratore senza ruolo HR`);
  }
  assert.equal((await api(HRP, 'GET', '/api/hr/persone')).status, 200);
  const me = await api(HRP, 'GET', '/api/me');
  assert.equal(me.body.hr, true);
  assert.equal((await api(ELENA, 'GET', '/api/me')).body.hr, false);
  const m = await api(ELENA, 'GET', '/api/hr/mansionario');
  assert.ok(m.body.roles.length >= 20);
  assert.equal(m.body.roles[0].people, undefined);
});

test('import dell\'export di BOSS: anteprima, applica, part-time, esclusi', async () => {
  const pre = await api(HRP, 'POST', '/api/hr/import/persone', null, bossExport());
  assert.equal(pre.status, 200);
  assert.equal(pre.body.preview.total, 4);
  assert.equal(pre.body.preview.escluse, 2);
  assert.equal(pre.body.preview.part_time, 1);
  assert.equal((await api(HRP, 'GET', '/api/hr/persone')).body.people.length, 0, 'l\'anteprima non salva');
  const ok = await api(HRP, 'POST', '/api/hr/import/persone?applica=1', null, bossExport());
  assert.equal(ok.body.applied, true);
  const list = (await api(HRP, 'GET', '/api/hr/persone')).body.people;
  assert.equal(list.length, 4);
  assert.equal(list.find(p => p.cognome === 'Bianchi').esclusione, 'operaio');
  assert.equal(list.find(p => p.cognome === 'Verdi').esclusione, 'apprendista');
  assert.equal(list.find(p => p.cognome === 'Rossi').incarico.nome, 'Gestore di commessa');
});

test('import v11 → proposte sugli incarichi; conferma; posizione in fascia', async () => {
  const v11 = writeXlsx({ 'BU Impianti': [
    ['BU IMPIANTI'], ['Persona', 'Ruolo (organigramma)', 'Inquadramento target (Salary Grade)', 'RAL attuale'],
    ['Rossi E.', 'Gestore di commessa', 'Assistente di commessa — Senior', 34000],
    ['Neri P.', 'Area Toscana', 'Assistente di commessa — Junior', 19200],
    ['Giallo = da compilare'],
  ] });
  const pre = await api(HRP, 'POST', '/api/hr/import/v11', null, v11);
  assert.equal(pre.status, 200);
  assert.equal(pre.body.summary.trovate, 2);
  assert.equal(pre.body.rows.find(r => r.persona === 'Neri P.').ruolo, 'Capo zona reti');
  await api(HRP, 'POST', '/api/hr/import/v11?applica=1', null, v11);
  const inc = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  const elena = inc.incarichi.find(i => i.nome === 'Gestore di commessa');
  assert.equal(elena.proposed, 'Assistente di commessa · Senior');
  const puglia = inc.incarichi.find(i => i.nome === 'Capo zona Puglia');
  assert.equal(puglia.proposed, null);
  const conf = await api(HRP, 'POST', '/api/hr/incarichi/conferma', { items: inc.incarichi.filter(i => i.proposed_id).map(i => ({ incarico_id: i.id, role_id: i.proposed_id })) });
  assert.equal(conf.body.n, 2);
  const after2 = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  assert.equal(after2.done, 2);
  assert.equal(after2.incarichi.find(i => i.nome === 'Capo zona Puglia').proposed, null, 'nome diverso: nessuna proposta');
});

test('scheda retribuzione registrata; mappatura con part-time a tempo pieno', async () => {
  const list = (await api(HRP, 'GET', '/api/hr/persone')).body.people;
  const neri = list.find(p => p.cognome === 'Neri');
  assert.equal(neri.role.title, 'Capo zona reti');
  assert.equal(neri.position.ralFte, 32000);
  assert.equal(neri.position.zone, 'linea');
  const s = await api(HRP, 'GET', `/api/hr/persone/${encodeURIComponent(list.find(p => p.cognome === 'Rossi').key)}`);
  assert.equal(s.body.band.mid, 32);
  assert.equal(s.body.promotion.title, 'Project Manager · Junior');
  assert.equal(s.body.promotion.ral, 36720);
  const reg = (await api(HRP, 'GET', '/api/hr/registro')).body.log;
  assert.ok(reg.some(l => l.kind === 'accesso' && l.action === 'scheda retribuzione' && l.persona === 'Elena Rossi'));
  const map = (await api(HRP, 'GET', '/api/hr/mappatura')).body;
  assert.equal(map.stats.counted, 2);
  assert.equal(map.esclusi, 2);
});

test('il mio percorso e la presa visione', async () => {
  const p = (await api(ELENA, 'GET', '/api/hr/percorso')).body;
  assert.equal(p.role.title, 'Assistente di commessa · Senior');
  assert.equal(p.role.grade, 2);
  assert.equal(p.next.title, 'Project Manager · Junior');
  assert.equal(p.role.signed_at, null);
  await api(ELENA, 'POST', `/api/hr/mansionario/${p.role.id}/presa-visione`);
  assert.ok((await api(ELENA, 'GET', '/api/hr/percorso')).body.role.signed_at);
  const r = (await api(HRP, 'GET', `/api/hr/mansionario/${p.role.id}`)).body;
  assert.equal(r.people.find(x => x.nome === 'Elena Rossi').signed, true);
  // una modifica crea la versione dopo: la presa visione va rifatta
  await api(HRP, 'PATCH', `/api/hr/mansionario/${p.role.id}`, { next_criteria: 'Chiude da solo una C3' });
  assert.equal((await api(ELENA, 'GET', '/api/hr/percorso')).body.role.signed_at, null);
  assert.equal((await api(ELENA, 'PATCH', `/api/hr/mansionario/${p.role.id}`, { next_criteria: 'x' })).status, 403);
});

test('pannello: impatto, minimo CCNL che blocca, bozza, applica', async () => {
  const pan = (await api(HRP, 'GET', '/api/hr/pannello')).body;
  assert.equal(pan.current.label, 'Griglia 2026');
  const bands = pan.current.bands.map(b => (b.grade === 2 ? { ...b, min: 33, mid: 36, max: 40 } : b));
  const imp = (await api(HRP, 'POST', '/api/hr/pannello/impatto', { bands })).body;
  assert.equal(imp.after.below, imp.before.below + 1, 'il capo zona a 32 k scende sotto il minimo 33');
  const bad = pan.current.bands.map(b => (b.grade === 1 ? { ...b, min: 20 } : b));
  const r = await api(HRP, 'POST', '/api/hr/pannello/bozza', { bands: bad, label: 'Prova' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /minimo CCNL/);
  const d = await api(HRP, 'POST', '/api/hr/pannello/bozza', { bands, label: 'Griglia 2027' });
  assert.equal(d.status, 200);
  const ap = await api(HRP, 'POST', '/api/hr/pannello/applica', { id: d.body.id, from: 'now' });
  assert.equal(ap.status, 200);
  const g = (await api(ELENA, 'GET', '/api/hr/griglia')).body;
  assert.equal(g.label, 'Griglia 2027');
  assert.equal(g.bands.find(b => b.grade === 2).mid, 36, 'cambiata una volta, cambia per tutti');
  assert.equal((await api(HRP, 'POST', '/api/hr/pannello/applica', { id: d.body.id })).status, 400);
  // il grade di un ruolo: il vertice Field non può raggiungere il PM Senior
  const capo = pan.roles.find(x => x.title === 'Capo cantiere / Tecnico esperto');
  const bump = await api(HRP, 'PATCH', `/api/hr/mansionario/${capo.id}/grade`, { grade: 5 });
  assert.equal(bump.status, 400);
  assert.match(bump.body.error, /Field/);
});

test('sincronizzazione da BOSS via API (finta)', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ personale: [
    { id: 'b1', nome: 'Elena', cognome: 'Rossi', email: ELENA, contratto: 'TI', sesso: 'F', retribuzioni: [{ ralAnnua: 35000, validoDal: '2026-01-01' }] },
  ] }) });
  assert.equal((await syncPeopleFromBoss(db, { url: '', token: '' })).ok, false);
  const r = await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fake });
  assert.equal(r.n, 1);
  const list = (await api(HRP, 'GET', '/api/hr/persone')).body.people;
  assert.ok(list.some(p => p.source === 'boss'));
});
