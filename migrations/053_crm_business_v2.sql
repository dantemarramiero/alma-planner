-- Nuovi business v2 (canvas «Design v2 · Nuovi business», Dante 14/11/2026):
-- probabilità dei rischi (matrice probabilità × impatto), ipotesi da verificare prima di un gate,
-- date di inizio e fine delle fasi per il Gantt del piano (i periodi scritti a mano restano come ripiego),
-- ultima sintesi dell'assistente in cima all'Analisi, ultima ricerca del radar dell'iniziativa.

ALTER TABLE crm_initiative_notes ADD COLUMN probability TEXT NOT NULL DEFAULT ''
  CHECK (probability IN ('', 'poco', 'possibile', 'probabile'));
ALTER TABLE crm_initiative_notes ADD COLUMN before_gate INTEGER CHECK (before_gate BETWEEN 0 AND 4);

ALTER TABLE crm_initiatives ADD COLUMN phase_dates JSONB NOT NULL DEFAULT '{}';   -- { analisi: { from: '2026-11-01', to: '2027-01-31' } }
ALTER TABLE crm_initiatives ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_initiatives ADD COLUMN summary_at TIMESTAMPTZ;
ALTER TABLE crm_initiatives ADD COLUMN radar_last JSONB NOT NULL DEFAULT '{}';    -- { at, found, added, cost }
