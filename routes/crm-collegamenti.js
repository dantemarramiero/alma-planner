// Collegamenti con il ruolo (canvas v9 «Collegamenti», Dante 19/11/2026): a una gara/opportunità del Radar o a un progetto
// del CRM si collegano aziende e persone di qualsiasi tipo (lead, clienti, fornitori, partner, concorrenti, contatti)
// con il loro ruolo. Il collegamento si vede anche dall'altra parte, nella scheda dell'azienda o del contatto.
const { HttpError, v } = require('../lib/http');

const LINK_ROLES = {
  ente: 'Ente appaltante', rup: 'RUP', dl: 'Direttore lavori', progettista: 'Progettista', ati: 'Partner ATI',
  subappalto: 'Subappaltatore', fornitore: 'Fornitore', concorrente: 'Concorrente', referente: 'Nostro referente', altro: 'Altro',
};

function registerCrmCollegamenti(app, { db }) {
  const target = q => {
    if (q.project) return { table: 'crm_project_links', col: 'project_id', id: v.int(q.project, 'progetto', { min: 1 }) };
    if (q.signal) return { table: 'crm_signal_links', col: 'signal_id', id: v.int(q.signal, 'opportunità', { min: 1 }) };
    throw new HttpError(400, 'Serve un progetto o un\'opportunità');
  };
  const who = b => {
    if (b.subject_id) return { col: 'subject_id', id: v.int(b.subject_id, 'azienda', { min: 1 }) };
    if (b.contact_id) return { col: 'contact_id', id: v.int(b.contact_id, 'contatto', { min: 1 }) };
    throw new HttpError(400, 'Serve un\'azienda o un contatto');
  };
  async function exists(t) {
    const tbl = t.col === 'project_id' ? 'projects' : 'crm_signals';
    const { rowCount } = await db.query(`SELECT 1 FROM ${tbl} WHERE id = $1`, [t.id]);
    if (!rowCount) throw new HttpError(404, t.col === 'project_id' ? 'Progetto non trovato' : 'Opportunità non trovata');
  }
  async function list(t) {
    const { rows } = await db.query(
      `SELECT l.subject_id, l.contact_id, l.role, s.name AS subject_name, s.roles, s.city,
              trim(concat_ws(' ', c.title, c.first_name, c.last_name)) AS contact_name, c.email, c.mobile,
              (SELECT cs.name FROM crm_contact_links cl JOIN crm_subjects cs ON cs.id = cl.subject_id WHERE cl.contact_id = c.id AND cl.date_to IS NULL ORDER BY cl.is_primary DESC NULLS LAST LIMIT 1) AS works_at
         FROM ${t.table} l LEFT JOIN crm_subjects s ON s.id = l.subject_id LEFT JOIN crm_contacts c ON c.id = l.contact_id
        WHERE l.${t.col} = $1 ORDER BY l.created_at`, [t.id]);
    return rows.map(r => ({ kind: r.subject_id ? 'subject' : 'contact', subject_id: r.subject_id, contact_id: r.contact_id, role: r.role, role_label: LINK_ROLES[r.role] || '',
      name: r.subject_id ? r.subject_name : r.contact_name, roles: r.roles || [], sub: r.subject_id ? [(r.roles || []).join(', '), r.city].filter(Boolean).join(' · ') : [r.works_at, r.mobile || r.email].filter(Boolean).join(' · ') }));
  }

  app.get('/api/crm/collegamenti', async (req, res) => {
    const t = target(req.query);
    res.json({ links: await list(t), roles: LINK_ROLES });
  });
  app.post('/api/crm/collegamenti', async (req, res) => {
    const b = req.body || {};
    const t = target(b);
    const w = who(b);
    const role = b.role ? v.oneOf(b.role, 'Ruolo', Object.keys(LINK_ROLES)) : '';
    await exists(t);
    await db.query(
      `INSERT INTO ${t.table} (${t.col}, ${w.col}, role, linked_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (${t.col}, ${w.col}) WHERE ${w.col} IS NOT NULL DO UPDATE SET role = EXCLUDED.role`, [t.id, w.id, role, req.user.id]);
    res.status(201).json({ links: await list(t) });
  });
  app.delete('/api/crm/collegamenti', async (req, res) => {
    const b = req.body || {};
    const t = target(b);
    const w = who(b);
    await db.query(`DELETE FROM ${t.table} WHERE ${t.col} = $1 AND ${w.col} = $2`, [t.id, w.id]);
    res.json({ links: await list(t) });
  });

  // Dall'altra parte: a quali gare, opportunità e progetti è collegata un'azienda o un contatto, e con che ruolo
  const linkedTo = col => async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const [{ rows: projects }, { rows: signals }] = await Promise.all([
      db.query(`SELECT p.id, p.name, p.crm_kind, p.status, l.role FROM crm_project_links l JOIN projects p ON p.id = l.project_id WHERE l.${col} = $1 ORDER BY p.created_at DESC`, [id]),
      db.query(`SELECT g.id, g.title, g.entity, g.amount, g.project_id, g.status, l.role FROM crm_signal_links l JOIN crm_signals g ON g.id = l.signal_id WHERE l.${col} = $1 ORDER BY g.created_at DESC`, [id]),
    ]);
    res.json({
      items: [
        ...projects.map(p => ({ type: 'project', id: p.id, title: p.name, crm: Boolean(p.crm_kind), status: p.status, role: p.role, role_label: LINK_ROLES[p.role] || '' })),
        ...signals.filter(g => !projects.some(p => p.id === g.project_id)).map(g => ({ type: 'signal', id: g.id, title: g.title, entity: g.entity, amount: g.amount != null ? Number(g.amount) : null,
          project_id: g.project_id, status: g.status, role: g.role, role_label: LINK_ROLES[g.role] || '' })),
      ],
    });
  };
  app.get('/api/crm/subjects/:id/collegata', linkedTo('subject_id'));
  app.get('/api/crm/contacts/:id/collegata', linkedTo('contact_id'));
}

module.exports = { registerCrmCollegamenti, LINK_ROLES };
