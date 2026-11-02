// Import di Alma Energy dai file Excel della BU Energy.
// - Screening dei tetti in Abruzzo (foglio «Edifici»): un'opportunità PPA on-site per edificio, chiave = ID OSM (ALM2-10).
// - Database impianti incentivati in Conto Energia (foglio «Impianti»): tutte le convenzioni nel database; in pipeline
//   un'opportunità per proprietario con almeno una convenzione di priorità A o B (ALM2-12, deciso da Dante il 30/10).
// Rifare un import aggiorna i dati del file senza toccare stadio, note, responsabile e nome dati a mano.
const { HttpError } = require('./http');
const { readXlsx } = require('./xlsx');
const { getParams, scoreRoof, ceEffective, rescoreRoof, OWNER_KEY_SQL } = require('./energy-tiers');

const ABRUZZO = new Set(['chieti', 'pescara', 'teramo', "l'aquila", 'laquila']);
const PRIORITY_ORDER = ['A', 'B', 'C', 'D', 'Dati insufficienti'];
const bestPriority = list => PRIORITY_ORDER.find(p => list.includes(p)) || list[0] || '';
const str = v => (v === null || v === undefined ? '' : String(v).trim());
const numOrNull = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Righe del foglio come oggetti, partendo dalla riga d'intestazione che contiene `marker`.
function sheetObjects(book, sheetName, marker) {
  const rows = book[sheetName];
  if (!rows) throw new HttpError(400, `Nel file manca il foglio «${sheetName}»`);
  const headerIdx = rows.findIndex(r => r.some(c => str(c) === marker));
  if (headerIdx < 0) throw new HttpError(400, `Nel foglio «${sheetName}» manca la colonna «${marker}»`);
  const header = rows[headerIdx].map(str);
  const items = rows.slice(headerIdx + 1).filter(r => r.some(c => c !== null && c !== undefined && c !== '')).map(r => {
    const obj = Object.fromEntries(header.map((h, i) => [h, r[i] ?? null]));
    Object.defineProperty(obj, 'raw', { value: r }); // per le colonne con lo stesso nome (le due «Note»)
    return obj;
  });
  return { header, items };
}

function readBook(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Carica il file Excel');
  try {
    return readXlsx(buf);
  } catch (err) {
    throw new HttpError(400, err instanceof HttpError ? err.message : 'Il file non è un Excel (.xlsx) leggibile');
  }
}

// ── screening dei tetti (PPA on-site) ─────────────────────────────────────────────────────────
function parseScreening(buf) {
  const { items } = sheetObjects(readBook(buf), 'Edifici', 'ID OSM');
  return items.filter(r => str(r['ID OSM'])).map(r => {
    const company = str(r.Azienda);
    const city = str(r.Comune);
    const area = numOrNull(r['Superficie tetto (m²)']);
    const kwp = numOrNull(r['kWp stimati']);
    const capexK = numOrNull(r['Capex indicativo (k€)']);
    return {
      key: str(r['ID OSM']),
      title: company || `Capannone ${city}${area ? ` (${Math.round(area).toLocaleString('it-IT')} m²)` : ''}`,
      company,
      priority: str(r['Priorità']),
      mw: kwp === null ? null : kwp / 1000,
      capex: capexK === null ? null : Math.round(capexK * 1000),
      city,
      province: str(r.Provincia),
      region: ABRUZZO.has(str(r.Provincia).toLowerCase()) ? 'Abruzzo' : '',
      lat: numOrNull(r.Lat),
      lon: numOrNull(r.Lon),
      data: {
        fonte: 'Screening tetti', rank: numOrNull(r.Rank), punteggio: numOrNull(r.Punteggio), punti_taglia: numOrNull(r['Punti taglia']),
        punti_profilo: numOrNull(r['Punti profilo']), profilo: str(r['Profilo consumi']), attivita: str(r['Attività']),
        giorni: numOrNull(r['Giorni/sett']), turni: str(r.Turni), motivazione: str(r['Motivazione profilo']), confidenza: str(r.Confidenza),
        area_produttiva: str(r['Area produttiva']), superficie: area, kwp, kwh_kwp: numOrNull(r['kWh/kWp anno']), mwh: numOrNull(r['MWh/anno']),
        ricavi_k: numOrNull(r['Ricavi lordi (k€/anno)']), fv_osm: str(r['FV già mappato OSM']), fonte_dati: str(r.Fonte),
      },
    };
  });
}

