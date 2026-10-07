// Registro delle azioni, solo per gli amministratori (ADMIN_EMAILS).
const { HttpError, v } = require('../lib/http');

function registerAudit(app, { db, isAdmin }) {
  // Ultime azioni, al massimo 500; ?user= per una persona, ?before= (id) per le pagine successive.
  app.get('/api/admin/audit', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Solo gli amministratori vedono il registro');
    const userId = v.int(req.query.user, 'persona', { min: 1 });
    const before = v.int(req.query.before, 'da', { min: 1 });
    const limit = v.int(req.query.limit, 'quanti', { min: 1, max: 500 }) || 200;
    const { rows } = await db.query(
      `SELECT a.id, a.created_at, a.action, a.status, a.ip, a.user_id, u.email, u.name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ($1::int IS NULL OR a.user_id = $1) AND ($2::bigint IS NULL OR a.id < $2)
        ORDER BY a.id DESC LIMIT $3`, [userId ?? null, before ?? null, limit]);
    res.json(rows);
  });
}

module.exports = { registerAudit };
