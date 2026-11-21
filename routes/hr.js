// Alma HR, Fase 1 (canvas «Alma HR», 21/11/2026). La logica è in lib/hr.js (pura); qui database e permessi.
// Per tutti:
//   GET  /api/hr/griglia                 griglia in vigore, ruoli per grade, zone (niente nomi, niente RAL)
//   GET  /api/hr/mansionario[/:id]       schede dei ruoli (chi le ha: solo team HR)
//   POST /api/hr/mansionario/:id/presa-visione
//   GET  /api/hr/percorso                il mio ruolo, il mio grade, il passo dopo
// Solo team HR (ruolo «Team HR» di Impostazioni › Ruoli; le RAL non le vede nessun altro):
//   GET  /api/hr/persone · GET /api/hr/persone/:key (registrata) · PATCH /api/hr/persone/:key { role_id, esclusione }
//   GET  /api/hr/incarichi · POST /api/hr/incarichi/conferma { items: [{ incarico_id, role_id }] }
//   POST/PATCH /api/hr/mansionario[/:id] · PATCH /api/hr/mansionario/:id/grade { grade }
//   GET  /api/hr/mappatura
//   GET  /api/hr/pannello · POST /api/hr/pannello/impatto · POST /api/hr/pannello/bozza · POST /api/hr/pannello/applica
//   GET  /api/hr/registro
//   POST /api/hr/import/persone[?applica=1]   export mensile HR di BOSS (xlsx): persone e RAL
//   POST /api/hr/import/v11[?applica=1]       mappatura Excel v11: proposte di ruolo sugli incarichi
//   POST /api/hr/boss/sync                    da BOSS via API (BOSS_PERSONALE_URL + BOSS_PERSONALE_TOKEN)
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { readXlsx } = require('../lib/xlsx');
const H = require('../lib/hr');

const BASE = '/api/hr';
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const ROLE_COLS = 'id, title, hr_family, hr_name, hr_level, grade, description, responsibilities, hard_skills, autonomy, next_criteria, requirements, hr_order, version, version_at';

// Il catalogo di partenza e la griglia 2026, la prima volta che serve (le tabelle nascono vuote con la migrazione 090).
let seeding = null;
async function ensureSeed(db) {
  seeding ||= (async () => {
    const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM pm_roles WHERE hr_family IS NOT NULL');
    if (!r.n) {
      for (const s of H.SEED_ROLES) {
        await db.query(
          `INSERT INTO pm_roles (title, area, description, status, hr_family, hr_name, hr_level, grade, autonomy, next_criteria, hr_order, confirmed_at, version_at)
           VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, $9, $10, now(), now())`,
          [H.roleTitle(s), H.FAMILIES.find(f => f.key === s.family).label, s.description, s.family, s.name, s.level, s.grade, JSON.stringify(s.autonomy), s.next, s.order]);
      }
    }
    const { rows: [g] } = await db.query('SELECT count(*)::int AS n FROM hr_grids');
    if (!g.n) {
      await db.query(`INSERT INTO hr_grids (label, bands, rules, params, valid_from, applied_at) VALUES ('Griglia 2026', $1, $2, $3, '2026-01-01', now())`,
        [JSON.stringify(H.DEFAULT_BANDS), JSON.stringify(H.DEFAULT_RULES), JSON.stringify(H.DEFAULT_PARAMS)]);
    }
  })().catch(err => { seeding = null; throw err; });
  return seeding;
}

async function currentGrid(db) {
  const { rows: [g] } = await db.query(
    `SELECT id, label, bands, rules, params, valid_from::text AS valid_from FROM hr_grids
     WHERE applied_at IS NOT NULL AND valid_from <= $1 ORDER BY valid_from DESC, applied_at DESC LIMIT 1`, [todayIso()]);
  if (!g) throw new HttpError(500, 'Nessuna griglia in vigore');
  g.rules = { ...H.DEFAULT_RULES, ...g.rules };
  return g;
}
const hrRoles = async db => (await db.query(`SELECT ${ROLE_COLS} FROM pm_roles WHERE hr_family IS NOT NULL ORDER BY hr_order, id`)).rows;

// Persone con ruolo, grade e RAL attuale. Il ruolo: quello dell'incarico (principale, se più d'uno), altrimenti quello
// dato a mano alla persona.
async function loadPeople(db, { withPay = false } = {}) {
  const [people, incarichi, principali, pay] = await Promise.all([
    db.query(`SELECT key, boss_id, nome, cognome, email, societa, bu, qualifica, ccnl, livello, contratto, part_time_pct::float AS part_time_pct,
                     data_assunzione::text AS data_assunzione, scadenza::text AS scadenza, sesso, attivo, esclusione, role_id, source, boss_url
              FROM hr_people WHERE attivo ORDER BY cognome, nome`),
    db.query(`SELECT i.id, i.nome, lower(i.ricoperto_da) AS email, a.nome AS area, r.role_id FROM org_incarichi i
              LEFT JOIN org_aree a ON a.id = i.area_id LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo`),
    db.query('SELECT lower(email) AS email, incarico_principale_id FROM org_persone WHERE incarico_principale_id IS NOT NULL'),
    withPay ? db.query(`SELECT DISTINCT ON (person_key) person_key, ral::float AS ral, ad_personam::float AS ad_personam, valid_from::text AS valid_from
                        FROM hr_pay WHERE valid_from <= $1 ORDER BY person_key, valid_from DESC`, [todayIso()]) : { rows: [] },
  ]);
  const princ = new Map(principali.rows.map(r => [r.email, r.incarico_principale_id]));
  const byEmail = new Map();
  for (const i of incarichi.rows) if (i.email) (byEmail.get(i.email) || byEmail.set(i.email, []).get(i.email)).push(i);
  const payBy = new Map(pay.rows.map(p => [p.person_key, p]));
  return people.rows.map(p => {
    const mine = (p.email && byEmail.get(p.email)) || [];
    const inc = mine.find(i => i.id === princ.get(p.email)) || mine[0] || null;
    return { ...p, incarico: inc ? { id: inc.id, nome: inc.nome, area: inc.area } : null, role_id: inc?.role_id || p.role_id || null,
      ...(withPay ? { ral: payBy.get(p.key)?.ral || null, ad_personam: payBy.get(p.key)?.ad_personam || 0, ral_dal: payBy.get(p.key)?.valid_from || null } : {}) };
  });
}