// Azienda del CRM per nome (maiuscole a parte), creata se non c'è.
async function companyByName(q, name, defaults, userId) {
  const { rows: [found] } = await q.query('SELECT id, types FROM energy_companies WHERE lower(name) = lower($1) LIMIT 1', [name]);
  if (found) {
    if (!found.types.includes(defaults.type)) await q.query('UPDATE energy_companies SET types = array_append(types, $2) WHERE id = $1', [found.id, defaults.type]);
    return { id: found.id, created: false };
  }
  const { rows: [c] } = await q.query(
    `INSERT INTO energy_companies (name, vat, types, city, province, region, source, extra, owner_id, created_by)
     VALUES ($1, $2, ARRAY[$3]::text[], $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
    [name, defaults.vat || '', defaults.type, defaults.city || '', defaults.province || '', defaults.region || '', defaults.source, JSON.stringify(defaults.extra || {}), userId]);
  return { id: c.id, created: true };
}

async function planScreening(db, buf) {
  // punteggio, priorità e numeri dell'impianto con i parametri in uso (uguali al file finché non si cambiano)
  const params = (await getParams(db)).screening;
  const rows = parseScreening(buf).map(r => {
    const s = scoreRoof(r.data, params);
    return s ? { ...r, priority: s.priority, mw: s.mw, capex: s.capex, data: { ...r.data, ...s.data } } : r;
  });
  const { rows: existing } = await db.query("SELECT source_key FROM energy_opportunities WHERE kind = 'ppa_onsite' AND source_key IS NOT NULL");
  const known = new Set(existing.map(r => r.source_key));
  const byPriority = {};
  for (const r of rows) byPriority[r.priority || '—'] = (byPriority[r.priority || '—'] || 0) + 1;
  return {
    rows,
    summary: {
      total: rows.length,
      new: rows.filter(r => !known.has(r.key)).length,
      updated: rows.filter(r => known.has(r.key)).length,
      withCompany: rows.filter(r => r.company).length,
      byPriority,
    },
  };
}

// Tetti nel kanban del PPA on-site: nuovi «Da qualificare», quelli già presenti (stessa chiave OSM) aggiornati
// senza toccare stadio, nome, note e responsabile. Il profilo corretto a mano dalla scheda resta (profilo_manuale).
// Usato dall'import del file e dallo screening per provincia (energy-screening.js).
async function upsertRoofs(q, rows, userId, note) {
  const out = { created: 0, updated: 0, companiesCreated: 0 };
  const companyIds = new Map();
  const manual = [];
  for (const r of rows) {
    let companyId = null;
    if (r.company) {
      if (!companyIds.has(r.company.toLowerCase())) {
        const c = await companyByName(q, r.company, {
          type: 'cliente', city: r.city, province: r.province, region: r.region, source: 'Screening tetti',
          extra: { profilo_consumo: ['D1', 'D2', 'D3', 'D4', 'ND'].includes(r.data.profilo) ? r.data.profilo : undefined, superficie_tetti: r.data.superficie ?? undefined },
        }, userId);
        companyIds.set(r.company.toLowerCase(), c.id);
        if (c.created) out.companiesCreated++;
      }
      companyId = companyIds.get(r.company.toLowerCase());
    }
    const { rows: [upd] } = await q.query(
      `UPDATE energy_opportunities SET priority = $2, mw = $3, capex = $4, city = $5, province = $6, region = $7, lat = $8, lon = $9,
              data = data || $10::jsonb || CASE WHEN (data->>'profilo_manuale') = 'true' THEN jsonb_build_object('profilo', data->'profilo') ELSE '{}'::jsonb END,
              company_id = COALESCE(company_id, $11), updated_at = now()
        WHERE kind = 'ppa_onsite' AND source_key = $1 RETURNING id, (data->>'profilo_manuale') = 'true' AS manual`,
      [r.key, r.priority, r.mw, r.capex, r.city, r.province, r.region, r.lat, r.lon, JSON.stringify(r.data), companyId]);
    if (upd) {
      out.updated++;
      if (upd.manual) manual.push(upd.id);
      continue;
    }
    const { rows: [o] } = await q.query(
      `INSERT INTO energy_opportunities (kind, title, stage, priority, mw, capex, city, province, region, lat, lon, data, company_id, source_key, owner_id, created_by)
       VALUES ('ppa_onsite', $1, 'da_qualificare', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
      [r.title, r.priority, r.mw, r.capex, r.city, r.province, r.region, r.lat, r.lon, JSON.stringify(r.data), companyId, r.key, userId]);
    await q.query("INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, 'da_qualificare', $3, $2)", [o.id, userId, note]);
    if (companyId) await q.query("INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, 'cliente') ON CONFLICT DO NOTHING", [o.id, companyId]);
    out.created++;
  }
  // profilo scelto a mano: punteggio e priorità con quel profilo, non con quello del file o di OpenStreetMap
  for (const id of manual) await rescoreRoof(q, id);
  return out;
}

