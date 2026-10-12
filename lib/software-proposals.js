// Proposte di software per ruolo e accesso al censimento.
// Il censimento lo vedono gli amministratori e il team IT (le persone del reparto Microsoft scritto in
// software_settings.it_department). Quando l'organigramma porta una persona nuova il cui ruolo o reparto ha un
// pacchetto, nasce una proposta con le licenze che ancora non ha, e il team IT riceve una notifica.

async function itDepartment(db) {
  const { rows: [r] } = await db.query("SELECT value FROM software_settings WHERE key = 'it_department'");
  return r?.value || null;
}

// Account di Alma Planet del team IT (collegati all'organigramma per oid o email).
async function itUserIds(db) {
  const dept = await itDepartment(db);
  if (!dept) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT u.id FROM org_people o JOIN users u ON u.oid = o.oid OR lower(u.email) = lower(o.email)
      WHERE lower(o.department) = lower($1)`, [dept]);
  return rows.map(r => r.id);
}

function createSoftwareAccess({ db, isAdmin }) {
  // Vede e gestisce il censimento: amministratore o persona del team IT.
  async function canUse(req) {
    if (isAdmin(req)) return true;
    const dept = await itDepartment(db);
    if (!dept) return false;
    const { rows } = await db.query(
      `SELECT 1 FROM org_people o WHERE lower(o.department) = lower($3) AND (o.oid = $1 OR lower(o.email) = lower($2)) LIMIT 1`,
      [req.user.oid || '', req.user.email || '', dept]);
    return rows.length > 0;
  }
  return { canUse };
}

// Pacchetti che spettano a una persona (ruolo o reparto, maiuscole a parte).
async function packagesFor(q, person) {
  const { rows } = await q.query(
    `SELECT k.id, k.name FROM software_packages k
      WHERE ($1::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.job_titles) t WHERE lower(t) = lower($1)))
         OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.departments) d WHERE lower(d) = lower($2)))
      ORDER BY lower(k.name)`, [person.job_title || null, person.department || null]);
  return rows;
}

// Crea le proposte per le persone indicate (oid dell'organigramma) e avvisa il team IT.
// Restituisce quante proposte sono nate. Una per persona e pacchetto: non si ripropone ciò che c'è già.
async function proposeFor(db, notifier, oids, { actorId = null } = {}) {
  if (!oids.length) return 0;
  const created = [];
  await db.tx(async q => {
    const { rows: people } = await q.query('SELECT oid, name, email, job_title, department FROM org_people WHERE oid = ANY($1::text[])', [oids]);
    for (const p of people) {
      for (const k of await packagesFor(q, p)) {
        // licenze del pacchetto che la persona non ha ancora
        const { rows: plans } = await q.query(
          `SELECT pp.plan_id FROM software_package_plans pp
            WHERE pp.package_id = $1
              AND NOT EXISTS (SELECT 1 FROM software_assignments a WHERE a.plan_id = pp.plan_id AND a.person_oid = $2)`, [k.id, p.oid]);
        if (!plans.length) continue;
        const { rows: [prop] } = await q.query(
          `INSERT INTO software_proposals (person_oid, person_name, person_email, job_title, department, package_id, package_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (person_oid, package_id) DO NOTHING RETURNING id`,
          [p.oid, p.name, p.email || '', p.job_title, p.department, k.id, k.name]);
        if (!prop) continue;
        for (const pl of plans) await q.query('INSERT INTO software_proposal_items (proposal_id, plan_id) VALUES ($1, $2)', [prop.id, pl.plan_id]);
        created.push(prop.id);
      }
    }
  });
  if (created.length && notifier) {
    const it = await itUserIds(db);
    for (const id of created) {
      await notifier.notify({ userIds: it, actorId, kind: 'software_proposal', softwareProposalId: id });
    }
  }
  return created.length;
}

module.exports = { createSoftwareAccess, proposeFor, itUserIds, itDepartment, packagesFor };
