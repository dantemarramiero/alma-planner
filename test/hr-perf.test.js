// Alma HR, Fase 5 (ALM2-59): valutazione 1–10 con i pesi del pannello, voti 1–5 convertiti ×2, check di luglio,
// calibrazione (motivo, piano sotto 4), matrice, revisione con ±1 punto per il responsabile, promozione, budget e
// approvazioni (CFO solo sopra budget), lettere, colloquio, il mio esito, RAL ritrovata su BOSS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const P = require('../lib/hr-perf');
const { syncPeopleFromBoss } = require('../routes/hr');
const { syncStrategyProfiles } = require('../routes/hr-org');
const { registerHrPerf } = require('../routes/hr-perf');

let server, base, db, gov;
const cookies = {};
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
  cookies[email] = res.headers.get('set-cookie')?.split(';')[0];
}
async function api(who, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie: cookies[who] || '', 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const Y = 2026;
const HRP = 'giulia.hr@almacis.it';
const DIR = 'direzione@almacis.it';
const CFO = 'cfo@almacis.it';
const RESP = 'luca.verdi@almacis.it';
const SARA = 'sara.colonna@almacis.it';
const ELENA = 'elena.rossi@almacis.it';
const ANDREA = 'andrea.galli@almacis.it';
const ADMIN = 'dante@almacis.it';

const boss = (ralSara = 33200) => ({
  personale: [
    { id: 'p1', nome: 'Luca', cognome: 'Verdi', email: RESP, contratto: 'TI', sesso: 'M', dataAssunzione: '2015-01-01', retribuzioni: [{ ralAnnua: 66000, validoDal: '2026-01-01' }] },
    { id: 'p2', nome: 'Sara', cognome: 'Colonna', email: SARA, contratto: 'TI', sesso: 'F', dataAssunzione: '2019-01-01', retribuzioni: [{ ralAnnua: ralSara, validoDal: ralSara === 33200 ? '2026-01-01' : '2027-04-01' }] },
    { id: 'p3', nome: 'Elena', cognome: 'Rossi', email: ELENA, contratto: 'TI', sesso: 'F', dataAssunzione: '2021-01-01', retribuzioni: [{ ralAnnua: 30400, validoDal: '2026-01-01' }] },
    { id: 'p4', nome: 'Andrea', cognome: 'Galli', email: ANDREA, contratto: 'TI', sesso: 'M', dataAssunzione: '2017-01-01', retribuzioni: [{ ralAnnua: 35000, validoDal: '2026-01-01' }] },
  ],
  businessUnits: [{ id: 'bu1', nome: 'Reti BP/MP', tipo: 'operativa' }],
  livelli: [],
  incarichi: [
    { id: 'i1', nome: 'Responsabile di Area Reti', businessUnitId: 'bu1', ricopertoDaPersonaleId: 'p1' },
    { id: 'i2', nome: 'Capo zona Toscana', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p2' },
    { id: 'i3', nome: 'Capo zona Lazio', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p3' },
    { id: 'i4', nome: 'Capo zona Marche', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p4' },
  ],
});
const fake = data => async () => ({ ok: true, json: async () => data });
let ids = {};

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query("INSERT INTO role_assignments (email, role_key) VALUES ($1, 'hr'), ($2, 'direzione'), ($3, 'cfo')", [HRP, DIR, CFO]);
  await gov.reload();
  for (const e of [ADMIN, HRP, DIR, CFO, RESP, SARA, ELENA, ANDREA]) await login(e);
  await api(HRP, 'GET', '/api/hr/griglia');
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fake(boss()) });
  const inc = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  const rid = t => inc.roles.find(r => r.title === t).id;
  const iid = n => inc.incarichi.find(i => i.nome === n).id;
  ids.cz = rid('Capo zona reti');
  ids.ts = rid('Tecnico di cantiere · Senior');
  await api(HRP, 'POST', '/api/hr/incarichi/conferma', { items: [{ incarico_id: iid('Responsabile di Area Reti'), role_id: rid('Responsabile di Area') },
    ...['Capo zona Toscana', 'Capo zona Lazio', 'Capo zona Marche'].map(n => ({ incarico_id: iid(n), role_id: ids.cz }))] });
  await syncStrategyProfiles(db);
  const u = async e => (await db.query('SELECT id FROM users WHERE lower(email) = $1', [e])).rows[0].id;
  for (const [k, e] of [['sara', SARA], ['elena', ELENA], ['andrea', ANDREA], ['resp', RESP]]) ids[k] = await u(e);
  // obiettivi approvati di Strategy
  for (const who of ['sara', 'elena', 'andrea']) {
    await db.query(`INSERT INTO pm_objectives (user_id, year, position, objective, weight, achievement, approved) VALUES ($1,$2,1,'Cantieri nei tempi',40,97,true),($1,$2,2,'Zero infortuni',30,100,true),($1,$2,3,'Margine di zona',30,86,true)`, [ids[who], Y]);
  }
  // un'autovalutazione di Andrea data prima, sulla scala 1–5
  await db.query(`INSERT INTO pm_reviews (user_id, year, status, self_scores, scale) VALUES ($1, $2, 'self', '{"Valori Almacis e lavoro in squadra": 4}', 5)`, [ids.andrea, Y]);
});
after(async () => { server?.close(); await db?.close(); });

