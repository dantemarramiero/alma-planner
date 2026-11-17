-- Concorrenza dai dati ANAC e «Prima del bando» (Dante 17/11/2026, punti 3 e 5 del win ratio).
-- Gare aggiudicate nelle nostre categorie (file mensili di dati.anticorruzione.it): chi vince, ribasso, offerenti.
CREATE TABLE crm_anac_awards (
  cig            TEXT PRIMARY KEY,
  object         TEXT NOT NULL DEFAULT '',
  sa_cf          TEXT NOT NULL DEFAULT '',          -- stazione appaltante
  sa_name        TEXT NOT NULL DEFAULT '',
  region         TEXT NOT NULL DEFAULT '',
  province       TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT '',          -- categoria prevalente senza spazi: OG1, OS2-A, FS…
  cpv            TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT '',          -- LAVORI, SERVIZI, FORNITURE
  base_amount    NUMERIC,
  amount         NUMERIC,
  discount       NUMERIC,                           -- ribasso di aggiudicazione in %
  bidders        INTEGER,
  criterion      TEXT NOT NULL DEFAULT '',          -- prezzo | oepv
  awarded_on     DATE,
  published_on   DATE,
  pnrr           BOOLEAN NOT NULL DEFAULT false,
  subcontract    BOOLEAN NOT NULL DEFAULT false,
  winners        JSONB NOT NULL DEFAULT '[]',       -- [{ cf, name, role: '' | mandataria | mandante | consorzio }]
  month          TEXT NOT NULL                      -- file ANAC da cui viene (AAAAMM)
);
CREATE INDEX crm_anac_awards_scope ON crm_anac_awards (category, awarded_on);
CREATE INDEX crm_anac_awards_cpv ON crm_anac_awards (cpv text_pattern_ops);
CREATE TABLE crm_anac_imports (
  month   TEXT PRIMARY KEY,
  awards  INTEGER NOT NULL DEFAULT 0,
  kept    INTEGER NOT NULL DEFAULT 0,
  error   TEXT NOT NULL DEFAULT '',
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Prima del bando: a che punto è l'opera e quando si aspetta la gara; «vinta_altri» = gara vinta da altri (subappalto/ATI)
ALTER TABLE crm_signals ADD COLUMN stage TEXT NOT NULL DEFAULT '' CHECK (stage IN ('', 'programmata', 'finanziata', 'progetto', 'determina', 'vinta_altri'));
ALTER TABLE crm_signals ADD COLUMN expected_on DATE;
