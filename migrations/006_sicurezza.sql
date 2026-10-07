-- Sicurezza: ricontrollo periodico dell'account con Microsoft e registro delle azioni.

-- Ultima volta che Microsoft ha confermato che l'account è attivo (refresh del token riuscito).
ALTER TABLE sessions ADD COLUMN validated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Chi ha fatto cosa: accessi, uscite, sessioni revocate e ogni modifica fatta dalle API (mai il contenuto).
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,              -- es. login, logout, session_revoked, POST /api/drive/upload
  status      INTEGER,                    -- codice HTTP della risposta
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at);
CREATE INDEX audit_log_user_idx ON audit_log(user_id, created_at);
