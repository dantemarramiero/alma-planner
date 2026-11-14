// Lavoro commerciale del CRM (Dante 14/11/2026, doc «Approccio commerciale Almacis» e canvas «Lavoro commerciale»):
// - prossimi passi per azienda (PC-01, PC-10): più d'uno, con owner, data, contatto e canale; il primo aperto resta
//   su crm_subjects.next_step perché le liste lo mostrano;
// - key account con il ritmo di contatto (PC-03);
// - «La mia settimana»: passi scaduti e in scadenza, key account non sentiti, incontri senza note, lead senza passo;
// - impostazioni del lavoro commerciale modificabili dall'app (solo la direzione le cambia).
const { HttpError, v } = require('../lib/http');
const { CHANNELS, PILOT, SECTIONS, clean, loadSettings, managerOf } = require('../lib/crm-commerciale');
const { registerCrmRadar } = require('./crm-radar');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const nowRome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOf = x => (x ? (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10) : null);

function registerCrmCommerciale(app, { db, subjectById, notifier, adminEmails, radarFetch }) {
  const adminOnly = req => { if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione cambia le impostazioni del lavoro commerciale'); };

  // il primo passo aperto torna sulla scheda: le liste e le card lo mostrano con il «!» se è scaduto
  async function syncNext(subjectId) {
    await db.query(
      `UPDATE crm_subjects s SET next_step = COALESCE(x.title, ''), next_step_date = x.due_date
         FROM (SELECT $1::int AS id) k LEFT JOIN LATERAL (
           SELECT title, due_date FROM crm_steps WHERE subject_id = $1 AND done_at IS NULL ORDER BY due_date, sort, id LIMIT 1) x ON true
        WHERE s.id = k.id`, [subjectId]);
  }
  async function stepFields(b, { partial }) {
    const f = {};
    if (!partial || b.title !== undefined) f.title = v.text(b.title, 'Cosa fare', { max: 300, required: true });
    if (!partial || b.due_date !== undefined) {
      f.due_date = v.date(b.due_date, 'Entro quando');
      if (!f.due_date) throw new HttpError(400, 'Scegli entro quando');
    }
    if (b.channel !== undefined) f.channel = b.channel ? v.oneOf(b.channel, 'Canale', Object.keys(CHANNELS)) : '';
    if (b.draft !== undefined) f.draft = v.text(b.draft, 'Bozza', { max: 5000 }) || '';
    if (b.owner_id !== undefined) {
      f.owner_id = b.owner_id ? v.int(b.owner_id, 'Chi lo fa', { min: 1 }) : null;
      if (f.owner_id && !(await db.query('SELECT 1 FROM users WHERE id = $1', [f.owner_id])).rowCount) throw new HttpError(400, 'Persona non trovata');
    }
    if (b.contact_id !== undefined) f.contact_id = b.contact_id ? v.int(b.contact_id, 'Contatto', { min: 1 }) : null;
    return f;
  }
  async function stepById(id) {
    const { rows: [st] } = await db.query('SELECT * FROM crm_steps WHERE id = $1', [id]);
    if (!st) throw new HttpError(404, 'Passo non trovato');
    return st;
  }
  const STEP_SELECT = `SELECT st.*, u.name AS owner_name, d.name AS done_by_name, s.name AS subject_name,
                              NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name
                         FROM crm_steps st JOIN crm_subjects s ON s.id = st.subject_id
                         LEFT JOIN users u ON u.id = st.owner_id LEFT JOIN users d ON d.id = st.done_by
                         LEFT JOIN crm_contacts c ON c.id = st.contact_id`;

  // ── prossimi passi ─────────────────────────────────────────────────────────────────────────
  app.get('/api/crm/subjects/:id/steps', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    const [{ rows: open }, { rows: done }] = await Promise.all([
      db.query(`${STEP_SELECT} WHERE st.subject_id = $1 AND st.done_at IS NULL ORDER BY st.due_date, st.sort, st.id`, [id]),
      db.query(`${STEP_SELECT} WHERE st.subject_id = $1 AND st.done_at IS NOT NULL ORDER BY st.done_at DESC LIMIT 30`, [id]),
    ]);
    res.json({ open, done, today: todayRome(), channels: CHANNELS });
  });
  app.post('/api/crm/subjects/:id/steps', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id, { forWrite: true });
    const f = await stepFields(req.body, { partial: false });
    if (f.owner_id === undefined) f.owner_id = s.owner_id || req.user.id;
    const { rows: [st] } = await db.query(
      `INSERT INTO crm_steps (subject_id, contact_id, title, channel, due_date, owner_id, draft, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, f.contact_id || null, f.title, f.channel || '', f.due_date, f.owner_id, f.draft || '', req.user.id]);
    await syncNext(id);
    res.status(201).json(st);
  });
  app.patch('/api/crm/steps/:id', async (req, res) => {
    const st = await stepById(v.int(req.params.id, 'id', { min: 1 }));
    const f = await stepFields(req.body, { partial: true });
    if (f.due_date && f.due_date !== dayOf(st.due_date)) f.alerted_at = null; // spostato: se scade di nuovo, nuovo avviso
    if (!Object.keys(f).length) return res.json(st);
    const keys = Object.keys(f);
    const { rows: [out] } = await db.query(
      `UPDATE crm_steps SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [st.id, ...keys.map(k => f[k])]);
    await syncNext(st.subject_id);
    res.json(out);
  });
  // «Fatto», con l'esito e se serve il passo dopo (senza un passo aperto un lead non è vivo: PC-01)
  app.post('/api/crm/steps/:id/done', async (req, res) => {
    const st = await stepById(v.int(req.params.id, 'id', { min: 1 }));
    if (st.done_at) throw new HttpError(409, 'Questo passo è già fatto');
    const outcome = v.text(req.body.outcome, 'Esito', { max: 2000 }) || '';
    let next = null;
    if (req.body.next && (req.body.next.title || req.body.next.due_date)) next = await stepFields(req.body.next, { partial: false });
    await db.query('UPDATE crm_steps SET done_at = now(), done_by = $2, outcome = $3, updated_at = now() WHERE id = $1', [st.id, req.user.id, outcome]);
    let created = null;
    if (next) {
      ({ rows: [created] } = await db.query(
        `INSERT INTO crm_steps (subject_id, contact_id, title, channel, due_date, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [st.subject_id, next.contact_id ?? st.contact_id, next.title, next.channel || '', next.due_date, next.owner_id ?? st.owner_id ?? req.user.id, req.user.id]));
    }
    await syncNext(st.subject_id);
    res.json({ ok: true, next: created });
  });
  app.post('/api/crm/steps/:id/reopen', async (req, res) => {
    const st = await stepById(v.int(req.params.id, 'id', { min: 1 }));
    await db.query('UPDATE crm_steps SET done_at = NULL, done_by = NULL, updated_at = now() WHERE id = $1', [st.id]);
    await syncNext(st.subject_id);
    res.json({ ok: true });
  });
  app.delete('/api/crm/steps/:id', async (req, res) => {
    const st = await stepById(v.int(req.params.id, 'id', { min: 1 }));
    await db.query('DELETE FROM crm_steps WHERE id = $1', [st.id]);
    await syncNext(st.subject_id);
    res.json({ ok: true });
  });

  // ── key account ────────────────────────────────────────────────────────────────────────────
  app.post('/api/crm/subjects/:id/key-account', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id, { forWrite: true });
    const on = Boolean(req.body.key_account);
    const rhythm = req.body.key_rhythm_days === undefined || req.body.key_rhythm_days === null || req.body.key_rhythm_days === ''
      ? null : v.int(req.body.key_rhythm_days, 'Ritmo di contatto (giorni)', { min: 7, max: 730 });
    const { rows: [s] } = await db.query('UPDATE crm_subjects SET key_account = $2, key_rhythm_days = $3, updated_at = now() WHERE id = $1 RETURNING id, key_account, key_rhythm_days', [id, on, rhythm]);
    res.json(s);
  });

  // ── impostazioni ───────────────────────────────────────────────────────────────────────────
  async function settingsView() {
    const [settings, { rows: asa }, { rows: users }, { rows: clients }] = await Promise.all([
      loadSettings(db),
      db.query('SELECT key, label FROM crm_asa ORDER BY sort, label'),
      db.query('SELECT id, name, email FROM users ORDER BY name'),
      db.query(`SELECT a AS asa, s.id, s.name, s.client_since FROM crm_subjects s, unnest(s.asa) a
                 WHERE s.merged_into IS NULL AND 'cliente' = ANY(s.roles) ORDER BY s.client_since NULLS LAST, lower(s.name)`),
    ]);
    for (const [k, p] of Object.entries(settings.profiles)) {
      const m = managerOf(p, users);
      p.manager = m ? { id: m.id, name: m.name } : null;
      p.clients = clients.filter(c => c.asa === k).map(c => ({ id: c.id, name: c.name }));
    }
    return { settings, asa, pilot: PILOT };
  }
  app.get('/api/crm/commerciale', async (req, res) => {
    res.json({ ...(await settingsView()), admin: req.crm.admin });
  });
  app.put('/api/crm/commerciale/:section', async (req, res) => {
    adminOnly(req);
    const section = req.params.section;
    if (!SECTIONS.includes(section)) throw new HttpError(404, 'Sezione sconosciuta');
    const [{ rows: asa }, { rows: users }] = await Promise.all([db.query('SELECT key FROM crm_asa'), db.query('SELECT id FROM users')]);
    let value = clean(section, req.body.value, { asaKeys: asa.map(a => a.key), userIds: users.map(u => u.id) });
    if (section === 'profiles') value = { ...(await loadSettings(db)).profiles, ...value }; // si salva una BU alla volta
    if (section === 'radar') { const cur = (await loadSettings(db)).radar; value = { ...value, bu: { ...cur.bu, ...value.bu } }; }
    await db.query(`INSERT INTO crm_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [section, JSON.stringify(value), req.user.id]);
    res.json(await settingsView());
  });
  app.delete('/api/crm/commerciale/:section', async (req, res) => { // «Torna ai valori di partenza»
    adminOnly(req);
    await db.query('DELETE FROM crm_settings WHERE key = $1', [req.params.section]);
    res.json(await settingsView());
  });

  // ── la mia settimana ───────────────────────────────────────────────────────────────────────
  app.get('/api/crm/settimana', async (req, res) => {
    let userId = req.user.id;
    if (req.query.user && Number(req.query.user) !== userId) {
      adminOnly(req);
      userId = v.int(req.query.user, 'Persona', { min: 1 });
    }
    const { rows: [me] } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [userId]);
    if (!me) throw new HttpError(404, 'Persona non trovata');
    const settings = await loadSettings(db);
    const { rows: users } = await db.query('SELECT id, name FROM users');
    const myBus = Object.entries(settings.profiles).filter(([, p]) => managerOf(p, users)?.id === userId).map(([k]) => k);
    const today = todayRome();
    const until = addDays(today, settings.rules.week_ahead_days);
    const rhythm = settings.rules.key_rhythm_days;

    const [{ rows: steps }, { rows: keys }, { rows: meetings }, { rows: leads }] = await Promise.all([
      db.query(`${STEP_SELECT} WHERE st.owner_id = $1 AND st.done_at IS NULL AND st.due_date <= $2 ORDER BY st.due_date, st.sort, st.id LIMIT 200`, [userId, until]),
      db.query(
        `SELECT s.id, s.name, s.asa, s.owner_id, u.name AS owner_name, s.key_rhythm_days, s.next_step, s.next_step_date,
                GREATEST(
                  (SELECT MAX(m.start_at)::date FROM crm_meeting_links ml JOIN crm_meetings m ON m.id = ml.meeting_id
                    WHERE NOT ml.removed AND m.start_at <= $3::timestamp
                      AND (ml.subject_id = s.id OR ml.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = s.id))),
                  (SELECT MAX(e.sent_at)::date FROM crm_email_links el JOIN crm_emails e ON e.id = el.email_id
                    WHERE el.subject_id = s.id OR el.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = s.id)),
                  (SELECT MAX(n.note_date) FROM crm_notes n WHERE n.deleted_at IS NULL
                      AND (n.subject_id = s.id OR n.contact_id IN (SELECT cl.contact_id FROM crm_contact_links cl WHERE cl.subject_id = s.id))),
                  (SELECT MAX(st.done_at)::date FROM crm_steps st WHERE st.subject_id = s.id)) AS last_contact
           FROM crm_subjects s LEFT JOIN users u ON u.id = s.owner_id
          WHERE s.key_account AND s.merged_into IS NULL AND (s.owner_id = $1 OR s.asa && $2::text[])
          ORDER BY lower(s.name)`, [userId, myBus, nowRome()]),
      db.query(
        `SELECT m.id, m.subject, m.start_at, m.end_at,
                (SELECT string_agg(DISTINCT COALESCE(s.name, trim(concat_ws(' ', c.first_name, c.last_name))), ', ')
                   FROM crm_meeting_links L LEFT JOIN crm_subjects s ON s.id = L.subject_id LEFT JOIN crm_contacts c ON c.id = L.contact_id
                  WHERE L.meeting_id = m.id AND NOT L.removed) AS who
           FROM crm_meetings m
          WHERE m.end_at < $2::timestamp AND m.end_at >= ($2::timestamp - interval '30 days')
            AND EXISTS (SELECT 1 FROM crm_meeting_links L WHERE L.meeting_id = m.id AND NOT L.removed)
            AND NOT EXISTS (SELECT 1 FROM crm_notes n WHERE n.meeting_id = m.id AND n.deleted_at IS NULL)
            AND (m.linked_by = $1 OR lower(m.organizer_address) = lower($3)
                 OR EXISTS (SELECT 1 FROM jsonb_array_elements(m.attendees) a WHERE lower(a->>'address') = lower($3)))
          ORDER BY m.end_at DESC LIMIT 50`, [userId, nowRome(), me.email || '']),
      db.query(
        `SELECT s.id, s.name, s.lead_stage, s.created_at FROM crm_subjects s
          WHERE s.owner_id = $1 AND s.merged_into IS NULL AND 'lead' = ANY(s.roles) AND s.status = 'attivo'
            AND s.lead_stage <> 'non_interessato'
            AND NOT EXISTS (SELECT 1 FROM crm_steps st WHERE st.subject_id = s.id AND st.done_at IS NULL)
          ORDER BY s.created_at DESC`, [userId]),
    ]);
    const silent = keys.map(k => {
      const last = dayOf(k.last_contact);
      const days = last ? Math.round((Date.parse(today) - Date.parse(last)) / 86400000) : null;
      return { ...k, last_contact: last, days, rhythm: k.key_rhythm_days || rhythm };
    }).filter(k => k.days === null || k.days > k.rhythm).sort((a, b) => (b.days ?? 1e6) - (a.days ?? 1e6));
    res.json({
      user: { id: me.id, name: me.name }, today, until, bus: myBus,
      radar: { pilot: PILOT, on: myBus.filter(k => settings.radar.bu[k]?.on) },
      steps: steps.map(s => ({ ...s, due_date: dayOf(s.due_date), late: dayOf(s.due_date) < today })),
      keyAccounts: { total: keys.length, silent },
      missingNotes: meetings,
      leadsWithoutStep: { total: leads.length, list: leads.slice(0, 20) },
      signals: [], // il radar arriva nella prossima tappa
    });
  });

  registerCrmRadar(app, { db, subjectById, syncNext, notifier, adminEmails, radarFetch });
  return { syncNext };
}

module.exports = { registerCrmCommerciale };
