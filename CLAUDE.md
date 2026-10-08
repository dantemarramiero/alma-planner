# Alma Planet

Segui sempre le regole in `orbita/brand/CLAUDE.md` (brand e UI di Alma Planet).

- Tutta l'interfaccia sta in `orbita/`: `app.html`, `index.html`, `css/`, `js/`, `brand/`. Il server (`server.js`, `routes/`, `lib/`) la serve da lì.
- Colori, font, spaziature e angoli vengono solo da `orbita/brand/tokens.css`. In `orbita/css/app.css` ci sono nomi brevi (`--orange`, `--ink`, `--rule`…) che puntano ai token.
- Icone: Lucide, da `orbita/js/icons.js` (`icon('nome')`). Niente emoji nell'interfaccia.
- Si pubblica solo con la coda dei deploy (vedi il CLAUDE.md nella cartella home).

## Scelte di Dante che prevalgono sul brand (08/10/2026)
- **Angoli morbidi come prima**, non quasi vivi: pulsanti e campi 8px, card 10px, finestre 14px, badge e stati a pillola (`--radius`, `--radius-card`, `--radius-lg`, `--radius-pill` in `orbita/css/app.css`).
- **Barra laterale chiara** (bianca, voce attiva in tinta arancione), non grafite; il logo è quello con la scritta grafite.
