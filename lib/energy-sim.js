// Simulatore dei rendimenti di Alma Energy: flussi di cassa anno per anno e indicatori (IRR, VAN, DSCR, payback, LCOE).
// Le formule rifanno quelle degli Excel della BU Energy, così i numeri tornano con quelli già conosciuti:
// - «Modello fotovoltaico.xlsx» (acquisto + revamping, 30 anni): cashflows()
// - «BU_Almacis_Energy_Modello.xlsx», linea 2 Investimenti in portafoglio: portfolioYear()
// - «BU_Almacis_Energy_Modello.xlsx», linea 3 Buy-Revamp-Sell: buyRevampSell()

// Ipotesi predefinite del Modello fotovoltaico (Dante può cambiarle nello scenario).
const DEFAULTS = Object.freeze({
  years: 30,
  startYear: 2026, // anno 0 = investimento; la produzione parte dall'anno dopo
  hours: 1650, // ore equivalenti di produzione nel primo anno
  decalage: 0.004, // perdita di producibilità all'anno
  inflation: 0.02,
  opexPerMw: 16000, // €/MW all'anno, a prezzi dell'anno 0
  depreciationYears: 25,
  debtYears: 12,
  leverage: 0.5, // debito / capex
  kd: 0.05,
  ke: 0.1,
  ires: 0.24,
  irap: 0.048,
});

// Curva del prezzo dell'energia (€/MWh, prezzi reali, anni 2027–2056) del Modello fotovoltaico.
// L'inflazione si applica sopra, come nel foglio.
const PRICE_CURVE = Object.freeze([
  81.20505944, 78.94115192, 76.67729593, 67.89525270, 70.62418605, 69.80028689, 74.19692586, 78.49888991,
  83.37422210, 83.35562912, 83.25762204, 81.72939130, 84.99445137, 80.25909928, 78.48903994, 76.38286970,
  73.09429609, 68.63152411, 64.77203314, 63.32847323, 62.51974786, 62.16896561, 60.69190801, 61.03405367,
  62.31576880, 63.62439994, 64.96051234, 66.32468310, 67.71750145, 69.13956898,
]);

const sum = a => a.reduce((s, x) => s + x, 0);

// Valore attuale come NPV() di Excel: il primo flusso è già scontato di un periodo.
function npvExcel(rate, flows) {
  return flows.reduce((s, f, i) => s + f / (1 + rate) ** (i + 1), 0);
}
// VAN con il flusso dell'anno 0 non scontato.
const npv = (rate, flows) => flows[0] + npvExcel(rate, flows.slice(1));

