// Alma Planet: i dati della nuova pagina di benvenuto (proposta E) e le parti che la alimentano.
// - /api/welcome/home: in un colpo solo persone in evidenza (nuovi arrivi, compleanni, anniversari), eventi,
//   «Grazie a…», novità dagli A3, sondaggio, organigramma e «la mia giornata» (ticket, approvazioni, scheda).
// - «Grazie a…»: un post verso un collega, legato a un pillar dell'Hoshin Kanri. Lo scrive chiunque.
// - Eventi aziendali, sondaggi e organigramma (un PDF): li gestiscono gli amministratori.
// Le scorciatoie, le news e le idee restano in /api/welcome (routes/ideas.js).
const express = require('express');
const { HttpError, v } = require('../lib/http');
const { toBuffer } = require('../lib/media');

const POLL_SQL = "SELECT id, question, options, to_char(closes_on, 'YYYY-MM-DD') AS closes_on, closed_at FROM polls";
const PDF_MAX = 15 * 1024 * 1024;
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// giorni da oggi al prossimo «stesso giorno e mese» di una data (0 = oggi)
function daysUntil(dateIso, today) {
  if (!dateIso) return null;
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  let next = new Date(Date.UTC(today.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  return Math.round((next - today) / 86400000);
}

function registerWelcome(app, { db, isAdmin, notifier, live }) {
  const admin = req => Boolean(isAdmin(req));
  const mustAdmin = req => { if (!admin(req)) throw new HttpError(403, 'Lo possono fare solo gli amministratori'); };
  async function setting(key, fallback) {
    const { rows } = await db.query('SELECT value FROM planet_settings WHERE key = $1', [key]);
    return rows[0] ? rows[0].value : fallback;
  }
  async function saveSetting(key, value, userId) {
    await db.query(
      `INSERT INTO planet_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), userId]);
  }

  async function pollView(poll, userId) {
    if (!poll) return null;
    const { rows } = await db.query('SELECT choice, COUNT(*)::int AS n FROM poll_votes WHERE poll_id = $1 GROUP BY choice', [poll.id]);
    const { rows: [mine] } = await db.query('SELECT choice FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [poll.id, userId]);
    const counts = poll.options.map((_, i) => rows.find(r => r.choice === i)?.n || 0);
    const today = iso(new Date());
    return { id: poll.id, question: poll.question, options: poll.options, counts, total: counts.reduce((a, b) => a + b, 0),
      my_vote: mine ? mine.choice : null, closes_on: poll.closes_on, open: !poll.closed_at && (!poll.closes_on || poll.closes_on >= today) };
  }

  app.get('/api/welcome/home', async (req, res) => {
    const me = req.user.id;
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const year = today.getUTCFullYear();

    // ── persone in evidenza ──
    const { rows: people } = await db.query(`SELECT id, name, job_title, avatar_id, to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(hired_on, 'YYYY-MM-DD') AS hired_on FROM users WHERE birthday IS NOT NULL OR hired_on IS NOT NULL`);
    const arrivals = people.filter(p => p.hired_on && p.hired_on <= iso(today) && p.hired_on >= iso(addDays(today, -30)))
      .map(p => ({ id: p.id, name: p.name, job_title: p.job_title, avatar_id: p.avatar_id, hired_on: p.hired_on }))
      .sort((a, b) => (a.hired_on < b.hired_on ? 1 : -1));
    const birthdays = people.map(p => ({ p, d: daysUntil(p.birthday, today) })).filter(x => x.d !== null && x.d <= 7)
      .sort((a, b) => a.d - b.d).map(({ p, d }) => ({ id: p.id, name: p.name, job_title: p.job_title, avatar_id: p.avatar_id, in_days: d }));
    const anniversaries = people.map(p => {
      if (!p.hired_on) return null;
      const h = new Date(`${p.hired_on}T00:00:00Z`);
      const d = daysUntil(iso(h), today);
      const years = year - h.getUTCFullYear() + (addDays(today, d).getUTCFullYear() - year);
      return d !== null && d <= 7 && years >= 1 ? { id: p.id, name: p.name, job_title: p.job_title, avatar_id: p.avatar_id, in_days: d, years } : null;
    }).filter(Boolean).sort((a, b) => a.in_days - b.in_days);

    const [events, grazie, a3, news, posts, ideaStats, poll, orgchart] = await Promise.all([
      db.query(`SELECT id, title, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, place FROM company_events WHERE starts_on >= $1 ORDER BY starts_on, id LIMIT 8`, [iso(today)]).then(r => r.rows),
      db.query(`SELECT p.id, p.author_id, p.thanked_id, p.pillar, left(p.body, 300) AS body, p.created_at
                  FROM posts p WHERE p.kind = 'grazie' AND p.created_at >= now() - interval '30 days' ORDER BY p.id DESC LIMIT 20`).then(r => r.rows),
      // contromisure degli A3 chiuse nelle ultime due settimane: diventano «Novità dagli A3»
      db.query(`SELECT t.id, t.activity, to_char(t.closed_date, 'YYYY-MM-DD') AS closed_date, p.id AS project_id, p.name AS project, p.owner, f.name AS function_name, f.color
                  FROM hk_tasks t JOIN hk_projects p ON p.id = t.project_id
                  LEFT JOIN hk_areas a ON a.id = p.area_id LEFT JOIN hk_functions f ON f.id = a.function_id
                 WHERE t.closed_date IS NOT NULL AND t.closed_date >= $1 AND t.closed_date <= $2 ORDER BY t.closed_date DESC, t.id DESC LIMIT 12`,
      [iso(addDays(today, -14)), iso(today)]).then(r => r.rows),
      db.query(`SELECT p.id, p.author_id, left(p.body, 400) AS body, p.pinned_at, p.created_at,
                       (SELECT pm.media_id FROM post_media pm WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS media_id,
                       (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id = p.id) AS likes,
                       (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comments
                  FROM posts p WHERE p.pinned_at IS NOT NULL ORDER BY p.pinned_at DESC LIMIT 3`).then(r => r.rows).catch(() => []),
      db.query(`SELECT p.id, p.author_id, p.kind, p.thanked_id, p.pillar, left(p.body, 300) AS body, p.created_at,
                       (SELECT pm.media_id FROM post_media pm WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
                  FROM posts p WHERE p.pinned_at IS NULL ORDER BY p.id DESC LIMIT 6`).then(r => r.rows),
      db.query(`SELECT COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS month,
                       COUNT(*) FILTER (WHERE status = 'premiata' AND year = $1)::int AS awarded FROM ideas`, [year]).then(r => r.rows[0]),
      db.query(POLL_SQL + " WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1").then(r => pollView(r.rows[0], me)),
      setting('welcome.orgchart', null),
    ]);

    // ── la mia giornata ──
    const LIVE = "(t.rda_state IS NULL OR t.rda_state = 'accepted')";
    const { rows: myTickets } = await db.query(
      `SELECT t.id, t.title, t.due_date, t.start_date, t.status, t.project_id, p.name AS project, p.color
         FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id AND a.user_id = $1 LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.status <> 'done' AND ${LIVE}
        ORDER BY t.due_date IS NULL, t.due_date, t.id DESC LIMIT 4`, [me]);
    const { rows: [counts] } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE t.due_date <= $2)::int AS due, COUNT(*) FILTER (WHERE t.due_date < $2)::int AS late
         FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id AND a.user_id = $1 WHERE t.status <> 'done' AND ${LIVE}`, [me, iso(today)]);
    const { rows: [appr] } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM pm_change_requests cr WHERE cr.status = 'pending' AND (cr.approver_id = $1 OR ($2 AND cr.approver_id IS NULL))) AS scheda,
              (SELECT COUNT(*)::int FROM tickets t WHERE t.rda_state = 'pending' AND t.rda_head_oid IS NOT NULL
                  AND t.rda_head_oid = (SELECT oid FROM users WHERE id = $1)) AS rda`, [me, admin(req)]);
    const { rows: [prof] } = await db.query(
      `SELECT r.status, r.title, r.description, (SELECT COUNT(*)::int FROM pm_change_requests cr WHERE cr.user_id = $1 AND cr.status = 'pending') AS pending
         FROM pm_profiles pp LEFT JOIN pm_roles r ON r.id = pp.role_id WHERE pp.user_id = $1`, [me]);
    const scheda = !prof || !prof.status || (prof.status === 'missing' && !prof.title && !prof.description) ? 'missing' : prof.pending ? 'pending' : 'ok';
    const { rows: [obj] } = await db.query(
      `SELECT SUM(weight * LEAST(achievement, 150)) FILTER (WHERE achievement IS NOT NULL) AS num,
              SUM(weight) FILTER (WHERE achievement IS NOT NULL) AS den, COUNT(*)::int AS n
         FROM pm_objectives WHERE user_id = $1 AND year = $2`, [me, year]);
    // revisione trimestrale in corso: quante chiuse su quante persone con obiettivi
    const quarter = Math.floor(today.getUTCMonth() / 3) + 1;
    const { rows: [rev] } = await db.query(
      `SELECT (SELECT COUNT(DISTINCT user_id)::int FROM pm_objectives WHERE year = $1) AS people,
              (SELECT COUNT(*)::int FROM pm_quarter_reviews WHERE year = $1 AND quarter = $2 AND status = 'closed') AS closed`, [year, quarter]);

    res.json({
      today: iso(today),
      people: { arrivals, birthdays, anniversaries },
      events, grazie, a3, news, posts, poll, orgchart,
      ideas: ideaStats,
      review: { year, quarter, deadline: quarter === 4 ? `${year + 1}-01-15` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-15`, ...rev },
      my: {
        tickets: myTickets, due: counts.due, late: counts.late,
        approvals: { scheda: appr.scheda, rda: appr.rda },
        scheda,
        objectives: obj.n ? { count: obj.n, achievement: obj.den ? Math.round(Number(obj.num) / Number(obj.den)) : null } : null,
      },
      can_admin: admin(req),
    });
  });

  // ── «Grazie a…» ──
  app.post('/api/welcome/grazie', async (req, res) => {
    const b = req.body || {};
    const thanked = v.int(b.user_id, 'collega', { min: 1 });
    const text = v.text(b.body, 'messaggio', { max: 2000, required: true });
    const pillar = v.text(b.pillar, 'pillar', { max: 120 }) || '';
    if (thanked === req.user.id) throw new HttpError(400, 'Scegli un collega da ringraziare');
    const { rows: [u] } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [thanked]);
    if (!u) throw new HttpError(404, 'Collega non trovato');
    const handle = String(u.email).split('@')[0];
    const body = `Grazie a @${handle}: ${text}`;
    const { rows: [p] } = await db.query(
      "INSERT INTO posts (author_id, body, kind, thanked_id, pillar) VALUES ($1, $2, 'grazie', $3, $4) RETURNING id", [req.user.id, body, thanked, pillar]);
    await notifier?.notify({ userIds: [thanked], actorId: req.user.id, kind: 'mention', postId: p.id }).catch(() => {});
    live?.broadcast('post', { id: p.id, author_id: req.user.id }, { except: req.user.id });
    res.status(201).json({ id: p.id });
  });

  // ── sondaggi ──
  app.post('/api/welcome/polls', async (req, res) => {
    mustAdmin(req);
    const b = req.body || {};
    const question = v.text(b.question, 'domanda', { max: 200, required: true });
    const options = (Array.isArray(b.options) ? b.options : []).map(o => v.text(o, 'risposta', { max: 120 })).filter(Boolean);
    if (options.length < 2 || options.length > 6) throw new HttpError(400, 'Da 2 a 6 risposte');
    const closes = v.date(b.closes_on, 'chiusura') || null;
    await db.query('UPDATE polls SET closed_at = now() WHERE closed_at IS NULL'); // uno alla volta
    const { rows: [p] } = await db.query(`INSERT INTO polls (question, options, closes_on, created_by) VALUES ($1, $2, $3, $4) RETURNING id, question, options, to_char(closes_on, 'YYYY-MM-DD') AS closes_on, closed_at`,
      [question, JSON.stringify(options), closes, req.user.id]);
    res.status(201).json(await pollView(p, req.user.id));
  });
  app.post('/api/welcome/polls/:id/vote', async (req, res) => {
    const id = v.int(req.params.id, 'sondaggio', { min: 1 });
    const { rows: [p] } = await db.query(POLL_SQL + ' WHERE id = $1', [id]);
    if (!p) throw new HttpError(404, 'Sondaggio non trovato');
    const view = await pollView(p, req.user.id);
    if (!view.open) throw new HttpError(409, 'Il sondaggio è chiuso');
    const choice = v.int(req.body?.choice, 'risposta', { min: 0, max: p.options.length - 1 });
    await db.query(`INSERT INTO poll_votes (poll_id, user_id, choice) VALUES ($1, $2, $3)
                    ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = $3, voted_at = now()`, [id, req.user.id, choice]);
    res.json(await pollView(p, req.user.id));
  });
  app.post('/api/welcome/polls/:id/close', async (req, res) => {
    mustAdmin(req);
    const id = v.int(req.params.id, 'sondaggio', { min: 1 });
    await db.query('UPDATE polls SET closed_at = now() WHERE id = $1 AND closed_at IS NULL', [id]);
    res.json({ ok: true });
  });

  // ── eventi aziendali ──
  app.post('/api/welcome/events', async (req, res) => {
    mustAdmin(req);
    const b = req.body || {};
    const title = v.text(b.title, 'titolo', { max: 160, required: true });
    const day = v.date(b.starts_on, 'data');
    if (!day) throw new HttpError(400, 'Il campo «data» è obbligatorio');
    const place = v.text(b.place, 'luogo', { max: 160 }) || '';
    const { rows: [e] } = await db.query(`INSERT INTO company_events (title, starts_on, place, created_by) VALUES ($1, $2, $3, $4) RETURNING id, title, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, place`,
      [title, day, place, req.user.id]);
    res.status(201).json(e);
  });
  app.delete('/api/welcome/events/:id', async (req, res) => {
    mustAdmin(req);
    await db.query('DELETE FROM company_events WHERE id = $1', [v.int(req.params.id, 'evento', { min: 1 })]);
    res.json({ ok: true });
  });

  // ── organigramma: un PDF, lo sostituisce un amministratore ──
  app.put('/api/welcome/orgchart', express.raw({ type: () => true, limit: PDF_MAX }), async (req, res) => {
    mustAdmin(req);
    const data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'File mancante');
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Carica un file PDF');
    const name = (v.text(req.query.name, 'nome', { max: 200 }) || 'Organigramma.pdf').replace(/[^\w .()\-àèéìòù]/gi, '_');
    const { rows: [m] } = await db.query("INSERT INTO media (owner_id, mime, data) VALUES ($1, 'application/pdf', $2) RETURNING id", [req.user.id, data]);
    const before = await setting('welcome.orgchart', null);
    const meta = { media_id: m.id, name, size: data.length, updated_at: new Date().toISOString() };
    await saveSetting('welcome.orgchart', meta, req.user.id);
    if (before?.media_id) await db.query('DELETE FROM media WHERE id = $1', [before.media_id]).catch(() => {});
    res.json(meta);
  });
  app.get('/api/welcome/orgchart', async (req, res) => {
    const meta = await setting('welcome.orgchart', null);
    if (!meta?.media_id) throw new HttpError(404, 'Organigramma non ancora caricato');
    const { rows: [m] } = await db.query("SELECT data FROM media WHERE id = $1 AND mime = 'application/pdf'", [meta.media_id]);
    if (!m) throw new HttpError(404, 'Organigramma non trovato');
    const disp = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="${meta.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-cache' });
    res.send(toBuffer(m.data));
  });

  // ── date per compleanni e anniversari ──
  // la data di nascita intera la vedono solo la persona e gli amministratori
  app.get('/api/users/:id/dates', async (req, res) => {
    const id = v.int(req.params.id, 'persona', { min: 1 });
    if (id !== req.user.id && !admin(req)) throw new HttpError(403, 'Le date le vedono la persona e gli amministratori');
    const { rows: [u] } = await db.query(`SELECT id, to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(hired_on, 'YYYY-MM-DD') AS hired_on FROM users WHERE id = $1`, [id]);
    if (!u) throw new HttpError(404, 'Persona non trovata');
    res.json({ id: u.id, birthday: u.birthday, hired_on: u.hired_on });
  });
  app.patch('/api/users/:id/dates', async (req, res) => {
    const id = v.int(req.params.id, 'persona', { min: 1 });
    const b = req.body || {};
    // il compleanno lo mette la persona (o un amministratore); la data di assunzione solo un amministratore
    if (b.birthday !== undefined) {
      if (id !== req.user.id && !admin(req)) throw new HttpError(403, 'Il compleanno lo mette la persona');
      await db.query('UPDATE users SET birthday = $2 WHERE id = $1', [id, v.date(b.birthday, 'compleanno') || null]);
    }
    if (b.hired_on !== undefined) {
      mustAdmin(req);
      await db.query('UPDATE users SET hired_on = $2 WHERE id = $1', [id, v.date(b.hired_on, 'assunzione') || null]);
    }
    const { rows: [u] } = await db.query(`SELECT id, to_char(birthday, 'YYYY-MM-DD') AS birthday, to_char(hired_on, 'YYYY-MM-DD') AS hired_on FROM users WHERE id = $1`, [id]);
    if (!u) throw new HttpError(404, 'Persona non trovata');
    res.json({ id: u.id, birthday: u.birthday, hired_on: u.hired_on });
  });
}

module.exports = { registerWelcome, daysUntil };
