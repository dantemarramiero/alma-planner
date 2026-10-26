-- Incontri del calendario Outlook collegati a un progetto (come le email): se ne copiano titolo, orari, luogo,
-- organizzatore, partecipanti e descrizione, così li vede ogni membro anche se l'evento sta nel calendario di chi
-- l'ha collegato. Le note dell'incontro sono note del progetto (tipo «riunione») con meeting_id: compaiono
-- nell'incontro e nel tab Note. I file si attaccano alle note (note_files), quindi seguono la nota ovunque.

CREATE TABLE project_meetings (
  id                 SERIAL PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ical_uid           TEXT NOT NULL,              -- uguale per tutti gli invitati: lo stesso incontro collegato da due colleghi è uno solo
  subject            TEXT NOT NULL DEFAULT '',
  start_at           TIMESTAMP NOT NULL,         -- ora italiana; con start_at distingue le occorrenze di un incontro che si ripete
  end_at             TIMESTAMP,
  all_day            BOOLEAN NOT NULL DEFAULT false,
  location           TEXT,
  organizer_name     TEXT,
  organizer_address  TEXT,
  attendees          JSONB NOT NULL DEFAULT '[]', -- [{ name, address }]
  online_url         TEXT,
  body_text          TEXT NOT NULL DEFAULT '',
  linked_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  outlook_id         TEXT,                        -- id nel calendario di chi l'ha collegato (per «Apri in Outlook»)
  web_link           TEXT,
  UNIQUE (project_id, ical_uid, start_at)
);
CREATE INDEX project_meetings_project_idx ON project_meetings(project_id, start_at DESC);

-- togliere l'incontro dal progetto non cancella le sue note: restano nel tab Note
ALTER TABLE notes ADD COLUMN meeting_id INTEGER REFERENCES project_meetings(id) ON DELETE SET NULL;
CREATE INDEX notes_meeting_idx ON notes(meeting_id) WHERE meeting_id IS NOT NULL;

CREATE TABLE note_files (
  id            SERIAL PRIMARY KEY,
  note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX note_files_note_idx ON note_files(note_id);
