-- ALM2-94 (canvas «Segnala un'opportunità» approvato da Dante il 25/11/2026):
-- screenshot e allegati della segnalazione, e i colleghi a cui si chiede «Tienila / Scartala».
CREATE TABLE crm_signal_files (
  id            SERIAL PRIMARY KEY,
  signal_id     INTEGER NOT NULL REFERENCES crm_signals(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  screenshot    BOOLEAN NOT NULL DEFAULT FALSE,    -- incollato con Ctrl+V: si vede come anteprima
  added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_signal_files_signal ON crm_signal_files (signal_id);

CREATE TABLE crm_signal_asks (
  id            SERIAL PRIMARY KEY,
  signal_id     INTEGER NOT NULL REFERENCES crm_signals(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- chi deve decidere
  asked_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message       TEXT NOT NULL DEFAULT '',
  due_on        DATE,                                -- rispondi entro (NULL = nessuna scadenza)
  teams         TEXT NOT NULL DEFAULT '',            -- '' non chiesto · ok · errore
  mail          TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  decision      TEXT NOT NULL DEFAULT '',            -- '' in attesa · tieni · scarta
  reason        TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  opened_at     TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ,
  reminded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, user_id)
);
CREATE INDEX crm_signal_asks_user ON crm_signal_asks (user_id) WHERE decision = '';
