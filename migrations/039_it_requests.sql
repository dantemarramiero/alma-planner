-- Alma IT: richieste delle persone al team IT. Un software del censimento («software»), uno che non c'è
-- ancora («nuovo»), oppure una licenza che non serve più («rilascio»). Il team IT accetta o rifiuta con una
-- risposta; chi ha chiesto riceve una notifica.
CREATE TABLE it_requests (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('software', 'nuovo', 'rilascio')),
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_oid    TEXT,                                    -- persona di Microsoft di chi chiede (se c'è)
  person_name   TEXT NOT NULL,
  person_email  TEXT NOT NULL DEFAULT '',
  plan_id       INTEGER REFERENCES software_plans(id) ON DELETE SET NULL,
  assignment_id INTEGER REFERENCES software_assignments(id) ON DELETE SET NULL,
  software_name TEXT NOT NULL,                           -- copiato: la richiesta resta leggibile
  reason        TEXT NOT NULL DEFAULT '',
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'da_rispondere' CHECK (status IN ('da_rispondere', 'accettata', 'rifiutata', 'annullata')),
  answer        TEXT NOT NULL DEFAULT '',
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX it_requests_status ON it_requests (status);
CREATE INDEX it_requests_user ON it_requests (user_id);

-- notifiche di Alma IT (testo e collegamento già pronti, come per mezzi ed energy)
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy', 'it'));
