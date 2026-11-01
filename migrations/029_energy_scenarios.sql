-- Alma Energy: scenari del simulatore salvati (ALM2-9). Uno scenario può stare su un'opportunità (più versioni) o
-- essere una bozza libera; quello «scelto» porta MW, capex e rendimento nella scheda e nel cruscotto.
CREATE TABLE energy_scenarios (
  id              SERIAL PRIMARY KEY,
  opportunity_id  INTEGER REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  model           TEXT NOT NULL CHECK (model IN ('fv_classico', 'revamping', 'ppa_onsite')),
  input           JSONB NOT NULL DEFAULT '{}',
  summary         JSONB NOT NULL DEFAULT '{}',     -- numeri principali, ricalcolati a ogni salvataggio
  chosen          BOOLEAN NOT NULL DEFAULT false,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX energy_scenarios_opp ON energy_scenarios (opportunity_id, created_at DESC);
CREATE UNIQUE INDEX energy_scenarios_chosen ON energy_scenarios (opportunity_id) WHERE chosen;
