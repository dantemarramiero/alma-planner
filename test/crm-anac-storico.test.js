// Storico ANAC (21/11): dal file unico (aggiudicazioni, categorie, aggiudicatari) e dai CIG per anno si tengono solo le
// gare aggiudicate nei mesi voluti, nelle nostre categorie o CPV, sopra il minimo; il CIG si trova anche in un file di un
// anno prima; un file CIG che manca non ferma il giro; le gare già arrivate da un file mensile non si toccano.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { Readable } = require('stream');
const S = require('../lib/crm-anac-storico');
const A = require('../lib/crm-anac');
const { createDb, migrate } = require('../lib/db');

const csv = rows => rows.map(r => r.map(x => (x === null ? '' : `"${String(x).replace(/"/g, '""')}"`)).join(';')).join('\n');
function zip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(data.length, 18); h.writeUInt32LE(Buffer.byteLength(text), 22); h.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([h, Buffer.from(name), data, Buffer.alloc(22)]);
}
const CIG_HEAD = ['cig', 'oggetto_lotto', 'importo_lotto', 'oggetto_principale_contratto', 'provincia', 'data_pubblicazione', 'cf_amministrazione_appaltante', 'denominazione_amministrazione_appaltante', 'sezione_regionale', 'cod_cpv'];
const FILES = {
  [S.fullUrl('aggiudicazioni')]: csv([['cig', 'esito', 'data_aggiudicazione_definitiva', 'importo_aggiudicazione', 'ribasso_aggiudicazione', 'num_imprese_offerenti', 'criterio_aggiudicazione', 'flag_subappalto'],
    ['HHHHHHHHH1', 'AGGIUDICATA', '2025-03-10', '1200000', '22.5', '9', 'PREZZO PIU\' BASSO', 'false'], // OG1 in Abruzzo, CIG di febbraio 2025
    ['HHHHHHHHH2', 'AGGIUDICATA', '2025-06-01', '900000', '18', '5', 'PREZZO PIU\' BASSO', 'true'], // OG1, CIG pubblicato a novembre 2024
    ['HHHHHHHHH3', 'AGGIUDICATA', '2023-01-05', '900000', '10', '4', '', 'false'], // fuori dai mesi
    ['HHHHHHHHH4', 'AGGIUDICATA', '2025-04-01', '5000', '1', '1', '', 'false'], // sotto il minimo
    ['HHHHHHHHH5', 'AGGIUDICATA', '2025-05-01', '700000', '12', '3', '', 'false'], // pulizie: CPV 909 non nostro
    ['HHHHHHHHH6', 'AGGIUDICATA', '2025-07-01', '300000', '15', '6', '', 'false'], // facility: CPV 50700000
    ['HHHHHHHHH7', 'AGGIUDICATA', '2025-08-01', '500000', '9', '2', '', 'false']]), // già arrivata dal file mensile
  [S.fullUrl('categorie-opera')]: csv([['cig', 'id_categoria', 'cod_tipo_categoria'],
    ['HHHHHHHHH1', 'OG 1', 'P'], ['HHHHHHHHH2', 'OG 1', 'P'], ['HHHHHHHHH3', 'OG 1', 'P'], ['HHHHHHHHH4', 'OG 1', 'P'], ['HHHHHHHHH5', 'OS 3', 'P'], ['HHHHHHHHH7', 'OG 1', 'P']]),
  [S.fullUrl('aggiudicatari')]: csv([['cig', 'ruolo', 'codice_fiscale', 'denominazione'],
    ['HHHHHHHHH1', 'MANDATARIA', '01234567890', 'CMB COSTRUZIONI'], ['HHHHHHHHH1', 'MANDANTE', '09876543210', 'TADDEI S.P.A.'],
    ['HHHHHHHHH2', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '05555555555', 'EDIL SUD SRL'], ['HHHHHHHHH6', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '06666666666', 'FACILITY ITALIA']]),
  [S.cigUrl('202502')]: csv([CIG_HEAD, ['HHHHHHHHH1', 'Scuola di Pescara', '1500000', 'LAVORI', 'PESCARA', '2025-02-01', '80000000000', 'COMUNE DI PESCARA', 'SEZIONE REGIONALE ABRUZZO', '45214200'],
    ['HHHHHHHHH5', 'Pulizie uffici', '800000', 'SERVIZI', 'ROMA', '2025-02-03', '1', 'X', 'SEZIONE REGIONALE LAZIO', '90910000'],
    ['HHHHHHHHH6', 'Manutenzione impianti', '350000', 'SERVIZI', 'CHIETI', '2025-02-04', '2', 'ASL CHIETI', 'SEZIONE REGIONALE ABRUZZO', '50700000'],
    ['HHHHHHHHH7', 'Già mensile', '600000', 'LAVORI', 'ROMA', '2025-02-05', '3', 'Y', 'SEZIONE REGIONALE LAZIO', '45000000']]),
  [S.cigUrl('202411')]: csv([CIG_HEAD, ['HHHHHHHHH2', 'Palestra di Ortona', '1000000', 'LAVORI', 'CHIETI', '2024-11-20', '80000000001', 'COMUNE DI ORTONA', 'SEZIONE REGIONALE ABRUZZO', '45212200']]),
};
const fetched = [];
async function fakeAnac(url) {
  fetched.push(url);
  if (url.includes('package_show')) return { ok: true, json: async () => ({ result: { resources: [{ name: 'aggiudicazioni_csv', last_modified: '2026-01-15T00:00:00' }] } }) };
  if (!FILES[url]) return { ok: false, status: 404 }; // file CIG che manca: si va avanti
  const buf = zip('f.csv', FILES[url]);
  return { ok: true, body: Readable.from([buf.subarray(0, 20), buf.subarray(20)]) };
}
const settings = { concorrenza: { min_amount: 40000, cpv: { facility: ['507'] }, extra_categories: ['OG1'] }, profiles: {} };

