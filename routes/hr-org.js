// Alma HR, Fase 2 (ALM2-52; canvas «Alma HR», pagina «Fase 2 · organigramma»). Regola di Dante: organigramma e persone
// in Alma sono solo da vedere, il data entry si fa su BOSS. La logica pura è in lib/hr-org.js.
//   GET  /api/hr/organigramma              tutti (salvo privacy «Persone: Niente»): incarichi con ruolo e grade, aree, livelli, numeri
//                                          per area; il team HR riceve anche RAL e costo
//   GET  /api/hr/costo                     solo HR: monte RAL, costo azienda, vacanti al riferimento, per area
//   GET  /api/hr/sincronizzazione                          solo HR: stato della sincronizzazione con BOSS
//   GET  /api/hr/strategy-ruoli · POST /api/hr/strategy-ruoli/collega   solo HR: un solo mansionario con Alma Strategy
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hr');
const O = require('../lib/hr-org');

const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const hrMod = () => require('./hr'); // currentGrid, hrRoles, loadPeople (richiesto qui per evitare il giro di require)

// Incarichi attivi con persona, ruolo, fascia; con withPay anche RAL e costo (solo per il team HR).
async function orgData(db, { withPay = false } = {}) {
  const { currentGrid, hrRoles, loadPeople } = hrMod();
  const [aree, livelli, inc, people, roles, g, entra] = await Promise.all([
    db.query('SELECT id, nome, tipo, ordine, attiva FROM org_aree ORDER BY ordine, nome'),
    db.query('SELECT id, nome, ordine, approva, attivo FROM org_livelli ORDER BY ordine, id'),
    db.query(`SELECT i.id, i.nome, i.area_id, i.livello_id, i.riporta_a_id, lower(i.ricoperto_da) AS email, i.boss_id, i.boss_url,
                     i.vacante_dal::text AS vacante_dal, r.role_id, r.proposed_id
              FROM org_incarichi i LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo ORDER BY i.id`),
    loadPeople(db, { withPay }), hrRoles(db), currentGrid(db),
    db.query('SELECT lower(email) AS email, name FROM org_people WHERE email IS NOT NULL'),
  ]);
  const byEmail = new Map(people.filter(p => p.email).map(p => [p.email, p]));
  const entraName = new Map(entra.rows.map(r => [r.email, r.name]));
  const roleBy = new Map(roles.map(r => [r.id, r]));
  const coeff = Number(g.rules.costCoeff) || H.DEFAULT_RULES.costCoeff;
  const incarichi = inc.rows.map(i => {
    const p = i.email ? byEmail.get(i.email) : null;
    const role = i.role_id ? roleBy.get(i.role_id) : null;
    const band = role ? H.bandOf(g.bands, role.grade) : null;
    const out = {
      id: i.id, nome: i.nome, area_id: i.area_id, livello_id: i.livello_id, riporta_a_id: i.riporta_a_id, boss_url: i.boss_url, boss_id: i.boss_id,
      persona: i.email ? { email: i.email, nome: p ? `${p.nome} ${p.cognome}`.trim() : entraName.get(i.email) || i.email, key: p?.key || null, sesso: p?.sesso || null, boss_url: p?.boss_url || null } : null,
      vacante_dal: i.email ? null : i.vacante_dal,
      role_id: i.role_id || null, role: role ? { id: role.id, title: H.roleTitle(role), grade: role.grade } : null, da_confermare: !i.role_id && Boolean(i.proposed_id),
      band: !i.email && band ? band : null,
    };
    if (withPay) {
      const ral = p && !p.esclusione ? p.ral : null;
      out.ral = ral;
      out.costo = ral ? Math.round(ral * coeff) : null;
      out.vacante_rif = !i.email && band ? Math.round(band.mid * 1000) : null;
      out.position = ral && role ? H.position(ral, p.part_time_pct, H.bandOf(g.bands, role.grade), g.rules) : null;
    }
    return out;
  });
  return { aree: aree.rows, livelli: livelli.rows, incarichi, roles, grid: g, coeff, people };
}

