-- Doppioni proposti dal CRM (canvas v15 · V15-Doppioni e V15-Unisci, via di Dante 22/11/2026).
-- Una riga per coppia (a_id < b_id) di aziende o contatti: perché si somigliano, quanto è sicuro, cosa si è deciso.
-- open = da controllare · dismissed = «Non sono la stessa» (non torna più) · merged = unite.
CREATE TABLE IF NOT EXISTS crm_duplicates (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('subject', 'contact')),
  a_id        INTEGER NOT NULL,
  b_id        INTEGER NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  reasons     JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'merged')),
  found_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at  TIMESTAMPTZ,
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (kind, a_id, b_id),
  CHECK (a_id < b_id)
);
CREATE INDEX IF NOT EXISTS crm_duplicates_open ON crm_duplicates (kind, status);
