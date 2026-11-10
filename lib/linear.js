// Linear per i ticket IT di Alma IT, con la chiave API personale (LINEAR_API_KEY) e il team in LINEAR_TEAM
// (chiave come «IT» o nome del team). La chiave sta solo nelle variabili del servizio, mai nel database.
// Senza chiave i ticket si gestiscono solo in Alma (prendi in carico, chiudi).
const API = 'https://api.linear.app/graphql';
// priorità di Linear: 1 urgente, 2 alta, 3 media, 4 bassa
const PRIORITY = { urgente: 1, alta: 2, media: 3, bassa: 4 };

const apiKey = () => process.env.LINEAR_API_KEY?.trim();
const teamWanted = () => (process.env.LINEAR_TEAM || 'IT').trim();
const configured = () => Boolean(apiKey());

class LinearError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function gql(query, variables = {}, doFetch = fetch) {
  if (!configured()) throw new LinearError('Linear non è collegato: manca la variabile LINEAR_API_KEY su Railway', 400);
  const res = await doFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: apiKey() }, body: JSON.stringify({ query, variables }) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new LinearError('Linear non accetta la chiave: controlla LINEAR_API_KEY su Railway', 403);
  if (!res.ok || data.errors?.length) throw new LinearError(`Linear ha risposto ${res.status}: ${data.errors?.[0]?.message || 'errore'}`);
  return data.data;
}

// il team IT su Linear (per chiave o nome), tenuto in memoria
let team = null;
async function itTeam(doFetch) {
  if (team && team.wanted === teamWanted()) return team;
  const d = await gql('query { teams(first: 100) { nodes { id key name } } }', {}, doFetch);
  const w = teamWanted().toLowerCase();
  const t = (d.teams?.nodes || []).find(n => n.key.toLowerCase() === w || n.name.toLowerCase() === w);
  if (!t) throw new LinearError(`Su Linear non c'è un team «${teamWanted()}»: scrivi la sua chiave in LINEAR_TEAM su Railway`, 400);
  team = { ...t, wanted: teamWanted() };
  return team;
}

async function createIssue({ title, description, priority }, doFetch) {
  const t = await itTeam(doFetch);
  const d = await gql(`mutation ($input: IssueCreateInput!) { issueCreate(input: $input) {
      success issue { id identifier url state { name type } assignee { name } } } }`,
  { input: { teamId: t.id, title, description, priority: PRIORITY[priority] || 3 } }, doFetch);
  if (!d.issueCreate?.success) throw new LinearError('Linear non ha creato l\'issue');
  return d.issueCreate.issue;
}

const ISSUE = 'id identifier title url priority updatedAt completedAt state { name type } assignee { name }';

// stato attuale delle issue mandate da Alma
async function issuesByIds(ids, doFetch) {
  if (!ids.length) return [];
  const d = await gql(`query ($ids: [ID!]) { issues(first: 250, filter: { id: { in: $ids } }) { nodes { ${ISSUE} } } }`, { ids }, doFetch);
  return d.issues?.nodes || [];
}

// la bacheca del team IT: aperte + completate negli ultimi 7 giorni
async function board(doFetch) {
  const t = await itTeam(doFetch);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const d = await gql(`query ($team: ID!, $since: DateTimeOrDuration) { issues(first: 150, orderBy: updatedAt, filter: {
      team: { id: { eq: $team } },
      or: [{ state: { type: { in: ["triage", "backlog", "unstarted", "started"] } } }, { completedAt: { gt: $since } }] }) { nodes { ${ISSUE} } } }`,
  { team: t.id, since }, doFetch);
  return { team: { key: t.key, name: t.name }, issues: d.issues?.nodes || [] };
}

module.exports = { configured, createIssue, issuesByIds, board, itTeam, LinearError, PRIORITY, _reset: () => { team = null; } };