async function importScreening(db, buf, { userId, fileName = '' }) {
  const plan = await planScreening(db, buf);
  let out;
  await db.tx(async q => {
    out = await upsertRoofs(q, plan.rows, userId, 'Import dello screening tetti');
    await q.query("INSERT INTO energy_imports (kind, file_name, summary, user_id) VALUES ('screening_tetti', $1, $2, $3)", [fileName, JSON.stringify({ ...plan.summary, ...out }), userId]);
  });
  return { ...out, summary: plan.summary };
}

// ── Database impianti incentivati in Conto Energia (revamping) ─────────────────────────────────
// Segnali dalle note del file: chiave, etichetta e testo che li riconosce.
const SIGNALS = [
  ['sottoperformance', 'Sottoperformance', /possibile sottoperformance/i],
  ['acquisto_blocco', 'Acquisto in blocco', /acquisto in blocco/i],
  ['operatore_strutturato', 'Operatore strutturato', /operatore strutturato/i],
  ['in_liquidazione', 'In liquidazione', /in liquidazione/i],
  ['acquistato_di_recente', 'Acquistato di recente', /acquistato di recente/i],
  ['erogazioni_azzerate', 'Erogazioni quasi azzerate', /erogazioni quasi azzerate/i],
  ['piu_beneficiari', 'Più beneficiari', /più beneficiari/i],
  ['non_strategico', 'Impianto non strategico', /non strategico/i],
  ['cambio_proprieta', 'Cambio di proprietà', /cambio di proprietà|cambio proprietà/i],
];
const signalsOf = text => SIGNALS.filter(([, , re]) => re.test(text)).map(([k]) => k);

