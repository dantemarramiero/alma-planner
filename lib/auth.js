// Accesso con Microsoft (Entra ID, tenant Almacis) e sessioni.
//
// Flusso: /auth/login → Microsoft (codice + PKCE) → /auth/callback → sessione in tabella `sessions`.
// La cache MSAL di ogni utente (con il refresh token) è salvata cifrata in users.token_cache, così le
// chiamate a Graph (OneDrive, Outlook) funzionano anche a giorni di distanza senza rifare il login.
// Ogni REVALIDATE_HOURS la sessione si ricontrolla con Microsoft (refresh forzato): un account disattivato,
// con la password cambiata o con le sessioni revocate in Entra perde l'accesso anche qui.
const crypto = require('crypto');
const msal = require('@azure/msal-node');
const { HttpError } = require('./http');

const SCOPES = [
  'User.Read',
  'User.ReadBasic.All',     // cercare i colleghi da assegnare ai ticket
  'Files.ReadWrite.All',    // OneDrive personale e file condivisi
  'Calendars.ReadWrite',    // calendario Outlook
  'User.Read.All',          // organigramma: ruolo, reparto e responsabile di ogni persona
  'Chat.ReadWrite',         // Messaggi = chat di Teams
  'Mail.Send',              // email da Outlook
];
const SESSION_COOKIE = 'alma_sid';
const FLOW_COOKIE = 'alma_flow';
const SESSION_DAYS = 14;
const REVALIDATE_HOURS = 12;

