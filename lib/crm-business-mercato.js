// Nuovi business · Mappa del mercato (Dante 20/11/2026, canvas «Nuovi business · Mappa del mercato»).
// Dalle gare ANAC già caricate dal CRM (crm_anac_awards, migrazione 055, sola lettura): chi vince le gare simili alle
// nostre nelle categorie SOA e nelle zone del profilo dell'iniziativa, con che ribasso, con chi in ATI, chi compra
// e dove. Stessi criteri della pagina Concorrenza: «ribasso tipico» = mediana delle gare con almeno 2 offerenti e un
// ribasso vero (sopra 0 e sotto 70%); importo minimo = quello delle impostazioni della concorrenza.
const { normCat } = require('./crm-anac');
const { linkSubjects, isOurs } = require('./crm-concorrenza');

// fasce d'importo del canvas (lotti di reti e impianti: più piccoli di quelli delle BU)
const BANDS = [['< 500.000 €', 0, 5e5], ['0,5 – 2 M€', 5e5, 2e6], ['> 2 M€', 2e6, null]];
const REAL = 'a.bidders >= 2 AND a.discount > 0 AND a.discount < 70';
const AMT = 'COALESCE(a.amount, a.base_amount)';

const catsOf = i => [...new Set((i.profile?.soa || []).map(normCat).filter(c => /^O[GS]\d/.test(c)))];
const regionsOf = i => (i.profile?.regions || []).map(r => String(r).trim()).filter(Boolean);

// WHERE del perimetro dell'iniziativa: { sql, params }
function scopeOf(settings, i, { months = 12, cats = null, province = '', withProvince = true } = {}) {
  const all = catsOf(i);
  const use = cats && cats.length ? all.filter(c => cats.includes(c)) : all;
  const regs = regionsOf(i);
  const params = [];
  const add = x => { params.push(x); return `$${params.length}`; };
  const where = [`a.awarded_on >= CURRENT_DATE - (${add(String(months))} || ' months')::interval`, `a.category = ANY(${add(use)}::text[])`];
  if (regs.length) where.push(`lower(a.region) = ANY(${add(regs.map(r => r.toLowerCase()))}::text[])`);
  if (province && withProvince) where.push(`lower(a.province) = lower(${add(province)})`);
  const min = Number(settings.concorrenza?.min_amount) || 0;
  if (min) where.push(`${AMT} >= ${add(min)}`);
  return { sql: where.join(' AND '), params, cats: use, all, regions: regs };
}

// quali categorie sono già caricate: solo dalla copertura del CRM (lib/crm-anac categoryCoverage, sessione CRM 20/11);
// «pending» = in arrivo con il caricamento della notte
async function coverage(db) {
  const { loadSettings } = require('./crm-commerciale');
  const { categoryCoverage } = require('./crm-anac');
  return categoryCoverage(db, await loadSettings(db));
}
async function loadedCats(db, cats) {
  if (!cats.length) return [];
  const cov = await coverage(db);
  return cats.filter(c => cov.loaded.includes(c));
}

async function dataState(db, i) {
  const all = catsOf(i);
  const cov = await coverage(db);
  let running = false;
  try { running = require('./crm-anac').isRunning(); } catch { running = false; }
  const loaded = all.filter(c => cov.loaded.includes(c));
  return { categories: all, loaded, missing: all.filter(c => !loaded.includes(c)), month: cov.window.at(-1) || null, months: cov.window.length, running };
}

const subjRole = s => (!s ? '' : s.roles?.includes('partner') ? 'partner' : s.roles?.includes('fornitore') ? 'fornitore' : s.roles?.includes('concorrente') ? 'concorrente'
  : s.roles?.includes('cliente') ? 'cliente' : s.roles?.includes('lead') ? 'lead' : '');

