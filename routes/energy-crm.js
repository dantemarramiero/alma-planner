// Alma Energy · Clienti e contatti (ALM2-83 tappa 1): il CRM centrale visto da Energy. Ogni tessera è un filtro sulle
// stesse schede del CRM centrale (crm_subjects, BU «energy»): proprietari di impianti, sviluppatori, fondi e investitori
// (gli stessi di Alma Impianti), energivori (l'elenco caricato in Alma Impianti), progettisti, altri.
// Le aziende di Energy sono legate alla loro scheda centrale da energy_companies.subject_id (migrazione 123).
const { HttpError, v } = require('../lib/http');
const F = require('../lib/energy-fondi');
const { runScenario, summaryOf } = require('../lib/energy-scenarios');
const { getSetting } = require('../lib/settings');
const { romeNow } = require('../lib/workdays');
const { addWorkdays } = require('../lib/workdays');

// ── fondi ed energivori come clienti potenziali (ALM2-83 tappa 2) ─────────────────────────────────────────────
// Un fondo dal radar (notizia) entra nel CRM centrale come «Fondo o investitore» con un primo mandato letto dal testo.
async function addFundFromSignal(q, s, userId) {
  const name = (s.entity || s.title).slice(0, 200);
  const { rows: [have] } = await q.query('SELECT id FROM energy_companies WHERE lower(name) = lower($1) LIMIT 1', [name]);
  let companyId = have?.id;
  if (companyId) await q.query("UPDATE energy_companies SET types = CASE WHEN 'investitore' = ANY(types) THEN types ELSE array_append(types, 'investitore') END WHERE id = $1", [companyId]);
  else {
    ({ rows: [{ id: companyId }] } = await q.query(
      `INSERT INTO energy_companies (name, types, region, source, owner_id, created_by) VALUES ($1, ARRAY['investitore'], $2, 'Radar energia: fondo che cerca un EPC', $3, $3) RETURNING id`,
      [name, s.region || '', userId]));
  }
  const { rows: [{ subject_id: sid }] } = await q.query('SELECT subject_id FROM energy_companies WHERE id = $1', [companyId]);
  await q.query("UPDATE crm_subjects SET segment = 'Fondo o investitore' WHERE id = $1 AND segment IN ('', 'Energia')", [sid]);
  const techs = F.techsOfText(s.title, s.summary);
  const regions = F.regionsOfText(s.title, s.summary);
  await q.query(
    `INSERT INTO crm_fund_mandates (subject_id, techs, regions, seeks_epc, bus, notes, updated_by) VALUES ($1, $2, $3, true, ARRAY['energy'], $4, $5)
     ON CONFLICT (subject_id) DO UPDATE SET bus = CASE WHEN 'energy' = ANY(crm_fund_mandates.bus) THEN crm_fund_mandates.bus ELSE array_append(crm_fund_mandates.bus, 'energy') END,
            techs = CASE WHEN crm_fund_mandates.techs = '{}' THEN EXCLUDED.techs ELSE crm_fund_mandates.techs END, updated_at = now()`,
    [sid, techs, regions, `Dalla notizia: ${s.title}`.slice(0, 1000), userId]);
  await q.query("UPDATE energy_signals SET status = 'preso', subject_id = $2, decided_by = $3, decided_at = now() WHERE id = $1", [s.id, sid, userId]);
  return { subject_id: sid, company_id: companyId };
}

