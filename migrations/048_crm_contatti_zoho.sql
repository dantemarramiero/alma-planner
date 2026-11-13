-- CRM: codice Zoho anche sui contatti, per caricarli una volta sola e ritrovarli (primo caricamento da Zoho, 13/11/2026).
ALTER TABLE crm_contacts ADD COLUMN zoho_id TEXT NOT NULL DEFAULT '';
CREATE INDEX crm_contacts_zoho ON crm_contacts (zoho_id) WHERE zoho_id <> '';
