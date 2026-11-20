// Punti di contatto (canvas v9 «Collegamenti e punti di contatto», Dante 19/11/2026): per un'azienda o un ente,
// i legami che abbiamo già e non abbiamo ancora usato:
// - persone del CRM che ci lavorano (o ci hanno lavorato) e chi di noi le conosce;
// - colleghi che scrivono o si vedono spesso con loro;
// - incontri già in calendario nei prossimi 30 giorni;
// - dai dati ANAC: partner, clienti o concorrenti del CRM che hanno già vinto gare con quell'ente.
// Niente si collega da solo: ogni segnale ha «Collega», «Chiedi un'introduzione» o «Non c'entra».
const { relationsFor } = require('./crm-relazioni');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const vatKey = v => String(v || '').toUpperCase().replace(/^IT/, '').replace(/[^A-Z0-9]/g, '');
const isoDay = d => (d ? new Date(d).toISOString().slice(0, 10) : null);
const RUP = /\b(rup|responsabile unico|responsabile del procedimento)\b/i;

// nomi d'ente da cercare tra le stazioni appaltanti: «Provincia di Pescara» → «provincia di pescara»; troppo corti no
function entityPattern(name) {
  const n = norm(name).replace(/\b(s r l|srl|s p a|spa|s c a r l|scarl|soc coop)\b/g, '').trim();
  return n.length >= 6 ? n : null;
}

async function touchpointsFor(db, settings, { subjectId = null, entity = '', linked = { subjects: [], contacts: [] }, dismissed = new Set(), me = null, months = 18 } = {}) {
  const out = [];
  const push = t => { if (!dismissed.has(t.key)) out.push(t); };
  let subjectName = entity;
  if (subjectId) {
    const rel = (await relationsFor(db, [subjectId], settings.relazioni))[subjectId];
    if (rel) {
      subjectName = rel.name || entity;
      // 1. persone del CRM che ci lavorano (o ci hanno lavorato)
      for (const p of rel.people) {
        if (linked.contacts.includes(p.contact_id)) continue;
        const knows = p.us && p.us.id !== me ? p.us : null;
        push({
          key: `persona:${p.contact_id}`, type: 'persona', icon: 'users', tone: p.level === 'forte' || p.level === 'media' ? 'gr' : 'bl',
          title: p.past ? `${p.name} ha lavorato in ${subjectName}${p.now_at ? `, ora è in ${p.now_at}` : ''}` : `${p.name}${p.job ? `, ${p.job},` : ''} è già nel CRM`,
          detail: [p.us ? `È un contatto di ${p.us.name}` : 'Nessuno di noi ci ha ancora scritto', p.why, p.last_at ? `ultimo contatto il ${isoDay(p.last_at).split('-').reverse().join('/')}` : ''].filter(Boolean).join(' · '),
          contact_id: p.contact_id, name: p.name, role: RUP.test(p.job) ? 'rup' : 'referente', level: p.level,
          actions: ['collega', ...(knows ? ['introduzione'] : [])], knows,
        });
      }
      // 2. colleghi che scrivono o si vedono spesso con loro
      const byUser = new Map();
      for (const p of rel.people) if (p.us && (p.meetings || p.emails)) {
        const u = byUser.get(p.us.id) || { ...p.us, meetings: 0, emails: 0, people: 0 };
        u.meetings += p.meetings; u.emails += p.emails; u.people += 1;
        byUser.set(p.us.id, u);
      }
      if (rel.direct && rel.us) {
        const u = byUser.get(rel.us.id) || { ...rel.us, meetings: 0, emails: 0, people: 0 };
        u.meetings += rel.direct.meetings; u.emails += rel.direct.emails; byUser.set(rel.us.id, u);
      }
      for (const u of byUser.values()) {
        if (u.meetings + u.emails < 3) continue;
        push({
          key: `collega:${u.id}`, type: 'collega', icon: 'mail', tone: 'bl',
          title: `${u.name} è spesso in contatto con ${subjectName}`,
          detail: [u.emails ? `${u.emails} email` : '', u.meetings ? `${u.meetings} ${u.meetings === 1 ? 'incontro' : 'incontri'}` : '', u.people ? `con ${u.people} ${u.people === 1 ? 'persona' : 'persone'}` : ''].filter(Boolean).join(' · '),
          user_id: u.id, name: u.name, actions: u.id === me ? [] : ['squadra', 'introduzione'], knows: u.id === me ? null : { id: u.id, name: u.name },
        });
      }
      // 3. incontri già in calendario nei prossimi 30 giorni
      const ids = rel.people.filter(p => !p.past).map(p => p.contact_id);
      const { rows: meet } = await db.query(
        `SELECT DISTINCT m.id, m.subject, m.start_at, m.online_url FROM crm_meeting_links l JOIN crm_meetings m ON m.id = l.meeting_id
          WHERE NOT l.removed AND m.start_at >= (now() AT TIME ZONE 'Europe/Rome') AND m.start_at < (now() AT TIME ZONE 'Europe/Rome') + interval '30 days'
            AND (l.subject_id = $1 OR l.contact_id = ANY($2::int[])) ORDER BY m.start_at LIMIT 3`, [subjectId, ids]).catch(() => ({ rows: [] }));
      for (const m of meet) {
        const when = new Date(m.start_at);
        push({
          key: `incontro:${m.id}`, type: 'incontro', icon: 'calendar', tone: 'or',
          title: 'C\'è già un incontro in calendario',
          detail: `«${m.subject || 'Incontro'}» il ${when.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} alle ${String(m.start_at).slice(11, 16) || when.toTimeString().slice(0, 5)}${m.online_url ? ' (Teams)' : ''}`,
          meeting_id: m.id, subject_id: subjectId, actions: ['apri'],
        });
      }
    }
  }
  // 4. dati ANAC: chi del CRM ha già vinto gare con questo ente
  const pat = entityPattern(subjectName || entity);
  if (pat) {
    const { rows: awards } = await db.query(
      `SELECT a.cig, a.object, a.amount, a.awarded_on, a.sa_name, a.winners FROM crm_anac_awards a
        WHERE lower(a.sa_name) LIKE $1 AND a.awarded_on >= CURRENT_DATE - ($2 || ' months')::interval ORDER BY a.awarded_on DESC LIMIT 300`,
      [`%${pat}%`, String(months)]).catch(() => ({ rows: [] }));
    const cfs = [...new Set(awards.flatMap(a => (a.winners || []).map(w => vatKey(w.cf))).filter(Boolean))];
    if (cfs.length) {
      const { rows: subs } = await db.query(
        `SELECT id, name, roles, owner_id, regexp_replace(upper(coalesce(vat, '')), '^IT', '') AS v, upper(coalesce(tax_code, '')) AS t
           FROM crm_subjects WHERE merged_into IS NULL AND (regexp_replace(upper(coalesce(vat, '')), '^IT', '') = ANY($1::text[]) OR upper(coalesce(tax_code, '')) = ANY($1::text[]))`, [cfs]);
      const { rows: owners } = subs.length ? await db.query('SELECT id, name FROM users WHERE id = ANY($1::int[])', [subs.map(s => s.owner_id).filter(Boolean)]) : { rows: [] };
      for (const s of subs) {
        if (linked.subjects.includes(s.id) || s.id === subjectId) continue;
        const won = awards.filter(a => (a.winners || []).some(w => [s.v, s.t].includes(vatKey(w.cf))));
        if (!won.length) continue;
        const role = s.roles.includes('partner') ? 'ati' : s.roles.includes('concorrente') ? 'concorrente' : s.roles.includes('cliente') ? 'altro' : 'subappalto';
        const owner = owners.find(o => o.id === s.owner_id);
        const last = won[0];
        push({
          key: `anac:${s.id}`, type: 'anac', icon: role === 'ati' ? 'handshake' : role === 'concorrente' ? 'scale' : 'trophy', tone: role === 'concorrente' ? 'rd' : 'gr',
          title: role === 'ati' ? `${s.name}, nostro partner, ha già vinto con questo ente`
            : role === 'concorrente' ? `${s.name}, concorrente, ha vinto qui ${won.length} ${won.length === 1 ? 'gara' : 'gare'}`
              : s.roles.includes('cliente') ? `${s.name}, nostro cliente, lavora già per questo ente` : `${s.name} ha già vinto con questo ente`,
          detail: `${won.length} ${won.length === 1 ? 'gara vinta' : 'gare vinte'} (ANAC) · ultima: «${String(last.object || '').slice(0, 80)}»${last.awarded_on ? ` nel ${String(isoDay(last.awarded_on)).slice(0, 4)}` : ''}`,
          subject_id: s.id, name: s.name, role,
          actions: ['collega', ...(s.roles.includes('cliente') && owner && owner.id !== me ? ['introduzione'] : [])], knows: s.roles.includes('cliente') && owner && owner.id !== me ? owner : null,
        });
      }
    }
  }
  return out;
}