// Numeri per area (persone, vacanti, senza ruolo, span, grade medio, % donne; con il costo per il team HR).
function areaStats(d, withPay) {
  const gradeOf = id => d.roles.find(r => r.id === id)?.grade || null;
  const rows = [...d.aree.filter(a => a.attiva), { id: null, nome: 'Senza area' }].map(a => {
    const list = d.incarichi.filter(i => (i.area_id ?? null) === a.id);
    if (!list.length) return null;
    const s = O.orgStats(list, gradeOf);
    const withSex = list.filter(i => i.persona?.sesso);
    const capo = list.find(i => !list.some(j => j.id === i.riporta_a_id)) || null; // il più alto dell'area
    const out = { area_id: a.id, nome: a.nome, ...s, responsabile: capo?.persona?.nome || null, donne_pct: withSex.length ? Math.round(withSex.filter(i => i.persona.sesso === 'F').length / withSex.length * 100) : null };
    if (withPay) { out.monte = list.reduce((t, i) => t + (i.ral || 0), 0); out.costo = list.reduce((t, i) => t + (i.costo || 0), 0); out.vacanti_rif = list.reduce((t, i) => t + (i.vacante_rif || 0), 0); }
    return out;
  }).filter(Boolean);
  return rows;
}

// ── sincronizzazione dell'organigramma da BOSS ─────────────────────────────────────────────────────────────
async function snapshot(db) {
  const [inc, people] = await Promise.all([
    db.query(`SELECT i.boss_id, i.nome, p.boss_id AS riporta_a, lower(i.ricoperto_da) AS ricoperto_da FROM org_incarichi i
              LEFT JOIN org_incarichi p ON p.id = i.riporta_a_id WHERE i.attivo AND i.boss_id IS NOT NULL`),
    db.query(`SELECT h.key, h.nome, h.cognome, (SELECT ral::float FROM hr_pay WHERE person_key = h.key AND valid_from <= $1 ORDER BY valid_from DESC LIMIT 1) AS ral
              FROM hr_people h WHERE h.attivo`, [todayIso()]),
  ]);
  return { incarichi: inc.rows, persone: people.rows };
}
async function recordEvents(db, before, after) {
  const ev = O.diffOrg(before, after);
  for (const e of ev) {
    await db.query(
      `INSERT INTO hr_events (tipo, oggetto, incarico_id, person_key, azione, fatto)
       VALUES ($1, $2, (SELECT id FROM org_incarichi WHERE boss_id = $3 LIMIT 1), $4, $5, $6)`,
      [e.tipo, e.oggetto, e.boss_id || null, e.person_key || null, e.azione || null, !e.azione]);
  }
  return ev.length;
}
const TIPI_AREA = new Set(['funzionale', 'operativa', 'altro']);
async function saveOrgFromBoss(q, data, people) {
  const emailByBoss = new Map(people.filter(p => p.boss_id).map(p => [String(p.boss_id), p.email]));
  const map = { area: new Map(), livello: new Map(), inc: new Map() };
  for (const a of data.businessUnits || []) {
    const tipo = TIPI_AREA.has(a.tipo) ? a.tipo : 'altro';
    const { rows: [ex] } = await q.query('SELECT id FROM org_aree WHERE boss_id = $1 OR (boss_id IS NULL AND lower(nome) = lower($2)) ORDER BY boss_id NULLS LAST LIMIT 1', [String(a.id), a.nome]);
    if (ex) { await q.query('UPDATE org_aree SET boss_id = $1, nome = $2, attiva = $3 WHERE id = $4', [String(a.id), a.nome, a.attiva !== false, ex.id]); map.area.set(String(a.id), ex.id); }
    else { const { rows: [n] } = await q.query('INSERT INTO org_aree (nome, tipo, ordine, attiva, boss_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [a.nome, tipo, Number(a.ordine) || 100, a.attiva !== false, String(a.id)]); map.area.set(String(a.id), n.id); }
  }
  for (const l of data.livelli || []) {
    const { rows: [ex] } = await q.query('SELECT id FROM org_livelli WHERE boss_id = $1 OR (boss_id IS NULL AND lower(nome) = lower($2)) ORDER BY boss_id NULLS LAST LIMIT 1', [String(l.id), l.nome]);
    if (ex) { await q.query('UPDATE org_livelli SET boss_id = $1, nome = $2, ordine = $3, approva = $4, attivo = $5 WHERE id = $6', [String(l.id), l.nome, Number(l.ordine) || 1, Boolean(l.approva), l.attivo !== false, ex.id]); map.livello.set(String(l.id), ex.id); }
    else { const { rows: [n] } = await q.query('INSERT INTO org_livelli (nome, ordine, approva, attivo, boss_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [l.nome, Number(l.ordine) || 1, Boolean(l.approva), l.attivo !== false, String(l.id)]); map.livello.set(String(l.id), n.id); }
  }
  const active = (data.incarichi || []).filter(i => i.attivo !== false);
  for (const i of active) {
    const email = i.ricopertoDaPersonaleId ? emailByBoss.get(String(i.ricopertoDaPersonaleId)) || null : null;
    const areaId = i.businessUnitId ? map.area.get(String(i.businessUnitId)) ?? null : null;
    const livId = i.livelloOrganigrammaId ? map.livello.get(String(i.livelloOrganigrammaId)) ?? null : null;
    // adotta l'incarico già fatto in Alma con lo stesso nome e la stessa persona, così il ruolo del mansionario resta
    const { rows: [ex] } = await q.query(
      `SELECT id, ricoperto_da, vacante_dal FROM org_incarichi WHERE boss_id = $1
       UNION ALL SELECT id, ricoperto_da, vacante_dal FROM org_incarichi WHERE boss_id IS NULL AND attivo AND lower(nome) = lower($2) AND coalesce(lower(ricoperto_da), '') = coalesce($3, '') LIMIT 1`,
      [String(i.id), i.nome, email]);
    const vacDal = email ? null : (ex && !ex.ricoperto_da ? ex.vacante_dal || todayIso() : todayIso());
    if (ex) {
      await q.query('UPDATE org_incarichi SET boss_id = $1, nome = $2, area_id = $3, livello_id = $4, ricoperto_da = $5, attivo = true, boss_url = $6, vacante_dal = $7, updated_at = now() WHERE id = $8',
        [String(i.id), i.nome, areaId, livId, email, i.bossUrl || null, vacDal, ex.id]);
      map.inc.set(String(i.id), ex.id);
    } else {
      const { rows: [n] } = await q.query('INSERT INTO org_incarichi (nome, area_id, livello_id, ricoperto_da, boss_id, boss_url, vacante_dal) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [i.nome, areaId, livId, email, String(i.id), i.bossUrl || null, vacDal]);
      map.inc.set(String(i.id), n.id);
    }
  }
  for (const i of active) {
    await q.query('UPDATE org_incarichi SET riporta_a_id = $1 WHERE id = $2', [i.riportaAIncaricoId ? map.inc.get(String(i.riportaAIncaricoId)) ?? null : null, map.inc.get(String(i.id))]);
  }
  await q.query('UPDATE org_incarichi SET attivo = false WHERE attivo AND boss_id IS NOT NULL AND NOT (boss_id = ANY($1))', [active.map(i => String(i.id))]);
}

// ── un solo mansionario con Alma Strategy ─────────────────────────────────────────────────────────────────
// Il ruolo di una persona in Strategy = il ruolo del suo incarico (principale) o quello dato in HR alla persona;
// il responsabile = chi ricopre l'incarico a cui riporta. Si scrive solo quando Alma HR lo sa: altrimenti resta quello di prima.
async function computeDerived(db) {
  const [users, inc, princ, hp] = await Promise.all([
    db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL'),
    db.query(`SELECT i.id, lower(i.ricoperto_da) AS email, i.riporta_a_id, r.role_id FROM org_incarichi i LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo`),
    db.query('SELECT lower(email) AS email, incarico_principale_id FROM org_persone WHERE incarico_principale_id IS NOT NULL'),
    db.query('SELECT email, role_id FROM hr_people WHERE attivo AND email IS NOT NULL AND role_id IS NOT NULL'),
  ]);
  const userBy = new Map(users.rows.map(u => [u.email, u.id]));
  const incBy = new Map(inc.rows.map(i => [i.id, i]));
  const princBy = new Map(princ.rows.map(p => [p.email, p.incarico_principale_id]));
  const hpRole = new Map(hp.rows.map(p => [p.email, p.role_id]));
  const out = new Map();
  for (const u of users.rows) {
    const mine = inc.rows.filter(i => i.email === u.email);
    const main = mine.find(i => i.id === princBy.get(u.email)) || mine.find(i => i.role_id) || mine[0];
    const roleId = main?.role_id || hpRole.get(u.email) || null;
    let managerId = null;
    let cur = main?.riporta_a_id;
    const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const up = incBy.get(cur); if (!up) break; if (up.email && userBy.get(up.email) && up.email !== u.email) { managerId = userBy.get(up.email); break; } cur = up.riporta_a_id; } // salta i vacanti
    if (roleId || managerId) out.set(u.id, { role_id: roleId, manager_id: managerId });
  }
  return out;
}
// Per Alma Strategy: ruolo e responsabile che Alma HR conosce per una persona (vuoto se non li conosce).
async function derivedFor(db, userId) { return (await computeDerived(db)).get(userId) || {}; }
async function syncStrategyProfiles(db) {
  let n = 0;
  for (const [userId, d] of await computeDerived(db)) {
    const { rowCount } = await db.query(
      `INSERT INTO pm_profiles (user_id, role_id, manager_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET role_id = COALESCE($2, pm_profiles.role_id), manager_id = COALESCE($3, pm_profiles.manager_id)
       WHERE pm_profiles.role_id IS DISTINCT FROM COALESCE($2, pm_profiles.role_id) OR pm_profiles.manager_id IS DISTINCT FROM COALESCE($3, pm_profiles.manager_id)`,
      [userId, d.role_id, d.manager_id]);
    n += rowCount;
  }
  return n;
}

function registerHrOrg(app, { db, gov }) {
  const isHr = req => gov.roleOf(req.user.email).key === 'hr';
  const hrOnly = req => { if (!isHr(req)) throw new HttpError(403, 'Riservato al team HR'); };
  const log = (req, action, extra = {}) => db.query('INSERT INTO hr_log (user_id, kind, action, before, after) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, extra.kind || 'modifica', action, extra.before ? JSON.stringify(extra.before) : null, extra.after ? JSON.stringify(extra.after) : null]);

  // Le aree con il loro tipo, per il filtro dell'ambito (tutti).
  app.get('/api/hr/aree', async (_req, res) => {
    const { rows } = await db.query('SELECT id, nome, tipo FROM org_aree WHERE attiva ORDER BY ordine, nome');
    res.json({ aree: rows });
  });
  const scoped = (d, ambito) => {
    if (!ambito) return d;
    const { inScope } = hrMod();
    const area = id => d.aree.find(a => a.id === id) || null;
    return { ...d, incarichi: d.incarichi.filter(i => inScope(area(i.area_id), ambito)), people: d.people.filter(p => inScope(p.area, ambito)),
      aree: d.aree.filter(a => inScope(a, ambito)) };
  };

  app.get('/api/hr/organigramma', async (req, res) => {
    const hr = isHr(req);
    if (req.privacy?.persone === 'none' && !hr) throw new HttpError(403, 'L\'organigramma non è tra le cose che puoi vedere');
    const ambito = hrMod().ambitoOf(req);
    const full = await orgData(db, { withPay: hr });
    const d = scoped(full, ambito);
    const { rows: [s] } = await db.query('SELECT max(synced_at) AS at, bool_or(source = \'boss\') AS boss FROM hr_people');
    if (hr) await log(req, 'organigramma con i costi', { kind: 'accesso' });
    res.json({
      aree: full.aree, livelli: d.livelli, incarichi: d.incarichi, is_hr: hr, aree_stats: areaStats(d, hr), ambito,
      totali: O.orgStats(d.incarichi, id => d.roles.find(r => r.id === id)?.grade || null),
      sync: { at: s.at, boss: Boolean(s.boss), api: Boolean(process.env.BOSS_PERSONALE_URL) }, boss_base: process.env.BOSS_APP_URL || null,
    });
  });

  app.get('/api/hr/costo', async (req, res) => {
    hrOnly(req);
    const d = scoped(await orgData(db, { withPay: true }), hrMod().ambitoOf(req));
    const st = H.stats(d.people.map(p => ({ ...p, grade: d.roles.find(r => r.id === p.role_id)?.grade || null })), d.grid.bands, d.grid.rules);
    const aree = areaStats(d, true);
    await log(req, 'costo dell\'organigramma', { kind: 'accesso' });
    res.json({ coeff: d.coeff, aree, totale: { persone: aree.reduce((t, a) => t + a.persone, 0), monte: aree.reduce((t, a) => t + a.monte, 0), costo: aree.reduce((t, a) => t + a.costo, 0), vacanti: aree.reduce((t, a) => t + a.vacanti, 0), vacanti_rif: aree.reduce((t, a) => t + a.vacanti_rif, 0), rientro: st.cost } });
  });

  app.get('/api/hr/costo.xlsx', async (req, res) => {
    hrOnly(req);
    const d = scoped(await orgData(db, { withPay: true }), hrMod().ambitoOf(req));
    const aree = areaStats(d, true);
    const { writeXlsx } = require('../lib/xlsx');
    const sum = k => aree.reduce((t, a) => t + (a[k] || 0), 0);
    const rows = [["RISERVATO · Alma HR · costo dell'organigramma"], ['Area', 'Persone', 'Monte RAL (€)', 'Costo azienda stimato (€)', 'Vacanti', 'Vacanti al riferimento (€)'],
      ...aree.map(a => [a.nome, a.persone, a.monte, a.costo, a.vacanti, a.vacanti_rif]), ['Totale', sum('persone'), sum('monte'), sum('costo'), sum('vacanti'), sum('vacanti_rif')],
      [], [`Costo azienda = RAL × ${d.coeff}`]];
    await log(req, "export del costo dell'organigramma", { kind: 'accesso' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', 'attachment; filename="costo-organigramma-riservato.xlsx"').send(writeXlsx({ Costo: rows }));
  });

  // ── stato della sincronizzazione con BOSS (nella pagina Persone). I cambi della notte restano nel registro
  // hr_events in sottofondo: gli avvisi ormai stanno dove si agisce (richieste, onboarding, ruoli sugli incarichi).
  app.get('/api/hr/sincronizzazione', async (req, res) => {
    hrOnly(req);
    const [{ rows: [s] }, { rows: [inc] }] = await Promise.all([
      db.query("SELECT max(synced_at) AS at, bool_or(source = 'boss') AS boss, count(*) FILTER (WHERE attivo)::int AS persone FROM hr_people"),
      db.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE r.role_id IS NULL)::int AS senza_ruolo FROM org_incarichi i LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo'),
    ]);
    res.json({ at: s.at, boss: Boolean(s.boss), api: Boolean(process.env.BOSS_PERSONALE_URL), persone: s.persone, incarichi: inc.n, senza_ruolo: inc.senza_ruolo });
  });

  // ── collegamento con Alma Strategy ──
  app.get('/api/hr/strategy-ruoli', async (req, res) => {
    hrOnly(req);
    const { hrRoles } = hrMod();
    const [roles, { rows: old }] = await Promise.all([hrRoles(db), db.query(
      `SELECT r.id, r.title, r.area, jsonb_array_length(r.responsibilities) AS resp, jsonb_array_length(r.hard_skills) AS skills,
              (SELECT count(*)::int FROM pm_profiles p WHERE p.role_id = r.id) AS persone,
              (SELECT count(*)::int FROM pm_objectives o JOIN pm_profiles p ON p.user_id = o.user_id WHERE p.role_id = r.id) AS obiettivi
       FROM pm_roles r WHERE r.hr_family IS NULL AND r.merged_into IS NULL ORDER BY r.title`)]);
    res.json({
      ruoli: old.map(o => { const s = O.suggestHrRole(o.title, roles); return { ...o, proposto: s ? { id: s.id, title: H.roleTitle(s) } : null }; }),
      hr: roles.map(r => ({ id: r.id, title: H.roleTitle(r), grade: r.grade, family: r.hr_family })),
    });
  });
  app.post('/api/hr/strategy-ruoli/collega', async (req, res) => {
    hrOnly(req);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 300) throw new HttpError(400, 'Niente da collegare');
    await db.tx(async q => {
      for (const it of items) {
        const oldId = v.int(it.old_id, 'ruolo di Strategy', { min: 1 });
        const newId = v.int(it.role_id, 'ruolo HR', { min: 1 });
        const { rows: [o] } = await q.query('SELECT id, responsibilities, hard_skills FROM pm_roles WHERE id = $1 AND hr_family IS NULL AND merged_into IS NULL', [oldId]);
        const { rows: [n] } = await q.query('SELECT id, responsibilities, hard_skills FROM pm_roles WHERE id = $1 AND hr_family IS NOT NULL', [newId]);
        if (!o || !n) throw new HttpError(400, 'Ruolo non trovato o già collegato');
        // le 5 responsabilità e le competenze passano al ruolo HR solo se lui non le ha ancora
        await q.query(`UPDATE pm_roles SET responsibilities = CASE WHEN jsonb_array_length(responsibilities) = 0 THEN $1::jsonb ELSE responsibilities END,
                              hard_skills = CASE WHEN jsonb_array_length(hard_skills) = 0 THEN $2::jsonb ELSE hard_skills END WHERE id = $3`,
          [JSON.stringify(o.responsibilities || []), JSON.stringify(o.hard_skills || []), newId]);
        await q.query('UPDATE pm_profiles SET role_id = $1 WHERE role_id = $2', [newId, oldId]);
        await q.query('UPDATE pm_change_requests SET role_id = $1 WHERE role_id = $2', [newId, oldId]);
        await q.query("UPDATE pm_roles SET merged_into = $1, status = 'confirmed' WHERE id = $2", [newId, oldId]);
      }
    });
    await log(req, 'ruoli di Strategy collegati al mansionario', { after: items });
    const n = await syncStrategyProfiles(db);
    res.json({ ok: true, n: items.length, profili: n });
  });
}

module.exports = { registerHrOrg, snapshot, recordEvents, saveOrgFromBoss, syncStrategyProfiles, derivedFor, orgData };
