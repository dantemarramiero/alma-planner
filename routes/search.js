// Ricerca unica: ticket, progetti, note, email dei progetti, persone e post, con le stesse regole di visibilità
// del resto dell'app (access.js). Al massimo 8 risultati per gruppo, con un pezzo di testo intorno a ciò che si è cercato.
const { HttpError, v } = require('../lib/http');

const LIMIT = 8;

// Pezzo di testo intorno alla prima occorrenza (per mostrare dove compare la parola).
function snippet(text, q, size = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t.length > size ? `${t.slice(0, size)}…` : t;
  let start = Math.max(0, i - 50);
  // l'estratto parte a inizio parola, non a metà
  if (start > 0) { const sp = t.indexOf(' ', start); start = sp >= 0 && sp < i ? sp + 1 : start; }
  const out = t.slice(start, start + size);
  return `${start ? '…' : ''}${out}${start + size < t.length ? '…' : ''}`;
}

function registerSearch(app, { db, access }) {
  app.get('/api/search', async (req, res) => {
    const q = (v.text(req.query.q, 'ricerca', { max: 100 }) || '').trim();
    if (q.length < 2) throw new HttpError(400, 'Scrivi almeno 2 lettere');
    const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;

    // Con un amministratore i filtri valgono TRUE e non usano l'utente: il parametro si passa solo se serve.
    const tf = (alias) => access.ticketFilter(req, alias, '$2');
    const pf = (alias) => access.projectFilter(req, alias, '$2');
    const run = async (sql, usesUser) => (await db.query(sql, usesUser ? [like, req.user.id] : [like])).rows;
    const needsUser = !access.isAdmin(req);

    const [tickets, projects, notes, emails, users, orgPeople, posts] = await Promise.all([
      run(`SELECT t.id, t.title, t.description, t.status, t.due_date::text AS due_date, p.name AS project_name
             FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
            WHERE (t.title ILIKE $1 OR t.description ILIKE $1) AND ${tf('t')}
            ORDER BY (t.title ILIKE $1) DESC, (t.status = 'done'), t.updated_at DESC LIMIT ${LIMIT}`, needsUser),
      run(`SELECT p.id, p.name, p.description, p.status FROM projects p
            WHERE (p.name ILIKE $1 OR p.description ILIKE $1) AND ${pf('p')}
            ORDER BY (p.name ILIKE $1) DESC, (p.status = 'archived'), p.name LIMIT ${LIMIT}`, needsUser),
      run(`SELECT n.id, n.title, n.body, n.kind, n.note_date::text AS note_date, n.project_id, n.ticket_id,
                  COALESCE(np.name, tp.name) AS project_name, tk.title AS ticket_title
             FROM notes n
             LEFT JOIN projects np ON np.id = n.project_id
             LEFT JOIN tickets tk ON tk.id = n.ticket_id
             LEFT JOIN projects tp ON tp.id = tk.project_id
            WHERE n.deleted_at IS NULL AND (n.title ILIKE $1 OR n.body ILIKE $1)
              AND ((n.project_id IS NOT NULL AND ${pf('np')}) OR (n.ticket_id IS NOT NULL AND ${tf('tk')}))
            ORDER BY n.note_date DESC, n.id DESC LIMIT ${LIMIT}`, needsUser),
      run(`SELECT e.id, e.project_id, e.subject, e.from_name, e.from_address, e.sent_at, e.body_text, p.name AS project_name
             FROM project_emails e JOIN projects p ON p.id = e.project_id
            WHERE (e.subject ILIKE $1 OR e.from_name ILIKE $1 OR e.from_address ILIKE $1 OR e.body_text ILIKE $1) AND ${pf('p')}
            ORDER BY e.sent_at DESC NULLS LAST LIMIT ${LIMIT}`, needsUser),
      run(`SELECT u.id, u.name, u.email, u.job_title, u.avatar_id FROM users u
            WHERE u.name ILIKE $1 OR u.email ILIKE $1 OR u.job_title ILIKE $1 ORDER BY u.name LIMIT ${LIMIT}`, false),
      run(`SELECT o.oid, o.name, o.email, o.job_title, o.department FROM org_people o
            WHERE (o.name ILIKE $1 OR o.email ILIKE $1 OR o.job_title ILIKE $1 OR o.department ILIKE $1)
              AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(o.email))
            ORDER BY o.name LIMIT ${LIMIT}`, false),
      run(`SELECT p.id, p.author_id, p.body, p.created_at FROM posts p WHERE p.body ILIKE $1 ORDER BY p.id DESC LIMIT ${LIMIT}`, false),
    ]);

    const groups = [
      { type: 'ticket', label: 'Ticket', items: tickets.map(t => ({ id: t.id, title: t.title, sub: [t.project_name, t.status === 'done' ? 'fatto' : null, t.due_date ? `scade ${t.due_date}` : null].filter(Boolean).join(' · '), snippet: t.title.toLowerCase().includes(q.toLowerCase()) ? '' : snippet(t.description, q) })) },
      { type: 'project', label: 'Progetti', items: projects.map(p => ({ id: p.id, title: p.name, sub: p.status === 'archived' ? 'archiviato' : '', snippet: snippet(p.description, q) })) },
      { type: 'note', label: 'Note', items: notes.map(n => ({ id: n.id, title: n.title || n.project_name || n.ticket_title || 'Nota', sub: [n.note_date, n.ticket_id ? `ticket «${n.ticket_title}»` : n.project_name].filter(Boolean).join(' · '), snippet: snippet(n.body, q), project_id: n.project_id, ticket_id: n.ticket_id })) },
      { type: 'email', label: 'Email dei progetti', items: emails.map(e => ({ id: e.id, title: e.subject, sub: [e.from_name || e.from_address, e.project_name].filter(Boolean).join(' · '), snippet: snippet(e.body_text, q), project_id: e.project_id })) },
      { type: 'person', label: 'Persone', items: [
        ...users.map(u => ({ id: u.id, title: u.name, sub: [u.job_title, u.email].filter(Boolean).join(' · '), avatar_id: u.avatar_id })),
        ...orgPeople.map(o => ({ oid: o.oid, title: o.name, sub: [o.job_title, o.department].filter(Boolean).join(' · ') })),
      ].slice(0, LIMIT) },
      { type: 'post', label: 'Post', items: posts.map(p => ({ id: p.id, title: snippet(p.body, q, 90), author_id: p.author_id, sub: '' })) },
    ].filter(g => g.items.length);
    res.json({ q, groups, total: groups.reduce((n, g) => n + g.items.length, 0) });
  });
}

module.exports = { registerSearch, snippet };
