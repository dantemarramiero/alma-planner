// Progettisti da ANAC (ALM2-70, tavola O approvata da Dante il 23/11/2026: «capire quali progettisti lavorano per quale
// ente, quali vincono di più, così quando facciamo una gara sappiamo chi contattare»).
// - O1: gli incarichi di servizi di architettura e ingegneria (CPV qui sotto) con chi li ha vinti, dagli stessi file ANAC
//   di Concorrenza (lib/crm-anac.js: si riusano collectMonth/collectHistory con regole solo-CPV), in crm_anac_design;
// - O2: col CUP (file «cup» di ANAC) l'incarico si collega alla gara dei lavori della stessa opera, o all'opera ancora da
//   bandire nel Radar (Prima del bando);
// - O3: classifica per incarichi, valore, enti; con quali imprese finiscono in gara le opere che progetta;
// - O4: il nome del singolo ingegnere di uno studio o di un RTP ANAC non lo dà: si aggiunge nel CRM a mano.
// Un RTP conta per tutti i suoi componenti; i nomi si uniscono per codice fiscale, non per come sono scritti.
const A = require('./crm-anac');

// prefissi CPV degli incarichi tecnici (servizi di architettura e ingegneria, direzione lavori, project management)
const DESIGN_CPV = ['712', '713', '7152', '71541'];
const TYPES = [
  ['7152', 'direzione lavori'], ['71541', 'project management'], ['71248', 'direzione lavori'], ['7125', 'rilievi'],
  ['7132', 'progettazione'], ['7122', 'progettazione'], ['7124', 'progettazione'], ['7121', 'architettura'], ['712', 'architettura'],
  ['7131', 'consulenza tecnica'], ['71351', 'indagini'], ['7135', 'indagini'], ['71356', 'servizi tecnici'], ['713', 'ingegneria'],
];
const BY_LEN = [...TYPES].sort((a, b) => b[0].length - a[0].length);
const typeOf = cpv => (BY_LEN.find(([p]) => String(cpv || '').startsWith(p)) || [null, 'ingegneria'])[1];
const TYPE_KEYS = [...new Set(TYPES.map(t => t[1]))];
const prefixesOf = type => TYPES.filter(t => t[1] === type).map(t => t[0]);

// le regole di ANAC per i soli incarichi tecnici: niente categorie SOA, importo minimo più basso (gli incarichi sotto
// i 140 mila euro sono spesso affidamenti diretti, ma per sapere chi lavora con chi contano anche quelli)
const designSettings = settings => ({ profiles: {}, concorrenza: { extra_categories: [], cpv: { progettazione: DESIGN_CPV }, min_amount: Number(settings?.concorrenza?.design_min) || 20000 } });

const COLS = ['cig', 'object', 'sa_cf', 'sa_name', 'region', 'province', 'cpv', 'base_amount', 'amount', 'discount', 'bidders', 'awarded_on', 'published_on', 'pnrr', 'winners', 'parts', 'month'];
async function saveDesign(db, rows, monthOf, { keepExisting = false } = {}) {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const vals = [];
    for (const a of part) vals.push(a.cig, a.object || '', a.sa_cf || '', a.sa_name || '', a.region || '', a.province || '', a.cpv || '', a.base_amount ?? null, a.amount ?? null,
      a.discount ?? null, a.bidders == null ? null : Math.round(a.bidders), a.awarded_on || null, a.published_on || null, Boolean(a.pnrr), JSON.stringify(a.winners || []), JSON.stringify(a.parts || []), monthOf(a));
    await db.query(`INSERT INTO crm_anac_design (${COLS.join(', ')}) VALUES ${part.map((_, j) => `(${COLS.map((c, k) => `$${j * COLS.length + k + 1}`).join(', ')})`).join(', ')}
      ON CONFLICT (cig) DO ${keepExisting ? 'NOTHING' : `UPDATE SET ${COLS.filter(c => c !== 'cig').map(c => `${c} = EXCLUDED.${c}`).join(', ')}`}`, vals);
  }
}
const mark = (db, key, kept, error = '') => db.query(`INSERT INTO crm_anac_design_imports (key, kept, error, at) VALUES ($1, $2, $3, now())
  ON CONFLICT (key) DO UPDATE SET kept = EXCLUDED.kept, error = EXCLUDED.error, at = now()`, [key, kept, String(error).slice(0, 500)]);

