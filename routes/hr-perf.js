// Alma HR, Fase 5: performance annuale e revisione retributiva (ALM2-59; canvas «Alma HR», pagina «Fase 5 · performance»).
//   /api/hr/ciclo[...]               calendario del ciclo e avanzamento per area (AO)
//   /api/hr/valutazione[...]         scheda annuale 1–10: obiettivi di Strategy + competenze del mansionario (AH)
//   /api/hr/semestre/:userId         check di luglio, al posto delle revisioni trimestrali (AI)
//   /api/hr/calibrazione             voti per area, distribuzione, scarto dei valutatori (AJ)
//   /api/hr/matrice                  voto × posizione in fascia → merito del pannello (AK)
//   /api/hr/revisione[...]           revisione retributiva con budget e approvazioni (AL), lettere e BOSS (AM)
//   /api/hr/esito/mio                l'esito della persona (AN)
// Regole: RAL solo al team HR; il responsabile vede le sue persone in percentuale; le nuove RAL si registrano su BOSS.
const { HttpError, v } = require('../lib/http');
const H = require('../lib/hr');
const P = require('../lib/hr-perf');

const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const hrMod = () => require('./hr');
// anno del ciclo in corso: fino al 31 marzo si chiude quello dell'anno prima
const currentYear = (today = todayIso()) => (today.slice(5) < '04-01' ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4)));

