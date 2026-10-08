// Funzioni aziendali per le RDA interne = reparti dell'organigramma Microsoft (org_people.department), senza
// un'anagrafica da tenere a mano. Il responsabile di una funzione è quello scelto da un amministratore
// (function_heads) oppure, se nessuno l'ha scelto, quello ricavato dall'organigramma: la persona a cui risponde
// la maggior parte del reparto; un reparto di una persona sola ha lei come responsabile.

async function loadFunctions(db) {
  const [people, overrides, users] = await Promise.all([
    db.query('SELECT oid, name, email, job_title, department, manager_oid FROM org_people ORDER BY name'),
    db.query('SELECT department, head_oid FROM function_heads'),
    db.query('SELECT id, oid, lower(email) AS email FROM users'),
  ]);
  const byOid = new Map(people.rows.map(p => [p.oid, p]));
  const userOf = p => users.rows.find(u => (u.oid && u.oid === p.oid) || (p.email && u.email === p.email.toLowerCase()))?.id ?? null;
  const manual = new Map(overrides.rows.map(r => [r.department, r.head_oid]));

  const depts = new Map();
  for (const p of people.rows) {
    const name = (p.department || '').trim();
    if (!name) continue;
    if (!depts.has(name)) depts.set(name, []);
    depts.get(name).push(p);
  }

  const person = p => (p ? { oid: p.oid, name: p.name, email: p.email, job_title: p.job_title, user_id: userOf(p) } : null);
  const list = [];
  for (const [name, members] of depts) {
    let headOid = manual.get(name) || null;
    const source = headOid && byOid.has(headOid) ? 'manual' : 'auto';
    if (source === 'auto') {
      if (members.length === 1) headOid = members[0].oid;
      else {
        const votes = new Map();
        for (const m of members) {
          if (m.manager_oid && m.manager_oid !== m.oid) votes.set(m.manager_oid, (votes.get(m.manager_oid) || 0) + 1);
        }
        // a parità di voti vince chi sta nel reparto
        headOid = [...votes.entries()]
          .sort((a, b) => b[1] - a[1] || Number(members.some(m => m.oid === b[0])) - Number(members.some(m => m.oid === a[0])))[0]?.[0] || null;
      }
    }
    const head = headOid ? byOid.get(headOid) : null;
    // il team a cui il responsabile può assegnare: il reparto più chi gli risponde direttamente, sé compreso
    const team = new Map(members.map(m => [m.oid, m]));
    if (head) {
      team.set(head.oid, head);
      for (const p of people.rows) if (p.manager_oid === head.oid) team.set(p.oid, p);
    }
    list.push({
      name,
      head: person(head),
      head_source: head ? source : null,
      members: members.map(person),
      team: [...team.values()].map(person).sort((a, b) => a.name.localeCompare(b.name, 'it')),
    });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

async function findFunction(db, name) {
  return (await loadFunctions(db)).find(f => f.name === name) || null;
}

// La persona dell'organigramma che corrisponde a un utente di Alma (per id Microsoft o, in mancanza, per email).
async function orgOidOf(db, userId) {
  const { rows } = await db.query(
    `SELECT o.oid FROM users u JOIN org_people o ON o.oid = u.oid OR lower(o.email) = lower(u.email)
      WHERE u.id = $1 ORDER BY (o.oid = u.oid) DESC NULLS LAST LIMIT 1`, [userId]);
  return rows[0]?.oid || null;
}

// Frammenti SQL: l'utente di Alma che corrisponde a una persona dell'organigramma, e viceversa.
const headUserSql = oidExpr => `(SELECT u.id FROM org_people o JOIN users u ON u.oid = o.oid OR lower(u.email) = lower(o.email)
   WHERE o.oid = ${oidExpr} ORDER BY (u.oid = o.oid) DESC NULLS LAST LIMIT 1)`;

module.exports = { loadFunctions, findFunction, orgOidOf, headUserSql };
