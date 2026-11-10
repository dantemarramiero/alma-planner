// Alma Planet: Laboratorio delle idee e pagina di benvenuto.
// Ognuno propone innovazioni e miglioramenti, i colleghi le sostengono e le commentano; a fine anno il comitato
// (scelto dagli amministratori in Impostazioni) apre la votazione, dà un voto da 1 a 5 e premia le migliori.
// La classifica con le medie la vedono solo il comitato e gli amministratori; le idee premiate le vedono tutti.
const { HttpError, v } = require('../lib/http');
const settings = require('../lib/settings');

const CATEGORIES = ['innovazione', 'miglioramento', 'processi', 'sicurezza', 'persone', 'sostenibilita'];
const STATUSES = ['proposta', 'in_valutazione', 'premiata', 'realizzata', 'archiviata'];
const ICONS = ['clock', 'hard-hat', 'gift', 'headset', 'external', 'link', 'calendar', 'mail', 'file-text', 'users', 'building', 'cloud', 'package', 'car'];

// Scorciatoie della pagina di benvenuto finché un amministratore non le cambia.
const DEFAULT_SHORTCUTS = [
  { label: 'BOSS · Presenze', hint: 'Timbrature, ferie e permessi', url: 'https://app.bossai.build', icon: 'clock' },
  { label: 'BOSS · Cantiere', hint: 'Operatività di cantiere', url: 'https://app.bossai.build', icon: 'hard-hat' },
  { label: 'Welfare Edenred', hint: 'La piattaforma di welfare aziendale', url: '', icon: 'gift' },
  { label: 'Ticket sistema azienda', hint: 'Assistenza IT e richieste ai sistemi', url: '', icon: 'headset' },
];

const thisYear = () => new Date().getFullYear();

