-- Alma Energy: Database impianti incentivati in Conto Energia (ALM2-12) e registro degli import (ALM2-10, ALM2-12).

-- Una riga per convenzione GSE, com'è nel file. Le opportunità del revamping raggruppano le convenzioni di un
-- proprietario (opportunity_id); quelle con priorità C, D o «Dati insufficienti» restano solo qui finché qualcuno
-- non le porta in pipeline.
CREATE TABLE energy_conventions (
  convention      TEXT PRIMARY KEY,                  -- numero della convenzione GSE: chiave per rifare l'import
  rank            INTEGER,
  priority        TEXT NOT NULL DEFAULT '',          -- A, B, C, D, Dati insufficienti
  owner_name      TEXT NOT NULL DEFAULT '',
  owner_vat       TEXT NOT NULL DEFAULT '',
  province        TEXT NOT NULL DEFAULT '',          -- della sede del proprietario, non dell'impianto
  region          TEXT NOT NULL DEFAULT '',
  owner_type      TEXT NOT NULL DEFAULT '',          -- Industriale, Energetica, Grande operatore…
  revenue_class   TEXT NOT NULL DEFAULT '',
  payments        JSONB NOT NULL DEFAULT '{}',       -- incassi GSE per anno: {"2016": 1234.5, …}
  avg_before      NUMERIC(16,2),                     -- incasso medio 2016-2019
  avg_recent      NUMERIC(16,2),                     -- incasso medio 2023-2025
  variation       DOUBLE PRECISION,                  -- -0.39 = -39%
  lost_per_year   NUMERIC(16,2),                     -- incassi persi €/anno
  trend           TEXT NOT NULL DEFAULT '',          -- Stabile, Progressivo, Improvviso (2024)…
  signals         TEXT[] NOT NULL DEFAULT '{}',      -- segnali ricavati dalle note
  notes           TEXT NOT NULL DEFAULT '',
  notes2          TEXT NOT NULL DEFAULT '',
  last_owner_change INTEGER,
  previous_owner  TEXT NOT NULL DEFAULT '',
  opportunity_id  INTEGER REFERENCES energy_opportunities(id) ON DELETE SET NULL,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX energy_conventions_owner ON energy_conventions (owner_vat);
CREATE INDEX energy_conventions_priority ON energy_conventions (priority);
CREATE INDEX energy_conventions_opp ON energy_conventions (opportunity_id);

-- Chi ha importato cosa e quando, con il riepilogo.
CREATE TABLE energy_imports (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,                         -- screening_tetti, database_ce
  file_name   TEXT NOT NULL DEFAULT '',
  summary     JSONB NOT NULL DEFAULT '{}',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