test('logica pura: voto dagli obiettivi, pesi per grade, merito, una tantum sopra il massimo, budget', () => {
  assert.equal(P.objScoreFromAchievement(100), 8);
  assert.equal(P.objScoreFromAchievement(110), 10);
  assert.deepEqual(P.weightsFor(7), [70, 30]);
  assert.deepEqual(P.weightsFor(2, { pesi: { 2: 50 } }), [50, 50]);
  assert.equal(P.finalScore({ objectives: [{ weight: 40, score: 9 }, { weight: 30, score: 9 }, { weight: 30, score: 6 }], comps: [8, 9, 8, 7], grade: 2 }).final, 8.1);
  const sopra = P.proposal({ ral: 40000, band: { min: 28, mid: 32, max: 36 }, voto: 7 });
  assert.equal(sopra.tipo, 'una_tantum');
  assert.equal(sopra.nuova_ral, 40000);
  const b = P.budget([{ ral: 30000, nuova_ral: 31000, una_tantum: 0 }, { ral: 30000, nuova_ral: 30000, una_tantum: 600 }], { budgetPct: 2.5 });
  assert.equal(b.tetto, 1500);
  assert.equal(b.sopra, true);
  assert.equal(P.toTen(3.5, 5), 7);
});

test('scheda annuale: autovalutazione, voti del responsabile nascosti fino alla chiusura, voto finale con i pesi', async () => {
  const s = (await api(SARA, 'GET', `/api/hr/valutazione/${ids.sara}?year=${Y}`)).body;
  assert.equal(s.obiettivi.length, 3);
  assert.equal(s.obiettivi[0].proposto, 8, '97% → 8');
  assert.deepEqual(s.pesi, [60, 40]);
  const keys = { o: s.obiettivi.map(o => `obj:${o.id}`), c: s.competenze.map(c => c.nome) };
  assert.equal((await api(ANDREA, 'GET', `/api/hr/valutazione/${ids.sara}?year=${Y}`)).status, 403);
  assert.equal((await api(SARA, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { self: { [keys.o[0]]: 11 } })).status, 400);
  await api(SARA, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { self: Object.fromEntries([...keys.o, ...keys.c].map(k => [k, 8])) });
  assert.equal((await api(SARA, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { manager: { [keys.o[0]]: 9 } })).status, 403);
  await api(SARA, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { status: 'manager' });
  const man = Object.fromEntries([[keys.o[0], 9], [keys.o[1], 9], [keys.o[2], 6], ...keys.c.map((k, i) => [k, [8, 9, 8, 7, 8][i] ?? 8])]);
  const r = await api(RESP, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { manager: man, commento: 'Pronta per due zone', crescita: true });
  assert.equal(r.status, 200);
  assert.equal((await api(SARA, 'GET', `/api/hr/valutazione/${ids.sara}?year=${Y}`)).body.voto.manager, null, 'prima della chiusura la persona non vede i voti del responsabile');
  await api(RESP, 'PATCH', `/api/hr/valutazione/${ids.sara}?year=${Y}`, { status: 'closed' });
  const fin = (await api(SARA, 'GET', `/api/hr/valutazione/${ids.sara}?year=${Y}`)).body;
  assert.ok(fin.voto.finale >= 8 && fin.voto.finale <= 8.4, `voto finale ${fin.voto.finale}`);
  assert.equal(fin.commento, 'Pronta per due zone');
});

