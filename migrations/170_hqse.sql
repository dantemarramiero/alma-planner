-- HQSE · Qualifica fornitori (ALM2-98, fase 1 ALM2-100; canvas approvato da Dante il 26/11/2026).
-- Numeri 170–179 per HQSE (126–129 Procurement, 130–139 Richieste di acquisto, 150 Radar).
-- - I fornitori sono le aziende del CRM centrale (crm_subjects): qui solo la loro qualifica, una riga per azienda.
-- - I dipendenti dei fornitori sono persone del CRM (crm_contacts): qui solo quello che serve alla qualifica.
-- - Tipi di documento, checklist e questionari si cambiano da «Checklist e regole» (catalogo iniziale: lib/hqse-catalogo.js).
-- - vittoria_id su fornitori, dipendenti, mezzi e documenti per l'import da Vittoria RMS (fase 5).

CREATE TABLE IF NOT EXISTS hqse_doc_types (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  scope           TEXT NOT NULL CHECK (scope IN ('fornitore', 'risorsa', 'mezzo')),
  instructions    TEXT NOT NULL DEFAULT '',                -- cosa legge il fornitore
  validity_rule   TEXT NOT NULL DEFAULT 'documento' CHECK (validity_rule IN ('firma', 'rilascio', 'attestato', 'documento', 'nessuna')),
  validity_months INTEGER CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 240),
  notice_days     INTEGER[] NOT NULL DEFAULT '{30,15,7}',  -- reminder prima della scadenza
  grace_days      INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
  blocking        BOOLEAN NOT NULL DEFAULT true,           -- scaduto o mancante: niente cantiere
  template_name   TEXT NOT NULL DEFAULT '',
  ai_checks       JSONB NOT NULL DEFAULT '[]',             -- [{text, on_fail: 'respingi'|'chiedi'}]
  archived        BOOLEAN NOT NULL DEFAULT false,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((validity_rule IN ('firma', 'rilascio', 'attestato')) = (validity_months IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS hqse_checklists (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind        TEXT NOT NULL CHECK (kind IN ('fornitore', 'risorsa', 'mezzo')),
  commesse    TEXT[] NOT NULL DEFAULT '{}',                -- vuoto = tutte; altrimenti solo questi codici commessa
  optional    BOOLEAN NOT NULL DEFAULT false,              -- es. CL6 punteggi aggiuntivi
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  vittoria_name TEXT NOT NULL DEFAULT '',
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hqse_checklist_docs (
  checklist_id INTEGER NOT NULL REFERENCES hqse_checklists(id) ON DELETE CASCADE,
  doc_type_id  INTEGER NOT NULL REFERENCES hqse_doc_types(id) ON DELETE CASCADE,
  sort         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (checklist_id, doc_type_id)
);

-- tipo di appalto scelto alla registrazione → checklist dell'azienda
CREATE TABLE IF NOT EXISTS hqse_appalto_checklists (
  tipo         TEXT NOT NULL,
  checklist_id INTEGER NOT NULL REFERENCES hqse_checklists(id) ON DELETE CASCADE,
  PRIMARY KEY (tipo, checklist_id)
);

CREATE TABLE IF NOT EXISTS hqse_suppliers (
  id            SERIAL PRIMARY KEY,
  subject_id    INTEGER NOT NULL UNIQUE REFERENCES crm_subjects(id) ON DELETE CASCADE,
  tipo_appalto  TEXT NOT NULL DEFAULT 'lavori' CHECK (tipo_appalto IN ('lavori', 'servizi', 'lavori_servizi', 'materiali', 'professionista')),
  status        TEXT NOT NULL DEFAULT 'in_qualifica' CHECK (status IN ('registrato', 'in_qualifica', 'attivo', 'sospeso', 'terminato')),
  level         TEXT NOT NULL DEFAULT 'non_valutato' CHECK (level IN ('non_valutato', 'non_qualificabile', 'sufficiente', 'buono', 'certificato')),
  risk          TEXT NOT NULL DEFAULT '' CHECK (risk IN ('', 'basso', 'medio', 'alto', 'altissimo')),
  whitelist     BOOLEAN,
  ccnl          TEXT NOT NULL DEFAULT '',                  -- CCNL applicato: controllo incrociato con gli UNILAV
  medico        TEXT NOT NULL DEFAULT '',                  -- medico competente: controllo sulle idoneità sanitarie
  questionario_at TIMESTAMPTZ,                             -- quando il fornitore ha risposto al questionario dell'azienda
  notes         TEXT NOT NULL DEFAULT '',
  vittoria_id   TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hqse_workers (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  contact_id   INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  tax_code     TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'dipendente' CHECK (kind IN ('dipendente', 'datore_lavoratore', 'distaccato')),
  hired_on     DATE,
  ended_on     DATE,
  answers      JSONB NOT NULL DEFAULT '{}',                -- questionario della risorsa
  vittoria_id  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, contact_id)
);

CREATE TABLE IF NOT EXISTS hqse_vehicles (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 120),
  plate        TEXT NOT NULL DEFAULT '',
  vittoria_id  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- checklist assegnate a un fornitore, a un suo dipendente o a un suo mezzo
CREATE TABLE IF NOT EXISTS hqse_assignments (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  worker_id    INTEGER REFERENCES hqse_workers(id) ON DELETE CASCADE,
  vehicle_id   INTEGER REFERENCES hqse_vehicles(id) ON DELETE CASCADE,
  checklist_id INTEGER NOT NULL REFERENCES hqse_checklists(id) ON DELETE CASCADE,
  origin       TEXT NOT NULL DEFAULT 'manuale' CHECK (origin IN ('questionario', 'cantiere', 'manuale', 'vittoria')),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (worker_id IS NULL OR vehicle_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS hqse_assignments_one ON hqse_assignments (supplier_id, COALESCE(worker_id, 0), COALESCE(vehicle_id, 0), checklist_id);

-- i file caricati (PDF, Word, immagini), nel database come gli allegati delle altre parti di Alma
CREATE TABLE IF NOT EXISTS hqse_files (
  id          SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- un documento caricato; il nuovo non cancella il vecchio: lo segna «superato»
CREATE TABLE IF NOT EXISTS hqse_documents (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  worker_id    INTEGER REFERENCES hqse_workers(id) ON DELETE CASCADE,
  vehicle_id   INTEGER REFERENCES hqse_vehicles(id) ON DELETE CASCADE,
  doc_type_id  INTEGER NOT NULL REFERENCES hqse_doc_types(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL DEFAULT 'in_verifica' CHECK (status IN ('in_verifica', 'approvato', 'respinto', 'superato')),
  file_name    TEXT NOT NULL DEFAULT '',
  file_id      INTEGER REFERENCES hqse_files(id) ON DELETE SET NULL,
  issued_on    DATE,                                       -- data di firma, rilascio o attestato
  valid_to     DATE,                                       -- calcolata dalla regola o letta dal documento
  extended_to  DATE,                                       -- proroga concessa da HQSE
  ai_result    JSONB,
  reason       TEXT NOT NULL DEFAULT '',                   -- motivo del rifiuto, per il fornitore
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  vittoria_id  TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hqse_documents_owner ON hqse_documents (supplier_id, doc_type_id) WHERE status <> 'superato';

-- fornitori e dipendenti associati a un cantiere (commessa di BOSS in Alma)
CREATE TABLE IF NOT EXISTS hqse_site_links (
  id           SERIAL PRIMARY KEY,
  cantiere_id  INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  worker_id    INTEGER REFERENCES hqse_workers(id) ON DELETE CASCADE,
  date_from    DATE,
  date_to      DATE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hqse_site_links_one ON hqse_site_links (cantiere_id, supplier_id, COALESCE(worker_id, 0));

CREATE TABLE IF NOT EXISTS hqse_reminders (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('rinnovo', 'mancante', 'respinto', 'capocommessa', 'riepilogo')),
  document_ids INTEGER[] NOT NULL DEFAULT '{}',
  sent_to      TEXT NOT NULL DEFAULT '',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok           BOOLEAN NOT NULL DEFAULT true
);

-- chi ha fatto cosa: lo storico della scheda fornitore
CREATE TABLE IF NOT EXISTS hqse_events (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hqse_events_supplier ON hqse_events (supplier_id, at DESC);

-- testi e scelte del widget sul sito almacis.it (una riga sola)
CREATE TABLE IF NOT EXISTS hqse_widget (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
