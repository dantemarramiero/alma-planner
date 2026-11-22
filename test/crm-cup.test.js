// Opere finanziate da OpenCUP (ALM2-49, canvas v14 · V14-OpenCUP): pagina dell'area e zip finti, solo lavori pubblici
// attivi recenti delle regioni e dei tipi in uso, «senza gara» / «con gara» incrociando ANAC, enti nel CRM,
// «Segnala al radar», fonte e limiti nel riquadro dati, Impostazioni.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const C = require('../lib/crm-cup');

const COLS = ['CUP', 'DESCRIZIONE_SINTETICA_CUP', 'ANNO_DECISIONE', 'STATO_PROGETTO', 'COSTO_PROGETTO', 'FINANZIAMENTO_PROGETTO', 'REGIONE', 'SIGLA_PROVINCIA', 'COMUNE',
  'SOGGETTO_TITOLARE', 'PIVA_CODFISCALE_SOG_TITOLARE', 'CODICE_NATURA_INTERVENTO', 'NATURA_INTERVENTO', 'CODICE_SETTORE_INTERVENTO', 'CODICE_SOTTOSETTORE_INTERVENTO',
  'CODICE_CATEGORIA_INTERVENTO', 'CATEGORIA_INTERVENTO', 'DESCRIZIONE_INTERVENTO', 'STRUMENTO_PROGRAMMAZIONE', 'COPERTURA_FINANZIARIA', 'DATA_GENERAZIONE_CUP', 'LINK_OPENCOESIONE'];