function parseConventions(buf) {
  const { header, items } = sheetObjects(readBook(buf), 'Impianti', 'Convenzione GSE');
  const years = header.map(h => /^Incasso (\d{4}) €$/.exec(h)?.[1]).filter(Boolean);
  // due colonne «Note»: la seconda prende il nome «Note» anche lei; si leggono per posizione
  const noteCols = header.map((h, i) => (h === 'Note' ? i : -1)).filter(i => i >= 0);
  return items.filter(r => str(r['Convenzione GSE'])).map(r => {
    const raw = r.raw;
    const notes = noteCols[0] !== undefined ? str(raw[noteCols[0]]) : '';
    const notes2 = noteCols[1] !== undefined ? str(raw[noteCols[1]]) : '';
    return {
      convention: str(r['Convenzione GSE']),
      rank: numOrNull(r['N.']),
      priority: str(r['Priorità']),
      owner_name: str(r.Proprietario),
      owner_vat: str(r['P.IVA']).replace(/\s/g, ''),
      province: str(r['Provincia (sede)']),
      region: str(r['Regione (sede)']) === 'n.d.' ? '' : str(r['Regione (sede)']),
      owner_type: str(r['Tipo di proprietario']),
      revenue_class: str(r['Classe di incasso']),
      payments: Object.fromEntries(years.map(y => [y, numOrNull(r[`Incasso ${y} €`])]).filter(([, v]) => v !== null)),
      avg_before: numOrNull(r['Incasso medio 2016-2019 €']),
      avg_recent: numOrNull(r['Incasso medio 2023-2025 €']),
      variation: numOrNull(r.Variazione),
      lost_per_year: numOrNull(r['Incassi persi €/anno']),
      trend: str(r.Andamento),
      signals: signalsOf(`${notes} ${notes2}`),
      notes,
      notes2,
      last_owner_change: numOrNull(r['Ultimo cambio proprietà']),
      previous_owner: str(r['Proprietario precedente']),
    };
  });
}

// Chiave del proprietario: la P.IVA, o il nome quando manca.
const ownerKey = c => (c.owner_vat ? c.owner_vat : `nome:${c.owner_name.toLowerCase()}`);

async function planConventions(db, buf) {
  // priority_file = quella del file; priority = quella in uso (del file, o delle regole di Alma Energy)
  const params = (await getParams(db)).database_ce;
  const rows = parseConventions(buf).map(c => ({ ...c, priority_file: c.priority, ...ceEffective({ ...c, priority_file: c.priority }, params) }));
  const { rows: existing } = await db.query('SELECT convention FROM energy_conventions');
  const known = new Set(existing.map(r => r.convention));
  const owners = new Map();
  for (const c of rows) {
    const k = ownerKey(c);
    owners.set(k, [...(owners.get(k) || []), c.priority]);
  }
  const byPriority = {};
  for (const c of rows) byPriority[c.priority || '—'] = (byPriority[c.priority || '—'] || 0) + 1;
  return {
    rows,
    summary: {
      total: rows.length, new: rows.filter(c => !known.has(c.convention)).length, updated: rows.filter(c => known.has(c.convention)).length,
      owners: owners.size, ownersToPipeline: [...owners.values()].filter(p => p.includes('A') || p.includes('B')).length, byPriority,
    },
  };
}

// Dati del proprietario sull'opportunità: somme e riepilogo delle sue convenzioni.
async function refreshRevamping(q, oppIds) {
  if (!oppIds.length) return;
  const { rows } = await q.query('SELECT * FROM energy_conventions WHERE opportunity_id = ANY($1::int[]) ORDER BY rank NULLS LAST', [oppIds]);
  const byOpp = new Map();
  for (const c of rows) byOpp.set(c.opportunity_id, [...(byOpp.get(c.opportunity_id) || []), c]);
  for (const [id, list] of byOpp) {
    const sum = key => list.reduce((s, c) => s + (Number(c[key]) || 0), 0);
    const payments = {};
    for (const c of list) for (const [y, v] of Object.entries(c.payments || {})) payments[y] = (payments[y] || 0) + Number(v);
    const data = {
      fonte: 'Database Conto Energia',
      convenzioni: list.length,
      // solo le convenzioni che perdono: quelle che incassano più di prima non compensano le altre
      incassi_persi: list.reduce((s, c) => s + Math.max(0, Number(c.lost_per_year) || 0), 0),
      incasso_recente: sum('avg_recent'),
      incasso_prima: sum('avg_before'),
      tipo_proprietario: list[0].owner_type,
      classe_incasso: list[0].revenue_class,
      andamenti: [...new Set(list.map(c => c.trend).filter(Boolean))],
      segnali: [...new Set(list.flatMap(c => c.signals))],
      ultimo_cambio: Math.max(0, ...list.map(c => c.last_owner_change || 0)) || null,
      incassi: payments,
    };
    await q.query(
      'UPDATE energy_opportunities SET priority = $2, data = data || $3::jsonb, updated_at = now() WHERE id = $1',
      [id, bestPriority(list.map(c => c.priority)), JSON.stringify(data)]);
  }
}

