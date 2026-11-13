-- CRM: email, incontri, note e progetti su aziende e contatti, come negli A3 (canvas del 12–13/11/2026).
-- Email e incontri sono copiati una volta sola (come nei progetti) e collegati a più aziende o contatti.
-- Quello che è collegato a un contatto ricade sulle aziende dove lavora alla data dell'email, dell'incontro o
-- della nota (crm_contact_links con date_from/date_to): lo calcolano le query, qui non si duplica niente.

-- Note come negli A3: tipo, titolo, data, fissa in alto, autore, eliminazione annullabile, file.
-- Una nota sta su un'azienda, su un contatto oppure su un incontro (e allora compare ovunque sia collegato l'incontro).
CREATE TABLE crm_meetings (
  id                 SERIAL PRIMARY KEY,
  ical_uid           TEXT NOT NULL,              -- uguale per tutti gli invitati: lo stesso incontro è uno solo
  start_at           TIMESTAMP NOT NULL,         -- ora italiana
  end_at             TIMESTAMP,
  all_day            BOOLEAN NOT NULL DEFAULT false,
  subject            TEXT NOT NULL DEFAULT '',
  location           TEXT,
  organizer_name     TEXT,
  organizer_address  TEXT,
  attendees          JSONB NOT NULL DEFAULT '[]', -- [{ name, address }]
  online_url         TEXT,
  body_text          TEXT NOT NULL DEFAULT '',    -- solo per gli incontri collegati a mano (quelli automatici non copiano l'invito)
  linked_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outlook_id         TEXT,
  web_link           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ical_uid, start_at)
);
CREATE INDEX crm_meetings_start ON crm_meetings (start_at DESC);

-- A chi è collegato un incontro. auto = trovato da solo nel calendario; removed = tolto a mano, non torna più.
CREATE TABLE crm_meeting_links (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER NOT NULL REFERENCES crm_meetings(id) ON DELETE CASCADE,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  auto        BOOLEAN NOT NULL DEFAULT false,
  removed     BOOLEAN NOT NULL DEFAULT false,
  linked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((subject_id IS NULL) <> (contact_id IS NULL))
);
CREATE UNIQUE INDEX crm_meeting_links_subject ON crm_meeting_links (meeting_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX crm_meeting_links_contact ON crm_meeting_links (meeting_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX crm_meeting_links_s ON crm_meeting_links (subject_id) WHERE NOT removed;
CREATE INDEX crm_meeting_links_c ON crm_meeting_links (contact_id) WHERE NOT removed;

-- Avviso «incontro senza note» già mandato (uno per incontro)
CREATE TABLE crm_meeting_alerts (
  meeting_id  INTEGER PRIMARY KEY REFERENCES crm_meetings(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crm_notes (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  meeting_id  INTEGER REFERENCES crm_meetings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'nota' CHECK (kind IN ('nota', 'telefonata', 'riunione', 'decisione')),
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  note_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  CHECK (num_nonnulls(subject_id, contact_id, meeting_id) = 1)
);
CREATE INDEX crm_notes_subject ON crm_notes (subject_id) WHERE deleted_at IS NULL;
CREATE INDEX crm_notes_contact ON crm_notes (contact_id) WHERE deleted_at IS NULL;
CREATE INDEX crm_notes_meeting ON crm_notes (meeting_id) WHERE deleted_at IS NULL;

CREATE TABLE crm_note_files (
  id            SERIAL PRIMARY KEY,
  note_id       INTEGER NOT NULL REFERENCES crm_notes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_note_files_note ON crm_note_files (note_id);

-- Email di Outlook collegate (mai in automatico: si propongono e si collegano con un clic)
CREATE TABLE crm_emails (
  id                   SERIAL PRIMARY KEY,
  internet_message_id  TEXT NOT NULL UNIQUE,
  subject              TEXT NOT NULL DEFAULT '',
  from_name            TEXT,
  from_address         TEXT,
  to_list              JSONB NOT NULL DEFAULT '[]',
  cc_list              JSONB NOT NULL DEFAULT '[]',
  sent_at              TIMESTAMPTZ,
  body_text            TEXT NOT NULL DEFAULT '',
  assigned_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  outlook_id           TEXT,
  web_link             TEXT
);
CREATE TABLE crm_email_attachments (
  id            SERIAL PRIMARY KEY,
  email_id      INTEGER NOT NULL REFERENCES crm_emails(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL
);
CREATE TABLE crm_email_links (
  id          SERIAL PRIMARY KEY,
  email_id    INTEGER NOT NULL REFERENCES crm_emails(id) ON DELETE CASCADE,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  linked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((subject_id IS NULL) <> (contact_id IS NULL))
);
CREATE UNIQUE INDEX crm_email_links_subject ON crm_email_links (email_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX crm_email_links_contact ON crm_email_links (email_id, contact_id) WHERE contact_id IS NOT NULL;

-- Progetti di Alma Project collegati a un'azienda o a un contatto
CREATE TABLE crm_project_links (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  linked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((subject_id IS NULL) <> (contact_id IS NULL))
);
CREATE UNIQUE INDEX crm_project_links_subject ON crm_project_links (project_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE UNIQUE INDEX crm_project_links_contact ON crm_project_links (project_id, contact_id) WHERE contact_id IS NOT NULL;

-- Indirizzi visti negli incontri con il dominio di un'azienda ma non ancora nel CRM: proposti come contatti
CREATE TABLE crm_contact_proposals (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL CHECK (email = lower(email)),
  name        TEXT NOT NULL DEFAULT '',
  meeting_id  INTEGER REFERENCES crm_meetings(id) ON DELETE SET NULL,
  dismissed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, email)
);

-- Ultimo giro del collegamento automatico per persona (per non rileggere sempre tutto)
CREATE TABLE crm_calendar_sync (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'ok'
);

-- avviso nella campanella
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy', 'it',
                  'new_post', 'ticket_assigned', 'a3_update', 'crm'));
