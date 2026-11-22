// «Concorrenza e gare» · Regioni e Partner (canvas v12, approvato da Dante il 21/11/2026) dalle gare ANAC.
// Regioni: per una BU, ogni regione con gare, valore, ribasso tipico, offerenti, quota dei primi 3, la nostra presenza e
// «Conviene» da 0 a 100 = volume + margine (ribasso sotto la media italiana della BU) + concorrenza (pochi offerenti,
// mercato aperto) + vicinanza (gare vinte da noi, enti nel CRM, regioni del profilo BU). Pesi in Impostazioni.
// Partner: per BU e regione, le imprese che vincono lì nelle categorie della BU andando in ATI, non concorrenti nel CRM.

const { BANDS, REAL, scopeOf, oursSql, linkSubjects } = require('./crm-concorrenza');
const { relationsFor } = require('./crm-relazioni');

const PESI_DEFAULT = { volume: 30, margine: 30, concorrenza: 20, vicinanza: 20 };
const MIN_GARE = 5; // sotto, «pochi dati»: niente punteggio
const VAL = 'COALESCE(a.amount, a.base_amount)';
const clamp = n => Math.max(0, Math.min(1, n));
const r1 = n => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const it = n => String(r1(n)).replace('.', ',');
const eur = n => (n >= 1e6 ? `${it(n / 1e6)} M€` : `${Math.round(n / 1e3)} mila €`);

const pesiOf = settings => {
  const p = { ...PESI_DEFAULT, ...(settings.concorrenza.pesi_regioni || {}) };
  const tot = Object.values(p).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, (Number(x) || 0) / tot]));
};
const ivaSql = col => `upper(regexp_replace(${col}, '^IT', '', 'i'))`;

