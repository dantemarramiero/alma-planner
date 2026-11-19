// Organigramma letto da Microsoft 365: persone del tenant con ruolo, reparto, sede e responsabile diretto.
// La lettura da Graph (permesso delegato User.Read.All) si fa con «Aggiorna da Microsoft», da Impostazioni →
// Organigramma e ogni notte alle 3 (routes/impostazioni.js); si salva in org_people, così la pagina si apre subito e
// funziona anche se Graph è lento.
const { HttpError } = require('../lib/http');
const { graphAll } = require('../lib/graph');
const { proposeFor } = require('../lib/software-proposals');

const SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,accountEnabled,userType';

// Solo persone: account attivi, membri del tenant (non ospiti), con una casella di posta.
function isPerson(u) {
  return u.accountEnabled !== false && u.userType !== 'Guest' && Boolean(u.mail);
}

// Legge l'organigramma con il token Microsoft di actorId e lo salva (chi non c'è più esce). Poi ricarica i ruoli.
async function syncOrg({ db, auth, notifier, gov, actorId }) {
  const token = await auth.graphToken(actorId);
  let list;
  try {
    list = await graphAll(token, `/users?$select=${SELECT}&$expand=manager($select=id)&$top=999`, { max: 20000 });
  } catch (err) {
    if (err.status === 403) {
      throw new HttpError(403, 'Microsoft non concede la lettura dell\'organigramma: serve il permesso User.Read.All con consenso amministratore', 'org_permission');
    }
    throw err;
  }
  const people = list.filter(isPerson);
  const ids = new Set(people.map(u => u.id));
  // persone nuove: a chi ha un pacchetto per il suo ruolo nasce una proposta di software per il team IT
  // (al primo aggiornamento, con l'organigramma vuoto, nessuno è «nuovo»)
  const before = new Set((await db.query('SELECT oid FROM org_people')).rows.map(r => r.oid));
  const fresh = before.size ? [...ids].filter(id => !before.has(id)) : [];
  const withManager = people.filter(u => u.manager?.id && ids.has(u.manager.id)).length;
  await db.tx(async q => {
    for (const u of people) {
      const manager = u.manager?.id && ids.has(u.manager.id) ? u.manager.id : null;
      await q.query(
        `INSERT INTO org_people (oid, name, email, job_title, department, office, manager_oid, synced_at)
         VALUES ($1, $2, lower($3), $4, $5, $6, $7, now())
         ON CONFLICT (oid) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, job_title = EXCLUDED.job_title,
                department = EXCLUDED.department, office = EXCLUDED.office, manager_oid = EXCLUDED.manager_oid, synced_at = now()`,
        [u.id, u.displayName || u.mail, u.mail, u.jobTitle || null, u.department || null, u.officeLocation || null, manager]);
    }
    // chi non c'è più (uscito, disattivato) esce dall'organigramma
    await q.query('DELETE FROM org_people WHERE NOT (oid = ANY($1::text[]))', [[...ids]]);
    await q.query(
      `INSERT INTO org_sync (id, synced_at, synced_by, people, with_manager) VALUES (1, now(), $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET synced_at = now(), synced_by = $1, people = $2, with_manager = $3`,
      [actorId, people.length, withManager]);
  });
  const proposals = await proposeFor(db, notifier, fresh, { actorId });
  await gov?.reload(); // i ruoli che dipendono da qualifica, reparto e responsabile
  return { people: people.length, with_manager: withManager, new_people: fresh.length, proposals };
}

function registerOrg(app, { db, auth, notifier, gov }) {
  app.get('/api/org', async (_req, res) => {
    const [people, sync] = await Promise.all([
      db.query(
        `SELECT o.oid, o.name, o.email, o.job_title, o.department, o.office, o.manager_oid,
                u.id AS user_id,
                (SELECT COUNT(*)::int FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id
                  WHERE a.user_id = u.id AND t.status <> 'done') AS open_tickets
           FROM org_people o
           LEFT JOIN LATERAL (
             SELECT x.id FROM users x WHERE x.oid = o.oid OR lower(x.email) = lower(o.email)
              ORDER BY (x.oid = o.oid) DESC NULLS LAST LIMIT 1
           ) u ON true
          ORDER BY o.name`),
      db.query('SELECT s.*, u.name AS synced_by_name FROM org_sync s LEFT JOIN users u ON u.id = s.synced_by'),
    ]);
    res.json({ people: people.rows, sync: sync.rows[0] || null });
  });

  app.post('/api/org/sync', async (req, res) => {
    res.json(await syncOrg({ db, auth, notifier, gov, actorId: req.user.id }));
  });
}

module.exports = { registerOrg, syncOrg, isPerson };
