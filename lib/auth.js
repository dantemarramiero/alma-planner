// Accesso con Microsoft (Entra ID, tenant Almacis) e sessioni.
//
// Flusso: /auth/login → Microsoft (codice + PKCE) → /auth/callback → sessione in tabella `sessions`.
// La cache MSAL di ogni utente (con il refresh token) è salvata cifrata in users.token_cache, così le
// chiamate a Graph (OneDrive, Outlook) funzionano anche a giorni di distanza senza rifare il login.
const crypto = require('crypto');
const msal = require('@azure/msal-node');
const { HttpError } = require('./http');

const SCOPES = [
  'User.Read',
  'User.ReadBasic.All',     // cercare i colleghi da assegnare ai ticket
  'Files.ReadWrite.All',    // OneDrive personale e file condivisi
  'Calendars.ReadWrite',    // calendario Outlook
  'User.Read.All',          // organigramma: ruolo, reparto e responsabile di ogni persona
];
const SESSION_COOKIE = 'alma_sid';
const FLOW_COOKIE = 'alma_flow';
const SESSION_DAYS = 30;

function createAuth({ db, config }) {
  const { tenantId, clientId, clientSecret, baseUrl, sessionSecret, devLogin } = config;
  const msConfigured = Boolean(tenantId && clientId && clientSecret);
  const secureCookies = baseUrl.startsWith('https://');
  const encKey = crypto.createHash('sha256').update(`alma-token-cache:${sessionSecret}`).digest();
  const redirectUri = `${baseUrl}/auth/callback`;

  // ── cifratura della cache dei token (AES-256-GCM) ──────────────────────────
  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
  }
  function decrypt(blob) {
    const [iv, tag, data] = blob.split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  }

  // ── cookie firmati ─────────────────────────────────────────────────────────
  const sign = value => `${value}.${crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url')}`;
  function unsign(signed) {
    if (!signed) return null;
    const i = signed.lastIndexOf('.');
    if (i < 0) return null;
    const value = signed.slice(0, i);
    const a = Buffer.from(sign(value)), b = Buffer.from(signed);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
  }
  function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
    return null;
  }
  function setCookie(res, name, value, maxAgeSec) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  // ── MSAL ───────────────────────────────────────────────────────────────────
  const msalBase = {
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
    system: { loggerOptions: { logLevel: msal.LogLevel.Warning, piiLoggingEnabled: false, loggerCallback: (_l, m) => console.warn('[msal]', m) } },
  };
  // Un client MSAL per richiesta, con la cache dell'utente letta e riscritta su DB.
  function clientFor(userId) {
    return new msal.ConfidentialClientApplication({
      ...msalBase,
      cache: {
        cachePlugin: {
          async beforeCacheAccess(ctx) {
            const { rows } = await db.query('SELECT token_cache FROM users WHERE id = $1', [userId]);
            if (rows[0]?.token_cache) {
              try { ctx.tokenCache.deserialize(decrypt(rows[0].token_cache)); } catch { /* chiave cambiata: si rifà il login */ }
            }
          },
          async afterCacheAccess(ctx) {
            if (ctx.cacheHasChanged) {
              await db.query('UPDATE users SET token_cache = $1 WHERE id = $2', [encrypt(ctx.tokenCache.serialize()), userId]);
            }
          },
        },
      },
    });
  }

  // Token Graph per l'utente; se il refresh token non vale più → 401 «reauth» e il browser rifà il login.
  async function graphToken(userId) {
    if (!msConfigured) throw new HttpError(503, 'Microsoft 365 non è ancora collegato (manca la registrazione dell\'app in Entra ID)', 'ms_not_configured');
    const cca = clientFor(userId);
    const [account] = await cca.getTokenCache().getAllAccounts();
    if (!account) throw new HttpError(401, 'Serve un nuovo accesso con Microsoft', 'reauth');
    try {
      const result = await cca.acquireTokenSilent({ account, scopes: SCOPES });
      return result.accessToken;
    } catch (err) {
      if (err instanceof msal.InteractionRequiredAuthError) throw new HttpError(401, 'Serve un nuovo accesso con Microsoft', 'reauth');
      throw err;
    }
  }

  // ── sessioni ───────────────────────────────────────────────────────────────
  const hashSid = sid => crypto.createHash('sha256').update(sid).digest('hex');

  async function startSession(res, userId) {
    const sid = crypto.randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hashSid(sid), userId]);
    setCookie(res, SESSION_COOKIE, sign(sid), SESSION_DAYS * 86400);
  }

  async function loadUser(req, _res, next) {
    const sid = unsign(readCookie(req, SESSION_COOKIE));
    if (sid) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.job_title FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.expires_at > now()`, [hashSid(sid)]);
      req.user = rows[0] || null;
      req.sessionId = rows[0] ? hashSid(sid) : null;
    }
    next();
  }

  function requireUser(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Accesso richiesto', 'login'));
    next();
  }

  async function upsertUser({ oid, email, name, jobTitle }) {
    const { rows } = await db.query(
      `INSERT INTO users (oid, email, name, job_title, last_login) VALUES ($1, lower($2), $3, $4, now())
       ON CONFLICT (email) DO UPDATE SET oid = COALESCE(EXCLUDED.oid, users.oid), name = EXCLUDED.name,
              job_title = COALESCE(EXCLUDED.job_title, users.job_title), last_login = now()
       RETURNING id`, [oid, email, name, jobTitle || null]);
    return rows[0].id;
  }

  // ── rotte /auth ────────────────────────────────────────────────────────────
  function register(app) {
    app.get('/auth/login', async (req, res) => {
      const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//')
        ? req.query.returnTo : '/app';
      if (!msConfigured) {
        if (devLogin) return res.redirect(`/auth/dev-login?returnTo=${encodeURIComponent(returnTo)}`);
        return res.status(503).send('Accesso con Microsoft non configurato: impostare MS_TENANT_ID, MS_CLIENT_ID e MS_CLIENT_SECRET.');
      }
      const cp = new msal.CryptoProvider();
      const { verifier, challenge } = await cp.generatePkceCodes();
      const state = crypto.randomBytes(16).toString('base64url');
      setCookie(res, FLOW_COOKIE, sign(Buffer.from(JSON.stringify({ state, verifier, returnTo })).toString('base64url')), 600);
      const url = await new msal.ConfidentialClientApplication(msalBase).getAuthCodeUrl({
        scopes: SCOPES, redirectUri, state, codeChallenge: challenge, codeChallengeMethod: 'S256', prompt: 'select_account',
      });
      res.redirect(url);
    });

    app.get('/auth/callback', async (req, res) => {
      const raw = unsign(readCookie(req, FLOW_COOKIE));
      setCookie(res, FLOW_COOKIE, '', 0);
      if (req.query.error) return res.status(400).send(`Accesso non riuscito: ${String(req.query.error_description || req.query.error).slice(0, 300)}`);
      if (!raw) return res.redirect('/auth/login');
      const flow = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (flow.state !== req.query.state) return res.status(400).send('Accesso non riuscito: stato non valido, riprova.');

      // Primo scambio con cache in memoria; poi la cache passa all'utente su DB.
      const cca = new msal.ConfidentialClientApplication(msalBase);
      const result = await cca.acquireTokenByCode({ code: String(req.query.code), scopes: SCOPES, redirectUri, codeVerifier: flow.verifier });
      const claims = result.idTokenClaims || {};
      if (claims.tid && claims.tid !== tenantId) return res.status(403).send('Questo account non appartiene al tenant Almacis.');
      const email = claims.preferred_username || result.account?.username;
      if (!email) return res.status(400).send('Accesso non riuscito: email mancante.');
      const userId = await upsertUser({ oid: claims.oid, email, name: claims.name || email });
      await db.query('UPDATE users SET token_cache = $1 WHERE id = $2', [encrypt(cca.getTokenCache().serialize()), userId]);
      await startSession(res, userId);
      res.redirect(flow.returnTo || '/app');
    });

    app.post('/auth/logout', async (req, res) => {
      if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
      setCookie(res, SESSION_COOKIE, '', 0);
      res.json({ ok: true });
    });

    // Solo in locale, senza Microsoft configurato: entra come utente di prova.
    if (devLogin && !msConfigured) {
      console.warn('[auth] DEV_LOGIN attivo: accesso di prova senza Microsoft');
      app.get('/auth/dev-login', async (req, res) => {
        const email = typeof req.query.email === 'string' && req.query.email.includes('@') ? req.query.email : 'dev@almacis.it';
        const userId = await upsertUser({ oid: null, email, name: email.split('@')[0] });
        await startSession(res, userId);
        const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//') ? req.query.returnTo : '/app';
        res.redirect(returnTo);
      });
    }
  }

  // Pulizia periodica delle sessioni scadute.
  async function purgeSessions() {
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
  }

  return { register, loadUser, requireUser, graphToken, upsertUser, purgeSessions, msConfigured };
}

module.exports = { createAuth, SCOPES };
