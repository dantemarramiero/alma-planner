-- Censimento dei software aziendali (solo amministratori).
-- software → tipologie di licenza (piani: quante, quanto costano, quando si rinnovano) → assegnazioni alle persone
-- di Microsoft (org_people.oid). Pacchetti per ruolo: insiemi di licenze da assegnare in un colpo.
-- Ogni software ha una fonte: 'manuale' (si compila a mano) o un collegamento che tiene aggiornati piani e
-- assegnazioni ('microsoft' = licenze Microsoft 365, 'entra' = software esterni con accesso Microsoft; poi 'claude'…).

CREATE TABLE software (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  vendor      TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  website     TEXT,
  owner_oid   TEXT,                                    -- referente interno (persona di Microsoft)
  status      TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'da_verificare', 'archiviato')),
  source      TEXT NOT NULL DEFAULT 'manuale',
  external_id TEXT,                                    -- id nella fonte (es. appId dell'app in Entra)
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_name_uq ON software (lower(name));
CREATE UNIQUE INDEX software_source_uq ON software (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE software_plans (
  id              SERIAL PRIMARY KEY,
  software_id     INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  external_id     TEXT,                                -- es. skuPartNumber di Microsoft
  seats           INTEGER CHECK (seats IS NULL OR seats >= 0),  -- licenze acquistate; NULL = senza limite
  unit_cost       NUMERIC(10, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),  -- € per licenza nel periodo
  billing         TEXT NOT NULL DEFAULT 'mese' CHECK (billing IN ('mese', 'anno', 'una_tantum')),
  cost_estimated  BOOLEAN NOT NULL DEFAULT false,      -- prezzo di listino indicativo, non ancora quello vero
  renewal_date    DATE,
  source_assigned INTEGER,                             -- assegnate secondo la fonte (Microsoft: consumedUnits)
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_plans_name_uq ON software_plans (software_id, lower(name));
CREATE UNIQUE INDEX software_plans_ext_uq ON software_plans (software_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE software_packages (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  job_titles  TEXT[] NOT NULL DEFAULT '{}',            -- ruoli (jobTitle di Microsoft) a cui si propone
  departments TEXT[] NOT NULL DEFAULT '{}',            -- reparti a cui si propone
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX software_packages_name_uq ON software_packages (lower(name));

CREATE TABLE software_package_plans (
  package_id INTEGER NOT NULL REFERENCES software_packages(id) ON DELETE CASCADE,
  plan_id    INTEGER NOT NULL REFERENCES software_plans(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, plan_id)
);

-- Chi ha quale licenza. Nome ed email sono copiati: se la persona esce dall'organigramma la riga resta.
-- «Da recuperare»: licenze su un account disattivato in Microsoft (account_disabled, dalla fonte) e licenze
-- messe a mano a chi non è più nell'organigramma.
CREATE TABLE software_assignments (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES software_plans(id) ON DELETE CASCADE,
  person_oid   TEXT NOT NULL,
  person_name  TEXT NOT NULL,
  person_email TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manuale',        -- manuale | pacchetto | microsoft | entra | …
  package_id   INTEGER REFERENCES software_packages(id) ON DELETE SET NULL,
  assigned_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT NOT NULL DEFAULT '',
  account_disabled BOOLEAN NOT NULL DEFAULT false,      -- account disattivato in Microsoft, licenza ancora assegnata
  UNIQUE (plan_id, person_oid)
);
CREATE INDEX software_assignments_person ON software_assignments (person_oid);

-- Ultimo aggiornamento di ogni collegamento.
CREATE TABLE software_sync (
  source    TEXT PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  result    JSONB NOT NULL DEFAULT '{}'
);
