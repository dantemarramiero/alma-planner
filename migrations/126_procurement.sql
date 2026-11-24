-- Alma Procurement (ALM2-81, canvas «Alma Procurement · capitolato e fornitori» approvato da Dante il 24/11/2026).
-- Numero 126 (la 125 è di Alma Energy, ALM2-83); 126–129 per Procurement, 130–139 a Richieste di acquisto e RDO (ALM2-82).
-- - Capitolato: le merci di Almacis, ognuna in una categoria dei fornitori del CRM (supplier_categories) con la sua
--   sottocategoria, unità, specifiche, norme, documenti richiesti e le BU che la comprano.
-- - I fornitori sono le aziende del CRM (crm_subjects con il ruolo «fornitore»): qui solo il legame merce ↔ fornitore,
--   con da dove arriva (BOSS, CRM, web, a mano), e le etichette Qualità / Prezzo / Da qualificare.
-- - Ricerche fatte con «Chiedi ad Alma» (per ricordarle e per il costo).
-- - Richieste di quotazione: una richiesta per merce, un'email per referente (bozza di Alma, approvata da una
--   persona, mandata dalla sua casella Outlook), la risposta agganciata alla conversazione e l'offerta letta da Alma.
-- - Righe dei DDT di BOSS caricate da file: da qui Alma propone le merci che mancano nel capitolato.

CREATE TABLE IF NOT EXISTS proc_items (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('materiali', 'subappalti', 'noli', 'servizi_cantiere', 'professionisti', 'mezzi', 'servizi_generali')),
  subcategory  TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  unit         TEXT NOT NULL DEFAULT '',
  specs        TEXT NOT NULL DEFAULT '',
  norms        TEXT NOT NULL DEFAULT '',
  documents    TEXT NOT NULL DEFAULT '',
  bus          TEXT[] NOT NULL DEFAULT '{}',
  notes        TEXT NOT NULL DEFAULT '',
  archived     BOOLEAN NOT NULL DEFAULT false,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS proc_items_name ON proc_items (category, lower(name)) WHERE NOT archived;

CREATE TABLE IF NOT EXISTS proc_item_suppliers (
  item_id     INTEGER NOT NULL REFERENCES proc_items(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'manuale' CHECK (source IN ('boss', 'crm', 'web', 'manuale')),
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, subject_id)
);
CREATE INDEX IF NOT EXISTS proc_item_suppliers_subject ON proc_item_suppliers (subject_id);

-- Etichette del fornitore: proposte da Alma (confirmed = false) o messe/confermate da una persona.
CREATE TABLE IF NOT EXISTS proc_supplier_tags (
  subject_id    INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  tag           TEXT NOT NULL CHECK (tag IN ('qualita', 'prezzo', 'da_qualificare')),
  confirmed     BOOLEAN NOT NULL DEFAULT false,
  why           TEXT NOT NULL DEFAULT '',
  set_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, tag)
);

CREATE TABLE IF NOT EXISTS proc_searches (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  query       TEXT NOT NULL,
  item_id     INTEGER REFERENCES proc_items(id) ON DELETE SET NULL,
  result      JSONB NOT NULL DEFAULT '{}',
  cost_eur    NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proc_searches_user ON proc_searches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS proc_rfqs (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER REFERENCES proc_items(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,                    -- come si chiamava la merce quando è partita la richiesta
  quantity    TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT '',
  site        TEXT NOT NULL DEFAULT '',          -- commessa / cantiere
  delivery    TEXT NOT NULL DEFAULT '',
  due_date    DATE,
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'inviata', 'chiusa')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS proc_rfq_recipients (
  id               SERIAL PRIMARY KEY,
  rfq_id           INTEGER NOT NULL REFERENCES proc_rfqs(id) ON DELETE CASCADE,
  subject_id       INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  contact_id       INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  email            TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  mail_subject     TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  tone             JSONB NOT NULL DEFAULT '{}',   -- { n, tu, chips, level } come Alma l'ha letto
  approved         BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'inviata', 'risposta', 'errore', 'tolta')),
  sent_at          TIMESTAMPTZ,
  message_id       TEXT NOT NULL DEFAULT '',
  conversation_id  TEXT NOT NULL DEFAULT '',
  reply_at         TIMESTAMPTZ,
  reply_preview    TEXT NOT NULL DEFAULT '',
  offer            JSONB,                         -- { price, price_text, unit, delivery, payment, notes, ai }
  reminded_at      TIMESTAMPTZ,
  error            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proc_rfq_recipients_rfq ON proc_rfq_recipients (rfq_id);

CREATE TABLE IF NOT EXISTS proc_ddt_lines (
  id           SERIAL PRIMARY KEY,
  supplier     TEXT NOT NULL DEFAULT '',
  vat          TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  job_code     TEXT NOT NULL DEFAULT '',         -- commessa di BOSS
  bu           TEXT NOT NULL DEFAULT '',
  ddt_date     DATE,
  quantity     NUMERIC,
  unit         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',         -- nome del file caricato
  item_id      INTEGER REFERENCES proc_items(id) ON DELETE SET NULL,
  dismissed    BOOLEAN NOT NULL DEFAULT false,   -- «non è una merce da capitolato»
  imported_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proc_ddt_lines_vat ON proc_ddt_lines (vat);
CREATE INDEX IF NOT EXISTS proc_ddt_lines_desc ON proc_ddt_lines (lower(description));
