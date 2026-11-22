// Gare europee da TED (ALM2-49, canvas CRM v14 · V14-TED, via di Dante 22/11/2026).
// TED è la gazzetta europea degli appalti: ci finiscono le gare sopra soglia UE, con dati quasi sempre completi
// (offerte ricevute, vincitore con P.IVA, luogo del cantiere in codice NUTS). Si legge dalla API pubblica v3
// (gratis, senza chiave): avvisi di gara (bandi, con la scadenza) ed esiti, solo in Italia, per i codici CPV delle
// categorie SOA in uso nel CRM (profili delle BU, iniziative di Nuovi business, «Categorie in più»).
// La prima volta 24 mesi, poi ogni notte gli ultimi giorni. Le letture: sezione «Gare europee» del Mercato e
// TED in «Da dove vengono i dati».

const API = 'https://api.ted.europa.eu/v3/notices/search';
const MONTHS = 24;
const FIELDS = ['publication-number', 'notice-type', 'notice-title', 'buyer-name', 'organisation-city-buyer', 'publication-date', 'place-of-performance',
  'classification-cpv', 'total-value', 'estimated-value-lot', 'result-value-lot', 'deadline-receipt-tender-date-lot', 'winner-name', 'winner-identifier',
  'received-submissions-type-val'];
const TYPES = { 'cn-standard': 'bando', 'can-standard': 'esito' };

// Categorie SOA → codici CPV principali (TED cerca anche i sotto-codici). Si aggiungono codici da Impostazioni → Concorrenza.
const CPV = {
  OG1: ['45210000'], OG2: ['45212350', '45454100'], OG3: ['45233000', '45221100', '45234100'], OG4: ['45221200'], OG5: ['45247000'],
  OG6: ['45231300', '45231220', '45232400', '45232150'], OG7: ['45241000', '45244000'], OG8: ['45246000'], OG9: ['45251000', '45261215', '09332000'],
  OG10: ['45231400', '45232200', '45316100'], OG11: ['45330000', '45331000', '45343000', '45310000'], OG12: ['45262660', '90722000'], OG13: ['45112700'],
  OS3: ['45330000'], OS4: ['45313000'], OS5: ['45312000'], OS6: ['45420000', '45430000', '45440000'], OS7: ['45410000', '45320000'], OS9: ['45316200'],
  OS10: ['45233290'], 'OS18-A': ['45223100'], OS19: ['45314000', '45232300'], OS21: ['45262000'], OS22: ['45252100', '45232420'], OS23: ['45111100'],
  OS24: ['45112710'], OS28: ['45331000'], OS30: ['45310000'], OS32: ['45422000'],
};
const CPV_LABEL = {
  45210000: 'edifici', 45212350: 'edifici storici', 45454100: 'restauro', 45233000: 'strade', 45221100: 'ponti', 45234100: 'ferrovie', 45221200: 'gallerie',
  45247000: 'dighe', 45231300: 'acquedotti', 45231220: 'gasdotti', 45232400: 'fognature', 45232150: 'condotte idriche', 45241000: 'porti', 45244000: 'opere marittime',
  45246000: 'opere fluviali', 45251000: 'centrali', 45261215: 'pannelli solari', '09332000': 'impianti solari', 45231400: 'linee elettriche', 45232200: 'sottostazioni',
  45316100: 'illuminazione esterna', 45330000: 'idraulica', 45331000: 'riscaldamento e condizionamento', 45343000: 'antincendio', 45310000: 'impianti elettrici',
  45262660: 'rimozione amianto', 90722000: 'bonifica', 45112700: 'paesaggistica', 45313000: 'ascensori', 45312000: 'allarme e antenne', 45420000: 'falegnameria',
  45430000: 'pavimenti e rivestimenti', 45440000: 'tinteggiatura e vetri', 45410000: 'intonaci', 45320000: 'isolamento', 45316200: 'segnaletica luminosa',
  45233290: 'segnaletica stradale', 45223100: 'strutture metalliche', 45314000: 'telecomunicazioni', 45232300: 'linee telefoniche', 45262000: 'strutture speciali',
  45252100: 'depuratori', 45232420: 'acque reflue', 45111100: 'demolizioni', 45112710: 'verde', 45422000: 'carpenteria in legno',
};

