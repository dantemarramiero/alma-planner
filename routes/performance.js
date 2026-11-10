// Alma Strategy: performance management.
// - Scheda: ognuno vede la sua (ruolo dal mansionario, valutazione, obiettivi); il responsabile vede e valuta i suoi;
//   l'amministratore vede tutti.
// - Mansionario: la persona propone ruolo e 5 responsabilità, l'amministratore conferma o modifica; la versione
//   confermata è quella che compare nella scheda.
// - Obiettivi: KPI di livello 1 con peso; con la fonte «Hoshin Kanri» il raggiungimento viene dai progetti del KPI di livello 0.
const { HttpError, v } = require('../lib/http');
const { seedStrategy } = require('../lib/strategy-seed');

const YEAR = 2026;
const SOFT_SKILLS = [
  'Gestione dello stress', 'Autonomia, integrità e rispetto delle regole', 'Orientamento al cambiamento e all’innovazione',
  'Leadership (chi coordina) / team working', 'Pianificazione e organizzazione', 'Comunicazione e capacità relazionale',
  'Determinazione e orientamento al risultato', 'Positività e proattività',
];

// ── dati di partenza, dal file «Performance Management Nuovo.xlsx» ────────────────────────────────────
const CIO = {
  title: 'CIO', area: 'IT', reports_to: 'CDA', coordinates: 3,
  interfaces: ['CDA', 'Responsabili di funzione', 'Responsabili di area', 'Fornitori strategici (Sistema azienda, Amazon, Microsoft, Anthropic)', 'Team IT'],
  description: 'Come IT Manager di Almacis sono responsabile della direzione strategica dell’informatica aziendale, con il compito di allineare la tecnologia agli obiettivi di business e trasformarla in una leva di crescita ed efficienza: definisco la roadmap tecnologica, guido le scelte architetturali e di investimento. Sono anche responsabile, nel confronto con i responsabili di area e funzione, dell’efficientamento delle procedure e della loro successiva digitalizzazione, con lo scopo di rendere il dato utilizzabile ed interpretabile. Sono responsabile della crescita e dello sviluppo di una struttura capace e sostenibile nel tempo, attraverso la definizione chiara di ruoli e responsabilità, lo sviluppo delle competenze e la continuità organizzativa.',
  responsibilities: [
    'Analisi di mercato e garante dell’avanguardia tecnologica dell’azienda',
    'Garantire la continuità operativa aziendale (manutenzione ordinaria e straordinaria, hardware e software, sicurezza informatica)',
    'Crescita del team IT',
    'Analisi ed efficientamento dei flussi informativi per la loro traduzione digitale',
    'Implementazione di un piano strategico IT e management del piano operativo annuale',
  ],
  hard_skills: ['Conoscenza dell’hardware infrastrutturale IT', 'Conoscenza delle infrastrutture e delle logiche software', 'Capacità di analisi di mercato IT',
    'Comprensione, efficientamento e traduzione digitale delle procedure aziendali', 'Capacità di usare i tool AI'],
};
const CIO_PROPOSAL_RESP = ['Analisi di mercato e garante dell’avanguardia tecnologica dell’azienda', 'Sicurezza informatica dell’azienda', 'Crescita del team IT',
  'Stilare una strategia aziendale IT', 'Management del piano operativo per l’implementazione del piano strategico'];