test('storico ANAC: mesi voluti, categorie o CPV, CIG di un anno prima, file mancanti', async () => {
  assert.equal(await S.historyEnd({ fetchImpl: fakeAnac }), '202512');
  assert.deepEqual(S.monthsBetween('202411', '202502'), ['202411', '202412', '202501', '202502']);
  const logs = [];
  const r = await S.collectHistory(settings, { from: '202501', to: '202512', fetchImpl: fakeAnac, log: x => logs.push(x) });
  const byCig = Object.fromEntries(r.rows.map(a => [a.cig, a]));
  assert.deepEqual(Object.keys(byCig).sort(), ['HHHHHHHHH1', 'HHHHHHHHH2', 'HHHHHHHHH6', 'HHHHHHHHH7']);
  assert.equal(byCig.HHHHHHHHH1.region, 'Abruzzo');
  assert.equal(byCig.HHHHHHHHH1.discount, 22.5);
  assert.deepEqual(byCig.HHHHHHHHH1.winners.map(w => w.role), ['mandataria', 'mandante']);
  assert.equal(byCig.HHHHHHHHH2.sa_name, 'COMUNE DI ORTONA'); // trovato nel file CIG di novembre 2024
  assert.equal(byCig.HHHHHHHHH6.category, ''); // tenuta per il CPV della facility
  assert.ok(logs.some(l => /non letto/.test(l)), 'i file CIG che mancano si segnano e si va avanti');

  // nel database: col mese dell'aggiudicazione, senza toccare la gara già arrivata dal file mensile
  const db = await createDb({});
  await migrate(db);
  try {
    await db.query(`INSERT INTO crm_anac_awards (cig, object, sa_cf, sa_name, region, province, category, cpv, kind, awarded_on, winners, month)
      VALUES ('HHHHHHHHH7', 'Dal file mensile', '', '', 'Lazio', 'Roma', 'OG1', '45000000', 'LAVORI', '2025-08-01', '[]', '202604')`);
    const out = await A.importHistory(db, '202501', '202512', settings, { fetchImpl: fakeAnac });
    assert.equal(out.kept, 4);
    assert.deepEqual(out.perMonth, { 202503: 1, 202506: 1, 202507: 1, 202508: 1 });
    const { rows } = await db.query('SELECT cig, month, object FROM crm_anac_awards ORDER BY cig');
    assert.deepEqual(rows.map(x => [x.cig, x.month]), [['HHHHHHHHH1', '202503'], ['HHHHHHHHH2', '202506'], ['HHHHHHHHH6', '202507'], ['HHHHHHHHH7', '202604']]);
    assert.equal(rows[3].object, 'Dal file mensile');
  } finally { await db.close(); }
});
