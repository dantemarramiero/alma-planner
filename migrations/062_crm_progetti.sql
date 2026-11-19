-- «Porta avanti» (canvas v9 approvato da Dante il 19/11/2026): un'opportunità del Radar o un'iniziativa di Nuovi business
-- diventa un progetto vero di Alma Planet, in «I miei progetti» e con la sua scheda (compiti, incontri, calendario, note,
-- Gantt, rendiconto, documenti). I progetti del CRM li vedono tutti in sola lettura, come quelli degli A3.
ALTER TABLE projects ADD COLUMN crm_kind TEXT NOT NULL DEFAULT '' CHECK (crm_kind IN ('', 'gara', 'settore'));
-- obiettivo fissato al lancio: { value, probability, margin, hours, budget } → valore pesato e budget di ore del rendiconto
ALTER TABLE projects ADD COLUMN crm_goal JSONB NOT NULL DEFAULT '{}';
-- tappa raggiunta: gara 0 Seguo · 1 Contatto fatto · 2 Gara uscita · 3 Offerta · 4 Esito; settore 0…4 = G1…Go/No-go
ALTER TABLE projects ADD COLUMN crm_step INTEGER NOT NULL DEFAULT 0 CHECK (crm_step BETWEEN 0 AND 4);
CREATE INDEX projects_crm ON projects (crm_kind) WHERE crm_kind <> '';

ALTER TABLE crm_signals ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE crm_initiatives ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX crm_signals_project ON crm_signals (project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX crm_initiatives_project ON crm_initiatives (project_id) WHERE project_id IS NOT NULL;

-- fase del piano a cui appartiene il compito (1…4), per la sala di lancio e il rendiconto
ALTER TABLE tickets ADD COLUMN crm_phase SMALLINT;
