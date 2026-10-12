-- Proposte di software per ruolo: quando in Microsoft arriva una persona nuova e il suo ruolo o reparto ha un
-- pacchetto, nasce una proposta che il team IT accetta (tutta o in parte) o rifiuta. Solo dopo si assegna.

-- Impostazioni del censimento. it_department = reparto di Microsoft del team IT, che vede il censimento e
-- accetta le proposte (oltre agli amministratori).
CREATE TABLE software_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO software_settings (key, value) VALUES ('it_department', 'IT - Sistemi Informativi');

CREATE TABLE software_proposals (
  id           SERIAL PRIMARY KEY,
  person_oid   TEXT NOT NULL,
  person_name  TEXT NOT NULL,
  person_email TEXT NOT NULL DEFAULT '',
  job_title    TEXT,
  department   TEXT,
  package_id   INTEGER REFERENCES software_packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,                       -- copiato: la proposta resta leggibile anche se il pacchetto sparisce
  status       TEXT NOT NULL DEFAULT 'da_accettare' CHECK (status IN ('da_accettare', 'accettata', 'rifiutata')),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ
);
-- una proposta per persona e pacchetto
CREATE UNIQUE INDEX software_proposals_uq ON software_proposals (person_oid, package_id);
CREATE INDEX software_proposals_status ON software_proposals (status);

CREATE TABLE software_proposal_items (
  proposal_id INTEGER NOT NULL REFERENCES software_proposals(id) ON DELETE CASCADE,
  plan_id     INTEGER NOT NULL REFERENCES software_plans(id) ON DELETE CASCADE,
  accepted    BOOLEAN,                               -- NULL finché il team IT non decide
  PRIMARY KEY (proposal_id, plan_id)
);

-- notifica al team IT: «persona nuova, proposta da accettare»
ALTER TABLE notifications ADD COLUMN software_proposal_id INTEGER REFERENCES software_proposals(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal'));
