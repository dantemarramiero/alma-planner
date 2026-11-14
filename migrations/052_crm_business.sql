-- Nuovi business (Dante 14/11/2026, canvas «Nuovi business · ingresso in nuove aree d'affari»):
-- iniziative per entrare in una nuova area d'affari, con responsabile, sponsor, 5 fasi e un gate (decisione della
-- direzione) tra una fase e l'altra; chat con l'assistente, clienti target con sinergie dal CRM, cosa ci manca,
-- piano d'ingresso, riflessioni, analisi per la direzione. Il radar dell'iniziativa usa il motore delle BU.

CREATE TABLE crm_initiatives (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description     TEXT NOT NULL DEFAULT '',
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,      -- responsabile
  sponsor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,      -- sponsor della direzione
  asa             TEXT REFERENCES crm_asa(key) ON DELETE SET NULL ON UPDATE CASCADE, -- ASA dei lead che nascono dall'iniziativa
  phase           TEXT NOT NULL DEFAULT 'esplorazione' CHECK (phase IN ('esplorazione', 'analisi', 'piano', 'ingresso', 'consolidamento', 'abbandonata')),
  abandoned_reason TEXT NOT NULL DEFAULT '',
  budget_eur      NUMERIC NOT NULL DEFAULT 0,
  spent_eur       NUMERIC NOT NULL DEFAULT 0,                           -- spese scritte a mano (consulenze, corsi…); l'AI si somma da sola
  started_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  profile         JSONB NOT NULL DEFAULT '{}',                          -- per il radar: { works, soa, keywords, regions, exclude, amount_min, amount_max }
  periods         JSONB NOT NULL DEFAULT '{}',                          -- quando si fa ogni fase: { analisi: 'nov 2026 – gen 2027' }
  swot            JSONB NOT NULL DEFAULT '{}',                          -- { forze, debolezze, opportunita, minacce, by, at }
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- gate G0…G4: G0 apre l'iniziativa, G1 chiude l'esplorazione… G4 la fa diventare una BU
CREATE TABLE crm_initiative_gates (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  n               INTEGER NOT NULL CHECK (n BETWEEN 0 AND 4),
  question        TEXT NOT NULL DEFAULT '',
  due_date        DATE,
  decision        TEXT NOT NULL DEFAULT '' CHECK (decision IN ('', 'prosegui', 'rimanda', 'abbandona')),
  decision_note   TEXT NOT NULL DEFAULT '',
  decided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  alerted_at      TIMESTAMPTZ,
  UNIQUE (initiative_id, n)
);

CREATE TABLE crm_initiative_targets (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  subject_id      INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,  -- l'azienda nel CRM, se c'è
  name            TEXT NOT NULL,
  segment         TEXT NOT NULL DEFAULT '',
  why             TEXT NOT NULL DEFAULT '',
  priority        TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'bassa')),
  status          TEXT NOT NULL DEFAULT 'da_contattare' CHECK (status IN ('da_contattare', 'contattato', 'incontro', 'qualificati', 'opportunita', 'scartato')),
  note            TEXT NOT NULL DEFAULT '',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_initiative_targets_i ON crm_initiative_targets (initiative_id);
CREATE INDEX crm_initiative_targets_s ON crm_initiative_targets (subject_id);

CREATE TABLE crm_initiative_gaps (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT '',          -- Requisito, Qualifica, Persone, Mezzi, Referenze, Certificazioni, Processi
  status          TEXT NOT NULL DEFAULT 'manca' CHECK (status IN ('manca', 'in_corso', 'ce')),
  how_kind        TEXT NOT NULL DEFAULT '',          -- assumere, formare, partner, avvalimento, acquisire, noleggiare, non_serve
  how             TEXT NOT NULL DEFAULT '',
  cost_eur        NUMERIC,
  timing          TEXT NOT NULL DEFAULT '',
  who             TEXT NOT NULL DEFAULT '',
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_initiative_gaps_i ON crm_initiative_gaps (initiative_id);

-- passi del piano d'ingresso: diventano prossimi passi dell'iniziativa (owner, data, «!» se scadono)
CREATE TABLE crm_initiative_tasks (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL CHECK (phase IN ('esplorazione', 'analisi', 'piano', 'ingresso', 'consolidamento')),
  title           TEXT NOT NULL,
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date        DATE,
  target_id       INTEGER REFERENCES crm_initiative_targets(id) ON DELETE SET NULL,
  gap_id          INTEGER REFERENCES crm_initiative_gaps(id) ON DELETE SET NULL,
  sort            INTEGER NOT NULL DEFAULT 0,
  done_at         TIMESTAMPTZ,
  done_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  alerted_at      TIMESTAMPTZ,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_initiative_tasks_i ON crm_initiative_tasks (initiative_id);
CREATE INDEX crm_initiative_tasks_open ON crm_initiative_tasks (owner_id, due_date) WHERE done_at IS NULL;

-- riflessioni: diario dell'iniziativa; rischi con livello e mitigazione
CREATE TABLE crm_initiative_notes (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'nota' CHECK (kind IN ('ipotesi', 'decisione', 'chat', 'nota', 'rischio')),
  title           TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  check_status    TEXT NOT NULL DEFAULT '' CHECK (check_status IN ('', 'da_verificare', 'confermata', 'smentita')),
  level           TEXT NOT NULL DEFAULT '' CHECK (level IN ('', 'alto', 'medio', 'basso')),
  mitigation      TEXT NOT NULL DEFAULT '',
  message_id      INTEGER,
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX crm_initiative_notes_i ON crm_initiative_notes (initiative_id) WHERE deleted_at IS NULL;

-- chat con l'assistente (initiative_id vuoto = «Chiedi all'assistente un'idea» dall'elenco)
CREATE TABLE crm_initiative_messages (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body            TEXT NOT NULL,
  sources         JSONB NOT NULL DEFAULT '[]',       -- [{ title, url }] o [{ title, subject_id }] per il CRM
  proposals       JSONB NOT NULL DEFAULT '{}',       -- { targets: [], gaps: [], steps: [], synergies: [] }
  used            JSONB NOT NULL DEFAULT '{}',       -- azioni già fatte da questa risposta
  cost_eur        NUMERIC NOT NULL DEFAULT 0,
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_initiative_messages_i ON crm_initiative_messages (initiative_id, id);

-- segnali del radar dell'iniziativa (stesso punteggio delle BU, profilo dell'iniziativa)
CREATE TABLE crm_initiative_signals (
  id              SERIAL PRIMARY KEY,
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  entity          TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'notizia',
  summary         TEXT NOT NULL DEFAULT '',
  why             TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',
  amount          NUMERIC,
  published_on    DATE,
  deadline        DATE,
  score           INTEGER NOT NULL DEFAULT 0,
  score_parts     JSONB NOT NULL DEFAULT '{}',
  subject_id      INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'target', 'scartato')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_initiative_signals_url ON crm_initiative_signals (initiative_id, url) WHERE url <> '';

-- spesa dell'AI (chat e radar) per iniziativa e mese: conta nel budget dell'iniziativa
CREATE TABLE crm_initiative_spend (
  initiative_id   INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  month           TEXT NOT NULL,
  eur             NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (initiative_id, month)
);
