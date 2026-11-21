-- Banco di prova di Alma (21/11/2026, board V5-Impostazioni): un giro = 60 domande fisse con la risposta giusta letta
-- dai dati di quel momento. details: per domanda { id, area, testo, ok, note, saltata, secondi, cent }.
CREATE TABLE assistant_bench_runs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'in_corso', -- in_corso · finito · interrotto
  total         INTEGER NOT NULL DEFAULT 0,
  done          INTEGER NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  invented      INTEGER NOT NULL DEFAULT 0,
  proposals_ok  INTEGER NOT NULL DEFAULT 0,
  proposals_n   INTEGER NOT NULL DEFAULT 0,
  cost_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
  details       JSONB NOT NULL DEFAULT '[]',
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