const LP = 'REALIZZAZIONE DI LAVORI PUBBLICI (OPERE ED IMPIANTISTICA)';
const Y = new Date().getFullYear();
const row = o => COLS.map(c => `"${String(o[c] ?? '').replace(/"/g, '""')}"`).join(';');
const base = { STATO_PROGETTO: 'ATTIVO', CODICE_NATURA_INTERVENTO: '03', NATURA_INTERVENTO: LP, REGIONE: 'ABRUZZO', SIGLA_PROVINCIA: 'PE', STRUMENTO_PROGRAMMAZIONE: 'ALTRO', COPERTURA_FINANZIARIA: 'STATALE', DATA_GENERAZIONE_CUP: '12-MAR-2024' };
const ROWS = [
  { ...base, CUP: 'A11', ANNO_DECISIONE: Y - 1, COSTO_PROGETTO: '2000000', COMUNE: 'PESCARA', SOGGETTO_TITOLARE: 'COMUNE DI PESCARA', PIVA_CODFISCALE_SOG_TITOLARE: '00124600685',
    CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065', CATEGORIA_INTERVENTO: 'IMPIANTI DI TRASMISSIONE', DESCRIZIONE_INTERVENTO: 'NUOVA CABINA PRIMARIA E LINEE MT' },
  { ...base, CUP: 'A11', ANNO_DECISIONE: Y - 1, COSTO_PROGETTO: '2000000', COMUNE: 'MONTESILVANO', SOGGETTO_TITOLARE: 'COMUNE DI PESCARA', PIVA_CODFISCALE_SOG_TITOLARE: '00124600685',
    CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065', CATEGORIA_INTERVENTO: 'IMPIANTI DI TRASMISSIONE', DESCRIZIONE_INTERVENTO: 'NUOVA CABINA PRIMARIA E LINEE MT' },
  { ...base, CUP: 'B22', ANNO_DECISIONE: Y - 2, COSTO_PROGETTO: '500000', COMUNE: 'CHIETI', SIGLA_PROVINCIA: 'CH', SOGGETTO_TITOLARE: 'REGIONE ABRUZZO', PIVA_CODFISCALE_SOG_TITOLARE: '80003170661',
    CODICE_SETTORE_INTERVENTO: '05', CODICE_SOTTOSETTORE_INTERVENTO: '99', CODICE_CATEGORIA_INTERVENTO: '193', CATEGORIA_INTERVENTO: 'ILLUMINAZIONE PUBBLICA', DESCRIZIONE_INTERVENTO: 'RIFACIMENTO ILLUMINAZIONE PUBBLICA', COPERTURA_FINANZIARIA: 'COMUNITARIA' },
  { ...base, CUP: 'C33', ANNO_DECISIONE: Y - 1, REGIONE: 'CAMPANIA', CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065', DESCRIZIONE_INTERVENTO: 'FUORI ZONA' },
  { ...base, CUP: 'D44', ANNO_DECISIONE: Y - 1, STATO_PROGETTO: 'CHIUSO', CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065', DESCRIZIONE_INTERVENTO: 'CHIUSO' },
  { ...base, CUP: 'E55', ANNO_DECISIONE: Y - 1, CODICE_NATURA_INTERVENTO: '07', NATURA_INTERVENTO: 'CONCESSIONE DI INCENTIVI', CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065' },
  { ...base, CUP: 'F66', ANNO_DECISIONE: Y - 1, CODICE_SETTORE_INTERVENTO: '05', CODICE_SOTTOSETTORE_INTERVENTO: '12', CODICE_CATEGORIA_INTERVENTO: '098', DESCRIZIONE_INTERVENTO: 'IMPIANTO SPORTIVO' },
  { ...base, CUP: 'G77', ANNO_DECISIONE: 2012, CODICE_SETTORE_INTERVENTO: '03', CODICE_SOTTOSETTORE_INTERVENTO: '16', CODICE_CATEGORIA_INTERVENTO: '065', DESCRIZIONE_INTERVENTO: 'VECCHIO' },
];

// zip con due file CSV (directory centrale vera, come quelli di OpenCUP)
function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of files) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0808, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(text.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, data);
    central.push(ch, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const head = COLS.map(c => `"${c}"`).join(';');
const ZIP = makeZip([['OpendataSud0.csv', `﻿${head}\r\n${ROWS.slice(0, 4).map(row).join('\r\n')}\r\n`], ['OpendataSud1.csv', `${head}\r\n${ROWS.slice(4).map(row).join('\r\n')}\r\n`]]);
const asked = [];
const fakeCup = async url => {
  asked.push(url);
  if (url.endsWith('/dettaglio-opendata-sud')) return new Response('<a href="/portale/documents/1/2/OpendataCsvSud.zip/abc-123">CSV</a>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (url.includes('OpendataCsvSud.zip')) return new Response(ZIP, { status: 200, headers: { 'content-type': 'application/zip' } });
  throw new Error(`fetch inatteso: ${url}`);
};

let server, base_, db, D, iniziativa;
const ADMIN = 'direzione@almacis.it';
async function api(cookie, method, path, body) {
  const res = await fetch(base_ + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, cupFetch: fakeCup });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base_ = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base_}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  D = (method, path, body) => api(cookie, method, path, body);
  const { rows: [i] } = await db.query(`INSERT INTO crm_initiatives (name, profile, created_by) VALUES ('Reti', $1::jsonb, (SELECT id FROM users LIMIT 1)) RETURNING id`,
    [JSON.stringify({ soa: ['OG10'], regions: ['Abruzzo'] })]);
  iniziativa = i.id;
  await db.query(`INSERT INTO crm_subjects (name, roles, vat, created_by) VALUES ('Regione Abruzzo', '{cliente}', '80003170661', (SELECT id FROM users LIMIT 1))`);
  await db.query(`INSERT INTO crm_anac_awards (cig, cup, category, region, base_amount, amount, discount, winners, awarded_on, month) VALUES ('Z1', 'B22', 'OG10', 'Abruzzo', 450000, 400000, 11.1, $1, CURRENT_DATE - 20, '202611')`,
    [JSON.stringify([{ cf: '01234567890', name: 'ROSSI IMPIANTI SRL', role: '' }])]);
});
after(async () => { server?.close(); await db?.close(); });

test('categorie → tipi di lavoro CUP, aree delle regioni', () => {
  assert.ok(C.typesFor(['OG10']).includes('03.16.065'));
  assert.ok(C.typesFor(['OG10'], { concorrenza: { cup_types: { OG10: ['05.99.191'] } } }).includes('05.99.191'));
  assert.deepEqual(C.areasFor(['Abruzzo', 'Marche']), ['centro', 'sud']);
  assert.equal(C.labelOf('05.99.193'), 'illuminazione pubblica');
  assert.equal(C.labelOf('03.16.065'), 'trasmissione di energia elettrica');
  assert.equal(C.cupDate('06-JUL-2019'), '2019-07-06');
});

test('prima di caricare: la sezione lo dice', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere`);
  assert.equal(r.status, 200);
  assert.equal(r.body.source.updated_at, null);
});

test('caricamento: solo l\'area Sud, lavori pubblici attivi recenti dei tipi e delle regioni in uso', async () => {
  const out = await C.syncCup(db, { fetchImpl: fakeCup, settings: { concorrenza: {}, profiles: {} }, log: () => {} });
  assert.equal(out.rows, 2);
  assert.ok(!asked.some(u => /centro|isole|nord/.test(u)));
  const { rows } = await db.query('SELECT cup, places, region, comune, owner_cf, created_on FROM crm_cup_works ORDER BY cup');
  assert.deepEqual(rows.map(r => r.cup), ['A11', 'B22']);
  assert.equal(rows[0].places, 2);
  assert.equal(rows[0].region, 'Abruzzo');
  assert.equal(rows[0].comune, 'Pescara');
});

test('senza gara / con gara (da ANAC con il CUP), enti nel CRM', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.kpi, { without: 1, with: 1, cost: 2500000, owners_in_crm: 1 });
  assert.deepEqual(r.body.rows.map(x => x.cup), ['A11']);
  assert.equal(r.body.rows[0].type_label, 'trasmissione di energia elettrica');
  assert.equal(r.body.rows[0].subject, null);
  const c = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere?vista=con`);
  const [b] = c.body.rows;
  assert.equal(b.cup, 'B22');
  assert.equal(b.award.winners[0].name, 'ROSSI IMPIANTI SRL');
  assert.equal(b.subject.name, 'Regione Abruzzo');
  assert.equal(b.coverage, 'Comunitaria');
  const p = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere?vista=tutte&province=CH`);
  assert.deepEqual(p.body.rows.map(x => x.cup), ['B22']);
  assert.deepEqual(p.body.provinces, ['CH', 'PE']);
  const y = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere?vista=tutte&dal=${Y - 1}`);
  assert.deepEqual(y.body.rows.map(x => x.cup), ['A11']);
});

