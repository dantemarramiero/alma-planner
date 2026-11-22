// Alma HR, Fase 3 (ALM2-53): richiesta dall'incarico vacante, catena HR + Direzione (+ CFO per le nuove o sopra G6),
// annuncio con la fascia, candidatura dalla pagina pubblica, colloqui e scorecard, offerta con la sua catena,
// pre-boarding con la pagina del nuovo assunto, arrivo trovato dalla sincronizzazione con BOSS, cancellazione dei CV.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const R = require('../lib/hr-rec');
const { syncPeopleFromBoss } = require('../routes/hr');
const { purgeCandidates, workDaysSince, remindApprovals, sendToBoss, retryBoss } = require('../routes/hr-rec');

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
const DIR = 'direzione@almacis.it';
const LUCA = 'luca.verdi@almacis.it';
const ANNA = 'anna.bassi@almacis.it';
const MARCO = 'marco.esposito@example.com';

const boss = (extra = {}) => ({
  personale: [
    { id: 'p1', nome: 'Luca', cognome: 'Verdi', email: LUCA, contratto: 'TI', sesso: 'M', retribuzioni: [{ ralAnnua: 66000, validoDal: '2026-01-01' }] },
    { id: 'p2', nome: 'Anna', cognome: 'Bassi', email: ANNA, contratto: 'TI', sesso: 'F', retribuzioni: [{ ralAnnua: 41000, validoDal: '2026-01-01' }] },
    ...(extra.persone || []),
  ],
  businessUnits: [{ id: 'bu1', nome: 'Reti BP/MP', tipo: 'operativa' }],
  livelli: [],
  incarichi: [
    { id: 'i1', nome: 'Resp. Area Metano MP', businessUnitId: 'bu1', ricopertoDaPersonaleId: 'p1' },
    { id: 'i2', nome: 'Capo zona Toscana', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ricopertoDaPersonaleId: 'p2' },
    { id: 'i3', nome: 'Capo zona Puglia', businessUnitId: 'bu1', riportaAIncaricoId: 'i1', ...(extra.i3 || {}) },
  ],
});
const fakeBoss = data => async () => ({ ok: true, json: async () => data });
// posizione nuova creata in Alma (ALM2-63): servono ruolo del mansionario e area
const nuovaPos = async () => ({ role_id: (await db.query("SELECT id FROM pm_roles WHERE hr_name = 'Capo zona reti'")).rows[0].id, area_id: (await db.query("SELECT id FROM org_aree WHERE nome = 'Reti BP/MP'")).rows[0].id });
const pdf = Buffer.from('%PDF-1.4 capo zona reti gas metano cantiere').toString('base64');

before(async () => {
  db = await createDb({});
  const made = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db });
  gov = made.gov;
  server = made.app.listen(0);
  server.keepAliveTimeout = 60000;
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await db.query("INSERT INTO role_assignments (email, role_key) VALUES ($1, 'hr'), ($2, 'direzione')", [HRP, DIR]);
  await gov.reload();
  for (const e of [ADMIN, HRP, DIR, LUCA, ANNA]) await login(e);
  await api(HRP, 'GET', '/api/hr/griglia');
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fakeBoss(boss()) });
  const inc = (await api(HRP, 'GET', '/api/hr/incarichi')).body;
  const cz = inc.roles.find(r => r.title === 'Capo zona reti');
  await api(HRP, 'POST', '/api/hr/incarichi/conferma', { items: inc.incarichi.filter(i => i.nome.startsWith('Capo zona')).map(i => ({ incarico_id: i.id, role_id: cz.id })) });
});
after(async () => { server?.close(); await db?.close(); });

