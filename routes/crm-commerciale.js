// Lavoro commerciale del CRM (Dante 14/11/2026, doc «Approccio commerciale Almacis» e canvas «Lavoro commerciale»):
// - prossimi passi per azienda (PC-01, PC-10): più d'uno, con owner, data, contatto e canale; il primo aperto resta
//   su crm_subjects.next_step perché le liste lo mostrano;
// - key account con il ritmo di contatto (PC-03);
// - «La mia settimana»: passi scaduti e in scadenza, key account non sentiti, incontri senza note, lead senza passo;
// - impostazioni del lavoro commerciale modificabili dall'app (solo la direzione le cambia).
const { HttpError, v } = require('../lib/http');
const { CHANNELS, PILOT, SECTIONS, clean, loadSettings, managerOf } = require('../lib/crm-commerciale');
const { registerCrmRadar } = require('./crm-radar');
const { registerCrmEsiti } = require('./crm-esiti');
const { registerCrmConcorrenza } = require('./crm-concorrenza');

const todayRome = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const nowRome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(' ', 'T').slice(0, 19);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOf = x => (x ? (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10) : null);

function registerCrmCommerciale(app, { db, subjectById, notifier, adminEmails, radarFetch, anacFetch }) {
  const adminOnly = req => { if (!req.crm.admin) throw new HttpError(403, 'Solo la direzione cambia le impostazioni del lavoro commerciale'); };

  // il primo passo aperto torna sulla scheda: le liste e le card lo mostrano con il «!» se è scaduto
  async function syncNext(subjectId) {
    await db.query(
      `UPDATE crm_subjects s SET next_step = COALESCE(x.title, ''), next_step_date = x.due_date
         FROM (SELECT $1::int AS id) k LEFT JOIN LATERAL (
           SELECT title, due_date FROM crm_steps WHERE subject_id = $1 AND done_at IS NULL ORDER BY due_date, sort, id LIMIT 1) x ON true
        WHERE s.id = k.id`, [subjectId]);
  }
  async function stepFields(b0, { partial }) {
    let b = b0;
    const f = {};
    if (!partial || b.title !== undefined) f.title = v.text(b.title, 'Cosa fare', { max: 300, required: true });
    if (!partial || b.due_date !== undefined) {
      f.due_date = v.date(b.due_date, 'Entro quando');
      if (!f.due_date) throw new HttpError(400, 'Scegli entro quando');
    }
    if (b.channel !== undefined) f.channel = b.channel ? v.oneOf(b.channel, 'Canale', Object.keys(CHANNELS)) : '';
    if (b.draft !== undefined) f.draft = v.text(b.draft, 'Bozza', { max: 5000 }) || '';
    if (b.note !== undefined) f.note = v.text(b.note, 'Note', { max: 2000 }) || '';
    // ALM2-71: più persone sullo stesso compito; la prima è owner_id, le altre in crm_step_people
    if (Array.isArray(b.owner_ids)) {
      const ids = [...new Set(b.owner_ids.map(x => v.int(x, 'Chi lo fa', { min: 1 })))].slice(0, 20);
      if (ids.length) {
        const { rows } = await db.query('SELECT id FROM users WHERE id = ANY($1::int[])', [ids]);
        if (rows.length !== ids.length) throw new HttpError(400, 'Persona non trovata');
      }
      f.people = ids;
      b = { ...b, owner_id: ids[0] || null };
    }
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
  // le altre persone del compito (oltre a owner_id), per l'elenco e per «Compiti»
  async function setPeople(stepId, ids) {
    await db.query('DELETE FROM crm_step_people WHERE step_id = $1', [stepId]);
    const others = ids.slice(1);
    if (others.length) await db.query('INSERT INTO crm_step_people (step_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING', [stepId, others]);
  }
  const STEP_SELECT = `SELECT st.*, u.name AS owner_name, d.name AS done_by_name, s.name AS subject_name,
                              (SELECT COALESCE(json_agg(json_build_object('id', pu.id, 'name', pu.name) ORDER BY pu.name), '[]')
                                 FROM crm_step_people sp JOIN users pu ON pu.id = sp.user_id WHERE sp.step_id = st.id) AS people,
                              cb.name AS created_by_name,
                              NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name
                         FROM crm_steps st JOIN crm_subjects s ON s.id = st.subject_id
                         LEFT JOIN users u ON u.id = st.owner_id LEFT JOIN users d ON d.id = st.done_by LEFT JOIN users cb ON cb.id = st.created_by
                         LEFT JOIN crm_contacts c ON c.id = st.contact_id`;

  // ── prossimi passi ─────────────────────────────────────────────────────────────────────────
  // App sul telefono 3.0 (Dante 20/11/2026), pagina «Compiti»: ?di=me i miei passi aperti, ?di=dati quelli che ho dato ad altri
  app.get('/api/crm/steps', async (req, res) => {
    const dati = req.query.di === 'dati';
    const { rows } = await db.query(
      `${STEP_SELECT} WHERE st.done_at IS NULL AND ${dati ? 'st.created_by = $1 AND st.owner_id IS DISTINCT FROM $1' : '(st.owner_id = $1 OR EXISTS (SELECT 1 FROM crm_step_people sp WHERE sp.step_id = st.id AND sp.user_id = $1))'}
        ORDER BY st.due_date, st.sort, st.id LIMIT 300`, [req.user.id]);
    const today = todayRome();
    res.json({ today, steps: rows.map(s => ({ ...s, due_date: dayOf(s.due_date), late: dayOf(s.due_date) < today })) });
  });
  app.get('/api/crm/subjects/:id/steps', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    await subjectById(req, id);
    const [{ rows: open }, { rows: done }] = await Promise.all([
      db.query(`${STEP_SELECT} WHERE st.subject_id = $1 AND st.done_at IS NULL ORDER BY st.due_date, st.sort, st.id`, [id]),
      db.query(`${STEP_SELECT} WHERE st.subject_id = $1 AND st.done_at IS NOT NULL ORDER BY st.done_at DESC LIMIT 30`, [id]),
    ]);
    res.json({ open, done, today: todayRome(), channels: CHANNELS });
  });
  // scheda del contatto (ALM2-71): i compiti con quella persona, su qualunque azienda
  app.get('/api/crm/contacts/:id/steps', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const [{ rows: open }, { rows: done }] = await Promise.all([
      db.query(`${STEP_SELECT} WHERE st.contact_id = $1 AND st.done_at IS NULL ORDER BY st.due_date, st.sort, st.id`, [id]),
      db.query(`${STEP_SELECT} WHERE st.contact_id = $1 AND st.done_at IS NOT NULL ORDER BY st.done_at DESC LIMIT 30`, [id]),
    ]);
    res.json({ open, done, today: todayRome(), channels: CHANNELS });
  });
  app.post('/api/crm/subjects/:id/steps', async (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const s = await subjectById(req, id, { forWrite: true });
    const f = await stepFields(req.body, { partial: false });
    if (f.owner_id === undefined) f.owner_id = s.owner_id || req.user.id;
    const people = f.people?.length ? f.people : [f.owner_id].filter(Boolean);
    // «Uno a testa»: un compito per persona; «Uno per tutti» (di base): uno solo, basta che uno lo chiuda
    const each = req.body.mode === 'testa' && people.length > 1;
    const insert = owner => db.query(
      `INSERT INTO crm_steps (subject_id, contact_id, title, channel, due_date, owner_id, draft, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, f.contact_id || null, f.title, f.channel || '', f.due_date, owner, f.draft || '', f.note || '', req.user.id]).then(r => r.rows[0]);
    const created = [];
    if (each) for (const p of people) created.push(await insert(p));
    else { const st = await insert(people[0] || null); await setPeople(st.id, people); created.push(st); }
    await syncNext(id);
    res.status(201).json({ ...created[0], created });
    // un compito dato a un collega gli arriva come avviso (campanella, telefono)
    const to = people.filter(u => u !== req.user.id);
    if (notifier && to.length) {
      const others = people.length - 1;
      const withText = people.length > 1 && !each ? ` · insieme a ${others === 1 ? 'un collega' : `${others} colleghi`}` : '';
      notifier.notify({ userIds: to, actorId: req.user.id, kind: 'crm', body: `ti ha dato un compito nel CRM su ${s.name}: «${f.title.slice(0, 140)}»${withText}`, link: `/crm/scheda/${id}/compiti` })
        .catch(err => console.warn('[crm] avviso del compito non inviato', err.message));
    }
  });
  app.patch('/api/crm/steps/:id', async (req, res) => {
    const st = await stepById(v.int(req.params.id, 'id', { min: 1 }));
    const f = await stepFields(req.body, { partial: true });
    if (f.due_date && f.due_date !== dayOf(st.due_date)) f.alerted_at = null; // spostato: se scade di nuovo, nuovo avviso
    const people = f.people;
    delete f.people;
    if (people) {
      const { rows: before } = await db.query('SELECT user_id FROM crm_step_people WHERE step_id = $1', [st.id]);
      const had = new Set([st.owner_id, ...before.map(r => r.user_id)]);
      await setPeople(st.id, people);
      const added = people.filter(u => !had.has(u) && u !== req.user.id);
      if (notifier && added.length) {
        const { rows: [s] } = await db.query('SELECT name FROM crm_subjects WHERE id = $1', [st.subject_id]);
        notifier.notify({ userIds: added, actorId: req.user.id, kind: 'crm', body: `ti ha dato un compito nel CRM su ${s?.name || 'un\'azienda'}: «${(f.title || st.title).slice(0, 140)}»`, link: `/crm/scheda/${st.subject_id}/compiti` })
          .catch(err => console.warn('[crm] avviso del compito non inviato', err.message));
      }
    }
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

    const [{ rows: steps }, { rows: keys }, { rows: meetings }, { rows: leads }, { rows: business }] = await Promise.all([
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
      // passi aperti delle iniziative di «Nuovi business» (Dante 14/11: «si dai»), scaduti o fino a fine settimana
      db.query(
        `SELECT t.id, t.title, t.due_date, t.phase, i.id AS initiative_id, i.name AS initiative_name
           FROM crm_initiative_tasks t JOIN crm_initiatives i ON i.id = t.initiative_id
          WHERE t.owner_id = $1 AND t.done_at IS NULL AND (t.due_date IS NULL OR t.due_date <= $2)
          ORDER BY t.due_date NULLS LAST, t.sort, t.id LIMIT 50`, [userId, until]).catch(() => ({ rows: [] })),
    ]);
    // ALM2-76: progettisti nuovi da conoscere (opportunità con il progettista trovato e il passo non ancora approvato)
    const { rows: designers } = await db.query(
      `SELECT g.id, g.title, g.amount, g.expected_on, g.bu, g.designer FROM crm_signals g
        WHERE g.designer IS NOT NULL AND jsonb_array_length(COALESCE(g.designer->'team', '[]'::jsonb)) > 0 AND g.designer->'step_id' IS NULL
          AND g.status IN ('nuovo', 'interessa') AND (g.bu = ANY($2::text[]) OR g.created_by = $1)
        ORDER BY g.id DESC LIMIT 10`, [userId, myBus]).catch(() => ({ rows: [] }));
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
      business: business.map(t => ({ ...t, due_date: dayOf(t.due_date), late: Boolean(t.due_date) && dayOf(t.due_date) < today })),
      signals: [], // il radar arriva nella prossima tappa
      designers: designers.map(g => ({ id: g.id, title: g.title, amount: g.amount, expected_on: dayOf(g.expected_on), capo: g.designer.team[0], team: g.designer.team.length,
        confirmed: Boolean(g.designer.confirmed), knows: (g.designer.knows || []).slice(0, 2), step: g.designer.step || null })),
    });
  });

  const esiti = registerCrmEsiti(app, { db, subjectById }); // vinte e perse, chi conosciamo (16/11)
  const radar = registerCrmRadar(app, { db, subjectById, syncNext, notifier, adminEmails, radarFetch, esiti });
  app.locals.crmRadar = radar; // ALM2-94: promemoria di chi deve decidere (anche nei test)
  const concorrenza = registerCrmConcorrenza(app, { db, radar, anacFetch }); // concorrenza ANAC e prima del bando (17/11)
  app.locals.crmRadar = radar; // per chi crea segnali da fuori (OpenCUP, v16)
  return { syncNext, concorrenza };
}

module.exports = { registerCrmCommerciale };
