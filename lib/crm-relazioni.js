// «Chi conosciamo» (Dante 16/11/2026, canvas «v3 · Chi conosciamo»): la forza dei rapporti con un'azienda o un ente,
// calcolata da incontri, email, commesse e key account, e per ogni persona chi di noi la conosce meglio.
// Un contatto che ha cambiato azienda porta con sé i suoi incontri e le sue email: è un «ex collega» dell'ente di prima.

const RELAZIONI_DEFAULT = { months: 24, meeting: 3, email: 1, email_max: 5, project: 5, key: 3, strong: 8, medium: 3, cool_days: 90 };

const lower = s => String(s || '').trim().toLowerCase();
const personName = c => [c.title, c.first_name, c.last_name].filter(Boolean).join(' ');
const levelOf = (pts, r) => (pts >= r.strong ? 'forte' : pts >= r.medium ? 'media' : pts > 0 ? 'debole' : '');
const iso = d => (d ? new Date(d).toISOString() : null);

// rapporti per una o più aziende: { [subjectId]: { points, level, last_at, cooling, projects, key, people: [...] } }
// people: { contact_id, name, job, past, now_at, points, level, meetings, emails, last_at, us: { id, name } | null, why }
async function relationsFor(db, subjectIds, cfg = {}) {
  const r = { ...RELAZIONI_DEFAULT, ...cfg };
  const ids = [...new Set(subjectIds.filter(Boolean).map(Number))];
  if (!ids.length) return {};
  const since = new Date(Date.now() - r.months * 30.4 * 864e5).toISOString();
  const [{ rows: subjects }, { rows: links }, { rows: users }, { rows: projects }] = await Promise.all([
    db.query('SELECT id, name, owner_id, key_account FROM crm_subjects WHERE id = ANY($1::int[])', [ids]),
    db.query(`SELECT l.subject_id, l.contact_id, l.job, l.date_to, c.title, c.first_name, c.last_name, c.owner_id
                FROM crm_contact_links l JOIN crm_contacts c ON c.id = l.contact_id WHERE l.subject_id = ANY($1::int[])`, [ids]),
    db.query('SELECT id, name, email FROM users'),
    db.query('SELECT subject_id, count(*)::int AS n FROM crm_project_links WHERE subject_id = ANY($1::int[]) GROUP BY subject_id', [ids]),
  ]);
  const contactIds = [...new Set(links.map(l => l.contact_id))];
  const byMail = new Map(users.map(u => [lower(u.email), u]));
  const userById = new Map(users.map(u => [u.id, u]));
  // incontri ed email delle persone (ovunque lavorino) e delle aziende stesse
  const [{ rows: meetings }, { rows: emails }, { rows: now }] = await Promise.all([
    db.query(`SELECT l.contact_id, l.subject_id, m.start_at, m.organizer_address, m.attendees, m.linked_by
                FROM crm_meeting_links l JOIN crm_meetings m ON m.id = l.meeting_id
               WHERE NOT l.removed AND m.start_at >= $3 AND (l.contact_id = ANY($1::int[]) OR l.subject_id = ANY($2::int[]))`, [contactIds, ids, since]),
    db.query(`SELECT l.contact_id, l.subject_id, e.sent_at, e.from_address, e.to_list, e.cc_list, e.assigned_by
                FROM crm_email_links l JOIN crm_emails e ON e.id = l.email_id
               WHERE (e.sent_at IS NULL OR e.sent_at >= $3) AND (l.contact_id = ANY($1::int[]) OR l.subject_id = ANY($2::int[]))`, [contactIds, ids, since]),
    db.query(`SELECT l.contact_id, s.name FROM crm_contact_links l JOIN crm_subjects s ON s.id = l.subject_id
               WHERE l.contact_id = ANY($1::int[]) AND l.date_to IS NULL AND s.merged_into IS NULL`, [contactIds]),
  ]);
  // chi di noi c'era: organizzatore o invitati con l'indirizzo di una persona di Alma Space, altrimenti chi l'ha collegato
  const oursInMeeting = m => {
    const mails = [m.organizer_address, ...(Array.isArray(m.attendees) ? m.attendees.map(a => a?.address) : [])].map(lower);
    const found = mails.map(x => byMail.get(x)).filter(Boolean);
    return found.length ? found : m.linked_by && userById.get(m.linked_by) ? [userById.get(m.linked_by)] : [];
  };
  const oursInEmail = e => {
    const list = a => (Array.isArray(a) ? a.map(x => lower(x?.address || x?.email || x)) : []);
    const found = [lower(e.from_address), ...list(e.to_list), ...list(e.cc_list)].map(x => byMail.get(x)).filter(Boolean);
    return found.length ? found : e.assigned_by && userById.get(e.assigned_by) ? [userById.get(e.assigned_by)] : [];
  };
  const stat = new Map(); // contact_id → { meetings, emails, last, us: Map(userId → punti) }
  const st = id => { if (!stat.has(id)) stat.set(id, { meetings: 0, emails: 0, last: null, us: new Map() }); return stat.get(id); };
  const bump = (s, at, ours, pts) => {
    if (at && (!s.last || new Date(at) > new Date(s.last))) s.last = iso(at);
    for (const u of ours) s.us.set(u.id, (s.us.get(u.id) || 0) + pts);
  };
  const subjStat = new Map(); // incontri ed email collegati direttamente all'azienda
  for (const m of meetings) {
    const s = m.contact_id ? st(m.contact_id) : (subjStat.get(m.subject_id) || subjStat.set(m.subject_id, { meetings: 0, emails: 0, last: null, us: new Map() }).get(m.subject_id));
    s.meetings++;
    bump(s, m.start_at, oursInMeeting(m), r.meeting);
  }
  for (const e of emails) {
    const s = e.contact_id ? st(e.contact_id) : (subjStat.get(e.subject_id) || subjStat.set(e.subject_id, { meetings: 0, emails: 0, last: null, us: new Map() }).get(e.subject_id));
    s.emails++;
    bump(s, e.sent_at, oursInEmail(e), r.email);
  }
  const pointsOf = s => (s ? s.meetings * r.meeting + Math.min(s.emails * r.email, r.email_max) : 0);
  const bestUs = (s, fallbackIds) => {
    const top = s ? [...s.us.entries()].sort((a, b) => b[1] - a[1])[0] : null;
    const id = top?.[0] || fallbackIds.find(x => x && userById.get(x));
    const u = id ? userById.get(id) : null;
    return u ? { id: u.id, name: u.name } : null;
  };
  const coolMs = r.cool_days * 864e5;
  const out = {};
  for (const s of subjects) {
    const own = subjStat.get(s.id);
    const people = links.filter(l => l.subject_id === s.id).map(l => {
      const c = stat.get(l.contact_id);
      const pts = pointsOf(c);
      const elsewhere = now.filter(n => n.contact_id === l.contact_id && l.date_to).map(n => n.name);
      const why = [c?.meetings ? `${c.meetings} ${c.meetings === 1 ? 'incontro' : 'incontri'}` : '', c?.emails ? `${c.emails} email` : ''].filter(Boolean);
      return { contact_id: l.contact_id, name: personName(l), job: l.job || '', past: Boolean(l.date_to), now_at: elsewhere[0] || '',
        points: pts, level: levelOf(pts, r), meetings: c?.meetings || 0, emails: c?.emails || 0, last_at: c?.last || null,
        us: bestUs(c, [l.owner_id, s.owner_id]), why: why.join(' · ') };
    }).sort((a, b) => (a.past - b.past) || b.points - a.points || a.name.localeCompare(b.name, 'it'));
    const projectsN = projects.find(p => p.subject_id === s.id)?.n || 0;
    const best = people.filter(p => !p.past)[0];
    const points = Math.max(best?.points || 0, pointsOf(own)) + projectsN * r.project + (s.key_account ? r.key : 0);
    const last = [own?.last, ...people.map(p => p.last_at)].filter(Boolean).sort().pop() || null;
    const level = levelOf(points, r);
    out[s.id] = { subject_id: s.id, name: s.name, points, level, last_at: last, projects: projectsN, key: s.key_account,
      cooling: (level === 'forte' || level === 'media') && (!last || Date.now() - new Date(last).getTime() > coolMs),
      direct: own ? { meetings: own.meetings, emails: own.emails } : null,
      us: best?.us || bestUs(own, [s.owner_id]), people };
  }
  return out;
}

