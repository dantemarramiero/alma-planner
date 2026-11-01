// Scenari del simulatore di Alma Energy, sopra il motore dei flussi (energy-sim.js).
// - FV classico (ALM2-6): le tre varianti del BusinessPlan fotovoltaico (solo sviluppo a RTB, costruisci e vendi,
//   costruisci e gestisci), quota Almacis sui tre anni, più il rendimento a 25 anni degli impianti tenuti.
// - Revamping / Repowering (ALM2-7): rivendita dopo il revamping (linea Buy-Revamp-Sell) o gestione (flussi a 30 anni
//   con l'incentivo del Conto Energia fino a scadenza sulla produzione dell'impianto di partenza).
// - PPA on-site su tetto (ALM2-8): taglia dal tetto come nello screening, prezzo PPA sull'energia consumata dal
//   cliente e ritiro dell'energia immessa, canone del tetto, risparmio del cliente.
const { cashflows, buyRevampSell, sensitivity, irr, payback, DEFAULTS, PRICE_CURVE } = require('./energy-sim');

const sum = a => a.reduce((s, x) => s + x, 0);

// ── FV classico ───────────────────────────────────────────────────────────────────────────────
// Parametri del foglio «Parametri» del BusinessPlan_Almacis_Fotovoltaico.xlsx.
const FV_DEFAULTS = Object.freeze({
  share: 0.38, // quota Almacis nella SPV
  projectsYear1: 8, mwpPerProject: 10, growthYear2: 0.3, growthYear3: 0.2, rtbRate: 0.8,
  devFundPerMwp: 4000, connectionPerMwp: 10000, landDepositPerMwp: 2500,
  callPricePerMwp: 120000, thirdPartyPricePerMwp: 120000, thirdPartyShare: 0.5,
  buildShareB: 0.5, epcPerMwpB: 700000, salePerMwpB: 1100000,
  buildShareC: 0.5, epcPerMwpC: 700000, revenuePerMwpC: 80000, omPerMwpC: 15000,
  holdYearsC: 25,
});

function fvClassico(input = {}) {
  const a = { ...FV_DEFAULTS, ...input };
  // progetti avviati per anno; il foglio ha un errore (anni 2 e 3 sempre a zero), qui la crescita si applica davvero
  const projects = [a.projectsYear1];
  projects.push(projects[0] * (1 + a.growthYear2));
  projects.push(projects[1] * (1 + a.growthYear3));
  const pipeline = projects.map(p => {
    const mwp = p * a.mwpPerProject;
    const rtb = mwp * a.rtbRate;
    return { projects: p, mwp, rtb, failed: mwp - rtb };
  });
  const devCosts = y => ({
    fund: y.mwp * a.devFundPerMwp, connection: y.mwp * a.connectionPerMwp, deposits: y.mwp * a.landDepositPerMwp,
  });
  // quota Almacis di costi e ricavi comuni a tutte le varianti
  const common = y => {
    const c = devCosts(y);
    return {
      outflow: (c.fund + c.connection + c.deposits) * a.share,
      atRisk: c.fund * a.share,
      refunds: y.rtb * a.connectionPerMwp * a.share + y.failed * a.landDepositPerMwp * (1 - a.share),
    };
  };

  const variant = (key, yearFn) => {
    let portfolio = 0;
    const years = pipeline.map((y, i) => {
      const base = common(y);
      const v = yearFn(y, i, portfolio);
      portfolio = v.portfolio ?? portfolio;
      const outflow = base.outflow + (v.epc || 0);
      const revenue = base.refunds + v.revenue;
      return { year: i + 1, ...y, outflow, revenue, net: revenue - outflow, atRisk: base.atRisk, built: v.built || 0, portfolio };
    });
    const outflow = sum(years.map(y => y.outflow));
    const revenue = sum(years.map(y => y.revenue));
    return {
      key, years,
      totals: {
        mwp: sum(years.map(y => y.mwp)), rtb: sum(years.map(y => y.rtb)), outflow, revenue, net: revenue - outflow,
        roi: outflow ? (revenue - outflow) / outflow : null, atRisk: sum(years.map(y => y.atRisk)), built: sum(years.map(y => y.built)),
      },
    };
  };

  const A = variant('A', y => ({
    revenue: (y.rtb * (1 - a.thirdPartyShare) * a.callPricePerMwp + y.rtb * a.thirdPartyShare * a.thirdPartyPricePerMwp) * a.share,
  }));
  const B = variant('B', y => {
    const built = y.rtb * a.buildShareB;
    return {
      built,
      epc: built * a.epcPerMwpB * a.share,
      revenue: (built * a.salePerMwpB + y.rtb * (1 - a.buildShareB) * a.callPricePerMwp) * a.share,
    };
  });
  const C = variant('C', (y, _i, portfolio) => {
    const built = y.rtb * a.buildShareC;
    const owned = portfolio + built; // i MWp gestiti si sommano anno dopo anno
    return {
      built, portfolio: owned,
      epc: built * a.epcPerMwpC * a.share,
      revenue: owned * (a.revenuePerMwpC - a.omPerMwpC) * a.share + y.rtb * (1 - a.buildShareC) * a.callPricePerMwp * a.share,
    };
  });
  // la gestione si giudica sul lungo periodo: flussi della quota Almacis degli impianti costruiti nel primo anno
  const mw1 = C.years[0].built;
  const flowsC = [-mw1 * a.epcPerMwpC * a.share, ...Array.from({ length: a.holdYearsC }, () => mw1 * (a.revenuePerMwpC - a.omPerMwpC) * a.share)];
  C.longTerm = { years: a.holdYearsC, irr: irr(flowsC), payback: payback(flowsC), cashTotal: sum(flowsC) };

  return { model: 'fv_classico', inputs: a, variants: { A, B, C } };
}