// «Approccia» un energivoro: scheda nel CRM centrale, azienda cliente in Energy, opportunità PPA on-site e bozza di
// analisi col tetto. Restituisce opportunità e analisi.
async function approachEnergivoro(q, e, userId) {
  let companyId;
  if (e.subject_id) ({ rows: [{ id: companyId } = {}] } = await q.query('SELECT id FROM energy_companies WHERE subject_id = $1', [e.subject_id]));
  if (!companyId) {
    ({ rows: [{ id: companyId }] } = await q.query(
      `INSERT INTO energy_companies (name, vat, types, city, province, region, source, owner_id, created_by, subject_id)
       VALUES ($1, $2, ARRAY['cliente'], $3, $4, $5, 'Energivori', $6, $6, $7) RETURNING id`,
      [e.name.slice(0, 200), e.vat || '', e.city || '', e.province || '', e.region || '', userId, e.subject_id || null]));
  }
  const { rows: [{ subject_id: sid }] } = await q.query('SELECT subject_id FROM energy_companies WHERE id = $1', [companyId]);
  await q.query(`UPDATE crm_subjects SET segment = CASE WHEN segment IN ('', 'Energia') THEN 'Azienda energivora' ELSE segment END,
         asa = CASE WHEN 'energy' = ANY(asa) THEN asa ELSE array_append(asa, 'energy') END,
         lead_stage = CASE WHEN lead_stage IN ('da_contattare', 'contattato') THEN 'opportunita' ELSE lead_stage END WHERE id = $1`, [sid]);
  await q.query('UPDATE crm_energivori SET subject_id = $2 WHERE id = $1', [e.id, sid]);
  const roof = Number(e.roof_m2) || null;
  const input = roof ? { roofArea: roof } : {};
  const result = runScenario('ppa_onsite', input);
  const mw = roof ? result.plant?.sizeMw ?? null : null;
  const { rows: [o] } = await q.query(
    `INSERT INTO energy_opportunities (kind, title, stage, mw, city, province, region, company_id, owner_id, created_by, source_key, data)
     VALUES ('ppa_onsite', $1, 'da_qualificare', $2, $3, $4, $5, $6, $7, $7, $8, $9) RETURNING id`,
    [`PPA ${e.name}`.slice(0, 200), mw, e.city || '', e.province || '', e.region || '', companyId, userId, `energivoro:${e.id}`,
      JSON.stringify({ superficie: roof || undefined, energivoro: { consumo_gwh: e.consumption_gwh, motivo: e.energy_reason || undefined } })]);
  await q.query("INSERT INTO energy_stage_history (opportunity_id, from_stage, to_stage, note, user_id) VALUES ($1, NULL, 'da_qualificare', 'Dagli energivori', $2)", [o.id, userId]);
  await q.query("INSERT INTO energy_links (opportunity_id, company_id, role) VALUES ($1, $2, 'cliente') ON CONFLICT DO NOTHING", [o.id, companyId]);
  const title = `PPA ${e.name} · analisi`.slice(0, 160);
  const { rows: [sc] } = await q.query('INSERT INTO energy_scenarios (opportunity_id, name, model, input, summary, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [o.id, title.slice(0, 120), 'ppa_onsite', JSON.stringify(input), JSON.stringify(summaryOf(result)), userId]);
  const { rows: [a] } = await q.query("INSERT INTO energy_analyses (title, project_type, opportunity_id, created_by) VALUES ($1, 'ppa_onsite', $2, $3) RETURNING id", [title, o.id, userId]);
  await q.query("INSERT INTO energy_analysis_versions (analysis_id, n, label, source, scenario_id, created_by) VALUES ($1, 1, 'bozza dagli energivori', 'simulatore', $2, $3)", [a.id, sc.id, userId]);
  return { subject_id: sid, opportunity_id: o.id, analysis_id: a.id };
}

// Un energivoro citato in una notizia: il motivo per chiamarlo adesso (se è nell'elenco), con la data e il link.
async function reasonForEnergivoro(q, s) {
  const name = String(s.entity || '').trim();
  if (name.length < 4) return false;
  const { rowCount } = await q.query(
    `UPDATE crm_energivori SET energy_reason = $2, energy_reason_on = $3, energy_reason_url = $4
      WHERE id = (SELECT id FROM crm_energivori WHERE lower(name) = lower($1) OR lower(name) LIKE lower($1) || '%' OR lower($1) LIKE lower(name) || '%' ORDER BY length(name) LIMIT 1)`,
    [name, s.title.slice(0, 300), s.published_on || romeNow().day, s.url || '']);
  return rowCount > 0;
}

const OTHER_TYPES = ['cliente', 'epc', 'om', 'banca', 'consulente'];
const FILTERS = {
  proprietari: { label: 'Proprietari di impianti', hint: 'dal Database CE e dal radar' },
  sviluppatori: { label: 'Sviluppatori', hint: 'progetti autorizzati da comprare' },
  fondi: { label: 'Fondi e investitori', hint: 'cercano chi costruisce (EPC)' },
  energivori: { label: 'Energivori', hint: 'aziende da efficientare' },
  progettisti: { label: 'Progettisti', hint: 'chi vince le gare nel settore' },
  altri: { label: 'Altri', hint: 'clienti PPA, EPC, O&M, banche, consulenti' },
};

function registerEnergyCrm(app, { db }) {
  // Conteggi delle tessere, con un secondo numero «da fare» dove c'è.
  app.get('/api/energy/crm/tessere', async (_req, res) => {
    const one = (sql, params = []) => db.query(sql, params).then(r => r.rows[0]).catch(() => ({ n: 0, todo: 0 }));
    const [prop, svil, fondi, energ, prog, altri] = await Promise.all([
      one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE relation = 'in_contatto')::int AS todo FROM energy_companies WHERE 'proprietario' = ANY(types)`),
      one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE relation = 'attivo')::int AS todo FROM energy_companies WHERE 'sviluppatore' = ANY(types)`),
      one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE lead_stage = 'da_contattare')::int AS todo FROM crm_subjects
            WHERE merged_into IS NULL AND segment = 'Fondo o investitore'`),
      one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE subject_id IS NULL)::int AS todo FROM crm_energivori`),
      one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE 'energy' = ANY(asa))::int AS todo FROM crm_subjects
            WHERE merged_into IS NULL AND 'progettista' = ANY(roles)`),
      one(`SELECT COUNT(*)::int AS n, 0 AS todo FROM energy_companies WHERE types && $1::text[] AND NOT types && ARRAY['proprietario', 'sviluppatore', 'investitore', 'progettista']::text[]`, [OTHER_TYPES]),
    ]);
    const todo = { proprietari: `in contatto: ${prop.todo}`, sviluppatori: `attivi: ${svil.todo}`, fondi: `da contattare: ${fondi.todo}`,
      energivori: `non ancora nel CRM: ${energ.todo}`, progettisti: `già con Energy: ${prog.todo}`, altri: '' };
    const counts = { proprietari: prop.n, sviluppatori: svil.n, fondi: fondi.n, energivori: energ.n, progettisti: prog.n, altri: altri.n };
    res.json({ tiles: Object.entries(FILTERS).map(([key, f]) => ({ key, label: f.label, hint: f.hint, count: counts[key] || 0, todo: todo[key] })) });
  });

  // L'elenco di una tessera. Ogni riga porta la scheda centrale (subject_id) e, se c'è, l'azienda di Energy (energy_id).
  app.get('/api/energy/crm/elenco', async (req, res) => {
    const filtro = String(req.query.filtro || 'proprietari');
    if (!FILTERS[filtro]) throw new HttpError(400, 'Filtro non valido');
    const q = req.query.q ? `%${String(req.query.q).trim()}%` : null;
    let rows;
    if (filtro === 'proprietari' || filtro === 'sviluppatori' || filtro === 'altri') {
      const where = filtro === 'altri'
        ? `c.types && $1::text[] AND NOT c.types && ARRAY['proprietario', 'sviluppatore', 'investitore', 'progettista']::text[]`
        : `$1::text = ANY(c.types)`;
      ({ rows } = await db.query(
        `SELECT c.id AS energy_id, c.subject_id, COALESCE(s.name, c.name) AS name, c.city, c.province, c.region, c.types, c.relation, c.vat,
                c.next_action, c.next_action_date, s.asa, s.roles,
                (SELECT COUNT(*)::int FROM energy_opportunities o WHERE o.company_id = c.id) AS opportunities,
                (SELECT o.title FROM energy_opportunities o WHERE o.company_id = c.id ORDER BY o.updated_at DESC LIMIT 1) AS last_opportunity
           FROM energy_companies c LEFT JOIN crm_subjects s ON s.id = c.subject_id
          WHERE ${where} ${q ? 'AND (c.name ILIKE $2 OR c.vat ILIKE $2 OR c.city ILIKE $2)' : ''}
          ORDER BY c.updated_at DESC LIMIT 300`,
        [filtro === 'altri' ? OTHER_TYPES : filtro === 'proprietari' ? 'proprietario' : 'sviluppatore', ...(q ? [q] : [])]));
    } else if (filtro === 'fondi') {
      ({ rows } = await db.query(
        `SELECT s.id AS subject_id, e.id AS energy_id, s.name, s.city, s.region, s.asa, s.lead_stage, m.techs, m.ticket_min, m.ticket_max, m.regions AS mandate_regions,
                m.seeks_epc, m.bus
           FROM crm_subjects s LEFT JOIN energy_companies e ON e.subject_id = s.id LEFT JOIN crm_fund_mandates m ON m.subject_id = s.id
          WHERE s.merged_into IS NULL AND s.segment = 'Fondo o investitore' ${q ? 'AND (s.name ILIKE $1 OR s.city ILIKE $1)' : ''}
          ORDER BY (m.seeks_epc IS TRUE) DESC, s.updated_at DESC LIMIT 300`, q ? [q] : []).catch(() => ({ rows: [] })));
    } else if (filtro === 'energivori') {
      ({ rows } = await db.query(
        `SELECT e.id AS energivoro_id, e.subject_id, NULL::int AS energy_id, COALESCE(s.name, e.name) AS name, e.city, e.province, e.region, e.sector,
                e.consumption_gwh, e.roof_m2, s.lead_stage
           FROM crm_energivori e LEFT JOIN crm_subjects s ON s.id = e.subject_id
          ${q ? 'WHERE (e.name ILIKE $1 OR e.city ILIKE $1 OR e.sector ILIKE $1)' : ''}
          ORDER BY e.consumption_gwh DESC NULLS LAST LIMIT 300`, q ? [q] : []).catch(() => ({ rows: [] })));
    } else {
      ({ rows } = await db.query(
        `SELECT s.id AS subject_id, e.id AS energy_id, s.name, s.city, s.region, s.asa, s.lead_stage
           FROM crm_subjects s LEFT JOIN energy_companies e ON e.subject_id = s.id
          WHERE s.merged_into IS NULL AND 'progettista' = ANY(s.roles) ${q ? 'AND (s.name ILIKE $1 OR s.city ILIKE $1)' : ''}
          ORDER BY ('energy' = ANY(s.asa)) DESC, s.updated_at DESC LIMIT 300`, q ? [q] : []));
    }
    res.json({ filtro, label: FILTERS[filtro].label, rows });
  });

  const radarRegions = async () => ((await getSetting(db, 'energy.radar', {})) || {}).regions || [];

  // ── Fondi: chi cerca un EPC adesso (notizie del radar), tutti i fondi col mandato, abbinamenti ai nostri progetti ──
  app.get('/api/energy/crm/fondi', async (_req, res) => {
    const [{ rows: funds }, { rows: news }, { rows: projects }] = await Promise.all([
      db.query(`SELECT s.id AS subject_id, s.name, s.city, s.region, s.lead_stage, e.id AS energy_id,
                       COALESCE(m.techs, '{}') AS techs, m.ticket_min, m.ticket_max, COALESCE(m.regions, '{}') AS regions, COALESCE(m.phases, '{}') AS phases,
                       COALESCE(m.seeks_epc, false) AS seeks_epc, COALESCE(m.bus, '{}') AS bus
                  FROM crm_subjects s LEFT JOIN crm_fund_mandates m ON m.subject_id = s.id LEFT JOIN energy_companies e ON e.subject_id = s.id
                 WHERE s.merged_into IS NULL AND s.segment = 'Fondo o investitore' ORDER BY s.updated_at DESC LIMIT 300`),
      db.query(`SELECT id, title, summary, entity, region, url, published_on, score, created_at FROM energy_signals
                 WHERE kind = 'fondo' AND status = 'nuovo' ORDER BY score DESC, created_at DESC LIMIT 20`),
      db.query(`SELECT id, title, kind, project_type, selection, stage, capex, region FROM energy_opportunities
                 WHERE selection IN ('valutazione', 'avviato') ORDER BY selection_changed_at DESC NULLS LAST LIMIT 100`),
    ]);
    const best = m => {
      let top = null;
      for (const p of projects) {
        const r = F.matchFund(m, p);
        if (!top || r.pct > top.pct) top = { pct: r.pct, project_id: p.id, project_title: p.title, reasons: r.reasons };
      }
      return top;
    };
    const nuovi = news.map(n => {
      const m = { techs: F.techsOfText(n.title, n.summary), regions: F.regionsOfText(n.title, n.summary), phases: [] };
      return { ...n, techs: m.techs, regions: m.regions, match: best(m) };
    });
    const list = funds.map(f => ({ ...f, match: best(f) }));
    const abbinamenti = projects.map(p => ({
      project_id: p.id, title: p.title, selection: p.selection,
      funds: funds.map(f => ({ subject_id: f.subject_id, name: f.name, pct: F.matchFund(f, p).pct })).filter(x => x.pct >= 60).sort((a, b) => b.pct - a.pct).slice(0, 3),
    }));
    const contact = ['contattato', 'incontro', 'opportunita'];
    res.json({
      kpi: { da_chiamare: nuovi.length + list.filter(f => f.seeks_epc && f.lead_stage === 'da_contattare').length, fondi: funds.length,
        in_contatto: funds.filter(f => contact.includes(f.lead_stage)).length, capitale: funds.reduce((s, f) => s + (Number(f.ticket_max) || 0), 0) },
      nuovi, fondi: list, abbinamenti,
    });
  });

  // «Aggiungi al CRM» un fondo trovato nelle notizie.
  app.post('/api/energy/crm/fondi/segnali/:id/aggiungi', async (req, res) => {
    const { rows: [s] } = await db.query("SELECT * FROM energy_signals WHERE id = $1 AND kind = 'fondo'", [v.int(req.params.id, 'id', { min: 1 })]);
    if (!s) throw new HttpError(404, 'Segnale non trovato');
    if (s.status !== 'nuovo') throw new HttpError(400, 'Il segnale è già stato deciso');
    res.json(await db.tx(q => addFundFromSignal(q, s, req.user.id)));
  });

  // «Proponi Almacis come EPC»: il fondo passa a «contattato» e nasce il compito di scrivergli (prossimo passo della scheda).
  app.post('/api/energy/crm/fondi/:subjectId/proponi', async (req, res) => {
    const sid = v.int(req.params.subjectId, 'id', { min: 1 });
    const project = v.text(req.body?.project, 'Progetto', { max: 200 }) || '';
    const { rowCount } = await db.query(
      `UPDATE crm_subjects SET lead_stage = CASE WHEN lead_stage = 'da_contattare' THEN 'contattato' ELSE lead_stage END,
              next_step = $2, next_step_date = $3, updated_at = now() WHERE id = $1 AND segment = 'Fondo o investitore'`,
      [sid, `Proporre Almacis come EPC${project ? ` per ${project}` : ''}`, addWorkdays(romeNow().day, 2)]);
    if (!rowCount) throw new HttpError(404, 'Fondo non trovato');
    res.json({ ok: true });
  });

  // ── Energivori: chi chiamare questa settimana ─────────────────────────────────────────────────────────────
  app.get('/api/energy/crm/energivori', async (req, res) => {
    const today = romeNow().day;
    const regions = await radarRegions();
    const { rows } = await db.query(
      `SELECT e.*, s.lead_stage, s.name AS subject_name FROM crm_energivori e LEFT JOIN crm_subjects s ON s.id = e.subject_id
        ${req.query.regione ? 'WHERE lower(e.region) = lower($1)' : ''} ORDER BY e.consumption_gwh DESC NULLS LAST LIMIT 2000`,
      req.query.regione ? [String(req.query.regione)] : []).catch(() => ({ rows: [] }));
    const contact = ['contattato', 'incontro', 'opportunita'];
    const all = rows.map(e => ({
      id: e.id, subject_id: e.subject_id, name: e.subject_name || e.name, city: e.city, province: e.province, region: e.region, sector: e.sector,
      consumption_gwh: e.consumption_gwh, roof_m2: e.roof_m2, reason: e.energy_reason, reason_on: e.energy_reason_on, reason_url: e.energy_reason_url,
      snoozed: Boolean(e.energy_snooze_until && String(e.energy_snooze_until).slice(0, 10) > today),
      status: !e.subject_id ? 'da_chiamare' : contact.includes(e.lead_stage) ? 'in_contatto' : e.lead_stage === 'non_interessato' ? 'non_interessato' : e.lead_stage === 'opportunita' ? 'cliente' : 'da_chiamare',
      score: F.energivoroScore(e, { regions, today }), saving: F.savingEur(e),
    })).sort((a, b) => b.score - a.score);
    const top = all.filter(e => !e.snoozed && e.status === 'da_chiamare').sort((a, b) => (b.reason ? 1 : 0) - (a.reason ? 1 : 0) || b.score - a.score).slice(0, 3);
    // energivori trovati nelle notizie dal radar energia e non ancora nell'elenco: anche loro da chiamare
    const { rows: nuovi } = await db.query(
      `SELECT id, title, summary, why, entity, region, place, url, published_on, created_at, score FROM energy_signals
        WHERE kind = 'energivoro' AND status = 'nuovo' ORDER BY score DESC, created_at DESC LIMIT 12`);
    res.json({
      kpi: { da_chiamare: top.length + nuovi.length, totale: all.length, in_contatto: all.filter(e => e.status === 'in_contatto').length, risparmio: all.reduce((s, e) => s + e.saving, 0) },
      top, nuovi, elenco: all.slice(0, 200), regions: [...new Set(rows.map(r => r.region).filter(Boolean))].sort(),
    });
  });

  app.post('/api/energy/crm/energivori/:id/approccia', async (req, res) => {
    const { rows: [e] } = await db.query('SELECT * FROM crm_energivori WHERE id = $1', [v.int(req.params.id, 'id', { min: 1 })]);
    if (!e) throw new HttpError(404, 'Energivoro non trovato');
    const { rows: [already] } = await db.query("SELECT id FROM energy_opportunities WHERE source_key = $1", [`energivoro:${e.id}`]);
    if (already) throw new HttpError(400, 'C\'è già un\'opportunità per questa azienda');
    res.json(await db.tx(q => approachEnergivoro(q, e, req.user.id)));
  });

  app.post('/api/energy/crm/energivori/:id/non-ora', async (req, res) => {
    const { rowCount } = await db.query('UPDATE crm_energivori SET energy_snooze_until = $2 WHERE id = $1',
      [v.int(req.params.id, 'id', { min: 1 }), addWorkdays(romeNow().day, 22)]);
    if (!rowCount) throw new HttpError(404, 'Energivoro non trovato');
    res.json({ ok: true });
  });
}

module.exports = { registerEnergyCrm, FILTERS, addFundFromSignal, approachEnergivoro, reasonForEnergivoro };
