// Alma Energy · Clienti e contatti (ALM2-83 tappa 1): il CRM centrale visto da Energy. Ogni tessera è un filtro sulle
// stesse schede del CRM centrale (crm_subjects, BU «energy»): proprietari di impianti, sviluppatori, fondi e investitori
// (gli stessi di Alma Impianti), energivori (l'elenco caricato in Alma Impianti), progettisti, altri.
// Le aziende di Energy sono legate alla loro scheda centrale da energy_companies.subject_id (migrazione 123).
const { HttpError, v } = require('../lib/http');

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
}

module.exports = { registerEnergyCrm, FILTERS };
