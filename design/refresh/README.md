# Alma Planet – refresh grafico

Ritocchi visivi per tutta l'app, computer e telefono. È un solo foglio di stile, `refresh.css`: usa le classi che l'app ha già e non richiede modifiche al JavaScript.

## Contenuto
- `refresh.css`: **il file da mettere nell'app**.
- `index.html`: anteprima per computer con tutte le schermate. Il pulsante Prima / Dopo in basso a destra confronta la versione attuale con quella ritoccata.
- `Telefono.html`: anteprima di 12 schermate su telefono. Va aperta con la cartella intera, perché carica `index.html`.
- `gantt.html`: riferimento per il nuovo Gantt (file unico).
- `src/`: copie dei CSS attuali dell'app, servono solo alle anteprime.

## Istruzioni per Claude Code
1. Copia `refresh.css` in `orbita/css/refresh.css`.
2. In `orbita/app.html` aggiungi `<link rel="stylesheet" href="/css/refresh.css">` come **ultimo** foglio di stile, dopo `search.css`.
3. Rifai la pagina Gantt seguendo `gantt.html`, con i dati veri da `lib/schedule.js` e dalle API dei ticket.
4. Aggiorna `orbita/brand/CLAUDE.md` con queste regole:
   - angoli: pulsanti e campi 12px, card 18px, finestre 22px, pillole per selettori, filtri e stati;
   - fondo caldo `#F7F6F3`;
   - barra laterale bianca sospesa, con la voce attiva arancione piena;
   - sul telefono, barra in basso a pillola sospesa con effetto vetro.
5. Controlla tutte le pagine a 1440px, 1024px e 390px. Le anteprime usano dati di esempio: se una pagina vera ha elementi non presenti qui, adeguali con le stesse regole.

Prompt da incollare in Claude Code:
"Applica il refresh grafico: segui brand/refresh/README.md, aggiungi refresh.css come ultimo CSS in app.html, rifai il Gantt come gantt.html e aggiorna orbita/brand/CLAUDE.md con le nuove regole su angoli, fondo e barre."