// ── Revamping / Repowering ─────────────────────────────────────────────────────────────────────
const REVAMPING_DEFAULTS = Object.freeze({
  sizeMw: 2.5, purchasePerMw: 550000, revampPerMw: 300000, sizeIncreaseMw: 0.75, resalePerMw: 1150000, cycleMonths: 12,
  incentivePerKwh: 0, // tariffa del Conto Energia sulla produzione dell'impianto di partenza
  incentiveAnnual: 0, // in alternativa: incasso GSE all'anno (dal Database CE), che scende con il decalage
  incentiveYearsLeft: 0,
});

function revamping(input = {}) {
  const a = { ...DEFAULTS, ...REVAMPING_DEFAULTS, ...input };
  const sizeAfter = a.sizeMw + a.sizeIncreaseMw;
  const capex = { acquisto: a.sizeMw * a.purchasePerMw, revamping: sizeAfter * a.revampPerMw };
  // l'incentivo resta quello dell'impianto di partenza: l'energia in più del repowering va solo a mercato
  const incentive = (t, row) => {
    if (t > a.incentiveYearsLeft) return 0;
    if (a.incentiveAnnual) return a.incentiveAnnual * (1 - a.decalage) ** (t - 1);
    return a.sizeMw * row.hours * 1000 * a.incentivePerKwh;
  };
  const engineInput = { ...pickEngine(a), sizeMw: sizeAfter, capex, extraRevenue: incentive };
  const gestione = cashflows(engineInput);
  const rivendita = buyRevampSell({
    sizeMw: a.sizeMw, purchasePerMw: a.purchasePerMw, revampPerMw: a.revampPerMw, sizeIncreaseMw: a.sizeIncreaseMw,
    resalePerMw: a.resalePerMw, leverage: a.leverage, kd: a.kd, cycleMonths: a.cycleMonths, ires: a.ires, irap: a.irap,
  });
  return {
    model: 'revamping', inputs: { ...a, extraRevenue: undefined, prices: undefined }, sizeAfter,
    rivendita, gestione,
    // confronto sulla stessa equity: utile del ciclo di rivendita contro valore attuale della cassa in gestione
    confronto: {
      equity: rivendita.kpi.equity,
      rivenditaUtile: rivendita.kpi.netIncome, rivenditaRoe: rivendita.kpi.roe,
      gestioneVan: gestione.kpi.npvLevered, gestioneIrr: gestione.kpi.irrLevered,
      meglio: gestione.kpi.npvLevered > rivendita.kpi.netIncome ? 'gestione' : 'rivendita',
    },
    sensitivity: sensitivity(engineInput),
  };
}

// ── PPA on-site su tetto ───────────────────────────────────────────────────────────────────────
// Ipotesi del foglio «Ipotesi» dello screening dei tetti, più i termini del contratto.
const PPA_DEFAULTS = Object.freeze({
  roofArea: 10000, usableShare: 0.6, kwpPerM2: 0.2, kwhPerKwp: 1300, epcPerKwp: 750,
  ppaPrice: 100, // €/MWh pagati dal cliente sull'energia che consuma
  ppaIndexation: 0.02, // aumento annuo del prezzo PPA
  selfConsumption: 0.8, // quota della produzione consumata dal cliente
  exportPrice: 70, // €/MWh dell'energia immessa in rete (ritiro dedicato o mercato), a prezzi dell'anno 0
  billPrice: 140, // €/MWh che il cliente paga oggi in bolletta, per il risparmio
  roofRent: 0, // canone del diritto di superficie, € all'anno
  omPerKwp: 16, // O&M e assicurazione, €/kWp all'anno
  years: 20, // durata del contratto
  residualValue: 0, // cessione al cliente a fine contratto (€), 0 = rimozione o rinnovo
});

