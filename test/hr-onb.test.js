// Alma HR, Fase 4 (ALM2-54): piano dai modelli, chi vede e chi spunta cosa, buddy, obiettivi, documenti letti,
// pulse e incontri, formazione con scadenze e cantiere, fine prova (responsabile + HR, Direzione da G6), modelli con
// versioni, promemoria del giorno.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const O = require('../lib/hr-onb');
const { syncPeopleFromBoss } = require('../routes/hr');
const { remindOnboarding } = require('../routes/hr-onb');

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
const ADMIN = 'dante@almacis.it';
const HRP = 'giulia.hr@almacis.it';
const QH = 'qhse@almacis.it';
const DIR = 'direzione@almacis.it';
const RESP = 'luca.verdi@almacis.it';
const NEW = 'giulio.pace@almacis.it';
const BUDDY = 'pietro.sala@almacis.it';
const OTHER = 'anna.bassi@almacis.it';
const BIG = 'eva.neri@almacis.it';

const boss = {
  personale: [
    { id: 'p1', nome: 'Luca', cognome: 'Verdi', email: RESP, contratto: 'TI', dataAssunzione: '2015-01-01' },
    { id: 'p2', nome: 'Anna', cognome: 'Bassi', email: OTHER, contratto: 'TI', dataAssunzione: '2018-01-01' },
    { id: 'p3', nome: 'Pietro', cognome: 'Sala', email: BUDDY, contratto: 'TI', dataAssunzione: '2016-01-01' },
    { id: 'p4', nome: 'Giulio', cognome: 'Pace', email: NEW, contratto: 'TI', dataAssunzione: '2026-11-02' },
    { id: 'p5', nome: 'Eva', cognome: 'Neri', email: BIG, contratto: 'TI', dataAssunzione: '2026-11-02' },
  ],
  businessUnits: [{ id: 'bu1', nome: 'Impianti', tipo: 'operativa' }],
  livelli: [],
  incarichi: [
    { id: 'i1', nome: 'Responsabile di Area Impianti', businessUnitId: 'bu1', ricopertoDaPersonaleId: 'p1' },
    { id: 'i2', nome: 'Project Manager', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p4' },
    { id: 'i3', nome: 'PM Senior', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p3' },
    { id: 'i4', nome: 'Responsabile di BU', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p5' },
  ],
};

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query("INSERT INTO role_assignments (email, role_key) VALUES ($1, 'hr'), ($2, 'qhse'), ($3, 'direzione')", [HRP, QH, DIR]);
  await gov.reload();
  for (const e of [ADMIN, HRP, QH, DIR, RESP, NEW, BUDDY, OTHER, BIG]) await login(e);
  await api(HRP, 'GET', '/api/hr/griglia');
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: async () => ({ ok: true, json: async () => boss }) });
  const inc = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  const rid = t => inc.roles.find(r => r.title === t).id;
  const iid = n => inc.incarichi.find(i => i.nome === n).id;
  await api(HRP, 'POST', '/api/hr/incarichi/conferma', { items: [{ incarico_id: iid('Project Manager'), role_id: rid('Project Manager · Intermedio') }, { incarico_id: iid('Responsabile di BU'), role_id: rid('Responsabile di BU') }] });
});
after(async () => { server?.close(); await db?.close(); });

test('logica pura: piano composto, fasi, scadenze dei corsi, cantiere, fine prova', () => {
  const role = { hr_family: 'gestione', grade: 4, autonomy: { C1: 'auto', C2: 'auto', C3: 'sup' } };
  assert.deepEqual(O.templateKeys(role, 'cantiere'), ['base', 'fam:gestione', 'sede:cantiere']);
  assert.ok(O.templateKeys({ hr_family: 'gestione', grade: 6 }, 'ufficio').includes('resp'));
  assert.equal(O.goalsFor(role)[0], 'Gestire una commessa C3 con supervisione');
  const plan = O.composePlan({ templates: [{ items: [{ giorno: 0, titolo: 'A', chi: 'hr' }] }], courses: [{ id: 9, nome: 'Generale', ore: 4, giorno: 5 }], docs: [{ titolo: 'regolamento' }], fineProvaGiorno: 181 });
  assert.deepEqual(plan.filter(t => t.tipo === 'incontro').map(t => t.giorno), [30, 60, 90]);
  assert.equal(plan.find(t => t.tipo === 'prova').giorno, 151);
  assert.equal(O.phaseOf(0), 'Giorno 1');
  assert.equal(O.expiryOf('2026-01-10', { validita_mesi: 24 }), '2028-01-10');
  assert.equal(O.certStatus({ data: '2020-01-01', scade: '2026-01-01' }, {}, '2026-11-22').stato, 'scaduto');
  assert.equal(O.certStatus({ data: '2025-01-01', scade: '2026-12-20' }, {}, '2026-11-22').stato, 'scade');
  assert.equal(O.siteStatus([{ course: { blocca_cantiere: true, nome: 'X' }, stato: 'manca' }]).ok, false);
  assert.deepEqual(O.probationChain(6), ['responsabile', 'hr', 'direzione']);
  assert.equal(O.fineProva('2026-02-01'), '2026-08-01');
});

