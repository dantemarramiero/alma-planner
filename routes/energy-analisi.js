// Alma Energy · Analisi economico-finanziarie (ALM2-74 tappa 2). Le rotte stanno sotto /api/energy, già riservate ai
// membri del modulo (routes/energy.js). Un'analisi ha versioni: scenario del simulatore (numeri letti dallo scenario,
// che si cambia nel simulatore) o file esterno (Excel/PDF del consulente o della banca, numeri scritti a mano).
// L'analisi «di riferimento» di un'opportunità porta i numeri della sua ultima versione sull'opportunità
// (mw, capex, data.scenario), da dove li leggono la pipeline, il cruscotto e l'export.
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { PROJECT_TYPES } = require('../lib/energy-iter');
const { runScenario, summaryOf } = require('../lib/energy-scenarios');

const MODELS = ['fv_classico', 'revamping', 'ppa_onsite'];
const MODEL_OF_TYPE = { fv_nuovo: 'fv_classico', acquisizione: 'revamping', revamping: 'revamping', ppa_onsite: 'ppa_onsite' };
const KPI_KEYS = ['irr', 'irrProject', 'npv', 'payback', 'dscrMin', 'capex', 'mw'];
const FILE_MAX = 25 * 1024 * 1024;
const toBuffer = d => (Buffer.isBuffer(d) ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength));
const safeFilename = s => String(s || 'file').replace(/[\r\n"\\/]/g, '_').slice(0, 200);

// Numeri di una versione del simulatore, con gli stessi nomi dei file: IRR equity (levered), IRR di progetto, VAN…
// Per il FV classico (piano a tre anni) l'IRR è quello a 25 anni degli impianti tenuti.
function kpiOfSummary(s = {}) {
  return {
    irr: s.irr ?? s.irrC25 ?? null, irrProject: s.irrUnlevered ?? null, npv: s.npv ?? null, payback: s.payback ?? null,
    dscrMin: s.dscrMin ?? null, capex: s.capex ?? null, mw: s.mw ?? null,
  };
}

// Numeri scritti a mano per un file: percentuali come frazioni (0,134), importi in euro, MW.
function cleanKpi(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'I numeri dell\'analisi non sono validi');
  const out = {};
  for (const k of KPI_KEYS) {
    const val = raw[k];
    if (val === undefined || val === null || val === '') continue;
    const n = typeof val === 'number' ? val : Number(String(val).replace(/\s|€|%/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new HttpError(400, `Il numero «${k}» non è valido`);
    out[k] = n;
  }
  return out;
}

// Flussi annui per l'equity e sensitività sull'IRR, per il grafico e la tabella della scheda.
function detailOfScenario(model, input) {
  const r = runScenario(model, input);
  const rows = model === 'revamping' ? r.gestione?.rows : model === 'ppa_onsite' ? r.flows?.rows : null;
  const flows = rows ? rows.map(x => ({ year: x.year, t: x.t, fcf: x.fcfLevered, incentive: Boolean(x.extraRevenue) })) : [];
  const sens = {};
  for (const [k, list] of Object.entries(r.sensitivity || {})) {
    if (Array.isArray(list)) sens[k] = list.map(x => ({ delta: x.delta, irr: x.irrLevered ?? null }));
  }
  return { flows, sensitivity: sens, summary: summaryOf(r) };
}

function registerEnergyAnalisi(app, { db, opportunityById }) {
  async function analysisById(q, id) {
    const { rows: [a] } = await q.query(
      `SELECT a.*, o.title AS opportunity_title, o.selection, o.kind AS opportunity_kind, u.name AS created_by_name
         FROM energy_analyses a LEFT JOIN energy_opportunities o ON o.id = a.opportunity_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = $1`, [id]);
    if (!a) throw new HttpError(404, 'Analisi non trovata');
    return a;
  }
  // versioni con i numeri (dallo scenario o scritti a mano), senza i byte del file
  async function versionsOf(q, analysisId) {
    const { rows } = await q.query(
      `SELECT x.id, x.n, x.label, x.note, x.source, x.scenario_id, x.file_name, x.content_type, x.file_size, x.kpi, x.created_at,
              s.model, s.summary, s.name AS scenario_name, s.updated_at AS scenario_updated_at, u.name AS created_by_name
         FROM energy_analysis_versions x LEFT JOIN energy_scenarios s ON s.id = x.scenario_id LEFT JOIN users u ON u.id = x.created_by
        WHERE x.analysis_id = $1 ORDER BY x.n`, [analysisId]);
    return rows.map(x => ({ ...x, kpi: x.source === 'simulatore' ? kpiOfSummary(x.summary || {}) : x.kpi || {}, summary: undefined }));
  }

  // L'analisi di riferimento porta i numeri della sua ultima versione sull'opportunità; lo scenario di quella versione
  // diventa lo «scenario scelto» (così il simulatore, salvando, li aggiorna da solo).
  async function syncReference(q, analysisId) {
    const a = await analysisById(q, analysisId);
    if (!a.reference || !a.opportunity_id) return;
    const versions = await versionsOf(q, analysisId);
    const last = versions[versions.length - 1];
    const k = last?.kpi || {};
    await q.query('UPDATE energy_scenarios SET chosen = false WHERE opportunity_id = $1 AND chosen', [a.opportunity_id]);
    if (last?.scenario_id) await q.query('UPDATE energy_scenarios SET chosen = true, opportunity_id = $2 WHERE id = $1', [last.scenario_id, a.opportunity_id]);
    await q.query(
      `UPDATE energy_opportunities SET mw = COALESCE($2, mw), capex = COALESCE($3, capex), data = data || $4::jsonb, updated_at = now() WHERE id = $1`,
      [a.opportunity_id, k.mw ?? null, k.capex === undefined || k.capex === null ? null : Math.round(k.capex),
        JSON.stringify({ scenario: {
          analysis_id: a.id, id: last?.scenario_id || null, name: `${a.title}${last ? ` · v${last.n}` : ''}`, model: last?.model || null,
          irr: k.irr ?? null, irrUnlevered: k.irrProject ?? null, npv: k.npv ?? null, payback: k.payback ?? null, dscrMin: k.dscrMin ?? null,
          mw: k.mw ?? null, capex: k.capex ?? null,
        } })]);
  }
  async function clearReference(q, oppId) {
    await q.query('UPDATE energy_analyses SET reference = false WHERE opportunity_id = $1 AND reference', [oppId]);
    await q.query('UPDATE energy_scenarios SET chosen = false WHERE opportunity_id = $1 AND chosen', [oppId]);
    await q.query("UPDATE energy_opportunities SET data = data - 'scenario', updated_at = now() WHERE id = $1", [oppId]);
  }

  // Uno scenario nuovo per una versione: dalle ipotesi date o, se manca, da quelle di partenza del modello.
  async function newScenario(q, { name, model, input, opportunityId, userId }) {
    const result = runScenario(model, input || {});
    const { rows: [s] } = await q.query(
      'INSERT INTO energy_scenarios (opportunity_id, name, model, input, summary, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [opportunityId || null, name.slice(0, 120), model, JSON.stringify(input || {}), JSON.stringify(summaryOf(result)), userId]);
    return s.id;
  }

  // ── elenco ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/energy/analyses', async (req, res) => {
    const params = [];
    const where = ['TRUE'];
    if (req.query.type) { params.push(v.oneOf(String(req.query.type), 'Tipo', Object.keys(PROJECT_TYPES))); where.push(`a.project_type = $${params.length}`); }
    if (req.query.stato === 'libere') where.push('a.opportunity_id IS NULL');
    if (req.query.stato === 'allegate') where.push('a.opportunity_id IS NOT NULL');
    if (req.query.opportunity) { params.push(v.int(req.query.opportunity, 'Opportunità', { min: 1 })); where.push(`a.opportunity_id = $${params.length}`); }
    if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where.push(`(a.title ILIKE $${params.length} OR o.title ILIKE $${params.length})`); }
    const { rows } = await db.query(
      `SELECT a.id, a.title, a.project_type, a.opportunity_id, a.reference, a.updated_at, a.created_at, o.title AS opportunity_title, o.selection,
              u.name AS created_by_name, x.n, x.label, x.source, x.file_name, x.kpi, s.summary, s.model,
              (SELECT COUNT(*)::int FROM energy_analysis_versions y WHERE y.analysis_id = a.id) AS versions
         FROM energy_analyses a
         LEFT JOIN energy_opportunities o ON o.id = a.opportunity_id LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN LATERAL (SELECT * FROM energy_analysis_versions y WHERE y.analysis_id = a.id ORDER BY y.n DESC LIMIT 1) x ON true
         LEFT JOIN energy_scenarios s ON s.id = x.scenario_id
        WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT 500`, params);
    const { rows: [counts] } = await db.query(
      'SELECT COUNT(*)::int AS tutte, COUNT(*) FILTER (WHERE opportunity_id IS NULL)::int AS libere, COUNT(*) FILTER (WHERE opportunity_id IS NOT NULL)::int AS allegate FROM energy_analyses');
    res.json({
      types: PROJECT_TYPES, counts,
      analyses: rows.map(r => ({ ...r, kpi: r.source === 'simulatore' ? kpiOfSummary(r.summary || {}) : r.kpi || {}, summary: undefined })),
    });
  });

  // ── creare ───────────────────────────────────────────────────────────────────────────────
  // Dal simulatore (modello e ipotesi, o le ipotesi di uno scenario già salvato) o da un file (numeri a mano, il file si
  // carica subito dopo su /api/energy/analysis-versions/:id/file).
  app.post('/api/energy/analyses', async (req, res) => {
    const title = v.text(req.body.title, 'Nome', { max: 160, required: true });
    const type = v.oneOf(req.body.project_type, 'Tipo', Object.keys(PROJECT_TYPES));
    if (!type) throw new HttpError(400, 'Scegli il tipo di analisi');
    const oppId = req.body.opportunity_id ? v.int(req.body.opportunity_id, 'Opportunità', { min: 1 }) : null;
    if (oppId) await opportunityById(oppId);
    const source = v.oneOf(req.body.source || 'simulatore', 'Origine', ['simulatore', 'file']);
    const label = v.text(req.body.label, 'Etichetta', { max: 80 }) || '';
    const id = await db.tx(async q => {
      const { rows: [a] } = await q.query(
        'INSERT INTO energy_analyses (title, project_type, opportunity_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [title, type, oppId, req.user.id]);
      if (source === 'simulatore') {
        let model = req.body.model ? v.oneOf(req.body.model, 'Modello', MODELS) : MODEL_OF_TYPE[type];
        let input = {};
        if (req.body.from_scenario) {
          const { rows: [s] } = await q.query('SELECT model, input FROM energy_scenarios WHERE id = $1', [v.int(req.body.from_scenario, 'Scenario', { min: 1 })]);
          if (!s) throw new HttpError(404, 'Scenario non trovato');
          ({ model, input } = s);
        }
        const sid = await newScenario(q, { name: title, model, input, opportunityId: oppId, userId: req.user.id });
        await q.query('INSERT INTO energy_analysis_versions (analysis_id, n, label, source, scenario_id, created_by) VALUES ($1, 1, $2, $3, $4, $5)',
          [a.id, label, 'simulatore', sid, req.user.id]);
      } else {
        await q.query('INSERT INTO energy_analysis_versions (analysis_id, n, label, source, kpi, created_by) VALUES ($1, 1, $2, $3, $4, $5)',
          [a.id, label, 'file', JSON.stringify(cleanKpi(req.body.kpi || {})), req.user.id]);
      }
      if (oppId && req.body.reference) {
        await clearReference(q, oppId);
        await q.query('UPDATE energy_analyses SET reference = true WHERE id = $1', [a.id]);
        await syncReference(q, a.id);
      }
      return a.id;
    });
    res.status(201).json(await detail(id));
  });

  async function detail(id) {
    const a = await analysisById(db, id);
    return { ...a, from_scenario_id: undefined, versions: await versionsOf(db, id) };
  }
  app.get('/api/energy/analyses/:id', async (req, res) => {
    res.json(await detail(v.int(req.params.id, 'id', { min: 1 })));
  });

  // Una versione per la scheda: numeri, ipotesi del simulatore (e quelle della versione prima, per «cosa è cambiato»),
  // flussi annui per l'equity e sensitività.
  app.get('/api/energy/analysis-versions/:vid', async (req, res) => {
    const { rows: [x] } = await db.query(
      `SELECT x.*, s.model, s.input, s.summary FROM energy_analysis_versions x LEFT JOIN energy_scenarios s ON s.id = x.scenario_id WHERE x.id = $1`,
      [v.int(req.params.vid, 'id', { min: 1 })]);
    if (!x) throw new HttpError(404, 'Versione non trovata');
    const { rows: [prev] } = await db.query(
      `SELECT x.n, x.source, x.kpi, s.model, s.input, s.summary FROM energy_analysis_versions x LEFT JOIN energy_scenarios s ON s.id = x.scenario_id
        WHERE x.analysis_id = $1 AND x.n < $2 ORDER BY x.n DESC LIMIT 1`, [x.analysis_id, x.n]);
    const out = {
      id: x.id, analysis_id: x.analysis_id, n: x.n, label: x.label, note: x.note, source: x.source, scenario_id: x.scenario_id,
      file_name: x.file_name, file_size: x.file_size, content_type: x.content_type, created_at: x.created_at,
      model: x.model || null, input: x.input || null, flows: [], sensitivity: {},
      kpi: x.source === 'simulatore' ? kpiOfSummary(x.summary || {}) : x.kpi || {},
      previous: prev ? { n: prev.n, model: prev.model || null, input: prev.input || null, kpi: prev.source === 'simulatore' ? kpiOfSummary(prev.summary || {}) : prev.kpi || {} } : null,
    };
    if (x.source === 'simulatore' && x.model) Object.assign(out, (({ flows, sensitivity }) => ({ flows, sensitivity }))(detailOfScenario(x.model, x.input || {})));
    res.json(out);
  });

  // ── cambiare ─────────────────────────────────────────────────────────────────────────────
  // Nome, tipo, opportunità o progetto a cui è allegata (null = di nuovo libera), di riferimento sì o no.
  app.patch('/api/energy/analyses/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const a = await analysisById(db, id);
    const title = req.body.title === undefined ? a.title : v.text(req.body.title, 'Nome', { max: 160, required: true });
    const type = req.body.project_type === undefined ? a.project_type : v.oneOf(req.body.project_type, 'Tipo', Object.keys(PROJECT_TYPES));
    let oppId = a.opportunity_id;
    if (req.body.opportunity_id !== undefined) oppId = req.body.opportunity_id ? v.int(req.body.opportunity_id, 'Opportunità', { min: 1 }) : null;
    if (oppId && oppId !== a.opportunity_id) await opportunityById(oppId);
    const reference = req.body.reference === undefined ? a.reference && oppId === a.opportunity_id : Boolean(req.body.reference);
    if (reference && !oppId) throw new HttpError(400, 'Allega prima l\'analisi a un progetto');
    await db.tx(async q => {
      if (a.reference && (!reference || oppId !== a.opportunity_id)) await clearReference(q, a.opportunity_id);
      if (reference && !(a.reference && oppId === a.opportunity_id)) await clearReference(q, oppId);
      await q.query('UPDATE energy_analyses SET title = $2, project_type = $3, opportunity_id = $4, reference = $5, updated_at = now() WHERE id = $1',
        [id, title, type, oppId, reference]);
      // gli scenari delle versioni seguono l'analisi (così si vedono anche dall'opportunità)
      await q.query('UPDATE energy_scenarios SET opportunity_id = $2 WHERE id IN (SELECT scenario_id FROM energy_analysis_versions WHERE analysis_id = $1 AND scenario_id IS NOT NULL)', [id, oppId]);
      if (reference) await syncReference(q, id);
    });
    res.json(await detail(id));
  });

  app.delete('/api/energy/analyses/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const a = await analysisById(db, id);
    await db.tx(async q => {
      if (a.reference && a.opportunity_id) await clearReference(q, a.opportunity_id);
      await q.query('DELETE FROM energy_analyses WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  });

  // Nuova versione: dal simulatore riparte dalle ipotesi dell'ultima versione (o del modello), poi si cambia nel simulatore;
  // da file prende i numeri scritti a mano e il file si carica subito dopo.
  app.post('/api/energy/analyses/:id/versions', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const a = await analysisById(db, id);
    const source = v.oneOf(req.body.source || 'simulatore', 'Origine', ['simulatore', 'file']);
    const label = v.text(req.body.label, 'Etichetta', { max: 80 }) || '';
    const note = v.text(req.body.note, 'Cosa è cambiato', { max: 2000 }) || '';
    const vid = await db.tx(async q => {
      const { rows: [last] } = await q.query(
        `SELECT x.n, s.model, s.input FROM energy_analysis_versions x LEFT JOIN energy_scenarios s ON s.id = x.scenario_id
          WHERE x.analysis_id = $1 ORDER BY x.n DESC LIMIT 1`, [id]);
      const n = (last?.n || 0) + 1;
      let row;
      if (source === 'simulatore') {
        const model = req.body.model ? v.oneOf(req.body.model, 'Modello', MODELS) : last?.model || MODEL_OF_TYPE[a.project_type];
        const input = last?.model === model ? last.input : {};
        const sid = await newScenario(q, { name: `${a.title} · v${n}`, model, input, opportunityId: a.opportunity_id, userId: req.user.id });
        ({ rows: [row] } = await q.query(
          'INSERT INTO energy_analysis_versions (analysis_id, n, label, note, source, scenario_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [id, n, label, note, 'simulatore', sid, req.user.id]));
      } else {
        ({ rows: [row] } = await q.query(
          'INSERT INTO energy_analysis_versions (analysis_id, n, label, note, source, kpi, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [id, n, label, note, 'file', JSON.stringify(cleanKpi(req.body.kpi || {})), req.user.id]));
      }
      await q.query('UPDATE energy_analyses SET updated_at = now() WHERE id = $1', [id]);
      await syncReference(q, id);
      return row.id;
    });
    res.status(201).json({ ...(await detail(id)), version_id: vid });
  });

  async function versionById(q, vid) {
    const { rows: [x] } = await q.query('SELECT id, analysis_id, n, source, scenario_id FROM energy_analysis_versions WHERE id = $1', [vid]);
    if (!x) throw new HttpError(404, 'Versione non trovata');
    return x;
  }

  // Etichetta, nota e (per i file) i numeri scritti a mano.
  app.patch('/api/energy/analysis-versions/:vid', async (req, res) => {
    const x = await versionById(db, v.int(req.params.vid, 'id', { min: 1 }));
    const label = req.body.label === undefined ? undefined : v.text(req.body.label, 'Etichetta', { max: 80 }) || '';
    const note = req.body.note === undefined ? undefined : v.text(req.body.note, 'Cosa è cambiato', { max: 2000 }) || '';
    if (req.body.kpi !== undefined && x.source !== 'file') throw new HttpError(400, 'I numeri di una versione del simulatore si cambiano nel simulatore');
    const kpi = req.body.kpi === undefined ? undefined : cleanKpi(req.body.kpi);
    await db.tx(async q => {
      await q.query(
        `UPDATE energy_analysis_versions SET label = COALESCE($2, label), note = COALESCE($3, note), kpi = COALESCE($4::jsonb, kpi) WHERE id = $1`,
        [x.id, label ?? null, note ?? null, kpi ? JSON.stringify(kpi) : null]);
      await q.query('UPDATE energy_analyses SET updated_at = now() WHERE id = $1', [x.analysis_id]);
      await syncReference(q, x.analysis_id);
    });
    res.json(await detail(x.analysis_id));
  });

  app.delete('/api/energy/analysis-versions/:vid', async (req, res) => {
    const x = await versionById(db, v.int(req.params.vid, 'id', { min: 1 }));
    await db.tx(async q => {
      const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM energy_analysis_versions WHERE analysis_id = $1', [x.analysis_id]);
      if (n <= 1) throw new HttpError(400, 'L\'analisi ha una sola versione: cancella l\'analisi');
      await q.query('DELETE FROM energy_analysis_versions WHERE id = $1', [x.id]);
      if (x.scenario_id) await q.query('DELETE FROM energy_scenarios WHERE id = $1 AND NOT chosen', [x.scenario_id]);
      await syncReference(q, x.analysis_id);
    });
    res.json(await detail(x.analysis_id));
  });

  // File esterno della versione (Excel o PDF): carica e scarica.
  app.post('/api/energy/analysis-versions/:vid/file', express.raw({ type: () => true, limit: FILE_MAX }), async (req, res) => {
    const x = await versionById(db, v.int(req.params.vid, 'id', { min: 1 }));
    if (x.source !== 'file') throw new HttpError(400, 'Questa versione viene dal simulatore');
    const name = v.text(String(req.query.name || ''), 'Nome del file', { max: 200, required: true });
    const type = String(req.query.type || 'application/octet-stream').slice(0, 200);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'File vuoto');
    await db.query('UPDATE energy_analysis_versions SET file_name = $2, content_type = $3, file_size = $4, file_data = $5 WHERE id = $1',
      [x.id, name, type, req.body.length, req.body]);
    res.status(201).json(await detail(x.analysis_id));
  });
  app.get('/api/energy/analysis-versions/:vid/file', async (req, res) => {
    const { rows: [f] } = await db.query('SELECT file_name, file_data FROM energy_analysis_versions WHERE id = $1', [v.int(req.params.vid, 'id', { min: 1 })]);
    if (!f?.file_data) throw new HttpError(404, 'File non trovato');
    const name = safeFilename(f.file_name);
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
    res.send(toBuffer(f.file_data));
  });

  // Dallo scenario all'analisi (il simulatore mostra «Torna all'analisi» e, salvando, aggiorna l'analisi di riferimento).
  app.get('/api/energy/scenarios/:id/analysis', async (req, res) => {
    const { rows: [r] } = await db.query(
      `SELECT a.id, a.title, x.n, x.id AS version_id FROM energy_analysis_versions x JOIN energy_analyses a ON a.id = x.analysis_id WHERE x.scenario_id = $1`,
      [v.int(req.params.id, 'id', { min: 1 })]);
    res.json(r || null);
  });

  return { syncReference };
}

module.exports = { registerEnergyAnalisi, kpiOfSummary, cleanKpi };