test('logica pura: catene, slug, controlli dell\'annuncio, scadenze', () => {
  assert.deepEqual(R.reqChain({ tipo: 'sostituzione', nel_piano: true, grade: 4 }), ['hr', 'direzione']);
  assert.deepEqual(R.reqChain({ tipo: 'nuova', nel_piano: true, grade: 3 }), ['hr', 'direzione', 'cfo']);
  assert.deepEqual(R.reqChain({ tipo: 'sostituzione', nel_piano: true, grade: 7 }), ['hr', 'direzione', 'cfo']);
  const band = { min: 42, mid: 48, max: 54 };
  assert.deepEqual(R.offerChain(46000, band).chain, ['hr']);
  assert.deepEqual(R.offerChain(50000, band).chain, ['hr', 'bu']);
  assert.equal(R.offerChain(58000, band).fuori, true);
  assert.match(R.slugify('Capo zona · Puglia', 7), /^capo-zona-puglia-7$/);
  assert.equal(R.scadenza('2026-12-01', -7), '2026-11-24');
  assert.equal(workDaysSince('2026-11-20T10:00:00Z', new Date('2026-11-24T11:00:00Z')), 2, 'venerdì → martedì: lunedì e martedì');
});

let reqId, appId, offerId, preId, token;
test('richiesta dal vacante: la apre il responsabile, non un estraneo; catena HR + Direzione', async () => {
  const list = (await api(LUCA, 'GET', '/api/hr/richieste')).body;
  const vac = list.vacanti.find(v => v.nome === 'Capo zona Puglia');
  assert.ok(vac, 'Luca vede il vacante sotto il suo incarico');
  assert.equal((await api(ANNA, 'GET', '/api/hr/richieste')).body.vacanti.length, 0);
  assert.equal((await api(ANNA, 'POST', '/api/hr/richieste', { incarico_id: vac.id })).status, 403);
  const r = await api(LUCA, 'POST', '/api/hr/richieste', { incarico_id: vac.id, motivo: 'Sostituzione per pensionamento', da_quando: 'febbraio', sede: 'Bari' });
  assert.equal(r.status, 200);
  reqId = r.body.id;
  assert.equal((await api(LUCA, 'POST', `/api/hr/richieste/${reqId}/invia`)).status, 200);
  let d = (await api(LUCA, 'GET', `/api/hr/richieste/${reqId}`)).body;
  assert.deepEqual(d.catena.map(s => s.ruolo), ['hr', 'direzione']);
  assert.equal(d.passo.tocca_a_me, false);
  assert.equal((await api(DIR, 'POST', `/api/hr/richieste/${reqId}/decidi`, { decisione: 'ok' })).status, 403, 'prima tocca a HR');
  assert.equal((await api(HRP, 'POST', `/api/hr/richieste/${reqId}/decidi`, { decisione: 'no' })).status, 400, 'il no vuole il motivo');
  assert.equal((await api(HRP, 'POST', `/api/hr/richieste/${reqId}/decidi`, { decisione: 'ok' })).body.stato, 'approvazione');
  assert.equal((await api(DIR, 'POST', `/api/hr/richieste/${reqId}/decidi`, { decisione: 'ok' })).body.stato, 'approvata');
  assert.equal((await api(DIR, 'GET', `/api/hr/richieste/${reqId}`)).status, 200, 'chi ha approvato continua a vederla');
  assert.ok((await api(DIR, 'GET', '/api/hr/richieste')).body.richieste.some(x => x.id === reqId));
  d = (await api(HRP, 'GET', `/api/hr/richieste/${reqId}`)).body;
  assert.ok(d.annuncio, 'nasce la bozza dell\'annuncio');
  assert.ok(d.annuncio.ral_min > 0 && d.annuncio.ral_max > d.annuncio.ral_min);
  const { rows: n } = await db.query("SELECT count(*)::int AS n FROM notifications WHERE kind = 'hr'");
  assert.ok(n[0].n >= 2);
});

test('richiesta di posizione nuova: serve anche il CFO (un amministratore se nessuno ha il ruolo)', async () => {
  const r = await api(HRP, 'POST', '/api/hr/richieste', { posizione: 'Ufficio gare · nuova', tipo: 'nuova', ...(await nuovaPos()) });
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/invia`);
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'ok' });
  await api(DIR, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'modifica', commento: 'Dimmi il budget' });
  let d = (await api(HRP, 'GET', `/api/hr/richieste/${r.body.id}`)).body;
  assert.equal(d.richiesta.stato, 'modifica');
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/invia`);
  d = (await api(HRP, 'GET', `/api/hr/richieste/${r.body.id}`)).body;
  assert.equal(d.catena[0].decisione, 'ok', 'l\'ok di HR resta');
  await api(DIR, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'ok' });
  assert.equal((await api(ADMIN, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'ok' })).body.stato, 'approvata');
});

