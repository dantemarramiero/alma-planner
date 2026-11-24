-- Alma Impianti (ALM2-73, canvas approvato da Dante il 24/11/2026): spazio della BU Impianti sopra il CRM comune.
-- - settore dei segnali del Radar (depurazione, fotovoltaico, biometano, impianti in edilizia, efficientamento);
-- - mandato dei fondi e investitori (il fondo è un cliente o lead col tipo «Fondo o investitore»), per abbinarli ai progetti;
-- - registro dare/avere con i progettisti (lavori che ci hanno portato e che abbiamo portato a loro).
-- Le cadenze («ogni quanto sentirli») e l'attesa della risposta stanno in crm_settings, chiave «impianti».

ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS sector TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS crm_signals_sector ON crm_signals (bu, sector) WHERE sector <> '';

CREATE TABLE IF NOT EXISTS crm_fund_mandates (
  subject_id  INTEGER PRIMARY KEY REFERENCES crm_subjects(id) ON DELETE CASCADE,
  techs       TEXT[] NOT NULL DEFAULT '{}',          -- settori: biometano, fotovoltaico, depurazione, efficientamento, edilizia
  ticket_min  NUMERIC,                               -- euro per progetto
  ticket_max  NUMERIC,
  regions     TEXT[] NOT NULL DEFAULT '{}',          -- vuoto = tutta Italia
  phases      TEXT[] NOT NULL DEFAULT '{}',          -- greenfield, autorizzato, costruzione, esercizio
  seeks_epc   BOOLEAN NOT NULL DEFAULT true,         -- cerca un costruttore (EPC)
  bus         TEXT[] NOT NULL DEFAULT '{impianti}',  -- BU che lo seguono (impianti, energy): l'etichetta del fondo
  notes       TEXT NOT NULL DEFAULT '',
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_exchanges (
  id           SERIAL PRIMARY KEY,
  subject_id   INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,   -- il progettista (o il partner)
  direction    TEXT NOT NULL CHECK (direction IN ('dato', 'ricevuto')),           -- dato = noi a lui; ricevuto = lui a noi
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  signal_id    INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL,
  happened_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  note         TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_exchanges_subject ON crm_exchanges (subject_id, happened_on DESC);
