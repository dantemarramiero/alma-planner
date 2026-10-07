-- Attività del Gantt create a mano (i ticket con date del progetto sono le altre attività)
-- e file allegati al progetto o a una sua attività.

CREATE TABLE activities (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);
CREATE INDEX activities_project_idx ON activities(project_id);

CREATE TABLE activity_assignees (
  activity_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX activity_assignees_user_idx ON activity_assignees(user_id);

-- activity_id NULL = file del progetto intero
CREATE TABLE project_files (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_id  INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  drive_id     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  web_url      TEXT,
  size         BIGINT,
  added_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_files_project_idx ON project_files(project_id);
CREATE UNIQUE INDEX project_files_unique_idx ON project_files(project_id, COALESCE(activity_id, 0), drive_id, item_id);