// confirmAccount: sostituisce il ricontrollo con Microsoft (solo nei test).
function createAuth({ db, config, onLogin, audit, confirmAccount }) {
  const { tenantId, clientId, clientSecret, baseUrl, sessionSecret, tokenKey, devLogin } = config;
  const msConfigured = Boolean(tenantId && clientId && clientSecret);
  const secureCookies = baseUrl.startsWith('https://');
  // Chiave dei token: TOKEN_ENC_KEY, separata dal segreto dei cookie. Senza, si usa quella vecchia derivata da
  // SESSION_SECRET; le cache cifrate con la vecchia si ricifrano all'avvio (rekeyTokenCaches).
  const legacyKey = crypto.createHash('sha256').update(`alma-token-cache:${sessionSecret}`).digest();
  const v2Key = tokenKey ? crypto.createHash('sha256').update(`alma-token-cache-v2:${tokenKey}`).digest() : null;
  const redirectUri = `${baseUrl}/auth/callback`;

  // ── cifratura della cache dei token (AES-256-GCM) ──────────────────────────
  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', v2Key || legacyKey, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    const blob = [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
    return v2Key ? `v2.${blob}` : blob;
  }
  function decrypt(stored) {
    const v2 = stored.startsWith('v2.');
    if (v2 && !v2Key) throw new Error('cache cifrata con TOKEN_ENC_KEY, che ora manca');
    const [iv, tag, data] = (v2 ? stored.slice(3) : stored).split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', v2 ? v2Key : legacyKey, iv);
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
      if (needsLogin(err)) throw new HttpError(401, 'Serve un nuovo accesso con Microsoft', 'reauth');
      throw err;
    }
  }

  // Microsoft non rinnova più il token: serve un nuovo accesso. invalid_grant = account disattivato,
  // password cambiata o sessioni revocate in Entra (MSAL non lo classifica come «interaction required»).
  const needsLogin = err => err instanceof msal.InteractionRequiredAuthError || err?.errorCode === 'invalid_grant';

  // Refresh forzato verso Microsoft: true = account ancora valido, false = va rifatto l'accesso.
  // Altri errori (rete, Microsoft irraggiungibile) vengono rilanciati: la sessione resta e si riprova più tardi.
  async function confirmWithMicrosoft(userId) {
    const cca = clientFor(userId);
    const [account] = await cca.getTokenCache().getAllAccounts();
    if (!account) return false;
    try {
      await cca.acquireTokenSilent({ account, scopes: SCOPES, forceRefresh: true });
      return true;
    } catch (err) {
      if (needsLogin(err)) return false;
      throw err;
    }
  }

  // Toglie l'accesso a un utente: tutte le sue sessioni e i token Microsoft salvati.
  async function revokeUser(userId) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await db.query('UPDATE users SET token_cache = NULL WHERE id = $1', [userId]);
  }

  // All'avvio: ricifra con TOKEN_ENC_KEY le cache ancora cifrate con la chiave vecchia. Quelle illeggibili si
  // cancellano (l'utente rifà l'accesso).
  async function rekeyTokenCaches() {
    if (!v2Key) return 0;
    const { rows } = await db.query("SELECT id, token_cache FROM users WHERE token_cache IS NOT NULL AND token_cache NOT LIKE 'v2.%'");
    for (const r of rows) {
      let next = null;
      try { next = encrypt(decrypt(r.token_cache)); } catch { /* chiave vecchia diversa: si rifà l'accesso */ }
      await db.query('UPDATE users SET token_cache = $1 WHERE id = $2', [next, r.id]);
    }
    return rows.length;
  }

  // ── sessioni ───────────────────────────────────────────────────────────────
  const hashSid = sid => crypto.createHash('sha256').update(sid).digest('hex');

  async function startSession(res, userId) {
    const sid = crypto.randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hashSid(sid), userId]);
    setCookie(res, SESSION_COOKIE, sign(sid), SESSION_DAYS * 86400);
  }

  // Ricontrolli in corso o tentati da poco, per sessione: più richieste insieme chiamano Microsoft una volta sola,
  // e se Microsoft non risponde non lo si interroga a ogni richiesta.
  const checking = new Map(); // sessionId → Promise<boolean>
  const lastAttempt = new Map(); // sessionId → ms
  const RETRY_MS = 5 * 60 * 1000;

  // true = sessione ancora valida. Senza Microsoft configurato (sviluppo, test) non c'è nulla da ricontrollare.
  async function revalidate(sessionId, user) {
    if (!msConfigured && !confirmAccount) return true;
    if (!user.has_tokens && !confirmAccount) return false; // entrato con Microsoft ma i token non ci sono più: non si può ricontrollare
    if (!checking.has(sessionId)) {
      if (Date.now() - (lastAttempt.get(sessionId) || 0) < RETRY_MS) return true;
      lastAttempt.set(sessionId, Date.now());
      checking.set(sessionId, (async () => {
        try {
          if (!(await (confirmAccount || confirmWithMicrosoft)(user.id))) return false;
          await db.query('UPDATE sessions SET validated_at = now() WHERE id = $1', [sessionId]);
          lastAttempt.delete(sessionId);
          return true;
        } catch (err) {
          console.warn(`[auth] ricontrollo di ${user.email} non riuscito, riprovo più tardi: ${err.message}`);
          return true;
        } finally {
          checking.delete(sessionId);
        }
      })());
    }
    return checking.get(sessionId);
  }

  async function loadUser(req, _res, next) {
    const sid = unsign(readCookie(req, SESSION_COOKIE));
    if (sid) {
      const sessionId = hashSid(sid);
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.job_title, u.avatar_id, u.token_cache IS NOT NULL AS has_tokens,
                s.validated_at < now() - interval '${REVALIDATE_HOURS} hours' AS stale
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.expires_at > now()`, [sessionId]);
      let user = rows[0] || null;
      if (user?.stale && !(await revalidate(sessionId, user))) {
        await revokeUser(user.id);
        audit?.log(user.id, 'session_revoked', { ip: req.ip });
        console.warn(`[auth] accesso revocato per ${user.email}: Microsoft non conferma più l'account`);
        user = null;
      }
      if (user) {
        delete user.has_tokens;
        delete user.stale;
      }
      req.user = user;
      req.sessionId = user ? sessionId : null;
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
      audit?.log(userId, 'login', { ip: req.ip });
      onLogin?.(userId, result.accessToken); // es. foto del profilo da Microsoft 365, in sottofondo
      res.redirect(flow.returnTo || '/app');
    });

    // Esce da questo dispositivo; se non restano altre sessioni aperte cancella anche i token Microsoft salvati.
    app.post('/auth/logout', async (req, res) => {
      if (req.sessionId) {
        await db.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
        await db.query(
          `UPDATE users SET token_cache = NULL WHERE id = $1
              AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = $1 AND expires_at > now())`, [req.user.id]);
        audit?.log(req.user.id, 'logout', { ip: req.ip });
      }
      setCookie(res, SESSION_COOKIE, '', 0);
      res.json({ ok: true });
    });

    // Esce da tutti i dispositivi e cancella i token Microsoft salvati.
    app.post('/auth/logout-all', async (req, res) => {
      if (req.user) {
        await revokeUser(req.user.id);
        audit?.log(req.user.id, 'logout_all', { ip: req.ip });
      }
      setCookie(res, SESSION_COOKIE, '', 0);
      res.json({ ok: true });
    });

    // Solo in locale, senza Microsoft configurato: entra come utente di prova.
    if (devLogin && !msConfigured) {
      console.warn('[auth] DEV_LOGIN attivo: accesso di prova senza Microsoft');
      app.get('/auth/dev-login', async (req, res) => {
        const email = typeof req.query.email === 'string' && req.query.email.includes('@') ? req.query.email : 'dev@almacis.it';
        // nome.cognome@… → «Nome Cognome»
        const name = email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        const userId = await upsertUser({ oid: null, email, name });
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

  return { register, loadUser, requireUser, graphToken, upsertUser, purgeSessions, revokeUser, rekeyTokenCaches, encrypt, decrypt, msConfigured };
}

module.exports = { createAuth, SCOPES };
