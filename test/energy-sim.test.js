// Motore del simulatore di Alma Energy: i numeri devono tornare con gli Excel della BU Energy
// (Modello fotovoltaico.xlsx e BU_Almacis_Energy_Modello.xlsx, valori letti dai fogli il 31/10/2026).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cashflows, buyRevampSell, portfolioYear, sensitivity, irr, npv, payback, wacc, DEFAULTS } = require('../lib/energy-sim');

// scarto relativo massimo ammesso rispetto al foglio
const close = (actual, expected, tol = 0.001, label = '') => {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  assert.ok(err <= tol, `${label}: ${actual} invece di ${expected} (scarto ${(err * 100).toFixed(3)}%)`);
};

// Modello fotovoltaico: impianto da 2,5 MW comprato a 550 k€/MW, ripotenziato a 3,25 MW con 300 k€/MW.
const model = () => cashflows({ sizeMw: 3.25, capex: { acquisto: 2.5 * 550000, revamping: 3.25 * 300000 } });

test('Modello fotovoltaico: righe del primo e dell\'ultimo anno come nel foglio', () => {
  const { rows } = model();
  assert.equal(rows.length, 31); // anno 0 + 30 anni
  const y1 = rows[1];
  close(y1.energy, 5362.5, 1e-6, 'energia 2027');
  close(y1.revenue, 444171.3739, 1e-6, 'ricavi 2027');
  close(y1.opex, -53040, 1e-9, 'OPEX 2027');
  close(y1.depreciation, -94000, 1e-9, 'ammortamento');
  close(y1.interest, -53854.1667, 1e-6, 'interessi 2027');
  close(y1.netIncome, 173213.37, 1e-6, 'utile 2027');
  close(y1.fcfUnlevered, 305557.54, 1e-6, 'FCF unlevered 2027');
  close(y1.fcfLevered, 169296.70, 1e-6, 'FCF levered 2027');
  const y23 = rows[23]; // 2049: debito rimborsato, ammortamento ancora in corso
  close(y23.fcfUnlevered, 303259.26, 1e-6, 'FCF unlevered 2049');
  assert.equal(y23.interest, 0);
  close(rows[30].fcfUnlevered, 358632.51, 1e-6, 'FCF unlevered 2056');
});

test('Modello fotovoltaico: indicatori come nel foglio', () => {
  const { kpi } = model();
  close(kpi.capex, 2350000, 1e-9, 'capex');
  close(kpi.wacc, 0.0678, 1e-6, 'WACC');
  close(kpi.irrUnlevered, 0.12956428, 1e-5, 'IRR unlevered');
  close(kpi.irrLevered, 0.17145593, 1e-5, 'IRR levered');
  close(kpi.cashOnCash, 4.13437778, 1e-6, 'cash on cash');
  close(kpi.lcoe, 46.30030111, 1e-6, 'LCOE');
  close(kpi.costPerMw, 723076.923, 1e-6, 'costo finale €/MW');
  close(kpi.equityPerMw, 361538.4615, 1e-6, 'equity €/MW');
  assert.ok(kpi.dscrMin > 1 && kpi.dscrMin <= kpi.dscrAvg);
  assert.ok(kpi.paybackUnlevered > 7 && kpi.paybackUnlevered < 9); // cumulato positivo nell'ottavo anno
});

test('BU Energy linea 3 Buy-Revamp-Sell: ROE per ciclo 80,5% e margine 427 k€/MW', () => {
  const { kpi } = buyRevampSell({});
  close(kpi.capex, 2350000, 1e-9, 'capex');
  close(kpi.resale, 3737500, 1e-9, 'rivendita');
  close(kpi.interest, 58750, 1e-9, 'interessi');
  close(kpi.netIncome, 946070, 1e-6, 'utile del ciclo');
  close(kpi.roe, 0.805165957, 1e-6, 'ROE');
  close(kpi.marginPerMw, 426923.0769, 1e-6, 'margine per MW');
});

test('BU Energy linea 2 Investimenti: DSCR 1,68 e cash yield 12,9%', () => {
  const { kpi } = portfolioYear({});
  close(kpi.mw, 5.128205128, 1e-6, 'MW');
  close(kpi.ebitda, 437179.4872, 1e-6, 'EBITDA');
  close(kpi.netIncome, 117845.1282, 1e-6, 'utile');
  close(kpi.dscr, 1.677874364, 1e-6, 'DSCR');
  close(kpi.roe, 0.117845128, 1e-6, 'ROE');
  close(kpi.cashYield, 0.128956239, 1e-6, 'cash yield');
});

test('funzioni finanziarie: IRR, VAN, payback, WACC', () => {
  close(irr([-100, 110]), 0.1, 1e-9, 'IRR semplice');
  assert.equal(irr([100, 10]), null); // nessun investimento: niente IRR
  assert.ok(Math.abs(npv(0.1, [-100, 110])) < 1e-9, 'VAN a IRR');
  assert.equal(payback([-100, 50, 50]), 2);
  assert.equal(payback([-100, 10, 10]), null);
  close(wacc(DEFAULTS), 0.0678, 1e-6, 'WACC predefinito');
});

test('sensitività: prezzo, capex e producibilità a ±10/20%, al centro lo scenario base', () => {
  const input = { sizeMw: 3.25, capex: { acquisto: 1375000, revamping: 975000 } };
  const s = sensitivity(input);
  assert.deepEqual(Object.keys(s), ['prezzo', 'capex', 'producibilita']);
  close(s.prezzo[2].irrUnlevered, 0.12956428, 1e-5, 'centro = base');
  assert.ok(s.prezzo[0].irrUnlevered < s.prezzo[4].irrUnlevered); // prezzo più alto, rendimento più alto
  assert.ok(s.capex[0].irrUnlevered > s.capex[4].irrUnlevered); // capex più alto, rendimento più basso
  assert.ok(s.producibilita[3].irrUnlevered > s.producibilita[2].irrUnlevered);
});

test('le ipotesi si cambiano: prezzo fisso, ricavi extra (incentivo) e senza debito', () => {
  const base = cashflows({ sizeMw: 1, capex: { epc: 700000 }, price: 80, leverage: 0 });
  assert.equal(base.kpi.debt, 0);
  assert.equal(base.kpi.dscrMin, null);
  assert.equal(base.rows[5].interest, 0);
  const incentive = cashflows({ sizeMw: 1, capex: { epc: 700000 }, price: 80, leverage: 0, extraRevenue: t => (t <= 5 ? 100000 : 0) });
  close(incentive.rows[3].ebitda - base.rows[3].ebitda, 100000, 1e-9, 'incentivo nei primi 5 anni');
  assert.equal(incentive.rows[6].ebitda, base.rows[6].ebitda);
  assert.ok(incentive.kpi.irrUnlevered > base.kpi.irrUnlevered);
});