// Tasso interno di rendimento (Newton con ripiego sulla bisezione). null se i flussi non cambiano segno.
function irr(flows) {
  if (!flows.some(f => f < 0) || !flows.some(f => f > 0)) return null;
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    let f = 0, d = 0;
    for (let t = 0; t < flows.length; t++) {
      f += flows[t] / (1 + r) ** t;
      d -= (t * flows[t]) / (1 + r) ** (t + 1);
    }
    if (Math.abs(f) < 1e-7) return r;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.99) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  let lo = -0.99, hi = 10;
  const at = x => flows.reduce((s, f, t) => s + f / (1 + x) ** t, 0);
  if (at(lo) * at(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (at(lo) * at(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Anni (con la frazione) per riavere l'investimento con i flussi cumulati; null se non torna mai.
function payback(flows) {
  let cum = flows[0];
  for (let t = 1; t < flows.length; t++) {
    const prev = cum;
    cum += flows[t];
    if (cum >= 0 && prev < 0) return t - 1 + -prev / flows[t];
  }
  return cum >= 0 && flows[0] >= 0 ? 0 : null;
}

const wacc = a => (1 - a.leverage) * a.ke + a.leverage * a.kd * (1 - a.ires - a.irap);

// Flussi di cassa di un impianto su `years` anni.
// Input principali:
//   sizeMw         taglia in produzione (dopo l'eventuale repowering)
//   capex          { voce: euro } spese all'anno 0, es. { acquisto: 1375000, revamping: 975000 }
//   prices         €/MWh per anno (reali); se più corto, l'ultimo prezzo vale per gli anni dopo; oppure price fisso
//   extraRevenue   (anno, riga) => euro in più nell'anno, es. incentivo del Conto Energia fino a scadenza
// Tutte le ipotesi di DEFAULTS si possono cambiare.
function cashflows(input) {
  const a = { ...DEFAULTS, ...input };
  const capexItems = a.capex || {};
  const capex = sum(Object.values(capexItems));
  const prices = a.prices || (a.price !== undefined ? [a.price] : PRICE_CURVE);
  const priceAt = t => prices[Math.min(t - 1, prices.length - 1)];
  const debt = capex * a.leverage;
  const taxRate = a.ires + a.irap;

  const rows = [{
    year: a.startYear, t: 0, inflation: 1, price: null, hours: null, energy: 0, revenue: 0, extraRevenue: 0, opex: 0,
    ebitda: 0, depreciation: 0, ebit: 0, interest: 0, ebt: 0, taxes: 0, netIncome: 0,
    capex: -capex, debtDrawn: debt, debtRepaid: 0, debtOutstanding: debt,
  }];
  let hours = a.hours;
  let outstanding;
  for (let t = 1; t <= a.years; t++) {
    const inflation = (1 + a.inflation) ** t;
    if (t > 1) hours *= 1 - a.decalage;
    const energy = a.sizeMw * hours; // MWh
    const price = priceAt(t);
    const revenue = energy * price * inflation;
    const row = { year: a.startYear + t, t, inflation, price, hours, energy };
    const extra = a.extraRevenue ? a.extraRevenue(t, row) || 0 : 0;
    const opex = -a.opexPerMw * a.sizeMw * inflation;
    const ebitda = revenue + extra + opex;
    const depreciation = t > a.depreciationYears ? 0 : -capex / a.depreciationYears;
    const ebit = ebitda + depreciation;
    const repaid = t > a.debtYears ? 0 : -debt / a.debtYears;
    outstanding = t >= a.debtYears ? 0 : debt * (1 - t / a.debtYears); // senza resti di arrotondamento
    // come nel foglio: interessi sul debito che resta a fine anno
    const interest = outstanding > 0 ? -outstanding * a.kd : 0;
    const ebt = ebit + interest;
    const taxes = -taxRate * ebt;
    rows.push({
      ...row, revenue, extraRevenue: extra, opex, ebitda, depreciation, ebit, interest, ebt, taxes,
      netIncome: ebt + taxes, capex: 0, debtDrawn: 0, debtRepaid: repaid, debtOutstanding: outstanding,
    });
  }

  // FCF unlevered: EBITDA + capex − imposte sull'EBIT; levered: + interessi, debito incassato e rimborsato.
  for (const r of rows) {
    r.fcfUnlevered = r.ebitda + r.capex - r.ebit * taxRate;
    r.fcfLevered = r.ebitda + r.interest + r.taxes + r.capex + r.debtDrawn + r.debtRepaid;
  }
  const fcfU = rows.map(r => r.fcfUnlevered);
  const fcfL = rows.map(r => r.fcfLevered);
  const rate = wacc(a);
  const dscrs = rows.filter(r => r.t > 0 && r.debtRepaid < 0).map(r => r.ebitda / -(r.interest + r.debtRepaid));
  const equity = capex - debt;

  return {
    inputs: { ...a, capex: capexItems, prices: undefined, extraRevenue: undefined },
    rows,
    kpi: {
      capex,
      debt,
      equity,
      wacc: rate,
      irrUnlevered: irr(fcfU),
      irrLevered: irr(fcfL),
      npvUnlevered: npv(rate, fcfU),
      npvLevered: npv(a.ke, fcfL),
      paybackUnlevered: payback(fcfU),
      paybackLevered: payback(fcfL),
      dscrMin: dscrs.length ? Math.min(...dscrs) : null,
      dscrAvg: dscrs.length ? sum(dscrs) / dscrs.length : null,
      // costo dell'energia: (capex + OPEX) attualizzati / energia attualizzata, come nel foglio. Lì NPV() salta le
      // celle vuote dell'anno 0 di OPEX ed energia, quindi il primo anno di produzione è scontato di un solo periodo.
      lcoe: -(npvExcel(rate, rows.map(r => r.capex)) + npvExcel(rate, rows.slice(1).map(r => r.opex))) / npvExcel(rate, rows.slice(1).map(r => r.energy)),
      cashOnCash: -sum(fcfU.slice(1)) / fcfU[0],
      costPerMw: a.sizeMw ? capex / a.sizeMw : null,
      equityPerMw: a.sizeMw ? equity / a.sizeMw : null,
      firstYearEbitda: rows[1]?.ebitda ?? 0,
      totalEnergy: sum(rows.map(r => r.energy)),
      roe: equity ? (rows[1]?.netIncome ?? 0) / equity : null, // ROE del primo anno
    },
  };
}

// Linea 3 del modello BU: compra un impianto, lo ripotenzia e lo rivende in un ciclo di ~12 mesi.
function buyRevampSell(input) {
  const a = {
    sizeMw: 2.5, purchasePerMw: 550000, revampPerMw: 300000, sizeIncreaseMw: 0.75, resalePerMw: 1150000,
    leverage: 0.5, kd: 0.05, cycleMonths: 12, share: 1, ires: DEFAULTS.ires, irap: DEFAULTS.irap, ...input,
  };
  const sizeAfter = a.sizeMw + a.sizeIncreaseMw;
  const purchase = a.sizeMw * a.purchasePerMw * a.share;
  const revamp = sizeAfter * a.revampPerMw * a.share; // il revamping si paga sulla taglia finale
  const capex = purchase + revamp;
  const debt = capex * a.leverage;
  const equity = capex - debt;
  const resale = sizeAfter * a.resalePerMw * a.share;
  const margin = resale - capex;
  const interest = debt * a.kd * a.cycleMonths / 12;
  const ebt = margin - interest;
  const taxes = Math.max(ebt, 0) * (a.ires + a.irap);
  const netIncome = ebt - taxes;
  return {
    inputs: a,
    kpi: {
      sizeAfter, purchase, revamp, capex, debt, equity, resale, margin, interest, ebt, taxes, netIncome,
      roe: equity ? netIncome / equity : null,
      marginPerMw: margin / sizeAfter,
    },
  };
}

// Linea 2 del modello BU: impianti comprati e tenuti, primo anno a regime.
function portfolioYear(input) {
  const a = {
    equity: 1000000, leverage: 0.7, capexPerMw: 650000, hours: 1350, price: 75, opexPerMw: 16000,
    kd: 0.045, debtYears: 15, depreciationYears: 20, ires: DEFAULTS.ires, irap: DEFAULTS.irap, ...input,
  };
  const capex = a.equity / (1 - a.leverage);
  const debt = capex * a.leverage;
  const mw = capex / a.capexPerMw;
  const energy = mw * a.hours;
  const revenue = energy * a.price;
  const opex = -mw * a.opexPerMw;
  const ebitda = revenue + opex;
  const depreciation = -capex / a.depreciationYears;
  const interest = -debt * a.kd;
  const ebt = ebitda + depreciation + interest;
  const taxes = -Math.max(ebt, 0) * (a.ires + a.irap);
  const netIncome = ebt + taxes;
  const principal = debt / a.debtYears;
  const cashToEquity = ebitda + interest + taxes - principal;
  return {
    inputs: a,
    kpi: {
      capex, debt, mw, energy, revenue, opex, ebitda, depreciation, interest, ebt, taxes, netIncome, principal,
      dscr: ebitda / (principal - interest),
      roe: netIncome / a.equity,
      cashToEquity,
      cashYield: cashToEquity / a.equity,
    },
  };
}

// Sensitività: ricalcola lo scenario con prezzo, capex e producibilità spostati di ±10% e ±20%.
const SENSITIVITY_STEPS = [-0.2, -0.1, 0, 0.1, 0.2];
function sensitivity(input, { steps = SENSITIVITY_STEPS } = {}) {
  const prices = input.prices || (input.price !== undefined ? [input.price] : PRICE_CURVE);
  const hours = input.hours ?? DEFAULTS.hours;
  const vary = {
    prezzo: d => ({ prices: prices.map(p => p * (1 + d)), price: undefined }),
    capex: d => ({ capex: Object.fromEntries(Object.entries(input.capex || {}).map(([k, val]) => [k, val * (1 + d)])) }),
    producibilita: d => ({ hours: hours * (1 + d) }),
  };
  return Object.fromEntries(Object.entries(vary).map(([key, change]) => [key, steps.map(d => {
    const { kpi } = cashflows({ ...input, ...change(d) });
    return { delta: d, irrUnlevered: kpi.irrUnlevered, irrLevered: kpi.irrLevered, npvUnlevered: kpi.npvUnlevered, dscrMin: kpi.dscrMin };
  })]));
}

module.exports = { DEFAULTS, PRICE_CURVE, sensitivity, cashflows, buyRevampSell, portfolioYear, irr, npv, npvExcel, payback, wacc };