// regioni italiane dal codice NUTS 2 (il luogo del cantiere)
const NUTS = { ITC1: 'Piemonte', ITC2: 'Valle d\'Aosta', ITC3: 'Liguria', ITC4: 'Lombardia', ITH1: 'Trentino-Alto Adige', ITH2: 'Trentino-Alto Adige', ITH3: 'Veneto',
  ITH4: 'Friuli-Venezia Giulia', ITH5: 'Emilia-Romagna', ITI1: 'Toscana', ITI2: 'Umbria', ITI3: 'Marche', ITI4: 'Lazio', ITF1: 'Abruzzo', ITF2: 'Molise', ITF3: 'Campania',
  ITF4: 'Puglia', ITF5: 'Basilicata', ITF6: 'Calabria', ITG1: 'Sicilia', ITG2: 'Sardegna' };

// codici CPV di un elenco di categorie, con quelli aggiunti in Impostazioni (settings.concorrenza.ted_cpv)
function codesFor(cats, settings = {}) {
  const extra = settings.concorrenza?.ted_cpv || {};
  return [...new Set((cats || []).flatMap(c => [...(CPV[c] || []), ...(extra[c] || [])]))];
}
const prefix = c => { const s = String(c).replace(/\D/g, '').slice(0, 8).replace(/0+$/, ''); return s.length >= 2 ? s : String(c).slice(0, 2); };
const cpvMap = settings => Object.fromEntries(Object.keys({ ...CPV, ...(settings.concorrenza?.ted_cpv || {}) }).sort().map(c => [c, codesFor([c], settings)]));

// ── pulizia dei testi di TED (titoli in più lingue, HTML, a volte codifica doppia) ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
function clean(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/[ÃÂ]{2,}\s?/g, 'à').replace(/Ã¨/g, 'è').replace(/Ã©/g, 'é').replace(/Ã²/g, 'ò').replace(/Ã¹/g, 'ù').replace(/Ã¬/g, 'ì').replace(/Ã\s?/g, 'à')
    .replace(/\s+/g, ' ').trim();
}
const pick = v => { // { ita: [...], eng: [...] } o lista o testo
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return pick(v.ita || v.mul || v.eng || Object.values(v)[0] || []); // { ita: "…" } oppure { ita: ["…"] }
  return [v];
};
const first = v => clean(pick(v)[0] || '');
// «Italia – Lavori di installazione … – OGGETTO» → «OGGETTO»
const titleOf = v => { const t = first(v); const parts = t.split(' – '); return (parts.length >= 3 ? parts.slice(2).join(' – ') : t).slice(0, 600); };
const day = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : null);
const numOr = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// TED dà i nomi dei vincitori e i loro identificativi in due elenchi che non sempre si corrispondono (consorzi e ATI
// con un nome solo e più P.IVA): si accoppiano solo se sono lunghi uguali; altrimenti le P.IVA restano in «cfs»
function winnersOf(names, ids) {
  const cfs = [...new Set(ids.filter(x => x.length >= 11).map(x => x.slice(0, 16)))];
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length && uniq.length === cfs.length) return uniq.map((name, k) => ({ name: name.slice(0, 300), cf: cfs[k] })).slice(0, 20);
  return uniq.map((name, k) => ({ name: name.slice(0, 300), cf: '', ...(k === 0 && cfs.length ? { cfs: cfs.slice(0, 20) } : {}) })).slice(0, 20);
}

