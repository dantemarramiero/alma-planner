// Storico ANAC (21/11/2026): i file mensili esistono solo da aprile 2026 (con dentro anche gennaio–marzo 2026); prima ANAC
// pubblica un file unico per dataset con tutto fino a dicembre 2025 (aggiudicazioni, categorie-opera, aggiudicatari) e i
// CIG in un pacchetto per anno, un file per mese di pubblicazione (cig-2025/cig_csv_2025_01.zip…). Qui si riempiono i
// mesi della finestra che i file mensili non coprono.
// Ordine pensato per la memoria (il file delle aggiudicazioni ha 4,8 milioni di righe):
//  1. aggiudicazioni: solo l'insieme dei CIG aggiudicati nei mesi voluti, sopra l'importo minimo
//  2. categorie-opera: la categoria prevalente di quei CIG, se è una delle nostre (senza regole CPV si scartano gli altri)
//  3. file CIG, dal mese più recente all'indietro (fino a 24 mesi prima): luogo, ente, CPV; si tengono solo le nostre
//  4. aggiudicazioni di nuovo: importo, ribasso, offerenti, criterio delle gare tenute
//  5. aggiudicatari: chi ha vinto
// Gira nel worker (lib/crm-anac-worker.js); il database lo scrive il server.

const A = require('./crm-anac');

const BASE = 'https://dati.anticorruzione.it/opendata';
const fullUrl = ds => `${BASE}/download/dataset/${ds}/filesystem/${ds}_csv.zip`;
const cigUrl = m => `${BASE}/download/dataset/cig-${m.slice(0, 4)}/filesystem/cig_csv_${m.slice(0, 4)}_${m.slice(4)}.zip`;
const ym = d => (d ? d.slice(0, 7).replace('-', '') : '');
const addMonths = (m, n) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(4)) - 1 + n, 1)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
function monthsBetween(from, to) { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; }

// Ultimo mese del file unico: quello prima della sua data di aggiornamento (es. 15/01/2026 → 202512). null = non si sa.
async function historyEnd({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${BASE}/api/3/action/package_show?id=aggiudicazioni`, { headers: { 'User-Agent': A.UA, Accept: '*/*' } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const full = (data?.result?.resources || []).find(r => r.name === 'aggiudicazioni_csv');
  const mod = full && /^\d{4}-\d{2}/.test(String(full.last_modified || '')) ? String(full.last_modified) : null;
  return mod ? addMonths(ym(mod), -1) : null;
}

async function collectHistory(settings, { from, to, initiativeCats = [], log = () => {}, fetchImpl = fetch, lookback = 24 } = {}) {
  const rules = A.keepRules(settings, initiativeCats);
  const inside = d => { const m = ym(d); return m >= from && m <= to; };
  const awardDay = r => A.date(r.data_aggiudicazione_definitiva) || A.date(r.data_comunicazione_esito);
  const won = r => String(r.esito || '').toUpperCase() === 'AGGIUDICATA';

  const want = new Set();
  for await (const r of A.fetchRows(fullUrl('aggiudicazioni'), { fetchImpl })) {
    if (!won(r) || !inside(awardDay(r))) continue;
    const amt = A.num(r.importo_aggiudicazione);
    if (amt !== null && amt < rules.min) continue;
    const cig = String(r.cig || '').toUpperCase();
    if (cig) want.add(cig);
  }
  log(`storico ${from}–${to}: ${want.size} aggiudicazioni`);

  const cat = new Map();
  const sec = new Map(); // categorie scorporabili (tipo diverso da P) dei CIG voluti
  for await (const r of A.fetchRows(fullUrl('categorie-opera'), { fetchImpl, quick: c => want.has(c) })) {
    const cig = String(r.cig).toUpperCase();
    if (r.cod_tipo_categoria !== 'P') { (sec.get(cig) || sec.set(cig, []).get(cig)).push(A.normCat(r.id_categoria)); continue; }
    const c = A.normCat(r.id_categoria);
    if (rules.cats.has(c)) cat.set(cig, c);
  }
  if (!rules.cpv.length) for (const c of want) if (!cat.has(c)) want.delete(c);
  log(`storico: ${cat.size} nelle categorie, ${want.size} da cercare nei file CIG`);

  const aw = new Map();
  for (const m of monthsBetween(addMonths(from, -lookback), to).reverse()) {
    if (!want.size) break;
    let n = 0;
    try {
      for await (const r of A.fetchRows(cigUrl(m), { fetchImpl, quick: c => want.has(c) })) {
        const cig = String(r.cig || '').toUpperCase();
        if (!want.has(cig)) continue;
        want.delete(cig);
        const category = cat.get(cig) || '', cpv = String(r.cod_cpv || '').replace(/\D/g, '');
        if (!(rules.cats.has(category) || rules.cpv.some(p => cpv.startsWith(p)))) continue;
        aw.set(cig, { cig, category, cats_sec: [...new Set((sec.get(cig) || []).filter(x => x && x !== category))], cpv, object: String(r.oggetto_lotto || r.oggetto_gara || '').slice(0, 500), sa_cf: String(r.cf_amministrazione_appaltante || ''),
          sa_name: String(r.denominazione_amministrazione_appaltante || '').slice(0, 300), province: A.titleCase(r.provincia || ''), region: A.regionOf(r.sezione_regionale, r.provincia),
          kind: String(r.oggetto_principale_contratto || '').toUpperCase().slice(0, 20), base_amount: A.num(r.importo_lotto), published_on: A.date(r.data_pubblicazione),
          pnrr: String(r.flag_pnrr_pnc) === '1', winners: [] });
        n++;
      }
      log(`storico: CIG ${m} → ${n} tenute (restano ${want.size})`);
    } catch (e) { log(`storico: file CIG ${m} non letto (${e.message})`); }
  }
  want.clear();
  cat.clear();
  sec.clear();

  for await (const r of A.fetchRows(fullUrl('aggiudicazioni'), { fetchImpl, quick: c => aw.has(c) })) {
    const a = aw.get(String(r.cig || '').toUpperCase());
    if (!a || !won(r)) continue;
    const day = awardDay(r);
    if (!inside(day) || (a.awarded_on && a.awarded_on > day)) continue;
    Object.assign(a, { awarded_on: day, amount: A.num(r.importo_aggiudicazione), discount: A.num(r.ribasso_aggiudicazione),
      bidders: A.num(r.num_imprese_offerenti) ?? A.num(r.numero_offerte_ammesse), criterion: A.criterionOf(r.criterio_aggiudicazione),
      subcontract: String(r.flag_subappalto).toLowerCase() === 'true' });
  }
  for (const [cig, a] of aw) if (!a.awarded_on || !A.keeps(rules, a)) aw.delete(cig);
  log(`storico: ${aw.size} da tenere`);

  for await (const r of A.fetchRows(fullUrl('aggiudicatari'), { fetchImpl, quick: c => aw.has(c) })) {
    const a = aw.get(String(r.cig || '').toUpperCase());
    if (a) A.addWinner(a, r);
  }
  await A.addExtras(aw, fullUrl, { fetchImpl, log, label: 'storico' });
  return { rows: [...aw.values()], cats: [...rules.cats].sort() };
}

module.exports = { collectHistory, historyEnd, monthsBetween, addMonths, cigUrl, fullUrl };