test('«Segnala al radar»: l\'opera ricorda il segnale, anche dopo il caricamento del mese dopo', async () => {
  const s = await D('POST', '/api/crm/radar/signals', { kind: 'opera_finanziata', title: 'Nuova cabina primaria', entity: 'Comune di Pescara', amount: 2000000 });
  assert.equal(s.status, 201);
  assert.equal((await D('POST', '/api/crm/cup/A11/segnale', { signal_id: s.body.id })).status, 200);
  await C.syncCup(db, { fetchImpl: fakeCup, settings: { concorrenza: {}, profiles: {} }, log: () => {} });
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/opere`);
  assert.equal(r.body.rows[0].signal_id, s.body.id);
  assert.equal((await D('POST', '/api/crm/cup/NOPE/segnale', { signal_id: s.body.id })).status, 404);
});

test('«Da dove vengono i dati»: OpenCUP attiva e i suoi limiti', async () => {
  const r = await D('GET', `/api/crm/fonti?iniziativa=${iniziativa}`);
  const cup = r.body.sources.find(s => s.key === 'opencup');
  assert.equal(cup.status, 'ok');
  assert.ok(r.body.limits.some(l => l.startsWith('OpenCUP')));
});

test('Impostazioni: tipi di lavoro CUP in più', async () => {
  const st = await D('GET', '/api/crm/commerciale');
  const conc = st.body.concorrenza || st.body.settings?.concorrenza;
  const put = await D('PUT', '/api/crm/commerciale/concorrenza', { value: { ...conc, cup_types: { og10: ['05.99.191', 'xx'] } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const t = await D('GET', '/api/crm/cup/tipi');
  assert.deepEqual(t.body.extra, { OG10: ['05.99.191'] });
  assert.ok(t.body.map.OG10.includes('05.99.191'));
});
