-- HQSE fase 5 (ALM2-105, tavole 25–28 approvate da Dante il 27/11/2026): import da Vittoria e passaggio al portale.
-- Il pacchetto è neutro (fornitori, dipendenti, documenti in CSV + i file): lo producono l'export di Si&T, le API o uno script.

CREATE TABLE IF NOT EXISTS hqse_imports (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'export' CHECK (source IN ('export', 'api', 'script')),
  status      TEXT NOT NULL DEFAULT 'caricato' CHECK (status IN ('caricato', 'in_corso', 'importato')),
  counts      JSONB NOT NULL DEFAULT '{}',     -- cosa c'è nel pacchetto
  summary     JSONB NOT NULL DEFAULT '{}',     -- esito dell'ultimo giro
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  run_started TIMESTAMPTZ,
  run_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hqse_import_suppliers (
  id           SERIAL PRIMARY KEY,
  import_id    INTEGER NOT NULL REFERENCES hqse_imports(id) ON DELETE CASCADE,
  vittoria_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  vat          TEXT NOT NULL DEFAULT '',
  tax_code     TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  referente    TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  status_v     TEXT NOT NULL DEFAULT '',        -- stato in Vittoria
  tipo         TEXT NOT NULL DEFAULT 'lavori',
  match        TEXT NOT NULL CHECK (match IN ('crm', 'nuovo', 'dubbio', 'storico')),
  reason       TEXT NOT NULL DEFAULT '',
  subject_id   INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,  -- azienda del CRM scelta (o trovata)
  decided      BOOLEAN NOT NULL DEFAULT false,  -- abbinato a mano
  supplier_id  INTEGER REFERENCES hqse_suppliers(id) ON DELETE SET NULL,
  UNIQUE (import_id, vittoria_id)
);

CREATE TABLE IF NOT EXISTS hqse_import_workers (
  id                   SERIAL PRIMARY KEY,
  import_id            INTEGER NOT NULL REFERENCES hqse_imports(id) ON DELETE CASCADE,
  vittoria_id          TEXT NOT NULL,
  supplier_vittoria_id TEXT NOT NULL,
  first_name           TEXT NOT NULL DEFAULT '',
  last_name            TEXT NOT NULL DEFAULT '',
  tax_code             TEXT NOT NULL DEFAULT '',
  hired_on             DATE,
  active               BOOLEAN NOT NULL DEFAULT true,
  worker_id            INTEGER REFERENCES hqse_workers(id) ON DELETE SET NULL,
  UNIQUE (import_id, vittoria_id)
);

CREATE TABLE IF NOT EXISTS hqse_import_docs (
  id                   SERIAL PRIMARY KEY,
  import_id            INTEGER NOT NULL REFERENCES hqse_imports(id) ON DELETE CASCADE,
  vittoria_id          TEXT NOT NULL,
  supplier_vittoria_id TEXT NOT NULL,
  worker_vittoria_id   TEXT NOT NULL DEFAULT '',
  doc_name             TEXT NOT NULL,
  status_v             TEXT NOT NULL DEFAULT '',
  issued_on            DATE,
  valid_to             DATE,
  file_key             TEXT NOT NULL DEFAULT '',
  outcome              TEXT NOT NULL DEFAULT '',  -- importato | scartato | non_valido
  skip_reason          TEXT NOT NULL DEFAULT '',
  document_id          INTEGER REFERENCES hqse_documents(id) ON DELETE SET NULL,
  UNIQUE (import_id, vittoria_id)
);
CREATE INDEX IF NOT EXISTS hqse_import_docs_name ON hqse_import_docs (import_id, doc_name);

-- i file arrivano a parte (uno per chiamata), legati alla riga del documento con file_key
CREATE TABLE IF NOT EXISTS hqse_import_files (
  id         SERIAL PRIMARY KEY,
  import_id  INTEGER NOT NULL REFERENCES hqse_imports(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, file_key)
);

-- tipi di documento di Vittoria → nostri (vale per tutti gli import)
CREATE TABLE IF NOT EXISTS hqse_doc_type_map (
  vittoria_name TEXT PRIMARY KEY,               -- in minuscolo, senza spazi doppi
  doc_type_id   INTEGER REFERENCES hqse_doc_types(id) ON DELETE CASCADE,
  skip          BOOLEAN NOT NULL DEFAULT false, -- «Non importare»
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (skip OR doc_type_id IS NOT NULL)
);

-- passaggio al portale (tavola 28)
ALTER TABLE hqse_suppliers ADD COLUMN IF NOT EXISTS from_vittoria BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hqse_suppliers ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ;
ALTER TABLE hqse_suppliers ADD COLUMN IF NOT EXISTS welcome_wave INTEGER;

CREATE TABLE IF NOT EXISTS hqse_welcome_waves (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  criterio     TEXT NOT NULL CHECK (criterio IN ('cantieri', 'scadenze', 'tutti')),
  supplier_ids INTEGER[] NOT NULL DEFAULT '{}',
  planned_on   DATE,
  sent_at      TIMESTAMPTZ,
  sent_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hqse_reminders DROP CONSTRAINT IF EXISTS hqse_reminders_kind_check;
ALTER TABLE hqse_reminders ADD CONSTRAINT hqse_reminders_kind_check CHECK (kind IN ('rinnovo', 'mancante', 'respinto', 'capocommessa', 'riepilogo', 'bloccato', 'prova', 'benvenuto'));
