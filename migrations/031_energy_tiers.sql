-- Alma Energy: parametri dei tier regolabili dal software (ALM2-22).

-- Un valore per insieme di parametri: 'screening' (punteggio dei tetti) e 'database_ce' (priorità del revamping).
CREATE TABLE energy_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chi ha cambiato i parametri e quando, con i valori di allora e quante priorità sono cambiate.
CREATE TABLE energy_settings_log (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  summary     JSONB NOT NULL DEFAULT '{}',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Convenzioni GSE: la priorità del file resta in priority_file; priority è quella in uso (del file o delle regole di
-- Alma Energy), score il punteggio delle regole.
ALTER TABLE energy_conventions ADD COLUMN priority_file TEXT NOT NULL DEFAULT '';
ALTER TABLE energy_conventions ADD COLUMN score DOUBLE PRECISION;
UPDATE energy_conventions SET priority_file = priority;
