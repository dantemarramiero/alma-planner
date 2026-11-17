// Numeri della concorrenza (canvas «v4 · Concorrenza» e «v4 · Gara», 17/11/2026) dalle gare ANAC in crm_anac_awards.
// Il perimetro di una BU viene dal suo profilo: categorie SOA, CPV (BU di servizi), regioni, fascia d'importo.
// Il «ribasso tipico» è la mediana delle gare con almeno 2 offerenti e un ribasso vero (sopra 0 e sotto 70%).
const { normCat } = require('./crm-anac');

const BANDS = [['< 1 M€', 0, 1e6], ['1 – 5 M€', 1e6, 5e6], ['5 – 20 M€', 5e6, 2e7], ['oltre 20 M€', 2e7, null]];

// WHERE del perimetro: { sql, params } a partire da $start
function scopeOf(settings, bu, { months = 12, regions, amount = 'profilo', category = '', start = 1 } = {}) {
  const p = settings.profiles?.[bu] || {};
  const cats = category ? [normCat(category)] : (bu ? (p.soa || []).map(normCat) : [...new Set(Object.values(settings.profiles || {}).flatMap(x => (x.soa || []).map(normCat)))]);
  const cpv = category ? [] : bu ? (settings.concorrenza.cpv?.[bu] || []) : Object.values(settings.concorrenza.cpv || {}).flat();
  const regs = regions ?? (bu ? p.regions || [] : []);
  const params = [];
  const add = v => { params.push(v); return `$${start + params.length - 1}`; };
  const where = [`a.awarded_on >= CURRENT_DATE - (${add(String(months))} || ' months')::interval`];
  const or = [];
  if (cats.length) or.push(`a.category = ANY(${add(cats)}::text[])`);
  for (const c of cpv) or.push(`a.cpv LIKE ${add(`${c}%`)}`);
  where.push(or.length ? `(${or.join(' OR ')})` : 'false');
  if (regs.length) where.push(`lower(a.region) = ANY(${add(regs.map(r => r.toLowerCase()))}::text[])`);
  if (amount === 'profilo' && bu) {
    if (p.amount_min) where.push(`COALESCE(a.amount, a.base_amount) >= ${add(p.amount_min)}`);
    if (p.amount_max) where.push(`COALESCE(a.amount, a.base_amount) <= ${add(p.amount_max)}`);
  } else if (amount && typeof amount === 'object') {
    if (amount.min) where.push(`COALESCE(a.amount, a.base_amount) >= ${add(amount.min)}`);
    if (amount.max) where.push(`COALESCE(a.amount, a.base_amount) <= ${add(amount.max)}`);
  }
  return { sql: where.join(' AND '), params, cats, cpv, regions: regs, amount_min: amount === 'profilo' ? p.amount_min ?? null : amount?.min ?? null, amount_max: amount === 'profilo' ? p.amount_max ?? null : amount?.max ?? null };
}
const REAL = 'a.bidders >= 2 AND a.discount > 0 AND a.discount < 70';
// «è Almacis»: codice fiscale tra i nostri o nome che contiene uno dei nostri nomi
function oursSql(settings, w, start) {
  const cfs = settings.concorrenza.our_cf || [];
  const names = (settings.concorrenza.our_names || []).filter(Boolean);
  const params = [];
  const parts = [];
  if (cfs.length) { params.push(cfs); parts.push(`(${w}->>'cf') = ANY($${start + params.length - 1}::text[])`); }
  for (const n of names) { params.push(`%${n}%`); parts.push(`upper(${w}->>'name') LIKE $${start + params.length - 1}`); }
  return { sql: parts.length ? `(${parts.join(' OR ')})` : 'false', params };
}

