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
const { registerOrg } = require('./routes/org');
const { registerTeams } = require('./routes/teams');
const { registerProjectFiles } = require('./routes/project-files');
const { registerDirect } = require('./routes/direct');
const { registerMedia } = require('./routes/media');
const { registerFeed } = require('./routes/feed');
const { registerStories } = require('./routes/stories');
const { registerNotifications } = require('./routes/notifications');
const { createLive } = require('./lib/live');
const { createNotifier } = require('./lib/notifier');
const { createAccess } = require('./lib/access');
const { importMicrosoftPhoto, purgeMedia } = require('./lib/media');
const { rateLimit, createAudit } = require('./lib/security');
const { registerAudit } = require('./routes/audit');

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
    // Chiave per cifrare i token Microsoft salvati, separata da SESSION_SECRET (su Railway: variabile sealed).
    tokenKey: env.TOKEN_ENC_KEY?.trim() || null,
    databaseUrl: env.DATABASE_URL,
    dataDir: env.DATA_DIR || path.join(__dirname, 'data', 'pglite'),
    tenantId: env.MS_TENANT_ID?.trim(),
    clientId: env.MS_CLIENT_ID?.trim(),
    clientSecret: env.MS_CLIENT_SECRET?.trim(),
    devLogin: !production && env.DEV_LOGIN === '1',
    // Amministratori dell'intranet (post in evidenza, moderazione): email separate da virgole.
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    // Chat interna dell'intranet: nascosta (i messaggi passano da Teams), si riaccende con INTERNAL_CHAT=1.
    internalChat: env.INTERNAL_CHAT === '1',
  };
}

