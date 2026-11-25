// Alma Energy · Radar energia (ALM2-74 tappa 3). Rotte sotto /api/energy, già riservate ai membri del modulo.
// Ogni giro raccoglie: proprietari del Database CE non ancora in pipeline con segnali forti; i segnali fotovoltaico e
// biometano del radar di Alma Impianti (la fonte comune si legge una volta sola, lì); con OPENAI_API_KEY e dentro la
// quota del mese, la ricerca web propria (cessioni e aste FER). «Prendi» porta il venditore nel CRM di Energy, crea
// l'opportunità nella pipeline giusta e la bozza di analisi; «Scarta» chiede il motivo.
const { HttpError, v } = require('../lib/http');
const R = require('../lib/energy-radar');
const { stageKeys, CLOSED_STAGES } = require('../lib/energy');
const { OWNER_KEY_SQL, ownersToPipeline, companyByName, SIGNALS } = require('../lib/energy-import');
const { runScenario, summaryOf } = require('../lib/energy-scenarios');
const { romeNow } = require('../lib/workdays');
const { getSetting, saveSetting } = require('../lib/settings');
const { addFundFromSignal, approachEnergivoro, reasonForEnergivoro } = require('./energy-crm');

const SIGNAL_LABEL = Object.fromEntries(SIGNALS);
const STRONG = ['sottoperformance', 'in_liquidazione', 'erogazioni_azzerate', 'cambio_proprieta', 'acquistato_di_recente', 'non_strategico'];
const TYPE_OF_KIND = { revamping: 'revamping', fv_classico: 'fv_nuovo', ppa_onsite: 'ppa_onsite' };
const MODEL_OF_TYPE = { fv_nuovo: 'fv_classico', acquisizione: 'revamping', revamping: 'revamping', ppa_onsite: 'ppa_onsite' };
const eur = n => `${Math.round(Number(n) || 0).toLocaleString('it-IT')} €`;
const month = () => romeNow().day.slice(0, 7);

