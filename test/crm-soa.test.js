// Attestazioni SOA (ALM2-49): lettura dei due CSV ANAC (finti), solo le valide, classifica più alta per categoria,
// «Chi è qualificato in zona» con gare vinte, filtri e CRM, riquadro della scheda impresa, fonte nel riquadro dati.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, readConfig } = require('../server');
const { createDb } = require('../lib/db');
const S = require('../lib/crm-soa');

const ATT = [
  '﻿_idAttestazione;ATA_soa_codiceFiscale;ATA_soa_denominazione;ATA_impresa_codiceFiscale;ATA_impresa_denominazione;ATA_provincia_codice;ATA_provincia_nome;ATA_attestato_stato;ATA_attestato_numero;ATA_attestato_codiceSoa;ATA_attestato_dataScadenzaIntermedia;ATA_attestato_classificaProgettazione;ATA_attestato_dataScadenzaValiditaTriennale;ATA_attestato_dataRilascioAttestazioneInCorso;ATA_attestato_dataScadenzaValiditaQuinquennale;ATA_attestato_dataRilascioAttestazioneOriginaria;ATA_attestato_dataEffettuazioneVerificaTriennale',
  'a1;111;SOA UNO SPA;01234567890;"ROSSI; IMPIANTI SRL";IT-PE;PESCARA;PUBBLICO;1;1;;;2027-01-01;2024-01-01;2029-01-01;2014-01-01;',
  'a2;111;SOA UNO SPA;09876543210;BIANCHI SPA;IT-AN;ANCONA;PUBBLICO;2;1;;;2027-01-01;2024-03-01;2029-03-01;2014-01-01;',
  'a3;111;SOA UNO SPA;05555555555;VERDI SRL;IT-RM;ROMA;PUBBLICO;3;1;;;2027-01-01;2024-03-01;2029-03-01;2014-01-01;',
  'a4;111;SOA UNO SPA;01234567890;ROSSI IMPIANTI SRL;IT-PE;PESCARA;SOSTITUITO;4;1;;;2020-01-01;2017-01-01;2022-01-01;2014-01-01;',
  'a5;111;SOA UNO SPA;07777777777;GIALLI SRL;IT-CB;CAMPOBASSO;PUBBLICO;5;1;;;2020-01-01;2017-01-01;2022-01-01;2014-01-01;',
].join('\r\n');
const CATS = ['﻿_idAttestazione;ATCR_categoria;ATCR_classifica', 'a1;OG10;IV', 'a1;OG 10;II', 'a1;OS30;III', 'a1;OG1;V', 'a2;OG10;IIIBIS', 'a3;OG10;VIII', 'a4;OG10;VIII', 'a5;OG10;VIII'].join('\r\n');
const fakeFetch = async url => {
  const body = url.endsWith('attestato_CKAN.csv') ? ATT : url.endsWith('categorie_rilasciate_CKAN.csv') ? CATS : null;
  if (!body) throw new Error(`fetch inatteso: ${url}`);
  return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
};

