-- HQSE fase 2 (ALM2-101, tavole 10–15 approvate da Dante il 27/11/2026): il portale del fornitore.
-- Niente password: link via email la prima volta, poi un codice di 6 cifre via email quando la sessione (30 giorni)
-- scade o da un altro dispositivo. Token e codici si salvano solo come impronta SHA-256.

-- chi entra nel portale per un fornitore: il referente e i colleghi che invita (anche il consulente esterno)
CREATE TABLE IF NOT EXISTS hqse_portal_users (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER NOT NULL REFERENCES hqse_suppliers(id) ON DELETE CASCADE,
  email        TEXT NOT NULL CHECK (email = lower(email) AND email LIKE '%@%'),
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'collega' CHECK (role IN ('referente', 'collega')),
  can_upload   BOOLEAN NOT NULL DEFAULT true,
  invited_by   TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT true,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, email)
);
CREATE INDEX IF NOT EXISTS hqse_portal_users_email ON hqse_portal_users (email) WHERE active;

-- link dell'email (7 giorni, una volta sola) e codici di 6 cifre (10 minuti, 5 tentativi)
CREATE TABLE IF NOT EXISTS hqse_portal_tokens (
  id            SERIAL PRIMARY KEY,
  portal_user_id INTEGER NOT NULL REFERENCES hqse_portal_users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('link', 'codice')),
  hash          TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hqse_portal_tokens_hash ON hqse_portal_tokens (hash) WHERE used_at IS NULL;

-- sessioni del portale (cookie separato da quello di Alma Space)
CREATE TABLE IF NOT EXISTS hqse_portal_sessions (
  hash           TEXT PRIMARY KEY,
  portal_user_id INTEGER NOT NULL REFERENCES hqse_portal_users(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- chi ha caricato cosa dal portale
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS portal_user_id INTEGER REFERENCES hqse_portal_users(id) ON DELETE SET NULL;