async function createApp(config, { db, confirmAccount } = {}) {
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

  const audit = createAudit(db);
  const auth = createAuth({
    db,
    config,
    audit,
    confirmAccount,
    onLogin: (userId, accessToken) => importMicrosoftPhoto(db, userId, accessToken)
      .catch(err => console.warn(`[foto] utente ${userId}: foto Microsoft non importata (${err.message})`)),
  });
  app.use((req, res, next) => auth.loadUser(req, res, next));
  const rekeyed = await auth.rekeyTokenCaches();
  if (rekeyed) console.log(`[auth] ${rekeyed} cache di token ricifrate con TOKEN_ENC_KEY`);

  // Limiti di frequenza: accesso per IP, API per utente (le modifiche più strette delle letture).
  const perMinute = 60 * 1000;
  app.use('/auth', rateLimit({ windowMs: perMinute, max: 30, key: req => req.ip, message: 'Troppi tentativi di accesso, riprova tra un minuto' }));
  const apiReads = rateLimit({ windowMs: perMinute, max: 600, key: req => req.user?.id });
  const apiWrites = rateLimit({ windowMs: perMinute, max: 120, key: req => req.user?.id });

  app.get('/healthz', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  auth.register(app);

  // Pagine
  const pub = path.join(__dirname, 'public');
  app.get('/', (req, res) => (req.user ? res.redirect('/app') : res.sendFile(path.join(pub, 'index.html'))));
  // Ogni deploy serve JS e CSS da /b/<deploy>/…: un browser con file vecchi in cache non può riusarli
  // (mescolare moduli vecchi e nuovi rompeva Gantt, chat e organigramma). I percorsi relativi degli
  // import restano sotto lo stesso /b/<deploy>/, quindi tutta l'app arriva dalla stessa versione.
  const build = (process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now())).replace(/[^\w-]/g, '').slice(0, 16);
  let appHtml = null;
  const renderApp = () => (appHtml = appHtml || require('fs').readFileSync(path.join(pub, 'app.html'), 'utf8')
    .replace(/(src|href)="\/(js|css)\//g, `$1="/b/${build}/$2/`));
  app.get('/app', (req, res) => (req.user
    ? res.set('Cache-Control', 'no-cache').type('html').send(config.production ? renderApp() : (appHtml = null, renderApp()))
    : res.redirect('/auth/login?returnTo=/app')));
  app.use('/b/:build', (req, res, next) => {
    // la versione corrente si tiene in cache a lungo; quelle vecchie (schede aperte prima del deploy) si ricontrollano
    const current = config.production && req.params.build === build;
    express.static(pub, { index: false, setHeaders: r => r.set('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'no-cache') })(req, res, next);
  });
  app.use('/vendor/frappe-gantt', express.static(path.join(__dirname, 'node_modules', 'frappe-gantt', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/fullcalendar', express.static(path.join(__dirname, 'node_modules', 'fullcalendar'), { maxAge: '7d' }));
  app.use('/vendor/fullcalendar-locales', express.static(path.join(__dirname, 'node_modules', '@fullcalendar', 'core', 'locales'), { maxAge: '7d' }));
  // no-cache: il browser ricontrolla sempre (ETag, risposta 304 se uguale). Con una cache a tempo, dopo un
  // aggiornamento mescolava moduli vecchi e nuovi e il Gantt chiamava API non più esistenti.
  app.use(express.static(pub, { index: false, setHeaders: res => res.set('Cache-Control', 'no-cache') }));

  // API: sempre con utente; le modifiche richiedono l'header X-Alma (protezione CSRF insieme a SameSite=Lax).
  app.use('/api', (req, res, next) => auth.requireUser(req, res, next));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Alma') !== '1') return next(new HttpError(403, 'Richiesta non valida'));
    next();
  });
  app.use('/api', (req, res, next) => (['GET', 'HEAD'].includes(req.method) ? apiReads : apiWrites)(req, res, next));
  app.use('/api', audit.middleware);
  app.use('/api', express.json({ limit: '1mb' }));

  const live = createLive();
  const isAdmin = req => config.adminEmails.includes(req.user.email);
  const deps = { db, auth, audit, baseUrl: config.baseUrl, live, isAdmin, internalChat: config.internalChat, notifier: createNotifier({ db, live }) };
  deps.access = createAccess({ db, isAdmin }); // chi vede quali progetti e ticket
  live.register(app);
  registerUsers(app, deps);
  registerProjects(app, deps);
  registerTickets(app, deps);
  registerCalendar(app, deps);
  registerDrive(app, deps);
  registerOrg(app, deps);
  registerTeams(app, { ...deps, tenantId: config.tenantId });
  registerProjectFiles(app, deps);
  registerMedia(app, deps);
  registerFeed(app, deps);
  registerStories(app, deps);
  registerNotifications(app, deps);
  registerAudit(app, deps);
  if (config.internalChat) registerDirect(app, deps);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Risorsa non trovata')));

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(`[errore] ${req.method} ${req.originalUrl}`, err);
    const message = status >= 500 && !(err instanceof HttpError) ? 'Errore interno, riprova' : err.message;
    if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
    res.status(status).send(message);
  });

  return { app, db, auth, live, audit };
}

if (require.main === module) {
  (async () => {
    const config = readConfig();
    const { app, db, auth, audit } = await createApp(config);
    setInterval(() => auth.purgeSessions().catch(() => {}), 6 * 3600 * 1000).unref();
    setInterval(() => audit.purge().catch(err => console.warn('[audit] pulizia non riuscita', err.message)), 24 * 3600 * 1000).unref();
    setInterval(() => purgeMedia(db).catch(err => console.warn('[media] pulizia non riuscita', err.message)), 6 * 3600 * 1000).unref();
    app.listen(config.port, () => {
      console.log(`Alma Planner su ${config.baseUrl} (porta ${config.port})`);
      if (!auth.msConfigured) {
        const missing = [['MS_TENANT_ID', config.tenantId], ['MS_CLIENT_ID', config.clientId], ['MS_CLIENT_SECRET', config.clientSecret]].filter(([, val]) => !val).map(([k]) => k);
        console.warn(`[auth] Microsoft non configurato: manca ${missing.join(', ')}`);
      }
      if (config.production && !config.tokenKey) console.warn('[auth] TOKEN_ENC_KEY mancante: i token Microsoft sono cifrati con la chiave derivata da SESSION_SECRET');
    });
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, readConfig };
