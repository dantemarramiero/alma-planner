-- Alma Strategy: ogni A3 ha il suo progetto di Alma Planner (Gantt, ticket, documenti, email, incontri, note, membri)
-- e ogni contromisura il suo ticket. Chiudere il ticket chiude la contromisura, e viceversa.
ALTER TABLE hk_projects ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE hk_tasks ADD COLUMN ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX hk_projects_project ON hk_projects(project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX hk_tasks_ticket ON hk_tasks(ticket_id) WHERE ticket_id IS NOT NULL;

-- il progetto di un A3 si apre nella pagina dell'A3, come quello di un'opportunità di Alma Energy
ALTER TABLE projects ADD COLUMN hk BOOLEAN NOT NULL DEFAULT false;
