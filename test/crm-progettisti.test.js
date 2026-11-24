// Progettisti da ANAC (ALM2-70): incarichi di architettura e ingegneria dai file del mese, CUP che li lega ai lavori,
// classifica, scheda, progettisti di un ente, «Chi l'ha progettata» in un segnale, progettista nel CRM.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const P = require('../lib/crm-progettisti');

let server, base, db, D;
const ADMIN = 'direzione@almacis.it';
const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const csv = rows => rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
function zip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18); h.writeUInt32LE(Buffer.byteLength(text), 22); h.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([h, Buffer.from(name), data, Buffer.alloc(22)]);
}
const SA = '80000000003'; // Provincia di Chieti
const FILES = {
  aggiudicazioni: csv([['cig', 'data_aggiudicazione_definitiva', 'esito', 'criterio_aggiudicazione', 'data_comunicazione_esito', 'importo_aggiudicazione', 'ribasso_aggiudicazione', 'num_imprese_offerenti', 'flag_subappalto'],
    ['DDDDDDDDD1', day(40), 'AGGIUDICATA', 'OEPV', '', '120000', '30', '5', 'false'],
    ['DDDDDDDDD2', day(30), 'AGGIUDICATA', 'OEPV', '', '340000', '25', '4', 'false'],
    ['DDDDDDDDD3', day(20), 'AGGIUDICATA', 'PREZZO', '', '60000', '35', '3', 'false'],
    ['DDDDDDDDD4', day(20), 'AGGIUDICATA', 'PREZZO', '', '9000', '0', '1', 'false'], // sotto il minimo
    ['LLLLLLLLL1', day(10), 'AGGIUDICATA', 'PREZZO', '', '3200000', '20', '9', 'false']]), // lavori: non è un incarico
  'categorie-opera': csv([['cig', 'id_categoria', 'cod_tipo_categoria'], ['LLLLLLLLL1', 'OG 1', 'P']]),
  cig: csv([['cig', 'oggetto_lotto', 'importo_lotto', 'oggetto_principale_contratto', 'provincia', 'data_pubblicazione', 'cf_amministrazione_appaltante', 'denominazione_amministrazione_appaltante', 'sezione_regionale', 'cod_cpv', 'flag_pnrr_pnc'],
    ['DDDDDDDDD1', 'Progettazione adeguamento sismico scuola media Vasto', '150000', 'SERVIZI', 'CHIETI', day(90), SA, 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '71322000', '1'],
    ['DDDDDDDDD2', 'Progettazione nuovo blocco operatorio Lanciano', '400000', 'SERVIZI', 'CHIETI', day(80), SA, 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '71240000', '0'],
    ['DDDDDDDDD3', 'Direzione lavori strada provinciale', '70000', 'SERVIZI', 'CHIETI', day(60), SA, 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '71520000', '0'],
    ['DDDDDDDDD4', 'Piccolo rilievo', '9000', 'SERVIZI', 'CHIETI', day(60), SA, 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '71250000', '0'],
    ['LLLLLLLLL1', 'Lavori scuola media Vasto', '3500000', 'LAVORI', 'CHIETI', day(50), SA, 'PROVINCIA DI CHIETI', 'SEZIONE REGIONALE ABRUZZO', '45214200', '0']]),
  aggiudicatari: csv([['cig', 'ruolo', 'codice_fiscale', 'denominazione'],
    ['DDDDDDDDD1', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '01111111111', 'STUDIO INGEGNERIA ALFA'],
    ['DDDDDDDDD2', 'MANDATARIA', '01111111111', 'STUDIO INGEGNERIA ALFA S.R.L.'],
    ['DDDDDDDDD2', 'MANDANTE', 'RSSMRA70A01A345B', 'ROSSI MARIO'],
    ['DDDDDDDDD3', 'OPERATORE ECONOMICO MONOSOGGETTIVO', 'RSSMRA70A01A345B', 'ROSSI MARIO'],
    ['LLLLLLLLL1', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '05555555555', 'IMPRESA BETA SRL']]),
  cup: csv([['cig', 'cup'], ['DDDDDDDDD1', 'J11B22000000001'], ['DDDDDDDDD2', 'J11B22000000002'], ['LLLLLLLLL1', 'J11B22000000001']]),
};
const thisMonth = new Date().toISOString().slice(0, 7).replace('-', '');
async function fakeAnac(url) {
  if (url.includes('package_show')) return { ok: true, json: async () => ({ result: { resources: [{ name: `${thisMonth}01-aggiudicazioni_csv` }] } }) };
  const ds = url.match(/dataset\/([^/]+)\//)[1];
  if (!FILES[ds]) return { ok: false, status: 404 };
  return { ok: true, body: require('stream').Readable.from([zip(`${ds}.csv`, FILES[ds])]) };
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

before(async () => {
  db = await createDb({});
  const out = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, crmFetchEvents: async () => [], anacFetch: fakeAnac });
  server = out.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  D = as(await login(ADMIN));
});
after(async () => { server?.close(); await db?.close(); });