function registerEnergyRadar(app, { db, radarFetch }) {
  async function settingsOf(q = db) {
    return R.normalizeSettings((await getSetting(q, 'energy.radar', {})) || {});
  }
  async function knownCompany(q, entity) {
    if (!entity) return false;
    const { rows: [c] } = await q.query('SELECT 1 FROM energy_companies WHERE lower(name) = lower($1) LIMIT 1', [entity]);
    return Boolean(c);
  }
  // un segnale nuovo, se non c'è già (stessa fonte o stesso titolo negli ultimi 60 giorni)
  async function addSignal(q, s, settings, userId = null) {
    const { rows: [dup] } = await q.query(
      `SELECT 1 FROM energy_signals WHERE external_id = $1 OR (lower(title) = lower($2) AND created_at > now() - interval '60 days') LIMIT 1`, [s.external_id, s.title]);
    if (dup) return null;
    const { score, parts } = R.scoreOf(s, settings, { knownCompany: await knownCompany(q, s.entity), today: romeNow().day });
    const { rows: [row] } = await q.query(
      `INSERT INTO energy_signals (kind, source, external_id, title, summary, why, entity, region, place, mw, amount, url, published_on, deadline, data, score, score_parts, cost_eur, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) ON CONFLICT (external_id) DO NOTHING RETURNING id`,
      [s.kind, s.source, s.external_id, s.title.slice(0, 500), s.summary || '', s.why || '', s.entity || '', s.region || '', s.place || '',
        s.mw ?? null, s.amount ?? null, s.url || '', s.published_on || null, s.deadline || null, JSON.stringify(s.data || {}), score, JSON.stringify(parts), s.cost_eur || 0, userId]);
    return row || null;
  }

  // Database CE: proprietari fuori dalla pipeline con segnali forti, dai più incassi persi
  async function fromCe(q, settings) {
    if (!settings.ce_limit) return 0;
    const { rows } = await q.query(
      `SELECT ${OWNER_KEY_SQL} AS k, MIN(owner_name) AS owner_name, MIN(region) AS region, MIN(province) AS province, COUNT(*)::int AS n,
              SUM(COALESCE(lost_per_year, 0)) AS lost, SUM(COALESCE(avg_recent, 0)) AS recent, MIN(variation) AS variation, MIN(priority) AS priority,
              string_agg(array_to_string(signals, ','), ',') AS sigs
         FROM energy_conventions WHERE opportunity_id IS NULL AND signals && $1::text[]
        GROUP BY 1 ORDER BY SUM(COALESCE(lost_per_year, 0)) DESC NULLS LAST LIMIT $2`, [STRONG, settings.ce_limit]);
    let added = 0;
    for (const r of rows) {
      const sigs = [...new Set(String(r.sigs || '').split(',').filter(Boolean))];
      const kind = sigs.includes('sottoperformance') || Number(r.variation) <= -0.2 ? 'revamping' : 'conto_energia';
      const drop = r.variation === null || r.variation === undefined ? '' : `, incassi ${Math.round(Number(r.variation) * 100)}%`;
      const row = await addSignal(q, {
        kind, source: 'database_ce', external_id: `ce:${r.k}`,
        title: `${r.owner_name}: ${r.n} ${r.n === 1 ? 'convenzione' : 'convenzioni'} Conto Energia${drop}`,
        summary: `Incassi GSE recenti ${eur(r.recent)} l'anno${Number(r.lost) ? `, persi ${eur(r.lost)} l'anno rispetto al 2016-2019` : ''}. Priorità ${r.priority || '—'} nel Database CE.`,
        why: sigs.map(s => SIGNAL_LABEL[s] || s).join(', '), entity: r.owner_name, region: r.region, place: r.province,
        data: { owner_key: r.k, conventions: r.n, signals: sigs },
      }, settings);
      if (row) added++;
    }
    return added;
  }

  // Radar di Alma Impianti: i segnali fotovoltaico e biometano degli ultimi 90 giorni che parlano di impianti in vendita,
  // progetti autorizzati o aste. La ricerca la fa Impianti una volta sola; qui si copiano con il link all'originale.
  async function fromImpianti(q, settings) {
    const { rows } = await q.query(
      `SELECT id, title, summary, why, entity, region, place, amount, url, published_on, deadline, sector FROM crm_signals
        WHERE bu = 'impianti' AND sector IN ('fotovoltaico', 'biometano') AND created_at > now() - interval '90 days'
          AND status NOT IN ('scartato')`).catch(() => ({ rows: [] }));
    let added = 0;
    for (const s of rows) {
      const kind = R.kindOf(`${s.title} ${s.summary} ${s.why}`);
      if (kind === 'notizia' || kind === 'revamping') continue; // solo quello che serve a un IPP: cessioni, autorizzazioni, aste
      const row = await addSignal(q, {
        kind, source: 'impianti', external_id: `imp:${s.id}`, title: s.title, summary: s.summary, why: s.why, entity: s.entity, region: s.region,
        place: s.place, amount: s.amount, url: s.url, published_on: s.published_on, deadline: s.deadline, mw: R.mwOf(s.title, s.summary),
        data: { crm_signal_id: s.id, sector: s.sector },
      }, settings);
      if (row) added++;
    }
    return added;
  }

  async function spentThisMonth() {
    const { rows: [r] } = await db.query("SELECT COALESCE(SUM(cost_eur), 0)::float AS eur FROM energy_radar_runs WHERE to_char(at AT TIME ZONE 'Europe/Rome', 'YYYY-MM') = $1", [month()]);
    return r.eur;
  }

  // Un giro: fonti gratuite sempre, ricerca web se c'è la chiave, è accesa e c'è quota.
  async function runRadar({ userId = null, web = true, fetchImpl = radarFetch || fetch, apiKey = process.env.OPENAI_API_KEY || (radarFetch ? 'test' : '') } = {}) {
    const settings = await settingsOf();
    const added = { database_ce: 0, impianti: 0, web: 0 };
    let cost = 0;
    const errors = [];
    try { added.database_ce = await fromCe(db, settings); } catch (err) { errors.push(`Database CE: ${err.message}`); }
    try { added.impianti = await fromImpianti(db, settings); } catch (err) { errors.push(`Alma Impianti: ${err.message}`); }
    if (web && settings.web && apiKey) {
      for (const search of R.SEARCHES) {
        if ((await spentThisMonth()) + cost >= settings.quota_eur) { errors.push('Quota del mese finita: la ricerca web riparte il mese prossimo o alzando la quota'); break; }
        try {
          const r = await R.searchWeb({ apiKey, search, settings, today: romeNow().day, fetchImpl });
          cost += r.costEur;
          for (const s of r.signals) {
            const row = await addSignal(db, { ...s, source: 'web', external_id: s.url, cost_eur: r.signals.length ? r.costEur / r.signals.length : 0 }, settings);
            if (row) added.web++;
            // ALM2-83: un energivoro dell'elenco citato in una notizia riceve il «perché chiamarlo adesso»
            if (s.kind === 'energivoro') await reasonForEnergivoro(db, s).catch(() => false);
          }
        } catch (err) { errors.push(`${search.label}: ${String(err.message || err).slice(0, 300)}`); }
      }
    }
    await db.query('INSERT INTO energy_radar_runs (added, cost_eur, error, user_id) VALUES ($1, $2, $3, $4)', [JSON.stringify(added), cost, errors.join(' · '), userId]);
    return { added, cost, errors, web: Boolean(settings.web && apiKey) };
  }

  // ── elenco ───────────────────────────────────────────────────────────────────────────────
  app.get('/api/energy/radar', async (req, res) => {
    const status = v.oneOf(req.query.status || 'nuovo', 'Stato', ['nuovo', 'preso', 'scartato']);
    const params = [status];
    let where = 's.status = $1';
    // ALM2-93: più tipi insieme (le pillole Revamping, FV classico, PPA, Aste del radar IPP)
    if (req.query.kind) { params.push(String(req.query.kind).split(',').map(k => v.oneOf(k, 'Tipo', Object.keys(R.KINDS)))); where += ` AND s.kind = ANY($${params.length}::text[])`; }
    if (req.query.q) { params.push(`%${String(req.query.q).trim()}%`); where += ` AND (s.title ILIKE $${params.length} OR s.entity ILIKE $${params.length})`; }
    const [{ rows }, { rows: counts }, { rows: byStatus }, { rows: [last] }] = await Promise.all([
      db.query(
        `SELECT s.*, o.title AS opportunity_title, a.title AS analysis_title, u.name AS decided_by_name
           FROM energy_signals s LEFT JOIN energy_opportunities o ON o.id = s.opportunity_id LEFT JOIN energy_analyses a ON a.id = s.analysis_id
           LEFT JOIN users u ON u.id = s.decided_by
          WHERE ${where} ORDER BY ${status === 'nuovo' ? 's.score DESC, s.created_at DESC' : 's.decided_at DESC NULLS LAST'} LIMIT 300`, params),
      db.query('SELECT kind, COUNT(*)::int AS n FROM energy_signals WHERE status = $1 GROUP BY kind', [status]),
      db.query('SELECT status, COUNT(*)::int AS n FROM energy_signals GROUP BY status'),
      db.query('SELECT at, added, cost_eur, error FROM energy_radar_runs ORDER BY at DESC LIMIT 1'),
    ]);
    res.json({
      kinds: R.KINDS, sources: R.SOURCES, signals: rows,
      counts: Object.fromEntries(counts.map(c => [c.kind, c.n])), byStatus: Object.fromEntries(byStatus.map(c => [c.status, c.n])),
      last_run: last || null, web: Boolean(process.env.OPENAI_API_KEY || radarFetch), spent: await spentThisMonth(), settings: await settingsOf(),
    });
  });

  // «Cerca segnali nuovi»: un giro adesso.
  app.post('/api/energy/radar/cerca', async (req, res) => {
    res.json(await runRadar({ userId: req.user.id, web: req.body?.web !== false }));
  });

  // «Aggiungi un segnale» a mano.
  app.post('/api/energy/radar', async (req, res) => {
    const title = v.text(req.body.title, 'Cosa è successo', { max: 500, required: true });
    const kind = v.oneOf(req.body.kind || 'notizia', 'Tipo', Object.keys(R.KINDS));
    const url = v.text(req.body.url, 'Link', { max: 500 }) || '';
    const mw = req.body.mw === undefined || req.body.mw === null || req.body.mw === '' ? R.mwOf(title) : Number(String(req.body.mw).replace(',', '.'));
    if (mw !== null && !Number.isFinite(mw)) throw new HttpError(400, 'I MW non sono validi');
    const row = await addSignal(db, {
      kind, source: 'manuale', external_id: url || `manuale:${Date.now()}:${req.user.id}`, title, mw,
      summary: v.text(req.body.summary, 'Note', { max: 1500 }) || '', entity: v.text(req.body.entity, 'Chi', { max: 300 }) || '',
      region: v.text(req.body.region, 'Regione', { max: 60 }) || '', place: v.text(req.body.place, 'Comune', { max: 120 }) || '', url,
      deadline: req.body.deadline ? v.date(req.body.deadline, 'Entro quando') : null,
    }, await settingsOf(), req.user.id);
    if (!row) throw new HttpError(400, 'Questo segnale c\'è già nel radar');
    res.status(201).json(await signalById(row.id));
  });

  async function signalById(id) {
    const { rows: [s] } = await db.query('SELECT * FROM energy_signals WHERE id = $1', [id]);
    if (!s) throw new HttpError(404, 'Segnale non trovato');
    return s;
  }

  app.post('/api/energy/radar/:id/scarta', async (req, res) => {
    const s = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    const reason = v.text(req.body.reason, 'Motivo', { max: 300, required: true });
    if (s.status !== 'nuovo') throw new HttpError(400, 'Il segnale è già stato deciso');
    await db.query("UPDATE energy_signals SET status = 'scartato', discard_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1", [s.id, reason, req.user.id]);
    res.json(await signalById(s.id));
  });

  app.post('/api/energy/radar/:id/riapri', async (req, res) => {
    const s = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    if (s.status !== 'scartato') throw new HttpError(400, 'Si riaprono solo i segnali scartati');
    await db.query("UPDATE energy_signals SET status = 'nuovo', discard_reason = '', decided_by = NULL, decided_at = NULL WHERE id = $1", [s.id]);
    res.json(await signalById(s.id));
  });

  // «Prendi»: azienda nel CRM di Energy, opportunità nella pipeline del tipo, bozza di analisi allegata.
  app.post('/api/energy/radar/:id/prendi', async (req, res) => {
    const s = await signalById(v.int(req.params.id, 'id', { min: 1 }));
    if (s.status !== 'nuovo') throw new HttpError(400, 'Il segnale è già stato deciso');
    // ALM2-83: un fondo entra nel CRM centrale col mandato; un energivoro viene approcciato (PPA on-site)
    if (s.kind === 'fondo') return res.json(await db.tx(q => addFundFromSignal(q, s, req.user.id)));
    if (s.kind === 'energivoro') {
      const out = await db.tx(async q => {
        const name = (s.entity || s.title).slice(0, 300);
        let { rows: [e] } = await q.query('SELECT * FROM crm_energivori WHERE lower(name) = lower($1) LIMIT 1', [name]);
        if (!e) ({ rows: [e] } = await q.query("INSERT INTO crm_energivori (name, region, city, source, imported_by) VALUES ($1, $2, $3, 'Radar energia', $4) RETURNING *", [name, s.region || '', s.place || '', req.user.id]));
        const r = await approachEnergivoro(q, e, req.user.id);
        await q.query("UPDATE energy_signals SET status = 'preso', subject_id = $2, opportunity_id = $3, analysis_id = $4, decided_by = $5, decided_at = now() WHERE id = $1", [s.id, r.subject_id, r.opportunity_id, r.analysis_id, req.user.id]);
        return r;
      });
      return res.json(out);
    }
    // ALM2-93: «In pipeline» lascia scegliere la pipeline (Revamping, FV classico, PPA on-site); senza scelta vale quella del tipo
    const want = req.body?.kind ? v.oneOf(req.body.kind, 'Pipeline', Object.keys(TYPE_OF_KIND)) : null;
    const base = R.TAKE[s.kind] || R.TAKE.notizia;
    const t = want && want !== base.kind ? { ...base, kind: want, type: TYPE_OF_KIND[want] } : base;
    const out = await db.tx(async q => {
      let oppId;
      if (s.source === 'database_ce' && s.data?.owner_key) {
        // dal Database CE: il proprietario entra come gli altri (azienda, opportunità revamping, convenzioni collegate)
        await ownersToPipeline(q, [s.data.owner_key], req.user.id);
        const { rows: [o] } = await q.query('SELECT opportunity_id AS id FROM energy_conventions WHERE ' + OWNER_KEY_SQL + ' = $1 AND opportunity_id IS NOT NULL LIMIT 1', [s.data.owner_key]);
        oppId = o?.id;
      }
      if (!oppId) {
        const entity = s.entity || s.title.slice(0, 120);
        const company = await companyByName(q, entity.slice(0, 200), { type: t.companyType, region: s.region, city: s.place, source: `Radar energia (${R.SOURCES[s.source]})` }, req.user.id);
        const stage = t === base ? (t.kind === 'revamping' ? 'da_analizzare' : 'proposta') : stageKeys(t.kind)[0];
        const { rows: [o] } = await q.query(
          `INSERT INTO energy_opportunities (kind, title, stage, mw, city, region, company_id, owner_id, created_by, source_key, data, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11) RETURNING id`,
          [t.kind, s.title.slice(0, 200), stage, s.mw, s.place || '', s.region || '', company.id, req.user.id, `radar:${s.id}`,
            JSON.stringify({ radar: { id: s.id, kind: s.kind, url: s.url } }), [s.summary, s.url].filter(Boolean).join('\n')]);
        await q.query('INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, $2, $3, $4)',
          [o.id, stage, `Dal radar energia: ${R.KINDS[s.kind]}`, req.user.id]);
        await q.query('INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [o.id, company.id, t.role]);
        oppId = o.id;
      }
      // bozza di analisi dal simulatore, con i MW del segnale quando ci sono
      const model = MODEL_OF_TYPE[t.type];
      const input = s.mw ? (model === 'revamping' ? { sizeMw: Number(s.mw) } : model === 'fv_classico' ? { projectsYear1: 1, mwpPerProject: Number(s.mw), growthYear2: 0, growthYear3: 0 } : {}) : {};
      const title = `${s.title.slice(0, 140)} · analisi`;
      const { rows: [sc] } = await q.query(
        'INSERT INTO energy_scenarios (opportunity_id, name, model, input, summary, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [oppId, title.slice(0, 120), model, JSON.stringify(input), JSON.stringify(summaryOf(runScenario(model, input))), req.user.id]);
      const { rows: [a] } = await q.query('INSERT INTO energy_analyses (title, project_type, opportunity_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [title, t.type, oppId, req.user.id]);
      await q.query("INSERT INTO energy_analysis_versions (analysis_id, n, label, source, scenario_id, created_by) VALUES ($1, 1, 'bozza dal radar', 'simulatore', $2, $3)",
        [a.id, sc.id, req.user.id]);
      await q.query("UPDATE energy_signals SET status = 'preso', opportunity_id = $2, analysis_id = $3, decided_by = $4, decided_at = now() WHERE id = $1",
        [s.id, oppId, a.id, req.user.id]);
      return { opportunity_id: oppId, analysis_id: a.id };
    });
    res.json(out);
  });

  // ALM2-93: i numeri in testa al radar IPP (tavola F) e quelli dei tab
  app.get('/api/energy/radar/numeri', async (_req, res) => {
    const [{ rows: sig }, { rows: pipe }, { rows: [ce] }, { rows: [due] }, { rows: [imp] }] = await Promise.all([
      db.query("SELECT source, kind, COUNT(*)::int AS n FROM energy_signals WHERE status = 'nuovo' GROUP BY source, kind"),
      db.query('SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(mw), 0)::float AS mw FROM energy_opportunities WHERE NOT (stage = ANY($1::text[])) GROUP BY kind', [CLOSED_STAGES]),
      db.query("SELECT COALESCE(SUM(lost_per_year), 0)::float AS lost FROM energy_conventions WHERE priority = 'A'"),
      db.query("SELECT COUNT(*)::int AS n FROM energy_signals WHERE status = 'nuovo' AND (kind = 'asta_fer' OR (deadline IS NOT NULL AND deadline <= CURRENT_DATE + 60))"),
      db.query('SELECT COUNT(*)::int AS n FROM energy_conventions'),
    ]);
    const by = k => sig.filter(x => x.source === k).reduce((a, x) => a + x.n, 0);
    res.json({
      da_guardare: { total: sig.reduce((a, x) => a + x.n, 0), web: by('web'), database_ce: by('database_ce'), impianti: by('impianti'), manuale: by('manuale') },
      pipeline: Object.fromEntries(['revamping', 'fv_classico', 'ppa_onsite'].map(k => { const p = pipe.find(x => x.kind === k); return [k, { n: p?.n || 0, mw: p?.mw || 0 }]; })),
      lost_a: ce.lost, scadenze: due.n, impianti: imp.n,
    });
  });

  app.get('/api/energy/radar/impostazioni', async (_req, res) => res.json({ settings: await settingsOf(), defaults: R.DEFAULTS, spent: await spentThisMonth() }));
  app.put('/api/energy/radar/impostazioni', async (req, res) => {
    const settings = R.normalizeSettings(req.body || {});
    await saveSetting(db, 'energy.radar', settings, req.user.id);
    res.json({ settings });
  });

  // Il giro automatico si fa una volta al giorno. Se oggi non c'è ancora (lo dice il database, così i riavvii dei
  // deploy non lo fanno slittare), parte 2 minuti dopo l'avvio; poi il controllo si ripete ogni ora. Spento nei test.
  async function runIfDue() {
    if (!(await isDue(db))) return false;
    const out = await runRadar();
    console.log(`[energy-radar] giro fatto: Database CE ${out.added.database_ce}, Alma Impianti ${out.added.impianti}, web ${out.added.web}, ${out.cost.toFixed(2)} €${out.errors.length ? ` · ${out.errors.join(' · ')}` : ''}`);
    return true;
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    const tick = () => runIfDue().catch(err => console.warn('[energy-radar] giro non riuscito', err.message));
    setTimeout(tick, 2 * 60 * 1000).unref();
    setInterval(tick, 3600 * 1000).unref();
  }
  return { runRadar, runIfDue };
}

// C'è da fare il giro automatico di oggi? Sì se oggi (ora italiana) non c'è un giro automatico (senza persona).
async function isDue(db) {
  const { rows: [r] } = await db.query(
    `SELECT 1 FROM energy_radar_runs WHERE user_id IS NULL AND to_char(at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') = $1 LIMIT 1`, [romeNow().day]);
  return !r;
}

module.exports = { registerEnergyRadar, isDue };