test('annuncio pubblicato e candidatura dalla pagina pubblica', async () => {
  assert.equal((await api(HRP, 'POST', `/api/hr/richieste/${reqId}/annuncio/pubblica`, {})).status, 400, 'senza criteri di crescita non si pubblica');
  const put = await api(HRP, 'PUT', `/api/hr/richieste/${reqId}/annuncio`, { testo: { crescita: 'Dopo 2 anni con cantieri C3 in autonomia: capo zona senior.' } });
  assert.equal(put.body.controlli.every(c => c.ok), true);
  const pub = await api(HRP, 'POST', `/api/hr/richieste/${reqId}/annuncio/pubblica`, {});
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const slug = pub.body.url.split('/').pop();
  const page = await fetch(`${base}/lavora-con-noi/${slug}`);
  const html = await page.text();
  assert.match(html, /RAL/);
  assert.doesNotMatch(html, /<script>/, 'niente script in linea (CSP)');
  assert.match(await (await fetch(`${base}/lavora-con-noi`)).text(), new RegExp(slug));
  const post = body => fetch(`${base}/lavora-con-noi/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ nome: 'Marco', cognome: 'Esposito', email: MARCO, cv: { nome: 'cv.pdf', mime: 'application/pdf', base64: pdf } })).status, 400, 'senza consenso no');
  const ok = await post({ nome: 'Marco', cognome: 'Esposito', email: MARCO, sesso: 'M', consenso: true, conserva: true, cv: { nome: 'cv.pdf', mime: 'application/pdf', base64: pdf } });
  assert.equal(ok.status, 200);
  const d = (await api(HRP, 'GET', `/api/hr/richieste/${reqId}`)).body;
  assert.equal(d.candidature.length, 1);
  appId = d.candidature[0].id;
  const { rows: [c] } = await db.query('SELECT conservare_fino FROM hr_candidates WHERE email = $1', [MARCO]);
  assert.ok(c.conservare_fino, 'conservato 24 mesi');
});

test('colloquio: l\'intervistatore vede solo il suo candidato e vota; i voti degli altri dopo', async () => {
  assert.equal((await api(ANNA, 'GET', `/api/hr/candidature/${appId}`)).status, 403);
  const c = await api(HRP, 'POST', `/api/hr/candidature/${appId}/colloqui`, { tipo: 'tecnico', interviewer_email: ANNA, quando: '2026-12-02T10:00:00+01:00' });
  assert.equal(c.status, 200);
  const s = (await api(ANNA, 'GET', `/api/hr/candidature/${appId}`)).body;
  assert.equal(s.accesso, 'intervistatore');
  assert.equal(s.candidato.email, undefined, 'l\'intervistatore non vede i contatti');
  assert.equal(s.band, null, 'né la fascia');
  const voce = s.scorecard.voci[0];
  assert.equal((await api(ANNA, 'PUT', `/api/hr/candidature/${appId}/voti`, { voti: [{ competenza: voce, voto: 4 }] })).status, 200);
  assert.equal((await api(LUCA, 'PUT', `/api/hr/candidature/${appId}/voti`, { voti: [{ competenza: voce, voto: 4 }] })).status, 403);
  const { rows } = await db.query("SELECT count(*)::int AS n FROM hr_log WHERE action = 'scheda candidato'");
  assert.ok(rows[0].n >= 1, 'le aperture di chi non è HR finiscono nel registro');
});

test('offerta sopra il riferimento: la approva il responsabile; lettera e pre-boarding', async () => {
  const { rows: [b] } = await db.query("SELECT ral_min, ral_max FROM hr_postings WHERE req_id = $1", [reqId]);
  const ral = Math.round((b.ral_max - 1000) / 100) * 100;
  const o = await api(HRP, 'POST', `/api/hr/candidature/${appId}/offerta`, { ral, ingresso: '2026-12-15' });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  offerId = o.body.id;
  assert.deepEqual(o.body.catena, ['Team HR', 'Responsabile di BU']);
  assert.equal(o.body.equita.n, 1);
  assert.equal((await api(HRP, 'POST', `/api/hr/offerte/${offerId}/invia`)).body.stato, 'approvazione');
  const asLuca = (await api(LUCA, 'GET', `/api/hr/candidature/${appId}`)).body;
  assert.equal(asLuca.offerta.ral, ral, 'chi approva vede la RAL');
  assert.equal((await api(ANNA, 'POST', `/api/hr/offerte/${offerId}/decidi`, { decisione: 'ok' })).status, 403);
  const asAnna = (await api(ANNA, 'GET', `/api/hr/candidature/${appId}`)).body;
  assert.equal(asAnna.offerta.ral, undefined, 'l\'intervistatore non vede la RAL');
  assert.equal((await api(LUCA, 'POST', `/api/hr/offerte/${offerId}/decidi`, { decisione: 'ok' })).body.stato, 'approvata');
  const doc = await fetch(`${base}/api/hr/offerte/${offerId}/lettera.docx`, { headers: { cookie: cookies[HRP] } });
  assert.equal(doc.status, 200);
  assert.equal((await doc.arrayBuffer()).byteLength > 500, true);
  const e = await api(HRP, 'POST', `/api/hr/offerte/${offerId}/esito`, { esito: 'accettata' });
  preId = e.body.preboarding_id;
  assert.ok(preId);
  const d = (await api(HRP, 'GET', `/api/hr/richieste/${reqId}`)).body;
  assert.equal(d.richiesta.stato, 'coperta');
});

test('pre-boarding: compiti con le scadenze, pagina del nuovo assunto, arrivo da BOSS', async () => {
  const p = (await api(HRP, 'GET', `/api/hr/preboarding/${preId}`)).body;
  assert.equal(p.compiti.length, R.PRE_TASKS.length);
  assert.equal(p.boss.email, MARCO);
  token = p.link_candidato.split('/').pop();
  const page = await fetch(`${base}/benvenuto/${token}`);
  assert.equal(page.status, 200);
  const up = await fetch(`${base}/benvenuto/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    documenti: [1, 2, 3].map(i => ({ nome: `doc${i}.pdf`, mime: 'application/pdf', base64: pdf })), taglie: { scarpe: '43' } }) });
  assert.equal(up.status, 200);
  let q = (await api(HRP, 'GET', `/api/hr/preboarding/${preId}`)).body;
  assert.equal(q.compiti.find(t => t.chi === 'candidato').fatto, true);
  assert.equal((await api(ANNA, 'GET', `/api/hr/preboarding/${preId}`)).status, 403);
  // la persona creata su BOSS e messa sull'incarico: Alma la trova da sola
  // su BOSS la persona ha l'email aziendale, non quella della candidatura: Alma la riconosce per nome e cognome
  await syncPeopleFromBoss(db, { url: 'http://boss', token: 't', fetchImpl: fakeBoss(boss({ persone: [{ id: 'p9', nome: 'Marco', cognome: 'Esposito', email: 'marco.esposito@almacis.it', contratto: 'TI' }], i3: { ricopertoDaPersonaleId: 'p9' } })) });
  q = (await api(HRP, 'GET', `/api/hr/preboarding/${preId}`)).body;
  assert.equal(q.preboarding.stato, 'arrivato');
  const { rows: [onb] } = await db.query("SELECT inizio::text AS inizio, fine_prova::text AS fine, prova_fonte FROM hr_onboardings WHERE email = $1 AND stato = 'aperto'", ['marco.esposito@almacis.it']);
  assert.ok(onb, "Fase 4: parte l'inserimento");
  assert.equal(onb.inizio, '2026-12-15');
  assert.equal(onb.prova_fonte, 'offerta');
  assert.equal((await fetch(`${base}/benvenuto/${token}`)).status, 404, 'il link non serve più');
});