function registerHrPerf(app, { db, gov, notifier, auth }) {
  const roleKey = req => gov.roleOf(req.user.email).key;
  const isHr = req => roleKey(req) === 'hr';
  const hrOnly = req => { if (!isHr(req)) throw new HttpError(403, 'Riservato al team HR'); };
  const yearOf = req => v.int(req.query.year ?? req.body?.year, 'anno', { min: 2020, max: 2100 }) || currentYear();
  const usersByRole = async key => (await db.query('SELECT id, lower(email) AS email FROM users WHERE email IS NOT NULL AND suspended_at IS NULL')).rows.filter(u => gov.roleOf(u.email).key === key).map(u => u.id);
  const notify = (ids, actor, body, link) => (ids.length ? notifier?.notify({ userIds: [...new Set(ids)], actorId: actor, kind: 'hr', body, link }).catch(() => {}) : null);
  const hrLog = (req, action, person) => db.query("INSERT INTO hr_log (user_id, kind, action, person_key) VALUES ($1, 'modifica', $2, $3)", [req.user.id, action, person || null]);

  async function cycleOf(year) {
    const { rows: [c] } = await db.query('SELECT fasi, decorrenza::text AS decorrenza FROM hr_cycles WHERE year = $1', [year]);
    const d = P.defaultCycle(year);
    return { year, fasi: { ...d.fasi, ...(c?.fasi || {}) }, decorrenza: c?.decorrenza || d.decorrenza };
  }

  // Le persone del ciclo: da BOSS (hr_people) con un account in Alma; chi è ancora in prova entra dopo la conferma.
  async function universe() {
    const [people, roles, grid, { rows: users }, { rows: onb }] = await Promise.all([
      hrMod().loadPeople(db, { withPay: true }), hrMod().hrRoles(db), hrMod().currentGrid(db),
      db.query('SELECT u.id, u.name, lower(u.email) AS email, p.manager_id, m.name AS manager FROM users u LEFT JOIN pm_profiles p ON p.user_id = u.id LEFT JOIN users m ON m.id = p.manager_id WHERE u.email IS NOT NULL'),
      db.query("SELECT person_key FROM hr_onboardings WHERE stato = 'aperto'"),
    ]);
    const byEmail = new Map(users.map(u => [u.email, u]));
    const inProva = new Set(onb.map(x => x.person_key));
    const roleBy = new Map(roles.map(r => [r.id, r]));
    const list = people.filter(p => !p.esclusione && p.email && byEmail.has(p.email) && !inProva.has(p.key)).map(p => {
      const u = byEmail.get(p.email);
      const role = roleBy.get(p.role_id) || null;
      return { ...p, user_id: u.id, manager_id: u.manager_id, manager: u.manager, role, grade: role?.grade || null, band: role ? H.bandOf(grid.bands, role.grade) : null };
    });
    return { list, roles, grid, roleBy };
  }
  async function rightsOn(req, userId) {
    const self = req.user.id === userId;
    const { rows: [p] } = await db.query('SELECT manager_id FROM pm_profiles WHERE user_id = $1', [userId]);
    const manager = p?.manager_id === req.user.id;
    const hr = isHr(req) && !self;
    return { self, manager, hr, see: self || manager || hr };
  }

  // ── ciclo e avanzamento (AO) ──
  app.get('/api/hr/ciclo', async (req, res) => {
    const year = yearOf(req);
    const c = await cycleOf(year);
    res.json({ ...c, aperta: P.faseAperta(c, todayIso()), fasi_elenco: P.FASI, is_hr: isHr(req), anno_corrente: currentYear() });
  });
  app.put('/api/hr/ciclo/:year', async (req, res) => {
    hrOnly(req);
    const year = v.int(req.params.year, 'anno', { min: 2020, max: 2100 });
    const fasi = {};
    for (const [k] of P.FASI) {
      const f = req.body.fasi?.[k];
      if (!f) continue;
      const apre = v.date(f.apre, 'apertura'); const chiude = v.date(f.chiude, 'chiusura');
      if (apre && chiude && apre > chiude) throw new HttpError(400, `«${k}»: la chiusura viene prima dell'apertura`);
      fasi[k] = { apre, chiude };
    }
    const decorrenza = v.date(req.body.decorrenza, 'decorrenza') || null;
    await db.query(`INSERT INTO hr_cycles (year, fasi, decorrenza, updated_by) VALUES ($1, $2, $3, $4)
      ON CONFLICT (year) DO UPDATE SET fasi = hr_cycles.fasi || $2, decorrenza = COALESCE($3, hr_cycles.decorrenza), updated_by = $4, updated_at = now()`, [year, JSON.stringify(fasi), decorrenza, req.user.id]);
    await hrLog(req, `calendario del ciclo ${year}`);
    res.json(await cycleOf(year));
  });
  async function progress(year, ambito) {
    const { list } = await universe();
    const scoped = list.filter(p => hrMod().inScope(p.area, ambito));
    const ids = scoped.map(p => p.user_id);
    if (!ids.length) return { aree: [], totali: null };
    const [{ rows: obj }, { rows: mid }, { rows: rev }, { rows: pay }] = await Promise.all([
      db.query('SELECT user_id, count(*) FILTER (WHERE approved)::int AS ok FROM pm_objectives WHERE year = $1 AND user_id = ANY($2) GROUP BY 1', [year, ids]),
      db.query("SELECT user_id FROM hr_midyear WHERE year = $1 AND status = 'closed' AND user_id = ANY($2)", [year, ids]),
      db.query('SELECT user_id, status, calib_at FROM pm_reviews WHERE year = $1 AND user_id = ANY($2)', [year, ids]),
      db.query("SELECT r.user_id, (r.proposed_by IS NOT NULL OR COALESCE(a.stato, 'aperta') <> 'aperta') AS proposed_by FROM hr_pay_reviews r LEFT JOIN hr_pay_areas a ON a.year = r.year AND a.area_id = r.area_id WHERE r.year = $1 AND r.user_id = ANY($2)", [year, ids]),
    ]);
    const okObj = new Set(obj.filter(x => x.ok > 0).map(x => x.user_id));
    const okMid = new Set(mid.map(x => x.user_id));
    const revBy = new Map(rev.map(x => [x.user_id, x]));
    const payBy = new Map(pay.map(x => [x.user_id, x]));
    const groups = new Map();
    for (const p of scoped) {
      const k = p.area?.nome || p.bu || 'Senza area';
      const g = groups.get(k) || groups.set(k, { area: k, area_id: p.area?.id || null, persone: 0, obiettivi: 0, semestre: 0, auto: 0, valutazione: 0, calibrazione: 0, revisione: 0 }).get(k);
      const r = revBy.get(p.user_id);
      g.persone++;
      if (okObj.has(p.user_id)) g.obiettivi++;
      if (okMid.has(p.user_id)) g.semestre++;
      if (r && r.status !== 'self') g.auto++;
      if (r?.status === 'closed') g.valutazione++;
      if (r?.calib_at) g.calibrazione++;
      if (payBy.get(p.user_id)?.proposed_by) g.revisione++;
    }
    const aree = [...groups.values()].sort((a, b) => a.area.localeCompare(b.area));
    const tot = k => aree.reduce((s, a) => s + a[k], 0);
    return { aree, totali: { persone: tot('persone'), obiettivi: tot('obiettivi'), semestre: tot('semestre'), auto: tot('auto'), valutazione: tot('valutazione'), calibrazione: tot('calibrazione'), revisione: tot('revisione') } };
  }
  app.get('/api/hr/ciclo/avanzamento', async (req, res) => {
    const k = roleKey(req);
    if (!['hr', 'direzione'].includes(k)) throw new HttpError(403, 'Lo vedono il team HR e la Direzione');
    const year = yearOf(req);
    res.json({ ...(await progress(year, hrMod().ambitoOf(req))), ciclo: await cycleOf(year), is_hr: k === 'hr' });
  });
  app.post('/api/hr/ciclo/promemoria', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const fase = v.oneOf(req.body.fase, 'fase', ['obiettivi', 'semestre', 'valutazione']);
    const { list } = await universe();
    const ids = list.map(p => p.user_id);
    const { rows: rev } = await db.query('SELECT user_id, status FROM pm_reviews WHERE year = $1', [year]);
    const revBy = new Map(rev.map(x => [x.user_id, x.status]));
    let targets = [];
    if (fase === 'valutazione') {
      targets = [...list.filter(p => (revBy.get(p.user_id) || 'self') === 'self').map(p => ({ to: p.user_id, txt: 'manca la tua autovalutazione' })),
        ...list.filter(p => revBy.get(p.user_id) === 'manager' && p.manager_id).map(p => ({ to: p.manager_id, txt: `manca la tua valutazione di ${p.nome}` }))];
    } else if (fase === 'semestre') {
      const { rows: mid } = await db.query("SELECT user_id FROM hr_midyear WHERE year = $1 AND status = 'closed'", [year]);
      const done = new Set(mid.map(x => x.user_id));
      targets = list.filter(p => !done.has(p.user_id) && p.manager_id).map(p => ({ to: p.manager_id, txt: `manca il check di luglio di ${p.nome}` }));
    } else {
      const { rows: ob } = await db.query('SELECT DISTINCT user_id FROM pm_objectives WHERE year = $1 AND approved', [year]);
      const done = new Set(ob.map(x => x.user_id));
      targets = list.filter(p => !done.has(p.user_id)).map(p => ({ to: p.user_id, txt: 'i tuoi obiettivi non sono ancora approvati' }));
    }
    for (const t of targets) await notify([t.to], req.user.id, `promemoria del ciclo ${year}: ${t.txt}.`, fase === 'obiettivi' ? '/strategy/obiettivi' : '/hr/valutazioni');
    res.json({ inviati: targets.length, su: ids.length });
  });

  // ── scheda annuale (AH) ──
  async function evaluation(userId, year) {
    const { rows: [u] } = await db.query('SELECT u.id, u.name, lower(u.email) AS email, p.role_id, p.manager_id, m.name AS manager FROM users u LEFT JOIN pm_profiles p ON p.user_id = u.id LEFT JOIN users m ON m.id = p.manager_id WHERE u.id = $1', [userId]);
    if (!u) throw new HttpError(404, 'Persona non trovata');
    const grid = await hrMod().currentGrid(db);
    const { rows: [hp] } = await db.query('SELECT key, role_id FROM hr_people WHERE email = $1 AND attivo', [u.email]);
    const { rows: [inc] } = await db.query('SELECT r.role_id FROM org_incarichi i JOIN hr_incarico_roles r ON r.incarico_id = i.id WHERE i.attivo AND lower(i.ricoperto_da) = $1 AND r.role_id IS NOT NULL LIMIT 1', [u.email]);
    const roleId = inc?.role_id || hp?.role_id || u.role_id || null;
    const { rows: [role] } = roleId ? await db.query('SELECT * FROM pm_roles WHERE id = $1', [roleId]) : { rows: [] };
    const { rows: objectives } = await db.query('SELECT id, objective, kpi, target, weight, achievement, approved FROM pm_objectives WHERE user_id = $1 AND year = $2 ORDER BY position, id', [userId, year]);
    const { rows: [rev] } = await db.query('SELECT * FROM pm_reviews WHERE user_id = $1 AND year = $2', [userId, year]);
    const scale = rev?.scale || 10;
    const sc = (side, key) => P.toTen(rev?.[side]?.[key], scale);
    const comps = P.competencesFor(role);
    const objs = objectives.map(o => ({ ...o, proposto: P.objScoreFromAchievement(o.achievement), self: sc('self_scores', `obj:${o.id}`), manager: sc('manager_scores', `obj:${o.id}`) }));
    const compRows = comps.map(c => ({ nome: c, self: sc('self_scores', c), manager: sc('manager_scores', c) }));
    const grade = role?.grade || null;
    const calc = side => P.finalScore({ objectives: objs.map(o => ({ weight: o.weight, score: o[side] ?? (side === 'manager' ? null : null) })), comps: compRows.map(c => c[side]), grade, rules: grid.rules });
    return { u, role, grade, objs, compRows, rev, scale, status: rev?.status || 'self', self: calc('self'), manager: calc('manager'), pesi: P.weightsFor(grade, grid.rules), person_key: hp?.key || null };
  }
  app.get('/api/hr/valutazione/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!r.see) throw new HttpError(403, 'Non puoi vedere questa valutazione');
    const year = yearOf(req);
    const e = await evaluation(userId, year);
    const closed = e.status === 'closed';
    const showMgr = r.manager || r.hr || closed; // la persona vede i voti del responsabile a valutazione chiusa
    res.json({
      year, rights: r, persona: { id: e.u.id, nome: e.u.name, responsabile: e.u.manager }, ruolo: e.role ? { id: e.role.id, title: H.roleTitle(e.role), grade: e.grade, next_criteria: e.role.next_criteria || '' } : null,
      status: e.status, scala_originale: e.rev ? e.scale : 10, pesi: e.pesi,
      obiettivi: e.objs.map(o => ({ ...o, manager: showMgr ? o.manager : null })), competenze: e.compRows.map(c => ({ ...c, manager: showMgr ? c.manager : null })),
      voto: { self: e.self, manager: showMgr ? e.manager : null, finale: showMgr ? (e.rev?.calibrated ?? e.manager.final) : null, calibrato: e.rev?.calibrated ?? null },
      commento: showMgr ? e.rev?.comment || '' : '', crescita: e.rev?.crescita || false, scala: P.SCALA,
    });
  });
  app.patch('/api/hr/valutazione/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!r.see) throw new HttpError(403, 'Non puoi modificare questa valutazione');
    const year = yearOf(req);
    const e = await evaluation(userId, year);
    const status = e.status;
    const b = req.body || {};
    const clean = (obj, field) => {
      const out = {};
      for (const [k, val] of Object.entries(obj || {})) { if (String(k).length > 300) continue; if (val === null || val === '') continue; out[k] = v.int(val, field, { min: 1, max: 10 }); }
      return out;
    };
    // passaggio alla scala 1–10: i voti già dati su 1–5 si convertono ×2 (decisione D)
    const conv = o => Object.fromEntries(Object.entries(o || {}).map(([k, x]) => [k, P.toTen(x, e.scale)]));
    const next = { self_scores: conv(e.rev?.self_scores), manager_scores: conv(e.rev?.manager_scores), status, comment: e.rev?.comment || '', crescita: e.rev?.crescita || false };
    if (b.self !== undefined) {
      if (!r.self || status !== 'self') throw new HttpError(403, status === 'self' ? "L'autovalutazione la fa la persona" : "L'autovalutazione è già stata inviata");
      next.self_scores = { ...next.self_scores, ...clean(b.self, 'autovalutazione') };
    }
    if (b.manager !== undefined || b.commento !== undefined || b.crescita !== undefined) {
      if (!(r.manager || r.hr) || status === 'closed') throw new HttpError(403, 'La valutazione la fa il responsabile, prima della chiusura');
      if (b.manager !== undefined) next.manager_scores = { ...next.manager_scores, ...clean(b.manager, 'valutazione') };
      if (b.commento !== undefined) next.comment = v.text(String(b.commento), 'commento', { max: 4000 }) || '';
      if (b.crescita !== undefined) next.crescita = Boolean(b.crescita);
    }
    if (b.status !== undefined) {
      const to = v.oneOf(b.status, 'stato', ['self', 'manager', 'closed']);
      const ok = (to === 'manager' && r.self && status === 'self') || (to === 'closed' && (r.manager || r.hr) && status === 'manager') || (to === 'self' && r.hr) || (to === 'manager' && r.hr && status === 'closed');
      if (!ok) throw new HttpError(403, 'Passaggio di stato non permesso');
      next.status = to;
    }
    // voto finale dai voti del responsabile, con i pesi del pannello
    const grid = await hrMod().currentGrid(db);
    const fin = P.finalScore({ objectives: e.objs.map(o => ({ weight: o.weight, score: next.manager_scores[`obj:${o.id}`] ?? null })), comps: e.compRows.map(c => next.manager_scores[c.nome] ?? null), grade: e.grade, rules: grid.rules });
    await db.query(`INSERT INTO pm_reviews (user_id, year, status, self_scores, manager_scores, scale, comment, crescita, final, updated_at) VALUES ($1,$2,$3,$4,$5,10,$6,$7,$8, now())
      ON CONFLICT (user_id, year) DO UPDATE SET status = $3, self_scores = $4, manager_scores = $5, scale = 10, comment = $6, crescita = $7, final = $8, updated_at = now()`,
    [userId, year, next.status, JSON.stringify(next.self_scores), JSON.stringify(next.manager_scores), next.comment, next.crescita, fin.final]);
    if (next.status !== status) {
      if (next.status === 'manager' && e.u.manager_id) await notify([e.u.manager_id], req.user.id, `ha inviato l'autovalutazione ${year}: tocca a te.`, `/hr/valutazione/${userId}`);
      if (next.status === 'closed') await notify([userId], req.user.id, `ha chiuso la tua valutazione ${year}.`, `/hr/valutazione/${userId}`);
    }
    res.json({ ok: true, finale: fin });
  });
  // elenco: le mie persone (responsabile) o tutte (HR) con lo stato della valutazione e del check
  app.get('/api/hr/valutazioni', async (req, res) => {
    const year = yearOf(req);
    const hr = isHr(req);
    const { list } = await universe();
    const ambito = hrMod().ambitoOf(req);
    const mine = list.filter(p => (hr ? hrMod().inScope(p.area, ambito) : p.manager_id === req.user.id));
    const ids = mine.map(p => p.user_id);
    const [{ rows: rev }, { rows: mid }] = ids.length ? await Promise.all([
      db.query('SELECT user_id, status, final, calibrated, scale FROM pm_reviews WHERE year = $1 AND user_id = ANY($2)', [year, ids]),
      db.query('SELECT user_id, status FROM hr_midyear WHERE year = $1 AND user_id = ANY($2)', [year, ids]),
    ]) : [{ rows: [] }, { rows: [] }];
    const rb = new Map(rev.map(x => [x.user_id, x]));
    const mb = new Map(mid.map(x => [x.user_id, x]));
    const { rows: [meRev] } = await db.query('SELECT status FROM pm_reviews WHERE user_id = $1 AND year = $2', [req.user.id, year]);
    res.json({ year, ciclo: await cycleOf(year), is_hr: hr, mia: { user_id: req.user.id, status: meRev?.status || 'self' },
      persone: mine.map(p => { const r = rb.get(p.user_id); return { user_id: p.user_id, nome: `${p.nome} ${p.cognome}`, ruolo: p.role ? H.roleTitle(p.role) : '', area: p.area?.nome || '', responsabile: p.manager || '',
        status: r?.status || 'self', finale: r?.calibrated ?? (r?.final != null ? Number(r.final) : null), semestre: mb.get(p.user_id)?.status || null }; }) });
  });

  // ── check di luglio (AI) ──
  app.get('/api/hr/semestre/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!r.see) throw new HttpError(403, 'Non puoi vedere questo check');
    const year = yearOf(req);
    const e = await evaluation(userId, year);
    const { rows: [m] } = await db.query('SELECT * FROM hr_midyear WHERE user_id = $1 AND year = $2', [userId, year]);
    const vals = m?.values || {};
    const voto = P.finalScore({ objectives: e.objs.map(o => ({ weight: o.weight, score: vals[o.id]?.voto ?? null })), comps: [], grade: e.grade }).obj;
    const rischio = e.objs.filter(o => vals[o.id]?.previsione === 'rischio').length;
    res.json({ year, rights: r, persona: { id: e.u.id, nome: e.u.name, responsabile: e.u.manager }, obiettivi: e.objs.map(o => ({ id: o.id, objective: o.objective, kpi: o.kpi, target: o.target, weight: o.weight, ...vals[o.id] })),
      status: m?.status || 'draft', azioni: m?.azioni || '', serve: m?.serve || '', quando: m?.quando || null, join_url: m?.join_url || null, voto, segnali: voto != null && (voto < 5 || rischio >= 2) });
  });
  app.put('/api/hr/semestre/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!(r.manager || r.hr)) throw new HttpError(403, 'Il check lo fa il responsabile');
    const year = yearOf(req);
    const { rows: [cur] } = await db.query('SELECT status FROM hr_midyear WHERE user_id = $1 AND year = $2', [userId, year]);
    if (cur?.status === 'closed' && !r.hr) throw new HttpError(400, 'Il check è chiuso: lo riapre il team HR');
    const values = {};
    for (const [oid, x] of Object.entries(req.body.values || {})) {
      v.int(oid, 'obiettivo', { min: 1 });
      values[oid] = { valore: v.text(String(x?.valore ?? ''), 'valore', { max: 100 }) || '', previsione: ['linea', 'rischio', 'oltre'].includes(x?.previsione) ? x.previsione : 'linea',
        voto: x?.voto === '' || x?.voto == null ? null : v.int(x.voto, 'voto', { min: 1, max: 10 }) };
    }
    await db.query(`INSERT INTO hr_midyear (user_id, year, "values", azioni, serve, updated_at) VALUES ($1,$2,$3,$4,$5, now())
      ON CONFLICT (user_id, year) DO UPDATE SET "values" = $3, azioni = $4, serve = $5, updated_at = now()`,
    [userId, year, JSON.stringify(values), v.text(String(req.body.azioni ?? ''), 'azioni', { max: 4000 }) || '', v.text(String(req.body.serve ?? ''), 'cosa serve', { max: 2000 }) || '']);
    res.json({ ok: true });
  });
  app.post('/api/hr/semestre/:userId/chiudi', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!(r.manager || r.hr)) throw new HttpError(403, 'Il check lo chiude il responsabile');
    const year = yearOf(req);
    const reopen = req.body.riapri === true;
    if (reopen && !r.hr) throw new HttpError(403, 'Lo riapre il team HR');
    await db.query(`INSERT INTO hr_midyear (user_id, year, status, closed_by, closed_at) VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'closed' THEN now() END)
      ON CONFLICT (user_id, year) DO UPDATE SET status = $3, closed_by = $4, closed_at = CASE WHEN $3 = 'closed' THEN now() END`, [userId, year, reopen ? 'draft' : 'closed', req.user.id]);
    if (!reopen) {
      await notify([userId], req.user.id, `ha chiuso il check di luglio ${year} dei tuoi obiettivi.`, `/hr/semestre/${userId}`);
      const { rows: [m] } = await db.query('SELECT "values" FROM hr_midyear WHERE user_id = $1 AND year = $2', [userId, year]);
      const vals = Object.values(m?.values || {});
      const voti = vals.map(x => x.voto).filter(x => x != null);
      const avg = voti.length ? voti.reduce((a, b) => a + b, 0) / voti.length : null;
      if ((avg != null && avg < 5) || vals.filter(x => x.previsione === 'rischio').length >= 2) await notify(await usersByRole('hr'), req.user.id, `check di luglio ${year}: segnale da guardare (voto provvisorio basso o obiettivi a rischio).`, `/hr/semestre/${userId}`);
    }
    res.json({ ok: true });
  });
  app.post('/api/hr/semestre/:userId/fissa', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rightsOn(req, userId);
    if (!(r.manager || r.hr)) throw new HttpError(403, 'Il check lo fissa il responsabile');
    const year = yearOf(req);
    const quando = new Date(String(req.body.quando || ''));
    if (isNaN(quando)) throw new HttpError(400, 'Data non valida');
    const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    let outlookId = null, joinUrl = null, avviso = null;
    if (auth?.msConfigured) {
      try {
        const { graph, TIMEZONE } = require('../lib/graph');
        const token = await auth.graphToken(req.user.id);
        const local = d => d.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
        const ev = await graph(token, 'POST', '/me/events', { headers: { Prefer: `outlook.timezone="${TIMEZONE}"` }, body: {
          subject: `Check di luglio · ${u.name}`, start: { dateTime: local(quando), timeZone: TIMEZONE }, end: { dateTime: local(new Date(quando.getTime() + 45 * 60000)), timeZone: TIMEZONE },
          attendees: [{ type: 'required', emailAddress: { address: u.email } }], isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } });
        outlookId = ev.id; joinUrl = ev.onlineMeeting?.joinUrl || null;
      } catch (err) { avviso = `Invito Outlook non creato: ${err.message}`; }
    } else avviso = 'Microsoft non è collegato: invito Outlook non creato.';
    await db.query(`INSERT INTO hr_midyear (user_id, year, quando, outlook_id, join_url) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id, year) DO UPDATE SET quando = $3, outlook_id = $4, join_url = $5`, [userId, year, quando, outlookId, joinUrl]);
    res.json({ ok: true, avviso });
  });

  // ── calibrazione (AJ) ──
  async function calibRows(year, ambito) {
    const { list } = await universe();
    const scoped = list.filter(p => hrMod().inScope(p.area, ambito));
    const ids = scoped.map(p => p.user_id);
    const { rows: rev } = ids.length ? await db.query("SELECT user_id, final, calibrated, calib_reason, piano, calib_at, status FROM pm_reviews WHERE year = $1 AND user_id = ANY($2) AND status = 'closed'", [year, ids]) : { rows: [] };
    const rb = new Map(rev.map(x => [x.user_id, x]));
    return scoped.filter(p => rb.has(p.user_id)).map(p => {
      const r = rb.get(p.user_id);
      const proposto = r.final == null ? null : Number(r.final);
      const calibrato = r.calibrated == null ? null : Number(r.calibrated);
      return { user_id: p.user_id, person_key: p.key, nome: `${p.nome} ${p.cognome}`, ruolo: p.role ? H.roleTitle(p.role) : '', area: p.area?.nome || '', manager: p.manager || '', manager_id: p.manager_id,
        proposto, calibrato, voto: calibrato ?? proposto, motivo: r.calib_reason, piano: r.piano, chiusa: Boolean(r.calib_at) };
    });
  }
  app.get('/api/hr/calibrazione', async (req, res) => {
    const year = yearOf(req);
    const hr = isHr(req);
    const ambito = hr ? hrMod().ambitoOf(req) : '';
    const rows = await calibRows(year, ambito);
    const bias = P.managerBias(rows);
    if (!hr) {
      const mine = rows.filter(r => r.manager_id === req.user.id);
      if (!mine.length) throw new HttpError(403, 'La calibrazione la vede il team HR; i responsabili vedono le loro persone');
      return res.json({ year, is_hr: false, persone: mine, distribuzione: P.distribution(mine.map(r => r.voto)), media_azienda: bias.media,
        mia_media: bias.valutatori.find(x => x.nome === mine[0].manager)?.media ?? null });
    }
    const { rows: [tot] } = await db.query("SELECT count(*)::int AS n FROM pm_reviews WHERE year = $1 AND status = 'closed'", [year]);
    res.json({ year, is_hr: true, persone: rows, distribuzione: P.distribution(rows.map(r => r.voto)), valutatori: bias.valutatori, media_azienda: bias.media, chiuse: tot.n });
  });
  app.put('/api/hr/calibrazione/:userId', async (req, res) => {
    hrOnly(req);
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const year = yearOf(req);
    const { rows: [r] } = await db.query('SELECT final, calib_at FROM pm_reviews WHERE user_id = $1 AND year = $2 AND status = $3', [userId, year, 'closed']);
    if (!r) throw new HttpError(400, 'Si calibra solo una valutazione chiusa');
    const b = req.body || {};
    const cal = b.calibrato === '' || b.calibrato == null ? null : Number(b.calibrato);
    if (cal != null && !(cal >= 1 && cal <= 10)) throw new HttpError(400, 'Il voto va da 1 a 10');
    const motivo = v.text(String(b.motivo ?? ''), 'motivo', { max: 500 }) || '';
    if (cal != null && r.final != null && Math.abs(cal - Number(r.final)) >= 0.05 && !motivo) throw new HttpError(400, 'Ogni correzione vuole un motivo');
    await db.query('UPDATE pm_reviews SET calibrated = $1, calib_reason = $2, piano = COALESCE($3, piano) WHERE user_id = $4 AND year = $5',
      [cal == null ? null : P.round1(cal), motivo, b.piano === undefined ? null : v.text(String(b.piano), 'piano', { max: 2000 }) || '', userId, year]);
    await hrLog(req, `calibrazione ${year}`, null);
    res.json({ ok: true });
  });
  app.post('/api/hr/calibrazione/chiudi', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const rows = (await calibRows(year, hrMod().ambitoOf(req))).filter(r => !r.chiusa);
    const senzaPiano = rows.filter(r => r.voto != null && r.voto < 4 && !r.piano);
    if (senzaPiano.length) throw new HttpError(400, `Voto sotto 4 senza piano di miglioramento: ${senzaPiano.map(r => r.nome).join(', ')}`);
    for (const r of rows) await db.query('UPDATE pm_reviews SET calibrated = COALESCE(calibrated, final), calib_by = $1, calib_at = now() WHERE user_id = $2 AND year = $3', [req.user.id, r.user_id, year]);
    await hrLog(req, `calibrazione ${year} chiusa (${rows.length} persone)`);
    res.json({ ok: true, chiuse: rows.length });
  });

  // ── matrice (AK) ──
  app.get('/api/hr/matrice', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const { list, grid } = await universe();
    const ambito = hrMod().ambitoOf(req);
    const ids = list.map(p => p.user_id);
    const { rows: rev } = ids.length ? await db.query('SELECT user_id, COALESCE(calibrated, final) AS voto FROM pm_reviews WHERE year = $1 AND user_id = ANY($2) AND calib_at IS NOT NULL', [year, ids]) : { rows: [] };
    const vb = new Map(rev.map(x => [x.user_id, Number(x.voto)]));
    const rows = list.filter(p => hrMod().inScope(p.area, ambito) && p.ral && p.band && vb.has(p.user_id)).map(p => {
      const voto = vb.get(p.user_id);
      const pr = P.proposal({ ral: p.ral, partTimePct: p.part_time_pct, band: p.band, voto, rules: grid.rules });
      return { user_id: p.user_id, nome: `${p.nome} ${p.cognome}`, ruolo: p.role ? H.roleTitle(p.role) : '', area: p.area?.nome || '', voto, ral: p.ral, ...pr };
    });
    const col = z => (z === 'sotto' || z === 'ingresso' ? 0 : z === 'linea' ? 1 : 2);
    const righe = ['9-10', '7-8', '5-6', '3-4', '1-2'];
    const rowOf = s => (s >= 9 ? 0 : s >= 7 ? 1 : s >= 5 ? 2 : s >= 3 ? 3 : 4);
    const celle = righe.map((r, i) => [0, 1, 2].map(j => ({ pct: grid.rules.merit[r][j], persone: rows.filter(x => rowOf(x.voto) === i && col(x.zona) === j) })));
    const all = list.filter(p => hrMod().inScope(p.area, ambito) && p.ral && !p.esclusione);
    const monte = all.reduce((s, p) => s + Number(p.ral), 0);
    const merito = rows.reduce((s, r) => s + Math.max(0, r.nuova_ral - r.ral - r.al_minimo) + r.una_tantum, 0);
    const minimo = rows.reduce((s, r) => s + r.al_minimo, 0);
    const tetto = monte * grid.rules.budgetPct / 100;
    res.json({ year, righe, celle, senza_voto: all.length - rows.length, costo: { monte, merito, al_minimo: minimo, al_minimo_n: rows.filter(r => r.al_minimo).length, budget_pct: grid.rules.budgetPct, tetto: Math.round(tetto), differenza: Math.round(merito + minimo - tetto), coeff: grid.rules.costCoeff } });
  });

  // ── revisione retributiva (AL) ──
  async function areaHeadId(areaId) {
    if (!areaId) return null;
    const { rows } = await db.query('SELECT id, riporta_a_id, lower(ricoperto_da) AS email FROM org_incarichi WHERE attivo AND area_id = $1', [areaId]);
    const ids = new Set(rows.map(r => r.id));
    const top = rows.find(r => r.email && !ids.has(r.riporta_a_id));
    if (!top) return null;
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [top.email]);
    return u?.id || null;
  }
  app.post('/api/hr/revisione/genera', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const { list, grid } = await universe();
    const { rows: rev } = await db.query('SELECT user_id, COALESCE(calibrated, final) AS voto FROM pm_reviews WHERE year = $1 AND calib_at IS NOT NULL', [year]);
    const vb = new Map(rev.map(x => [x.user_id, Number(x.voto)]));
    let n = 0;
    for (const p of list.filter(x => x.ral && x.band && vb.has(x.user_id))) {
      const pr = P.proposal({ ral: p.ral, partTimePct: p.part_time_pct, band: p.band, voto: vb.get(p.user_id), rules: grid.rules });
      const { rowCount } = await db.query(`INSERT INTO hr_pay_reviews (year, person_key, user_id, area_id, role_id, voto, zona, ral, merito_pct, al_minimo, tipo, proposta_pct, nuova_ral, una_tantum)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (year, person_key) DO NOTHING`,
      [year, p.key, p.user_id, p.area?.id || null, p.role_id, vb.get(p.user_id), pr.zona, p.ral, pr.merito_pct, pr.al_minimo, pr.tipo, pr.proposta_pct, pr.nuova_ral, pr.una_tantum]);
      n += rowCount;
      if (p.area?.id) await db.query('INSERT INTO hr_pay_areas (year, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [year, p.area.id]);
    }
    const managers = [...new Set(list.filter(x => vb.has(x.user_id) && x.manager_id).map(x => x.manager_id))];
    await notify(managers, req.user.id, `la revisione retributiva ${year} è aperta: proponi gli aumenti delle tue persone dentro il budget dell'area.`, '/hr/revisione');
    res.json({ create: n });
  });
  async function reviewData(req, year) {
    const k = roleKey(req);
    const { list, grid, roleBy } = await universe();
    const pb = new Map(list.map(p => [p.key, p]));
    const { rows } = await db.query(`SELECT r.*, a.nome AS area, a.tipo AS area_tipo, (SELECT p.crescita FROM pm_reviews p WHERE p.user_id = r.user_id AND p.year = r.year) AS crescita
      FROM hr_pay_reviews r LEFT JOIN org_aree a ON a.id = r.area_id WHERE r.year = $1 ORDER BY a.nome, r.id`, [year]);
    const { rows: areas } = await db.query('SELECT s.*, a.nome FROM hr_pay_areas s JOIN org_aree a ON a.id = s.area_id WHERE s.year = $1', [year]);
    const out = rows.map(r => {
      const p = pb.get(r.person_key) || {};
      const role = roleBy.get(r.role_id);
      const band = role ? H.bandOf(grid.bands, role.grade) : null;
      const peers = list.filter(x => x.role_id === r.role_id && x.key !== r.person_key && x.ral).map(x => ({ sesso: x.sesso, ral_fte: H.fte(x.ral, x.part_time_pct) }));
      const row = { ...r, voto: r.voto == null ? null : Number(r.voto), merito_pct: Number(r.merito_pct), proposta_pct: Number(r.proposta_pct), part_time_pct: p.part_time_pct, nome: p.nome ? `${p.nome} ${p.cognome}` : r.person_key,
        ruolo: role ? H.roleTitle(role) : '', grade: role?.grade || null, nuovo_ruolo: r.nuovo_role_id ? H.roleTitle(roleBy.get(r.nuovo_role_id) || {}) : null, manager_id: p.manager_id, sesso: p.sesso };
      row.controlli = P.checks({ row, band, grade: role?.grade, rules: grid.rules, peers, sesso: p.sesso, crescita: r.crescita });
      return row;
    });
    const ambito = k === 'hr' ? hrMod().ambitoOf(req) : '';
    const scoped = out.filter(r => !ambito || hrMod().inScope({ id: r.area_id, tipo: r.area_tipo }, ambito));
    const byArea = new Map();
    for (const r of scoped) (byArea.get(r.area_id || 0) || byArea.set(r.area_id || 0, []).get(r.area_id || 0)).push(r);
    const aree = [...byArea.entries()].map(([id, rs]) => ({ area_id: id || null, nome: rs[0].area || 'Senza area', ...P.budget(rs, grid.rules), stato: areas.find(a => a.area_id === id) || { stato: 'aperta' }, persone: rs.length,
      eccezioni: rs.filter(x => x.controlli.length).length }));
    return { k, rows: scoped, aree, grid };
  }
  app.get('/api/hr/revisione', async (req, res) => {
    const year = yearOf(req);
    const { k, rows, aree } = await reviewData(req, year);
    const strip = r => ({ ...r, ral: undefined, nuova_ral: undefined, una_tantum: r.una_tantum ? true : 0, al_minimo: r.al_minimo ? true : 0, boss_ral: undefined, sesso: undefined }); // il responsabile vede le %
    const ciclo = await cycleOf(year);
    if (k === 'hr') return res.json({ year, accesso: 'hr', ciclo, righe: rows, aree });
    if (k === 'direzione' || k === 'cfo') {
      const ar = k === 'cfo' ? aree.filter(a => a.sopra) : aree;
      return res.json({ year, accesso: k, ciclo, aree: ar.map(a => ({ ...a, monte: undefined, tetto: undefined, speso: undefined })),
        eccezioni: rows.filter(r => r.controlli.length && ar.some(a => a.area_id === r.area_id)).map(r => ({ nome: r.nome, area: r.area, controlli: r.controlli, tipo: r.tipo, proposta_pct: r.proposta_pct })) });
    }
    const mine = rows.filter(r => r.manager_id === req.user.id);
    if (!mine.length) throw new HttpError(403, 'La revisione la vedono il team HR, la Direzione e i responsabili per le loro persone');
    const myAreas = new Set(mine.map(r => r.area_id));
    res.json({ year, accesso: 'responsabile', ciclo, righe: mine.map(strip), aree: aree.filter(a => myAreas.has(a.area_id)).map(a => ({ ...a, monte: undefined, tetto: undefined, speso: undefined })) });
  });
  app.patch('/api/hr/revisione/:id', async (req, res) => {
    const year = yearOf(req);
    const { k, rows, grid } = await reviewData(req, year);
    const r = rows.find(x => x.id === v.int(req.params.id, 'riga', { min: 1 }));
    if (!r) throw new HttpError(404, 'Riga non trovata');
    const hr = k === 'hr';
    if (!hr && r.manager_id !== req.user.id) throw new HttpError(403, 'Proponi solo per le tue persone');
    const { rows: [ar] } = await db.query('SELECT stato FROM hr_pay_areas WHERE year = $1 AND area_id = $2', [year, r.area_id]);
    if (!hr && ar && ar.stato !== 'aperta') throw new HttpError(400, "L'area è già stata inviata: chiedi al team HR");
    const b = req.body || {};
    const tipo = v.oneOf(b.tipo || r.tipo, 'tipo', ['merito', 'promozione', 'una_tantum', 'nessuno']);
    const motivo = b.motivo === undefined ? r.motivo : v.text(String(b.motivo), 'motivo', { max: 1000 }) || '';
    const upd = { tipo, motivo, nuovo_role_id: null, una_tantum: 0, proposta_pct: 0, nuova_ral: r.ral };
    if (tipo === 'promozione') {
      const nr = v.int(b.nuovo_role_id ?? r.nuovo_role_id, 'nuovo ruolo', { min: 1 });
      const { rows: [role] } = nr ? await db.query('SELECT * FROM pm_roles WHERE id = $1', [nr]) : { rows: [] };
      if (!role || !(Number(role.grade) > Number(r.grade))) throw new HttpError(400, 'La promozione va a un ruolo di grade più alto');
      const pr = P.proposal({ ral: r.ral, partTimePct: r.part_time_pct, band: null, voto: r.voto, rules: grid.rules, newBand: H.bandOf(grid.bands, role.grade) });
      Object.assign(upd, { nuovo_role_id: nr, proposta_pct: pr.proposta_pct, nuova_ral: pr.nuova_ral });
    } else if (tipo === 'una_tantum') {
      if (!hr && b.una_tantum === undefined) throw new HttpError(400, "Scrivi l'importo una tantum");
      upd.una_tantum = v.int(b.una_tantum ?? r.una_tantum, 'una tantum', { min: 0, max: 50000 }) || 0;
    } else if (tipo === 'merito') {
      const pct = Number(b.proposta_pct ?? r.proposta_pct);
      if (!(pct >= 0 && pct <= 30)) throw new HttpError(400, 'Percentuale non valida');
      const delta = Math.abs(pct - r.merito_pct);
      if (!hr && delta > 1.0001) throw new HttpError(403, 'Oltre ±1 punto dalla matrice decide il team HR');
      if (delta > 0.0001 && !motivo) throw new HttpError(400, 'Scostandoti dalla matrice serve il motivo');
      Object.assign(upd, { proposta_pct: P.round1(pct), nuova_ral: P.ralFromPct(r.ral, r.al_minimo, pct) });
    }
    if (hr && b.nuova_ral !== undefined && tipo !== 'nessuno') upd.nuova_ral = v.int(b.nuova_ral, 'nuova RAL', { min: 10000, max: 400000 });
    await db.query(`UPDATE hr_pay_reviews SET tipo = $1, motivo = $2, nuovo_role_id = $3, una_tantum = $4, proposta_pct = $5, nuova_ral = $6, proposed_by = $7, updated_at = now() WHERE id = $8`,
      [upd.tipo, upd.motivo, upd.nuovo_role_id, upd.una_tantum, upd.proposta_pct, upd.nuova_ral, req.user.id, r.id]);
    res.json({ ok: true, proposta_pct: upd.proposta_pct, ...(hr ? { nuova_ral: upd.nuova_ral } : {}) });
  });
  app.post('/api/hr/revisione/area/:areaId/:passo', async (req, res) => {
    const year = yearOf(req);
    const areaId = v.int(req.params.areaId, 'area', { min: 1 });
    const passo = v.oneOf(req.params.passo, 'passo', ['invia', 'hr', 'direzione', 'cfo', 'riapri']);
    const k = roleKey(req);
    const { aree, rows } = await reviewData({ ...req, query: { ...req.query, ambito: '' } }, year);
    const a = aree.find(x => x.area_id === areaId);
    if (!a) throw new HttpError(404, 'Area senza revisione');
    const cur = a.stato.stato || 'aperta';
    const head = await areaHeadId(areaId);
    const isRespArea = rows.some(r => r.area_id === areaId && r.manager_id === req.user.id) || head === req.user.id;
    const dirIds = await usersByRole('direzione'); const cfoIds = await usersByRole('cfo');
    const can = {
      invia: cur === 'aperta' && (isRespArea || k === 'hr'), hr: cur === 'inviata' && k === 'hr',
      direzione: cur === 'hr' && (k === 'direzione' || (!dirIds.length && gov.isAdmin(req))),
      cfo: cur === 'direzione' && a.sopra && (k === 'cfo' || (!cfoIds.length && gov.isAdmin(req))), riapri: k === 'hr' && cur !== 'aperta',
    };
    if (!can[passo]) throw new HttpError(403, 'Questo passo non tocca a te adesso');
    const next = { invia: 'inviata', hr: 'hr', direzione: a.sopra ? 'direzione' : 'approvata', cfo: 'approvata', riapri: 'aperta' }[passo];
    const col = { invia: 'inviata', hr: 'hr', direzione: 'dir', cfo: 'cfo' }[passo];
    await db.query(`INSERT INTO hr_pay_areas (year, area_id, stato) VALUES ($1, $2, $3) ON CONFLICT (year, area_id) DO UPDATE SET stato = $3${col ? `, ${col}_by = $4, ${col}_at = now()` : ''}`,
      col ? [year, areaId, next, req.user.id] : [year, areaId, next]);
    if (next === 'inviata') await notify(await usersByRole('hr'), req.user.id, `ha inviato le proposte di aumento dell'area «${a.nome}».`, '/hr/revisione');
    if (next === 'hr') await notify(dirIds, req.user.id, `revisione ${year}: «${a.nome}» pronta per l'approvazione della Direzione.`, '/hr/revisione');
    if (next === 'direzione') await notify(cfoIds, req.user.id, `revisione ${year}: «${a.nome}» sopra il budget, serve l'ok del CFO.`, '/hr/revisione');
    await hrLog(req, `revisione ${year} · ${a.nome}: ${passo}`);
    res.json({ ok: true, stato: next });
  });
  app.get('/api/hr/revisione.xlsx', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const { rows } = await reviewData(req, year);
    const { writeXlsx } = require('../lib/xlsx');
    const sheet = [['Persona', 'Area', 'Ruolo', 'Voto', 'Zona', 'RAL oggi', 'Matrice %', 'Tipo', 'Proposta %', 'Nuovo ruolo', 'Nuova RAL', 'Una tantum', 'Motivo', 'Controlli'],
      ...rows.map(r => [r.nome, r.area || '', r.ruolo, r.voto ?? '', r.zona || '', r.ral, r.merito_pct, r.tipo, r.proposta_pct, r.nuovo_ruolo || '', r.nuova_ral, r.una_tantum, r.motivo, r.controlli.map(c => c.testo).join('; ')])];
    await hrLog(req, `export revisione ${year}`);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="revisione-${year}-riservato.xlsx"`).send(writeXlsx({ Revisione: sheet }));
  });

  // ── lettere e BOSS (AM) ──
  async function bossCheck(year, decorrenza) {
    const { rows } = await db.query('SELECT id, person_key, ral, nuova_ral FROM hr_pay_reviews WHERE year = $1 AND boss_at IS NULL AND nuova_ral <> ral', [year]);
    for (const r of rows) {
      const { rows: [p] } = await db.query('SELECT ral::float AS ral FROM hr_pay WHERE person_key = $1 AND valid_from >= $2 ORDER BY valid_from DESC LIMIT 1', [r.person_key, decorrenza]);
      if (!p) continue;
      if (Math.abs(p.ral - r.nuova_ral) < 1) await db.query('UPDATE hr_pay_reviews SET boss_at = now(), boss_ral = NULL WHERE id = $1', [r.id]);
      else await db.query('UPDATE hr_pay_reviews SET boss_ral = $1 WHERE id = $2', [Math.round(p.ral), r.id]);
    }
  }
  registerHrPerf.bossCheck = async () => { const y = currentYear(); const c = await cycleOf(y); await bossCheck(y, c.decorrenza); };
  async function approvedRows(req, year) {
    const { k, rows } = await reviewData({ ...req, query: { ...req.query, ambito: '' } }, year);
    const { rows: ok } = await db.query("SELECT area_id FROM hr_pay_areas WHERE year = $1 AND stato = 'approvata'", [year]);
    const okSet = new Set(ok.map(x => x.area_id));
    const app2 = rows.filter(r => okSet.has(r.area_id));
    return { k, rows: k === 'hr' ? app2 : app2.filter(r => r.manager_id === req.user.id) };
  }
  app.get('/api/hr/revisione/lettere', async (req, res) => {
    const year = yearOf(req);
    const c = await cycleOf(year);
    await bossCheck(year, c.decorrenza);
    const { k, rows } = await approvedRows(req, year);
    if (k !== 'hr' && !rows.length) throw new HttpError(403, 'Le lettere le vedono il team HR e i responsabili delle persone');
    const hr = k === 'hr';
    res.json({ year, decorrenza: c.decorrenza, is_hr: hr, righe: rows.map(r => ({ id: r.id, nome: r.nome, area: r.area, tipo: r.tipo, voto: r.voto, proposta_pct: r.proposta_pct, nuovo_ruolo: r.nuovo_ruolo,
      colloquio_at: r.colloquio_at, boss_at: r.boss_at, ...(hr ? { ral: r.ral, nuova_ral: r.nuova_ral, una_tantum: r.una_tantum, boss_ral: r.boss_ral } : {}) })),
      boss: hr ? { registrate: rows.filter(r => r.boss_at).length, da_registrare: rows.filter(r => r.nuova_ral !== r.ral).length, diverse: rows.filter(r => r.boss_ral).length,
        in_attesa_10: rows.filter(r => r.nuova_ral !== r.ral && !r.boss_at && Date.now() - Date.parse(c.decorrenza) > 10 * 86400000).length } : null });
  });
  const letterData = async (rows, year, c) => {
    const { rows: roles } = await db.query('SELECT id, next_criteria FROM pm_roles');
    const crit = new Map(roles.map(r => [r.id, r.next_criteria]));
    return rows.map(r => ({ nome: r.nome.split(' ')[0], anno: year, voto: r.voto, tipo: r.tipo, ral: r.ral, nuova_ral: r.nuova_ral, una_tantum: r.una_tantum, decorrenza: c.decorrenza, ruolo: r.ruolo, nuovo_ruolo: r.nuovo_ruolo, crescita: crit.get(r.nuovo_role_id || r.role_id) || '' }));
  };
  app.get('/api/hr/revisione/lettere.docx', async (req, res) => {
    const year = yearOf(req);
    const c = await cycleOf(year);
    let { k, rows } = await approvedRows(req, year);
    if (req.query.id) rows = rows.filter(r => r.id === Number(req.query.id));
    if (!rows.length) throw new HttpError(k === 'hr' ? 404 : 403, 'Nessuna lettera');
    const buf = P.lettersDocx(await letterData(rows, year, c), { oggi: todayIso() });
    await hrLog(req, `lettere di esito ${year} (${rows.length})`);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').set('Content-Disposition', `attachment; filename="lettere-${year}${rows.length === 1 ? `-${encodeURIComponent(rows[0].nome.split(' ').pop())}` : ''}.docx"`).send(buf);
  });
  app.get('/api/hr/revisione/consulente.xlsx', async (req, res) => {
    hrOnly(req);
    const year = yearOf(req);
    const c = await cycleOf(year);
    const { rows } = await approvedRows(req, year);
    const { rows: hp } = await db.query('SELECT key, boss_id, cognome, nome FROM hr_people');
    const hb = new Map(hp.map(x => [x.key, x]));
    const { writeXlsx } = require('../lib/xlsx');
    const sheet = [['ID BOSS', 'Cognome', 'Nome', 'Decorrenza', 'RAL attuale', 'Nuova RAL', 'Una tantum', 'Nuovo ruolo'],
      ...rows.filter(r => r.nuova_ral !== r.ral || r.una_tantum).map(r => { const x = hb.get(r.person_key) || {}; return [x.boss_id || '', x.cognome || '', x.nome || '', c.decorrenza, r.ral, r.nuova_ral, r.una_tantum, r.nuovo_ruolo || '']; })];
    await hrLog(req, `file per il consulente ${year}`);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="aumenti-${year}-consulente.xlsx"`).send(writeXlsx({ Aumenti: sheet }));
  });
  app.post('/api/hr/revisione/:id/colloquio', async (req, res) => {
    const year = yearOf(req);
    const { k, rows } = await approvedRows(req, year);
    const r = rows.find(x => x.id === v.int(req.params.id, 'riga', { min: 1 }));
    if (!r) throw new HttpError(404, 'Riga non trovata tra le revisioni approvate');
    await db.query('UPDATE hr_pay_reviews SET colloquio_at = CASE WHEN $1 THEN now() END WHERE id = $2', [req.body.fatto !== false, r.id]);
    if (req.body.fatto !== false && r.user_id) await notify([r.user_id], req.user.id, `il tuo esito ${year} è in «Il mio percorso».`, '/hr/esito');
    res.json({ ok: true, da: k });
  });

  // ── il mio esito (AN) ──
  app.get('/api/hr/esito/mio', async (req, res) => {
    const year = yearOf(req);
    const { rows: [r] } = await db.query('SELECT * FROM hr_pay_reviews WHERE user_id = $1 AND year = $2 AND colloquio_at IS NOT NULL', [req.user.id, year]);
    const { rows: hist } = await db.query('SELECT year, scale, final, calibrated, comment, crescita FROM pm_reviews WHERE user_id = $1 ORDER BY year DESC', [req.user.id]);
    const { rows: pays } = await db.query('SELECT year, nuova_ral, ral, role_id FROM hr_pay_reviews WHERE user_id = $1 AND colloquio_at IS NOT NULL', [req.user.id]);
    const c = await cycleOf(year);
    const grid = await hrMod().currentGrid(db);
    let role = null; let next = null;
    if (r) {
      ({ rows: [role] } = await db.query('SELECT * FROM pm_roles WHERE id = $1', [r.nuovo_role_id || r.role_id]));
      if (role) ({ rows: [next] } = await db.query('SELECT id, title, hr_name, hr_level, grade FROM pm_roles WHERE hr_family = $1 AND grade > $2 AND merged_into IS NULL ORDER BY grade, hr_order LIMIT 1', [role.hr_family, role.grade]));
    }
    const storia = hist.map(h => {
      const raw = h.calibrated ?? h.final;
      return { year: h.year, voto: raw == null ? null : P.toTen(raw, h.scale), originale: h.scale === 5 && raw != null ? Number(raw) : null, ral: pays.find(p => p.year === h.year)?.nuova_ral || null };
    });
    const mine = hist.find(h => h.year === year);
    res.json({ year, decorrenza: c.decorrenza, esito: r ? { voto: r.voto == null ? null : Number(r.voto), etichetta: P.labelOf(r.voto)?.[1] || '', tipo: r.tipo, ral: r.ral, nuova_ral: r.nuova_ral, una_tantum: r.una_tantum,
      ruolo: role ? H.roleTitle(role) : '', grade: role?.grade || null, band: role ? H.bandOf(grid.bands, role.grade) : null, commento: mine?.comment || '', id: r.id } : null,
    crescita: role ? { verso: next ? `${H.roleTitle(next)} (G${next.grade})` : null, criteri: role.next_criteria || '', raggiunto: mine?.crescita || false } : null, storia });
  });
  app.get('/api/hr/esito/mio/lettera.docx', async (req, res) => {
    const year = yearOf(req);
    const c = await cycleOf(year);
    const { rows: [r] } = await db.query('SELECT * FROM hr_pay_reviews WHERE user_id = $1 AND year = $2 AND colloquio_at IS NOT NULL', [req.user.id, year]);
    if (!r) throw new HttpError(404, 'La lettera arriva dopo il colloquio con il responsabile');
    const { rows: [u] } = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    const { rows: [role] } = await db.query('SELECT * FROM pm_roles WHERE id = $1', [r.role_id]);
    const { rows: [nr] } = r.nuovo_role_id ? await db.query('SELECT * FROM pm_roles WHERE id = $1', [r.nuovo_role_id]) : { rows: [] };
    const buf = P.lettersDocx([{ nome: u.name.split(' ')[0], anno: year, voto: Number(r.voto), tipo: r.tipo, ral: r.ral, nuova_ral: r.nuova_ral, una_tantum: r.una_tantum, decorrenza: c.decorrenza,
      ruolo: role ? H.roleTitle(role) : '', nuovo_ruolo: nr ? H.roleTitle(nr) : null, crescita: (nr || role)?.next_criteria || '' }], { oggi: todayIso() });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').set('Content-Disposition', `attachment; filename="esito-${year}.docx"`).send(buf);
  });
}

module.exports = { registerHrPerf, currentYear };
