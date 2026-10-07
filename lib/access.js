// Chi vede cosa nei progetti.
// - Un progetto lo vedono il responsabile (owner), i membri (project_members) e gli amministratori.
// - Lo gestiscono (modifica, membri, cancellazione) il responsabile e gli amministratori.
// - Un ticket in un progetto lo vede chi vede il progetto, più chi ne è assegnatario; i ticket senza progetto sono di tutti.
// I frammenti SQL prendono l'alias della tabella e il segnaposto dell'utente ($n): vanno messi dentro un WHERE.
const { HttpError } = require('./http');

const projectVisibleSql = (p, me) =>
  `(${p}.owner_id = ${me} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ${p}.id AND pm.user_id = ${me}))`;

const ticketVisibleSql = (t, me) =>
  `(${t}.project_id IS NULL
    OR EXISTS (SELECT 1 FROM projects px WHERE px.id = ${t}.project_id AND ${projectVisibleSql('px', me)})
    OR EXISTS (SELECT 1 FROM ticket_assignees ax WHERE ax.ticket_id = ${t}.id AND ax.user_id = ${me}))`;

function createAccess({ db, isAdmin }) {
  const admin = req => Boolean(isAdmin?.(req));

  // Frammenti pronti per una query: con un amministratore non filtrano niente.
  const projectFilter = (req, alias, me) => (admin(req) ? 'TRUE' : projectVisibleSql(alias, me));
  const ticketFilter = (req, alias, me) => (admin(req) ? 'TRUE' : ticketVisibleSql(alias, me));

  async function projectRole(req, projectId) {
    const { rows } = await db.query(
      `SELECT p.owner_id, EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2) AS member
         FROM projects p WHERE p.id = $1`, [projectId, req.user.id]);
    const r = rows[0];
    if (!r) return null;
    if (r.owner_id === req.user.id) return 'owner';
    if (admin(req)) return 'admin';
    return r.member ? 'member' : null;
  }

  // 404 anche quando il progetto esiste ma non è tuo: non si rivela che c'è.
  async function assertProject(req, projectId) {
    const role = await projectRole(req, projectId);
    if (!role) throw new HttpError(404, 'Progetto non trovato');
    return role;
  }

  async function assertManage(req, projectId) {
    const role = await assertProject(req, projectId);
    if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Solo il responsabile del progetto o un amministratore può farlo');
    return role;
  }

  async function assertTicket(req, ticketId) {
    // per un amministratore il filtro è TRUE e non usa $2: il parametro va passato solo se serve
    const { rows } = admin(req)
      ? await db.query('SELECT t.id FROM tickets t WHERE t.id = $1', [ticketId])
      : await db.query(`SELECT t.id FROM tickets t WHERE t.id = $1 AND ${ticketVisibleSql('t', '$2')}`, [ticketId, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Ticket non trovato');
  }

  // Chi viene assegnato a un ticket di un progetto entra nel progetto.
  async function addMembers(q, projectId, userIds, addedBy) {
    for (const uid of userIds) {
      await q.query(
        `INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`, [projectId, uid, addedBy]);
    }
  }

  return { projectFilter, ticketFilter, projectRole, assertProject, assertManage, assertTicket, addMembers, isAdmin: admin };
}

module.exports = { createAccess, projectVisibleSql, ticketVisibleSql };