function toRow(n) {
  const kind = TYPES[n['notice-type']];
  if (!kind) return null;
  const nuts = [...new Set(pick(n['place-of-performance']).filter(x => /^IT[A-Z]\d/.test(x)))];
  const regions = [...new Set(nuts.map(x => NUTS[x.slice(0, 4)]).filter(Boolean))];
  const lots = pick(n['estimated-value-lot']).map(numOr).filter(Boolean);
  const results = pick(n['result-value-lot']).map(numOr).filter(Boolean);
  const deadlines = pick(n['deadline-receipt-tender-date-lot']).map(day).filter(Boolean).sort();
  const names = pick(n['winner-name']).map(clean);
  const ids = pick(n['winner-identifier']).map(x => String(x || '').toUpperCase().replace(/^IT/, '').replace(/[^A-Z0-9]/g, ''));
  const offers = pick(n['received-submissions-type-val']).map(Number).filter(Number.isFinite);
  return {
    pub: String(n['publication-number']), kind, title: titleOf(n['notice-title']), buyer: first(n['buyer-name']).slice(0, 300), city: first(n['organisation-city-buyer']).slice(0, 120),
    nuts, regions, cpv: [...new Set(pick(n['classification-cpv']).map(String))].slice(0, 40),
    value: numOr(n['total-value']) || (results.length ? results.reduce((a, b) => a + b, 0) : null) || (lots.length ? lots.reduce((a, b) => a + b, 0) : null),
    lots: Math.max(lots.length, 1), published_on: day(n['publication-date']), deadline: kind === 'bando' ? (deadlines.at(-1) || null) : null,
    offers: kind === 'esito' && offers.length ? Math.max(...offers) : null,
    winners: kind === 'esito' ? winnersOf(names, ids) : [],
  };
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

// Scarica gli avvisi italiani per i codici dati, pubblicati da «since» (Date). fetchImpl per i test.
async function fetchNotices(codes, since, { fetchImpl = fetch, log = () => {}, pause = 300 } = {}) {
  const out = [];
  for (let i = 0; i < codes.length; i += 40) { // query più corte: TED rifiuta quelle troppo lunghe
    const query = `classification-cpv IN (${codes.slice(i, i + 40).join(' ')}) AND place-of-performance IN (ITA) AND notice-type IN (cn-standard can-standard) AND publication-date>=${ymd(since)}`;
    let token = null, pages = 0;
    do {
      const res = await fetchImpl(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, fields: FIELDS, limit: 250, paginationMode: 'ITERATION', ...(token ? { iterationNextToken: token } : {}) }) });
      if (!res.ok) throw new Error(`TED ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      for (const n of j.notices || []) { const r = toRow(n); if (r) out.push(r); }
      token = (j.notices || []).length ? j.iterationNextToken : null;
      if (++pages > 200) break;
      if (token && pause) await new Promise(r => setTimeout(r, pause));
    } while (token);
  }
  log(`TED: ${out.length} avvisi`);
  return [...new Map(out.map(r => [r.pub, r])).values()];
}

async function save(db, rows) {
  await db.tx(async q => {
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const vals = [];
      const sql = part.map((r, k) => {
        vals.push(r.pub, r.kind, r.title, r.buyer, r.city, r.nuts, r.regions, r.cpv, r.value, r.lots, r.published_on, r.deadline, r.offers, JSON.stringify(r.winners));
        const b = k * 14;
        return `(${Array.from({ length: 13 }, (_, n) => `$${b + n + 1}`).join(', ')}, $${b + 14}::jsonb)`;
      });
      await q.query(`INSERT INTO crm_ted_notices (pub, kind, title, buyer, city, nuts, regions, cpv, value, lots, published_on, deadline, offers, winners) VALUES ${sql.join(', ')}
        ON CONFLICT (pub) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, buyer = EXCLUDED.buyer, city = EXCLUDED.city, nuts = EXCLUDED.nuts, regions = EXCLUDED.regions,
          cpv = EXCLUDED.cpv, value = EXCLUDED.value, lots = EXCLUDED.lots, published_on = EXCLUDED.published_on, deadline = EXCLUDED.deadline, offers = EXCLUDED.offers, winners = EXCLUDED.winners`, vals);
    }
    await q.query(`DELETE FROM crm_ted_notices WHERE published_on < CURRENT_DATE - interval '${MONTHS + 1} months'`);
  });
}

// categorie SOA in uso: profili delle BU, iniziative di Nuovi business, «Categorie in più»
async function usedCats(db, settings) {
  const cats = new Set([...(settings.concorrenza?.extra_categories || [])]);
  for (const p of Object.values(settings.profiles || {})) for (const c of p.soa || []) cats.add(c);
  const { rows } = await db.query(`SELECT DISTINCT jsonb_array_elements_text(profile->'soa') AS c FROM crm_initiatives WHERE jsonb_typeof(profile->'soa') = 'array'`);
  for (const r of rows) cats.add(r.c);
  return [...cats].map(c => String(c).toUpperCase().replace(/\s+/g, ''));
}

let running = null;
function syncTed(db, { fetchImpl, settings, log = msg => console.log(`[ted] ${msg}`) } = {}) {
  if (running) return running;
  running = (async () => {
    try {
      const st = settings || await require('./crm-commerciale').loadSettings(db);
      const codes = codesFor(await usedCats(db, st), st);
      if (!codes.length) { await db.query('INSERT INTO crm_ted_imports (rows, codes) VALUES (0, 0)'); return { rows: 0 }; }
      // prima volta (o codici nuovi): 24 mesi; poi dagli ultimi 5 giorni prima dell'ultimo caricamento riuscito
      const { rows: [last] } = await db.query(`SELECT max(at) AS at, (SELECT codes_list FROM crm_ted_imports WHERE error = '' ORDER BY at DESC LIMIT 1) AS list FROM crm_ted_imports WHERE error = ''`);
      const known = new Set(last?.list || []);
      const fresh = codes.filter(c => !known.has(c));
      const since = d => new Date(Date.now() - d * 864e5);
      const full = new Date(); full.setMonth(full.getMonth() - MONTHS);
      let list = [];
      if (fresh.length) list = list.concat(await fetchNotices(fresh, full, { fetchImpl, log }));
      const old = codes.filter(c => known.has(c));
      if (old.length && last?.at) {
        const days = Math.min(MONTHS * 31, Math.ceil((Date.now() - new Date(last.at).getTime()) / 864e5) + 5);
        list = list.concat(await fetchNotices(old, since(days), { fetchImpl, log }));
      }
      await save(db, list);
      await db.query('INSERT INTO crm_ted_imports (rows, codes, codes_list) VALUES ($1, $2, $3)', [list.length, codes.length, codes]);
      return { rows: list.length };
    } catch (err) {
      await db.query('INSERT INTO crm_ted_imports (rows, error) VALUES (0, $1)', [String(err.message).slice(0, 500)]).catch(() => {});
      log(`errore: ${err.message}`);
      throw err;
    } finally { running = null; }
  })();
  return running;
}
const isRunning = () => Boolean(running);

async function lastImport(db) {
  const { rows: [r] } = await db.query(`SELECT max(at) FILTER (WHERE error = '') AS ok, (SELECT error FROM crm_ted_imports ORDER BY at DESC LIMIT 1) AS last_error,
      (SELECT count(*)::int FROM crm_ted_notices) AS notices, (SELECT codes FROM crm_ted_imports WHERE error = '' ORDER BY at DESC LIMIT 1) AS codes FROM crm_ted_imports`);
  return { updated_at: r?.ok ? new Date(r.ok).toISOString() : null, last_error: r?.last_error || '', notices: r?.notices || 0, codes: r?.codes || 0 };
}

// ── letture ──────────────────────────────────────────────────────────────────
const isoDay = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
function whereFor(codes, regions, params) {
  params.push(codes.map(c => `${prefix(c)}%`));
  let w = `EXISTS (SELECT 1 FROM unnest(t.cpv) c WHERE c LIKE ANY($${params.length}::text[]))`;
  if (regions?.length) { params.push(regions); w += ` AND t.regions && $${params.length}::text[]`; }
  return w;
}

// Sezione «Gare europee»: codici = codesFor(categorie dell'iniziativa). opts: { view: bandi|esiti, zone: true|false|null (null = da solo), limit }
async function notices(db, { codes, regions = [], view = 'bandi', zone = null, limit = 10, months = MONTHS }) {
  if (!codes.length) return { codes: [], kpi: { open: 0, awards: 0, awards_median: null, avg_offers: null }, zone: false, rows: [], shown: 0 };
  const count = async (inZone) => {
    const params = [];
    const w = whereFor(codes, inZone ? regions : [], params);
    params.push(String(months));
    const { rows: [k] } = await db.query(`SELECT count(*) FILTER (WHERE t.kind = 'bando' AND t.deadline >= CURRENT_DATE)::int AS open,
        count(*) FILTER (WHERE t.kind = 'esito' AND t.published_on >= CURRENT_DATE - ($${params.length} || ' months')::interval)::int AS awards,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY t.value) FILTER (WHERE t.kind = 'esito' AND t.value > 0 AND t.published_on >= CURRENT_DATE - ($${params.length} || ' months')::interval)::float AS awards_median,
        avg(t.offers) FILTER (WHERE t.kind = 'esito' AND t.offers > 0 AND t.published_on >= CURRENT_DATE - ($${params.length} || ' months')::interval)::float AS avg_offers
      FROM crm_ted_notices t WHERE ${w}`, params);
    return k;
  };
  // da solo: la zona se ci sono almeno 5 bandi aperti, altrimenti tutta Italia
  const zoneK = regions.length ? await count(true) : null;
  const useZone = regions.length ? (zone === null ? zoneK.open >= 5 : Boolean(zone)) : false;
  const k = useZone ? zoneK : await count(false);
  const params = [];
  const w = whereFor(codes, useZone ? regions : [], params);
  params.push(String(months));
  const viewSql = view === 'esiti' ? `t.kind = 'esito' AND t.published_on >= CURRENT_DATE - ($${params.length} || ' months')::interval` : `t.kind = 'bando' AND t.deadline >= CURRENT_DATE AND $${params.length} <> ''`;
  const order = view === 'esiti' ? 't.published_on DESC, t.value DESC NULLS LAST' : 't.deadline, t.value DESC NULLS LAST';
  const lim = Math.min(Number(limit) || 10, 200);
  const { rows } = await db.query(`SELECT t.*, count(*) OVER ()::int AS total FROM crm_ted_notices t WHERE ${w} AND ${viewSql} ORDER BY ${order} LIMIT ${lim}`, params);
  // vincitori nel CRM (P.IVA o codice fiscale)
  const cfs = [...new Set(rows.flatMap(r => (r.winners || []).flatMap(x => [x.cf, ...(x.cfs || [])]).filter(Boolean)))];
  const subj = new Map();
  if (cfs.length) {
    const { rows: s } = await db.query(`SELECT id, name, roles, upper(vat) AS vat, upper(tax_code) AS tax FROM crm_subjects WHERE merged_into IS NULL AND (upper(vat) = ANY($1::text[]) OR upper(tax_code) = ANY($1::text[]))`, [cfs]);
    for (const x of s) { if (x.vat) subj.set(x.vat, x); if (x.tax) subj.set(x.tax, x); }
  }
  const out = rows.map(r => ({
    pub: r.pub, kind: r.kind, title: r.title, buyer: r.buyer, city: r.city, nuts: r.nuts, regions: r.regions, value: r.value === null ? null : Number(r.value), lots: r.lots,
    published_on: isoDay(r.published_on), deadline: isoDay(r.deadline), offers: r.offers, signal_id: r.signal_id || null,
    cpv: (r.cpv || []).filter(c => codes.some(x => c.startsWith(prefix(x)))).slice(0, 3).map(c => ({ code: c, label: CPV_LABEL[c] || CPV_LABEL[Object.keys(CPV_LABEL).find(x => c.startsWith(prefix(x)))] || '' })),
    winners: (r.winners || []).map(x => { const s = [x.cf, ...(x.cfs || [])].map(c => c && subj.get(c)).find(Boolean) || null; return { name: x.name, cf: x.cf || '', subject: s ? { id: s.id, name: s.name, roles: s.roles } : null }; }),
    url: `https://ted.europa.eu/it/notice/-/detail/${r.pub}`,
  }));
  return { codes, zone: useZone, zone_open: zoneK ? zoneK.open : null,
    kpi: { open: k.open, awards: k.awards, awards_median: k.awards_median, avg_offers: k.avg_offers === null ? null : Math.round(k.avg_offers * 10) / 10 },
    rows: out, shown: rows[0]?.total || 0 };
}

