# Alma Planner

Gestione del team interno Almacis: **progetti**, **ticket** assegnati a una o più persone, **Gantt** collegato ai progetti (i ticket compaiono come attività), **calendario Outlook** e **OneDrive**. Si entra con l'account Microsoft `@almacis.it`.

## Funzioni

| Area | Cosa fa |
|---|---|
| Ticket | Lista e bacheca (trascina tra Da fare / In corso / In revisione / Fatto), più assegnatari, priorità, inizio e scadenza, avanzamento, dipendenze, commenti, file OneDrive collegati |
| Progetti | Colore, stato, responsabile, avanzamento (ticket fatti / totali), cartella OneDrive, documenti. La durata è l'arco delle sue attività |
| Gantt di progetto | Il progetto è il titolo; le righe sono le attività, cioè i ticket del progetto con date. «+ Attività» crea un ticket (inizio, fine e almeno un responsabile obbligatori); il ticket in «Fatto» = attività completata (✓, sbiadita). Trascinare/allungare una barra cambia le date, la maniglia l'avanzamento |
| Gantt generale | Una barra per progetto lunga quanto le sue attività; un clic apre il Gantt del progetto |
| Documenti | File caricati nella cartella OneDrive del progetto (quelli di un ticket in una sottocartella «Ticket N - titolo») o collegati da OneDrive; la pagina del progetto mostra quelli del progetto e delle attività |
| Calendario | Eventi Outlook + ticket nello stesso calendario; crea, sposta e cancella eventi Outlook (anche riunioni Teams); un ticket si può mettere in calendario e l'evento segue le sue date |
| OneDrive | Il proprio OneDrive, i file condivisi, i recenti, ricerca, caricamento (anche trascinando), nuove cartelle, scaricamento |

## Struttura

- `server.js` — Express 5, intestazioni di sicurezza, rotte
- `lib/auth.js` — accesso con Microsoft (MSAL, codice + PKCE), sessioni su DB, cache dei token cifrata per utente
- `lib/db.js` — Postgres (`DATABASE_URL`) oppure PGlite in locale; migrazioni in `migrations/`
- `lib/graph.js` — chiamate a Microsoft Graph
- `routes/` — `projects`, `tickets`, `project-files` (documenti del progetto e caricamento file dei ticket), `users`, `calendar`, `drive`
- `lib/onedrive.js` — caricamento file su OneDrive (anche grandi, con sottocartelle)
- `orbita/` — **tutta l'interfaccia** (HTML, CSS, moduli JS, niente build) e in `orbita/brand/` il design system di Alma Planet: `tokens.css`, logo, icone, regole (`orbita/brand/CLAUDE.md`). Gantt con [Frappe Gantt](https://github.com/frappe/gantt), calendario con [FullCalendar](https://fullcalendar.io)

## In locale

```bash
npm install
DEV_LOGIN=1 npm run dev     # http://localhost:3000 — accesso di prova senza Microsoft, dati in ./data/pglite
npm test
```

Con `MS_TENANT_ID`, `MS_CLIENT_ID` e `MS_CLIENT_SECRET` impostati l'accesso di prova si spegne e si entra con Microsoft (serve `http://localhost:3000/auth/callback` tra gli URI di reindirizzamento dell'app).

## Variabili

| Variabile | Obbligatoria | Note |
|---|---|---|
| `DATABASE_URL` | in produzione | Postgres di Railway (`${{Postgres.DATABASE_URL}}`) |
| `SESSION_SECRET` | in produzione | stringa casuale lunga; firma i cookie e cifra i token Microsoft salvati |
| `MS_TENANT_ID` | sì | ID del tenant Almacis (Entra ID) |
| `MS_CLIENT_ID` | sì | ID applicazione (client) della registrazione |
| `MS_CLIENT_SECRET` | sì | segreto client della registrazione |
| `BASE_URL` | no | URL pubblico; su Railway si ricava da `RAILWAY_PUBLIC_DOMAIN` |
| `DEV_LOGIN` | no | `1` = accesso di prova, solo fuori produzione e senza Microsoft configurato |

## Registrazione dell'app in Microsoft Entra ID

Portale Azure → **Microsoft Entra ID → Registrazioni app → Nuova registrazione**:

1. Nome `Alma Planner`, tipo di account **Solo questa directory organizzativa (Almacis)**.
2. URI di reindirizzamento, piattaforma **Web**: `https://<dominio-railway>/auth/callback` (e `http://localhost:3000/auth/callback` per lo sviluppo).
3. **Certificati e segreti → Nuovo segreto client** → copiare il *Valore* in `MS_CLIENT_SECRET`.
4. **Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate**: `User.Read`, `User.ReadBasic.All`, `Files.ReadWrite.All`, `Calendars.ReadWrite`, `offline_access`, `openid`, `profile` → **Concedi il consenso amministratore per Almacis**.
5. Dalla pagina *Panoramica* copiare **ID applicazione (client)** → `MS_CLIENT_ID` e **ID della directory (tenant)** → `MS_TENANT_ID`.

Il segreto client scade (massimo 24 mesi): segnarsi la data e rinnovarlo prima.

## Deploy

Railway, progetto `alma-planner`: servizio `alma-planner` collegato a questa repo (deploy automatico da `main`) + servizio `Postgres`. Le migrazioni partono da sole all'avvio. Controllo di salute: `/healthz`.