async function savePeople(q, people, source) {
  for (const p of people) {
    await q.query(
      `INSERT INTO hr_people (key, boss_id, nome, cognome, email, societa, bu, qualifica, ccnl, livello, contratto, part_time_pct, data_assunzione, scadenza, sesso, attivo, esclusione, source, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16,$17,now())
       ON CONFLICT (key) DO UPDATE SET boss_id = EXCLUDED.boss_id, nome = EXCLUDED.nome, cognome = EXCLUDED.cognome, email = EXCLUDED.email, societa = EXCLUDED.societa,
         bu = EXCLUDED.bu, qualifica = EXCLUDED.qualifica, ccnl = EXCLUDED.ccnl, livello = EXCLUDED.livello, contratto = EXCLUDED.contratto, part_time_pct = EXCLUDED.part_time_pct,
         data_assunzione = EXCLUDED.data_assunzione, scadenza = EXCLUDED.scadenza, sesso = EXCLUDED.sesso, attivo = true,
         esclusione = COALESCE(hr_people.esclusione, EXCLUDED.esclusione), source = EXCLUDED.source, synced_at = now()`,
      [p.key, p.boss_id, p.nome, p.cognome, p.email, p.societa, p.bu, p.qualifica, p.ccnl, p.livello, p.contratto, p.part_time_pct || 100, p.data_assunzione, p.scadenza, p.sesso, p.esclusione, source]);
    for (const pay of p.pay || (p.ral ? [{ ral: p.ral, ad_personam: p.ad_personam, valid_from: p.valid_from || todayIso().slice(0, 8) + '01' }] : [])) {
      await q.query(`INSERT INTO hr_pay (person_key, ral, ad_personam, valid_from, valid_to, source) VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (person_key, valid_from) DO UPDATE SET ral = EXCLUDED.ral, ad_personam = EXCLUDED.ad_personam, valid_to = EXCLUDED.valid_to, source = EXCLUDED.source`,
      [p.key, pay.ral, pay.ad_personam || 0, pay.valid_from, pay.valid_to || null, source]);
    }
  }
}
// chi non è più nell'elenco completo di BOSS non è più attivo (resta nello storico)
const deactivateMissing = (q, keys) => q.query('UPDATE hr_people SET attivo = false WHERE attivo AND NOT (key = ANY($1))', [keys]);