// Ogni notte, dopo ANAC: i mesi della finestra non ancora letti, lo storico una volta (file unico fino a dicembre 2025),
// il CUP ogni 25 giorni. Un mese con errore si riprova al giro dopo.
let running = null;
function syncProgettisti(db, settings, opts = {}) {
  if (running) return running;
  running = (async () => {
    const out = [];
    const ds = designSettings(settings);
    const log = x => (opts.log || console.log)(`[progettisti] ${x}`);
    const run = job => (A.inProcess(opts) ? null : A.collectInWorker(job, ds, { log }));
    try {
      const months = await A.monthsAvailable(opts);
      const from = A.windowStart(settings);
      const { rows: done } = await db.query("SELECT key, at FROM crm_anac_design_imports WHERE error = ''");
      const have = new Map(done.map(r => [r.key, new Date(r.at)]));
      for (const m of months.filter(x => x >= from && !have.has(x)).slice(0, opts.max ?? 24)) {
        try {
          const { rows } = await (run({ kind: 'mese', month: m }) || A.collectMonth(m, ds, { ...opts, log }));
          await saveDesign(db, rows, () => m);
          await mark(db, m, rows.length);
          out.push({ month: m, kept: rows.length });
        } catch (err) { await mark(db, m, null, err.message); out.push({ month: m, error: err.message }); }
      }
      if (!have.has('storico') && opts.history !== false) {
        const S = require('./crm-anac-storico');
        const end = await S.historyEnd(opts).catch(() => null);
        if (end && from <= end) {
          try {
            const { rows } = await (run({ kind: 'storico', from, to: end }) || S.collectHistory(ds, { ...opts, from, to: end, log }));
            await saveDesign(db, rows, a => String(a.awarded_on).slice(0, 7).replace('-', ''), { keepExisting: true });
            await mark(db, 'storico', rows.length);
            out.push({ storico: `${from}–${end}`, kept: rows.length });
          } catch (err) { await mark(db, 'storico', null, err.message); out.push({ storico: `${from}–${end}`, error: err.message }); }
        }
      }
      const cupAt = have.get('cup');
      if (opts.extra !== false && (!cupAt || Date.now() - cupAt.getTime() > 25 * 864e5)) {
        const cigs = (await db.query("SELECT cig FROM crm_anac_design WHERE cup = ''")).rows.map(r => r.cig);
        if (cigs.length) {
          try {
            const X = require('./crm-anac-extra');
            const job = { cigs, files: [], cup: true };
            const r = await (run({ kind: 'extra', ...job }) || X.collectExtra(job, { ...opts, log }));
            for (let i = 0; i < r.cups.length; i += 1000) {
              const p = r.cups.slice(i, i + 1000);
              await db.query('UPDATE crm_anac_design d SET cup = v.cup FROM (SELECT unnest($1::text[]) AS cig, unnest($2::text[]) AS cup) v WHERE d.cig = v.cig',
                [p.map(x => x[0]), p.map(x => x[1])]);
            }
            if (r.errors.cup) await mark(db, 'cup', null, r.errors.cup); else await mark(db, 'cup', r.cups.length);
            out.push({ cup: r.cups.length });
          } catch (err) { await mark(db, 'cup', null, err.message); out.push({ cup: 0, error: err.message }); }
        }
      }
      await db.query(`DELETE FROM crm_anac_design WHERE awarded_on < CURRENT_DATE - ($1 || ' months')::interval`, [String(Number(settings.concorrenza.months || 24) + 1)]);
    } finally { running = null; }
    return out;
  })();
  return running;
}
const isRunning = () => Boolean(running);