// [responsabilità, pilastro, obiettivo, KPI, formula, unità, fonte, frequenza, target, peso, note, ostacoli]
const CIO_OBJECTIVES = [
  ['Innovazione tecnologica', 'Innovazione', 'Portare in azienda almeno tre innovazioni all’anno con un ritorno dimostrato', 'Progetti di innovazione avviati con business case approvato', 'N. progetti con business case approvato dalla Direzione nell’anno', 'n. progetti', 'Hoshin Kanri', 'Trimestrale', '≥ 3 / anno', 10, 'Conta solo ciò che supera la fase di pilota', 'Resistenza al cambiamento; budget limitato per sperimentazioni; difficoltà a quantificare i benefici a priori'],
  ['Innovazione tecnologica', 'Innovazione', 'Far usare in modo diffuso e quotidiano gli strumenti di IA acquistati', 'Tasso di adozione strumenti IA (ad oggi BOSS)', 'Rapportini compilati in giornata; compiti del mese assegnati su BOSS', '%', 'Dashboard di export BOSS', 'Mensile', 'TBD', 10, 'Capire i KPI per l’effettivo utilizzo', 'Resistenza al cambiamento'],
  ['Continuità operativa e sicurezza', 'Continuità e sicurezza', 'Ridurre al minimo i fermi non pianificati dei sistemi critici', 'Disponibilità dei sistemi critici', '(Ore previste − ore di fermo non pianificato) / ore previste × 100', '%', 'Sistema di monitoraggio / registro incidenti', 'Mensile', '≥ 99,5%', 10, 'Definire l’elenco dei sistemi critici (es. BOSS, posta, file server)', 'Infrastruttura eterogenea tra le società del gruppo; dipendenza da fornitori esterni'],
  ['Continuità operativa e sicurezza', 'Continuità e sicurezza', 'Risolvere rapidamente i problemi che bloccano il lavoro degli utenti', 'Tempo medio di risoluzione ticket ad alta priorità (MTTR)', 'Somma dei tempi di risoluzione / n. ticket ad alta priorità', 'ore lavorative', 'Sistema di ticketing', 'Mensile', '≤ 8 ore', 5, 'Richiede un sistema di ticketing strutturato', ''],
  ['Continuità operativa e sicurezza', 'Continuità e sicurezza', 'Ridurre il rischio di attacchi informatici legati al fattore umano', 'Resilienza al phishing', 'Utenti che cliccano nelle simulazioni / utenti coinvolti × 100', '%', 'Piattaforma di simulazione phishing', 'Trimestrale', '≤ 5%', 10, 'Da affiancare a test di ripristino backup almeno semestrali', 'Fattore umano nella sicurezza'],
  ['Crescita e sviluppo del team IT', 'Persone', 'Aggiornare costantemente le competenze tecniche del team IT', 'Terminare formazione Microsoft, Claude e AWS', 'Corsi finiti / corsi totali', 'corsi', 'Registro formazione HR', 'Semestrale', '3 / 3', 8, 'Includere certificazioni e formazione IA', 'Convivenza con l’operatività'],
  ['Crescita e sviluppo del team IT', 'Persone', 'Eliminare la dipendenza da singole persone sulle attività critiche', 'Copertura delle competenze critiche', 'Competenze critiche coperte da almeno 2 persone / totali × 100', '%', 'Skill matrix del team IT', 'Semestrale', '≥ 80%', 7, 'Riduce il rischio di persona chiave', 'Mercato del lavoro IT competitivo'],
  ['Processi e flussi informativi digitali', 'Efficienza operativa', 'Digitalizzare i processi pianificati secondo la roadmap annuale', 'Avanzamento della roadmap di digitalizzazione', 'Processi reingegnerizzati e rilasciati / pianificati nell’anno × 100', '%', 'Roadmap processi', 'Trimestrale', '≥ 90%', 10, '', ''],
  ['Processi e flussi informativi digitali', 'Efficienza operativa', 'Restituire tempo al business eliminando attività manuali e ripetitive', 'Ore uomo risparmiate', 'Somma delle ore risparmiate stimate per processo', 'ore', 'Roadmap processi', 'Trimestrale', '≥ 1.500 ore / anno', 10, '', ''],
  ['Pianificazione strategica e budget IT', 'Strategia e governance', 'Realizzare le iniziative del piano operativo nei tempi previsti', 'Avanzamento del piano operativo annuale', 'Iniziative chiuse / pianificate × 100', '%', 'Piano operativo', 'Trimestrale', '≥ 85%', 10, '', ''],
  ['Pianificazione strategica e budget IT', 'Strategia e governance', 'Mantenere la spesa IT sotto controllo rispetto al budget approvato', 'Scostamento dal budget IT', '(Speso − budget) / budget × 100', '%', 'Controllo di gestione', 'Trimestrale', 'Entro ± 5%', 5, '', ''],
  ['Pianificazione strategica e budget IT', 'Strategia e governance', 'Offrire agli utenti interni un servizio IT percepito come utile ed efficace', 'Soddisfazione degli utenti interni', 'Media del sondaggio da 1 a 5', 'punteggio', 'Sondaggio', 'Semestrale', '≥ 4', 5, '', ''],
];
const CIO_SELF_HARD = [2, 3, 4, 5, 3];
const CIO_SOFT = [[3, 4], [5, 5], [5, 5], [4, 3], [4, 2], [4, 5], [4, 5], [5, 5]]; // [autovalutazione, responsabile]

async function seed(db) {
  await seedStrategy(db, YEAR); // prima l'Hoshin Kanri: i ruoli nascono dalle sue BU e funzioni, gli obiettivi dai suoi KPI
  await db.tx(async q => {
    const { rows: [any] } = await q.query('SELECT 1 FROM pm_roles LIMIT 1');
    if (any) return;
    const { rows: [cio] } = await q.query(
      `INSERT INTO pm_roles (title, area, reports_to, interfaces, coordinates, description, responsibilities, hard_skills, status, proposal, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'review',$9, now()) RETURNING id`,
      [CIO.title, CIO.area, CIO.reports_to, JSON.stringify(CIO.interfaces), CIO.coordinates, CIO.description, JSON.stringify(CIO.responsibilities), JSON.stringify(CIO.hard_skills),
        JSON.stringify({ ...CIO, responsibilities: CIO_PROPOSAL_RESP })]);
    // un ruolo da compilare per ogni BU e funzione dell'Hoshin Kanri
    const { rows: funcs } = await q.query('SELECT name FROM hk_functions WHERE year = $1 ORDER BY position', [YEAR]).catch(() => ({ rows: [] }));
    for (const f of funcs) {
      if (f.name === 'ICT') continue;
      await q.query('INSERT INTO pm_roles (title, area) VALUES ($1, $2)', [`Responsabile ${f.name}`, f.name]);
    }
    const { rows: [dante] } = await q.query("SELECT id FROM users WHERE lower(email) = 'dante.marramiero@almacis.it'");
    if (!dante) return;
    await q.query('INSERT INTO pm_profiles (user_id, role_id, team) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING', [dante.id, cio.id, 'ICT']);
    const self = {}, mgr = {};
    CIO.hard_skills.forEach((s, i) => { self[s] = CIO_SELF_HARD[i]; });
    SOFT_SKILLS.forEach((s, i) => { self[s] = CIO_SOFT[i][0]; mgr[s] = CIO_SOFT[i][1]; });
    await q.query('INSERT INTO pm_reviews (user_id, year, status, self_scores, manager_scores) VALUES ($1,$2,\'manager\',$3,$4) ON CONFLICT DO NOTHING',
      [dante.id, YEAR, JSON.stringify(self), JSON.stringify(mgr)]);
    const { rows: [nKpi] } = await q.query("SELECT id FROM hk_kpis WHERE year = $1 AND letter = 'N'", [YEAR]).catch(() => ({ rows: [] }));
    for (const [i, o] of CIO_OBJECTIVES.entries()) {
      await q.query(
        `INSERT INTO pm_objectives (user_id, year, position, responsibility, pillar, objective, kpi, formula, unit, source, frequency, target, weight, notes, obstacles, hk_kpi_id, approved)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)`,
        [dante.id, YEAR, i, ...o, o[6] === 'Hoshin Kanri' ? nKpi?.id || null : null]);
    }
  });
}

