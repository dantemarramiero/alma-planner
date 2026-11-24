-- Nuovi business come progetto (ALM2-79, canvas Ac62wRtgybwk2ZQJW7N68F approvato da Dante il 24/11/2026):
-- ogni iniziativa ha da subito il suo progetto di Alma Space (compiti, relazioni, incontri, calendario, email, note,
-- documenti, Gantt, membri). Il progetto nasce la prima volta che si apre l'iniziativa (come per gli A3).
-- «Porta avanti» non crea più un secondo progetto: aggiunge squadra, piano e obiettivo allo stesso e lo segna lanciato.
ALTER TABLE crm_initiatives ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;
-- le iniziative già portate avanti hanno già il loro progetto, lanciato
UPDATE crm_initiatives SET launched_at = updated_at WHERE project_id IS NOT NULL AND launched_at IS NULL;

-- ogni passo del piano è un compito vero del progetto (titolo, chi, scadenza e «fatto» vanno e vengono)
ALTER TABLE crm_initiative_tasks ADD COLUMN IF NOT EXISTS ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS crm_initiative_tasks_ticket ON crm_initiative_tasks (ticket_id) WHERE ticket_id IS NOT NULL;