async function regionRows(db, settings, bu, months) {
  const s = scopeOf(settings, bu, { months, regions: [], amount: 'profilo' });
  const n = s.params.length;
  const ours = oursSql(settings, 'w', n + 1);
  const q = (sql, extra = []) => db.query(sql, [...s.params, ...extra]).then(r => r.rows);
  const [rows, top, crm, [nat]] = await Promise.all([
    q(`SELECT a.region, count(*)::int AS gare, COALESCE(sum(${VAL}), 0)::float AS valore, count(*) FILTER (WHERE ${REAL})::int AS n_real,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount) FILTER (WHERE ${REAL})::float AS ribasso,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bidders) FILTER (WHERE ${REAL})::float AS offerenti,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(a.winners) w WHERE ${ours.sql}))::int AS noi,
              count(DISTINCT a.winners->0->>'cf')::int AS imprese
         FROM crm_anac_awards a WHERE ${s.sql} AND a.region <> '' GROUP BY 1`, ours.params),
    q(`SELECT region, sum(v)::float AS tot, (sum(v) FILTER (WHERE rk <= 3))::float AS top3 FROM (
         SELECT a.region, a.winners->0->>'cf' AS cf, sum(${VAL}) AS v, rank() OVER (PARTITION BY a.region ORDER BY sum(${VAL}) DESC) AS rk
           FROM crm_anac_awards a WHERE ${s.sql} AND a.region <> '' AND jsonb_array_length(a.winners) > 0 GROUP BY 1, 2) x GROUP BY 1`),
    q(`SELECT a.region, count(DISTINCT c.id)::int AS enti FROM crm_anac_awards a
         JOIN crm_subjects c ON c.merged_into IS NULL AND a.sa_cf <> '' AND (${ivaSql('c.vat')} = a.sa_cf OR upper(c.tax_code) = a.sa_cf)
        WHERE ${s.sql} AND a.region <> '' GROUP BY 1`),
    q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS ribasso, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.bidders)::float AS offerenti
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL}`),
  ]);
  return { s, rows, top, crm, nat };
}

function score(row, ctx) {
  const w = ctx.pesi;
  const volume = ctx.maxVal ? Math.sqrt(row.valore / ctx.maxVal) : 0;
  const margine = row.ribasso === null || ctx.nat.ribasso === null ? 0.5 : clamp(0.5 + (ctx.nat.ribasso - row.ribasso) / 10);
  const concorrenza = row.offerenti === null ? 0.5 : clamp(1 - (row.offerenti - 3) / 15) * 0.6 + (1 - (row.top3 ?? 0.5)) * 0.4;
  const vicinanza = clamp(row.noi / 3) * 0.4 + clamp(row.enti / 10) * 0.3 + (ctx.home.has(row.region.toLowerCase()) ? 0.3 : 0);
  return Math.round(100 * (w.volume * volume + w.margine * margine + w.concorrenza * concorrenza + w.vicinanza * vicinanza));
}

// perché conviene (o no), in parole e con i numeri
function reasons(row, ctx) {
  const out = [];
  if (row.ribasso !== null && ctx.nat.ribasso !== null) {
    const d = ctx.nat.ribasso - row.ribasso;
    out.push(d >= 1 ? { tone: 'gr', text: `Ribasso tipico ${it(row.ribasso)}%: ${it(d)} punti sotto la media italiana della BU (${it(ctx.nat.ribasso)}%), più margine.` }
      : d <= -1 ? { tone: 'rd', text: `Ribasso tipico ${it(row.ribasso)}%: ${it(-d)} punti sopra la media italiana (${it(ctx.nat.ribasso)}%), prezzi più tirati.` }
        : { tone: '', text: `Ribasso tipico ${it(row.ribasso)}%, in linea con la media italiana (${it(ctx.nat.ribasso)}%).` });
  }
  if (row.top3 !== null) out.push(row.top3 <= 0.3 ? { tone: 'gr', text: `Mercato aperto: i primi 3 vincono il ${Math.round(row.top3 * 100)}% del valore; ${row.imprese} imprese diverse hanno vinto.` }
    : row.top3 >= 0.55 ? { tone: 'rd', text: `Mercato in mano a pochi: i primi 3 vincono il ${Math.round(row.top3 * 100)}% del valore.` }
      : { tone: '', text: `I primi 3 vincono il ${Math.round(row.top3 * 100)}% del valore, ${row.imprese} imprese diverse hanno vinto.` });
  if (row.offerenti !== null) out.push({ tone: row.offerenti <= ctx.nat.offerenti - 1 ? 'gr' : row.offerenti >= ctx.nat.offerenti + 2 ? 'rd' : '', text: `${it(row.offerenti)} offerenti a gara (in Italia ${it(ctx.nat.offerenti)}).` });
  const near = [row.noi ? `${row.noi} ${row.noi === 1 ? 'gara vinta' : 'gare vinte'} da noi` : '', row.enti ? `${row.enti} enti nel CRM` : '', ctx.home.has(row.region.toLowerCase()) ? 'è tra le regioni della BU' : ''].filter(Boolean);
  out.push(near.length ? { tone: 'gr', text: `Siamo vicini: ${near.join(', ')}.` } : { tone: 'rd', text: 'Qui non abbiamo ancora gare vinte né enti nel CRM.' });
  return out;
}

async function regionsView(db, settings, bu, { months = 24 } = {}) {
  const { s, rows, top, crm, nat } = await regionRows(db, settings, bu, months);
  const p = bu ? settings.profiles?.[bu] || {} : {};
  const home = new Set((p.regions || []).map(r => r.toLowerCase()));
  const tops = new Map(top.map(t => [t.region, t.tot ? t.top3 / t.tot : null]));
  const entiBy = new Map(crm.map(c => [c.region, c.enti]));
  const list = rows.map(r => ({ ...r, top3: tops.get(r.region) ?? null, enti: entiBy.get(r.region) || 0 }));
  const ctx = { pesi: pesiOf(settings), nat: { ribasso: nat?.ribasso ?? null, offerenti: nat?.offerenti ?? null }, home, maxVal: Math.max(0, ...list.map(r => r.valore)) };
  for (const r of list) {
    r.conviene = r.gare >= MIN_GARE ? score(r, ctx) : null;
    r.perche = r.gare >= MIN_GARE ? reasons(r, ctx) : [{ tone: '', text: `Solo ${r.gare} ${r.gare === 1 ? 'gara' : 'gare'}: troppo poche per dire.` }];
    r.ribasso = r1(r.ribasso);
    r.offerenti = r1(r.offerenti);
  }
  list.sort((a, b) => (b.conviene ?? -1) - (a.conviene ?? -1) || b.valore - a.valore);
  const best = list.filter(r => r.conviene !== null);
  const pick = (f, cmp) => best.filter(f).sort(cmp)[0] || null;
  return {
    scope: { bu, categories: s.cats, cpv: s.cpv, months, amount_min: s.amount_min, amount_max: s.amount_max },
    italia: { ribasso: r1(ctx.nat.ribasso), offerenti: r1(ctx.nat.offerenti), gare: list.reduce((a, r) => a + r.gare, 0) },
    pesi: { ...PESI_DEFAULT, ...(settings.concorrenza.pesi_regioni || {}) },
    migliori: { conviene: best[0] || null, ribasso: pick(r => r.ribasso !== null && r.n_real >= MIN_GARE, (a, b) => a.ribasso - b.ribasso),
      concorrenza: pick(r => r.offerenti !== null && r.n_real >= MIN_GARE, (a, b) => a.offerenti - b.offerenti) },
    regioni: list,
  };
}

// Una regione: ribasso per fascia, enti che bandiscono di più (e se ci conoscono), chi vince
async function regionDetail(db, settings, bu, region, { months = 24 } = {}) {
  const all = await regionsView(db, settings, bu, { months });
  const row = all.regioni.find(r => r.region.toLowerCase() === String(region || '').toLowerCase());
  if (!row) return null;
  const s = scopeOf(settings, bu, { months, regions: [row.region], amount: 'profilo' });
  const n = s.params.length;
  const ours = oursSql(settings, 'w', n + 1);
  const q = (sql, extra = []) => db.query(sql, [...s.params, ...extra]).then(r => r.rows);
  const [bands, enti, winners] = await Promise.all([
    q(`SELECT CASE ${BANDS.map(([, lo, hi], i) => `WHEN ${VAL} >= ${lo}${hi ? ` AND ${VAL} < ${hi}` : ''} THEN ${i}`).join(' ')} END AS band, count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY a.discount)::float AS med, percentile_cont(0.25) WITHIN GROUP (ORDER BY a.discount)::float AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY a.discount)::float AS p75
         FROM crm_anac_awards a WHERE ${s.sql} AND ${REAL} GROUP BY 1 ORDER BY 1`),
    q(`SELECT a.sa_cf AS cf, max(a.sa_name) AS name, count(*)::int AS gare, sum(${VAL})::float AS valore FROM crm_anac_awards a
        WHERE ${s.sql} AND a.sa_cf <> '' GROUP BY 1 ORDER BY valore DESC NULLS LAST LIMIT 6`),
    q(`SELECT w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, sum(${VAL})::float AS valore, bool_or(${ours.sql}) AS noi
         FROM crm_anac_awards a, jsonb_array_elements(a.winners) w WHERE ${s.sql} AND jsonb_array_length(a.winners) <= 8
        GROUP BY 1 ORDER BY vinte DESC, valore DESC LIMIT 5`, ours.params),
  ]);
  // enti nel CRM e quanto li conosciamo
  if (enti.length) {
    const { rows: subj } = await db.query(`SELECT id, name, roles, ${ivaSql('vat')} AS vat, upper(tax_code) AS tax FROM crm_subjects
      WHERE merged_into IS NULL AND (${ivaSql('vat')} = ANY($1::text[]) OR upper(tax_code) = ANY($1::text[]))`, [enti.map(e => e.cf)]);
    const rel = await relationsFor(db, subj.map(x => x.id));
    for (const e of enti) {
      const x = subj.find(y => y.vat === e.cf || y.tax === e.cf);
      e.subject = x ? { id: x.id, name: x.name, roles: x.roles, level: rel[x.id]?.level || '' } : null;
    }
  }
  await linkSubjects(db, winners);
  return { ...row, scope: all.scope, italia: all.italia,
    bands: bands.filter(b => b.band !== null).map(b => ({ label: BANDS[b.band][0], n: b.n, med: r1(b.med), p25: r1(b.p25), p75: r1(b.p75) })), enti, winners };
}

// Partner possibili per BU e regione: vincono lì nelle categorie della BU, vanno in ATI, non sono noi né concorrenti nel CRM
async function partnerRows(db, settings, bu, months) {
  const s = scopeOf(settings, bu, { months, regions: [], amount: 'profilo' });
  const ours = oursSql(settings, 'w', s.params.length + 1);
  const { rows } = await db.query(
    `SELECT a.region, w->>'cf' AS cf, max(w->>'name') AS name, count(*)::int AS vinte, COALESCE(sum(${VAL}), 0)::float AS valore,
            count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1)::int AS in_ati,
            count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1 AND w->>'role' = 'mandataria')::int AS mandataria,
            avg(a.discount) FILTER (WHERE ${REAL})::float AS ribasso, array_agg(DISTINCT a.category) FILTER (WHERE a.category <> '') AS categorie,
            mode() WITHIN GROUP (ORDER BY a.province) AS provincia
       FROM crm_anac_awards a, jsonb_array_elements(a.winners) w
      WHERE ${s.sql} AND a.region <> '' AND jsonb_array_length(a.winners) <= 8 AND NOT ${ours.sql} AND w->>'cf' <> ''
      GROUP BY 1, 2 HAVING count(*) FILTER (WHERE jsonb_array_length(a.winners) > 1) >= 2`, [...s.params, ...ours.params]);
  return rows;
}
const partnerScore = p => p.in_ati * 2 + p.vinte + p.mandataria;

async function partnersView(db, settings, { months = 24, bus, region = '', bu = '', only } = {}) {
  const keys = bus.filter(b => (settings.profiles[b]?.soa || []).length || (settings.concorrenza.cpv?.[b] || []).length);
  const byBu = Object.fromEntries(await Promise.all(keys.map(async b => [b, await partnerRows(db, settings, b, months)])));
  const flat = Object.values(byBu).flat();
  await linkSubjects(db, flat);
  const ok = p => !(p.subject && p.subject.roles.includes('concorrente') && !p.subject.roles.includes('partner'));
  for (const b of keys) byBu[b] = byBu[b].filter(ok).sort((x, y) => partnerScore(y) - partnerScore(x));
  // regioni ordinate per «Conviene» della BU scelta (le prime 8 con partner), poi le altre con più partner
  const selBu = keys.includes(bu) ? bu : keys[0] || '';
  const regCount = new Map();
  for (const b of keys) for (const p of byBu[b]) regCount.set(p.region, (regCount.get(p.region) || 0) + 1);
  const conv = selBu ? new Map((await regionsView(db, settings, selBu, { months })).regioni.map(r => [r.region, r.conviene ?? -1])) : new Map();
  const ordered = [...regCount.keys()].sort((a, b) => (conv.get(b) ?? -1) - (conv.get(a) ?? -1) || regCount.get(b) - regCount.get(a));
  // filtro regioni (v17): con un elenco solo quelle (che hanno partner); senza, le prime 8 per «Conviene»
  const regions = only?.length ? ordered.filter(r => only.some(x => x.toLowerCase() === String(r).toLowerCase())) : ordered.slice(0, 8);
  if (region && !regions.includes(region) && regCount.has(region) && !only?.length) regions.push(region);
  const matrix = regions.map(r => ({ region: r, cells: Object.fromEntries(keys.map(b => {
    const list = byBu[b].filter(p => p.region === r);
    return [b, list.length ? { n: list.length, best: { name: list[0].name, cf: list[0].cf, subject: list[0].subject || null }, crm: list.filter(p => p.subject).length } : { n: 0 }];
  })) }));
  const selRegion = (region && (!only?.length || regions.includes(region)) ? region : '') || (regions.find(r => (byBu[selBu] || []).some(p => p.region === r)) || '');
  const cands = (byBu[selBu] || []).filter(p => p.region === selRegion).slice(0, 12);
  const rel = await relationsFor(db, cands.filter(p => p.subject).map(p => p.subject.id));
  for (const p of cands) {
    if (p.subject) p.subject.level = rel[p.subject.id]?.level || '';
    p.ribasso = r1(p.ribasso);
    p.perche = [
      `${p.vinte} ${p.vinte === 1 ? 'gara vinta' : 'gare vinte'} in ${p.region} (${eur(p.valore)}), ${p.in_ati} in ATI${p.mandataria ? `, ${p.mandataria} come mandataria` : ''}.`,
      p.categorie?.length ? `Categorie: ${p.categorie.join(' · ')}${p.provincia ? `; lavora soprattutto a ${p.provincia}` : ''}.` : p.provincia ? `Lavora soprattutto a ${p.provincia}.` : '',
      p.subject?.level === 'forte' || p.subject?.level === 'media' ? 'Ci conosciamo già: c\'è una strada calda in «Chi conosciamo».' : '',
    ].filter(Boolean);
  }
  return { months, bus: keys, regions, matrix, region_counts: ordered.map(r => ({ region: r, n: regCount.get(r) })), only: only || null, conviene: Object.fromEntries(regions.map(r => [r, conv.get(r) ?? null])), bu: selBu, region: selRegion, partners: cands,
    totale: keys.reduce((a, b) => a + byBu[b].length, 0), nel_crm: flat.filter(p => p.subject && ok(p)).length };
}

module.exports = { PESI_DEFAULT, regionsView, regionDetail, partnersView, score, reasons };
