// Ticket IT: proposta di tipo e priorità dal testo, e allineamento con Linear (stato, chi se ne occupa).
const linear = require('./linear');

const CATEGORIES = [
  ['Rete e VPN', /\b(vpn|rete|wi-?fi|internet|connession|collega|router|lan)\w*/i],
  ['Stampanti', /\b(stampant|stampa|scanner|toner)\w*/i],
  ['Account e accessi', /\b(account|password|accesso|login|mfa|autenticator|bloccat|utenza|nuovo arrivat)\w*/i],
  ['Posta e Teams', /\b(outlook|mail|posta|casell|teams|calendar)\w*/i],
  ['Computer e telefono', /\b(portatil|pc|computer|notebook|monitor|schermo|tastiera|mouse|telefon|cellular|smartphone|batteria)\w*/i],
  ['Software e licenze', /\b(software|licenz|install|programm|app|aggiornament|office|excel|word|autocad|adobe)\w*/i],
  ['File e OneDrive', /\b(onedrive|sharepoint|file|cartell|document|backup)\w*/i],
];
const URGENT = /\b(urgent|subito|bloccat|non (riesco|posso) lavorare|fermo|ferma|down|cliente in attesa)\w*/i;
const HIGH = /\b(non funziona|non va|non si (apre|collega|avvia)|errore|impossibile)\b/i;

function suggest(title, body = '') {
  const text = `${title} ${body}`;
  const category = CATEGORIES.find(([, re]) => re.test(text))?.[0] || 'Altro';
  const priority = URGENT.test(text) ? 'urgente' : HIGH.test(text) ? 'alta' : 'media';
  return { category, priority };
}

// Allinea i ticket mandati a Linear: stato e responsabile; quando l'issue è chiusa su Linear il ticket si chiude
// e chi l'ha segnalato riceve una notifica (una sola volta). Restituisce quanti ne ha aggiornati.
async function refreshLinear(db, notifier, doFetch) {
  if (!linear.configured()) return 0;
  const { rows } = await db.query("SELECT id, user_id, title, linear_id, linear_state_type FROM it_tickets WHERE status = 'linear' AND linear_id IS NOT NULL");
  if (!rows.length) return 0;
  const issues = new Map((await linear.issuesByIds(rows.map(r => r.linear_id), doFetch)).map(i => [i.id, i]));
  let changed = 0;
  for (const t of rows) {
    const i = issues.get(t.linear_id);
    if (!i) continue;
    const type = i.state?.type || null;
    const done = type === 'completed' || type === 'canceled';
    const { rowCount } = await db.query(
      `UPDATE it_tickets SET linear_state = $2, linear_state_type = $3, linear_assignee = $4, updated_at = now(),
              status = CASE WHEN $5 THEN 'chiuso' ELSE status END, closed_at = CASE WHEN $5 THEN now() ELSE closed_at END
        WHERE id = $1 AND (linear_state IS DISTINCT FROM $2 OR linear_assignee IS DISTINCT FROM $4 OR $5)`,
      [t.id, i.state?.name || null, type, i.assignee?.name || null, done]);
    if (!rowCount) continue;
    changed++;
    if (done || (type === 'started' && t.linear_state_type !== 'started')) {
      const body = type === 'completed' ? `Il team IT ha risolto «${t.title}»`
        : type === 'canceled' ? `Il team IT ha chiuso «${t.title}» senza intervento`
          : `Il team IT sta lavorando a «${t.title}»${i.assignee?.name ? ` (${i.assignee.name})` : ''}`;
      await notifier?.notify({ userIds: [t.user_id], actorId: null, kind: 'it', body, link: '/it/strumenti' }).catch(() => {});
    }
  }
  return changed;
}

module.exports = { suggest, refreshLinear };
