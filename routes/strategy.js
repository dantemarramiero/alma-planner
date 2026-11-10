// Alma Strategy: Hoshin Kanri. Un GET dà tutto l'anno (per la X-Matrix e la Gestione); le modifiche sono campo per campo
// (PATCH), con righe nuove (POST) ed eliminazioni (DELETE). Per ora chi è entrato in Alma Planet vede e modifica;
// i permessi per ruolo (admin, owner, sponsor) arrivano con ALM2-37.
const { HttpError, v } = require('../lib/http');
const { seedStrategy } = require('../lib/strategy-seed');
const { ensureProject, ticketForNewTask, taskToTicket, matchUser } = require('../lib/strategy-sync');
const { graph } = require('../lib/graph');
const { buildInviteEmail } = require('../lib/a3-mail');

const MAX_TEXT = 4000;
const text = max => (val, field) => v.text(val ?? '', field, { max }) ?? '';
const color = (val, field) => { if (typeof val !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(val)) throw new HttpError(400, `Il colore «${field}» non è valido`); return val; };
const int = opts => (val, field) => v.int(val, field, opts);
const date = (val, field) => (val === null || val === '' ? null : v.date(val, field));
const json = check => (val, field) => { if (!check(val)) throw new HttpError(400, `Il campo «${field}» non è valido`); return JSON.stringify(val); };
const isMonthly = x => Array.isArray(x) && x.length <= 12 && x.every(s => s === null || (typeof s === 'string' && s.length <= 30));
const isIds = x => Array.isArray(x) && x.length <= 40 && x.every(n => Number.isInteger(n) && n > 0);
const isCauses = x => x && typeof x === 'object' && !Array.isArray(x)
  && Object.entries(x).every(([k, list]) => k.length <= 40 && Array.isArray(list) && list.length <= 30 && list.every(s => typeof s === 'string' && s.length <= 300));

// Per ogni tabella: i campi modificabili con il loro controllo, e come si lega all'anno.
const ENTITIES = {
  pillars: { table: 'hk_pillars', fields: { name: text(200), description: text(500), color, position: int({ min: 0 }) }, defaults: { name: 'Nuovo pillar', color: '#8A8A8A' } },
  functions: { table: 'hk_functions', fields: { name: text(120), sponsor: text(120), color, kind: (x, f) => { if (!['staff', 'bu'].includes(x)) throw new HttpError(400, `Il valore di «${f}» non è valido`); return x; }, position: int({ min: 0 }) }, defaults: { name: 'Nuova funzione', kind: 'staff' } },
  areas: { table: 'hk_areas', fields: { name: text(120), sponsor: text(120), function_id: int({ min: 1 }), position: int({ min: 0 }) }, defaults: { name: 'Nuova area' }, needs: ['function_id'] },
  kpis: { table: 'hk_kpis', fields: { letter: text(4), name: text(300), owner: text(120), target: text(120), pillar_id: int({ min: 1, nullable: true }), monthly: json(isMonthly), position: int({ min: 0 }) }, defaults: { name: 'Nuovo KPI', target: 'da definire' } },
  projects: {
    table: 'hk_projects',
    fields: {
      name: text(300), owner: text(120), team: text(500), target: text(300), status: text(40), start_year: int({ min: 2000, max: 2100, nullable: true }), tags: text(300),
      area_id: int({ min: 1, nullable: true }), kpi_ids: json(isIds), background: text(MAX_TEXT), current_conditions: text(MAX_TEXT), target_conditions: text(MAX_TEXT),
      effect: text(500), causes: json(isCauses), follow_up_quality: text(MAX_TEXT), position: int({ min: 0 }),
    },
    defaults: { name: 'Nuovo progetto' },
  },
  tasks: { table: 'hk_tasks', fields: { area: text(200), activity: text(1000), weight: int({ min: 0, max: 100 }), owner: text(120), start_date: date, due_date: date, closed_date: date, position: int({ min: 0 }) }, defaults: { activity: 'Nuova contromisura' }, needs: ['project_id'], noYear: true },
};

function entity(name) {
  const e = ENTITIES[name];
  if (!e) throw new HttpError(404, 'Elemento non trovato');
  return e;
}
function clean(e, body) {
  const out = {};
  for (const [k, check] of Object.entries(e.fields)) if (body[k] !== undefined) out[k] = check(body[k], k);
  return out;
}

