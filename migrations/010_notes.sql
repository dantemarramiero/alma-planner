-- Note con data su progetti e ticket (come le note del CRM di MyWinery): tipo, titolo facoltativo, data,
-- «fissa in alto», autore; l'eliminazione si può annullare (deleted_at).

CREATE TABLE notes (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id   INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'nota' CHECK (kind IN ('nota', 'telefonata', 'riunione', 'decisione')),
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  note_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,                       -- solo quando cambia il testo, il tipo, il titolo o la data
  deleted_at  TIMESTAMPTZ,
  CHECK ((project_id IS NULL) <> (ticket_id IS NULL))  -- una nota sta su un progetto oppure su un ticket
);
CREATE INDEX notes_project_idx ON notes(project_id) WHERE deleted_at IS NULL;
CREATE INDEX notes_ticket_idx ON notes(ticket_id) WHERE deleted_at IS NULL;
