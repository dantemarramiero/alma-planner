// Chiamate a Microsoft Graph con il token dell'utente.
const { HttpError } = require('./http');

const BASE = 'https://graph.microsoft.com/v1.0';
const TIMEZONE = 'Europe/Rome';

async function graph(token, method, path, { body, headers = {}, raw = false } = {}) {
  const url = path.startsWith('https://') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (isJson && data?.error?.message) || `Microsoft Graph ha risposto ${res.status}`;
    if (res.status === 401) throw new HttpError(401, 'Serve un nuovo accesso con Microsoft', 'reauth');
    if (res.status === 403) throw new HttpError(403, `Microsoft 365 non consente l'operazione: ${message}`);
    if (res.status === 404) throw new HttpError(404, 'Elemento non trovato su Microsoft 365');
    throw new HttpError(502, message);
  }
  return data;
}

// Segue @odata.nextLink fino a `max` elementi.
async function graphAll(token, path, { max = 1000, headers } = {}) {
  const out = [];
  let next = path;
  while (next && out.length < max) {
    const page = await graph(token, 'GET', next, { headers });
    out.push(...(page.value || []));
    next = page['@odata.nextLink'];
  }
  return out.slice(0, max);
}

// Stringa per le funzioni OData (search(q='...')).
const odataString = s => String(s).replace(/'/g, "''");

module.exports = { graph, graphAll, odataString, TIMEZONE };