// Quanti punti di contatto per tante aziende in una volta (pagina Lead, Radar): persone del CRM con qualcuno di noi
// che le conosce e incontri già in calendario. I dati ANAC si guardano solo nella scheda (sono più pesanti).
async function touchCounts(db, settings, subjectIds) {
  const ids = [...new Set(subjectIds.filter(Boolean).map(Number))].slice(0, 400);
  if (!ids.length) return {};
  const rel = await relationsFor(db, ids, settings.relazioni);
  const { rows: meet } = await db.query(
    `SELECT coalesce(l.subject_id, cl.subject_id) AS sid, count(DISTINCT m.id)::int AS n
       FROM crm_meeting_links l JOIN crm_meetings m ON m.id = l.meeting_id LEFT JOIN crm_contact_links cl ON cl.contact_id = l.contact_id AND cl.date_to IS NULL
      WHERE NOT l.removed AND m.start_at >= (now() AT TIME ZONE 'Europe/Rome') AND m.start_at < (now() AT TIME ZONE 'Europe/Rome') + interval '30 days'
        AND coalesce(l.subject_id, cl.subject_id) = ANY($1::int[]) GROUP BY 1`, [ids]).catch(() => ({ rows: [] }));
  const out = {};
  for (const id of ids) {
    const r = rel[id];
    const n = (r ? r.people.filter(p => p.us && (p.meetings || p.emails || !p.past)).length : 0) + (meet.find(m => m.sid === id)?.n || 0);
    if (n) out[id] = n;
  }
  return out;
}

module.exports = { touchpointsFor, touchCounts, entityPattern };