// ── letture ──────────────────────────────────────────────────────────────────────────────────
const keyOf = w => (w.cf ? w.cf : `N:${String(w.name || '').toUpperCase().replace(/\s+/g, ' ').trim()}`);
const cfClean = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// filtri comuni: mesi, regioni, ente, tipo d'incarico → { sql, params } sulla tabella d
function scope({ months = 24, regions = [], sa = '', type = '' } = {}) {
  const params = [String(months)];
  let sql = `d.awarded_on >= CURRENT_DATE - ($1 || ' months')::interval`;
  if (regions.length) { params.push(regions); sql += ` AND d.region = ANY($${params.length}::text[])`; }
  if (sa) { params.push(sa); sql += ` AND d.sa_cf = $${params.length}`; }
  const pre = type ? prefixesOf(type) : [];
  if (pre.length) { params.push(pre); sql += ` AND EXISTS (SELECT 1 FROM unnest($${params.length}::text[]) p WHERE d.cpv LIKE p || '%')`; }
  return { sql, params };
}
// un incarico per ogni componente vincitore: { cig, sa_cf, sa_name, amount, cpv, cup, region, awarded_on, object, key, cf, name, role }
async function winnerRows(db, s, extra = '', extraParams = []) {
  const { rows } = await db.query(
    `SELECT d.cig, d.sa_cf, d.sa_name, d.amount, d.base_amount, d.cpv, d.cup, d.region, d.province, d.awarded_on, d.object, d.winners,
            coalesce(w->>'cf', '') AS cf, w->>'name' AS name, coalesce(w->>'role', '') AS role
       FROM crm_anac_design d, jsonb_array_elements(d.winners) w
      WHERE ${s.sql} ${extra}`, [...s.params, ...extraParams]);
  for (const r of rows) { r.key = keyOf(r); r.amount = r.amount != null ? Number(r.amount) : r.base_amount != null ? Number(r.base_amount) : null; }
  return rows;
}
const top = (map, n) => [...map.entries()].sort((a, b) => b[1].n - a[1].n || String(a[1].name).localeCompare(b[1].name)).slice(0, n).map(([k, v]) => ({ key: k, ...v }));
const bump = (map, k, name, amount = 0) => { const x = map.get(k) || { name, n: 0, valore: 0 }; x.n++; x.valore += amount || 0; map.set(k, x); return x; };