// Porta in pipeline i proprietari indicati (chiavi di ownerKey): azienda nel CRM, opportunità «Da analizzare»,
// convenzioni collegate. Chi è già in pipeline resta com'è.
async function ownersToPipeline(q, keys, userId) {
  const out = { opportunities: 0, companiesCreated: 0 };
  if (!keys.length) return out;
  const { rows } = await q.query(
    `SELECT ${OWNER_KEY_SQL} AS k, * FROM energy_conventions WHERE ${OWNER_KEY_SQL} = ANY($1::text[]) ORDER BY rank NULLS LAST`, [keys]);
  const byOwner = new Map();
  for (const c of rows) byOwner.set(c.k, [...(byOwner.get(c.k) || []), c]);
  const touched = [];
  for (const [k, list] of byOwner) {
    const { rows: [already] } = await q.query("SELECT id FROM energy_opportunities WHERE kind = 'revamping' AND source_key = $1", [`proprietario:${k}`]);
    if (already) {
      // solo le convenzioni nuove: quelle staccate in un'opportunità loro restano dove sono
      await q.query(`UPDATE energy_conventions SET opportunity_id = $1 WHERE ${OWNER_KEY_SQL} = $2 AND opportunity_id IS NULL`, [already.id, k]);
      touched.push(already.id);
      continue;
    }
    // tutte le convenzioni del proprietario sono già in opportunità staccate: niente opportunità nuova vuota
    if (list.every(c => c.opportunity_id)) {
      touched.push(...new Set(list.map(c => c.opportunity_id)));
      continue;
    }
    const first = list[0];
    let companyId;
    const { rows: [byVat] } = first.owner_vat ? await q.query('SELECT id, types FROM energy_companies WHERE vat = $1', [first.owner_vat]) : { rows: [] };
    if (byVat) {
      companyId = byVat.id;
      if (!byVat.types.includes('proprietario')) await q.query("UPDATE energy_companies SET types = array_append(types, 'proprietario') WHERE id = $1", [companyId]);
    } else {
      const c = await companyByName(q, first.owner_name, {
        type: 'proprietario', vat: first.owner_vat, province: first.province, region: first.region, source: 'Database Conto Energia',
        extra: { convenzioni: list.length, incassi_gse: Math.round(list.reduce((s, x) => s + (Number(x.avg_recent) || 0), 0)), ultimo_cambio_proprieta: first.last_owner_change ?? undefined },
      }, userId);
      companyId = c.id;
      if (c.created) out.companiesCreated++;
    }
    const { rows: [o] } = await q.query(
      `INSERT INTO energy_opportunities (kind, title, stage, province, region, company_id, source_key, owner_id, created_by)
       VALUES ('revamping', $1, 'da_analizzare', $2, $3, $4, $5, $6, $6) RETURNING id`,
      [`${first.owner_name}${list.length > 1 ? ` (${list.length} convenzioni)` : ''}`, first.province, first.region, companyId, `proprietario:${k}`, userId]);
    await q.query("INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, 'da_analizzare', 'Dal Database Conto Energia', $2)", [o.id, userId]);
    await q.query("INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, 'proprietario') ON CONFLICT DO NOTHING", [o.id, companyId]);
    await q.query(`UPDATE energy_conventions SET opportunity_id = $1 WHERE ${OWNER_KEY_SQL} = $2 AND opportunity_id IS NULL`, [o.id, k]);
    touched.push(o.id);
    out.opportunities++;
  }
  await refreshRevamping(q, touched);
  return out;
}