test('i voti 1–5 di prima si vedono ×2 e passano alla scala 1–10 al primo salvataggio', async () => {
  const a = (await api(ANDREA, 'GET', `/api/hr/valutazione/${ids.andrea}?year=${Y}`)).body;
  assert.equal(a.scala_originale, 5);
  assert.equal(a.competenze.find(c => c.nome === P.VALORI).self, 8);
  await api(ANDREA, 'PATCH', `/api/hr/valutazione/${ids.andrea}?year=${Y}`, { self: { [a.competenze[0].nome]: 6 } });
  const { rows: [r] } = await db.query('SELECT scale, self_scores FROM pm_reviews WHERE user_id = $1 AND year = $2', [ids.andrea, Y]);
  assert.equal(r.scale, 10);
  assert.equal(r.self_scores[P.VALORI], 8, 'il 4 su 5 è diventato 8');
});

test('check di luglio: lo scrive e chiude il responsabile, segnale a HR', async () => {
  const s = (await api(RESP, 'GET', `/api/hr/semestre/${ids.elena}?year=${Y}`)).body;
  const o = s.obiettivi;
  assert.equal((await api(ELENA, 'PUT', `/api/hr/semestre/${ids.elena}?year=${Y}`, { values: {} })).status, 403);
  await api(RESP, 'PUT', `/api/hr/semestre/${ids.elena}?year=${Y}`, { values: { [o[0].id]: { valore: '80%', previsione: 'rischio', voto: 4 }, [o[1].id]: { valore: '1', previsione: 'rischio', voto: 4 }, [o[2].id]: { voto: 5 } }, azioni: 'Affiancamento' });
  const before = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE kind = 'hr'")).rows[0].n;
  await api(RESP, 'POST', `/api/hr/semestre/${ids.elena}/chiudi?year=${Y}`, {});
  assert.ok((await db.query("SELECT count(*)::int AS n FROM notifications WHERE kind = 'hr'")).rows[0].n > before);
  const after2 = (await api(ELENA, 'GET', `/api/hr/semestre/${ids.elena}?year=${Y}`)).body;
  assert.equal(after2.status, 'closed');
  assert.equal(after2.voto, 4.3);
  assert.equal((await api(RESP, 'PUT', `/api/hr/semestre/${ids.elena}?year=${Y}`, { values: {} })).status, 400, 'chiuso: lo riapre HR');
});

test('calibrazione: solo valutazioni chiuse, motivo per ogni correzione, piano sotto 4, poi chiusura', async () => {
  // valutazioni chiuse anche per Elena (bassa) e Andrea
  for (const [who, voto] of [['elena', 3], ['andrea', 6]]) {
    const v = (await api(HRP, 'GET', `/api/hr/valutazione/${ids[who]}?year=${Y}`)).body;
    await db.query("UPDATE pm_reviews SET status = 'manager' WHERE user_id = $1 AND year = $2", [ids[who], Y]);
    await db.query("INSERT INTO pm_reviews (user_id, year, status) VALUES ($1, $2, 'manager') ON CONFLICT DO NOTHING", [ids[who], Y]);
    await api(RESP, 'PATCH', `/api/hr/valutazione/${ids[who]}?year=${Y}`, { manager: Object.fromEntries([...v.obiettivi.map(o => [`obj:${o.id}`, voto]), ...v.competenze.map(c => [c.nome, voto])]) });
    await api(RESP, 'PATCH', `/api/hr/valutazione/${ids[who]}?year=${Y}`, { status: 'closed' });
  }
  assert.equal((await api(ANDREA, 'GET', `/api/hr/calibrazione?year=${Y}`)).status, 403);
  const rr = (await api(RESP, 'GET', `/api/hr/calibrazione?year=${Y}`)).body;
  assert.equal(rr.is_hr, false);
  assert.equal(rr.valutatori, undefined, 'il responsabile non vede gli altri valutatori per nome');
  const c = (await api(HRP, 'GET', `/api/hr/calibrazione?year=${Y}`)).body;
  assert.equal(c.persone.length, 3);
  assert.equal(c.distribuzione.reduce((s, x) => s + x.n, 0), 3);
  assert.equal((await api(HRP, 'PUT', `/api/hr/calibrazione/${ids.sara}?year=${Y}`, { calibrato: 7.6 })).status, 400, 'serve il motivo');
  await api(HRP, 'PUT', `/api/hr/calibrazione/${ids.sara}?year=${Y}`, { calibrato: 8.0, motivo: 'margine sotto target' });
  assert.match((await api(HRP, 'POST', `/api/hr/calibrazione/chiudi?year=${Y}`, {})).body.error, /Elena/, 'voto sotto 4 senza piano');
  await api(HRP, 'PUT', `/api/hr/calibrazione/${ids.elena}?year=${Y}`, { piano: 'Affiancamento di 3 mesi' });
  assert.equal((await api(HRP, 'POST', `/api/hr/calibrazione/chiudi?year=${Y}`, {})).body.chiuse, 3);
});

