-- Alma Energy: modulo della BU Energy per il business IPP (ALM2-1 … ALM2-4).
-- Chi entra (per ora Dante e Tullio), CRM con aziende e persone, opportunità delle tre pipeline con lo storico degli stadi
-- e i collegamenti di aziende e persone alle opportunità con un ruolo.

-- Chi può usare il modulo: email degli account di Alma Planet. Si allarga dalla pagina, senza toccare il codice.
CREATE TABLE energy_members (
  email       TEXT PRIMARY KEY CHECK (email = lower(email)),
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO energy_members (email) VALUES ('dante.marramiero@almacis.it');

-- Aziende del CRM: un'azienda può avere più tipi (cliente, proprietario, sviluppatore, progettista…).
-- I campi che servono solo a un tipo stanno in `extra` (es. consumi annui per i clienti, MW in sviluppo per gli sviluppatori).
CREATE TABLE energy_companies (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  vat             TEXT NOT NULL DEFAULT '',           -- P.IVA, chiave contro i doppioni
  tax_code        TEXT NOT NULL DEFAULT '',
  legal_form      TEXT NOT NULL DEFAULT '',
  ateco           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'attiva' CHECK (status IN ('attiva', 'in_liquidazione', 'cessata')),
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  province        TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',
  pec             TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  website         TEXT NOT NULL DEFAULT '',
  group_id        INTEGER REFERENCES energy_companies(id) ON DELETE SET NULL, -- società controllante / gruppo
  revenue         NUMERIC(16,2),
  employees       INTEGER,
  balance_year    INTEGER,
  types           TEXT[] NOT NULL DEFAULT '{}',
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL, -- responsabile interno
  source          TEXT NOT NULL DEFAULT '',
  relation        TEXT NOT NULL DEFAULT 'da_contattare' CHECK (relation IN ('da_contattare', 'in_contatto', 'attivo', 'non_interessato')),
  last_contact    DATE,
  next_action     TEXT NOT NULL DEFAULT '',
  next_action_date DATE,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  notes           TEXT NOT NULL DEFAULT '',
  extra           JSONB NOT NULL DEFAULT '{}',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX energy_companies_vat ON energy_companies (vat) WHERE vat <> '';
CREATE INDEX energy_companies_types ON energy_companies USING gin (types);
CREATE INDEX energy_companies_name ON energy_companies (lower(name));

-- Persone (contatti esterni). Il trattamento dei dati segue il GDPR: base giuridica, fonte e opposizione al contatto.
CREATE TABLE energy_people (
  id              SERIAL PRIMARY KEY,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 120),
  title           TEXT NOT NULL DEFAULT '',          -- Ing., Dott., Avv.
  influence       TEXT NOT NULL DEFAULT '' CHECK (influence IN ('', 'decisore', 'influenzatore', 'tecnico', 'operativo')),
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  mobile          TEXT NOT NULL DEFAULT '',
  linkedin        TEXT NOT NULL DEFAULT '',
  channel         TEXT NOT NULL DEFAULT '' CHECK (channel IN ('', 'email', 'telefono', 'cellulare', 'linkedin', 'di_persona')),
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT '',
  last_contact    DATE,
  next_action     TEXT NOT NULL DEFAULT '',
  next_action_date DATE,
  notes           TEXT NOT NULL DEFAULT '',
  legal_basis     TEXT NOT NULL DEFAULT 'legittimo_interesse' CHECK (legal_basis IN ('legittimo_interesse', 'consenso')),
  data_source     TEXT NOT NULL DEFAULT '',
  data_date       DATE,
  opt_out         BOOLEAN NOT NULL DEFAULT false,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX energy_people_name ON energy_people (lower(last_name), lower(first_name));

-- Una persona può stare in più aziende, con una qualifica diversa in ognuna (tipico di chi amministra più SPV).
CREATE TABLE energy_person_companies (
  person_id   INTEGER NOT NULL REFERENCES energy_people(id) ON DELETE CASCADE,
  company_id  INTEGER NOT NULL REFERENCES energy_companies(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, company_id)
);
CREATE INDEX energy_person_companies_company ON energy_person_companies (company_id);

-- Opportunità delle tre pipeline. Lo stadio dipende dal tipo (elenchi in lib/energy.js).
-- source_key: chiave dell'import (ID OSM dello screening, P.IVA del proprietario nel Database CE) per rifarlo senza doppioni.
CREATE TABLE energy_opportunities (
  id               SERIAL PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('ppa_onsite', 'revamping', 'fv_classico')),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  stage            TEXT NOT NULL,
  lost_reason      TEXT NOT NULL DEFAULT '',
  priority         TEXT NOT NULL DEFAULT '',          -- A/B/C… dello screening o del Database CE
  mw               NUMERIC(12,4),
  capex            NUMERIC(16,2),
  probability      INTEGER CHECK (probability BETWEEN 0 AND 100),
  city             TEXT NOT NULL DEFAULT '',
  province         TEXT NOT NULL DEFAULT '',
  region           TEXT NOT NULL DEFAULT '',
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  company_id       INTEGER REFERENCES energy_companies(id) ON DELETE SET NULL, -- azienda principale
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,           -- responsabile
  source_key       TEXT,
  data             JSONB NOT NULL DEFAULT '{}',         -- dati della fonte (screening, incassi GSE, dati autorizzativi…)
  notes            TEXT NOT NULL DEFAULT '',
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,         -- l'Impianto target, quando lo diventa
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX energy_opportunities_source ON energy_opportunities (kind, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX energy_opportunities_kind_stage ON energy_opportunities (kind, stage);

-- Storico dei cambi di stadio (anche la creazione, con from_stage vuoto).
CREATE TABLE energy_stage_history (
  id              SERIAL PRIMARY KEY,
  opportunity_id  INTEGER NOT NULL REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX energy_stage_history_opp ON energy_stage_history (opportunity_id, at);

-- Aziende e persone collegate a un'opportunità, ognuna con il suo ruolo (proprietario, referente cliente, progettista…).
CREATE TABLE energy_links (
  id              SERIAL PRIMARY KEY,
  opportunity_id  INTEGER NOT NULL REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  company_id      INTEGER REFERENCES energy_companies(id) ON DELETE CASCADE,
  person_id       INTEGER REFERENCES energy_people(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((company_id IS NULL) <> (person_id IS NULL))
);
CREATE UNIQUE INDEX energy_links_company ON energy_links (opportunity_id, company_id, role) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX energy_links_person ON energy_links (opportunity_id, person_id, role) WHERE person_id IS NOT NULL;
CREATE INDEX energy_links_company_idx ON energy_links (company_id);
CREATE INDEX energy_links_person_idx ON energy_links (person_id);
