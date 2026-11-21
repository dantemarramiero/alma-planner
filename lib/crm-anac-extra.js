// ANAC, dati che arrivano dopo l'aggiudicazione (ALM2-49, 21/11/2026): subappalti autorizzati (un file al mese più
// il file unico fino a dicembre 2025) e CUP (un file unico aggiornato ogni mese, CIG → CUP per OpenCUP).
// Si cercano per tutte le gare già nel database, non solo quelle del mese. Gira nel worker; il database lo scrive il server.

const A = require('./crm-anac');

const BASE = 'https://dati.anticorruzione.it/opendata';
const monthUrl = (ds, m) => `${BASE}/download/dataset/${ds}/filesystem/${m}01-${ds}_csv.zip`;
const fullUrl = ds => `${BASE}/download/dataset/${ds}/filesystem/${ds}_csv.zip`;

// files: [{ key: 'subappalti:202604', url }], cup: true/false → { subs, cups, done: { key: righe }, errors: { key: messaggio } }
async function collectExtra({ cigs, files = [], cup = false }, { fetchImpl = fetch, log = () => {} } = {}) {
  const want = new Set(cigs);
  const has = c => want.has(c);
  const subs = new Map(), cups = [], done = {}, errors = {};
  for (const f of files) {
    let n = 0;
    try {
      for await (const r of A.fetchRows(f.url, { fetchImpl, quick: has })) {
        const cig = String(r.cig || '').toUpperCase();
        const cf = String(r.codice_fiscale || '').toUpperCase().trim();
        if (!has(cig) || !r.id_subappalto) continue;
        const id = `${r.id_subappalto}:${cf}`;
        if (subs.has(id)) continue;
        subs.set(id, { id, cig, cf, name: String(r.denominazione || '').trim().slice(0, 200), by_cf: String(r.cf_subappaltante || '').toUpperCase().trim(),
          category: A.normCat(r.cod_categoria), cat_type: /PREVALENTE/i.test(r.descrizione_tipo_categoria) ? 'prevalente' : /SCORPORABILE/i.test(r.descrizione_tipo_categoria) ? 'scorporabile' : '',
          cpv: String(r.cod_cpv || '').replace(/\D/g, ''), object: String(r.oggetto || '').slice(0, 300), authorized_on: A.date(r.data_autorizzazione) });
        n++;
      }
      done[f.key] = n;
      log(`${f.key}: ${n} subappalti delle nostre gare`);
    } catch (e) { errors[f.key] = e.message; log(`${f.key} non letto (${e.message})`); }
  }
  if (cup) {
    try {
      for await (const r of A.fetchRows(fullUrl('cup'), { fetchImpl, quick: has })) {
        const cig = String(r.cig || '').toUpperCase(), c = String(r.cup || '').toUpperCase().trim();
        if (has(cig) && c) cups.push([cig, c.slice(0, 20)]);
      }
      done.cup = cups.length;
      log(`cup: ${cups.length} gare con il CUP`);
    } catch (e) { errors.cup = e.message; log(`cup non letto (${e.message})`); }
  }
  return { subs: [...subs.values()], cups, done, errors };
}

// Quali file servono adesso: i subappalti dei mesi pubblicati non ancora letti, il file unico una volta, il CUP ogni 25 giorni
async function extraTodo(db, months) {
  const { rows } = await db.query("SELECT key, at FROM crm_anac_extra_imports WHERE error = ''");
  const have = new Map(rows.map(r => [r.key, new Date(r.at)]));
  const files = months.filter(m => !have.has(`subappalti:${m}`)).map(m => ({ key: `subappalti:${m}`, url: monthUrl('subappalti', m) }));
  if (!have.has('subappalti:storico')) files.push({ key: 'subappalti:storico', url: fullUrl('subappalti') });
  const cupAt = have.get('cup');
  return { files, cup: !cupAt || Date.now() - cupAt.getTime() > 25 * 864e5 };
}

async function saveExtra(db, { subs, cups, done, errors }) {
  for (let i = 0; i < subs.length; i += 300) {
    const part = subs.slice(i, i + 300);
    const cols = ['id', 'cig', 'cf', 'name', 'by_cf', 'category', 'cat_type', 'cpv', 'object', 'authorized_on'];
    await db.query(`INSERT INTO crm_anac_subcontracts (${cols.join(', ')}) VALUES ${part.map((_, j) => `(${cols.map((c, k) => `$${j * cols.length + k + 1}`).join(', ')})`).join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(', ')}`, part.flatMap(s => cols.map(c => s[c] ?? null)));
  }
  for (let i = 0; i < cups.length; i += 1000) {
    const part = cups.slice(i, i + 1000);
    await db.query(`UPDATE crm_anac_awards a SET cup = v.cup FROM (SELECT unnest($1::text[]) AS cig, unnest($2::text[]) AS cup) v WHERE a.cig = v.cig AND a.cup <> v.cup`,
      [part.map(x => x[0]), part.map(x => x[1])]);
  }
  for (const [key, n] of Object.entries(done)) {
    await db.query(`INSERT INTO crm_anac_extra_imports (key, rows, error, at) VALUES ($1, $2, '', now()) ON CONFLICT (key) DO UPDATE SET rows = EXCLUDED.rows, error = '', at = now()`, [key, n]);
  }
  for (const [key, msg] of Object.entries(errors)) {
    await db.query(`INSERT INTO crm_anac_extra_imports (key, error, at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET error = EXCLUDED.error, at = now()`, [key, String(msg).slice(0, 500)]);
  }
}

module.exports = { collectExtra, extraTodo, saveExtra, monthUrl, fullUrl };