test('la fascia pubblica segue la griglia in vigore; cancellazione su richiesta del candidato', async () => {
  const r = await api(HRP, 'POST', '/api/hr/richieste', { posizione: 'Altra · Capo zona', tipo: 'sostituzione', ...(await nuovaPos()) });
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/invia`);
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'ok' });
  await api(DIR, 'POST', `/api/hr/richieste/${r.body.id}/decidi`, { decisione: 'ok' });
  await api(HRP, 'PUT', `/api/hr/richieste/${r.body.id}/annuncio`, { testo: { crescita: 'Capo zona senior dopo 2 anni.' } });
  const slug = (await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/annuncio/pubblica`, {})).body.url.split('/').pop();
  await db.query('UPDATE hr_postings SET ral_min = 1, ral_max = 2 WHERE slug = $1', [slug]); // una fascia vecchia salvata
  const html = await (await fetch(`${base}/lavora-con-noi/${slug}`)).text();
  assert.doesNotMatch(html, /RAL 1 – 2/, 'la pagina legge la griglia in vigore, non la cifra salvata');
  const c = await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/candidati`, { nome: 'Chiede', cognome: 'Cancellazione', email: 'chiede@example.com' });
  assert.equal((await api(LUCA, 'DELETE', `/api/hr/candidature/${c.body.app_id}/candidato`)).status, 403);
  assert.equal((await api(HRP, 'DELETE', `/api/hr/candidature/${c.body.app_id}/candidato`)).status, 200);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_candidates WHERE email = 'chiede@example.com'")).rows[0].n, 0);
  assert.equal((await api(HRP, 'DELETE', `/api/hr/candidature/${appId}/candidato`)).status, 400, 'l\'assunto non si cancella');
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/chiudi`);
});

