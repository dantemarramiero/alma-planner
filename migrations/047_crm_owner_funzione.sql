-- CRM: ogni anagrafica ha un owner (obbligatorio, controllato dalle API: owner_id resta NULL solo se l'utente
-- viene cancellato) e una funzione aziendale di riferimento = reparto dell'organigramma, come le RDA interne
-- (decisione di Dante del 13/11/2026).
ALTER TABLE crm_subjects ADD COLUMN function_name TEXT NOT NULL DEFAULT '';
CREATE INDEX crm_subjects_function ON crm_subjects (function_name) WHERE function_name <> '';
CREATE INDEX crm_subjects_owner ON crm_subjects (owner_id);
