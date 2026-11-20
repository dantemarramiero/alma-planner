// Punti di contatto (canvas v9 «Collegamenti e punti di contatto», Dante 19/11/2026) per un'opportunità del Radar,
// un progetto del CRM o un'azienda: segnali con «Collega» (collegamenti con il ruolo), «Chiedi un'introduzione»
// (un compito alla persona che conosce), «Aggiungi alla squadra» (progetti) o «Non c'entra» (non torna più).
const { HttpError, v } = require('../lib/http');
const { loadSettings } = require('../lib/crm-commerciale');
const { touchpointsFor, touchCounts } = require('../lib/crm-punti');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function registerCrmPunti(app, { db, alerts }) {
  // a chi si riferisce: { key: 'signal:12', subjectId, entity, linked: { subjects, contacts }, projectId }
  async function targetOf(q) {
    if (q.signal) {
      const id = v.int(q.signal, 'opportunità', { min: 1 });
      const { rows: [g] } = await db.query('SELECT id, subject_id, entity, project_id FROM crm_signals WHERE id = $1', [id]);
      if (!g) throw new HttpError(404, 'Opportunità non trovata');
      const { rows: l } = await db.query('SELECT subject_id, contact_id FROM crm_signal_links WHERE signal_id = $1', [id]);
      return { key: `signal:${id}`, subjectId: g.subject_id, entity: g.entity || '', projectId: g.project_id || null,
        linked: { subjects: l.map(x => x.subject_id).filter(Boolean), contacts: l.map(x => x.contact_id).filter(Boolean) } };
    }
    if (q.project) {
      const id = v.int(q.project, 'progetto', { min: 1 });
      const { rows: l } = await db.query('SELECT subject_id, contact_id, role FROM crm_project_links WHERE project_id = $1 ORDER BY (role = \'ente\') DESC, created_at', [id]);
      const { rows: [g] } = await db.query('SELECT subject_id, entity FROM crm_signals WHERE project_id = $1', [id]);
      const subjectId = g?.subject_id || l.find(x => x.subject_id && x.role === 'ente')?.subject_id || l.find(x => x.subject_id)?.subject_id || null;
      return { key: `project:${id}`, subjectId, entity: g?.entity || '', projectId: id,
        linked: { subjects: l.map(x => x.subject_id).filter(Boolean), contacts: l.map(x => x.contact_id).filter(Boolean) } };
    }
    if (q.subject) {
      const id = v.int(q.subject, 'azienda', { min: 1 });
      return { key: `subject:${id}`, subjectId: id, entity: '', projectId: null, linked: { subjects: [id], contacts: [] } };
    }
    throw new HttpError(400, 'Serve un\'opportunità, un progetto o un\'azienda');
  }

  app.get('/api/crm/punti-contatto', async (req, res) => {
    const t = await targetOf(req.query);
    const { rows: d } = await db.query('SELECT key FROM crm_touch_dismissed WHERE target = $1', [t.key]);
    const settings = await loadSettings(db);
    const list = await touchpointsFor(db, settings, { subjectId: t.subjectId, entity: t.entity, linked: t.linked, dismissed: new Set(d.map(x => x.key)), me: req.user.id });
    res.json({ target: t.key, project_id: t.projectId, items: list });
  });

  app.post('/api/crm/punti-contatto/non-centra', async (req, res) => {
    const t = await targetOf(req.body || {});
    const key = String(req.body?.key || '').slice(0, 80);
    if (!/^(persona|collega|incontro|anac):\d+$/.test(key)) throw new HttpError(400, 'Segnale non valido');
    await db.query('INSERT INTO crm_touch_dismissed (target, key, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [t.key, key, req.user.id]);
    res.json({ ok: true });
  });

  // «Chiedi un'introduzione»: un compito alla persona che conosce, nel progetto se c'è
  app.post('/api/crm/punti-contatto/introduzione', async (req, res) => {
    const b = req.body || {};
    const t = await targetOf(b);
    const userId = v.int(b.user_id, 'persona', { min: 1 });
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!name) throw new HttpError(400, 'A chi presentarci?');
    if (userId === req.user.id) throw new HttpError(400, 'Questa persona la conosci già tu');
    const { rows: [u] } = await db.query('SELECT id, name FROM users WHERE id = $1', [userId]);
    if (!u) throw new HttpError(404, 'Persona non trovata');
    const { rows: [s] } = t.subjectId ? await db.query('SELECT name FROM crm_subjects WHERE id = $1', [t.subjectId]) : { rows: [] };
    const ente = s?.name || t.entity || '';
    const due = addDays(todayRome(), 5);
    const { rows: [{ pos }] } = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM tickets');
    const { rows: [tk] } = await db.query(
      `INSERT INTO tickets (title, description, status, due_date, start_date, project_id, created_by, position)
       VALUES ($1, $2, 'todo', $3, $4, $5, $6, $7) RETURNING id, title, due_date`,
      [`Presentaci a ${name}`.slice(0, 200), `Chiesto da ${req.user.name || 'un collega'} dal CRM (punti di contatto)${ente ? ` per ${ente}` : ''}: una telefonata o una email per presentarci.`,
        due, todayRome(), t.projectId, req.user.id, pos]);
    await db.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tk.id, userId]);
    if (t.projectId) await db.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [t.projectId, userId, req.user.id]).catch(() => {});
    res.status(201).json({ ticket_id: tk.id, to: u.name });
    alerts?.ticketAssigned({ id: tk.id, title: tk.title, due_date: due }, [userId], req.user).catch(() => {});
  });

  // «Aggiungi alla squadra» (progetti): chi è spesso in contatto con l'ente entra nel progetto
  app.post('/api/crm/punti-contatto/squadra', async (req, res) => {
    const t = await targetOf(req.body || {});
    if (!t.projectId) throw new HttpError(400, 'La squadra c\'è solo quando l\'opportunità è portata avanti');
    const userId = v.int(req.body?.user_id, 'persona', { min: 1 });
    await db.query('INSERT INTO project_members (project_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [t.projectId, userId, req.user.id]);
    res.json({ ok: true });
  });

  // quanti punti di contatto (bollino verde nella pagina Lead e sulle carte del Radar)
  app.post('/api/crm/punti-contatto/conteggi', async (req, res) => {
    const ids = (Array.isArray(req.body?.subjects) ? req.body.subjects : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    res.json(await touchCounts(db, await loadSettings(db), ids));
  });
}

module.exports = { registerCrmPunti };