let onbId, keyNew;
test('avvio dal team HR: piano dai modelli, responsabile dal riporto, chi vede cosa', async () => {
  const da = (await api(HRP, 'GET', '/api/hr/onboarding/da-avviare')).body.persone;
  keyNew = da.find(p => p.nome === 'Giulio').key;
  assert.equal((await api(RESP, 'POST', '/api/hr/onboarding', { person_key: keyNew })).status, 403);
  const r = await api(HRP, 'POST', '/api/hr/onboarding', { person_key: keyNew, inizio: '2026-11-02' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  onbId = r.body.id;
  assert.equal((await api(HRP, 'POST', '/api/hr/onboarding', { person_key: keyNew })).body.id, onbId, 'niente doppioni');
  const d = (await api(RESP, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(d.accesso, 'responsabile');
  assert.equal(d.onboarding.sede, 'cantiere', 'gestione commessa: cantiere');
  assert.ok(d.compiti.some(t => t.tipo === 'corso'), 'i corsi del ruolo nel piano');
  assert.ok(d.compiti.some(t => t.titolo.startsWith('Consegna dei DPI')), 'il modello della sede cantiere');
  assert.match(d.obiettivi[0].titolo, /^Gestire una commessa C[1-5] con supervisione$/);
  assert.equal(d.onboarding.fine_prova, '2027-05-02');
  assert.equal(d.prova.revisione_ral, undefined, 'la revisione la vede solo HR');
  assert.equal((await api(OTHER, 'GET', `/api/hr/onboarding/${onbId}`)).status, 403);
  const q = (await api(QH, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(q.accesso, 'qhse');
  assert.equal(q.prova, null, 'QHSE non vede la fine prova');
  assert.equal(q.obiettivi.length, 0);
  assert.equal((await api(NEW, 'GET', '/api/me')).body.onboarding, true);
  const fila = (await api(HRP, 'GET', '/api/hr/onboarding')).body.da_avviare;
  assert.ok(fila.some(p => p.nome === 'Eva' && p.ruolo === 'Responsabile di BU'), 'la fila delle persone nuove da BOSS');
  assert.ok(!fila.some(p => p.nome === 'Giulio'), 'chi ha già il piano esce dalla fila');
  assert.equal((await api(RESP, 'GET', '/api/hr/onboarding')).body.da_avviare, undefined, 'la fila la vede solo HR');
  assert.equal((await api(RESP, 'GET', '/api/me')).body.onb_team, true, 'il responsabile vede «Le mie persone in inserimento»');
  assert.equal((await api(OTHER, 'GET', '/api/me')).body.onb_team, false);
});

test('buddy, compiti per chi li fa, obiettivi', async () => {
  assert.equal((await api(OTHER, 'PATCH', `/api/hr/onboarding/${onbId}`, { buddy_email: BUDDY })).status, 403);
  assert.equal((await api(RESP, 'PATCH', `/api/hr/onboarding/${onbId}`, { buddy_email: BUDDY })).status, 200);
  const d = (await api(BUDDY, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(d.accesso, 'buddy');
  assert.equal(d.incontri[0].voto_obiettivi, undefined, 'il buddy non vede i voti');
  const tb = d.compiti.find(t => t.chi === 'buddy');
  const th = d.compiti.find(t => t.chi === 'hr');
  assert.equal((await api(BUDDY, 'PATCH', `/api/hr/onboarding/${onbId}/compiti/${tb.id}`, { fatto: true })).status, 200);
  assert.equal((await api(BUDDY, 'PATCH', `/api/hr/onboarding/${onbId}/compiti/${th.id}`, { fatto: true })).status, 403);
  assert.equal((await api(RESP, 'PATCH', `/api/hr/onboarding/${onbId}`, { fine_prova: '2027-01-01' })).status, 403, 'le date le cambia HR');
  await api(HRP, 'PATCH', `/api/hr/onboarding/${onbId}`, { inizio: '2026-11-09' });
  assert.equal((await api(HRP, 'GET', `/api/hr/onboarding/${onbId}`)).body.onboarding.fine_prova, '2027-05-09', 'la fine prova si sposta con il primo giorno');
  await api(HRP, 'PATCH', `/api/hr/onboarding/${onbId}`, { inizio: '2026-11-02' });
  await api(RESP, 'PUT', `/api/hr/onboarding/${onbId}/obiettivi`, { obiettivi: [{ titolo: 'Commessa C3 con supervisione', stato: 'meta' }, { titolo: 'SAL in autonomia' }] });
  const d2 = (await api(RESP, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(d2.obiettivi.length, 2);
  assert.equal(d2.compiti.find(t => t.tipo === 'obiettivi').fatto, true);
});

test('il nuovo assunto: la sua pagina, documenti letti (anche il mansionario), pulse con segnale a HR', async () => {
  await api(HRP, 'POST', '/api/hr/documenti', { titolo: 'Regolamento aziendale', url: 'https://intranet.example/regolamento.pdf' });
  const m = (await api(NEW, 'GET', '/api/hr/inserimento/mio')).body;
  assert.equal(m.onboarding.id, onbId);
  assert.equal(m.persone.buddy.email, BUDDY);
  assert.equal(m.documenti.length, 2);
  for (const doc of m.documenti) assert.equal((await api(NEW, 'POST', `/api/hr/onboarding/${onbId}/documenti/${encodeURIComponent(doc.key)}/letto`, { domanda: doc.key.startsWith('mans') ? 'Chi firma le varianti?' : '' })).status, 200);
  assert.equal((await api(RESP, 'POST', `/api/hr/onboarding/${onbId}/documenti/doc:1/letto`, {})).status, 403);
  const { rows: [ack] } = await db.query('SELECT count(*)::int AS n FROM hr_role_acks WHERE email = $1', [NEW]);
  assert.equal(ack.n, 1, 'la presa visione del mansionario resta anche in Fase 1');
  // il documento nuovo dopo l'avvio non era nel compito: il compito «presa visione» si chiude quando sono letti tutti
  const d = (await api(HRP, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.ok(d.documenti.every(x => x.letto));
  assert.equal((await api(RESP, 'PUT', `/api/hr/onboarding/${onbId}/pulse/30`, { q1: 4, q2: 4, q3: 4 })).status, 403);
  const before = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE kind = 'hr'")).rows[0].n;
  assert.equal((await api(NEW, 'PUT', `/api/hr/onboarding/${onbId}/pulse/30`, { q1: 2, q2: 4, q3: 5 })).status, 200);
  const after = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE kind = 'hr'")).rows[0].n;
  assert.ok(after > before, 'pulse basso: avviso a HR');
});

test('incontro dei 30 giorni: lo scrive il responsabile, voti 1–10, il pulse a confronto', async () => {
  assert.equal((await api(BUDDY, 'GET', `/api/hr/onboarding/${onbId}/incontri/30`)).status, 403);
  const g = (await api(RESP, 'GET', `/api/hr/onboarding/${onbId}/incontri/30`)).body;
  assert.equal(g.pulse.attuale.q1, 2);
  assert.equal((await api(RESP, 'PUT', `/api/hr/onboarding/${onbId}/incontri/30`, { voto_obiettivi: 11, voto_squadra: 7 })).status, 400);
  const s = await api(RESP, 'PUT', `/api/hr/onboarding/${onbId}/incontri/30`, { voto_obiettivi: 7, voto_squadra: 8, serve: 'auto per i cantieri', prossimo: 'SAL di dicembre' });
  assert.equal(s.status, 200);
  assert.ok(s.body.segnali.some(x => x.includes('strumenti')));
  const d = (await api(HRP, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(d.compiti.find(t => t.tipo === 'incontro' && t.ref === '30').fatto, true);
  const f = await api(RESP, 'POST', `/api/hr/onboarding/${onbId}/incontri/60/fissa`, { quando: '2027-01-02T09:00:00Z' });
  assert.equal(f.status, 200);
  assert.match(f.body.avviso, /Microsoft/);
});

test('formazione: attestato, scadenza calcolata, compito chiuso, cantiere, solo HR e QHSE', async () => {
  assert.equal((await api(RESP, 'GET', '/api/hr/formazione')).status, 403);
  const f = (await api(QH, 'GET', '/api/hr/formazione')).body;
  const p = f.persone.find(x => x.key === keyNew);
  assert.ok(p.corsi.length >= 3);
  assert.equal(p.cantiere.ok, false);
  const alto = f.corsi.find(c => c.nome.startsWith('Formazione specifica rischio alto'));
  const r = await api(QH, 'POST', '/api/hr/formazione/attestati', { person_key: keyNew, course_id: alto.id, data: '2026-11-10', ente: 'Ente bilaterale' });
  assert.equal(r.status, 200);
  assert.equal(r.body.scade, '2031-11-10');
  const d = (await api(HRP, 'GET', `/api/hr/onboarding/${onbId}`)).body;
  assert.equal(d.compiti.find(t => t.tipo === 'corso' && t.ref === String(alto.id)).fatto, true);
  // un corso scaduto blocca
  const gen = f.corsi.find(c => c.nome.startsWith('Formazione generale'));
  await db.query("INSERT INTO hr_certificates (person_key, course_id, data, scade) VALUES ($1, $2, '2015-01-01', '2020-01-01')", [keyNew, gen.id]);
  await api(HRP, 'PATCH', `/api/hr/formazione/corsi/${gen.id}`, { validita_mesi: 60 });
  const f2 = (await api(HRP, 'GET', '/api/hr/formazione')).body;
  assert.equal(f2.persone.find(x => x.key === keyNew).corsi.find(c => c.course_id === gen.id).stato, 'scaduto');
  assert.ok(f2.kpi.scaduti >= 1);
  assert.equal((await fetch(`${base}/api/hr/formazione.xlsx`, { headers: { cookie: cookies[HRP] } })).status, 200);
});

test('fine prova: responsabile decide, HR mette il visto; da G6 serve la Direzione', async () => {
  assert.equal((await api(RESP, 'POST', `/api/hr/onboarding/${onbId}/prova`, { decisione: 'non_superata' })).status, 400, 'serve il motivo');
  assert.equal((await api(HRP, 'POST', `/api/hr/onboarding/${onbId}/prova`, { passo: 'hr' })).status, 400, 'prima il responsabile');
  await api(RESP, 'POST', `/api/hr/onboarding/${onbId}/prova`, { decisione: 'conferma', motivo: 'autonomo su C3' });
  assert.equal((await api(RESP, 'POST', `/api/hr/onboarding/${onbId}/prova`, { passo: 'hr' })).status, 403);
  const v = await api(HRP, 'POST', `/api/hr/onboarding/${onbId}/prova`, { passo: 'hr', revisione_ral: 49000 });
  assert.equal(v.body.completa, true);
  const { rows: [o] } = await db.query('SELECT stato FROM hr_onboardings WHERE id = $1', [onbId]);
  assert.equal(o.stato, 'chiuso', 'confermata: il piano si chiude');
  // G7: Responsabile di BU
  const big = (await api(HRP, 'GET', '/api/hr/onboarding/da-avviare')).body.persone.find(p => p.nome === 'Eva');
  const id2 = (await api(HRP, 'POST', '/api/hr/onboarding', { person_key: big.key })).body.id;
  assert.equal((await api(DIR, 'GET', `/api/hr/onboarding/${id2}`)).body.accesso, 'direzione');
  await api(RESP, 'POST', `/api/hr/onboarding/${id2}/prova`, { decisione: 'conferma' });
  assert.equal((await api(HRP, 'POST', `/api/hr/onboarding/${id2}/prova`, { passo: 'hr' })).body.completa, false);
  assert.equal((await api(DIR, 'POST', `/api/hr/onboarding/${id2}/prova`, { passo: 'direzione' })).body.completa, true);
});

test('modelli con versioni e anteprima; cruscotto con l\'ambito; promemoria', async () => {
  const m = (await api(HRP, 'GET', '/api/hr/onboarding-modelli')).body;
  const base = m.modelli.find(x => x.chiave === 'base');
  assert.equal(base.version, 1);
  const r = await api(HRP, 'PUT', '/api/hr/onboarding-modelli/base', { items: [...base.items, { giorno: 3, titolo: 'Pranzo con la squadra', chi: 'responsabile' }] });
  assert.equal(r.body.version, 2);
  assert.equal((await api(RESP, 'PUT', '/api/hr/onboarding-modelli/base', { items: [] })).status, 403);
  const roleId = m.ruoli.find(x => x.title === 'Project Manager · Intermedio').id;
  const a = (await api(HRP, 'GET', `/api/hr/onboarding-modelli/anteprima?role_id=${roleId}`)).body;
  assert.ok(a.piano.some(t => t.titolo === 'Pranzo con la squadra'));
  const c = (await api(HRP, 'GET', '/api/hr/onboarding')).body;
  assert.ok(c.kpi && c.onboarding.length >= 2);
  assert.equal((await api(HRP, 'GET', '/api/hr/onboarding?ambito=funzioni')).body.onboarding.length, 0, 'Impianti è una BU');
  assert.equal((await api(RESP, 'GET', '/api/hr/onboarding')).body.kpi, undefined, 'il responsabile vede le sue persone, non i numeri');
  await api(HRP, 'PATCH', `/api/hr/onboarding/${onbId}`, { stato: 'aperto' });
  const sent = [];
  const n = await remindOnboarding(db, gov, { notify: async x => { sent.push(x); } }, '2027-01-20');
  assert.ok(n >= 1);
  assert.ok(sent.some(x => /in ritardo/.test(x.body)));
});