// la tab Mercato
async function market(db, settings, i, opts = {}) {
  const s = scopeOf(settings, i, opts);
  const all = scopeOf(settings, i, { ...opts, withProvince: false }); // «Dove» mostra tutte le province per poter cambiare
  const state = await dataState(db, i);
  if (!s.cats.length) return { state, scope: scopeInfo(s, opts), empty: true };
  const q = (sql, sc = s) => db.query(sql, sc.params).then(r => r.rows);
  const [[k], [real], winners, buyers, where, bands, rows] = await Promise.all([
    q(`SELECT count(*)::int AS gare, COALESCE(sum(${AMT}), 0)::float AS valore FROM crm_anac_awards a WHERE ${s.sql}`),
    q(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bidders)::float AS offerenti
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL}`),
    q(`SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, sum(${AMT})::float AS valore,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount) FILTER (WHERE ${REAL})::float AS ribasso,
              count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1)::int AS in_ati,
              count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1 AND w->>'role' = 'mandataria')::int AS mandataria,
              array_agg(DISTINCT a.category) AS categorie, (array_agg(DISTINCT a.province) FILTER (WHERE a.province <> ''))[1:3] AS province
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND jsonb_array_length(a.winners) <= 8
        GROUP BY 1 ORDER BY vinte DESC, valore DESC LIMIT 40`),
    q(`SELECT a.sa_cf, max(a.sa_name) AS name, count(*)::int AS gare, COALESCE(sum(${AMT}), 0)::float AS valore, max(a.awarded_on) AS ultima
         FROM crm_anac_awards a WHERE ${s.sql} AND a.sa_name <> '' GROUP BY 1 ORDER BY gare DESC, valore DESC LIMIT 6`),
    q(`SELECT a.region, a.province, count(*)::int AS gare FROM crm_anac_awards a WHERE ${all.sql} AND a.province <> '' GROUP BY 1, 2 ORDER BY 1, 3 DESC`, all),
    q(`SELECT CASE ${BANDS.map(([, lo, hi], n) => `WHEN ${AMT} >= ${lo}${hi ? ` AND ${AMT} < ${hi}` : ''} THEN ${n}`).join(' ')} END AS band, count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL} GROUP BY 1`),
    q(`SELECT a.winners FROM crm_anac_awards a WHERE ${s.sql}`),
  ]);
  // Almacis e le imprese del gruppo: riga a parte
  let noi = 0;
  for (const r of rows) if (isOurs(settings, r.winners)) noi++;
  const imprese = new Set(rows.flatMap(r => (r.winners || []).map(w => w.cf || w.name))).size;
  for (const w of winners) w.ours = isOurs(settings, [w]);
  const others = winners.filter(w => !w.ours);
  const ours = winners.find(w => w.ours) || null;
  // con chi va in ATI: i compagni più frequenti delle prime imprese
  const top = others.slice(0, 12);
  if (top.length) {
    const { rows: pairs } = await db.query(
      `SELECT w1->>'cf' AS cf, max(w2->>'name') AS partner, count(*)::int AS n
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w1, jsonb_array_elements(a.winners) w2
        WHERE ${s.sql} AND jsonb_array_length(a.winners) BETWEEN 2 AND 8 AND (w1->>'cf') = ANY($${s.params.length + 1}::text[]) AND (w2->>'cf') <> (w1->>'cf')
        GROUP BY 1, w2->>'cf' ORDER BY n DESC`, [...s.params, top.map(w => w.cf)]);
    for (const w of top) w.partners = pairs.filter(p => p.cf === w.cf).slice(0, 2).map(p => p.partner);
  }
  await linkSubjects(db, top);
  for (const w of top) w.role = subjRole(w.subject);
  // stazioni appaltanti già tra i clienti target dell'iniziativa
  const { rows: tg } = await db.query(`SELECT lower(t.name) AS n, lower(COALESCE(s.name, '')) AS s FROM crm_initiative_targets t LEFT JOIN crm_subjects s ON s.id = t.subject_id WHERE t.initiative_id = $1`, [i.id]);
  for (const b of buyers) b.target = tg.some(t => t.n === b.name.toLowerCase() || t.s === b.name.toLowerCase());
  // dove: province raggruppate per regione
  const regions = [];
  for (const r of where) {
    let g = regions.find(x => x.region === r.region);
    if (!g) { g = { region: r.region, provinces: [] }; regions.push(g); }
    g.provinces.push({ province: r.province, gare: r.gare });
  }
  return {
    state, scope: scopeInfo(s, opts),
    kpi: { gare: k.gare, valore: k.valore, ribasso: real.med, ribasso_n: real.n, p25: real.p25, p75: real.p75, offerenti: real.offerenti, imprese, noi },
    winners: top, more: Math.max(0, others.length - top.length), ours: ours ? { ...ours } : null,
    buyers: buyers.map(b => ({ ...b, ultima: b.ultima ? String(b.ultima instanceof Date ? b.ultima.toISOString() : b.ultima).slice(0, 10) : null })),
    where: regions,
    bands: BANDS.map(([label], n) => { const b = bands.find(x => x.band === n); return { label, n: b?.n || 0, med: b?.med ?? null, p25: b?.p25 ?? null, p75: b?.p75 ?? null }; }),
    synergies: top.filter(w => ['partner', 'fornitore', 'cliente'].includes(w.role)).slice(0, 4),
  };
}
const scopeInfo = (s, opts) => ({ categories: s.cats, all: s.all, regions: s.regions, province: opts.province || '', months: Number(opts.months || 12) });

// ricerca: imprese che vincono nelle categorie e zone dell'iniziativa
async function searchCompanies(db, settings, i, text, opts = {}) {
  const s = scopeOf(settings, i, { ...opts, withProvince: false });
  if (!s.cats.length || String(text || '').trim().length < 2) return [];
  const { rows } = await db.query(
    `SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1)::int AS in_ati,
            (array_agg(DISTINCT a.province) FILTER (WHERE a.province <> ''))[1:2] AS province
       FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND (w->>'name') ILIKE $${s.params.length + 1}
      GROUP BY 1 ORDER BY vinte DESC LIMIT 8`, [...s.params, `%${String(text).trim()}%`]);
  await linkSubjects(db, rows);
  for (const r of rows) r.role = subjRole(r.subject);
  return rows;
}

// scheda di mercato di un'impresa (riquadro laterale)
async function company(db, settings, i, { cf = '', name = '' }, opts = {}) {
  const s = scopeOf(settings, i, { ...opts, withProvince: false });
  const n = s.params.length;
  const who = cf ? `(w->>'cf') = $${n + 1}` : `lower(w->>'name') = lower($${n + 1})`;
  const key = cf || name;
  const q = sql => db.query(sql, [...s.params, key]).then(r => r.rows);
  const [[k], tenders, partners, buyers, [market]] = await Promise.all([
    q(`SELECT count(*)::int AS vinte, COALESCE(sum(${AMT}), 0)::float AS valore, avg(a.discount) FILTER (WHERE ${REAL})::float AS ribasso, avg(a.bidders)::float AS offerenti,
              count(*) FILTER (WHERE jsonb_array_length(a.winners) = 1)::int AS sola, max(w->>'name') AS name, max(w->>'cf') AS cf,
              array_agg(DISTINCT a.category) AS categorie, (array_agg(DISTINCT a.province) FILTER (WHERE a.province <> ''))[1:3] AS province
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND ${who}`),
    q(`SELECT a.cig, a.object, a.awarded_on, ${AMT}::float AS amount, a.discount::float AS discount, a.sa_name, a.category, jsonb_array_length(a.winners) > 1 AS ati, w->>'role' AS role
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND ${who} ORDER BY a.awarded_on DESC NULLS LAST LIMIT 8`),
    q(`SELECT w2->>'cf' AS cf, max(w2->>'name') AS name, count(*)::int AS n, max(w->>'role') AS role
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w, jsonb_array_elements(a.winners) w2
        WHERE ${s.sql} AND ${who} AND jsonb_array_length(a.winners) BETWEEN 2 AND 8 AND (w2->>'cf') <> (w->>'cf') GROUP BY 1 ORDER BY n DESC LIMIT 4`),
    q(`SELECT max(a.sa_name) AS name, count(*)::int AS gare, COALESCE(sum(${AMT}), 0)::float AS valore
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND ${who} AND a.sa_name <> '' GROUP BY a.sa_cf ORDER BY gare DESC LIMIT 5`),
    db.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL}`, s.params).then(r => r.rows),
  ]);
  if (!k.vinte) return null;
  const found = [{ cf: k.cf, name: k.name }];
  await linkSubjects(db, found);
  // una frase che legge i numeri (niente AI: confronto con il ribasso tipico del mercato)
  let hint = '';
  if (k.ribasso != null && market?.med != null) {
    const d = k.ribasso - market.med;
    hint = Math.abs(d) < 1.5 ? `Ribassa come il mercato (${fmt(k.ribasso)}% contro un tipico di ${fmt(market.med)}%).`
      : d > 0 ? `Ribassa più del mercato: ${fmt(k.ribasso)}% contro un tipico di ${fmt(market.med)}%. Concorrente aggressivo sul prezzo.`
        : `Ribassa meno del mercato: ${fmt(k.ribasso)}% contro un tipico di ${fmt(market.med)}%. Vince più per requisiti e rapporti che per prezzo.`;
  }
  return {
    cf: k.cf, name: k.name, kpi: { vinte: k.vinte, valore: k.valore, ribasso: k.ribasso, offerenti: k.offerenti, sola: k.sola },
    categorie: k.categorie || [], province: k.province || [], partners, buyers,
    tenders: tenders.map(t => ({ ...t, awarded_on: t.awarded_on ? String(t.awarded_on instanceof Date ? t.awarded_on.toISOString() : t.awarded_on).slice(0, 10) : null })),
    subject: found[0].subject || null, role: subjRole(found[0].subject), ours: isOurs(settings, found), hint, scope: scopeInfo(s, opts),
  };
}
const fmt = x => Number(x).toLocaleString('it-IT', { maximumFractionDigits: 1 });