const textArr = (val, field, { max = 20, len = 600 } = {}) => {
  if (!Array.isArray(val) || val.length > max) throw new HttpError(400, `Il campo «${field}» non è valido`);
  return val.map(s => v.text(String(s ?? ''), field, { max: len }) ?? '').filter(Boolean);
};
const scores = (val, field) => {
  if (!val || typeof val !== 'object' || Array.isArray(val)) throw new HttpError(400, `Il campo «${field}» non è valido`);
  const out = {};
  for (const [k, n] of Object.entries(val)) {
    if (k.length > 300) throw new HttpError(400, `Il campo «${field}» non è valido`);
    if (n === null) continue;
    const x = v.int(n, field, { min: 1, max: 5 });
    out[k] = x;
  }
  return out;
};
const ROLE_FIELDS = {
  title: (x, f) => v.text(x ?? '', f, { max: 120 }) ?? '', area: (x, f) => v.text(x ?? '', f, { max: 120 }) ?? '', reports_to: (x, f) => v.text(x ?? '', f, { max: 120 }) ?? '',
  interfaces: (x, f) => textArr(x, f, { max: 20, len: 200 }), coordinates: (x, f) => v.int(x, f, { min: 0, max: 999 }),
  description: (x, f) => v.text(x ?? '', f, { max: 4000 }) ?? '', responsibilities: (x, f) => textArr(x, f, { max: 5, len: 400 }), hard_skills: (x, f) => textArr(x, f, { max: 12, len: 200 }),
};
const cleanRole = body => { const out = {}; for (const [k, fn] of Object.entries(ROLE_FIELDS)) if (body[k] !== undefined) out[k] = fn(body[k], k); return out; };
const OBJ_FIELDS = ['responsibility', 'pillar', 'objective', 'kpi', 'formula', 'unit', 'source', 'frequency', 'target', 'notes', 'obstacles', 'last_value'];

