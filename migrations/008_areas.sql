-- Macro aree: raggruppano i progetti (es. «Marketing», «Clienti», «Interni»). Un progetto sta in una sola macro area,
-- oppure in nessuna. Cancellando una macro area i suoi progetti restano, senza macro area.

CREATE TABLE areas (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#5B6770',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX areas_name_idx ON areas (lower(name));

ALTER TABLE projects ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL;
CREATE INDEX projects_area_idx ON projects(area_id);
