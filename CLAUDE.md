# Alma Planet

Segui sempre le regole in `orbita/brand/CLAUDE.md` (brand e UI di Alma Planet).

- Tutta l'interfaccia sta in `orbita/`: `app.html`, `index.html`, `css/`, `js/`, `brand/`. Il server (`server.js`, `routes/`, `lib/`) la serve da lì.
- Colori, font, spaziature e angoli vengono solo da `orbita/brand/tokens.css`. In `orbita/css/app.css` ci sono nomi brevi (`--orange`, `--ink`, `--rule`…) che puntano ai token.
- Icone: Lucide, da `orbita/js/icons.js` (`icon('nome')`). Niente emoji nell'interfaccia.
- Si pubblica solo con la coda dei deploy (vedi il CLAUDE.md nella cartella home).

## Scelte di Dante che prevalgono sul brand
- **Refresh grafico (12/10/2026)**: `orbita/css/refresh.css`, ultimo foglio di stile in `app.html`; regole in `orbita/brand/CLAUDE.md` («Refresh grafico 2026»), riferimenti in `design/refresh/`. Angoli 12px (pulsanti e campi), 18px (card), 22px (finestre), pillole per selettori, filtri e stati; fondo caldo `#F7F6F3`; barra laterale bianca sospesa con voce attiva arancione piena; sul telefono barra in basso a pillola sospesa con effetto vetro. Sostituisce gli angoli 8/10/14 dell'08/10.
- **Barra laterale chiara** (bianca), non grafite; il logo è quello con la scritta grafite.
- **Gantt** (12/10/2026): attività completate a righe verde chiaro, almeno 7 righe visibili.
