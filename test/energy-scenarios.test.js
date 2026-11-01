// Scenari del simulatore di Alma Energy: FV classico (BusinessPlan), revamping (rivendita o gestione), PPA on-site.
// I numeri del primo anno del FV classico tornano con BusinessPlan_Almacis_Fotovoltaico.xlsx (nel foglio gli anni 2 e 3
// sono a zero per un errore di formula), quelli del revamping con il Modello fotovoltaico e la linea Buy-Revamp-Sell,
// quelli del PPA con lo screening dei tetti (Pilkington, San Salvo).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fvClassico, revamping, ppaOnsite, runScenario, summaryOf } = require('../lib/energy-scenarios');

const close = (actual, expected, tol = 1e-6, label = '') => {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  assert.ok(err <= tol, `${label}: ${actual} invece di ${expected}`);
};

test('FV classico: il primo anno delle tre varianti come nel BusinessPlan', () => {
  const { variants: { A, B, C } } = fvClassico();
  const [a1, b1, c1] = [A.years[0], B.years[0], C.years[0]];
  assert.deepEqual([a1.mwp, a1.rtb, a1.failed], [80, 64, 16]);
  close(a1.outflow, 501600, 1e-9, 'A esborsi');
  close(a1.revenue, 3186400, 1e-9, 'A ricavi');
  close(a1.net, 2684800, 1e-9, 'A risultato');
  close(a1.atRisk, 121600, 1e-9, 'capitale a rischio');
  close(b1.outflow, 9013600, 1e-9, 'B esborsi');
  close(b1.revenue, 15103200, 1e-9, 'B ricavi');
  close(c1.outflow, 9013600, 1e-9, 'C esborsi');
  close(c1.revenue, 2517600, 1e-9, 'C ricavi');
  assert.equal(c1.portfolio, 32);
});

test('FV classico: la crescita della pipeline vale davvero negli anni 2 e 3, e la gestione si giudica a 25 anni', () => {
  const r = fvClassico();
  assert.deepEqual(r.variants.A.years.map(y => Math.round(y.projects * 100) / 100), [8, 10.4, 12.48]);
  const C = r.variants.C;
  assert.ok(C.years[2].portfolio > C.years[1].portfolio); // i MWp gestiti si sommano
  assert.ok(C.longTerm.irr > 0.06 && C.longTerm.irr < 0.09, `IRR a 25 anni ${C.longTerm.irr}`);
  // senza crescita: tre anni uguali al primo
  const flat = fvClassico({ growthYear2: 0, growthYear3: 0 });
  close(flat.variants.A.totals.revenue, 3 * 3186400, 1e-9, 'A tre anni uguali');
});

test('revamping: rivendita come la linea Buy-Revamp-Sell, gestione come il Modello fotovoltaico', () => {
  const r = revamping();
  close(r.rivendita.kpi.roe, 0.805165957, 1e-6, 'ROE rivendita');
  close(r.gestione.kpi.irrUnlevered, 0.12956428, 1e-5, 'IRR gestione senza incentivo');
  close(r.gestione.kpi.irrLevered, 0.17145593, 1e-5, 'IRR levered');
  assert.equal(r.sizeAfter, 3.25);
  assert.ok(['rivendita', 'gestione'].includes(r.confronto.meglio));
  assert.equal(r.sensitivity.prezzo.length, 5);
});

test('revamping: l\'incentivo del Conto Energia vale solo sulla produzione di partenza e fino a scadenza', () => {
  const base = revamping();
  const withTariff = revamping({ incentivePerKwh: 0.3, incentiveYearsLeft: 5 });
  // primo anno: 2,5 MW × 1.650 h × 1.000 kWh/MWh × 0,30 €/kWh
  close(withTariff.gestione.rows[1].extraRevenue, 2.5 * 1650 * 1000 * 0.3, 1e-9, 'incentivo anno 1');
  assert.equal(withTariff.gestione.rows[6].extraRevenue, 0);
  assert.ok(withTariff.gestione.kpi.irrLevered > base.gestione.kpi.irrLevered);
  const fromDb = revamping({ incentiveAnnual: 500000, incentiveYearsLeft: 3 });
  close(fromDb.gestione.rows[2].extraRevenue, 500000 * (1 - 0.004), 1e-9, 'incasso GSE con decalage');
  assert.equal(fromDb.gestione.rows[4].extraRevenue, 0);
});

test('PPA on-site: taglia, produzione e capex del tetto di Pilkington come nello screening', () => {
  const r = ppaOnsite({ roofArea: 175949, kwhPerKwp: 1329.31 });
  close(r.plant.kwp, 21113.88, 1e-6, 'kWp');
  close(r.plant.energy1, 28066.8918228, 1e-6, 'MWh primo anno');
  close(r.plant.capex, 15835410, 1e-6, 'capex');
  assert.equal(r.flows.rows.length, 21); // contratto di 20 anni
  assert.ok(r.customer.saving1 > 0 && r.customer.savingTotal > r.customer.saving1);
  assert.ok(r.flows.kpi.irrUnlevered > 0);
  // prezzo PPA più alto: rendimento più alto, risparmio del cliente più basso
  const dear = ppaOnsite({ roofArea: 175949, kwhPerKwp: 1329.31, ppaPrice: 120 });
  assert.ok(dear.flows.kpi.irrUnlevered > r.flows.kpi.irrUnlevered);
  assert.ok(dear.customer.saving1 < r.customer.saving1);
  // canone del tetto e cessione finale
  const rent = ppaOnsite({ roofArea: 175949, kwhPerKwp: 1329.31, roofRent: 100000 });
  assert.ok(rent.flows.kpi.irrUnlevered < r.flows.kpi.irrUnlevered);
  const sold = ppaOnsite({ roofArea: 175949, kwhPerKwp: 1329.31, residualValue: 2000000 });
  assert.equal(sold.flows.rows[20].extraRevenue, 2000000);
});

test('riepilogo degli scenari per l\'elenco e per l\'opportunità', () => {
  const ppa = summaryOf(runScenario('ppa_onsite', { roofArea: 20000 }));
  assert.equal(ppa.mw, 2.4);
  assert.ok(ppa.irr !== undefined && ppa.saving1 > 0);
  const rev = summaryOf(runScenario('revamping', {}));
  assert.equal(rev.mw, 3.25);
  const fv = summaryOf(runScenario('fv_classico', {}));
  assert.ok(fv.roiA > fv.roiB);
  assert.throws(() => runScenario('boh', {}), /sconosciuto/);
});
