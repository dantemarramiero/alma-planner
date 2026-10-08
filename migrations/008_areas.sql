-- Macro aree personali: ognuno si crea le sue (es. «Clienti», «Marketing», «Interni») e ci mette i progetti che vede.
-- Le macro aree di una persona non le vede nessun altro. Lo stesso progetto può stare in macro aree diverse per persone
-- diverse; per ciascuno al massimo in una. Cancellando una macro area i suoi progetti tornano «senza macro area».

CREATE TABLE areas (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#5B6770',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX areas_user_name_idx ON areas (user_id, lower(name));

-- in quale macro area (di quella persona) sta il progetto
CREATE TABLE project_areas (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id     INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX project_areas_area_idx ON project_areas(area_id);