function registerPerformance(app, { db, isAdmin, notifier }) {
  const admin = req => Boolean(isAdmin(req));
  // il team HR (team «HR» nel profilo) vede le schede di tutti, senza modificarle
  async function isHR(userId) {
    const { rows: [r] } = await db.query("SELECT lower(trim(team)) = 'hr' AS hr FROM pm_profiles WHERE user_id = $1", [userId]);
    return Boolean(r?.hr);
  }
  // le persone sotto a un responsabile, a ogni livello (collaboratori dei collaboratori compresi)
  const below = n => `WITH RECURSIVE below(id) AS (SELECT user_id FROM pm_profiles WHERE manager_id = $${n}
                   UNION SELECT pp.user_id FROM pm_profiles pp JOIN below b ON pp.manager_id = b.id) SELECT id FROM below`;
  async function rights(req, userId) {
    const self = req.user.id === userId;
    const { rows: [p] } = await db.query('SELECT manager_id FROM pm_profiles WHERE user_id = $1', [userId]);
    const manager = p?.manager_id === req.user.id; // il responsabile diretto: valuta e approva
    const under = !self && !manager && (await db.query(below(1), [req.user.id])).rows.some(r => r.id === userId);
    const hr = !self && await isHR(req.user.id);
    return { self, manager, below: under, hr, admin: admin(req), see: self || manager || under || hr || admin(req) };
  }
  const json = val => (val === undefined ? undefined : JSON.stringify(val));

  async function ensureOwnRole(userId) {
    await db.tx(async q => {
      const { rows: [p] } = await q.query('SELECT role_id FROM pm_profiles WHERE user_id = $1 FOR UPDATE', [userId]);
      if (p?.role_id) return;
      const { rows: [role] } = await q.query("INSERT INTO pm_roles (status) VALUES ('missing') RETURNING id");
      await q.query(`INSERT INTO pm_profiles (user_id, role_id) VALUES ($1, $2)
                     ON CONFLICT (user_id) DO UPDATE SET role_id = $2 WHERE pm_profiles.role_id IS NULL`, [userId, role.id]);
    });
  }

  // la scheda di una persona (la propria se non si dice chi)
  app.get('/api/pm/person', async (req, res) => {
    await seed(db);
    const userId = req.query.user ? v.int(req.query.user, 'persona', { min: 1 }) : req.user.id;
    const r = await rights(req, userId);
    if (!r.see) throw new HttpError(403, 'Puoi vedere solo la tua scheda e quella delle persone sotto di te');
    // chi apre la propria scheda senza un ruolo riceve una scheda vuota tutta sua, da compilare e mandare in approvazione
    if (r.self) await ensureOwnRole(userId);
    const [{ rows: [user] }, { rows: [profile] }, { rows: objectives }, { rows: [review] }, { rows: kpis }] = await Promise.all([
      db.query('SELECT id, name, email FROM users WHERE id = $1', [userId]),
      db.query(`SELECT pp.*, m.name AS manager_name FROM pm_profiles pp LEFT JOIN users m ON m.id = pp.manager_id WHERE pp.user_id = $1`, [userId]),
      db.query('SELECT * FROM pm_objectives WHERE user_id = $1 AND year = $2 ORDER BY position, id', [userId, YEAR]),
      db.query('SELECT * FROM pm_reviews WHERE user_id = $1 AND year = $2', [userId, YEAR]),
      db.query('SELECT id, letter, name FROM hk_kpis WHERE year = $1 ORDER BY position', [YEAR]),
    ]);
    if (!user) throw new HttpError(404, 'Persona non trovata');
    const role = profile?.role_id ? (await db.query('SELECT * FROM pm_roles WHERE id = $1', [profile.role_id])).rows[0] : null;
    // ultima richiesta di modifica della scheda (in attesa, o l'ultima decisa)
    const { rows: [request] } = await db.query(
      `SELECT cr.*, a.name AS approver_name, d.name AS decided_by_name FROM pm_change_requests cr
         LEFT JOIN users a ON a.id = cr.approver_id LEFT JOIN users d ON d.id = cr.decided_by
        WHERE cr.user_id = $1 AND cr.status <> 'withdrawn' ORDER BY cr.created_at DESC LIMIT 1`, [userId]);
    res.json({ year: YEAR, user, profile: profile || null, role, objectives, review: review || { status: 'self', self_scores: {}, manager_scores: {} },
      soft_skills: SOFT_SKILLS, hk_kpis: kpis, rights: r, request: request || null });
  });

  // ── modifiche della scheda, approvate dal responsabile ─────────────────────────────────────────
  // Campi del ruolo che la persona può cambiare: «resp» è una delle 5 responsabilità (index 0..4).
  const CHANGE_FIELDS = {
    title: { label: 'Ruolo', clean: (x, f) => v.text(String(x ?? ''), f, { max: 120 }) ?? '' },
    area: { label: 'Area', clean: (x, f) => v.text(String(x ?? ''), f, { max: 120 }) ?? '' },
    reports_to: { label: 'A chi rispondo', clean: (x, f) => v.text(String(x ?? ''), f, { max: 120 }) ?? '' },
    coordinates: { label: 'Persone che coordino', clean: (x, f) => v.int(x, f, { min: 0, max: 999 }) },
    interfaces: { label: 'Con chi mi interfaccio', clean: (x, f) => textArr(x, f, { max: 20, len: 200 }) },
    description: { label: 'Io sono responsabile di…', clean: (x, f) => v.text(String(x ?? ''), f, { max: 4000 }) ?? '' },
    resp: { label: 'Responsabilità', clean: (x, f) => v.text(String(x ?? ''), f, { max: 400 }) ?? '' },
    hard_skills: { label: 'Hard skills del ruolo', clean: (x, f) => textArr(x, f, { max: 12, len: 200 }) },
  };
  const currentValue = (role, c) => (c.field === 'resp' ? (role.responsibilities || [])[c.index] || '' : role[c.field] ?? '');
  const notify = (userIds, actorId, body, link) => notifier?.notify({ userIds, actorId, kind: 'strategy', body, link }).catch(() => {});

  // la persona invia le sue modifiche (sostituiscono una richiesta ancora in attesa)
  app.post('/api/pm/requests', async (req, res) => {
    const { rows: [p] } = await db.query('SELECT pp.role_id, pp.manager_id FROM pm_profiles pp WHERE pp.user_id = $1', [req.user.id]);
    if (!p?.role_id) throw new HttpError(400, 'Non hai ancora un ruolo: lo assegna l’amministratore');
    const { rows: [role] } = await db.query('SELECT * FROM pm_roles WHERE id = $1', [p.role_id]);
    const list = Array.isArray(req.body?.changes) ? req.body.changes : [];
    if (!list.length || list.length > 30) throw new HttpError(400, 'Nessuna modifica da inviare');
    const changes = list.map(ch => {
      const def = CHANGE_FIELDS[ch?.field];
      if (!def) throw new HttpError(400, 'Campo non modificabile');
      const c = { field: ch.field, label: def.label };
      if (ch.field === 'resp') { c.index = v.int(ch.index, 'responsabilità', { min: 0, max: 4 }); c.label = `Responsabilità ${c.index + 1}`; }
      c.after = def.clean(ch.after, def.label);
      c.before = currentValue(role, c);
      c.decision = null;
      c.reason = '';
      return c;
    }).filter(c => JSON.stringify(c.after) !== JSON.stringify(c.before));
    if (!changes.length) throw new HttpError(400, 'Le modifiche sono uguali alla versione in vigore');
    await db.query("UPDATE pm_change_requests SET status = 'withdrawn' WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    const { rows: [r] } = await db.query(
      'INSERT INTO pm_change_requests (user_id, role_id, changes, approver_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, role.id, JSON.stringify(changes), p.manager_id || null]);
    if (p.manager_id) await notify([p.manager_id], req.user.id, `ti chiede di approvare ${changes.length === 1 ? '1 modifica' : `${changes.length} modifiche`} alla sua scheda.`, `/strategy/scheda/${req.user.id}`);
    res.status(201).json(r);
  });

  app.post('/api/pm/requests/:id/withdraw', async (req, res) => {
    const id = v.int(req.params.id, 'richiesta', { min: 1 });
    const { rowCount } = await db.query("UPDATE pm_change_requests SET status = 'withdrawn' WHERE id = $1 AND user_id = $2 AND status = 'pending'", [id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Richiesta non trovata o già decisa');
    res.json({ ok: true });
  });

  // richieste da approvare: quelle dei propri collaboratori; gli amministratori anche quelle senza responsabile
  app.get('/api/pm/requests', async (req, res) => {
    const { rows } = await db.query(
      `SELECT cr.id, cr.user_id, cr.created_at, cr.changes, u.name FROM pm_change_requests cr JOIN users u ON u.id = cr.user_id
        WHERE cr.status = 'pending' AND (cr.approver_id = $1 OR ($2 AND cr.approver_id IS NULL)) ORDER BY cr.created_at`, [req.user.id, admin(req)]);
    res.json(rows);
  });

  // il responsabile (o l'amministratore) decide modifica per modifica; le accettate entrano nel ruolo del mansionario
  app.post('/api/pm/requests/:id/decide', async (req, res) => {
    const id = v.int(req.params.id, 'richiesta', { min: 1 });
    const { rows: [cr] } = await db.query("SELECT * FROM pm_change_requests WHERE id = $1 AND status = 'pending'", [id]);
    if (!cr) throw new HttpError(404, 'Richiesta non trovata o già decisa');
    if (!(cr.approver_id === req.user.id || admin(req))) throw new HttpError(403, 'Le modifiche le approva il responsabile della persona');
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    if (decisions.length !== cr.changes.length) throw new HttpError(400, 'Decidi ogni modifica: accetta o rifiuta');
    const changes = cr.changes.map((c, i) => {
      const d = decisions[i] || {};
      if (!['ok', 'no'].includes(d.decision)) throw new HttpError(400, 'Decidi ogni modifica: accetta o rifiuta');
      return { ...c, decision: d.decision, reason: d.decision === 'no' ? (v.text(String(d.reason ?? ''), 'motivo', { max: 500 }) ?? '') : '' };
    });
    await db.tx(async q => {
      const { rows: [role] } = await q.query('SELECT * FROM pm_roles WHERE id = $1 FOR UPDATE', [cr.role_id]);
      if (role) {
        const next = { responsibilities: [...(role.responsibilities || [])] };
        for (const c of changes.filter(x => x.decision === 'ok')) {
          if (c.field === 'resp') { while (next.responsibilities.length <= c.index) next.responsibilities.push(''); next.responsibilities[c.index] = c.after; }
          else next[c.field] = c.after;
        }
        next.responsibilities = next.responsibilities.filter(Boolean).slice(0, 5);
        const keys = Object.keys(next);
        await q.query(`UPDATE pm_roles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, status = 'confirmed', confirmed_by = $${keys.length + 2}, confirmed_at = now() WHERE id = $1`,
          [role.id, ...keys.map(k => (Array.isArray(next[k]) ? JSON.stringify(next[k]) : next[k])), req.user.id]);
      }
      await q.query("UPDATE pm_change_requests SET status = 'decided', changes = $2, decided_by = $3, decided_at = now() WHERE id = $1", [id, JSON.stringify(changes), req.user.id]);
    });
    const ok = changes.filter(c => c.decision === 'ok').length;
    await notify([cr.user_id], req.user.id, `ha deciso le modifiche alla tua scheda: ${ok} accettate, ${changes.length - ok} rifiutate.`, '/strategy/scheda');
    res.json({ ok: true });
  });

  // ── revisione trimestrale degli obiettivi ────────────────────────────────────────────────────
  app.get('/api/pm/flags', async (req, res) => {
    const { rows: [r] } = await db.query('SELECT EXISTS (SELECT 1 FROM pm_profiles WHERE manager_id = $1) AS manager', [req.user.id]);
    res.json({ manager: r.manager, hr: await isHR(req.user.id), admin: admin(req) });
  });

  // le persone che si vedono nella dashboard: tutte per l'amministratore e per HR, chi è sotto per il responsabile
  app.get('/api/pm/team', async (req, res) => {
    await seed(db);
    const isAdm = admin(req);
    const all = isAdm || await isHR(req.user.id);
    const { rows: people } = await db.query(
      `SELECT u.id, u.name, pp.team, pp.manager_id, r.title AS role, rv.status AS review_status, rv.manager_scores,
              COALESCE((SELECT json_agg(json_build_object('id', o.id, 'objective', o.objective, 'target', o.target, 'weight', o.weight, 'achievement', o.achievement,
                                                          'source', o.source, 'hk_kpi_id', o.hk_kpi_id, 'last_value', o.last_value) ORDER BY o.position, o.id)
                          FROM pm_objectives o WHERE o.user_id = u.id AND o.year = $1), '[]') AS objectives,
              COALESCE((SELECT json_agg(json_build_object('quarter', q.quarter, 'status', q.status, 'values', q."values", 'note', q.note, 'actions', q.actions, 'closed_at', q.closed_at))
                          FROM pm_quarter_reviews q WHERE q.user_id = u.id AND q.year = $1), '[]') AS quarters
         FROM users u LEFT JOIN pm_profiles pp ON pp.user_id = u.id LEFT JOIN pm_roles r ON r.id = pp.role_id
         LEFT JOIN pm_reviews rv ON rv.user_id = u.id AND rv.year = $1
        WHERE ($2 AND (pp.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM pm_objectives o WHERE o.user_id = u.id AND o.year = $1)))
           OR u.id IN (${below(3)})
        ORDER BY pp.team NULLS LAST, u.name`, [YEAR, all, req.user.id]);
    // la revisione la fa il responsabile diretto (o un amministratore); gli altri la vedono soltanto
    for (const p of people) p.can_review = isAdm || p.manager_id === req.user.id;
    res.json({ year: YEAR, people, soft_skills: SOFT_SKILLS, admin: isAdm });
  });

  async function quarterRights(req, userId) {
    const r = await rights(req, userId);
    if (!(r.manager || r.admin)) throw new HttpError(403, 'La revisione trimestrale la fa il responsabile');
    return r;
  }
  const quarterOf = x => v.int(x, 'trimestre', { min: 1, max: 4 });
  app.put('/api/pm/quarters/:userId/:q', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const quarter = quarterOf(req.params.q);
    await quarterRights(req, userId);
    const { rows: [cur] } = await db.query('SELECT status FROM pm_quarter_reviews WHERE user_id = $1 AND year = $2 AND quarter = $3', [userId, YEAR, quarter]);
    if (cur?.status === 'closed') throw new HttpError(400, 'La revisione è chiusa: un amministratore può riaprirla');
    const b = req.body || {};
    const values = {};
    for (const [oid, val] of Object.entries(b.values || {})) {
      v.int(oid, 'obiettivo', { min: 1 });
      values[oid] = { value: v.text(String(val?.value ?? ''), 'valore', { max: 100 }) ?? '',
        achievement: val?.achievement === null || val?.achievement === '' || val?.achievement === undefined ? null : v.int(val.achievement, 'raggiungimento', { min: 0, max: 200 }) };
    }
    const note = v.text(String(b.note ?? ''), 'commento', { max: 4000 }) ?? '';
    const actions = v.text(String(b.actions ?? ''), 'azioni', { max: 4000 }) ?? '';
    await db.query(`INSERT INTO pm_quarter_reviews (user_id, year, quarter, "values", note, actions, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
                    ON CONFLICT (user_id, year, quarter) DO UPDATE SET "values" = $4, note = $5, actions = $6, updated_at = now()`,
      [userId, YEAR, quarter, JSON.stringify(values), note, actions]);
    res.json({ ok: true });
  });
  app.post('/api/pm/quarters/:userId/:q/close', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const quarter = quarterOf(req.params.q);
    await quarterRights(req, userId);
    await db.query(`INSERT INTO pm_quarter_reviews (user_id, year, quarter, status, closed_by, closed_at) VALUES ($1,$2,$3,'closed',$4, now())
                    ON CONFLICT (user_id, year, quarter) DO UPDATE SET status = 'closed', closed_by = $4, closed_at = now()`, [userId, YEAR, quarter, req.user.id]);
    await notify([userId], req.user.id, `ha chiuso la revisione del Q${quarter} dei tuoi obiettivi.`, '/strategy/obiettivi');
    res.json({ ok: true });
  });
  app.post('/api/pm/quarters/:userId/:q/reopen', async (req, res) => {
    if (!admin(req)) throw new HttpError(403, 'La riapre un amministratore');
    await db.query("UPDATE pm_quarter_reviews SET status = 'draft', closed_by = NULL, closed_at = NULL WHERE user_id = $1 AND year = $2 AND quarter = $3",
      [v.int(req.params.userId, 'persona', { min: 1 }), YEAR, quarterOf(req.params.q)]);
    res.json({ ok: true });
  });

  // ── valutazione ─────────────────────────────────────────────────────────────────────────────
  app.patch('/api/pm/reviews/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const r = await rights(req, userId);
    if (!r.see) throw new HttpError(403, 'Non puoi modificare questa valutazione');
    const { rows: [cur] } = await db.query('SELECT * FROM pm_reviews WHERE user_id = $1 AND year = $2', [userId, YEAR]);
    const status = cur?.status || 'self';
    const b = req.body || {};
    const next = { self_scores: cur?.self_scores || {}, manager_scores: cur?.manager_scores || {}, status };
    if (b.self_scores !== undefined) {
      if (!r.self || status !== 'self') throw new HttpError(403, status === 'self' ? 'L’autovalutazione la fa la persona' : 'L’autovalutazione è già stata inviata');
      next.self_scores = scores(b.self_scores, 'autovalutazione');
    }
    if (b.manager_scores !== undefined) {
      if (!(r.manager || r.admin) || status === 'closed') throw new HttpError(403, 'La valutazione la fa il responsabile, prima della chiusura');
      next.manager_scores = scores(b.manager_scores, 'valutazione');
    }
    if (b.status !== undefined) {
      const to = v.text(b.status, 'stato');
      const ok = (to === 'manager' && r.self && status === 'self') || (to === 'closed' && (r.manager || r.admin) && status === 'manager')
        || (to === 'self' && r.admin) || (to === 'manager' && r.admin && status === 'closed');
      if (!ok) throw new HttpError(403, 'Passaggio di stato non permesso');
      next.status = to;
    }
    await db.query(
      `INSERT INTO pm_reviews (user_id, year, status, self_scores, manager_scores, updated_at) VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (user_id, year) DO UPDATE SET status = $3, self_scores = $4, manager_scores = $5, updated_at = now()`,
      [userId, YEAR, next.status, JSON.stringify(next.self_scores), JSON.stringify(next.manager_scores)]);
    res.json(next);
  });

  // ── obiettivi ───────────────────────────────────────────────────────────────────────────────
  const canEditObjectives = r => r.self || r.manager || r.admin;
  function cleanObjective(b, r) {
    const out = {};
    for (const k of OBJ_FIELDS) if (b[k] !== undefined) out[k] = v.text(b[k] ?? '', k, { max: 1000 }) ?? '';
    if (b.weight !== undefined) out.weight = v.int(b.weight, 'peso', { min: 0, max: 100 });
    if (b.position !== undefined) out.position = v.int(b.position, 'ordine', { min: 0 });
    if (b.hk_kpi_id !== undefined) out.hk_kpi_id = b.hk_kpi_id === null || b.hk_kpi_id === '' ? null : v.int(b.hk_kpi_id, 'KPI di livello 0', { min: 1 });
    if (b.achievement !== undefined) out.achievement = b.achievement === null || b.achievement === '' ? null : v.int(b.achievement, 'raggiungimento', { min: 0, max: 100 });
    if (b.approved !== undefined) {
      if (!(r.manager || r.admin)) throw new HttpError(403, 'Gli obiettivi li approva il responsabile');
      out.approved = Boolean(b.approved);
    }
    return out;
  }
  app.post('/api/pm/objectives', async (req, res) => {
    const userId = req.body?.user_id ? v.int(req.body.user_id, 'persona', { min: 1 }) : req.user.id;
    const r = await rights(req, userId);
    if (!canEditObjectives(r)) throw new HttpError(403, 'Non puoi aggiungere obiettivi a questa persona');
    const { position, ...row } = { objective: 'Nuovo obiettivo', ...cleanObjective(req.body || {}, r) };
    const { rows: [m] } = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM pm_objectives WHERE user_id = $1 AND year = $2', [userId, YEAR]);
    const keys = Object.keys(row);
    const { rows: [created] } = await db.query(
      `INSERT INTO pm_objectives (user_id, year, position, ${keys.join(', ')}) VALUES ($1, $2, $3, ${keys.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING *`,
      [userId, YEAR, position ?? m.n, ...keys.map(k => row[k])]);
    res.status(201).json(created);
  });
  app.patch('/api/pm/objectives/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [o] } = await db.query('SELECT user_id FROM pm_objectives WHERE id = $1', [id]);
    if (!o) throw new HttpError(404, 'Obiettivo non trovato');
    const r = await rights(req, o.user_id);
    if (!canEditObjectives(r)) throw new HttpError(403, 'Non puoi modificare questo obiettivo');
    const row = cleanObjective(req.body || {}, r);
    const keys = Object.keys(row);
    if (!keys.length) throw new HttpError(400, 'Niente da salvare');
    const { rows: [updated] } = await db.query(`UPDATE pm_objectives SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map(k => row[k])]);
    res.json(updated);
  });
  app.delete('/api/pm/objectives/:id', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rows: [o] } = await db.query('SELECT user_id FROM pm_objectives WHERE id = $1', [id]);
    if (!o) return res.json({ ok: true });
    if (!canEditObjectives(await rights(req, o.user_id))) throw new HttpError(403, 'Non puoi eliminare questo obiettivo');
    await db.query('DELETE FROM pm_objectives WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── mansionario ─────────────────────────────────────────────────────────────────────────────
  // chi ha il ruolo propone una nuova versione (va in revisione)
  app.post('/api/pm/roles/:id/proposal', async (req, res) => {
    const id = v.int(req.params.id, 'ruolo', { min: 1 });
    const { rows: [mine] } = await db.query('SELECT 1 FROM pm_profiles WHERE user_id = $1 AND role_id = $2', [req.user.id, id]);
    if (!mine && !admin(req)) throw new HttpError(403, 'Puoi proporre modifiche solo al tuo ruolo');
    const proposal = cleanRole(req.body || {});
    await db.query("UPDATE pm_roles SET proposal = $2, proposed_by = $3, proposed_at = now(), status = 'review' WHERE id = $1", [id, JSON.stringify(proposal), req.user.id]);
    res.json({ ok: true });
  });

  app.use('/api/pm/admin', (req, _res, next) => next(admin(req) ? undefined : new HttpError(403, 'Riservato agli amministratori')));
  app.get('/api/pm/admin/roles', async (_req, res) => {
    await seed(db);
    const { rows } = await db.query(`SELECT r.*, COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS holders
                                       FROM pm_roles r LEFT JOIN pm_profiles pp ON pp.role_id = r.id LEFT JOIN users u ON u.id = pp.user_id
                                      -- le schede vuote ancora da compilare non sono voci del mansionario
                                      WHERE NOT (r.status = 'missing' AND r.title = '' AND r.description = '' AND r.responsibilities = '[]'::jsonb)
                                      GROUP BY r.id ORDER BY (r.status = 'review') DESC, r.title`);
    res.json(rows);
  });
  app.post('/api/pm/admin/roles', async (req, res) => {
    const row = { title: 'Nuovo ruolo', ...cleanRole(req.body || {}) };
    const keys = Object.keys(row);
    const { rows: [r] } = await db.query(`INSERT INTO pm_roles (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      keys.map(k => (Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k])));
    res.status(201).json(r);
  });
  // conferma: la versione decisa dall'admin diventa quella in vigore e va nella scheda di chi ha il ruolo
  app.post('/api/pm/admin/roles/:id/confirm', async (req, res) => {
    const id = v.int(req.params.id, 'ruolo', { min: 1 });
    const row = cleanRole(req.body || {});
    const keys = Object.keys(row);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    await db.query(`UPDATE pm_roles SET ${[...sets, "status = 'confirmed'", 'proposal = NULL', 'confirmed_by = $2', 'confirmed_at = now()'].join(', ')} WHERE id = $1`,
      [id, req.user.id, ...keys.map(k => (Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]))]);
    res.json({ ok: true });
  });
  app.delete('/api/pm/admin/roles/:id', async (req, res) => {
    await db.query('DELETE FROM pm_roles WHERE id = $1', [v.int(req.params.id, 'ruolo', { min: 1 })]);
    res.json({ ok: true });
  });
  // chi ha quale ruolo, chi è il responsabile, in che team
  app.put('/api/pm/admin/profiles/:userId', async (req, res) => {
    const userId = v.int(req.params.userId, 'persona', { min: 1 });
    const b = req.body || {};
    const roleId = b.role_id === null || b.role_id === '' ? null : v.int(b.role_id, 'ruolo', { min: 1 });
    const managerId = b.manager_id === null || b.manager_id === '' ? null : v.int(b.manager_id, 'responsabile', { min: 1 });
    if (managerId === userId) throw new HttpError(400, 'Una persona non può essere responsabile di se stessa');
    const team = v.text(b.team ?? '', 'team', { max: 120 }) ?? '';
    await db.query(`INSERT INTO pm_profiles (user_id, role_id, manager_id, team) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (user_id) DO UPDATE SET role_id = $2, manager_id = $3, team = $4`, [userId, roleId, managerId, team]);
    res.json({ ok: true });
  });

  // dashboard per team: chi ha un profilo o degli obiettivi, con il raggiungimento pesato
  app.get('/api/pm/admin/team', async (_req, res) => {
    await seed(db);
    const { rows: people } = await db.query(
      `SELECT u.id, u.name, pp.team, pp.manager_id, r.title AS role, rv.status AS review_status, rv.self_scores, rv.manager_scores,
              COALESCE((SELECT json_agg(json_build_object('weight', o.weight, 'achievement', o.achievement, 'approved', o.approved, 'source', o.source, 'hk_kpi_id', o.hk_kpi_id))
                          FROM pm_objectives o WHERE o.user_id = u.id AND o.year = $1), '[]') AS objectives
         FROM users u LEFT JOIN pm_profiles pp ON pp.user_id = u.id LEFT JOIN pm_roles r ON r.id = pp.role_id
         LEFT JOIN pm_reviews rv ON rv.user_id = u.id AND rv.year = $1
        WHERE pp.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM pm_objectives o WHERE o.user_id = u.id AND o.year = $1)
        ORDER BY pp.team NULLS LAST, u.name`, [YEAR]);
    res.json({ year: YEAR, people, soft_skills: SOFT_SKILLS });
  });
}

module.exports = { registerPerformance, SOFT_SKILLS };
