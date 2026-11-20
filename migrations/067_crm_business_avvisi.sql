-- Nuovi business · avvisi (Dante 20/11/2026): gate in scadenza (crm_initiative_gates.alerted_at, già c'era) e gate
-- scaduto, iniziativa ferma da 3 settimane, passo scaduto (crm_initiative_tasks.alerted_at, già c'era). Ogni avviso parte
-- una volta sola: queste colonne dicono quando è partito.
ALTER TABLE crm_initiative_gates ADD COLUMN IF NOT EXISTS overdue_alerted_at TIMESTAMPTZ;   -- «gate scaduto» già mandato
ALTER TABLE crm_initiatives ADD COLUMN IF NOT EXISTS quiet_alerted_at TIMESTAMPTZ;         -- «ferma da 3 settimane» già mandato
