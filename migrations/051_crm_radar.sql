-- Radar commerciale (Dante 14/11/2026, canvas «Segnale», «Piano d'azione», «Proposte dal radar»):
-- segnali per BU con punteggio, decisione Interessa / Scarta / altra BU, gare già bandite all'ufficio gare,
-- piano d'azione proposto dal playbook che diventa prossimi passi quando lo si accetta.

CREATE TABLE crm_signals (
  id              SERIAL PRIMARY KEY,
  source          TEXT NOT NULL,                     -- infordat, manuale, stampa, anac, …
  external_id     TEXT NOT NULL DEFAULT '',          -- codice nella fonte (CIG, id Infordat, url): niente doppioni
  kind            TEXT NOT NULL DEFAULT '',          -- tipo di segnale = id del playbook (gara per le gare già bandite)
  bu              TEXT REFERENCES crm_asa(key) ON DELETE SET NULL ON UPDATE CASCADE,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  why             TEXT NOT NULL DEFAULT '',          -- perché interessa alla BU
  entity          TEXT NOT NULL DEFAULT '',          -- ente o azienda come scritto nella fonte
  subject_id      INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  amount          NUMERIC,
  region          TEXT NOT NULL DEFAULT '',
  place           TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  published_on    DATE,
  deadline        DATE,                              -- scadenza della gara o data prevista dei lavori
  cig             TEXT NOT NULL DEFAULT '',
  soa             TEXT[] NOT NULL DEFAULT '{}',
  score           INTEGER NOT NULL DEFAULT 0,
  score_parts     JSONB NOT NULL DEFAULT '{}',
  to_gare         BOOLEAN NOT NULL DEFAULT false,    -- gara già bandita: la decide l'ufficio gare
  status          TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'interessa', 'scartato', 'boss', 'gara_scartata')),
  discard_reason  TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  cost_eur        NUMERIC NOT NULL DEFAULT 0,        -- quanto è costato all'AI
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_signals_external ON crm_signals (source, external_id) WHERE external_id <> '';
CREATE INDEX crm_signals_open ON crm_signals (bu, status);
CREATE INDEX crm_signals_subject ON crm_signals (subject_id);

CREATE TABLE crm_plans (
  id              SERIAL PRIMARY KEY,
  subject_id      INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  signal_id       INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL,
  playbook_id     TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  check_question  TEXT NOT NULL DEFAULT '',
  refs            TEXT NOT NULL DEFAULT '',          -- referenze da portare
  steps           JSONB NOT NULL DEFAULT '[]',       -- proposta: [{ title, due_date, owner_id, contact_id, channel, draft }]
  status          TEXT NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto', 'accettato', 'chiuso')),
  outcome         TEXT NOT NULL DEFAULT '' CHECK (outcome IN ('', 'opportunita', 'rimandato', 'perso')),
  outcome_note    TEXT NOT NULL DEFAULT '',
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);
CREATE INDEX crm_plans_subject ON crm_plans (subject_id);
ALTER TABLE crm_steps ADD CONSTRAINT crm_steps_plan FOREIGN KEY (plan_id) REFERENCES crm_plans(id) ON DELETE SET NULL;

-- spesa dell'AI per mese e BU (tetto e quote in crm_settings.radar)
CREATE TABLE crm_radar_spend (
  month   TEXT NOT NULL,                             -- 2026-11
  bu      TEXT NOT NULL,
  eur     NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, bu)
);
ALTER TABLE crm_radar_spend ADD COLUMN alerted_at TIMESTAMPTZ;   -- avviso «quota finita» già mandato agli amministratori

-- giri del radar (uno per BU e notte, o «Avvia adesso» dalla direzione)
CREATE TABLE crm_radar_runs (
  id        SERIAL PRIMARY KEY,
  bu        TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  found     INTEGER NOT NULL DEFAULT 0,
  added     INTEGER NOT NULL DEFAULT 0,
  cost_eur  NUMERIC NOT NULL DEFAULT 0,
  error     TEXT NOT NULL DEFAULT ''
);
