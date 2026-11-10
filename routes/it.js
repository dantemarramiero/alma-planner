// Alma IT per tutti: «I miei strumenti». Le licenze che ho (dal censimento), cosa posso chiedere al team IT
// e le mie richieste. Il censimento completo resta in /api/software (amministratori e team IT).
const { HttpError, v } = require('../lib/http');
const { itUserIds } = require('../lib/software-proposals');

const monthly = p => (p.unit_cost === null || p.unit_cost === undefined ? null
  : p.billing === 'anno' ? Number(p.unit_cost) / 12 : p.billing === 'una_tantum' ? 0 : Number(p.unit_cost));
const round = n => Math.round(n * 100) / 100;

// La persona di Microsoft dell'utente (per oid o email): le licenze del censimento sono legate a lei.
async function myPerson(db, req) {
  const { rows: [p] } = await db.query(
    `SELECT o.oid, o.name, o.email, o.job_title, o.department FROM org_people o
       LEFT JOIN users u ON u.id = $1
      WHERE o.oid = u.oid OR lower(o.email) = lower($2)
      ORDER BY (o.oid = u.oid) DESC NULLS LAST LIMIT 1`, [req.user.id, req.user.email || '']);
  return p || null;
}

function registerIt(app, { db, notifier }) {
  const tellIt = async (actorId, body, link) => notifier?.notify({ userIds: await itUserIds(db), actorId, kind: 'it', body, link }).catch(() => {});

  app.get('/api/it/mine', async (req, res) => {
    const person = await myPerson(db, req);
    const [{ rows: licences }, { rows: requests }, { rows: catalog }, { rows: packages }] = await Promise.all([
      person ? db.query(
        `SELECT a.id AS assignment_id, a.source, a.assigned_at, p.id AS plan_id, p.name AS plan_name, p.external_id, p.unit_cost, p.billing,
                s.id AS software_id, s.name AS software_name, s.vendor, s.category, s.website, s.notes AS software_notes
           FROM software_assignments a JOIN software_plans p ON p.id = a.plan_id JOIN software s ON s.id = p.software_id
          WHERE a.person_oid = $1 AND s.status <> 'archiviato' AND (p.unit_cost IS NULL OR p.unit_cost > 0 OR p.external_id IS NULL OR p.external_id = 'collegati')
          ORDER BY lower(COALESCE(NULLIF(s.vendor, ''), s.name)), lower(s.name), lower(p.name)`, [person.oid]) : { rows: [] },
      db.query('SELECT * FROM it_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]),
      // cosa si può chiedere: le licenze dei software in uso (non i «collegati» di Entra, non le gratuite di Microsoft)
      db.query(
        `SELECT p.id AS plan_id, p.name AS plan_name, s.name AS software_name, s.vendor, s.category
           FROM software_plans p JOIN software s ON s.id = p.software_id
          WHERE s.status = 'attivo' AND COALESCE(p.external_id, '') <> 'collegati' AND (p.unit_cost IS NULL OR p.unit_cost > 0)
          ORDER BY lower(COALESCE(NULLIF(s.vendor, ''), s.name)), lower(s.name), lower(p.name)`),
      // pacchetti del mio ruolo o reparto: dicono cosa mi spetta di base e cosa su richiesta
      person ? db.query(
        `SELECT pp.plan_id, pp.on_request, k.name AS package_name FROM software_packages k JOIN software_package_plans pp ON pp.package_id = k.id
          WHERE ($1::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.job_titles) t WHERE lower(t) = lower($1)))
             OR ($2::text IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(k.departments) d WHERE lower(d) = lower($2)))`,
        [person.job_title || null, person.department || null]) : { rows: [] },
    ]);
    const forMe = new Map(packages.map(p => [p.plan_id, p]));
    const have = new Set(licences.map(l => l.plan_id));
    res.json({
      person,
      licences: licences.map(l => ({ ...l, unit_cost: undefined, monthly_unit: undefined, package: forMe.get(l.plan_id) || null })),
      requests,
      catalog: catalog.filter(c => !have.has(c.plan_id)).map(c => ({ ...c, package: forMe.get(c.plan_id) || null })),
    });
  });

  // Richiedi un software: una licenza del censimento (plan_id) o uno che non c'è (name).
  app.post('/api/it/requests', async (req, res) => {
    const b = req.body || {};
    const planId = v.int(b.plan_id, 'software', { min: 1, nullable: true }) ?? null;
    const name = v.text(b.name, 'nome del software', { max: 160 });
    const reason = v.text(b.reason, 'motivo', { max: 1000 }) || '';
    const due = v.date(b.due_date, 'entro il') ?? null;
    if (!planId && !name) throw new HttpError(400, 'Scegli un software dall\'elenco o scrivi il suo nome');
    const person = await myPerson(db, req);
    let softwareName = name;
    if (planId) {
      const { rows: [p] } = await db.query(
        `SELECT p.id, p.name, s.name AS software_name FROM software_plans p JOIN software s ON s.id = p.software_id
          WHERE p.id = $1 AND s.status = 'attivo'`, [planId]);
      if (!p) throw new HttpError(400, 'Questo software non è più nel censimento');
      softwareName = ['Licenza', 'Utenti collegati'].includes(p.name) || p.name === p.software_name ? p.software_name : `${p.software_name} · ${p.name}`;
      if (person) {
        const { rows: [has] } = await db.query('SELECT 1 FROM software_assignments WHERE plan_id = $1 AND person_oid = $2', [planId, person.oid]);
        if (has) throw new HttpError(400, `Hai già «${softwareName}»`);
      }
      const { rows: [dup] } = await db.query("SELECT 1 FROM it_requests WHERE user_id = $1 AND plan_id = $2 AND status = 'da_rispondere'", [req.user.id, planId]);
      if (dup) throw new HttpError(400, `Hai già chiesto «${softwareName}»: il team IT ti risponde a breve`);
    }
    const { rows: [r] } = await db.query(
      `INSERT INTO it_requests (kind, user_id, person_oid, person_name, person_email, plan_id, software_name, reason, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [planId ? 'software' : 'nuovo', req.user.id, person?.oid || null, person?.name || req.user.name, req.user.email || '', planId, softwareName, reason, due]);
    await tellIt(req.user.id, `${req.user.name} chiede «${softwareName}»${reason ? `: ${reason.slice(0, 120)}` : ''}`, '/it/richieste');
    res.status(201).json({ id: r.id });
  });

  // «Non mi serve più»: libera una licenza mia per un collega (la toglie il team IT).
  app.post('/api/it/release', async (req, res) => {
    const id = v.int(req.body?.assignment_id, 'licenza', { min: 1 });
    const reason = v.text(req.body?.reason, 'motivo', { max: 1000 }) || '';
    const person = await myPerson(db, req);
    const { rows: [a] } = await db.query(
      `SELECT a.id, a.plan_id, p.name AS plan_name, s.name AS software_name FROM software_assignments a
         JOIN software_plans p ON p.id = a.plan_id JOIN software s ON s.id = p.software_id
        WHERE a.id = $1 AND a.person_oid = $2`, [id, person?.oid || '']);
    if (!a) throw new HttpError(404, 'Licenza non trovata tra le tue');
    const { rows: [dup] } = await db.query("SELECT 1 FROM it_requests WHERE assignment_id = $1 AND status = 'da_rispondere'", [id]);
    if (dup) throw new HttpError(400, 'L\'hai già segnalata: il team IT la toglie a breve');
    const softwareName = ['Licenza', 'Utenti collegati'].includes(a.plan_name) || a.plan_name === a.software_name ? a.software_name : `${a.software_name} · ${a.plan_name}`;
    await db.query(
      `INSERT INTO it_requests (kind, user_id, person_oid, person_name, person_email, plan_id, assignment_id, software_name, reason)
       VALUES ('rilascio', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user.id, person.oid, person.name, req.user.email || '', a.plan_id, id, softwareName, reason]);
    await tellIt(req.user.id, `${req.user.name} non usa più «${softwareName}»: la licenza si può liberare`, '/it/richieste');
    res.status(201).json({ ok: true });
  });

  // Annulla una mia richiesta ancora senza risposta.
  app.post('/api/it/requests/:id/cancel', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const { rowCount } = await db.query(
      "UPDATE it_requests SET status = 'annullata', decided_at = now() WHERE id = $1 AND user_id = $2 AND status = 'da_rispondere'", [id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Richiesta non trovata o già decisa');
    res.json({ ok: true });
  });
}

module.exports = { registerIt, myPerson, monthly, round };
