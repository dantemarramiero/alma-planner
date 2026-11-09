// Alma Strategy: Hoshin Kanri. Un GET dà tutto l'anno (per la X-Matrix e la Gestione); le modifiche sono campo per campo
// (PATCH), con righe nuove (POST) ed eliminazioni (DELETE). Per ora chi è entrato in Alma Planet vede e modifica;
// i permessi per ruolo (admin, owner, sponsor) arrivano con ALM2-37.
const { HttpError, v } = require('../lib/http');
const { seedStrategy } = require('../lib/strategy-seed');
const { ensureProject, ticketForNewTask, taskToTicket, matchUser } = require('../lib/strategy-sync');

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
  tasks: { table: 'hk_tasks', fields: { area: text(200), activity: text(1000), weight: int({ min: 0, max: 100 }), owner: text(120), due_date: date, closed_date: date, position: int({ min: 0 }) }, defaults: { activity: 'Nuova contromisura' }, needs: ['project_id'], noYear: true },
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

function registerStrategy(app, { db, isAdmin }) {
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

  app.get('/api/strategy', async (req, res) => {
    const year = yearOf(req);
    await seedStrategy(db, year);
    const q = (sql, params = [year]) => db.query(sql, params).then(r => r.rows);
    const [[y], pillars, functions, areas, kpis, projects, tasks] = await Promise.all([
      q('SELECT year, true_north FROM hk_years WHERE year = $1'),
      q('SELECT * FROM hk_pillars WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_functions WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_areas WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_kpis WHERE year = $1 ORDER BY position, id'),
      q('SELECT * FROM hk_projects WHERE year = $1 ORDER BY position, id'),
      q('SELECT t.* FROM hk_tasks t JOIN hk_projects p ON p.id = t.project_id WHERE p.year = $1 ORDER BY t.position, t.id'),
    ]);
    const isAdmin = admin(req);
    const mine = isAdmin ? null : await myProjects(req);
    const { rows: users } = await db.query("SELECT id, name FROM users WHERE name <> ''");
    for (const p of projects) {
      p.tasks = tasks.filter(t => t.project_id === p.id);
      p.project_visible = Boolean(p.project_id) && (isAdmin || mine.has(p.project_id));
      p.can_edit = isAdmin || (p.project_id ? mine.has(p.project_id) : matchUser(users, p.owner) === req.user.id);
    }
    res.json({ year, true_north: y.true_north, pillars, functions, areas, kpis, projects, can_admin: isAdmin, today: new Date().toISOString().slice(0, 10) });
  });

  // collega l'A3 al suo progetto di Alma Planner (lo crea la prima volta, con un ticket per contromisura)
  app.post('/api/strategy/projects/:id/link', async (req, res) => {
    const id = v.int(req.params.id, 'A3', { min: 1 });
    await mustEditA3(req, id); // il progetto lo crea chi può lavorare sull'A3
    const projectId = await ensureProject(db, id, req.user.id);
    if (!projectId) throw new HttpError(404, 'A3 non trovato');
    res.json({ project_id: projectId });
  });

  // dal progetto all'A3 (per aprire la pagina giusta da «Progetti»)
  app.get('/api/strategy/by-project/:pid', async (req, res) => {
    const pid = v.int(req.params.pid, 'progetto', { min: 1 });
    const { rows: [r] } = await db.query('SELECT id FROM hk_projects WHERE project_id = $1', [pid]);
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
