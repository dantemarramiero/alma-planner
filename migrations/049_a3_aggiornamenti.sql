-- App 2.0 sul telefono (13/11/2026): «Aggiornamento del mese» di un A3 in un tocco (in linea / a rischio / fuori)
-- con una riga facoltativa per il team. Lo storico resta: l'ultimo è lo stato attuale.
CREATE TABLE hk_checkins (
  id            SERIAL PRIMARY KEY,
  hk_project_id INTEGER NOT NULL REFERENCES hk_projects(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('in_linea', 'a_rischio', 'fuori')),
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hk_checkins_project ON hk_checkins(hk_project_id, created_at DESC);
