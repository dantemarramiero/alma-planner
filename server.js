// Alma Space — gestione del team interno Almacis.
const path = require('path');
const express = require('express');
const { createDb, migrate } = require('./lib/db');
const { backfillLags } = require('./lib/schedule');
const { createAuth } = require('./lib/auth');
const { HttpError } = require('./lib/http');
const { registerUsers } = require('./routes/users');
const { registerProjects } = require('./routes/projects');
const { registerAreas } = require('./routes/areas');
const { registerTickets } = require('./routes/tickets');
const { registerCalendar } = require('./routes/calendar');
const { registerDrive } = require('./routes/drive');
const { registerOrg } = require('./routes/org');
const { registerTeams } = require('./routes/teams');
const { registerProjectFiles } = require('./routes/project-files');
const { registerProjectEmails } = require('./routes/project-emails');
const { registerNotes } = require('./routes/notes');
const { registerProjectMeetings } = require('./routes/project-meetings');
const { registerMedia } = require('./routes/media');
const { registerFeed } = require('./routes/feed');
const { registerStories } = require('./routes/stories');
const { registerNotifications } = require('./routes/notifications');
const { registerRda } = require('./routes/rda');
const { registerDigest } = require('./routes/digest');
const { registerSearch } = require('./routes/search');
const { registerSoftware } = require('./routes/software');
const { registerIt } = require('./routes/it');
const { createSoftwareAccess } = require('./lib/software-proposals');
const { createDigest } = require('./lib/digest');
const { createLive } = require('./lib/live');
const { createNotifier } = require('./lib/notifier');
const { createAccess } = require('./lib/access');
const { importMicrosoftPhoto, purgeMedia } = require('./lib/media');
const { rateLimit, createAudit } = require('./lib/security');
const { registerAudit } = require('./routes/audit');
const { registerFleet } = require('./routes/fleet');
const { createFleet } = require('./lib/fleet');
const { registerEnergy } = require('./routes/energy');
const { registerBiglietti } = require('./routes/biglietti');
const { registerCantieri, syncFromBoss } = require('./routes/cantieri');
const { registerCrm } = require('./routes/crm');
const { registerCrmBusiness } = require('./routes/crm-business');
const { registerCrmFonti } = require('./routes/crm-fonti');
const { registerCrmSoa } = require('./routes/crm-soa');
const { registerCrmScrivo } = require('./routes/crm-scrivo');
const { createMailFake } = require('./lib/crm-scrivo-fake');
const { createPostaFake } = require('./lib/crm-posta-fake');
const { registerCrmPosta } = require('./routes/crm-posta');
const { registerCrmProgetti } = require('./routes/crm-progetti');
const { registerCrmCollegamenti } = require('./routes/crm-collegamenti');
const { registerCrmPunti } = require('./routes/crm-punti');
const { createCrmAccess } = require('./lib/crm');
const { createCrmSync } = require('./lib/crm-sync');
const { registerStrategy } = require('./routes/strategy');
const { registerPerformance } = require('./routes/performance');
const { registerIdeas } = require('./routes/ideas');
const { registerWelcome } = require('./routes/welcome');
const { createEnergyAccess } = require('./lib/energy');
const { createEnergyReminders } = require('./lib/energy-reminders');
const { createScreeningRunner } = require('./lib/energy-screening');
const { createPush } = require('./lib/push');
const { createAlerts } = require('./lib/alerts');
const { createTicketMail } = require('./lib/ticket-mail');
const { registerAlerts } = require('./routes/alerts');
const { registerAssistente } = require('./routes/assistente');
const { createGovernance } = require('./lib/impostazioni');
const { registerImpostazioni, startOrgNightly } = require('./routes/impostazioni');
const { registerOrganigramma } = require('./routes/organigramma');
const { registerHr, syncPeopleFromBoss } = require('./routes/hr');
const { registerHrOrg } = require('./routes/hr-org');
const { registerHrRec, purgeCandidates, remindApprovals } = require('./routes/hr-rec');

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
    // Alma HR fase 2 (Dante 21/11/2026): l'organigramma si modifica su BOSS; in Alma resta solo l'import. ORG_EDITABLE=1 lo riapre (test).
    orgEditable: env.ORG_EDITABLE === '1',
    // Amministratori dell'intranet (post in evidenza, moderazione): email separate da virgole.
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    // Alma, l'assistente: la chiave di Claude (senza, Alma resta spenta) e la modalità finta per provarla in locale.
    openaiKey: env.OPENAI_API_KEY?.trim() || null,
    apiWriteMax: Number(env.API_WRITE_MAX) > 0 ? Number(env.API_WRITE_MAX) : 120, // scritture al minuto per persona (alzato solo nei test lunghi)
    almaFake: env.ALMA_FAKE === '1',
  };
}