test('sollecito: un passo fermo da 2 giorni lavorativi riceve il promemoria', async () => {
  const r = await api(HRP, 'POST', '/api/hr/richieste', { posizione: 'Ferma', tipo: 'sostituzione', ...(await nuovaPos()) });
  await api(HRP, 'POST', `/api/hr/richieste/${r.body.id}/invia`);
  await db.query("UPDATE hr_requisitions SET created_at = now() - interval '6 days' WHERE id = $1", [r.body.id]);
  const sent = [];
  const n = await remindApprovals(db, gov, { notify: async x => { sent.push(x); } });
  assert.ok(n >= 1);
  assert.match(sent.find(x => x.body.includes('Ferma')).body, /promemoria/);
});

test('numeri con l\'ambito e cancellazione dei CV', async () => {
  const n = (await api(HRP, 'GET', '/api/hr/recruitment/numeri')).body;
  assert.equal(n.funnel[0][1], 1);
  assert.equal(n.funnel[4][1], 1);
  assert.equal((await api(LUCA, 'GET', '/api/hr/recruitment/numeri')).status, 403);
  const f = (await api(HRP, 'GET', '/api/hr/recruitment/numeri?ambito=funzioni')).body;
  assert.equal(f.funnel[0][1], 0, 'la BU operativa non è tra le funzioni');
  // un candidato senza consenso a conservare, su una posizione chiusa da più di 30 giorni: si cancella
  const { rows: [r] } = await db.query("INSERT INTO hr_requisitions (posizione, stato, closed_at) VALUES ('Vecchia', 'chiusa', now() - interval '40 days') RETURNING id");
  const { rows: [c] } = await db.query("INSERT INTO hr_candidates (nome, consenso) VALUES ('Vecchio', true) RETURNING id");
  await db.query("INSERT INTO hr_applications (candidate_id, req_id) VALUES ($1, $2)", [c.id, r.id]);
  assert.equal(await purgeCandidates(db), 1);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM hr_candidates WHERE email = $1', [MARCO]);
  assert.equal(rows[0].n, 1, 'l\'assunto resta');
});