// card «Mercato» dell'Analisi: dimensione, ribasso tipico, offerenti, primi 3 vincitori
async function marketSummary(db, settings, i) {
  if (!catsOf(i).length) return null;
  const m = await market(db, settings, i, { months: 12 });
  if (m.empty) return null;
  return { state: m.state, kpi: m.kpi, top: m.winners.slice(0, 3).map(w => ({ name: w.name, vinte: w.vinte, role: w.role, subject_id: w.subject?.id || null })) };
}

// «L'assistente propone» le categorie: senza chiave AI una regola sulle parole della descrizione
const SOA_HINTS = [
  [/elettric|cabin|media tension|\bmt\b|\bbt\b|distribuzione di energia|illuminazione pubblic/i, 'OG10', 'reti MT/BT, cabine, illuminazione'],
  [/impianti elettrici|impianto elettrico|telefonic|interni/i, 'OS30', 'impianti elettrici interni'],
  [/fotovolt|accumul|bess|eolic|produzione di energia/i, 'OG9', 'impianti FV e accumuli'],
  [/strad|ponti|viadott|ferrovi/i, 'OG3', 'strade, ponti, ferrovie'],
  [/acquedott|gasdott|fognatur|rete idric|reti gas|irrigazion/i, 'OG6', 'acquedotti, gasdotti, reti'],
  [/edific|capannon|scuol|ospedal|data center/i, 'OG1', 'edifici civili e industriali'],
  [/impianti tecnologic|termoidraul|climatizz|meccanic/i, 'OG11', 'impianti tecnologici'],
  [/restaur|vincol|beni tutelat/i, 'OG2', 'restauro di beni tutelati'],
  [/telecomunicaz|fibra|trasmissione dati/i, 'OS19', 'reti di telecomunicazione'],
  [/bonific|amianto|ambiental/i, 'OG12', 'bonifica e protezione ambientale'],
  [/segnaletic|semafor/i, 'OS9', 'segnaletica luminosa'],
];
function proposeSoa(text) {
  const out = [];
  for (const [re, code, why] of SOA_HINTS) if (re.test(text || '') && !out.some(x => x.code === code)) out.push({ code, why });
  return out.slice(0, 5);
}

// numero di gare per l'etichetta della tab
async function countGare(db, settings, i) {
  const s = scopeOf(settings, i, { months: 12 });
  if (!s.cats.length) return 0;
  const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM crm_anac_awards a WHERE ${s.sql}`, s.params);
  return r.n;
}

module.exports = { countGare, BANDS, catsOf, scopeOf, dataState, market, searchCompanies, company, marketSummary, proposeSoa, loadedCats };
