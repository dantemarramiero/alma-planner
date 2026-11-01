-- Alma Energy: Impianti target (ALM2-15 … ALM2-17).
-- Un target è un progetto di Alma Planet (Gantt, ticket, membri, documenti, note, incontri, email) segnato come energy:
-- lo vedono solo i membri del modulo. L'opportunità resta la scheda dell'impianto e ricorda lo step dell'iter commerciale,
-- la checklist di ogni step e l'esito (acquisito o perso).
ALTER TABLE projects ADD COLUMN energy BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE energy_opportunities ADD COLUMN target_step TEXT;
ALTER TABLE energy_opportunities ADD COLUMN target_outcome TEXT CHECK (target_outcome IN ('acquisito', 'perso'));
ALTER TABLE energy_opportunities ADD COLUMN target_checklist JSONB NOT NULL DEFAULT '{}';
ALTER TABLE energy_opportunities ADD COLUMN target_step_changed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX energy_opportunities_project ON energy_opportunities (project_id) WHERE project_id IS NOT NULL;
