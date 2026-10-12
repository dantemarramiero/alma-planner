# Alma Planet – regole di brand e UI

Alma Planet è l'intranet aziendale e lo strumento di project management di Almacis, usato solo dai collaboratori interni. Fa parte della famiglia visiva Almacis: arancione, grafite, Roboto e angoli quasi vivi. Queste regole valgono per **tutto** il software: ogni schermata, componente, email di sistema e documento esportato.

## Refresh grafico 2026 (12/10/2026, prevale sulle regole più sotto)
Il refresh fatto in Claude Design è `orbita/css/refresh.css`, caricato in `app.html` come **ultimo** foglio di stile. Il materiale di riferimento (anteprime, Gantt, README) è in `design/refresh/`. Dove le regole sotto dicono altro, valgono queste:
- **Angoli**: pulsanti e campi 12px, card 18px, finestre 22px; pillole per selettori, filtri e stati.
- **Fondo** caldo `#F7F6F3`, bordi leggeri `#ECEAE6`, ombre morbide calde (`--rf-shadow*`).
- **Barra laterale** bianca "sospesa" (staccata dai bordi, angoli 22px, ombra); la voce attiva è arancione piena con testo bianco.
- **Telefono**: barra in alto e barra in basso con effetto vetro; la barra in basso è una pillola sospesa.
- Il codice nuovo usa le classi che esistono già: il refresh le ritocca senza cambiare il JavaScript. Le scelte successive di Dante restano: nel Gantt le attività completate sono a righe verde chiaro e si vedono almeno 7 righe.

## File in questa cartella
- `tokens.css`: tutte le variabili. Importalo una volta all'entry point e usa **solo** queste variabili (niente colori hex sparsi nel codice).
- `logo/alma-planet-logo.svg` (scritta grafite, su fondi chiari) e `logo/alma-planet-logo-white.svg` (scritta bianca, su fondi scuri).
- `logo/alma-planet-symbol.svg` (arancione), `-white.svg` (su arancione o su foto), `-graphite.svg` (stampa monocromatica).
- `app-icon/`: icona 1024 (iOS, store), 512 e 192 (PWA/Android), 180 (apple-touch-icon), 32 e `favicon.svg`, più `android-foreground.svg` per l'icona adattiva (sfondo `#2C2C2C`).
- `Alma Planet Brand.html`: la scheda visiva di riferimento.

## Logo
- Nome: sempre **Alma Planet**, due parole, iniziali maiuscole. Mai "AlmaPlanet", "ALMA PLANET" o "AP".
- Nella scritta, "Alma" è Roboto Light (300), "Planet" è Roboto Bold (700) arancione. Non ricomporla a mano: usa gli SVG.
- Topbar e sidebar: logo con scritta, alto 28–32px. Sidebar compressa: solo il simbolo, 28px.
- Dimensione minima: simbolo 16px, logo con scritta 24px di altezza.
- Area di rispetto: attorno al logo lascia uno spazio libero pari almeno a metà altezza del simbolo.
- Sfondi ammessi: bianco, `#EFEFEF`, grafite `#2C2C2C`, grigio `#515151`. Su arancione usa solo il simbolo bianco.
- Vietato: ruotare, deformare, cambiare colori, aggiungere ombre o contorni, mettere il simbolo arancione su fondo arancione.

## Colori
- L'**arancione** (`--ap-accent`) è l'unico colore d'accento: azione primaria, elemento attivo in navigazione, link, focus, indicatori di avanzamento. Non usarlo per grandi superfici di sfondo né per il testo corrente.
- **Grafite** (`--ap-sidebar`) per sidebar e header scuri. **Grigio chiaro** (`--ap-surface`) per lo sfondo delle aree di contenuto; le card sono bianche sopra.
- Testo: `--ap-text` per il corpo, `--ap-text-strong` per i titoli, `--ap-text-muted` per meta e didascalie. Mai testo grigio chiaro sotto contrasto 4.5:1.
- Stati (successo, avviso, errore, info) solo per significato funzionale: stato di un task o di un progetto, messaggi di validazione. Mai decorativi.

## Tipografia
- Solo **Roboto** (300/400/500/700).
- Titoli di pagina: `--ap-fs-xl`, peso 300 con la parte chiave in 700 (lo stesso schema delle presentazioni Almacis), oppure tutto 500 nelle viste dense.
- Corpo: `--ap-fs-md`, peso 400, interlinea 1.5. Tabelle e liste dense: `--ap-fs-sm`.
- Etichette di sezione: `--ap-fs-xs`, maiuscolo, spaziatura 0.06em, arancione o `--ap-text-muted`.

## Forme e layout
- Angoli quasi vivi: `--ap-radius` (2px) su pulsanti, input e card; `--ap-radius-lg` al massimo. Niente pillole, tranne avatar e badge numerici.
- Card: sfondo bianco, bordo `--ap-border` da 1px, ombra solo `--ap-shadow` e solo su elementi sollevati (menu, dialog, drag).
- Il segno tipico Almacis è una **barra arancione di 4px sul lato superiore** di card o pannelli in evidenza, da usare con parsimonia. Non usare bordi colorati sul lato sinistro.
- Spaziature: solo la scala `--ap-space-*`. Pagina: margini 32px su desktop, 16px su mobile.
- Struttura base: sidebar grafite a sinistra (240px, comprimibile a 64px), topbar bianca alta 56px con ricerca e profilo, contenuto su `--ap-surface`.

## Componenti
- Pulsante primario: sfondo arancione, testo bianco, peso 500, hover `--ap-accent-hover`. Uno solo per vista.
- Pulsante secondario: bordo `--ap-border-strong`, testo `--ap-text-strong`, sfondo trasparente. Pulsante terziario: solo testo arancione.
- Input: altezza 40px, bordo `--ap-border-strong`, focus con bordo arancione più `--ap-focus`.
- Navigazione: la voce attiva ha il testo bianco e un indicatore arancione di 3px sul lato sinistro della voce, dentro la sidebar.
- Tabelle: intestazioni in maiuscoletto `--ap-fs-xs` muted, righe separate da `--ap-border`, hover di riga `--ap-surface`.
- Stati dei task: badge rettangolari piccoli (radius 2px) con il colore di stato tenue e il testo in tinta piena.
- Icone: Lucide (tratto 1.75px, 20px), colore `currentColor`. Niente emoji nell'interfaccia.

## Movimento
- Transizioni brevi e funzionali: `--ap-dur` con `--ap-ease` su hover, apertura menu e pannelli. Nessuna animazione decorativa o rimbalzo.

## Tono dei testi
- Italiano, "tu" verso il collaboratore, frasi brevi e concrete. "Progetti", "Attività", "Scadenze", "Documenti", "Persone".
- Pulsanti con verbo all'infinito: "Crea progetto", "Salva", "Assegna".
- Messaggi vuoti utili: dicono cosa manca e come rimediare ("Nessuna attività assegnata. Crea la prima attività del progetto.").

## Checklist prima di ogni PR
1. Nessun colore, font o spaziatura fuori da `tokens.css`.
2. Logo da SVG, alla dimensione e sugli sfondi ammessi.
3. Un solo pulsante primario arancione per vista.
4. Contrasto testo ≥ 4.5:1.
5. Favicon e icone app collegate da `app-icon/`.