function registerIdeas(app, { db, isAdmin }) {
  async function setting(key, fallback) {
    return settings.getSetting(db, `planet.${key}`, fallback);
  }
  async function saveSetting(key, value, userId) {
    await settings.saveSetting(db, `planet.${key}`, value, userId);
  }
  async function inCommittee(userId) {
    const { rows } = await db.query('SELECT 1 FROM idea_committee WHERE user_id = $1', [userId]);
    return rows.length > 0;
  }
  // Chi sono io per il Laboratorio: amministratore, membro del comitato (vede la classifica e vota).
  async function role(req) {
    const admin = isAdmin(req);
    const committee = await inCommittee(req.user.id);
    return { admin, committee, judge: admin || committee };
  }
  async function getIdea(id) {
    const { rows } = await db.query('SELECT * FROM ideas WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Idea non trovata');
    return rows[0];
  }

  const IDEA_SELECT = `
    SELECT i.*, (SELECT COUNT(*)::int FROM idea_supports s WHERE s.idea_id = i.id) AS support_count,
           EXISTS (SELECT 1 FROM idea_supports s WHERE s.idea_id = i.id AND s.user_id = $1) AS supported,
           (SELECT COUNT(*)::int FROM idea_comments c WHERE c.idea_id = i.id) AS comment_count,
           (SELECT score FROM idea_votes x WHERE x.idea_id = i.id AND x.user_id = $1) AS my_score,
           (SELECT ROUND(AVG(score)::numeric, 2)::float FROM idea_votes x WHERE x.idea_id = i.id) AS avg_score,
           (SELECT COUNT(*)::int FROM idea_votes x WHERE x.idea_id = i.id) AS vote_count
      FROM ideas i`;
  // le medie e il numero di voti restano al comitato e agli amministratori
  const shape = (idea, r) => (r.judge ? idea : { ...idea, avg_score: undefined, vote_count: undefined });

  // ── elenco dell'anno ────────────────────────────────────────────────────────
  app.get('/api/ideas', async (req, res) => {
    const year = v.int(req.query.year, 'anno', { min: 2000, max: 2100 }) || thisYear();
    const r = await role(req);
    const { rows } = await db.query(`${IDEA_SELECT} WHERE i.year = $2 ORDER BY i.id DESC`, [req.user.id, year]);
    const years = (await db.query('SELECT DISTINCT year FROM ideas ORDER BY year DESC')).rows.map(x => x.year);
    if (!years.includes(thisYear())) years.unshift(thisYear());
    const committee = (await db.query('SELECT user_id FROM idea_committee ORDER BY added_at')).rows.map(x => x.user_id);
    res.json({
      year, years, ideas: rows.map(i => shape(i, r)),
      me: r, committee, voting_open: Boolean(await setting('ideas.voting_open', false)),
    });
  });

  app.get('/api/ideas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    const r = await role(req);
    const { rows } = await db.query(`${IDEA_SELECT} WHERE i.id = $2`, [req.user.id, id]);
    if (!rows[0]) throw new HttpError(404, 'Idea non trovata');
    const comments = (await db.query(
      'SELECT id, user_id, body, created_at FROM idea_comments WHERE idea_id = $1 ORDER BY id', [id])).rows;
    const myVote = (await db.query('SELECT score, note FROM idea_votes WHERE idea_id = $1 AND user_id = $2', [id, req.user.id])).rows[0] || null;
    const votes = r.judge
      ? (await db.query('SELECT user_id, score, note, updated_at FROM idea_votes WHERE idea_id = $1 ORDER BY updated_at', [id])).rows
      : undefined;
    res.json({ ...shape(rows[0], r), comments, my_vote: myVote, votes, me: r, voting_open: Boolean(await setting('ideas.voting_open', false)) });
  });

  // ── proporre, modificare, cancellare ───────────────────────────────────────
  const fields = (body, { required }) => ({
    title: v.text(body.title, 'titolo', { max: 160, required }),
    category: v.oneOf(body.category, 'categoria', CATEGORIES),
    problem: v.text(body.problem, 'cosa non va oggi', { max: 4000 }),
    proposal: v.text(body.proposal, 'la proposta', { max: 6000, required }),
    benefits: v.text(body.benefits, 'i vantaggi', { max: 4000 }),
  });

  app.post('/api/ideas', async (req, res) => {
    const f = fields(req.body || {}, { required: true });
    const { rows } = await db.query(
      `INSERT INTO ideas (author_id, title, category, problem, proposal, benefits)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, f.title, f.category || 'miglioramento', f.problem || '', f.proposal, f.benefits || '']);
    res.status(201).json({ id: rows[0].id });
  });

  app.patch('/api/ideas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    const idea = await getIdea(id);
    const r = await role(req);
    const body = req.body || {};
    const f = fields(body, { required: false });
    const status = v.oneOf(body.status, 'stato', STATUSES);
    const editsText = Object.values(f).some(x => x !== undefined);
    if (editsText && idea.author_id !== req.user.id && !r.admin) throw new HttpError(403, 'Puoi modificare solo le tue idee');
    if (editsText && !r.admin && idea.status !== 'proposta') throw new HttpError(409, 'L\'idea è già in valutazione: non si modifica più');
    if (status !== undefined && !r.judge) throw new HttpError(403, 'Lo stato lo cambiano il comitato e gli amministratori');
    const sets = [], params = [id];
    for (const [k, val] of Object.entries({ ...f, status })) {
      if (val === undefined) continue;
      params.push(val);
      sets.push(`${k} = $${params.length}`);
    }
    if (sets.length) await db.query(`UPDATE ideas SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    res.json({ ok: true });
  });

  app.delete('/api/ideas/:id', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    const idea = await getIdea(id);
    if (idea.author_id !== req.user.id && !isAdmin(req)) throw new HttpError(403, 'Puoi cancellare solo le tue idee');
    await db.query('DELETE FROM ideas WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── sostegno e commenti ─────────────────────────────────────────────────────
  app.post('/api/ideas/:id/support', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    await getIdea(id);
    await db.query('INSERT INTO idea_supports (idea_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.json({ ok: true });
  });
  app.delete('/api/ideas/:id/support', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    await db.query('DELETE FROM idea_supports WHERE idea_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  });

  app.post('/api/ideas/:id/comments', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    await getIdea(id);
    const body = v.text(req.body?.body, 'commento', { max: 2000, required: true });
    const { rows } = await db.query('INSERT INTO idea_comments (idea_id, user_id, body) VALUES ($1, $2, $3) RETURNING id', [id, req.user.id, body]);
    res.status(201).json({ id: rows[0].id });
  });
  app.delete('/api/idea-comments/:id', async (req, res) => {
    const id = v.int(req.params.id, 'commento', { min: 1 });
    const { rows } = await db.query('SELECT user_id FROM idea_comments WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Commento non trovato');
    if (rows[0].user_id !== req.user.id && !isAdmin(req)) throw new HttpError(403, 'Puoi cancellare solo i tuoi commenti');
    await db.query('DELETE FROM idea_comments WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ── voto del comitato ───────────────────────────────────────────────────────
  app.put('/api/ideas/:id/vote', async (req, res) => {
    const id = v.int(req.params.id, 'idea', { min: 1 });
    const idea = await getIdea(id);
    if (!(await inCommittee(req.user.id))) throw new HttpError(403, 'Votano solo i membri del comitato');
    if (!(await setting('ideas.voting_open', false))) throw new HttpError(409, 'La votazione è chiusa');
    if (idea.author_id === req.user.id) throw new HttpError(409, 'Non puoi votare una tua idea');
    const score = v.int(req.body?.score, 'voto', { min: 1, max: 5 });
    if (!score) throw new HttpError(400, 'Scegli un voto da 1 a 5');
    const note = v.text(req.body?.note, 'nota', { max: 1000 }) || '';
    await db.query(
      `INSERT INTO idea_votes (idea_id, user_id, score, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (idea_id, user_id) DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note, updated_at = now()`,
      [id, req.user.id, score, note]);
    res.json({ ok: true });
  });

  // ── impostazioni: comitato e votazione (amministratori) ────────────────────
  app.put('/api/ideas-settings', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Il comitato lo scelgono gli amministratori');
    const committee = v.ids(req.body?.committee, 'comitato');
    if (committee) {
      const { rows } = await db.query('SELECT id FROM users WHERE id = ANY($1::int[])', [committee]);
      if (rows.length !== committee.length) throw new HttpError(400, 'Persona del comitato non trovata');
      await db.query('DELETE FROM idea_committee WHERE NOT (user_id = ANY($1::int[]))', [committee]);
      for (const uid of committee) await db.query('INSERT INTO idea_committee (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [uid]);
    }
    if (req.body?.voting_open !== undefined) await saveSetting('ideas.voting_open', Boolean(req.body.voting_open), req.user.id);
    res.json({ ok: true });
  });

  // ── pagina di benvenuto ─────────────────────────────────────────────────────
  app.get('/api/welcome', async (req, res) => {
    const news = (await db.query(
      `SELECT p.id, p.author_id, left(p.body, 400) AS body, p.pinned_at, p.created_at
         FROM posts p WHERE p.pinned_at IS NOT NULL ORDER BY p.pinned_at DESC LIMIT 6`)).rows;
    const latest = (await db.query(
      `SELECT p.id, p.author_id, left(p.body, 200) AS body, p.created_at
         FROM posts p WHERE p.pinned_at IS NULL ORDER BY p.id DESC LIMIT 4`)).rows;
    const ideas = (await db.query(
      `SELECT i.id, i.title, i.category, i.status, i.author_id, i.created_at,
              (SELECT COUNT(*)::int FROM idea_supports s WHERE s.idea_id = i.id) AS support_count
         FROM ideas i WHERE i.status <> 'archiviata' ORDER BY i.id DESC LIMIT 3`)).rows;
    res.json({ shortcuts: await setting('welcome.shortcuts', DEFAULT_SHORTCUTS), news, latest, ideas, can_edit: isAdmin(req) });
  });

  app.put('/api/welcome/shortcuts', async (req, res) => {
    if (!isAdmin(req)) throw new HttpError(403, 'Le scorciatoie le cambiano gli amministratori');
    const list = req.body?.shortcuts;
    if (!Array.isArray(list) || list.length > 12) throw new HttpError(400, 'Al massimo 12 scorciatoie');
    const clean = list.map(s => {
      const url = v.text(s?.url, 'indirizzo', { max: 500 }) || '';
      if (url && !/^https?:\/\/\S+$/i.test(url) && !/^#\/\S*$/.test(url)) throw new HttpError(400, `Indirizzo non valido: ${url}`);
      return {
        label: v.text(s?.label, 'nome', { max: 60, required: true }),
        hint: v.text(s?.hint, 'descrizione', { max: 120 }) || '',
        url,
        icon: ICONS.includes(s?.icon) ? s.icon : 'external',
      };
    });
    await saveSetting('welcome.shortcuts', clean, req.user.id);
    res.json({ shortcuts: clean });
  });
}

module.exports = { registerIdeas, DEFAULT_SHORTCUTS, ICONS };
