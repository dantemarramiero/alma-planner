// Chiamate alle API: JSON, header anti-CSRF, ritorno al login quando la sessione o Microsoft lo chiedono.
import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function relogin() {
  location.href = `/auth/login?returnTo=${encodeURIComponent('/app' + location.hash)}`;
}

export async function api(method, path, body, { quiet = false, raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['X-Alma'] = '1';
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(path, opts);
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && (data?.code === 'login' || data?.code === 'reauth')) {
      relogin();
      throw new ApiError(401, 'Accesso richiesto', data.code);
    }
    const err = new ApiError(res.status, data?.error || `Errore ${res.status}`, data?.code);
    if (!quiet) toast(err.message, 'err');
    throw err;
  }
  return data;
}

export const get = (path, opts) => api('GET', path, undefined, opts);
export const post = (path, body, opts) => api('POST', path, body ?? {}, opts);
export const put = (path, body, opts) => api('PUT', path, body, opts);
export const patch = (path, body, opts) => api('PATCH', path, body, opts);
export const del = (path, opts) => api('DELETE', path, undefined, opts);

export const qs = obj => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
