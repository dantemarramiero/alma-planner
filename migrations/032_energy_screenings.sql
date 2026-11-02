-- Alma Energy: screening dei tetti per provincia da OpenStreetMap e PVGIS (ALM2-23).

-- Un giro di screening: le province scelte, la superficie minima e l'avanzamento (gira in background).
CREATE TABLE energy_screenings (
  id           SERIAL PRIMARY KEY,
  provinces    TEXT[] NOT NULL,                     -- sigle: {PE,CH}
  min_area     INTEGER NOT NULL,                    -- m² di tetto
  use_places   BOOLEAN NOT NULL DEFAULT false,      -- Google Places per gli edifici senza nome
  status       TEXT NOT NULL DEFAULT 'in_coda',     -- in_coda, in_corso, fermando, fatto, fermato, errore
  progress     JSONB NOT NULL DEFAULT '{}',         -- {provincia, fase, fatti, totale}
  summary      JSONB NOT NULL DEFAULT '{}',         -- per provincia: edifici, nuovi, aggiornati, priorità
  error        TEXT NOT NULL DEFAULT '',
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

-- Producibilità PVGIS per cella di 0,2° (kWh per kWp all'anno): una chiamata per cella, poi resta qui.
CREATE TABLE energy_pvgis_cells (
  cell        TEXT PRIMARY KEY,                     -- '42.3,14.1' (centro della cella)
  kwh_kwp     DOUBLE PRECISION NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