// ── ALM2-63: posizione creata in Alma, candidati per ruolo e BU, «Aggiungi con CV», persona a BOSS via API ──
let molise;
test('posizione nuova creata in Alma: il responsabile dell\'area la apre, chi non guida nessuno no', async () => {
  const pos = await nuovaPos();
  const no = await api(ANNA, 'POST', '/api/hr/richieste', { posizione: 'Capo zona Molise', ...pos });
  assert.equal(no.status, 403, 'chi non ha nessuno che gli riporta non apre posizioni nuove');
  assert.equal((await api(LUCA, 'POST', '/api/hr/richieste', { posizione: 'Senza ruolo', area_id: pos.area_id })).status, 400, 'servono ruolo e area');
  const r = await api(LUCA, 'POST', '/api/hr/richieste', { posizione: 'Capo zona Molise', motivo: 'nuova zona', ...pos });
  assert.equal(r.status, 200);
  const { rows: [q] } = await db.query('SELECT incarico_id, tipo, riporta_a FROM hr_requisitions WHERE id = $1', [r.body.id]);
  assert.equal(q.incarico_id, null, 'nessun incarico: la posizione resta in Alma');
  assert.equal(q.tipo, 'nuova');
  assert.equal(q.riporta_a, LUCA);
  assert.equal((await api(LUCA, 'GET', '/api/hr/richieste')).body.puo_creare_posizione, true);
  assert.equal((await api(ANNA, 'GET', '/api/hr/richieste')).body.puo_creare_posizione, false);
  molise = r.body.id;
});

test('candidati solo in posizioni aperte e approvate; vista per ruolo e per BU', async () => {
  const add = who => api(who, 'POST', `/api/hr/richieste/${molise}/candidati`, { nome: 'Fabio', cognome: 'Lorenzi', email: 'fabio.lorenzi@example.com' });
  assert.equal((await add(LUCA)).status, 400, 'non ancora approvata: il budget è della posizione approvata');
  await api(LUCA, 'POST', `/api/hr/richieste/${molise}/invia`);
  await api(HRP, 'POST', `/api/hr/richieste/${molise}/decidi`, { decisione: 'ok' });
  await api(DIR, 'POST', `/api/hr/richieste/${molise}/decidi`, { decisione: 'ok' });
  await api(ADMIN, 'POST', `/api/hr/richieste/${molise}/decidi`, { decisione: 'ok' }); // CFO: posizione nuova
  assert.equal((await db.query('SELECT stato FROM hr_requisitions WHERE id = $1', [molise])).rows[0].stato, 'approvata');
  assert.equal((await add(ANNA)).status, 403);
  const ok = await add(LUCA);
  assert.equal(ok.status, 200, 'il responsabile aggiunge nella sua posizione');
  const lucaId = (await db.query('SELECT id FROM users WHERE email = $1', [LUCA])).rows[0].id;
  assert.equal((await db.query('SELECT added_by FROM hr_applications WHERE id = $1', [ok.body.app_id])).rows[0].added_by, lucaId);
  assert.equal((await api(LUCA, 'GET', `/api/hr/candidature/${ok.body.app_id}`)).status, 200, 'vede il candidato che ha caricato');
  const perRuolo = (await api(HRP, 'GET', '/api/hr/candidati')).body;
  const g = perRuolo.gruppi.find(x => x.candidati.some(c => c.id === ok.body.app_id));
  assert.match(g.nome, /G\d/, 'raggruppato per ruolo e grade');
  assert.ok(g.candidati.find(c => c.id === ok.body.app_id).caricato_da);
  const perBu = (await api(HRP, 'GET', '/api/hr/candidati?per=bu')).body;
  assert.ok(perBu.gruppi.some(x => x.nome === 'Reti BP/MP'));
  assert.ok(perBu.numeri.in_selezione >= 1 && perBu.posizioni.some(p => p.id === molise));
  assert.ok((await api(LUCA, 'GET', '/api/hr/candidati')).body.posizioni.some(p => p.id === molise), 'il responsabile vede le sue posizioni');
  assert.equal((await api(ANNA, 'GET', '/api/hr/candidati')).body.numeri.in_selezione, 0, 'chi non ha posizioni non vede candidati');
});