function ppaOnsite(input = {}) {
  const a = { ...DEFAULTS, ...PPA_DEFAULTS, ...input };
  const kwp = a.kwp ?? a.roofArea * a.usableShare * a.kwpPerM2;
  const sizeMw = kwp / 1000;
  const energy1 = kwp * a.kwhPerKwp / 1000; // MWh del primo anno
  // prezzo medio dell'energia per anno, riportato a prezzi dell'anno 0 (il motore applica l'inflazione)
  const prices = Array.from({ length: a.years }, (_, i) => {
    const t = i + 1;
    const ppa = a.ppaPrice * (1 + a.ppaIndexation) ** (t - 1);
    const exp = a.exportPrice * (1 + a.inflation) ** t;
    return (a.selfConsumption * ppa + (1 - a.selfConsumption) * exp) / (1 + a.inflation) ** t;
  });
  const engineInput = {
    ...pickEngine(a), sizeMw, hours: a.kwhPerKwp, prices, years: a.years,
    capex: { epc: kwp * a.epcPerKwp },
    opexPerMw: a.omPerKwp * 1000 + (sizeMw ? a.roofRent / sizeMw : 0),
    extraRevenue: (t) => (t === a.years ? a.residualValue : 0),
    depreciationYears: Math.min(a.depreciationYears, a.years),
    debtYears: Math.min(a.debtYears, a.years),
  };
  const flows = cashflows(engineInput);
  const selfMwh1 = energy1 * a.selfConsumption;
  const saving1 = selfMwh1 * (a.billPrice - a.ppaPrice);
  return {
    model: 'ppa_onsite', inputs: { ...a, prices: undefined },
    plant: { kwp, sizeMw, energy1, capex: kwp * a.epcPerKwp, revenue1: flows.rows[1]?.revenue ?? 0 },
    customer: {
      selfMwh1, saving1,
      savingTotal: sum(Array.from({ length: a.years }, (_, i) => selfMwh1 * (1 - a.decalage) ** i
        * (a.billPrice * (1 + a.inflation) ** (i + 1) - a.ppaPrice * (1 + a.ppaIndexation) ** i))),
    },
    flows,
    sensitivity: sensitivity(engineInput),
  };
}

// Ipotesi del motore che uno scenario può cambiare.
const ENGINE_KEYS = ['years', 'startYear', 'hours', 'decalage', 'inflation', 'opexPerMw', 'depreciationYears', 'debtYears', 'leverage', 'kd', 'ke', 'ires', 'irap', 'price', 'prices'];
const pickEngine = a => Object.fromEntries(ENGINE_KEYS.filter(k => a[k] !== undefined).map(k => [k, a[k]]));

// Calcolo di uno scenario salvato o da salvare, e i numeri che servono nell'elenco e sull'opportunità.
function runScenario(model, input) {
  if (model === 'fv_classico') return fvClassico(input);
  if (model === 'revamping') return revamping(input);
  if (model === 'ppa_onsite') return ppaOnsite(input);
  throw new Error(`Scenario sconosciuto: ${model}`);
}

function summaryOf(result) {
  if (result.model === 'fv_classico') {
    const { A, B, C } = result.variants;
    return {
      mw: A.totals.rtb, capex: B.totals.outflow,
      roiA: A.totals.roi, roiB: B.totals.roi, roiC: C.totals.roi, netA: A.totals.net, netB: B.totals.net, netC: C.totals.net,
      irrC25: C.longTerm.irr, atRisk: A.totals.atRisk,
    };
  }
  if (result.model === 'revamping') {
    return {
      mw: result.sizeAfter, capex: result.gestione.kpi.capex, irr: result.gestione.kpi.irrLevered, irrUnlevered: result.gestione.kpi.irrUnlevered,
      npv: result.gestione.kpi.npvLevered, dscrMin: result.gestione.kpi.dscrMin, roeRivendita: result.rivendita.kpi.roe,
      utileRivendita: result.rivendita.kpi.netIncome, meglio: result.confronto.meglio,
    };
  }
  const k = result.flows.kpi;
  return {
    mw: result.plant.sizeMw, capex: result.plant.capex, irr: k.irrLevered, irrUnlevered: k.irrUnlevered, npv: k.npvLevered,
    payback: k.paybackUnlevered, dscrMin: k.dscrMin, lcoe: k.lcoe, saving1: result.customer.saving1,
  };
}

module.exports = { fvClassico, revamping, ppaOnsite, runScenario, summaryOf, FV_DEFAULTS, REVAMPING_DEFAULTS, PPA_DEFAULTS, PRICE_CURVE };
