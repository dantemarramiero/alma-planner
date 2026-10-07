-- Organigramma: copia delle persone del tenant Microsoft (ruolo, reparto, sede, responsabile).
-- Si aggiorna da Microsoft Graph con «Aggiorna da Microsoft»; chi non c'è più nell'ultima lettura viene tolto.

CREATE TABLE org_people (
  oid          TEXT PRIMARY KEY,           -- id dell'utente in Entra
  name         TEXT NOT NULL,
  email        TEXT,
  job_title    TEXT,
  department   TEXT,
  office       TEXT,
  manager_oid  TEXT,                       -- responsabile diretto (oid), NULL se non indicato in Entra
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX org_people_manager_idx ON org_people(manager_oid);
CREATE INDEX org_people_email_idx ON org_people(lower(email));

CREATE TABLE org_sync (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced_at   TIMESTAMPTZ NOT NULL,
  synced_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  people      INTEGER NOT NULL,
  with_manager INTEGER NOT NULL
);
