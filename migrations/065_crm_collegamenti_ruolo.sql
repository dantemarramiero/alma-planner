-- Collegamenti con il ruolo (canvas v9 «Collegamenti», Dante 19/11/2026): a una gara/opportunità del Radar o a un progetto
-- si collegano aziende e persone del CRM di qualsiasi tipo, con il loro ruolo (ente appaltante, RUP, partner ATI…).
ALTER TABLE crm_project_links ADD COLUMN role TEXT NOT NULL DEFAULT '';

CREATE TABLE crm_signal_links (
  id          SERIAL PRIMARY KEY,
  signal_id   INTEGER NOT NULL REFERENCES crm_signals(id) ON DELETE CASCADE,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT '',
  linked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((subject_id IS NULL) <> (contact_id IS NULL))
);
CREATE UNIQUE INDEX crm_signal_links_subject ON crm_signal_links (signal_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX crm_signal_links_contact ON crm_signal_links (signal_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX crm_signal_links_s ON crm_signal_links (subject_id);
CREATE INDEX crm_signal_links_c ON crm_signal_links (contact_id);
