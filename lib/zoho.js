// Collegamento con Zoho (Zoho One + Zoho CRM) per il censimento software, in sola lettura.
// Un amministratore preme «Collega Zoho», entra in Zoho e dà il consenso: il refresh token si salva cifrato
// (stessa chiave della cache dei token Microsoft) nell'impostazione «software.zoho». Client ID e secret sono
// variabili del servizio (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET), mai nel database.
const crypto = require('crypto');
const { getSetting, saveSetting } = require('./settings');

const SCOPES = ['ZohoOne.orgs.READ', 'ZohoOne.Users.READ', 'ZohoCRM.users.READ', 'ZohoCRM.features.READ'];
const SETTING = 'software.zoho';
const STATE = 'software.zoho_state';
// server di accesso ammessi (Zoho li manda nel ritorno come «accounts-server», uno per data center)
const ACCOUNTS_RE = /^https:\/\/accounts\.zoho\.(eu|com|in|com\.au|jp|ca|sa|com\.cn|uk)$/;

const clientId = () => process.env.ZOHO_CLIENT_ID?.trim();
const clientSecret = () => process.env.ZOHO_CLIENT_SECRET?.trim();
const configured = () => Boolean(clientId() && clientSecret());
const defaultAccounts = () => {
  const a = (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.eu').trim().replace(/\/$/, '');
  return ACCOUNTS_RE.test(a) ? a : 'https://accounts.zoho.eu';
};
const redirectUri = baseUrl => `${baseUrl}/api/software/zoho/callback`;

class ZohoError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// indirizzo a cui mandare l'amministratore per il consenso
async function authorizeUrl(db, baseUrl, userId) {
  if (!configured()) throw new ZohoError('Zoho non è configurato: mancano ZOHO_CLIENT_ID e ZOHO_CLIENT_SECRET su Railway', 400);
  const state = crypto.randomBytes(24).toString('base64url');
  await saveSetting(db, STATE, { state, user: userId, at: Date.now() }, userId);
  const url = new URL(`${defaultAccounts()}/oauth/v2/auth`);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('redirect_uri', redirectUri(baseUrl));
  url.searchParams.set('state', state);
  return url.toString();
}

// ritorno da Zoho: controlla lo stato, scambia il codice e salva il refresh token cifrato
async function finishConnect(db, auth, baseUrl, userId, query, doFetch = fetch) {
  const saved = await getSetting(db, STATE);
  await db.query('DELETE FROM settings WHERE key = $1', [STATE]);
  if (query.error) throw new ZohoError(`Zoho non ha dato il consenso (${String(query.error).slice(0, 80)})`, 400);
  if (!saved || saved.state !== query.state || saved.user !== userId || Date.now() - saved.at > 15 * 60 * 1000) {
    throw new ZohoError('Collegamento scaduto o non valido: premi di nuovo «Collega Zoho»', 400);
  }
  const accounts = query['accounts-server'] && ACCOUNTS_RE.test(query['accounts-server']) ? query['accounts-server'] : defaultAccounts();
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: String(query.code || ''), client_id: clientId(), client_secret: clientSecret(),
    redirect_uri: redirectUri(baseUrl),
  });
  const res = await doFetch(`${accounts}/oauth/v2/token`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.refresh_token) {
    throw new ZohoError(`Zoho non ha concesso l'accesso${data.error ? ` (${data.error})` : ''}: riprova «Collega Zoho»`, 400);
  }
  await saveSetting(db, SETTING, {
    refresh: auth.encrypt(data.refresh_token), accounts, api_domain: data.api_domain || accounts.replace('accounts.zoho', 'www.zohoapis'),
    connected_by: userId, connected_at: new Date().toISOString(),
  }, userId);
  cache = null;
}

async function status(db) {
  const s = await getSetting(db, SETTING);
  return { configured: configured(), connected: Boolean(s?.refresh), connected_at: s?.connected_at || null };
}

async function disconnect(db) {
  await db.query('DELETE FROM settings WHERE key = $1', [SETTING]);
  cache = null;
}

// token di accesso (un'ora), rinnovato dal refresh token
let cache = null;
async function accessToken(db, auth, doFetch = fetch) {
  if (cache && cache.exp > Date.now() + 60_000) return cache;
  const s = await getSetting(db, SETTING);
  if (!s?.refresh) throw new ZohoError('Zoho non è ancora collegato: premi «Collega Zoho»', 400);
  let refresh;
  try { refresh = auth.decrypt(s.refresh); } catch { throw new ZohoError('Il collegamento con Zoho va rifatto: premi «Ricollega»', 400); }
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId(), client_secret: clientSecret() });
  const res = await doFetch(`${s.accounts}/oauth/v2/token`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new ZohoError('Zoho non accetta più il collegamento: premi «Ricollega»', 403);
  cache = { token: data.access_token, apiDomain: data.api_domain || s.api_domain, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cache;
}

module.exports = { SCOPES, ZohoError, authorizeUrl, finishConnect, status, disconnect, accessToken, configured };