async function createApp(config, { db, confirmAccount, energyFetch, pushSender, crmFetchEvents, radarFetch, anacFetch, assistantClient, assistantRouter, almaMailer, almaMailReader, almaTranscriber, almaSpeaker, almaRealtime, postaFake } = {}) {
  db = db || await createDb({ url: config.databaseUrl, dataDir: config.dataDir });
  await migrate(db);
  await backfillLags(db); // collegamenti del Gantt di prima della 016: prendono lo scarto che hanno oggi

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
        "media-src 'self' blob:", // «Ascolta» di Alma: l'mp3 arriva dal server e si suona da un blob della pagina
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
  // Impostazioni uniche: ruoli (anche gli amministratori) e privacy, tenuti in memoria (lib/impostazioni.js)
  const gov = createGovernance({ db, adminEmails: config.adminEmails });
  await gov.reload();
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
  const apiWrites = rateLimit({ windowMs: perMinute, max: config.apiWriteMax || 120, key: req => req.user?.id });

  app.get('/healthz', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  auth.register(app);

  // Pagine
  const pub = path.join(__dirname, 'orbita'); // tutta l'interfaccia di Alma Space (HTML, CSS, JS, brand)
  app.get('/', (req, res) => (req.user ? res.redirect('/app') : res.sendFile(path.join(pub, 'index.html'))));
  // QR code dei mezzi: il link passa dal server (l'hash #/… si perderebbe nel login di Microsoft), poi apre il mezzo.
  app.get('/m/:token', (req, res) => {
    const token = String(req.params.token).replace(/[^\w-]/g, '').slice(0, 40);
    if (!req.user) return res.redirect(`/auth/login?returnTo=${encodeURIComponent(`/m/${token}`)}`);
    res.redirect(`/app#/mezzi/qr/${token}`);
  });
  // «Condividi» da Android (ALM2-48): di solito il service worker risponde da solo; se non c'è ancora (prima apertura),
  // il POST arriva qui e si va comunque ai biglietti, senza le foto.
  app.post('/condividi', (req, res) => res.redirect(303, req.user ? '/app#/crm/contatti/biglietti?condivisi=0' : '/auth/login?returnTo=/app'));
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
  // mappa delle opportunità di Alma Energy (fondo OpenStreetMap)
  app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
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
  // Privacy (Impostazioni → Privacy e visibilità): i livelli di chi chiede, area per area. Li leggono le due guardie
  // qui sotto e lib/access.js, lib/crm.js, lib/energy.js.
  app.use('/api', (req, _res, next) => { req.privacy = gov.levelsFor(req.user.email); next(); });
  app.use('/api/org', (req, _res, next) => next(req.privacy.persone === 'none' && !gov.isAdmin(req) ? new HttpError(403, 'L\'organigramma non è tra le cose che puoi vedere') : undefined));
  app.use('/api/mezzi', (req, _res, next) => next(req.privacy.mezzi === 'none' && !gov.isAdmin(req) ? new HttpError(403, 'I mezzi non sono tra le cose che puoi vedere') : undefined));
  app.use('/api/alma/chat', express.json({ limit: '12mb' })); // Alma: foto dei biglietti da visita (al massimo 5, già rimpicciolite)
  app.use('/api/hr/richieste/:id/candidati', express.json({ limit: '8mb' })); // Alma HR: CV caricati dal team HR
  app.use('/api', express.json({ limit: '1mb' }));

  const live = createLive();
  const isAdmin = gov.isAdmin; // ruolo «Amministratore» delle Impostazioni, più ADMIN_EMAILS come chiave di riserva
  const deps = { db, auth, audit, gov, config, baseUrl: config.baseUrl, live, isAdmin, adminEmails: config.adminEmails, radarFetch, anacFetch, notifier: createNotifier({ db, live }) };
  deps.access = createAccess({ db, isAdmin }); // chi vede quali progetti e ticket
  deps.softwareAccess = createSoftwareAccess({ db, isAdmin }); // censimento software: amministratori e team IT
  deps.digest = createDigest({ db, auth, baseUrl: config.baseUrl, notifier: deps.notifier, live }); // riepilogo del mattino e solleciti
  deps.energyAccess = createEnergyAccess({ db, isAdmin }); // Alma Energy: solo i membri della BU Energy
  deps.crmAccess = createCrmAccess({ db, isAdmin }); // CRM: la direzione vede tutto, gli altri le anagrafiche della loro ASA
  deps.energyReminders = createEnergyReminders({ db, notifier: deps.notifier }); // Alma Energy: promemoria delle scadenze
  // Alma Energy: screening dei tetti per provincia in background (nei test OpenStreetMap e PVGIS sono finti)
  deps.energyScreening = createScreeningRunner({ db, ...(energyFetch ? { fetchImpl: energyFetch, retryDelayMs: 0 } : {}) });
  // app sul telefono e i tre avvisi (nuovo post, ticket assegnato, A3) con campanella, telefono ed email
  deps.push = createPush({ db, auth, sender: pushSender || null });
  // CRM: incontri di Outlook collegati da soli e avviso «incontro senza note» (nei test il calendario è finto)
  deps.crmSync = createCrmSync({ db, auth, notifier: deps.notifier, push: deps.push, fetchEvents: crmFetchEvents });
  deps.alerts = createAlerts({ db, auth, notifier: deps.notifier, push: deps.push, ticketMail: createTicketMail({ db, auth, baseUrl: config.baseUrl }), baseUrl: config.baseUrl });
  deps.fleet = createFleet({ db, auth, baseUrl: config.baseUrl, notifier: deps.notifier, isAdmin, adminEmails: config.adminEmails }); // parco mezzi: disponibilità e promemoria
  live.register(app);
  registerUsers(app, deps);
  registerProjects(app, deps);
  registerAreas(app, deps);
  registerTickets(app, deps);
  registerCalendar(app, deps);
  registerDrive(app, deps);
  registerOrg(app, deps);
  registerTeams(app, { ...deps, tenantId: config.tenantId });
  registerProjectFiles(app, deps);
  registerProjectEmails(app, deps);
  registerNotes(app, deps);
  registerProjectMeetings(app, deps);
  registerMedia(app, deps);
  registerFeed(app, deps);
  registerCantieri(app, deps); // storie dai cantieri: foto, diario, post del giorno (cantieri = commesse BOSS, BSAL-1725)
  registerStories(app, deps);
  registerNotifications(app, deps);
  registerRda(app, deps);
  registerDigest(app, deps);
  registerSearch(app, deps);
  registerSoftware(app, deps);
  registerIt(app, deps);
  registerFleet(app, deps);
  registerEnergy(app, deps);
  registerCrm(app, deps); // CRM: lead, clienti, fornitori, partner, concorrenti e contatti, per ASA
  registerCrmScrivo(app, { ...deps, mailFake: !auth.msConfigured && (config.devLogin || process.env.NODE_TEST_CONTEXT) ? createMailFake() : null }); // CRM: «Persone con cui mi scrivo» dalla propria posta
  registerBiglietti(app, deps); // Biglietti da visita: «Il mio biglietto» con QR, pagina pubblica /biglietto/:token
  registerCrmBusiness(app, deps); // CRM: Nuovi business (iniziative, chat, clienti target, gap, piano, analisi)
  registerCrmFonti(app, deps); // CRM: «Da dove vengono i dati» (fonti, completezza, limiti) per Mercato e Concorrenza
  registerCrmSoa(app, deps); // CRM: attestazioni SOA di ANAC (chi è qualificato in zona, scheda impresa)
  const posta = registerCrmPosta(app, { ...deps, mailFake: !auth.msConfigured && (config.devLogin || process.env.NODE_TEST_CONTEXT) ? (postaFake || createPostaFake({ autoArriveMs: process.env.NODE_TEST_CONTEXT ? 0 : 120000 })) : null }); // CRM: Posta e progetto da una email (ALM2-55)
  registerCrmProgetti(app, { ...deps, posta }); // CRM: «Porta avanti» → progetto di Alma Space, «I miei progetti», rendiconto
  registerCrmCollegamenti(app, deps); // CRM: aziende e persone collegate a gare, opportunità e progetti, con il ruolo
  registerCrmPunti(app, deps); // CRM: punti di contatto trovati da soli (Collega · Chiedi un'introduzione · Non c'entra)
  registerStrategy(app, deps); // Alma Strategy: Hoshin Kanri (vista d'insieme, Gestione, A3)
  registerPerformance(app, deps); // Alma Strategy: performance management (scheda, obiettivi, team, mansionario)
  registerIdeas(app, deps); // Alma Agorà: Laboratorio delle idee e pagina di benvenuto
  registerWelcome(app, deps); // Alma Agorà: dati della nuova pagina di benvenuto (sondaggi, eventi, organigramma, «Grazie a…»)
  registerAlerts(app, deps); // preferenze delle notifiche e telefoni iscritti
  // Alma, l'assistente (nei test il Claude è finto: assistantClient); la modalità finta solo con DEV_LOGIN
  const alma = registerAssistente(app, { ...deps, assistantClient, assistantRouter, almaMailer, almaMailReader, almaTranscriber, almaSpeaker, almaRealtime, openaiKey: config.openaiKey, almaFake: config.devLogin && config.almaFake });
  registerHr(app, deps); // Alma HR: persone da BOSS, ruoli sugli incarichi, mansionario, salary grade (RAL solo al team HR)
  registerHrOrg(app, deps); // Alma HR fase 2: organigramma in sola lettura (dati da BOSS), costo, scenari, cambi da BOSS, Strategy
  registerHrRec(app, deps); // Alma HR fase 3: richieste di personale, annunci, «Lavora con noi», candidati, offerte, pre-boarding
  registerOrganigramma(app, deps); // organigramma a incarichi, come BOSS (Impostazioni → Organigramma e ruoli)
  registerImpostazioni(app, deps); // Impostazioni uniche: organigramma e ruoli, utenti, costi AI, privacy, registro, integrazioni
  registerAudit(app, deps);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Risorsa non trovata')));

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(`[errore] ${req.method} ${req.originalUrl}`, err);
    const message = status >= 500 && !(err instanceof HttpError) ? 'Errore interno, riprova' : err.message;
    if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
    res.status(status).send(message);
  });

  return { app, db, auth, live, audit, alma, gov, digest: deps.digest, fleet: deps.fleet, energyReminders: deps.energyReminders, energyScreening: deps.energyScreening, crmSync: deps.crmSync };
}

