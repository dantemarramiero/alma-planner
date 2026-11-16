// Vinte e perse (Dante 16/11/2026, canvas «v3 · Vinte e perse»): dagli esiti il CRM impara cosa vinciamo.
// Probabilità di vittoria spiegabile: si parte dal win ratio della BU e si aggiunge l'effetto di ogni caratteristica
// (contatto caldo, provenienza, tipo di ente, fascia d'importo), ognuna «tirata» verso la media quanto meno esiti ha.
// Con BOSS gli esiti arriveranno da soli e la stima migliora senza cambiare niente qui.

const ESITI_DEFAULT = {
  reasons: ['Prezzo', 'Requisiti tecnici o SOA', 'Offerta tecnica debole', 'Tempi troppo stretti', 'Il cliente aveva già un fornitore', 'Esclusi per documenti', 'Altro'],
  alert_days: 30,         // dopo quanti giorni dalla scadenza un esito che manca diventa «da registrare» col «!»
  prob_on: true,
  prob_min: 15,           // esiti minimi della BU prima di mostrare un numero («in apprendimento» sotto)
  months: 24,             // esiti usati per imparare
  boss_on: false,         // si accende con l'integrazione BOSS
};
const ORIGINS = { radar: 'Radar', gare: 'Ufficio gare', cliente: 'Cliente che ci chiama', relazione: 'Rapporto personale', business: 'Nuovi business', altro: 'Altro' };
const ENTITY = { ente_pubblico: 'Enti pubblici', partecipata: 'Partecipate e utilities', consorzio: 'Consorzi', impresa: 'Imprese private', professionista: 'Professionisti', condominio: 'Condomini', altro: 'Altri' };
const bandOf = amount => (amount == null || amount === '' ? '' : Number(amount) < 1e6 ? 'sotto 1 M€' : Number(amount) <= 5e6 ? 'da 1 a 5 M€' : 'oltre 5 M€');

const PRIOR = 4; // quanto pesa la media quando gli esiti sono pochi
const logit = p => Math.log(p / (1 - p));
const sigm = x => 1 / (1 + Math.exp(-x));
const clampP = p => Math.min(0.95, Math.max(0.03, p));
const rate = (won, n, base) => clampP((won + PRIOR * base) / (n + PRIOR));

// caratteristiche di un esito o di un segnale
function featuresOf(x) {
  return {
    warm: x.warm === true ? 'caldo' : x.warm === false ? 'freddo' : '',
    origin: x.origin || '',
    entity: x.entity_kind || '',
    band: bandOf(x.amount),
  };
}
const FEATURE_LABEL = {
  warm: v => (v === 'caldo' ? 'Contatto caldo' : 'Senza contatto caldo'),
  origin: v => `Da: ${(ORIGINS[v] || v).toLowerCase()}`,
  entity: v => ENTITY[v] || v,
  band: v => `Importo ${v}`,
};

// outcomes: solo vinta/persa. Ritorna { learning, have, need, p, base, steps: [{ label, delta, note }] }
function probability(outcomes, item, { prob_min = ESITI_DEFAULT.prob_min } = {}) {
  const bids = outcomes.filter(o => o.result === 'vinta' || o.result === 'persa');
  const won = list => list.filter(o => o.result === 'vinta').length;
  const all = bids.length;
  const global = all ? clampP((won(bids) + 1) / (all + 2)) : 0.25;
  const mine = bids.filter(o => o.bu === item.bu);
  if (mine.length < prob_min) return { learning: true, have: mine.length, need: prob_min };
  const base = rate(won(mine), mine.length, global);
  const steps = [{ label: `Partenza: la BU vince`, value: base, note: `${won(mine)} su ${mine.length}` }];
  let x = logit(base);
  let p = base;
  const f = featuresOf(item);
  for (const k of ['warm', 'origin', 'entity', 'band']) {
    if (!f[k]) continue;
    const same = bids.filter(o => featuresOf(o)[k] === f[k]);
    if (same.length < 3) continue; // troppo pochi per dire qualcosa
    const r = rate(won(same), same.length, global);
    x += logit(r) - logit(global);
    const next = clampP(sigm(x));
    steps.push({ label: FEATURE_LABEL[k](f[k]), delta: Math.round((next - p) * 100), note: `${won(same)} su ${same.length}` });
    p = next;
  }
  return { learning: false, p: Math.round(p * 100), base: Math.round(base * 100), steps };
}

// numeri della pagina «Vinte e perse»
function stats(outcomes, { buLabel = k => k } = {}) {
  const bids = outcomes.filter(o => o.result === 'vinta' || o.result === 'persa');
  const won = bids.filter(o => o.result === 'vinta');
  const sum = list => list.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const avg = list => (list.length ? Math.round((list.reduce((s, n) => s + n, 0) / list.length) * 10) / 10 : null);
  const ratio = list => (list.length ? Math.round((100 * list.filter(o => o.result === 'vinta').length) / list.length) : null);
  const group = (key, label) => {
    const m = new Map();
    for (const o of bids) { const k = key(o); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    return [...m.entries()].map(([k, list]) => ({ key: k, label: label(k), won: list.filter(o => o.result === 'vinta').length, total: list.length, ratio: ratio(list) }))
      .sort((a, b) => b.total - a.total);
  };
  const lost = bids.filter(o => o.result === 'persa');
  const winners = new Map();
  for (const o of lost) {
    const name = o.winner_display || o.winner_name;
    if (!name) continue;
    const k = o.winner_subject_id ? `s${o.winner_subject_id}` : name.toLowerCase();
    if (!winners.has(k)) winners.set(k, { name, subject_id: o.winner_subject_id || null, bus: new Set(), times: 0, discounts: [] });
    const w = winners.get(k);
    w.times++;
    if (o.bu) w.bus.add(buLabel(o.bu));
    if (o.winner_discount != null) w.discounts.push(Number(o.winner_discount));
  }
  return {
    ratio: ratio(bids), won: won.length, lost: lost.length, skipped: outcomes.filter(o => o.result === 'non_partecipato').length,
    value_won: sum(won), value_bid: sum(bids),
    winner_discount: avg(won.map(o => o.our_discount).filter(n => n != null).map(Number).concat(lost.map(o => o.winner_discount).filter(n => n != null).map(Number))),
    our_discount: avg(bids.map(o => o.our_discount).filter(n => n != null).map(Number)),
    by: {
      warm: group(o => featuresOf(o).warm, v => (v === 'caldo' ? 'Con contatto caldo' : 'Senza contatto')),
      bu: group(o => o.bu, buLabel),
      origin: group(o => o.origin, v => ORIGINS[v] || v),
      entity: group(o => o.entity_kind, v => ENTITY[v] || v),
      band: group(o => bandOf(o.amount), v => v),
      reason: (() => { const m = new Map(); for (const o of lost) if (o.reason) m.set(o.reason, (m.get(o.reason) || 0) + 1); return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); })(),
    },
    winners: [...winners.values()].map(w => ({ name: w.name, subject_id: w.subject_id, bus: [...w.bus], times: w.times, discount: avg(w.discounts) })).sort((a, b) => b.times - a.times).slice(0, 8),
  };
}

module.exports = { ESITI_DEFAULT, ORIGINS, ENTITY, bandOf, featuresOf, probability, stats };