test('matrice e revisione: proposta dalla matrice, ±1 per il responsabile, promozione, niente RAL al responsabile', async () => {
  const m = (await api(HRP, 'GET', `/api/hr/matrice?year=${Y}`)).body;
  assert.equal(m.celle.flat().reduce((s, x) => s + x.persone.length, 0), 3);
  assert.ok(m.costo.tetto > 0);
  assert.equal((await api(RESP, 'GET', `/api/hr/matrice?year=${Y}`)).status, 403);
  assert.equal((await api(HRP, 'POST', `/api/hr/revisione/genera?year=${Y}`, {})).body.create, 3);
  const r = (await api(RESP, 'GET', `/api/hr/revisione?year=${Y}`)).body;
  assert.equal(r.accesso, 'responsabile');
  const sara = r.righe.find(x => x.nome === 'Sara Colonna');
  assert.equal(sara.ral, undefined, 'il responsabile non vede le RAL');
  assert.equal(sara.merito_pct, 3.5);
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/${sara.id}?year=${Y}`, { tipo: 'merito', proposta_pct: 6 })).status, 403, 'oltre ±1 decide HR');
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/${sara.id}?year=${Y}`, { tipo: 'merito', proposta_pct: 4 })).status, 400, 'serve il motivo');
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/${sara.id}?year=${Y}`, { tipo: 'merito', proposta_pct: 4, motivo: 'due zone dal 2028' })).status, 200);
  const andrea = r.righe.find(x => x.nome === 'Andrea Galli');
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/${andrea.id}?year=${Y}`, { tipo: 'promozione', nuovo_role_id: ids.cz })).status, 400, 'stesso grade: no');
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/${andrea.id}?year=${Y}`, { tipo: 'promozione', nuovo_role_id: ids.ts })).status, 200);
  const h = (await api(HRP, 'GET', `/api/hr/revisione?year=${Y}`)).body;
  const s2 = h.righe.find(x => x.nome === 'Sara Colonna');
  assert.equal(s2.nuova_ral, 34530, '33.200 + 4%');
  const a2 = h.righe.find(x => x.nome === 'Andrea Galli');
  assert.ok(a2.nuova_ral >= 37800, 'promozione: +8% o il minimo del nuovo grade');
  assert.ok(a2.controlli.some(c => /criterio/.test(c.testo)), 'promozione senza il criterio segnato nella scheda');
  assert.ok(h.aree[0].speso > 0);
});

test('approvazioni dell\'area: responsabile → HR → Direzione → CFO solo sopra budget; poi lettere, colloquio, esito, BOSS', async () => {
  const area = (await api(HRP, 'GET', `/api/hr/revisione?year=${Y}`)).body.aree[0];
  assert.equal(area.sopra, true, 'con la promozione l\'area sfora il 2,5%');
  assert.equal((await api(DIR, 'POST', `/api/hr/revisione/area/${area.area_id}/direzione?year=${Y}`, {})).status, 403, 'prima il responsabile e HR');
  assert.equal((await api(RESP, 'POST', `/api/hr/revisione/area/${area.area_id}/invia?year=${Y}`, {})).body.stato, 'inviata');
  assert.equal((await api(RESP, 'PATCH', `/api/hr/revisione/1?year=${Y}`, { tipo: 'nessuno' })).status, 400, 'inviata: il responsabile non cambia più');
  await api(HRP, 'POST', `/api/hr/revisione/area/${area.area_id}/hr?year=${Y}`, {});
  const d = (await api(DIR, 'GET', `/api/hr/revisione?year=${Y}`)).body;
  assert.equal(d.accesso, 'direzione');
  assert.equal(d.aree[0].monte, undefined, 'la Direzione vede le percentuali, non il monte');
  assert.equal((await api(DIR, 'POST', `/api/hr/revisione/area/${area.area_id}/direzione?year=${Y}`, {})).body.stato, 'direzione', 'sopra budget: serve il CFO');
  assert.equal((await api(CFO, 'GET', `/api/hr/revisione?year=${Y}`)).body.aree.length, 1);
  assert.equal((await api(CFO, 'POST', `/api/hr/revisione/area/${area.area_id}/cfo?year=${Y}`, {})).body.stato, 'approvata');
  const l = (await api(RESP, 'GET', `/api/hr/revisione/lettere?year=${Y}`)).body;
  assert.equal(l.righe.length, 3);
  assert.equal(l.righe[0].nuova_ral, undefined);
  const doc = await fetch(`${base}/api/hr/revisione/lettere.docx?year=${Y}`, { headers: { cookie: cookies[HRP] } });
  assert.equal(doc.status, 200);
  assert.equal((await fetch(`${base}/api/hr/revisione/consulente.xlsx?year=${Y}`, { headers: { cookie: cookies[HRP] } })).status, 200);
  assert.equal((await api(SARA, 'GET', `/api/hr/esito/mio?year=${Y}`)).body.esito, null, 'prima del colloquio niente esito');
  const sid = l.righe.find(x => x.nome === 'Sara Colonna').id;
  await api(RESP, 'POST', `/api/hr/revisione/${sid}/colloquio?year=${Y}`, {});
  const e = (await api(SARA, 'GET', `/api/hr/esito/mio?year=${Y}`)).body;
  assert.equal(e.esito.nuova_ral, 34530);
  assert.equal(e.esito.voto, 8);
  assert.ok(e.crescita.verso, 'il grade successivo');
  assert.equal((await fetch(`${base}/api/hr/esito/mio/lettera.docx?year=${Y}`, { headers: { cookie: cookies[SARA] } })).status, 200);
  // su BOSS la nuova RAL dal 1/4: la riga diventa «registrata»
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fake(boss(34530)) });
  await db.query("UPDATE hr_cycles SET decorrenza = '2027-04-01' WHERE year = $1", [Y]);
  const l2 = (await api(HRP, 'GET', `/api/hr/revisione/lettere?year=${Y}`)).body;
  assert.ok(l2.righe.find(x => x.nome === 'Sara Colonna').boss_at, 'registrata su BOSS');
  assert.equal(typeof registerHrPerf.bossCheck, 'function');
});

test('avanzamento del ciclo e calendario: HR e Direzione; pesi dal pannello', async () => {
  const a = (await api(HRP, 'GET', `/api/hr/ciclo/avanzamento?year=${Y}`)).body;
  assert.equal(a.totali.persone, 4);
  assert.equal(a.totali.valutazione, 3);
  assert.equal(a.totali.calibrazione, 3);
  assert.equal((await api(DIR, 'GET', `/api/hr/ciclo/avanzamento?year=${Y}`)).status, 200);
  assert.equal((await api(RESP, 'GET', `/api/hr/ciclo/avanzamento?year=${Y}`)).status, 403);
  const c = (await api(HRP, 'PUT', `/api/hr/ciclo/${Y}`, { fasi: { semestre: { apre: '2026-07-01', chiude: '2026-07-20' } } })).body;
  assert.equal(c.fasi.semestre.chiude, '2026-07-20');
  assert.equal((await api(HRP, 'PUT', `/api/hr/ciclo/${Y}`, { fasi: { semestre: { apre: '2026-07-21', chiude: '2026-07-20' } } })).status, 400);
  const p = (await api(HRP, 'POST', '/api/hr/ciclo/promemoria', { year: Y, fase: 'valutazione' })).body;
  assert.ok(p.inviati >= 1);
  const v = (await api(HRP, 'GET', `/api/hr/valutazioni?year=${Y}`)).body;
  assert.equal(v.persone.length, 4);
  assert.equal((await api(RESP, 'GET', `/api/hr/valutazioni?year=${Y}`)).body.persone.length, 3);
});