test('«Aggiungi con CV»: senza AI legge nome, email e telefono e propone le posizioni aperte', async () => {
  const cv = Buffer.from('Curriculum Vitae\nMARTA FERRI\nmarta.ferri@example.com · +39 333 123 4567\nCapo zona reti gas metano, preposto, cantiere').toString('base64');
  const r = await api(LUCA, 'POST', '/api/hr/candidati/leggi-cv', { cv: { nome: 'cv.txt', mime: 'text/plain', base64: cv } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai, false);
  assert.equal(r.body.nome, 'Marta');
  assert.equal(r.body.cognome, 'Ferri');
  assert.equal(r.body.email, 'marta.ferri@example.com');
  assert.ok(r.body.proposte.some(p => p.req_id === molise), 'solo posizioni aperte e approvate che può vedere');
  assert.equal((await api(ANNA, 'POST', '/api/hr/candidati/leggi-cv', { cv: { nome: 'cv.txt', mime: 'text/plain', base64: cv } })).status, 400, 'nessuna posizione aperta per lei');
});

test('persona assunta a BOSS via API: solo la persona, errore e nuovo tentativo, poi inviata', async () => {
  await db.query("UPDATE hr_preboarding SET boss_stato = 'da_inviare', boss_tentativi = 0, boss_id = NULL, stato = 'aperto' WHERE id = $1", [preId]); // si riprova solo prima dell'arrivo
  await db.query("UPDATE hr_pre_tasks SET fatto = false WHERE pre_id = $1 AND chi = 'boss'", [preId]);
  assert.equal((await sendToBoss(db, preId, { url: '', token: '' })).stato, 'non_collegato', 'senza URL di BOSS resta «Copia i dati»');
  const avvisi = [];
  const ko = await sendToBoss(db, preId, { url: 'http://boss/personale', token: 't', fetchImpl: async () => ({ ok: false, status: 503, text: async () => '{}' }), notifyHr: async b => avvisi.push(b) });
  assert.equal(ko.stato, 'errore');
  assert.equal(avvisi.length, 1, 'HR avvisato al primo errore');
  let sent = null;
  const fetchOk = async (url, o) => { sent = { url, headers: o.headers, body: JSON.parse(o.body) }; return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'P-0412' }) }; };
  assert.equal(await retryBoss(db, { url: 'http://boss/personale', token: 't', fetchImpl: fetchOk }), 1);
  assert.equal(sent.body.riferimentoAlma, `alma-preboarding-${preId}`);
  assert.equal(sent.headers['Idempotency-Key'], sent.body.riferimentoAlma);
  assert.equal(sent.body.cognome, 'Esposito');
  assert.ok(sent.body.dataAssunzione && sent.body.ralAnnua > 0);
  assert.equal('posizione' in sent.body, false, 'la posizione resta in Alma');
  const { rows: [p] } = await db.query('SELECT boss_stato, boss_id, boss_tentativi FROM hr_preboarding WHERE id = $1', [preId]);
  assert.deepEqual([p.boss_stato, p.boss_id, p.boss_tentativi], ['inviata', 'P-0412', 2]);
  assert.equal((await db.query("SELECT fatto FROM hr_pre_tasks WHERE pre_id = $1 AND chi = 'boss'", [preId])).rows[0].fatto, true);
  sent = null;
  assert.equal((await sendToBoss(db, preId, { url: 'http://boss/personale', token: 't', fetchImpl: fetchOk })).stato, 'inviata');
  assert.equal(sent, null, 'già inviata: nessun doppione');
  await db.query("UPDATE hr_preboarding SET stato = 'arrivato' WHERE id = $1", [preId]);
  const v = (await api(HRP, 'GET', `/api/hr/preboarding/${preId}`)).body;
  assert.equal(v.boss.stato, 'inviata');
  assert.equal(v.boss.boss_id, 'P-0412');
});
