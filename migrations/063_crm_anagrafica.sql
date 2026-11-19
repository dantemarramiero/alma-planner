-- Anagrafica completa e «Cerca su internet» (canvas v9 «Anagrafica», Dante 19/11/2026)
ALTER TABLE crm_subjects ADD COLUMN zip TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_subjects ADD COLUMN linkedin TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_subjects ADD COLUMN employees TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_subjects ADD COLUMN revenue TEXT NOT NULL DEFAULT '';
-- dati presi da internet e non ancora confermati: { campo: { source, at, by } }; si tolgono quando qualcuno li conferma o li cambia
ALTER TABLE crm_subjects ADD COLUMN web_fields JSONB NOT NULL DEFAULT '{}';