test('tipo d\'incarico dal CPV', () => {
  assert.equal(P.typeOf('71520000'), 'direzione lavori');
  assert.equal(P.typeOf('71322000'), 'progettazione');
  assert.equal(P.typeOf('71356000'), 'servizi tecnici');
});

test('caricamento: solo incarichi tecnici sopra il minimo, CUP collegato, lavori fuori', async () => {
  const settings = { concorrenza: { months: 24 }, profiles: {} };
  const r = await P.syncProgettisti(db, settings, { fetchImpl: fakeAnac, history: false, log: () => {} });
  assert.deepEqual(r.find(x => x.month), { month: thisMonth, kept: 3 });
  const { rows } = await db.query('SELECT cig, cup FROM crm_anac_design ORDER BY cig');
  assert.deepEqual(rows.map(x => x.cig), ['DDDDDDDDD1', 'DDDDDDDDD2', 'DDDDDDDDD3']);
  assert.equal(rows[0].cup, 'J11B22000000001');
  // i lavori della stessa opera stanno in Concorrenza (crm_anac_awards), con lo stesso CUP
  await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_cf, sa_name, region, category, cpv, amount, awarded_on, winners, month, cup)
    VALUES ('LLLLLLLLL1', 'Lavori scuola media Vasto', $1, 'PROVINCIA DI CHIETI', 'Abruzzo', 'OG1', '45214200', 3200000, $2, '[{"cf":"05555555555","name":"IMPRESA BETA SRL","role":""}]', $3, 'J11B22000000001')`, [SA, day(10), thisMonth]);
  // il secondo giro non rilegge il mese
  const again = await P.syncProgettisti(db, settings, { fetchImpl: fakeAnac, history: false, log: () => {} });
  assert.equal(again.filter(x => x.month).length, 0);
});

test('classifica: RTP contato per tutti, enti, imprese che vincono i lavori', async () => {
  const o = await P.overview(db, { regions: ['Abruzzo'] });
  assert.equal(o.kpi.progettisti, 2);
  assert.equal(o.kpi.incarichi, 3);
  assert.equal(o.kpi.in_gara, 1);
  const [alfa, rossi] = o.progettisti;
  assert.equal(alfa.cf, '01111111111');
  assert.equal(alfa.name, 'STUDIO INGEGNERIA ALFA S.R.L.'); // il nome più completo
  assert.equal(alfa.incarichi, 2);
  assert.equal(alfa.valore, 460000);
  assert.equal(alfa.enti[0].n, 2);
  assert.equal(alfa.imprese[0].name, 'IMPRESA BETA SRL');
  assert.equal(rossi.incarichi, 2);
  assert.equal((await P.overview(db, { regions: ['Marche'] })).progettisti.length, 0);
  assert.equal((await P.overview(db, { type: 'direzione lavori' })).progettisti.length, 1);
  assert.equal((await P.overview(db, { q: 'rossi' })).progettisti[0].cf, 'RSSMRA70A01A345B');
});

test('scheda: opere e cosa è successo dopo, con chi lavora', async () => {
  const s = await P.scheda(db, '01111111111');
  assert.equal(s.incarichi, 2);
  const vasto = s.opere.find(o => o.cig === 'DDDDDDDDD1');
  assert.equal(vasto.dopo.stato, 'aggiudicata');
  assert.equal(vasto.dopo.impresa.name, 'IMPRESA BETA SRL');
  assert.equal(s.opere.find(o => o.cig === 'DDDDDDDDD2').dopo, null);
  assert.equal(s.soci[0].name, 'ROSSI MARIO');
  assert.equal(await P.scheda(db, 'NONESISTE00'), null);
});

test('API: pagina, ente, gara col CUP e senza, progettista nel CRM', async () => {
  const p = await D('GET', '/api/crm/progettisti?regions=tutte');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.progettisti.length, 2);
  assert.equal(p.body.data.incarichi, 3);
  // nel CRM come progettista (studio con P.IVA, professionista col codice fiscale)
  const a = await D('POST', '/api/crm/progettisti/crm', { cf: '01111111111', name: 'Studio Ingegneria Alfa' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await D('POST', '/api/crm/progettisti/crm', { cf: 'RSSMRA70A01A345B', name: 'Rossi Mario' });
  assert.equal(b.status, 201);
  assert.equal((await D('POST', '/api/crm/progettisti/crm', { cf: '01111111111', name: 'Alfa' })).body.created, false);
  const { rows: [rs] } = await db.query('SELECT tax_code, roles FROM crm_subjects WHERE id = $1', [b.body.id]);
  assert.equal(rs.tax_code, 'RSSMRA70A01A345B');
  assert.deepEqual(rs.roles, ['progettista', 'fornitore']); // ALM2-80: anche fornitore
  assert.equal((await D('GET', '/api/crm/progettisti?regions=tutte')).body.progettisti[0].subject.id, a.body.id);
  // l'ente nel CRM: i suoi progettisti
  const { rows: [ente] } = await db.query("INSERT INTO crm_subjects (name, vat, roles, asa) VALUES ('Provincia di Chieti', $1, '{cliente}', '{}') RETURNING id", [SA]);
  const e = await D('GET', `/api/crm/progettisti/ente/${ente.id}`);
  assert.equal(e.body.incarichi, 3);
  assert.equal(e.body.progettisti[0].subject.id, a.body.id);
  // segnale con lo stesso CUP: chi l'ha progettata; senza CUP ma con l'ente: i più forti con l'ente
  const { rows: [g1] } = await db.query("INSERT INTO crm_signals (source, external_id, title, cup, subject_id) VALUES ('test', 'x1', 'Blocco operatorio Lanciano', 'J11B22000000002', $1) RETURNING id", [ente.id]);
  const r1 = await D('GET', `/api/crm/progettisti/gara?signal_id=${g1.id}`);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.how, 'cup');
  assert.deepEqual(r1.body.progettisti.map(x => x.cf).sort(), ['01111111111', 'RSSMRA70A01A345B']);
  const { rows: [g2] } = await db.query("INSERT INTO crm_signals (source, external_id, title, subject_id) VALUES ('test', 'x2', 'Altra opera', $1) RETURNING id", [ente.id]);
  const r2 = await D('GET', `/api/crm/progettisti/gara?signal_id=${g2.id}`);
  assert.equal(r2.body.how, 'ente');
  assert.equal(r2.body.progettisti.length, 2);
  // chiedere a un collega di presentarci
  const uid = (await D('GET', '/api/me')).body.id;
  assert.equal((await D('POST', '/api/crm/progettisti/presentaci', { subject_id: a.body.id, user_id: uid })).status, 201);
});

// ── ALM2-80: area (BU), committente, Anagrafiche › Progettisti, nuovo progettista ──────────────────────
test("area dell'incarico: categoria della gara lavori col CUP, poi le parole", () => {
  const rules = P.areaRules({ profiles: {
    edilizia: { soa: ['OG1', 'OG8'] }, restauro: { soa: ['OG2', 'OG1'] }, reti_ap: { soa: ['OG6', 'OS35'] }, reti_mp_bp: { soa: ['OG6'] }, impianti: { soa: ['OG6', 'OS22'] } } });
  assert.deepEqual(P.areasOf('Lavori scuola', 'OG1', rules), ['edilizia']);
  assert.deepEqual(P.areasOf('Progettazione rete idrica e fognature', 'OG6', rules), ['reti_mp_bp']);
  assert.deepEqual(P.areasOf('Restauro della chiesa madre', '', rules), ['restauro']);
  assert.deepEqual(P.areasOf('Rilievo topografico', '', rules), []);
  assert.equal(P.quarterOf(new Date().toISOString()), 7);
  assert.equal(P.quarterOf('2000-01-01'), -1);
});

test('API: area, committente (anche per sigla), anagrafica e nuovo progettista', async () => {
  const all = await D('GET', '/api/crm/progettisti?regions=tutte');
  assert.ok(all.body.area_labels.some(a => a.key === 'edilizia' && a.label === 'Edilizia'));
  assert.equal(all.body.aree.edilizia, 1); // la scuola di Vasto: lavori OG1 collegati col CUP
  assert.equal(all.body.aree.nessuna, 2);
  assert.equal(all.body.quota.total, 3);
  assert.equal(all.body.heat.leaders.edilizia.name, 'STUDIO INGEGNERIA ALFA S.R.L.');
  const ed = await D('GET', '/api/crm/progettisti?regions=tutte&bu=edilizia');
  assert.equal(ed.body.kpi.incarichi, 1);
  assert.deepEqual(ed.body.progettisti.map(p => p.cf), ['01111111111']);
  assert.equal(ed.body.progettisti[0].serie.length, 8);
  // committente: cerca e filtra; accanto il totale su tutti gli enti
  const en = await D('GET', '/api/crm/progettisti/enti?q=provincia chieti');
  assert.equal(en.body.enti[0].cf, SA);
  assert.equal(en.body.enti[0].incarichi, 3);
  assert.equal(en.body.enti[0].progettisti, 2);
  const sa = await D('GET', `/api/crm/progettisti?regions=tutte&sa=${SA}`);
  assert.equal(sa.body.ente.name, 'PROVINCIA DI CHIETI');
  assert.equal(sa.body.progettisti[0].tutti.incarichi, 2);
  // Anagrafiche › Progettisti: chi è nel CRM, con l'ente e le sue aree
  const an = await D('GET', `/api/crm/progettisti/anagrafica?sa=${SA}`);
  assert.equal(an.status, 200, JSON.stringify(an.body));
  assert.equal(an.body.progettisti.length, 2);
  assert.equal(an.body.ente.incarichi, 3);
  const alfa = an.body.progettisti.find(p => p.cf === '01111111111');
  assert.equal(alfa.con_sa, 2);
  assert.ok(alfa.aree.includes('edilizia'));
  assert.equal(an.body.suggeriti.list.length, 0); // tutti e due già nel CRM
  // nuovo progettista: cerca in ANAC, poi crea (anche fornitore) o completa chi c'è già
  const ce = await D('GET', `/api/crm/progettisti/cerca?q=alfa&sa=${SA}`);
  assert.equal(ce.body.trovati[0].con_sa, 2);
  const nu = await D('POST', '/api/crm/progettisti/nuovo', { name: 'Ing. Paolo Verdi', cf: 'VRDPLA70A01H501X', tipo: 'libero', aree: ['reti_mp_bp', 'non_esiste'] });
  assert.equal(nu.status, 201, JSON.stringify(nu.body));
  const { rows: [v] } = await db.query('SELECT roles, kind, legal_form, asa, supplier_categories, supplier_subcategories FROM crm_subjects WHERE id = $1', [nu.body.id]);
  assert.deepEqual(v.roles, ['progettista', 'fornitore']);
  assert.equal(v.kind, 'professionista');
  assert.equal(v.legal_form, 'Libero professionista');
  assert.deepEqual(v.asa, ['reti_mp_bp']);
  assert.deepEqual([v.supplier_categories, v.supplier_subcategories], [['professionisti'], ['Progettista']]);
  assert.equal((await D('POST', '/api/crm/progettisti/nuovo', { name: 'Verdi', cf: 'VRDPLA70A01H501X' })).body.created, false);
  assert.equal((await D('POST', '/api/crm/progettisti/nuovo', { name: 'X', cf: '123' })).status, 400);
  const tutti = await D('GET', '/api/crm/progettisti/anagrafica?bu=reti_mp_bp');
  assert.deepEqual(tutti.body.progettisti.map(p => p.name), ['Ing. Paolo Verdi']);
  assert.equal(tutti.body.tiles.tutti, 3);
});

// ── ALM2-80, seconda parte: incarichi dietro una casella, «Tutti ›» nella gara, Alma «chi vince per…» ─────────────
test('API: incarichi di una casella della mappa (progettista × area, con l\'ente)', async () => {
  const all = await D('GET', '/api/crm/progettisti/incarichi?key=01111111111&regions=tutte');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.totale, 2);
  assert.equal(all.body.name, 'STUDIO INGEGNERIA ALFA S.R.L.');
  const ed = await D('GET', `/api/crm/progettisti/incarichi?key=01111111111&regions=tutte&bu=edilizia&sa=${SA}`);
  assert.equal(ed.body.totale, 1);
  assert.equal(ed.body.incarichi[0].cig, 'DDDDDDDDD1');
  assert.equal(ed.body.incarichi[0].dopo.stato, 'aggiudicata');
  assert.deepEqual(ed.body.incarichi[0].aree, ['edilizia']);
  assert.equal((await D('GET', '/api/crm/progettisti/incarichi?key=NONESISTE00&regions=tutte')).body.totale, 0);
  // nella gara: l'ente torna indietro per «Tutti ›»
  const { rows: [g] } = await db.query("SELECT id FROM crm_signals WHERE external_id = 'x2'");
  assert.equal((await D('GET', `/api/crm/progettisti/gara?signal_id=${g.id}`)).body.sa, SA);
});

test('Alma: «chi vince più gare di progettazione per la Provincia di Chieti?»', async () => {
  const tool = require('../lib/assistente-strumenti').find(t => t.name === 'progettisti');
  const get = async path => { const r = await D('GET', path); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; };
  const o = await tool.run({ ente: 'provincia chieti' }, get);
  assert.equal(o.ente.cf, SA);
  assert.equal(o.incarichi, 3);
  assert.equal(o.primi[0].posizione, 1);
  assert.ok(o.primi.some(p => p.nome === 'STUDIO INGEGNERIA ALFA S.R.L.' && p.incarichi === 2 && p.nel_crm));
  const ric = tool.ricevuta({ ente: 'provincia chieti' }, o);
  assert.equal(ric.link, `#/crm/concorrenza/progettisti?sa=${SA}`);
  assert.equal((await tool.run({ ente: 'ente che non esiste' }, get)).ente_trovato, false);
  const area = await tool.run({ area: 'edilizia' }, get);
  assert.equal(area.area, 'edilizia');
  assert.equal(area.incarichi, 1);
});