// aziende del CRM per codice fiscale o P.IVA (anche «IT…») o, senza codice, per nome uguale
async function linkCrm(db, list) {
  const cfs = [...new Set(list.map(x => cfClean(x.cf)).filter(Boolean))];
  const names = [...new Set(list.map(x => String(x.name || '').toLowerCase()).filter(Boolean))];
  if (!list.length) return;
  const { rows } = await db.query(
    `SELECT id, name, vat, tax_code, roles FROM crm_subjects WHERE merged_into IS NULL AND (
       upper(regexp_replace(regexp_replace(vat, '[^A-Za-z0-9]', '', 'g'), '^IT', '', 'i')) = ANY($1::text[]) OR upper(regexp_replace(tax_code, '[^A-Za-z0-9]', '', 'g')) = ANY($1::text[])
       OR lower(name) = ANY($2::text[]))`, [cfs, names]);
  const by = new Map();
  for (const s of rows) {
    for (const c of [cfClean(s.vat).replace(/^IT(?=\d{11}$)/, ''), cfClean(s.tax_code)]) if (c) by.set(c, s);
  }
  for (const x of list) {
    const s = (x.cf && by.get(cfClean(x.cf))) || (!x.cf && rows.find(r => r.name.toLowerCase() === String(x.name || '').toLowerCase())) || null;
    x.subject = s ? { id: s.id, name: s.name, roles: s.roles || [] } : null;
  }
}
// opere già in gara: per i CUP, la gara dei lavori (crm_anac_awards) → { cup: { cig, winners, amount, awarded_on, object } }
async function worksByCup(db, cups) {
  const list = [...new Set(cups.filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await db.query('SELECT cig, cup, object, amount, base_amount, awarded_on, winners, sa_name FROM crm_anac_awards WHERE cup = ANY($1::text[]) ORDER BY awarded_on DESC', [list]);
  const out = new Map();
  for (const r of rows) if (!out.has(r.cup)) out.set(r.cup, r);
  return out;
}
// opere ancora da bandire, per CUP: segnali del Radar (Prima del bando), triennali, opere finanziate
async function plannedByCup(db, cups) {
  const list = [...new Set(cups.filter(Boolean))];
  if (!list.length) return new Map();
  const [{ rows: sig }, { rows: tri }, { rows: fin }] = await Promise.all([
    db.query("SELECT id, cup, title, amount, stage, status FROM crm_signals WHERE cup = ANY($1::text[]) AND status NOT IN ('scartato')", [list]).catch(() => ({ rows: [] })),
    db.query('SELECT cup, title, amount, year, signal_id FROM crm_prog_interventi WHERE cup = ANY($1::text[])', [list]).catch(() => ({ rows: [] })),
    db.query('SELECT cup, title, cost AS amount, year, signal_id FROM crm_cup_works WHERE cup = ANY($1::text[])', [list]).catch(() => ({ rows: [] })),
  ]);
  const out = new Map();
  for (const r of [...fin, ...tri]) out.set(r.cup, { title: r.title, amount: r.amount != null ? Number(r.amount) : null, year: r.year, signal_id: r.signal_id || null });
  for (const s of sig) out.set(s.cup, { ...(out.get(s.cup) || {}), title: (out.get(s.cup) || {}).title || s.title, amount: (out.get(s.cup) || {}).amount ?? (s.amount != null ? Number(s.amount) : null), signal_id: s.id, stage: s.stage });
  return out;
}
const leadOf = winners => (winners || []).find(w => w.role === 'mandataria') || (winners || [])[0] || null;

// Classifica (O3) e numeri della testata
async function overview(db, { months = 24, regions = [], sa = '', type = '', q = '', sort = 'incarichi', limit = 50 } = {}) {
  const s = scope({ months, regions, sa, type });
  const rows = await winnerRows(db, s);
  const by = new Map();
  for (const r of rows) {
    const p = by.get(r.key) || { key: r.key, cf: r.cf, name: r.name, cigs: new Set(), valore: 0, enti: new Map(), regioni: new Map(), tipi: new Map(), cups: new Set(), rtp: 0 };
    if (!p.cigs.has(r.cig)) {
      p.cigs.add(r.cig);
      p.valore += r.amount || 0;
      bump(p.enti, r.sa_cf || r.sa_name, r.sa_name);
      bump(p.regioni, r.region || '—', r.region || '—');
      bump(p.tipi, typeOf(r.cpv), typeOf(r.cpv));
      if (r.cup) p.cups.add(r.cup);
      if ((r.winners || []).length > 1) p.rtp++;
    }
    if (r.name && r.name.length > String(p.name || '').length) p.name = r.name; // il nome più completo
    by.set(r.key, p);
  }
  const cigs = new Set(rows.map(r => r.cig));
  const allCups = [...new Set(rows.map(r => r.cup).filter(Boolean))];
  const [works, planned] = await Promise.all([worksByCup(db, allCups), plannedByCup(db, allCups)]);
  const qq = String(q || '').trim().toLowerCase(), qcf = cfClean(q);
  let list = [...by.values()].filter(p => !qq || String(p.name).toLowerCase().includes(qq) || (qcf.length >= 6 && p.cf.startsWith(qcf)));
  const sortBy = { incarichi: (a, b) => b.cigs.size - a.cigs.size || b.valore - a.valore, valore: (a, b) => b.valore - a.valore, enti: (a, b) => b.enti.size - a.enti.size || b.cigs.size - a.cigs.size }[sort] || ((a, b) => b.cigs.size - a.cigs.size);
  list.sort(sortBy);
  const total = list.length;
  list = list.slice(0, limit).map(p => {
    const imprese = new Map();
    for (const c of p.cups) { const w = works.get(c); const l = w && leadOf(w.winners); if (l) bump(imprese, keyOf(l), l.name); }
    return { key: p.key, cf: p.cf, name: p.name, incarichi: p.cigs.size, valore: p.valore, enti_n: p.enti.size, rtp: p.rtp,
      enti: top(p.enti, 2).map(x => ({ cf: x.key, name: x.name, n: x.n })), regioni: top(p.regioni, 2).map(x => x.name), tipi: top(p.tipi, 2).map(x => x.name),
      imprese: top(imprese, 2).map(x => ({ cf: x.key.startsWith('N:') ? '' : x.key, name: x.name, n: x.n })), in_gara: [...p.cups].filter(c => works.has(c)).length,
      da_bandire: [...p.cups].filter(c => !works.has(c) && planned.has(c)).length };
  });
  await linkCrm(db, list);
  const radar = [...by.values()].filter(p => [...p.cups].some(c => planned.get(c)?.signal_id)).length;
  return {
    kpi: { progettisti: by.size, incarichi: cigs.size, valore: [...new Map(rows.map(r => [r.cig, r.amount || 0])).values()].reduce((a, b) => a + b, 0),
      in_gara: allCups.filter(c => works.has(c)).length, da_contattare: radar },
    progettisti: list, total, types: TYPE_KEYS,
  };
}

// Scheda del progettista: enti, opere e cosa è successo dopo (O2), con chi lavora in RTP, chi lo conosce nel CRM
async function scheda(db, key, { months = 24 } = {}) {
  const s = scope({ months });
  const isName = key.startsWith('N:');
  const rows = await winnerRows(db, s, isName ? `AND w->>'cf' = '' AND upper(w->>'name') = $${s.params.length + 1}` : `AND w->>'cf' = $${s.params.length + 1}`, [isName ? key.slice(2) : key]);
  if (!rows.length) return null;
  const seen = new Set();
  const inc = rows.filter(r => !seen.has(r.cig) && seen.add(r.cig)).sort((a, b) => String(b.awarded_on).localeCompare(String(a.awarded_on)));
  const cups = inc.map(r => r.cup).filter(Boolean);
  const [works, planned] = await Promise.all([worksByCup(db, cups), plannedByCup(db, cups)]);
  const enti = new Map(), soci = new Map(), imprese = new Map(), tipi = new Map();
  for (const r of inc) {
    bump(enti, r.sa_cf || r.sa_name, r.sa_name, r.amount);
    bump(tipi, typeOf(r.cpv), typeOf(r.cpv));
    for (const w of r.winners || []) if (keyOf(w) !== key) bump(soci, keyOf(w), w.name);
    const lw = r.cup && works.get(r.cup); const l = lw && leadOf(lw.winners);
    if (l) bump(imprese, keyOf(l), l.name);
  }
  const name = rows.reduce((a, r) => (String(r.name).length > a.length ? r.name : a), '');
  const opere = inc.slice(0, 40).map(r => {
    const w = r.cup ? works.get(r.cup) : null, p = r.cup && !w ? planned.get(r.cup) : null, l = w && leadOf(w.winners);
    return { cig: r.cig, object: r.object, sa_name: r.sa_name, region: r.region, awarded_on: r.awarded_on, amount: r.amount, tipo: typeOf(r.cpv), cup: r.cup, rtp: (r.winners || []).length > 1,
      dopo: w ? { stato: 'aggiudicata', impresa: l ? { cf: l.cf || '', name: l.name } : null, amount: w.amount != null ? Number(w.amount) : w.base_amount != null ? Number(w.base_amount) : null, awarded_on: w.awarded_on, cig: w.cig }
        : p ? { stato: 'da_bandire', amount: p.amount, signal_id: p.signal_id || null, year: p.year || null } : null };
  });
  const me = { cf: isName ? '' : key, name };
  const sociL = top(soci, 6).map(x => ({ cf: x.key.startsWith('N:') ? '' : x.key, name: x.name, n: x.n }));
  const impL = top(imprese, 6).map(x => ({ cf: x.key.startsWith('N:') ? '' : x.key, name: x.name, n: x.n }));
  await linkCrm(db, [me, ...sociL, ...impL]);
  let conosce = [];
  if (me.subject) {
    const { relationsFor } = require('./crm-relazioni');
    const rel = (await relationsFor(db, [me.subject.id]))[me.subject.id];
    conosce = (rel?.people || []).filter(p => p.us).slice(0, 5).map(p => ({ contact_id: p.contact_id, name: p.name, us: p.us, emails: p.emails, meetings: p.meetings, last_at: p.last_at }));
    if (!conosce.length && rel?.us) conosce = [{ name: '', us: rel.us, emails: rel.direct?.emails || 0, meetings: rel.direct?.meetings || 0, last_at: rel.last_at }];
  }
  return { key, cf: me.cf, name, subject: me.subject, incarichi: inc.length, valore: inc.reduce((a, r) => a + (r.amount || 0), 0),
    enti: top(enti, 8).map(x => ({ cf: x.key, name: x.name, n: x.n, valore: x.valore })), tipi: top(tipi, 3).map(x => x.name), soci: sociL, imprese: impL, opere, conosce,
    in_gara: opere.filter(o => o.dopo?.stato === 'aggiudicata').length, da_bandire: opere.filter(o => o.dopo?.stato === 'da_bandire').length };
}

// I progettisti di un ente (scheda dell'ente nel CRM): incarichi negli ultimi mesi e i primi n
async function perEnte(db, saCfs, { months = 24, n = 5 } = {}) {
  const cfs = [...new Set(saCfs.map(cfClean).filter(Boolean))];
  if (!cfs.length) return { incarichi: 0, progettisti: [] };
  const s = scope({ months });
  const rows = await winnerRows(db, s, `AND d.sa_cf = ANY($${s.params.length + 1}::text[])`, [cfs]);
  const by = new Map();
  for (const r of rows) { const x = by.get(r.key) || { key: r.key, cf: r.cf, name: r.name, cigs: new Set(), valore: 0 }; if (!x.cigs.has(r.cig)) { x.cigs.add(r.cig); x.valore += r.amount || 0; } by.set(r.key, x); }
  const list = [...by.values()].sort((a, b) => b.cigs.size - a.cigs.size || b.valore - a.valore).slice(0, n).map(x => ({ key: x.key, cf: x.cf, name: x.name, n: x.cigs.size, valore: x.valore }));
  await linkCrm(db, list);
  return { incarichi: new Set(rows.map(r => r.cig)).size, progettisti: list };
}

// «Chi l'ha progettata» in una gara o in un segnale del Radar: stesso CUP; senza CUP i più forti con lo stesso ente
async function perGara(db, { cup = '', sa = '' } = {}, { months = 24 } = {}) {
  if (cup) {
    const s = scope({ months: 120 });
    const rows = await winnerRows(db, s, `AND d.cup = $${s.params.length + 1}`, [cup]);
    if (rows.length) {
      const keys = [...new Set(rows.map(r => r.key))];
      const out = [];
      for (const k of keys.slice(0, 3)) {
        const r = rows.find(x => x.key === k);
        const st = await scheda(db, k, { months });
        out.push({ key: k, cf: r.cf, name: st?.name || r.name, subject: st?.subject || null, incarico: { cig: r.cig, object: r.object, awarded_on: r.awarded_on, amount: r.amount, tipo: typeOf(r.cpv) },
          incarichi: st?.incarichi || 1, con_ente: st?.enti.find(e => e.cf === r.sa_cf)?.n || 1, ente: r.sa_name, conosce: st?.conosce || [] });
      }
      return { how: 'cup', progettisti: out };
    }
  }
  if (sa) {
    const e = await perEnte(db, [sa], { months, n: 3 });
    if (e.progettisti.length) return { how: 'ente', incarichi: e.incarichi, progettisti: e.progettisti };
  }
  return { how: '', progettisti: [] };
}

module.exports = { DESIGN_CPV, TYPE_KEYS, typeOf, designSettings, saveDesign, syncProgettisti, isRunning, overview, scheda, perEnte, perGara, linkCrm, keyOf };