function registerHr(app, { db, gov }) {
  const isHr = req => gov.roleOf(req.user.email).key === 'hr';
  const hrOnly = req => { if (!isHr(req)) throw new HttpError(403, 'Riservato al team HR'); };
  const log = (req, kind, action, extra = {}) => db.query('INSERT INTO hr_log (user_id, kind, action, person_key, before, after) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.user.id, kind, action, extra.person || null, extra.before ? JSON.stringify(extra.before) : null, extra.after ? JSON.stringify(extra.after) : null]);
  app.use(BASE, async (_req, _res, next) => { try { await ensureSeed(db); next(); } catch (err) { next(err); } });

  // ── per tutti ────────────────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/griglia`, async (req, res) => {
    const [g, roles, me] = await Promise.all([currentGrid(db), hrRoles(db), myRole(req.user.email)]);
    res.json({
      label: g.label, valid_from: g.valid_from, zone: g.rules.zone, families: H.FAMILIES,
      bands: g.bands.map(b => ({ ...b, roles: roles.filter(r => r.grade === b.grade).map(r => ({ id: r.id, title: H.roleTitle(r), family: r.hr_family })) })),
      my_grade: me?.grade || null, is_hr: isHr(req),
    });
  });

  async function myRole(email) {
    const e = String(email).toLowerCase();
    const { rows: [r] } = await db.query(
      `SELECT p.${ROLE_COLS.split(', ').join(', p.')} FROM pm_roles p
       WHERE p.id = COALESCE(
         (SELECT r.role_id FROM org_incarichi i JOIN hr_incarico_roles r ON r.incarico_id = i.id
          LEFT JOIN org_persone o ON lower(o.email) = $1
          WHERE lower(i.ricoperto_da) = $1 AND i.attivo AND r.role_id IS NOT NULL ORDER BY (i.id = o.incarico_principale_id) DESC, i.id LIMIT 1),
         (SELECT role_id FROM hr_people WHERE email = $1 AND role_id IS NOT NULL LIMIT 1),
         (SELECT role_id FROM pm_profiles f JOIN users u ON u.id = f.user_id WHERE lower(u.email) = $1))
       AND p.hr_family IS NOT NULL`, [e]);
    return r || null;
  }

  app.get(`${BASE}/mansionario`, async (req, res) => {
    const [roles, g, counts] = await Promise.all([hrRoles(db), currentGrid(db), isHr(req) ? peopleByRole() : null]);
    res.json({ families: H.FAMILIES, is_hr: isHr(req), roles: roles.map(r => ({ ...r, title: H.roleTitle(r), band: H.bandOf(g.bands, r.grade), people: counts ? counts.get(r.id) || 0 : undefined })) });
  });
  async function peopleByRole() {
    const people = await loadPeople(db);
    const m = new Map();
    for (const p of people) if (p.role_id) m.set(p.role_id, (m.get(p.role_id) || 0) + 1);
    return m;
  }
  app.get(`${BASE}/mansionario/:id`, async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [r] } = await db.query(`SELECT ${ROLE_COLS} FROM pm_roles WHERE id = $1 AND hr_family IS NOT NULL`, [id]);
    if (!r) throw new HttpError(404, 'Ruolo non trovato');
    const g = await currentGrid(db);
    const out = { ...r, title: H.roleTitle(r), band: H.bandOf(g.bands, r.grade) };
    const { rows: [ack] } = await db.query('SELECT signed_at FROM hr_role_acks WHERE role_id = $1 AND email = $2 AND version = $3', [id, req.user.email.toLowerCase(), r.version]);
    out.my_ack = ack?.signed_at || null;
    if (isHr(req)) {
      const people = (await loadPeople(db)).filter(p => p.role_id === id);
      const { rows: acks } = await db.query('SELECT email FROM hr_role_acks WHERE role_id = $1 AND version = $2', [id, r.version]);
      const signed = new Set(acks.map(a => a.email));
      out.people = people.map(p => ({ key: p.key, nome: `${p.nome} ${p.cognome}`, signed: Boolean(p.email && signed.has(p.email)) }));
    }
    res.json(out);
  });
  app.post(`${BASE}/mansionario/:id/presa-visione`, async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [r] } = await db.query('SELECT version FROM pm_roles WHERE id = $1 AND hr_family IS NOT NULL', [id]);
    if (!r) throw new HttpError(404, 'Ruolo non trovato');
    await db.query('INSERT INTO hr_role_acks (role_id, email, version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.user.email.toLowerCase(), r.version]);
    res.json({ ok: true });
  });

  app.get(`${BASE}/percorso`, async (req, res) => {
    const [me, roles, g] = await Promise.all([myRole(req.user.email), hrRoles(db), currentGrid(db)]);
    if (!me) return res.json({ role: null, families: H.FAMILIES, bands: g.bands });
    const fam = roles.filter(r => r.hr_family === me.hr_family);
    const next = fam.filter(r => r.grade > me.grade || (r.grade === me.grade && r.hr_order > me.hr_order)).sort((a, b) => a.grade - b.grade || a.hr_order - b.hr_order)[0] || null;
    const { rows: [ack] } = await db.query('SELECT signed_at FROM hr_role_acks WHERE role_id = $1 AND email = $2 AND version = $3', [me.id, req.user.email.toLowerCase(), me.version]);
    res.json({
      role: { ...me, title: H.roleTitle(me), band: H.bandOf(g.bands, me.grade), signed_at: ack?.signed_at || null },
      next: next ? { id: next.id, title: H.roleTitle(next), grade: next.grade, band: H.bandOf(g.bands, next.grade), criteria: me.next_criteria } : null,
      ladder: roles.filter(r => ['gestione', 'field', 'engineering', 'staff', 'direzione'].includes(r.hr_family)).map(r => ({ id: r.id, title: H.roleTitle(r), family: r.hr_family, grade: r.grade })),
      families: H.FAMILIES, bands: g.bands,
    });
  });

  // ── solo team HR ─────────────────────────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/persone`, async (req, res) => {
    hrOnly(req);
    const [people, roles, g] = await Promise.all([loadPeople(db, { withPay: true }), hrRoles(db), currentGrid(db)]);
    const byId = new Map(roles.map(r => [r.id, r]));
    // proposta di ruolo per chi non ce l'ha: la proposta sull'incarico (mappatura v11), altrimenti dalla qualifica di BOSS
    const { rows: props } = await db.query('SELECT lower(i.ricoperto_da) AS email, r.proposed_id FROM org_incarichi i JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo AND r.role_id IS NULL AND r.proposed_id IS NOT NULL');
    const propBy = new Map(props.map(x => [x.email, x.proposed_id]));
    const { suggestHrRole } = require('../lib/hr-org');
    const out = people.map(p => {
      const role = byId.get(p.role_id);
      const propRole = !role && !p.esclusione ? (byId.get(propBy.get(p.email)) || suggestHrRole(p.qualifica || p.incarico?.nome || '', roles)) : null;
      const band = role ? H.bandOf(g.bands, role.grade) : null;
      return { key: p.key, nome: p.nome, cognome: p.cognome, email: p.email, societa: p.societa, bu: p.incarico?.area || p.bu, incarico: p.incarico, qualifica: p.qualifica,
        ccnl: p.ccnl, livello: p.livello, contratto: p.contratto, part_time_pct: p.part_time_pct, scadenza: p.scadenza, esclusione: p.esclusione, source: p.source,
        role: role ? { id: role.id, title: H.roleTitle(role), grade: role.grade } : null,
        proposed: propRole ? { id: propRole.id, title: H.roleTitle(propRole), grade: propRole.grade, why: propBy.get(p.email) ? 'dalla mappatura v11' : 'dalla qualifica di BOSS' } : null,
        position: !p.esclusione && band ? H.position(p.ral, p.part_time_pct, band, g.rules) : null };
    });
    const { rows: [s] } = await db.query('SELECT max(synced_at) AS at FROM hr_people');
    res.json({ people: out, synced_at: s.at, boss_api: Boolean(process.env.BOSS_PERSONALE_URL) });
  });

  app.get(`${BASE}/persone/:key`, async (req, res) => {
    hrOnly(req);
    const key = String(req.params.key);
    const people = await loadPeople(db, { withPay: true });
    const p = people.find(x => x.key === key);
    if (!p) throw new HttpError(404, 'Persona non trovata');
    const [roles, g, hist] = await Promise.all([hrRoles(db), currentGrid(db),
      db.query('SELECT ral::float AS ral, ad_personam::float AS ad_personam, valid_from::text AS valid_from, valid_to::text AS valid_to, source FROM hr_pay WHERE person_key = $1 ORDER BY valid_from DESC', [key])]);
    const role = roles.find(r => r.id === p.role_id) || null;
    const band = role ? H.bandOf(g.bands, role.grade) : null;
    const peers = role ? people.filter(x => x.role_id === role.id && x.ral && !x.esclusione).map(x => H.fte(x.ral, x.part_time_pct)).sort((a, b) => a - b) : [];
    const myFte = p.ral ? H.fte(p.ral, p.part_time_pct) : null;
    const next = role ? roles.filter(r => r.hr_family === role.hr_family && r.grade > role.grade).sort((a, b) => a.grade - b.grade)[0] : null;
    await log(req, 'accesso', 'scheda retribuzione', { person: key });
    res.json({
      person: { ...p }, role: role ? { id: role.id, title: H.roleTitle(role), grade: role.grade } : null, band,
      position: band && !p.esclusione ? H.position(p.ral, p.part_time_pct, band, g.rules) : null,
      history: hist.rows,
      peers: peers.length ? { n: peers.length, median: Math.round(peers[Math.floor(peers.length / 2)]), percentile: myFte ? Math.round(peers.filter(x => x <= myFte).length / peers.length * 100) : null } : null,
      promotion: next && p.ral ? { title: H.roleTitle(next), grade: next.grade, band: H.bandOf(g.bands, next.grade), ral: H.promotionRal(p.ral, H.bandOf(g.bands, next.grade), g.rules) } : null,
      ccnl_link: role ? g.rules.ccnl?.[role.grade] || null : null,
      variabile: role && g.rules.variabile?.[role.grade] ? { pct: g.rules.variabile[role.grade], su: g.rules.variabileSu?.[role.grade] || '' } : null,
      // retribuzione totale (tavola H, punto 5): RAL + ad personam + premio variabile a metà del suo target; welfare, auto e trasferte quando BOSS li passa
      totale: p.ral && role ? (() => {
        const vb = g.rules.variabile?.[role.grade] || [0, 0];
        const vt = Math.round(p.ral * (vb[0] + vb[1]) / 2 / 100);
        return { ral: p.ral, ad_personam: p.ad_personam || 0, variabile_target: vt, totale: p.ral + (p.ad_personam || 0) + vt };
      })() : null,
    });
  });

  app.patch(`${BASE}/persone/:key`, async (req, res) => {
    hrOnly(req);
    const key = String(req.params.key);
    const roleId = v.int(req.body.role_id, 'ruolo', { min: 1, nullable: true });
    const excl = v.oneOf(req.body.esclusione ?? undefined, 'esclusione', [null, ...H.DEFAULT_RULES.excluded]);
    const sets = []; const vals = [];
    if (roleId !== undefined) { vals.push(roleId); sets.push(`role_id = $${vals.length}`); }
    if (req.body.esclusione !== undefined) { vals.push(excl ?? null); sets.push(`esclusione = $${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Niente da cambiare');
    vals.push(key);
    const { rowCount } = await db.query(`UPDATE hr_people SET ${sets.join(', ')} WHERE key = $${vals.length}`, vals);
    if (!rowCount) throw new HttpError(404, 'Persona non trovata');
    await log(req, 'modifica', 'persona', { person: key, after: req.body });
    res.json({ ok: true });
  });

  // Un ruolo a più persone insieme (tavola A): sull'incarico se lo ricoprono, altrimenti sulla persona.
  app.post(`${BASE}/persone/ruolo`, async (req, res) => {
    hrOnly(req);
    const keys = Array.isArray(req.body.keys) ? req.body.keys.map(String).slice(0, 500) : [];
    const roleId = v.int(req.body.role_id, 'ruolo', { min: 1 });
    if (!keys.length || !roleId) throw new HttpError(400, 'Scegli le persone e il ruolo');
    const people = (await loadPeople(db)).filter(p => keys.includes(p.key));
    await db.tx(async q => {
      for (const p of people) {
        if (p.incarico) {
          await q.query(`INSERT INTO hr_incarico_roles (incarico_id, role_id, confirmed_by, confirmed_at) VALUES ($1, $2, $3, now())
                         ON CONFLICT (incarico_id) DO UPDATE SET role_id = EXCLUDED.role_id, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()`, [p.incarico.id, roleId, req.user.id]);
        } else await q.query('UPDATE hr_people SET role_id = $1 WHERE key = $2', [roleId, p.key]);
      }
    });
    await log(req, 'modifica', 'ruolo assegnato a più persone', { after: { persone: people.length, role_id: roleId } });
    await require('./hr-org').syncStrategyProfiles(db);
    res.json({ ok: true, n: people.length, sugli_incarichi: people.filter(p => p.incarico).length });
  });

  // Piano di rientro di chi è sotto il minimo (tavola G): anno, tutto o metà.
  app.put(`${BASE}/rientro/:key`, async (req, res) => {
    hrOnly(req);
    const key = String(req.params.key);
    if (req.body.anno === null) { await db.query('DELETE FROM hr_rientro WHERE person_key = $1', [key]); return res.json({ ok: true }); }
    const anno = v.int(req.body.anno, 'anno', { min: 2026, max: 2035 });
    const quota = v.oneOf(req.body.quota || 'tutto', 'quota', ['tutto', 'meta']);
    await db.query(`INSERT INTO hr_rientro (person_key, anno, quota, updated_by) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (person_key) DO UPDATE SET anno = EXCLUDED.anno, quota = EXCLUDED.quota, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, anno, quota, req.user.id]);
    await log(req, 'modifica', 'piano di rientro', { person: key, after: { anno, quota } });
    res.json({ ok: true });
  });

  // Alma HR in Impostazioni › Privacy (tavola I): chi ha il ruolo «Team HR». Amministratori e team HR.
  app.get(`${BASE}/privacy`, async (req, res) => {
    if (!isHr(req) && !gov.isAdmin(req)) throw new HttpError(403, 'Riservato');
    const { rows } = await db.query(`SELECT a.email, a.assigned_at, u.name FROM role_assignments a LEFT JOIN users u ON lower(u.email) = a.email WHERE a.role_key = 'hr' ORDER BY a.email`);
    res.json({ team: rows });
  });

  // Incarichi con il loro ruolo e la proposta.
  app.get(`${BASE}/incarichi`, async (req, res) => {
    hrOnly(req);
    const [{ rows }, roles] = await Promise.all([db.query(
      `SELECT i.id, i.nome, a.nome AS area, lower(i.ricoperto_da) AS email, r.role_id, r.proposed_id, r.proposed_why,
              COALESCE(NULLIF(trim(coalesce(hp.nome, '') || ' ' || coalesce(hp.cognome, '')), ''), op.name) AS persona, hp.qualifica
       FROM org_incarichi i LEFT JOIN org_aree a ON a.id = i.area_id LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id
       LEFT JOIN hr_people hp ON hp.email = lower(i.ricoperto_da) LEFT JOIN org_people op ON lower(op.email) = lower(i.ricoperto_da)
       WHERE i.attivo ORDER BY a.nome NULLS LAST, i.nome`), hrRoles(db)]);
    const titles = new Map(roles.map(r => [r.id, H.roleTitle(r)]));
    // somiglianza: un incarico con lo stesso nome già confermato
    const sameName = new Map(rows.filter(r => r.role_id).map(r => [H.norm(r.nome), r.role_id]));
    const out = rows.map(r => {
      let proposed = r.proposed_id; let why = r.proposed_why;
      if (!r.role_id && !proposed && sameName.has(H.norm(r.nome))) { proposed = sameName.get(H.norm(r.nome)); why = 'stesso nome di un incarico già confermato'; }
      return { ...r, role: r.role_id ? titles.get(r.role_id) : null, proposed_id: r.role_id ? null : proposed, proposed: !r.role_id && proposed ? titles.get(proposed) : null, proposed_why: r.role_id ? null : why };
    });
    res.json({ incarichi: out, roles: roles.map(r => ({ id: r.id, title: H.roleTitle(r), grade: r.grade, family: r.hr_family })), done: out.filter(r => r.role_id).length, total: out.length });
  });
  app.post(`${BASE}/incarichi/conferma`, async (req, res) => {
    hrOnly(req);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 500) throw new HttpError(400, 'Nessun incarico da confermare');
    await db.tx(async q => {
      for (const it of items) {
        const inc = v.int(it.incarico_id, 'incarico', { min: 1 });
        const role = v.int(it.role_id, 'ruolo', { min: 1, nullable: true });
        await q.query(`INSERT INTO hr_incarico_roles (incarico_id, role_id, confirmed_by, confirmed_at) VALUES ($1, $2, $3, now())
                       ON CONFLICT (incarico_id) DO UPDATE SET role_id = EXCLUDED.role_id, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()`, [inc, role ?? null, req.user.id]);
      }
    });
    await log(req, 'modifica', 'ruoli sugli incarichi', { after: items });
    await require('./hr-org').syncStrategyProfiles(db);
    res.json({ ok: true, n: items.length });
  });

  // Mansionario: modifica (nuova versione), nuovo ruolo, grade del ruolo.
  const roleBody = b => ({
    hr_name: v.text(b.hr_name, 'nome', { max: 120 }), hr_level: v.text(b.hr_level, 'livello', { max: 40 }),
    hr_family: v.oneOf(b.hr_family, 'famiglia', H.FAMILIES.map(f => f.key)), description: v.text(b.description, 'scopo', { max: 4000 }),
    next_criteria: v.text(b.next_criteria, 'criteri', { max: 2000 }),
    responsibilities: b.responsibilities === undefined ? undefined : JSON.stringify((b.responsibilities || []).map(String).slice(0, 20)),
    hard_skills: b.hard_skills === undefined ? undefined : JSON.stringify((b.hard_skills || []).map(String).slice(0, 30)),
    requirements: b.requirements === undefined ? undefined : JSON.stringify((b.requirements || []).map(String).slice(0, 20)),
    autonomy: b.autonomy === undefined ? undefined : JSON.stringify(Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5'].map(c => [c, ['auto', 'sup', 'support', 'none'].includes(b.autonomy?.[c]) ? b.autonomy[c] : 'none']))),
  });
  app.post(`${BASE}/mansionario`, async (req, res) => {
    hrOnly(req);
    const f = roleBody(req.body);
    if (!f.hr_name || !f.hr_family) throw new HttpError(400, 'Servono nome e famiglia');
    const grade = v.int(req.body.grade, 'grade', { min: 1, max: 8 });
    const { rows: [r] } = await db.query(
      `INSERT INTO pm_roles (title, area, description, status, hr_family, hr_name, hr_level, grade, next_criteria, hr_order, confirmed_at, confirmed_by, version_at)
       VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, 1000, now(), $9, now()) RETURNING id`,
      [H.roleTitle(f), H.FAMILIES.find(x => x.key === f.hr_family).label, f.description || '', f.hr_family, f.hr_name, f.hr_level || '', grade || null, f.next_criteria || '', req.user.id]);
    await log(req, 'modifica', 'nuovo ruolo', { after: { id: r.id, ...f } });
    res.json({ id: r.id });
  });
  app.patch(`${BASE}/mansionario/:id`, async (req, res) => {
    hrOnly(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [before] } = await db.query(`SELECT ${ROLE_COLS} FROM pm_roles WHERE id = $1 AND hr_family IS NOT NULL`, [id]);
    if (!before) throw new HttpError(404, 'Ruolo non trovato');
    const f = Object.fromEntries(Object.entries(roleBody(req.body)).filter(([, x]) => x !== undefined));
    if (!Object.keys(f).length) throw new HttpError(400, 'Niente da cambiare');
    const merged = { ...before, ...f };
    f.title = H.roleTitle(merged);
    const keys = Object.keys(f);
    await db.query(`UPDATE pm_roles SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, version = version + 1, version_at = now(), confirmed_by = $${keys.length + 1}, confirmed_at = now()
                    WHERE id = $${keys.length + 2}`, [...keys.map(k => f[k]), req.user.id, id]);
    await log(req, 'modifica', 'scheda ruolo', { before: { id, version: before.version }, after: { id, version: before.version + 1, campi: keys } });
    res.json({ ok: true, version: before.version + 1 });
  });
  app.patch(`${BASE}/mansionario/:id/grade`, async (req, res) => {
    hrOnly(req);
    const id = v.int(req.params.id, 'id', { min: 1 });
    const grade = v.int(req.body.grade, 'grade', { min: 1, max: 8 });
    const roles = await hrRoles(db);
    const before = roles.find(r => r.id === id);
    if (!before) throw new HttpError(404, 'Ruolo non trovato');
    const g = await currentGrid(db);
    const check = H.checkBands(g.bands, g.rules, roles.map(r => (r.id === id ? { ...r, grade } : r)));
    if (check.errors.length) throw new HttpError(400, check.errors[0]);
    await db.query('UPDATE pm_roles SET grade = $1 WHERE id = $2', [grade, id]);
    await log(req, 'modifica', 'grade del ruolo', { before: { id, grade: before.grade }, after: { id, grade } });
    res.json({ ok: true });
  });

  // Mappatura: posizioni (dati per il grafico), anomalie, equità.
  app.get(`${BASE}/mappatura`, async (req, res) => {
    hrOnly(req);
    const [people, roles, g] = await Promise.all([loadPeople(db, { withPay: true }), hrRoles(db), currentGrid(db)]);
    const byId = new Map(roles.map(r => [r.id, r]));
    const rows = people.map(p => ({ ...p, grade: byId.get(p.role_id)?.grade || null, role: byId.get(p.role_id) ? H.roleTitle(byId.get(p.role_id)) : null }));
    const st = H.stats(rows, g.bands, g.rules);
    const list = rows.filter(p => p.grade && p.ral && !p.esclusione).map(p => ({ key: p.key, nome: `${p.nome} ${p.cognome}`, role: p.role, grade: p.grade, ral: p.ral,
      part_time_pct: p.part_time_pct, band: H.bandOf(g.bands, p.grade), ...H.position(p.ral, p.part_time_pct, H.bandOf(g.bands, p.grade), g.rules) }));
    const { rows: plan } = await db.query('SELECT person_key, anno, quota FROM hr_rientro');
    const planBy = new Map(plan.map(x => [x.person_key, x]));
    const perAnno = {};
    for (const p of list) {
      const pl = planBy.get(p.key);
      p.rientro = pl ? { anno: pl.anno, quota: pl.quota } : null;
      if (!pl || !p.toMin) continue;
      if (pl.quota === 'meta') {
        perAnno[pl.anno] = (perAnno[pl.anno] || 0) + Math.round(p.toMin / 2);
        perAnno[pl.anno + 1] = (perAnno[pl.anno + 1] || 0) + p.toMin - Math.round(p.toMin / 2);
      } else perAnno[pl.anno] = (perAnno[pl.anno] || 0) + p.toMin;
    }
    await log(req, 'accesso', 'mappatura');
    res.json({ stats: st, people: list, rientro_per_anno: perAnno, rientro_senza_piano: list.filter(p => p.toMin && !p.rientro).length, bands: g.bands, rules: g.rules,
      senza_ruolo: rows.filter(p => !p.grade && !p.esclusione).length, esclusi: rows.filter(p => p.esclusione).length, senza_ral: rows.filter(p => p.grade && !p.ral && !p.esclusione).length });
  });

  // Pannello di controllo: griglia in vigore, bozze, ruoli → grade, versioni.
  app.get(`${BASE}/pannello`, async (req, res) => {
    hrOnly(req);
    const [g, roles, { rows: versions }] = await Promise.all([currentGrid(db), hrRoles(db),
      db.query(`SELECT g.id, g.label, g.bands, g.rules, g.params, g.valid_from::text AS valid_from, g.applied_at, g.created_at, u.name AS applied_by
                FROM hr_grids g LEFT JOIN users u ON u.id = g.applied_by ORDER BY g.created_at DESC`)]);
    const counts = await peopleByRole();
    res.json({ current: g, versions, defaults: { rules: H.DEFAULT_RULES, params: H.DEFAULT_PARAMS },
      roles: roles.map(r => ({ id: r.id, title: H.roleTitle(r), family: r.hr_family, grade: r.grade, people: counts.get(r.id) || 0 })),
      check: H.checkBands(g.bands, g.rules, roles) });
  });

  const gridBody = b => {
    const bands = (Array.isArray(b.bands) ? b.bands : []).map(x => ({ grade: Number(x.grade), min: Number(x.min), mid: Number(x.mid), max: Number(x.max) }));
    const rules = b.rules && typeof b.rules === 'object' ? { ...H.DEFAULT_RULES, ...b.rules } : undefined;
    const params = b.params && typeof b.params === 'object' ? { g1: Number(b.params.g1), lo: Number(b.params.lo), hi: Number(b.params.hi), w: Number(b.params.w) } : {};
    return { bands, rules, params };
  };
  // Impatto di una griglia (o di regole) rispetto a quella in vigore, sulle persone vere.
  app.post(`${BASE}/pannello/impatto`, async (req, res) => {
    hrOnly(req);
    const [people, roles, g] = await Promise.all([loadPeople(db, { withPay: true }), hrRoles(db), currentGrid(db)]);
    const body = gridBody(req.body);
    const rules = body.rules || g.rules;
    const bands = body.bands.length ? body.bands : g.bands;
    const byId = new Map(roles.map(r => [r.id, r]));
    const rows = people.map(p => ({ ...p, grade: byId.get(p.role_id)?.grade || null }));
    const before = H.stats(rows, g.bands, g.rules);
    const after = H.stats(rows, bands, rules);
    const moved = rows.filter(p => p.grade && p.ral && !p.esclusione && H.position(p.ral, p.part_time_pct, H.bandOf(g.bands, p.grade), g.rules)?.zone !== H.position(p.ral, p.part_time_pct, H.bandOf(bands, p.grade), rules)?.zone).length;
    const dots = rows.filter(p => p.grade && p.ral && !p.esclusione).map(p => ({ grade: p.grade, k: Math.round(H.fte(p.ral, p.part_time_pct) / 100) / 10 }));
    res.json({ before, after, moved, check: H.checkBands(bands, rules, roles), dots });
  });
  app.post(`${BASE}/pannello/bozza`, async (req, res) => {
    hrOnly(req);
    const { bands, rules, params } = gridBody(req.body);
    const label = v.text(req.body.label, 'nome', { max: 80 }) || `Bozza ${new Date().getFullYear() + 1}`;
    const roles = await hrRoles(db);
    const g = await currentGrid(db);
    const check = H.checkBands(bands, rules || g.rules, roles);
    if (check.errors.length) throw new HttpError(400, check.errors[0]);
    const id = v.int(req.body.id, 'bozza', { min: 1 });
    let out;
    if (id) {
      const { rows: [d] } = await db.query('SELECT applied_at FROM hr_grids WHERE id = $1', [id]);
      if (!d) throw new HttpError(404, 'Bozza non trovata');
      if (d.applied_at) throw new HttpError(400, 'Una griglia applicata non si modifica: salva una nuova bozza');
      await db.query('UPDATE hr_grids SET label = $1, bands = $2, rules = $3, params = $4, updated_at = now() WHERE id = $5', [label, JSON.stringify(bands), JSON.stringify(rules || g.rules), JSON.stringify(params), id]);
      out = id;
    } else {
      const { rows: [r] } = await db.query('INSERT INTO hr_grids (label, bands, rules, params, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [label, JSON.stringify(bands), JSON.stringify(rules || g.rules), JSON.stringify(params), req.user.id]);
      out = r.id;
    }
    await log(req, 'modifica', 'bozza della griglia', { before: { bands: g.bands }, after: { id: out, label, bands } });
    res.json({ id: out, warnings: check.warnings });
  });
  app.post(`${BASE}/pannello/applica`, async (req, res) => {
    hrOnly(req);
    const id = v.int(req.body.id, 'bozza', { min: 1 });
    const from = req.body.from === 'now' || !req.body.from ? todayIso() : v.date(req.body.from, 'dal');
    const { rows: [d] } = await db.query('SELECT id, label, bands, rules, applied_at FROM hr_grids WHERE id = $1', [id]);
    if (!d) throw new HttpError(404, 'Bozza non trovata');
    if (d.applied_at) throw new HttpError(400, 'Questa griglia è già stata applicata');
    const check = H.checkBands(d.bands, { ...H.DEFAULT_RULES, ...d.rules }, await hrRoles(db));
    if (check.errors.length) throw new HttpError(400, check.errors[0]);
    const before = await currentGrid(db);
    await db.query('UPDATE hr_grids SET valid_from = $1, applied_at = now(), applied_by = $2 WHERE id = $3', [from, req.user.id, id]);
    await log(req, 'modifica', 'griglia applicata', { before: { id: before.id, label: before.label, bands: before.bands }, after: { id, label: d.label, dal: from, bands: d.bands } });
    res.json({ ok: true, valid_from: from });
  });

  app.get(`${BASE}/registro`, async (req, res) => {
    hrOnly(req);
    const { rows } = await db.query(
      `SELECT l.id, l.at, l.kind, l.action, l.person_key, l.before, l.after, u.name AS who,
              NULLIF(trim(coalesce(p.nome, '') || ' ' || coalesce(p.cognome, '')), '') AS persona
       FROM hr_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN hr_people p ON p.key = l.person_key ORDER BY l.at DESC LIMIT 300`);
    res.json({ log: rows });
  });

  // ── import ───────────────────────────────────────────────────────────────────────────────────────────────
  const raw = express.raw({ type: () => true, limit: '10mb' });
  const sheetsOf = req => { try { return readXlsx(req.body); } catch { throw new HttpError(400, 'Il file non è un Excel (.xlsx) valido'); } };

  app.post(`${BASE}/import/persone`, raw, async (req, res) => {
    hrOnly(req);
    const parsed = H.parseBossExport(sheetsOf(req));
    if (!parsed.people.length) throw new HttpError(400, parsed.problems[0]?.problema || 'Nessuna persona nel file');
    const { rows: existing } = await db.query('SELECT key FROM hr_people WHERE attivo');
    const known = new Set(existing.map(r => r.key));
    const preview = {
      sheet: parsed.sheet, columns: parsed.columns, problems: parsed.problems, total: parsed.people.length,
      nuove: parsed.people.filter(p => !known.has(p.key)).length, aggiornate: parsed.people.filter(p => known.has(p.key)).length,
      non_piu_presenti: existing.filter(r => !parsed.people.some(p => p.key === r.key)).length,
      con_ral: parsed.people.filter(p => p.ral).length, escluse: parsed.people.filter(p => p.esclusione).length,
      part_time: parsed.people.filter(p => p.part_time_pct < 100).length,
    };
    if (req.query.applica !== '1') return res.json({ preview });
    const org = require('./hr-org');
    const before = await org.snapshot(db);
    await db.tx(async q => { await savePeople(q, parsed.people, 'import'); await deactivateMissing(q, parsed.people.map(p => p.key)); });
    await org.recordEvents(db, before, await org.snapshot(db));
    await org.syncStrategyProfiles(db);
    await log(req, 'modifica', 'import persone da export BOSS', { after: preview });
    res.json({ preview, applied: true });
  });

  app.post(`${BASE}/import/v11`, raw, async (req, res) => {
    hrOnly(req);
    const rows = H.parseV11(sheetsOf(req));
    if (!rows.length) throw new HttpError(400, 'Nessun foglio della mappatura (colonne «Persona» e «Inquadramento target»)');
    const [people, roles, { rows: incs }] = await Promise.all([loadPeople(db), hrRoles(db),
      db.query('SELECT i.id, lower(i.ricoperto_da) AS email, r.role_id FROM org_incarichi i LEFT JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo')]);
    const out = rows.map(r => {
      const person = H.matchPerson(r, people);
      const role = r.proposta ? H.findRole(roles, r.proposta.role) : null;
      const inc = person?.email ? incs.find(i => i.email === person.email) : null;
      return { persona: r.persona, foglio: r.sheet, inquadramento_v11: r.target, ruolo: role ? H.roleTitle(role) : null, perche: r.proposta?.why || null,
        trovata: Boolean(person), incarico: Boolean(inc), gia_confermato: Boolean(inc?.role_id), _inc: inc?.id, _role: role?.id, _key: person?.key };
    });
    const summary = { righe: out.length, trovate: out.filter(r => r.trovata).length, con_incarico: out.filter(r => r.incarico).length, senza_ruolo: out.filter(r => !r.ruolo).length };
    if (req.query.applica !== '1') return res.json({ summary, rows: out.map(({ _inc, _role, _key, ...r }) => r) });
    await db.tx(async q => {
      for (const r of out) {
        if (!r._role) continue;
        if (r._inc && !r.gia_confermato) {
          await q.query(`INSERT INTO hr_incarico_roles (incarico_id, proposed_id, proposed_why) VALUES ($1, $2, $3)
                         ON CONFLICT (incarico_id) DO UPDATE SET proposed_id = EXCLUDED.proposed_id, proposed_why = EXCLUDED.proposed_why`, [r._inc, r._role, r.perche]);
        } else if (!r._inc && r._key) {
          await q.query('UPDATE hr_people SET role_id = COALESCE(role_id, $1) WHERE key = $2', [r._role, r._key]);
        }
      }
    });
    await log(req, 'modifica', 'import mappatura v11', { after: summary });
    res.json({ summary, applied: true });
  });

  app.post(`${BASE}/boss/sync`, async (req, res) => {
    hrOnly(req);
    const r = await syncPeopleFromBoss(db);
    if (r.ok) await log(req, 'modifica', 'sincronizzazione da BOSS', { after: { persone: r.n } });
    res.json(r);
  });
}

// Da BOSS via API (quando BOSS espone l'elenco; ticket nel team BOSS, Modulo People). Formato atteso:
// { personale: [{ id, nome, cognome, email, societa, businessUnit, qualifica, codiceCCNL, livelloCCNL, contratto,
//   partTimePct, dataAssunzione, scadenzaContratto, sesso, attivo, bossUrl,
//   retribuzioni: [{ ralAnnua, adPersonamAnnuo, validoDal, validoAl }] }],
//   Fase 2, facoltativi: incarichi: [{ id, nome, businessUnitId, livelloOrganigrammaId, riportaAIncaricoId, ricopertoDaPersonaleId, attivo, bossUrl }],
//   businessUnits: [{ id, nome, tipo, ordine, attiva }], livelli: [{ id, nome, ordine, approva, attivo }] }
async function syncPeopleFromBoss(db, { url = process.env.BOSS_PERSONALE_URL, token = process.env.BOSS_PERSONALE_TOKEN, fetchImpl = fetch } = {}) {
  if (!url || !token) return { ok: false, reason: 'BOSS non è ancora collegato: si usa l\'import dell\'export mensile' };
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new HttpError(502, `BOSS ha risposto ${r.status}`);
  const data = await r.json();
  const people = (data.personale || []).filter(p => p.attivo !== false).map(p => {
    const contratto = H.contractOf(p.contratto);
    const x = { boss_id: String(p.id), nome: p.nome || '', cognome: p.cognome || '', email: p.email ? String(p.email).toLowerCase() : null, societa: p.societa || null,
      bu: p.businessUnit || null, qualifica: p.qualifica || null, ccnl: p.codiceCCNL || null, livello: p.livelloCCNL || null, contratto,
      part_time_pct: Number(p.partTimePct) || 100, data_assunzione: p.dataAssunzione || null, scadenza: p.scadenzaContratto || null,
      sesso: ['F', 'M'].includes(p.sesso) ? p.sesso : null, esclusione: H.exclusionOf(contratto, p.qualifica),
      pay: (p.retribuzioni || []).filter(t => t.ralAnnua && t.validoDal).map(t => ({ ral: t.ralAnnua, ad_personam: t.adPersonamAnnuo || 0, valid_from: t.validoDal, valid_to: t.validoAl || null })),
      boss_url: p.bossUrl || null };
    x.key = H.personKey(x);
    return x;
  });
  const org = require('./hr-org');
  const before = await org.snapshot(db);
  await db.tx(async q => {
    await savePeople(q, people, 'boss');
    await deactivateMissing(q, people.map(p => p.key));
    if (Array.isArray(data.incarichi)) await org.saveOrgFromBoss(q, data, people);
    for (const p of people) if (p.boss_url) await q.query('UPDATE hr_people SET boss_url = $1 WHERE key = $2', [p.boss_url, p.key]);
  });
  await org.recordEvents(db, before, await org.snapshot(db));
  await org.syncStrategyProfiles(db);
  return { ok: true, n: people.length, incarichi: Array.isArray(data.incarichi) ? data.incarichi.length : null };
}

module.exports = { registerHr, syncPeopleFromBoss, ensureSeed, currentGrid, hrRoles, loadPeople };
