// Chi vede cosa nei progetti.
// - Un progetto lo vedono il responsabile (owner), i membri (project_members) e gli amministratori.
// - Lo gestiscono (modifica, membri, cancellazione) il responsabile e gli amministratori.
// - Un ticket in un progetto lo vede chi vede il progetto, più chi ne è assegnatario; i ticket senza progetto sono di tutti.
// - Una RDA interna la vedono sempre anche chi l'ha chiesta e il responsabile della funzione a cui è chiesta.
// - I progetti di Alma Energy (Impianti target, projects.energy) li vedono solo i membri del modulo: nemmeno gli
//   amministratori li vedono se non sono nella BU Energy. Lo stesso vale per i loro ticket.
// - I progetti degli A3 di Alma Strategy (projects.hk) li vedono tutti, in sola lettura (ruolo «viewer»): ticket, Gantt,
//   membri, file e riunioni si aprono, ma le modifiche restano a responsabile, membri e amministratori. Non entrano
//   nell'elenco dei progetti né nei ticket di chi non ne fa parte: si raggiungono dall'A3.
// I frammenti SQL prendono l'alias della tabella e il segnaposto dell'utente ($n): vanno messi dentro un WHERE.
const { HttpError } = require('./http');

const projectVisibleSql = (p, me) =>
  `(${p}.owner_id = ${me} OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ${p}.id AND pm.user_id = ${me}))`;

const ticketVisibleSql = (t, me) =>
  `(${t}.project_id IS NULL
    OR EXISTS (SELECT 1 FROM projects px WHERE px.id = ${t}.project_id AND ${projectVisibleSql('px', me)})
    OR EXISTS (SELECT 1 FROM ticket_assignees ax WHERE ax.ticket_id = ${t}.id AND ax.user_id = ${me})
    OR (${t}.rda_function IS NOT NULL AND (${t}.created_by = ${me}
        OR ${t}.rda_head_oid IN (SELECT ox.oid FROM users ux JOIN org_people ox ON ox.oid = ux.oid OR lower(ox.email) = lower(ux.email)
                                  WHERE ux.id = ${me}))))`;

// Membro di Alma Energy: l'id arriva dalla sessione (intero del database), quindi si può scrivere nella query senza
// segnaposto e i filtri degli amministratori restano senza parametri.
const energyMemberSql = req => `EXISTS (SELECT 1 FROM users ue JOIN energy_members em ON em.email = lower(ue.email) WHERE ue.id = ${Number(req.user.id) || 0})`;
const energyProjectOk = (req, p) => `(NOT ${p}.energy OR ${energyMemberSql(req)})`;
const energyTicketOk = (req, t) => `(${t}.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects pz WHERE pz.id = ${t}.project_id AND pz.energy) OR ${energyMemberSql(req)})`;

function createAccess({ db, isAdmin }) {
  const admin = req => Boolean(isAdmin?.(req));

  // Frammenti pronti per una query: con un amministratore filtrano solo i progetti di Alma Energy.
  const projectFilter = (req, alias, me) => (admin(req) ? energyProjectOk(req, alias) : `(${projectVisibleSql(alias, me)} AND ${energyProjectOk(req, alias)})`);
  const ticketFilter = (req, alias, me) => (admin(req) ? energyTicketOk(req, alias) : `(${ticketVisibleSql(alias, me)} AND ${energyTicketOk(req, alias)})`);

  async function projectRole(req, projectId) {
    const { rows } = await db.query(
      `SELECT p.owner_id, p.hk, EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2) AS member,
              ${energyProjectOk(req, 'p')} AS energy_ok
         FROM projects p WHERE p.id = $1`, [projectId, req.user.id]);
    const r = rows[0];
    if (!r || !r.energy_ok) return null;
    if (r.owner_id === req.user.id) return 'owner';
    if (admin(req)) return 'admin';
    if (r.member) return 'member';
    return r.hk ? 'viewer' : null;
  }
  const READ_ONLY = 'Questo progetto lo puoi solo vedere: per modificarlo chiedi al responsabile di aggiungerti';
  const reading = req => req.method === 'GET' || req.method === 'HEAD';

  // 404 anche quando il progetto esiste ma non è tuo: non si rivela che c'è.
  async function assertProject(req, projectId) {
    const role = await projectRole(req, projectId);
    if (!role) throw new HttpError(404, 'Progetto non trovato');
    if (role === 'viewer' && !reading(req)) throw new HttpError(403, READ_ONLY);
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
      ? await db.query(`SELECT t.id FROM tickets t WHERE t.id = $1 AND ${energyTicketOk(req, 't')}`, [ticketId])
      : await db.query(`SELECT t.id FROM tickets t WHERE t.id = $1 AND ${ticketVisibleSql('t', '$2')} AND ${energyTicketOk(req, 't')}`, [ticketId, req.user.id]);
    if (rows[0]) return;
    // i ticket dei progetti degli A3: si leggono, non si modificano
    const { rows: [hk] } = await db.query('SELECT 1 FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = $1 AND p.hk', [ticketId]);
    if (!hk) throw new HttpError(404, 'Ticket non trovato');
    if (!reading(req)) throw new HttpError(403, READ_ONLY);
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