async function overview(db, settings, bu, opts = {}) {
  const s = scopeOf(settings, bu, opts);
  const q = (sql, extra = []) => db.query(sql, [...s.params, ...extra]).then(r => r.rows);
  const n = s.params.length;
  const ours = oursSql(settings, 'w', n + 1);
  const [[k], [real], winners, bands, ati, mine, [our]] = await Promise.all([
    q(`SELECT count(*)::int AS gare, COALESCE(sum(COALESCE(a.amount, a.base_amount)), 0)::float AS valore FROM crm_anac_awards a WHERE ${s.sql}`),
    q(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bidders)::float AS offerenti
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL}`),
    q(`SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, sum(COALESCE(a.amount, a.base_amount))::float AS valore,
              avg(a.discount) FILTER (WHERE ${REAL})::float AS ribasso, count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1)::int AS in_ati,
              (array_agg(DISTINCT a.region) FILTER (WHERE a.region <> ''))[1:3] AS regioni, bool_or(${ours.sql}) AS noi
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND jsonb_array_length(a.winners) <= 8
        GROUP BY 1 ORDER BY vinte DESC, valore DESC LIMIT 40`, ours.params),
    q(`SELECT CASE ${BANDS.map(([l, lo, hi], i) => `WHEN COALESCE(a.amount, a.base_amount) >= ${lo}${hi ? ` AND COALESCE(a.amount, a.base_amount) < ${hi}` : ''} THEN ${i}`).join(' ')} END AS band,
              a.criterion, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25, percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL} GROUP BY GROUPING SETS ((1), (2))`),
    q(`SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS ati, array_agg(DISTINCT a.category) AS categorie
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w
        WHERE ${s.sql} AND jsonb_array_length(a.winners) BETWEEN 2 AND 8 AND NOT ${ours.sql}
        GROUP BY 1 HAVING count(*) >= 2 ORDER BY ati DESC LIMIT 12`, ours.params),
    q(`SELECT a.cig, a.object, a.sa_name, a.region, COALESCE(a.amount, a.base_amount)::float AS amount, a.discount::float, a.bidders, a.awarded_on, a.category
         FROM crm_anac_awards a WHERE ${s.sql} AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.winners) w WHERE ${ours.sql}) ORDER BY a.awarded_on DESC LIMIT 20`, ours.params),
    q(`SELECT count(*)::int AS gare, COALESCE(sum(COALESCE(a.amount, a.base_amount)), 0)::float AS valore
         FROM crm_anac_awards a WHERE ${s.sql} AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.winners) w WHERE ${ours.sql})`, ours.params),
  ]);
  await linkSubjects(db, [...winners, ...ati]);
  const band = bands.filter(b => b.band !== null && b.criterion === null).sort((a, b) => a.band - b.band).map(b => ({ label: BANDS[b.band][0], n: b.n, med: b.med, p25: b.p25, p75: b.p75 }));
  const crit = bands.filter(b => b.band === null && b.criterion).map(b => ({ label: b.criterion === 'prezzo' ? 'Prezzo più basso' : 'Offerta più vantaggiosa', n: b.n, med: b.med, p25: b.p25, p75: b.p75 }));
  return {
    scope: { bu, categories: s.cats, cpv: s.cpv, regions: s.regions, amount_min: s.amount_min, amount_max: s.amount_max, months: Number(opts.months || 12) },
    kpi: { gare: k.gare, valore: k.valore, ribasso: real.med, p25: real.p25, p75: real.p75, offerenti: real.offerenti, con_ribasso: real.n, noi: our.gare, noi_valore: our.valore },
    winners, bands: band, criteria: crit, ati, ours: mine,
  };
}

// schede del CRM con la stessa P. IVA / codice fiscale (o lo stesso nome)
async function linkSubjects(db, rows) {
  const cfs = [...new Set(rows.map(r => r.cf).filter(Boolean))];
  const names = [...new Set(rows.map(r => String(r.name || '').toLowerCase()))];
  if (!rows.length) return;
  const { rows: subj } = await db.query(
    `SELECT id, name, vat, roles FROM crm_subjects WHERE merged_into IS NULL AND (upper(regexp_replace(vat, '^IT', '', 'i')) = ANY($1::text[]) OR lower(name) = ANY($2::text[]))`, [cfs, names]);
  for (const r of rows) {
    const s = subj.find(x => x.vat && x.vat.toUpperCase().replace(/^IT/, '') === r.cf) || subj.find(x => x.name.toLowerCase() === String(r.name || '').toLowerCase());
    r.subject = s ? { id: s.id, name: s.name, roles: s.roles } : null;
  }
}

// Per una gara: ribasso tipico per categoria, zona e fascia (si allarga se le gare simili sono poche) e probabili concorrenti.
async function estimate(db, settings, { category, region, amount, criterion }) {
  const cat = normCat(category);
  if (!cat) return null;
  const tries = [];
  const band = amount ? { min: amount / 2.5, max: amount * 2.5 } : null;
  if (region && band) tries.push({ regions: [region], amount: band, label: `${cat} · ${region} · stessa fascia` });
  if (region) tries.push({ regions: [region], amount: null, label: `${cat} · ${region}` });
  if (band) tries.push({ regions: [], amount: band, label: `${cat} · tutta Italia · stessa fascia` });
  tries.push({ regions: [], amount: null, label: `${cat} · tutta Italia` });
  for (const t of tries) {
    const s = scopeOf(settings, null, { months: settings.concorrenza.months || 12, regions: t.regions, amount: t.amount, category: cat });
    const crit = criterion === 'prezzo' || criterion === 'oepv' ? ` AND a.criterion = '${criterion}'` : '';
    const { rows: [r] } = await db.query(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bidders)::float AS offerenti
      FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL}${crit}`, s.params);
    if (r.n < 10 && t !== tries[tries.length - 1]) continue;
    if (!r.n) return { n: 0, label: t.label };
    const ours = oursSql(settings, 'w', s.params.length + 1);
    const { rows: who } = await db.query(`SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, avg(a.discount) FILTER (WHERE ${REAL})::float AS ribasso
        FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND jsonb_array_length(a.winners) <= 8 AND NOT ${ours.sql}
       GROUP BY 1 ORDER BY vinte DESC LIMIT 3`, [...s.params, ...ours.params]);
    await linkSubjects(db, who);
    return { ...r, label: t.label + (crit ? (criterion === 'prezzo' ? ' · prezzo più basso' : ' · offerta più vantaggiosa') : ''), competitors: who };
  }
  return null;
}

async function awardByCig(db, cig) {
  const { rows: [a] } = await db.query('SELECT * FROM crm_anac_awards WHERE cig = $1', [String(cig || '').toUpperCase().trim()]);
  return a || null;
}
function isOurs(settings, winners) {
  const cfs = settings.concorrenza.our_cf || [];
  const names = settings.concorrenza.our_names || [];
  return (winners || []).some(w => cfs.includes(w.cf) || names.some(n => n && String(w.name || '').toUpperCase().includes(n)));
}

module.exports = { BANDS, scopeOf, overview, estimate, awardByCig, isOurs, linkSubjects };
