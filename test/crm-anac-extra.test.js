// ANAC, dati in più (ALM2-49, 21/11): categorie scorporabili, tipo di lavoro, partecipanti (anche chi perde) nel mese;
// subappalti e CUP cercati dopo per tutte le gare già caricate; i mesi di prima si ricaricano una volta (versione 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { Readable } = require('stream');
const A = require('../lib/crm-anac');
const X = require('../lib/crm-anac-extra');
const { createDb, migrate } = require('../lib/db');

const csv = rows => rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
function zip(text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(Buffer.byteLength(text), 22); h.writeUInt16LE(5, 26);
  return Buffer.concat([h, Buffer.from('f.csv'), data, Buffer.alloc(22)]);
}
const M = '202606';
const day = '2026-06-10';
const FILES = {
  aggiudicazioni: csv([['cig', 'esito', 'data_aggiudicazione_definitiva', 'importo_aggiudicazione', 'ribasso_aggiudicazione', 'num_imprese_offerenti', 'criterio_aggiudicazione', 'flag_subappalto'],
    ['EEEEEEEEE1', 'AGGIUDICATA', day, '900000', '19', '4', 'PREZZO PIU\' BASSO', 'true'],
    ['EEEEEEEEE2', 'AGGIUDICATA', day, '500000', '12', '', '', 'false']]), // offerenti non dichiarati
  'categorie-opera': csv([['cig', 'id_categoria', 'cod_tipo_categoria'], ['EEEEEEEEE1', 'OG 1', 'P'], ['EEEEEEEEE1', 'OS 28', 'S'], ['EEEEEEEEE1', 'OG 11', 'S'], ['EEEEEEEEE2', 'OG 1', 'P']]),
  cig: csv([['cig', 'oggetto_lotto', 'importo_lotto', 'oggetto_principale_contratto', 'provincia', 'data_pubblicazione', 'cf_amministrazione_appaltante', 'denominazione_amministrazione_appaltante', 'sezione_regionale', 'cod_cpv'],
    ['EEEEEEEEE1', 'Scuola', '1100000', 'LAVORI', 'CHIETI', '2026-03-01', '80000000001', 'COMUNE DI ORTONA', 'SEZIONE REGIONALE ABRUZZO', '45214200-3'],
    ['EEEEEEEEE2', 'Palestra', '600000', 'LAVORI', 'CHIETI', '2026-03-01', '80000000001', 'COMUNE DI ORTONA', 'SEZIONE REGIONALE ABRUZZO', '45212200']]),
  aggiudicatari: csv([['cig', 'ruolo', 'codice_fiscale', 'denominazione'], ['EEEEEEEEE1', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '01234567890', 'CMB COSTRUZIONI']]),
  lavorazioni: csv([['cig', 'cod_tipo_lavorazione', 'tipo_lavorazione'], ['EEEEEEEEE1', '13', 'MANUTENZIONE STRAORDINARIA']]),
  partecipanti: csv([['cig', 'ruolo', 'codice_fiscale', 'denominazione', 'tipo_soggetto'],
    ['EEEEEEEEE1', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '01234567890', 'CMB COSTRUZIONI', 'IMPRESA'],
    ['EEEEEEEEE1', 'MANDATARIA', '09876543210', 'TADDEI SPA', 'IMPRESA'], ['EEEEEEEEE1', 'MANDANTE', '05555555555', 'EDIL SUD SRL', 'IMPRESA'],
    ['EEEEEEEEE1', 'IMPRESA AUSILIARIA', '07777777777', 'PRESTA REQUISITI', 'IMPRESA'], ['ZZZZZZZZZ9', 'MANDATARIA', '08888888888', 'ALTRA GARA', 'IMPRESA'],
    ['EEEEEEEEE2', 'OPERATORE ECONOMICO MONOSOGGETTIVO', '01234567890', 'CMB COSTRUZIONI', 'IMPRESA'], ['EEEEEEEEE2', 'MANDATARIA', '09876543210', 'TADDEI SPA', 'IMPRESA'],
    ['EEEEEEEEE2', 'MANDANTE', '05555555555', 'EDIL SUD SRL', 'IMPRESA']]),
  subappalti: csv([['cig', 'id_subappalto', 'cf_subappaltante', 'data_autorizzazione', 'oggetto', 'cod_categoria', 'descrizione_categoria', 'classe_importo', 'descrizione_tipo_categoria', 'cod_cpv', 'descrizione_cpv', 'codice_fiscale', 'denominazione', 'ruolo', 'tipo_soggetto'],
    ['EEEEEEEEE1', '991', '01234567890', '2026-09-01', 'Impianti termici', 'OS 28', '', '', 'SCORPORABILE', '45331000', '', '06666666666', 'TERMO ABRUZZO SRL', '', 'IMPRESA'],
    ['ZZZZZZZZZ9', '992', '1', '2026-09-01', 'Altro', 'OG 1', '', '', 'PREVALENTE', '', '', '1', 'X', '', '']]),
  cup: csv([['cig', 'cup'], ['EEEEEEEEE1', 'J81B22000123456'], ['ZZZZZZZZZ9', 'X00000000000000']]),
};
const fetched = [];
async function fakeAnac(url) {
  fetched.push(url);
  const ds = url.match(/dataset\/([^/]+)\//)[1];
  if (!FILES[ds] || url.includes('_csv.zip') && !url.includes(`${M}01-`) && ds !== 'cup') return { ok: false, status: 404 }; // file unico dei subappalti che manca: si va avanti
  const buf = zip(FILES[ds]);
  return { ok: true, body: Readable.from([buf.subarray(0, 25), buf.subarray(25)]) };
}
const settings = { concorrenza: { min_amount: 40000, cpv: {}, extra_categories: ['OG1'] }, profiles: {} };

test('ANAC dati in più: scorporabili, tipo di lavoro, partecipanti; poi subappalti e CUP', async () => {
  const db = await createDb({});
  try {
    await migrate(db);
    const r = await A.importMonth(db, M, settings, { fetchImpl: fakeAnac });
    assert.equal(r.kept, 2);
    const { rows: bc } = await db.query('SELECT cig, bidders, bidders_counted FROM crm_anac_awards ORDER BY cig');
    assert.deepEqual(bc.map(x => [x.cig, x.bidders, x.bidders_counted]), [['EEEEEEEEE1', 4, false], ['EEEEEEEEE2', 2, true]]); // dichiarati 4; contati 2 (l'ATI una volta)
    const { rows: [a] } = await db.query('SELECT cats_sec, work_type, cpv FROM crm_anac_awards WHERE cig = $1', ['EEEEEEEEE1']);
    assert.deepEqual(a.cats_sec, ['OS28', 'OG11']);
    assert.equal(a.work_type, 'Manutenzione Straordinaria');
    assert.equal(a.cpv, '452142003');
    const { rows: bid } = await db.query("SELECT cf, role FROM crm_anac_bidders WHERE cig = 'EEEEEEEEE1' ORDER BY cf");
    assert.deepEqual(bid.map(b => [b.cf, b.role]), [['01234567890', ''], ['05555555555', 'mandante'], ['09876543210', 'mandataria']]); // senza l'ausiliaria né altre gare

    const x = await A.importExtra(db, [M], { fetchImpl: fakeAnac });
    assert.deepEqual(x, { subappalti: 1, cup: 1, errori: 1 }); // il file unico dei subappalti manca
    const { rows: [s] } = await db.query('SELECT cf, name, by_cf, category, cat_type FROM crm_anac_subcontracts');
    assert.deepEqual(s, { cf: '06666666666', name: 'TERMO ABRUZZO SRL', by_cf: '01234567890', category: 'OS28', cat_type: 'scorporabile' });
    assert.equal((await db.query("SELECT cup FROM crm_anac_awards WHERE cig = 'EEEEEEEEE1'")).rows[0].cup, 'J81B22000123456');
    // al giro dopo si rilegge solo quello che non è andato (il file unico dei subappalti), non il mese né il CUP
    fetched.length = 0;
    await A.importExtra(db, [M], { fetchImpl: fakeAnac });
    assert.deepEqual(fetched.map(u => u.split('/').pop()), ['subappalti_csv.zip']);
  } finally { await db.close(); }
});
