// Alma Planner — gestione del team interno Almacis.
const path = require('path');
const express = require('express');
const { createDb, migrate } = require('./lib/db');
const { createAuth } = require('./lib/auth');
const { HttpError } = require('./lib/http');
const { registerUsers } = require('./routes/users');
const { registerProjects } = require('./routes/projects');
const { registerTickets } = require('./routes/tickets');
const { registerCalendar } = require('./routes/calendar');
const { registerDrive } = require('./routes/drive');

function readConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const production = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT);
  const baseUrl = (env.BASE_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)).replace(/\/$/, '');
  const sessionSecret = env.SESSION_SECRET || (production ? null : 'solo-sviluppo-locale');
  if (!sessionSecret) throw new Error('SESSION_SECRET mancante: impostala nelle variabili del servizio.');
  return {
    port,
    production,
    baseUrl,
    sessionSecret,
    databaseUrl: env.DATABASE_URL,
    dataDir: env.DATA_DIR || path.join(__dirname, 'data', 'pglite'),
    tenantId: env.MS_TENANT_ID?.trim(),
    clientId: env.MS_CLIENT_ID?.trim(),
    clientSecret: env.MS_CLIENT_SECRET?.trim(),
    devLogin: !production && env.DEV_LOGIN === '1',
  };
}

async function createApp(config, { db } = {}) {
  db = db || await createDb({ url: config.databaseUrl, dataDir: config.dataDir });
  await migrate(db);

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://login.microsoftonline.com",
      ].join('; '),
    });
    if (config.baseUrl.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  const auth = createAuth({ db, config });
  app.use((req, res, next) => auth.loadUser(req, res, next));

  app.get('/healthz', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  auth.register(app);

  // Pagine
  const pub = path.join(__dirname, 'public');
  app.get('/', (req, res) => (req.user ? res.redirect('/app') : res.sendFile(path.join(pub, 'index.html'))));
  app.get('/app', (req, res) => (req.user ? res.sendFile(path.join(pub, 'app.html')) : res.redirect('/auth/login?returnTo=/app')));
  app.use('/vendor/frappe-gantt', express.static(path.join(__dirname, 'node_modules', 'frappe-gantt', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/fullcalendar', express.static(path.join(__dirname, 'node_modules', 'fullcalendar'), { maxAge: '7d' }));
  app.use('/vendor/fullcalendar-locales', express.static(path.join(__dirname, 'node_modules', '@fullcalendar', 'core', 'locales'), { maxAge: '7d' }));
  app.use(express.static(pub, { index: false, maxAge: config.production ? '1h' : 0 }));

  // API: sempre con utente; le modifiche richiedono l'header X-Alma (protezione CSRF insieme a SameSite=Lax).
  app.use('/api', (req, res, next) => auth.requireUser(req, res, next));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Alma') !== '1') return next(new HttpError(403, 'Richiesta non valida'));
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  const deps = { db, auth, baseUrl: config.baseUrl };
  registerUsers(app, deps);
  registerProjects(app, deps);
  registerTickets(app, deps);
  registerCalendar(app, deps);
  registerDrive(app, deps);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Risorsa non trovata')));

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(`[errore] ${req.method} ${req.originalUrl}`, err);
    const message = status >= 500 && !(err instanceof HttpError) ? 'Errore interno, riprova' : err.message;
    if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
    res.status(status).send(message);
  });

  return { app, db, auth };
}

if (require.main === module) {
  (async () => {
    const config = readConfig();
    const { app, auth } = await createApp(config);
    setInterval(() => auth.purgeSessions().catch(() => {}), 6 * 3600 * 1000).unref();
    app.listen(config.port, () => {
      console.log(`Alma Planner su ${config.baseUrl} (porta ${config.port})`);
      if (!auth.msConfigured) {
        const missing = [['MS_TENANT_ID', config.tenantId], ['MS_CLIENT_ID', config.clientId], ['MS_CLIENT_SECRET', config.clientSecret]].filter(([, val]) => !val).map(([k]) => k);
        console.warn(`[auth] Microsoft non configurato: manca ${missing.join(', ')}`);
      }
    });
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, readConfig };
