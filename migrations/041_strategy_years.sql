-- Alma Strategy: un solo Gantt, Hoshin Kanri di più anni, inviti all'A3.
-- 1. Le contromisure hanno anche la data di inizio, allineata a quella del loro ticket: il Gantt dell'A3 e quello
--    del progetto mostrano le stesse barre.
-- 2. Fine anno: ogni A3 aperto si chiude, prosegue fuori dall'Hoshin Kanri dell'anno dopo, oppure entra nell'Hoshin
--    Kanri dell'anno dopo (una copia collegata, con le stesse contromisure e gli stessi ticket).
-- 3. Inviti all'A3: chi è stato invitato, da chi, con quale nota (la email parte dalla casella di chi invita).

ALTER TABLE hk_tasks ADD COLUMN start_date DATE;
UPDATE hk_tasks t SET start_date = k.start_date FROM tickets k WHERE k.id = t.ticket_id AND k.start_date IS NOT NULL;

ALTER TABLE hk_projects ADD COLUMN carry TEXT CHECK (carry IN ('chiuso', 'fuori', 'inserito'));
ALTER TABLE hk_projects ADD COLUMN carried_from INTEGER REFERENCES hk_projects(id) ON DELETE SET NULL;
ALTER TABLE hk_projects ADD COLUMN carry_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hk_projects ADD COLUMN carry_decided_at TIMESTAMPTZ;

CREATE TABLE hk_invites (
  id          SERIAL PRIMARY KEY,
  hk_project_id INTEGER NOT NULL REFERENCES hk_projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT NOT NULL DEFAULT '',
  emailed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hk_invites_project ON hk_invites(hk_project_id, created_at DESC);

-- un A3 che entra nell anno dopo e una copia collegata con lo stesso progetto: un A3 per progetto per anno
DROP INDEX IF EXISTS hk_projects_project;
CREATE UNIQUE INDEX hk_projects_project_year ON hk_projects(project_id, year) WHERE project_id IS NOT NULL;
-- le contromisure dello stesso A3 nei due anni hanno lo stesso ticket
DROP INDEX IF EXISTS hk_tasks_ticket;
CREATE INDEX hk_tasks_ticket ON hk_tasks(ticket_id) WHERE ticket_id IS NOT NULL;

-- l invito e una richiesta: la persona accetta (ed entra nel team) o rifiuta, con una risposta facoltativa
ALTER TABLE hk_invites ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined'));
ALTER TABLE hk_invites ADD COLUMN reply TEXT NOT NULL DEFAULT '';
ALTER TABLE hk_invites ADD COLUMN answered_at TIMESTAMPTZ;
