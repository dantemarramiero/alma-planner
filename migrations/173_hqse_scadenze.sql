-- HQSE fase 4 (ALM2-104, tavole 7, 8 e 21–24 approvate da Dante il 27/11/2026): scadenze, reminder, proroghe,
-- deroghe e idoneità per cantiere.

-- proroga: chi l'ha data, quando e perché (extended_to c'è dalla 170)
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS extended_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ;
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS extended_reason TEXT NOT NULL DEFAULT '';

-- deroga: un cantiere accetta un fornitore (o un suo dipendente) senza un documento, fino a una data, con l'autorizzazione
CREATE TABLE IF NOT EXISTS hqse_waivers (
  id            SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  worker_id     INTEGER REFERENCES hqse_workers(id) ON DELETE CASCADE,
  cantiere_id   INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  doc_type_id   INTEGER NOT NULL REFERENCES hqse_doc_types(id) ON DELETE CASCADE,
  until         DATE NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  authorized_by TEXT NOT NULL CHECK (length(authorized_by) BETWEEN 2 AND 200),   -- chi della direzione l'ha autorizzata
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hqse_waivers_site ON hqse_waivers (cantiere_id, until);

-- lavorazione del fornitore in quel cantiere
ALTER TABLE hqse_site_links ADD COLUMN IF NOT EXISTS lavorazione TEXT NOT NULL DEFAULT '';

-- impostazioni dei reminder (tavola 24), una riga sola come il widget
CREATE TABLE IF NOT EXISTS hqse_reminder_settings (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- registro degli invii: testo e destinatario, per la tavola 24
ALTER TABLE hqse_reminders ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT '';
ALTER TABLE hqse_reminders DROP CONSTRAINT IF EXISTS hqse_reminders_kind_check;
ALTER TABLE hqse_reminders ADD CONSTRAINT hqse_reminders_kind_check CHECK (kind IN ('rinnovo', 'mancante', 'respinto', 'capocommessa', 'riepilogo', 'bloccato', 'prova'));
ALTER TABLE hqse_reminders ALTER COLUMN supplier_id DROP NOT NULL;