let server, base, db, D, iniziativa;
const ADMIN = 'direzione@almacis.it';
async function api(cookie, method, path, body) {
  const res = await fetch(base + path, { method, headers: { cookie, 'X-Alma': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

before(async () => {
  db = await createDb({});
  const { app } = await createApp(readConfig({ DEV_LOGIN: '1', PORT: '0', ADMIN_EMAILS: ADMIN }), { db, anacFetch: fakeFetch });
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/auth/dev-login?email=${ADMIN}`, { redirect: 'manual' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  D = (method, path, body) => api(cookie, method, path, body);
  // Rossi ha vinto una gara OG10 in Abruzzo; Bianchi niente
  await db.query(`INSERT INTO crm_anac_awards (cig, category, region, base_amount, amount, winners, awarded_on, month) VALUES ('G1', 'OG10', 'Abruzzo', 200000, 180000, $1, CURRENT_DATE - 30, '202611')`,
    [JSON.stringify([{ cf: '01234567890', name: 'ROSSI IMPIANTI SRL', role: '' }])]);
  const { rows: [i] } = await db.query(`INSERT INTO crm_initiatives (name, profile, created_by) VALUES ('Reti', $1::jsonb, (SELECT id FROM users LIMIT 1)) RETURNING id`,
    [JSON.stringify({ soa: ['OG10', 'OS30'], regions: ['Abruzzo', 'Marche', 'Molise'] })]);
  iniziativa = i.id;
});
after(async () => { server?.close(); await db?.close(); });

test('classifiche: normalizzate e in ordine', () => {
  assert.equal(S.normClass('IIIBIS'), 'III-BIS');
  assert.equal(S.normClass('iv-bis'), 'IV-BIS');
  assert.ok(S.rank('V') > S.rank('IV-BIS'));
  assert.equal(S.normClass('IX'), '');
});

test('prima del caricamento: sezione vuota e fonte «vuota»', async () => {
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/qualificate`);
  assert.equal(r.status, 200);
  assert.equal(r.body.source.updated_at, null);
  const f = await D('GET', '/api/crm/fonti');
  assert.equal(f.body.sources.find(s => s.key === 'soa').status, 'vuota');
});

test('caricamento: solo attestazioni valide e non scadute, classifica più alta per categoria', async () => {
  const out = await S.syncSoa(db, { fetchImpl: fakeFetch, log: () => {} });
  assert.equal(out.rows, 3, 'Rossi, Bianchi, Verdi (Gialli è scaduta, a4 sostituita)');
  const { rows: [r] } = await db.query("SELECT * FROM crm_soa WHERE cf = '01234567890'");
  assert.equal(r.name, 'ROSSI; IMPIANTI SRL', 'virgolette con il punto e virgola dentro');
  assert.deepEqual(r.cats, { OG10: 'IV', OS30: 'III', OG1: 'V' });
  assert.equal(r.region, 'Abruzzo');
  assert.equal((await D('GET', '/api/crm/soa/stato')).body.rows, 3);
});

test('chi è qualificato in zona: perimetro, gare vinte, filtri e CRM', async () => {
  await D('POST', '/api/crm/concorrenza/scheda', { name: 'Bianchi Spa', cf: '09876543210', role: 'partner' });
  const r = await D('GET', `/api/crm/business/${iniziativa}/mercato/qualificate`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.kpi, { total: 2, never: 1, in_crm: 1 }, 'Verdi è a Roma: fuori zona');
  const rossi = r.body.companies.find(c => c.cf === '01234567890');
  assert.equal(rossi.won, 1);
  assert.deepEqual(rossi.classes.map(x => [x.cat, x.cls, x.max]), [['OG10', 'IV', 2582000], ['OS30', 'III', 1033000]]);
  assert.equal(r.body.ladder.find(x => x.cls === 'IV').n, 1);
  const mai = await D('GET', `/api/crm/business/${iniziativa}/mercato/qualificate?filter=mai`);
  assert.deepEqual(mai.body.companies.map(c => c.cf), ['09876543210']);
  assert.ok(mai.body.companies[0].subject, 'Bianchi è nel CRM come partner');
  const cl = await D('GET', `/api/crm/business/${iniziativa}/mercato/qualificate?classe=IV`);
  assert.deepEqual(cl.body.companies.map(c => c.cf), ['01234567890']);
  const pr = await D('GET', `/api/crm/business/${iniziativa}/mercato/qualificate?province=Ancona`);
  assert.deepEqual(pr.body.companies.map(c => c.cf), ['09876543210']);
});

test('scheda impresa: attestazione con le categorie dell\'iniziativa prima', async () => {
  const r = await D('GET', '/api/crm/soa/impresa?cf=01234567890&cats=OS30,OG10');
  assert.equal(r.body.soa.expires_on, '2029-01-01');
  assert.deepEqual(r.body.soa.cats.map(x => x.cat), ['OG10', 'OS30', 'OG1']);
  assert.equal(r.body.soa.cats[0].ours, true);
  assert.equal((await D('GET', '/api/crm/soa/impresa?cf=00000000000')).body.soa, null);
  const f = await D('GET', '/api/crm/fonti');
  assert.equal(f.body.sources.find(s => s.key === 'soa').status, 'ok');
});