// le strade per arrivare a un'azienda, ordinate: chi di noi → quale persona, con forza e motivo
function pathsOf(rel) {
  if (!rel) return [];
  const paths = rel.people.filter(p => p.us && (p.points > 0 || !p.past)).map(p => ({
    contact_id: p.contact_id, contact: p.name, job: p.job, past: p.past, now_at: p.now_at, us: p.us, level: p.level || (rel.projects ? 'debole' : ''),
    points: p.points, last_at: p.last_at,
    why: [p.why, p.past ? `ha lavorato lì${p.now_at ? `, ora in ${p.now_at}` : ''}` : '', rel.projects ? `${rel.projects} ${rel.projects === 1 ? 'commessa' : 'commesse'} con loro` : '', rel.key ? 'key account' : ''].filter(Boolean).join(' · '),
  }));
  return paths.sort((a, b) => b.points - a.points).slice(0, 5);
}

// livello di rapporto per il punteggio del radar: forte/media/debole dalle relazioni, altrimenti cliente/conosciuto
function relationshipLevel(rel, roles = []) {
  if (rel?.level === 'forte') return 'strong';
  if (roles.includes('cliente')) return 'client';
  if (rel?.level === 'media') return 'medium';
  if (rel?.level === 'debole') return 'weak';
  return roles.length ? 'known' : 'unknown';
}

module.exports = { RELAZIONI_DEFAULT, relationsFor, pathsOf, relationshipLevel, levelOf, personName };