async function importConventions(db, buf, { userId, fileName = '' }) {
  const plan = await planConventions(db, buf);
  let out;
  await db.tx(async q => {
    // a blocchi: un INSERT da JSON per 1.000 convenzioni (il file ne ha più di 12.000)
    for (let i = 0; i < plan.rows.length; i += 1000) {
      const chunk = plan.rows.slice(i, i + 1000);
      await q.query(
        `INSERT INTO energy_conventions (convention, rank, priority, priority_file, score, owner_name, owner_vat, province, region, owner_type, revenue_class, payments,
                avg_before, avg_recent, variation, lost_per_year, trend, signals, notes, notes2, last_owner_change, previous_owner, imported_at)
         SELECT x.convention, x.rank, x.priority, x.priority_file, x.score, x.owner_name, x.owner_vat, x.province, x.region, x.owner_type, x.revenue_class, x.payments,
                x.avg_before, x.avg_recent, x.variation, x.lost_per_year, x.trend, ARRAY(SELECT jsonb_array_elements_text(x.signals)),
                x.notes, x.notes2, x.last_owner_change, x.previous_owner, now()
           FROM jsonb_to_recordset($1::jsonb) AS x(convention text, rank int, priority text, priority_file text, score float8, owner_name text, owner_vat text, province text,
                region text, owner_type text, revenue_class text, payments jsonb, avg_before numeric, avg_recent numeric, variation float8,
                lost_per_year numeric, trend text, signals jsonb, notes text, notes2 text, last_owner_change int, previous_owner text)
         ON CONFLICT (convention) DO UPDATE SET rank = EXCLUDED.rank, priority = EXCLUDED.priority, priority_file = EXCLUDED.priority_file, score = EXCLUDED.score, owner_name = EXCLUDED.owner_name,
                owner_vat = EXCLUDED.owner_vat, province = EXCLUDED.province, region = EXCLUDED.region, owner_type = EXCLUDED.owner_type,
                revenue_class = EXCLUDED.revenue_class, payments = EXCLUDED.payments, avg_before = EXCLUDED.avg_before, avg_recent = EXCLUDED.avg_recent,
                variation = EXCLUDED.variation, lost_per_year = EXCLUDED.lost_per_year, trend = EXCLUDED.trend, signals = EXCLUDED.signals,
                notes = EXCLUDED.notes, notes2 = EXCLUDED.notes2, last_owner_change = EXCLUDED.last_owner_change,
                previous_owner = EXCLUDED.previous_owner, imported_at = now()`,
        [JSON.stringify(chunk)]);
    }
    // in pipeline i proprietari con almeno una convenzione A o B; quelli già in pipeline si aggiornano
    const { rows: keys } = await q.query(
      `SELECT DISTINCT ${OWNER_KEY_SQL} AS k FROM energy_conventions WHERE priority IN ('A', 'B')
       UNION SELECT DISTINCT ${OWNER_KEY_SQL} FROM energy_conventions WHERE opportunity_id IS NOT NULL`);
    out = await ownersToPipeline(q, keys.map(r => r.k), userId);
    await q.query("INSERT INTO energy_imports (kind, file_name, summary, user_id) VALUES ('database_ce', $1, $2, $3)", [fileName, JSON.stringify({ ...plan.summary, ...out }), userId]);
  });
  return { ...out, summary: plan.summary };
}

module.exports = {
  parseScreening, planScreening, importScreening, upsertRoofs, companyByName,
  parseConventions, planConventions, importConventions, ownersToPipeline, refreshRevamping,
  SIGNALS: SIGNALS.map(([k, label]) => [k, label]), OWNER_KEY_SQL, PRIORITY_ORDER,
};