if (require.main === module) {
  (async () => {
    const config = readConfig();
    const { app, db, auth, audit, gov, live, digest, fleet, energyReminders, energyScreening, crmSync } = await createApp(config);
    crmSync.start(); // ogni 15 minuti i calendari (incontri con i contatti del CRM), ogni 5 gli incontri finiti senza note
    digest.start();
    energyReminders.start(); // ogni 5 minuti, di giorno: scadenze delle opportunità di Alma Energy
    energyScreening.start().catch(err => console.warn('[energy] screening non ripartito', err.message)); // giri in coda dopo un riavvio
    fleet.start(); // ogni 5 minuti: promemoria di riconsegna (a chi ha il mezzo e ai gestori) e delle scadenze dei mezzi // ogni 5 minuti: solleciti nell'app e riepiloghi del mattino (ora italiana, giorni lavorativi)
    setInterval(() => auth.purgeSessions().catch(() => {}), 6 * 3600 * 1000).unref();
    gov.start(); // ruoli e privacy riletti ogni 5 minuti
    startOrgNightly({ db, auth, gov }); // organigramma da Entra ogni notte alle 3
    setInterval(() => audit.purge(730).catch(err => console.warn('[audit] pulizia non riuscita', err.message)), 24 * 3600 * 1000).unref();
    setInterval(() => purgeMedia(db).catch(err => console.warn('[media] pulizia non riuscita', err.message)), 6 * 3600 * 1000).unref();
    // cantieri da BOSS (BSAL-1725): ogni ora, solo quando BOSS_CANTIERI_URL e BOSS_CANTIERI_TOKEN ci sono
    // Alma HR: persone e RAL da BOSS ogni notte, solo quando BOSS_PERSONALE_URL e BOSS_PERSONALE_TOKEN ci sono
    setInterval(() => purgeCandidates(db).then(n => n && console.log('[hr] CV cancellati: ' + n)).catch(err => console.warn('[hr] cancellazione CV non riuscita', err.message)), 24 * 3600 * 1000).unref(); // CV dei non assunti
    const hrNotifier = createNotifier({ db, live });
    setInterval(() => remindApprovals(db, gov, hrNotifier).catch(err => console.warn('[hr] solleciti non riusciti', err.message)), 24 * 3600 * 1000).unref(); // approvazioni ferme da 2 giorni lavorativi
    if (process.env.BOSS_PERSONALE_URL) setInterval(() => syncPeopleFromBoss(db).then(() => registerHrRec.checkArrivals?.()).catch(err => console.warn('[hr] sincronizzazione da BOSS non riuscita', err.message)), 24 * 3600 * 1000).unref();
    if (process.env.BOSS_CANTIERI_URL) setInterval(() => syncFromBoss(db).catch(err => console.warn('[cantieri] sincronizzazione da BOSS non riuscita', err.message)), 3600 * 1000).unref();
    app.listen(config.port, () => {
      console.log(`Alma Space su ${config.baseUrl} (porta ${config.port})`);
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
