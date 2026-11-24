-- Alma Energy · Radar energia nel CRM verticale (ALM2-74 tappa 3, tavola «CRM verticale · Radar energia» approvata da
-- Dante il 24/11/2026). Solo segnali per chi possiede e sviluppa impianti (IPP): cessioni, autorizzazioni da comprare,
-- revamping e Conto Energia dal Database CE, esiti delle aste FER. Fonti: Database CE, radar di Alma Impianti
-- (fotovoltaico e biometano, letto una volta sola), ricerca web propria (cessioni e aste FER), segnali a mano.
-- «Prendi» porta il venditore nel CRM di Energy, crea l'opportunità e la bozza di analisi.
CREATE TABLE IF NOT EXISTS energy_signals (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('cessione', 'autorizzazione', 'revamping', 'conto_energia', 'asta_fer', 'notizia')),
  source          TEXT NOT NULL CHECK (source IN ('database_ce', 'impianti', 'web', 'manuale')),
  external_id     TEXT NOT NULL,                          -- niente doppioni: ce:<proprietario>, imp:<id>, url
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  summary         TEXT NOT NULL DEFAULT '',
  why             TEXT NOT NULL DEFAULT '',
  entity          TEXT NOT NULL DEFAULT '',               -- venditore, proprietario o sviluppatore come scritto nella fonte
  region          TEXT NOT NULL DEFAULT '',
  place           TEXT NOT NULL DEFAULT '',
  mw              NUMERIC(12,4),
  amount          NUMERIC,
  url             TEXT NOT NULL DEFAULT '',
  published_on    DATE,
  deadline        DATE,
  data            JSONB NOT NULL DEFAULT '{}',            -- dati della fonte (chiave del proprietario CE, incassi, settore…)
  score           INTEGER NOT NULL DEFAULT 0,
  score_parts     JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'preso', 'scartato')),
  discard_reason  TEXT NOT NULL DEFAULT '',
  opportunity_id  INTEGER REFERENCES energy_opportunities(id) ON DELETE SET NULL,
  analysis_id     INTEGER REFERENCES energy_analyses(id) ON DELETE SET NULL,
  cost_eur        NUMERIC NOT NULL DEFAULT 0,
  decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_id)
);
CREATE INDEX IF NOT EXISTS energy_signals_status ON energy_signals (status, score DESC);

-- Giri del radar: quando, cosa ha trovato per fonte, quanto è costata la ricerca web.
CREATE TABLE IF NOT EXISTS energy_radar_runs (
  id        SERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  added     JSONB NOT NULL DEFAULT '{}',
  cost_eur  NUMERIC NOT NULL DEFAULT 0,
  error     TEXT NOT NULL DEFAULT '',
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
