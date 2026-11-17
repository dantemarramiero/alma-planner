-- Dashboard di Alma (17/11/2026, canvas «v5 · Alma, l'assistente»: «Aggiungi alla dashboard»). Ogni riga è un grafico
-- che una persona ha tenuto: la ricerca che l'ha prodotto (strumento + input, rifatta con i suoi permessi quando apre la
-- dashboard), la spec del grafico (elenco, etichetta, valori, tipo) e l'ultima fotografia dei numeri. La vede solo lei.

CREATE TABLE assistant_dashboard (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  tool          TEXT NOT NULL,
  tool_input    JSONB NOT NULL DEFAULT '{}',
  spec          JSONB NOT NULL,
  snapshot      JSONB NOT NULL,
  sort          INT NOT NULL DEFAULT 0,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_error TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_dashboard_user ON assistant_dashboard (user_id, sort, id);