// completezza degli esiti TED per i codici (tutta Italia), per il riquadro «Da dove vengono i dati»
async function quality(db, codes, months = MONTHS) {
  if (!codes.length) return null;
  const params = [];
  const w = whereFor(codes, [], params);
  params.push(String(months));
  const { rows: [q] } = await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE jsonb_array_length(t.winners) > 0)::int AS winners,
      count(*) FILTER (WHERE t.offers > 0)::int AS offers, count(*) FILTER (WHERE cardinality(t.nuts) > 0)::int AS nuts,
      (SELECT count(*)::int FROM crm_ted_notices t WHERE ${w} AND t.kind = 'bando' AND t.deadline >= CURRENT_DATE) AS open
    FROM crm_ted_notices t WHERE ${w} AND t.kind = 'esito' AND t.published_on >= CURRENT_DATE - ($${params.length} || ' months')::interval`, params);
  const pct = k => (q.n ? Math.round((q[k] / q.n) * 100) : null);
  return { n: q.n, open: q.open, fields: [
    { key: 'winners', label: 'Vincitore indicato', n: q.winners, pct: pct('winners') },
    { key: 'offers', label: 'Numero di offerte ricevute', n: q.offers, pct: pct('offers') },
    { key: 'nuts', label: 'Luogo del cantiere', n: q.nuts, pct: pct('nuts') },
  ] };
}

module.exports = { CPV, CPV_LABEL, NUTS, codesFor, cpvMap, prefix, clean, toRow, fetchNotices, save, syncTed, isRunning, lastImport, notices, quality, usedCats, MONTHS };
