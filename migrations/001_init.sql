-- Schema iniziale di Alma Planner.

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  oid          TEXT UNIQUE,                 -- id dell'utente in Microsoft Entra
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  job_title    TEXT,
  token_cache  TEXT,                        -- cache MSAL cifrata (refresh token per Graph)
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,             -- sha256 del valore nel cookie
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE projects (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  color              TEXT NOT NULL DEFAULT '#E85A0A',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','archived')),
  start_date         DATE,
  end_date           DATE,
  owner_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  onedrive_drive_id  TEXT,
  onedrive_item_id   TEXT,
  onedrive_name      TEXT,
  onedrive_url       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

CREATE TABLE tickets (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done')),
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  start_date          DATE,
  due_date            DATE,
  progress            INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  position            DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outlook_event_id    TEXT,
  outlook_event_owner INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
CREATE INDEX tickets_project_idx ON tickets(project_id);

CREATE TABLE ticket_assignees (
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX ticket_assignees_user_idx ON ticket_assignees(user_id);

CREATE TABLE ticket_deps (
  ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  depends_on_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, depends_on_id),
  CHECK (ticket_id <> depends_on_id)
);

CREATE TABLE ticket_files (
  id         SERIAL PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  drive_id   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  web_url    TEXT,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, drive_id, item_id)
);

CREATE TABLE ticket_comments (
  id         SERIAL PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_comments_ticket_idx ON ticket_comments(ticket_id);