function registerStrategy(app, { db, isAdmin, auth, baseUrl, notifier }) {
  // Permessi (ALM2-37): gli amministratori modificano tutto; un A3 lo modifica chi è nel suo progetto di Alma Planner
  // (responsabile o membro) o, se non è ancora collegato, il suo proprietario; tutti gli altri vedono in sola lettura.
  const admin = req => Boolean(isAdmin?.(req));
  async function myProjects(req) {
    const { rows } = await db.query(
      'SELECT id FROM projects WHERE owner_id = $1 UNION SELECT project_id FROM project_members WHERE user_id = $1', [req.user.id]);
    return new Set(rows.map(r => r.id));
  }
  async function ownsByName(req, ownerText) {
    const { rows: users } = await db.query("SELECT id, name FROM users WHERE name <> ''");
    return matchUser(users, ownerText) === req.user.id;
  }
  async function canEditA3(req, hkId) {
    if (admin(req)) return true;
    const { rows: [p] } = await db.query('SELECT project_id, owner FROM hk_projects WHERE id = $1', [hkId]);
    if (!p) return false;
    if (p.project_id) return (await myProjects(req)).has(p.project_id);
    return ownsByName(req, p.owner);
  }
  const mustAdmin = req => { if (!admin(req)) throw new HttpError(403, 'Solo gli amministratori modificano la struttura dell’Hoshin Kanri'); };
  const mustEditA3 = async (req, hkId) => { if (!await canEditA3(req, hkId)) throw new HttpError(403, 'Questo A3 lo modificano il suo team e gli amministratori'); };
  async function guard(req, entityName, id, body = {}) {
    if (entityName === 'tasks') {
      const hk = id ? (await db.query('SELECT project_id FROM hk_tasks WHERE id = $1', [id])).rows[0]?.project_id : v.int(body.project_id, 'A3', { min: 1 });
      if (!hk) throw new HttpError(404, 'Contromisura non trovata');
      return mustEditA3(req, hk);
    }
    if (entityName === 'projects' && id && req.method === 'PATCH') return mustEditA3(req, id);
    return mustAdmin(req);
  }

  const yearOf = req => v.int(req.query.year ?? req.body?.year ?? 2026, 'anno', { min: 2000, max: 2100 });

  const FIRST_YEAR = 2026; // l'anno caricato dal file Excel; gli altri si creano partendo dall'anno prima

  // gli anni dell'Hoshin Kanri, per scorrerli
  app.get('/api/strategy/years', async (req, res) => {
    await seedStrategy(db, FIRST_YEAR);
    const { rows } = await db.query(
      `SELECT y.year, (SELECT COUNT(*)::int FROM hk_projects p WHERE p.year = y.year) AS projects,
              (SELECT COUNT(*)::int FROM hk_projects p WHERE p.year = y.year AND p.carry IS NULL AND p.status <> 'concluso') AS undecided
         FROM hk_years y ORDER BY y.year`);
    res.json({ years: rows, can_admin: admin(req) });
  });

  // nuovo anno: True North, pillar, BU e funzioni con le aree, KPI (senza i valori mensili) copiati dall'anno prima.
  // Gli A3 non si copiano: ognuno, a fine anno, decide se chiudersi, proseguire fuori o entrare nel nuovo anno.
  app.post('/api/strategy/years', async (req, res) => {
    mustAdmin(req);
    const year = v.int(req.body?.year, 'anno', { min: 2000, max: 2100 });
    const from = v.int(req.body?.from ?? year - 1, 'anno di partenza', { min: 2000, max: 2100 });
    await db.tx(async q => {
      const { rows: [exists] } = await q.query('SELECT 1 FROM hk_years WHERE year = $1', [year]);
      if (exists) throw new HttpError(409, `L'Hoshin Kanri ${year} c'è già`);
      const { rows: [src] } = await q.query('SELECT * FROM hk_years WHERE year = $1', [from]);
      if (!src) throw new HttpError(404, `Non c'è l'Hoshin Kanri ${from} da cui partire`);
      await q.query('INSERT INTO hk_years (year, true_north) VALUES ($1, $2)', [year, src.true_north]);
      const pmap = {}, fmap = {};
      for (const r of (await q.query('SELECT * FROM hk_pillars WHERE year = $1 ORDER BY position, id', [from])).rows) {
        pmap[r.id] = (await q.query('INSERT INTO hk_pillars (year, position, name, description, color) VALUES ($1,$2,$3,$4,$5) RETURNING id', [year, r.position, r.name, r.description, r.color])).rows[0].id;
      }
      for (const r of (await q.query('SELECT * FROM hk_functions WHERE year = $1 ORDER BY position, id', [from])).rows) {
        fmap[r.id] = (await q.query('INSERT INTO hk_functions (year, position, name, sponsor, color, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [year, r.position, r.name, r.sponsor, r.color, r.kind])).rows[0].id;
      }
      for (const r of (await q.query('SELECT * FROM hk_areas WHERE year = $1 ORDER BY position, id', [from])).rows) {
        await q.query('INSERT INTO hk_areas (year, position, name, sponsor, function_id) VALUES ($1,$2,$3,$4,$5)', [year, r.position, r.name, r.sponsor, fmap[r.function_id] || null]);
      }
      const { rows: kcols } = await q.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'hk_kpis'");
      const skip = new Set(['id', 'year', 'pillar_id', 'monthly']);
      const cols = kcols.map(c => c.column_name).filter(c => !skip.has(c));
      for (const r of (await q.query('SELECT * FROM hk_kpis WHERE year = $1 ORDER BY position, id', [from])).rows) {
        const names = ['year', 'pillar_id', ...cols];
        const vals = [year, pmap[r.pillar_id] || null, ...cols.map(c => (r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]))];
        await q.query(`INSERT INTO hk_kpis (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
      }
    });
    res.status(201).json({ year });
  });

  // fine anno: l'A3 si chiude, prosegue fuori dall'Hoshin Kanri dell'anno dopo, oppure entra nell'anno dopo
  // (copia collegata: stesso progetto, contromisure con gli stessi ticket, quindi tutto resta allineato)
  app.post('/api/strategy/projects/:id/carry', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    await mustEditA3(req, id);
    const decision = req.body?.decision;
    if (!['chiuso', 'fuori', 'inserito', 'annulla'].includes(decision)) throw new HttpError(400, 'Scegli: chiudere, proseguire fuori o inserire nell’anno dopo');
    const out = await db.tx(async q => {
      const { rows: [a] } = await q.query('SELECT * FROM hk_projects WHERE id = $1 FOR UPDATE', [id]);
      if (!a) throw new HttpError(404, 'A3 non trovato');
      if (a.carry === 'inserito' && decision !== 'inserito') throw new HttpError(409, 'Questo A3 è già nell’Hoshin Kanri dell’anno dopo: lo si gestisce da lì');
      if (decision === 'annulla') {
        await q.query('UPDATE hk_projects SET carry = NULL, carry_decided_by = NULL, carry_decided_at = NULL, status = CASE WHEN carry = \'chiuso\' THEN \'attivo\' ELSE status END WHERE id = $1', [id]);
        return { carry: null };
      }
      if (decision === 'chiuso') {
        await q.query("UPDATE hk_projects SET carry = 'chiuso', status = 'concluso', carry_decided_by = $2, carry_decided_at = now() WHERE id = $1", [id, req.user.id]);
        return { carry: 'chiuso' };
      }
      if (decision === 'fuori') {
        await q.query("UPDATE hk_projects SET carry = 'fuori', carry_decided_by = $2, carry_decided_at = now() WHERE id = $1", [id, req.user.id]);
        return { carry: 'fuori' };
      }
      if (a.carry === 'inserito') {
        const { rows: [c] } = await q.query('SELECT id FROM hk_projects WHERE carried_from = $1', [id]);
        return { carry: 'inserito', next_id: c?.id || null };
      }
      const next = a.year + 1;
      const { rows: [ny] } = await q.query('SELECT 1 FROM hk_years WHERE year = $1', [next]);
      if (!ny) throw new HttpError(409, `L'Hoshin Kanri ${next} non c'è ancora: lo crea un amministratore, poi lo inserisci`);
      // stessa funzione e stessa area per nome; i KPI per lettera
      const { rows: [old] } = await q.query('SELECT a.name AS area, f.name AS func FROM hk_areas a LEFT JOIN hk_functions f ON f.id = a.function_id WHERE a.id = $1', [a.area_id]);
      const { rows: [area] } = await q.query(
        `SELECT a.id FROM hk_areas a JOIN hk_functions f ON f.id = a.function_id WHERE a.year = $1 AND f.name = $2
          ORDER BY (a.name = $3) DESC, a.position LIMIT 1`, [next, old?.func || '', old?.area || '']);
      const oldKpis = Array.isArray(a.kpi_ids) && a.kpi_ids.length ? (await q.query('SELECT letter FROM hk_kpis WHERE id = ANY($1::int[])', [a.kpi_ids])).rows.map(r => r.letter) : [];
      const kpiIds = oldKpis.length ? (await q.query('SELECT id FROM hk_kpis WHERE year = $1 AND letter = ANY($2::text[]) ORDER BY position', [next, oldKpis])).rows.map(r => r.id) : [];
      const { rows: pcols } = await q.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'hk_projects'");
      const skip = new Set(['id', 'year', 'area_id', 'kpi_ids', 'carry', 'carried_from', 'carry_decided_by', 'carry_decided_at', 'position']);
      const cols = pcols.map(c => c.column_name).filter(c => !skip.has(c));
      const names = ['year', 'area_id', 'kpi_ids', 'carried_from', 'position', ...cols];
      const { rows: [pos] } = await q.query('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM hk_projects WHERE year = $1', [next]);
      const vals = [next, area?.id || null, JSON.stringify(kpiIds), id, pos.n, ...cols.map(c => (a[c] !== null && typeof a[c] === 'object' && !(a[c] instanceof Date) ? JSON.stringify(a[c]) : a[c]))];
      const { rows: [copy] } = await q.query(`INSERT INTO hk_projects (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
      const { rows: tcols } = await q.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'hk_tasks'");
      const tc = tcols.map(c => c.column_name).filter(c => c !== 'id' && c !== 'project_id');
      for (const t of (await q.query('SELECT * FROM hk_tasks WHERE project_id = $1 ORDER BY position, id', [id])).rows) {
        await q.query(`INSERT INTO hk_tasks (project_id, ${tc.join(', ')}) VALUES ($1, ${tc.map((_, i) => `$${i + 2}`).join(', ')})`, [copy.id, ...tc.map(c => t[c])]);
      }
      await q.query("UPDATE hk_projects SET carry = 'inserito', carry_decided_by = $2, carry_decided_at = now() WHERE id = $1", [id, req.user.id]);
      return { carry: 'inserito', next_id: copy.id, area_found: Boolean(area) };
    });
    res.json(out);
  });

  app.get('/api/strategy', async (req, res) => {
    const year = yearOf(req);
    if (year === FIRST_YEAR) await seedStrategy(db, FIRST_YEAR);
    const { rows: [has] } = await db.query('SELECT 1 FROM hk_years WHERE year = $1', [year]);
    if (!has) throw new HttpError(404, `L'Hoshin Kanri ${year} non c'è ancora`);
    const q = (sql, params = [year]) => db.query(sql, params).then(r => r.rows);
    const [[y], pillars, functions, areas, kpis, projects, tasks] = await Promise.all([
      q('SELECT year, true_north FROM hk_years WHERE year = $1'),
      q('SELECT * FROM hk_pillars WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_functions WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_areas WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_kpis WHERE year = $1 ORDER BY position, id'),
      q('SELECT p.*, (SELECT c.id FROM hk_projects c WHERE c.carried_from = p.id LIMIT 1) AS next_id, (SELECT o.year FROM hk_projects o WHERE o.id = p.carried_from) AS from_year FROM hk_projects p WHERE p.year = $1 ORDER BY p.position, p.id'),
      q('SELECT t.* FROM hk_tasks t JOIN hk_projects p ON p.id = t.project_id WHERE p.year = $1 ORDER BY t.position, t.id'),
    ]);
    const isAdmin = admin(req);
    const mine = isAdmin ? null : await myProjects(req);
    const { rows: users } = await db.query("SELECT id, name FROM users WHERE name <> ''");
    for (const p of projects) {
      p.tasks = tasks.filter(t => t.project_id === p.id);
      p.project_visible = Boolean(p.project_id); // ticket, Gantt e il resto li vedono tutti, in sola lettura se non ne fanno parte
      p.can_edit = isAdmin || (p.project_id ? mine.has(p.project_id) : matchUser(users, p.owner) === req.user.id);
    }
    const { rows: outside } = await db.query(
      "SELECT p.id, p.name, p.owner, p.year, p.project_id, p.status FROM hk_projects p WHERE p.year = $1 AND p.carry = 'fuori' ORDER BY p.position, p.id", [year - 1]);
    const { rows: [nextYear] } = await db.query('SELECT 1 FROM hk_years WHERE year = $1', [year + 1]);
    res.json({ year, true_north: y.true_north, pillars, functions, areas, kpis, projects, outside, next_year_exists: Boolean(nextYear),
      can_admin: isAdmin, today: new Date().toISOString().slice(0, 10) });
  });

  // collega l'A3 al suo progetto di Alma Planner (lo crea la prima volta, con un ticket per contromisura)
  app.post('/api/strategy/projects/:id/link', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    await mustEditA3(req, id); // il progetto lo crea chi può lavorare sull'A3
    const projectId = await ensureProject(db, id, req.user.id);
    if (!projectId) throw new HttpError(404, 'A3 non trovato');
    res.json({ project_id: projectId });
  });

  // ── inviti all'A3 ──
  // Chi lavora sull'A3 invita colleghi: entrano nel team del progetto e ricevono (dalla casella di chi invita) una email
  // allegra con la «stampa» dell'A3 e la nota di chi invita. Senza Microsoft l'invito vale lo stesso, senza email.
  // l'A3 com'è adesso, con funzione, area e KPI: serve alla email di invito
  async function inviteContext(id, inviterId) {
    const { rows: [a3] } = await db.query('SELECT * FROM hk_projects WHERE id = $1', [id]);
    if (!a3) throw new HttpError(404, 'A3 non trovato');
    a3.tasks = (await db.query('SELECT * FROM hk_tasks WHERE project_id = $1 ORDER BY position, id', [id])).rows;
    const { rows: [area] } = await db.query('SELECT * FROM hk_areas WHERE id = $1', [a3.area_id]);
    const func = area ? (await db.query('SELECT * FROM hk_functions WHERE id = $1', [area.function_id])).rows[0] : null;
    const kpiIds = Array.isArray(a3.kpi_ids) ? a3.kpi_ids : [];
    const kpis = kpiIds.length ? (await db.query('SELECT letter, name FROM hk_kpis WHERE id = ANY($1::int[]) ORDER BY position', [kpiIds])).rows : [];
    const { rows: [inviter] } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [inviterId]);
    return { a3, area, func, kpis, inviter, link: `${baseUrl || ''}/app#/strategy/a3/${id}`, today: new Date().toISOString().slice(0, 10) };
  }
  // anteprima della email, per vederla prima di mandarla
  app.post('/api/strategy/projects/:id/invite/preview', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    await mustEditA3(req, id);
    const ctx = await inviteContext(id, req.user.id);
    const uid = req.body?.user_id ? v.int(req.body.user_id, 'persona', { min: 1 }) : null; // anteprima anche senza aver scelto nessuno
    const invitee = uid ? (await db.query('SELECT id, name FROM users WHERE id = $1', [uid])).rows[0] : null;
    const { subject, html } = buildInviteEmail(ctx.a3, { ...ctx, invitee: invitee || { name: 'collega' }, note: v.text(req.body?.note, 'nota', { max: 2000 }) || '' });
    res.json({ subject, html });
  });
  app.post('/api/strategy/projects/:id/invite', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    await mustEditA3(req, id);
    const ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(x => v.int(x, 'persona', { min: 1 })))];
    if (!ids.length || ids.length > 20) throw new HttpError(400, 'Scegli da 1 a 20 persone da invitare');
    const note = v.text(req.body?.note, 'nota', { max: 2000 }) || '';
    const projectId = await ensureProject(db, id, req.user.id);
    if (!projectId) throw new HttpError(404, 'A3 non trovato');
    const { rows: people } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1::int[])', [ids]);
    if (people.length !== ids.length) throw new HttpError(400, 'Una delle persone non esiste');
    const { rows: [proj] } = await db.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
    for (const u of people) {
      if (u.id !== proj.owner_id) await db.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [projectId, u.id, req.user.id]);
    }
    const { a3, area, func, kpis, inviter, link, today } = await inviteContext(id, req.user.id);
    let token = null;
    try { token = auth ? await auth.graphToken(req.user.id) : null; } catch { token = null; }
    let emailed = 0;
    for (const u of people) {
      let sent = false;
      if (token && u.email && u.id !== req.user.id) {
        const { subject, html } = buildInviteEmail(a3, { inviter, invitee: u, note, link, func, area, kpis, today });
        try {
          await graph(token, 'POST', '/me/sendMail', { body: { message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: u.email, name: u.name } }] }, saveToSentItems: true } });
          sent = true; emailed++;
        } catch (err) { console.warn(`[invito A3 ${id}] → ${u.email}: email non inviata (${err.message})`); }
      }
      await db.query('INSERT INTO hk_invites (hk_project_id, user_id, invited_by, note, emailed) VALUES ($1, $2, $3, $4, $5)', [id, u.id, req.user.id, note, sent]);
    }
    await notifier?.notify({ userIds: people.map(u => u.id).filter(x => x !== req.user.id), actorId: req.user.id, kind: 'strategy',
      body: `ti ha invitato nell'A3 «${a3.name}»`, link: `/strategy/a3/${id}` }).catch(() => {});
    res.json({ invited: people.length, emailed, project_id: projectId });
  });
  app.get('/api/strategy/projects/:id/invites', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    const { rows } = await db.query(
      `SELECT i.id, i.user_id, u.name, i.invited_by, b.name AS invited_by_name, i.note, i.emailed, i.created_at
         FROM hk_invites i JOIN users u ON u.id = i.user_id LEFT JOIN users b ON b.id = i.invited_by
        WHERE i.hk_project_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [id]);
    res.json(rows);
  });

  // dal progetto all'A3 (per aprire la pagina giusta da «Progetti»)
  app.get('/api/strategy/by-project/:pid', async (req, res) => {
    const pid = v.int(req.params.pid, 'progetto', { min: 1 });
    const { rows: [r] } = await db.query('SELECT id FROM hk_projects WHERE project_id = $1 ORDER BY year DESC LIMIT 1', [pid]); // l'anno più recente
    if (!r) throw new HttpError(404, 'Nessun A3 per questo progetto');
    res.json(r);
  });

  app.patch('/api/strategy/year', async (req, res) => {
    mustAdmin(req);
    const year = yearOf(req);
    const tn = v.text(req.body.true_north ?? '', 'True North', { max: 1000 }) ?? '';
    await db.query('UPDATE hk_years SET true_north = $2 WHERE year = $1', [year, tn]);
    res.json({ ok: true });
  });

  app.post('/api/strategy/:entity', async (req, res) => {
    const e = entity(req.params.entity);
    await guard(req, req.params.entity, null, req.body || {});
    const row = { ...e.defaults, ...clean(e, req.body || {}) };
    for (const k of e.needs || []) row[k] = v.int(req.body[k], k, { min: 1 });
    if (!e.noYear) row.year = yearOf(req);
    if (row.position === undefined) {
      const where = e.noYear ? 'project_id = $1' : 'year = $1';
      const { rows: [m] } = await db.query(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${e.table} WHERE ${where}`, [e.noYear ? row.project_id : row.year]);
      row.position = m.n;
    }
    const keys = Object.keys(row);
    const { rows: [created] } = await db.query(
      `INSERT INTO ${e.table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map(k => row[k]));
    if (req.params.entity === 'tasks') created.ticket_id = await ticketForNewTask(db, created, req.user.id);
    res.status(201).json(created);
  });

  app.patch('/api/strategy/:entity/:id', async (req, res) => {
    const e = entity(req.params.entity);
    const id = v.int(req.params.id, 'id', { min: 1 });
    await guard(req, req.params.entity, id);
    const row = clean(e, req.body || {});
    const keys = Object.keys(row);
    if (!keys.length) throw new HttpError(400, 'Niente da salvare');
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    if (e.table === 'hk_projects') sets.push('updated_at = now()');
    const { rows: [updated] } = await db.query(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map(k => row[k])]);
    if (!updated) throw new HttpError(404, 'Elemento non trovato');
    if (req.params.entity === 'tasks') await taskToTicket(db, updated, row);
    if (req.params.entity === 'projects' && row.name !== undefined && updated.project_id) {
      await db.query('UPDATE projects SET name = $2, updated_at = now() WHERE id = $1', [updated.project_id, (updated.name || 'A3').slice(0, 200)]);
    }
    res.json(updated);
  });

  app.delete('/api/strategy/:entity/:id', async (req, res) => {
    const e = entity(req.params.entity);
    const id = v.int(req.params.id, 'id', { min: 1 });
    await guard(req, req.params.entity, id);
    const { rows: [gone] } = await db.query(`DELETE FROM ${e.table} WHERE id = $1 RETURNING *`, [id]);
    // la contromisura tolta dall'A3 si porta via il suo ticket
    if (req.params.entity === 'tasks' && gone?.ticket_id) await db.query('DELETE FROM tickets WHERE id = $1', [gone.ticket_id]);
    res.json({ ok: true });
  });
}

module.exports = { registerStrategy };
