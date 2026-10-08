-- Email di Outlook assegnate a un progetto: se ne copiano testo e allegati, così le legge ogni membro del progetto
-- anche se l'originale resta nella casella di chi l'ha assegnata.

CREATE TABLE project_emails (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  internet_message_id  TEXT NOT NULL,              -- uguale per mittente e destinatari: la stessa email assegnata da due colleghi è una sola
  subject              TEXT NOT NULL DEFAULT '',
  from_name            TEXT,
  from_address         TEXT,
  to_list              JSONB NOT NULL DEFAULT '[]', -- [{ name, address }]
  cc_list              JSONB NOT NULL DEFAULT '[]',
  sent_at              TIMESTAMPTZ,
  body_text            TEXT NOT NULL DEFAULT '',
  assigned_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  outlook_id           TEXT,                        -- id nella casella di chi l'ha assegnata (per «Apri in Outlook»)
  web_link             TEXT,
  UNIQUE (project_id, internet_message_id)
);
CREATE INDEX project_emails_project_idx ON project_emails(project_id, sent_at DESC);

CREATE TABLE project_email_attachments (
  id            SERIAL PRIMARY KEY,
  email_id      INTEGER NOT NULL REFERENCES project_emails(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL
);
CREATE INDEX project_email_attachments_email_idx ON project_email_attachments(email_id);
