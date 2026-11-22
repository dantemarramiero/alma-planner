// Linear per i ticket IT di Alma IT, con la chiave API personale (LINEAR_API_KEY) e il team in LINEAR_TEAM
// (chiave come «IT» o nome del team). La chiave sta solo nelle variabili del servizio, mai nel database.
// Senza chiave i ticket si gestiscono solo in Alma (prendi in carico, chiudi).
// Anche i feedback su Alma Space (ALM2-56) vanno su Linear, in un altro team: LINEAR_FEEDBACK_TEAM (di base «ALM2»).
const API = 'https://api.linear.app/graphql';
// priorità di Linear: 1 urgente, 2 alta, 3 media, 4 bassa
const PRIORITY = { urgente: 1, alta: 2, media: 3, bassa: 4 };

const apiKey = () => process.env.LINEAR_API_KEY?.trim();
const teamWanted = () => (process.env.LINEAR_TEAM || 'IT').trim();
const feedbackTeamWanted = () => (process.env.LINEAR_FEEDBACK_TEAM || 'ALM2').trim();
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

// i team di Linear per chiave o nome, tenuti in memoria (variabile = dove si scrive il team, per il messaggio d'errore)
let teams = new Map();
async function teamByKey(wanted, doFetch, variabile = 'LINEAR_TEAM') {
  const w = wanted.toLowerCase();
  if (teams.has(w)) return teams.get(w);
  const d = await gql('query { teams(first: 100) { nodes { id key name } } }', {}, doFetch);
  const t = (d.teams?.nodes || []).find(n => n.key.toLowerCase() === w || n.name.toLowerCase() === w);
  if (!t) throw new LinearError(`Su Linear non c'è un team «${wanted}»: scrivi la sua chiave in ${variabile} su Railway`, 400);
  teams.set(w, t);
  return t;
}
// il team IT e quello dei feedback
const itTeam = doFetch => teamByKey(teamWanted(), doFetch, 'LINEAR_TEAM');
const feedbackTeam = doFetch => teamByKey(feedbackTeamWanted(), doFetch, 'LINEAR_FEEDBACK_TEAM');

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

// ── feedback su Alma Space ─────────────────────────────────────────────────
// Etichette dei feedback nel loro team: si cercano per nome e, se mancano, si creano. Tenute in memoria.
const FEEDBACK_LABELS = ['Feedback', 'Feedback: tecnico', 'Feedback: procedura', 'Da valutare'];
let labels = new Map(); // id del team → { nome: id }
async function feedbackLabels(teamId, doFetch) {
  if (labels.has(teamId)) return labels.get(teamId);
  const d = await gql('query ($team: ID) { issueLabels(first: 250, filter: { team: { id: { eq: $team } } }) { nodes { id name } } }', { team: teamId }, doFetch);
  const byName = new Map((d.issueLabels?.nodes || []).map(l => [l.name.toLowerCase(), l.id]));
  const out = {};
  for (const name of FEEDBACK_LABELS) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const c = await gql('mutation ($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name } } }',
        { input: { name, teamId, color: name === 'Da valutare' ? '#F2994A' : '#5E6AD2' } }, doFetch);
      id = c.issueLabelCreate?.issueLabel?.id;
      if (!id) throw new LinearError(`Linear non ha creato l'etichetta «${name}»`);
    }
    out[name] = id;
  }
  labels.set(teamId, out);
  return out;
}

// lo stato di tipo «backlog» del team (il primo in ordine); se non c'è, Linear usa quello di partenza
let backlog = new Map();
async function backlogState(teamId, doFetch) {
  if (backlog.has(teamId)) return backlog.get(teamId);
  const d = await gql('query ($team: ID) { workflowStates(first: 50, filter: { team: { id: { eq: $team } }, type: { eq: "backlog" } }) { nodes { id name position } } }',
    { team: teamId }, doFetch);
  const s = (d.workflowStates?.nodes || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  backlog.set(teamId, s?.id || null);
  return s?.id || null;
}

// Carica un file su Linear: fileUpload dà l'indirizzo dove mandarlo (PUT) e quello da mettere nella descrizione.
async function uploadFile({ data, contentType, filename }, doFetch = fetch) {
  const d = await gql(`mutation ($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) {
      success uploadFile { uploadUrl assetUrl headers { key value } } } }`, { contentType, filename, size: data.length }, doFetch);
  const up = d.fileUpload?.uploadFile;
  if (!d.fileUpload?.success || !up?.uploadUrl) throw new LinearError('Linear non ha preparato il caricamento della foto');
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' };
  for (const hd of up.headers || []) headers[hd.key] = hd.value;
  const res = await doFetch(up.uploadUrl, { method: 'PUT', headers, body: data });
  if (!res.ok) throw new LinearError(`Caricamento della foto su Linear non riuscito (${res.status})`);
  return up.assetUrl;
}

// Issue di un feedback: etichette Feedback + tipo + Da valutare, nel backlog, senza priorità.
async function createFeedbackIssue({ title, description, kind }, doFetch) {
  const t = await feedbackTeam(doFetch);
  const l = await feedbackLabels(t.id, doFetch);
  const stateId = await backlogState(t.id, doFetch);
  const input = { teamId: t.id, title, description, priority: 0,
    labelIds: [l.Feedback, kind === 'procedura' ? l['Feedback: procedura'] : l['Feedback: tecnico'], l['Da valutare']] };
  if (stateId) input.stateId = stateId;
  const d = await gql('mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }', { input }, doFetch);
  if (!d.issueCreate?.success) throw new LinearError('Linear non ha creato l\'issue');
  return d.issueCreate.issue;
}

// stato, etichette, ultimi commenti e collegamenti «doppione» delle issue dei feedback
async function feedbackIssues(ids, doFetch) {
  if (!ids.length) return [];
  const d = await gql(`query ($ids: [ID!]) { issues(first: 250, filter: { id: { in: $ids } }) { nodes {
      id identifier url state { type name } labels { nodes { name } } comments(last: 20) { nodes { body createdAt } } relations { nodes { type relatedIssue { identifier } } } } } }`,
  { ids }, doFetch);
  return d.issues?.nodes || [];
}

module.exports = { configured, createIssue, issuesByIds, board, itTeam, feedbackTeam, teamByKey, uploadFile, createFeedbackIssue, feedbackIssues,
  FEEDBACK_LABELS, LinearError, PRIORITY, _reset: () => { teams = new Map(); labels = new Map(); backlog = new Map(); } };
