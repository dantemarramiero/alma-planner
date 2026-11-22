-- SOA delle aziende del CRM prese da ANAC con la P.IVA (canvas CRM v14 · V14-SOA-CRM, via di Dante 22/11/2026).
-- soa resta quello scritto a mano; soa_anac è la copia dell'attestazione trovata in crm_soa (si tiene anche quando
-- sparisce da ANAC, per mostrarla scaduta); soa_choice = 'mine' se si è scelto «Tieni le mie» davanti alle differenze.
ALTER TABLE crm_subjects ADD COLUMN IF NOT EXISTS soa_anac JSONB;
ALTER TABLE crm_subjects ADD COLUMN IF NOT EXISTS soa_choice TEXT NOT NULL DEFAULT '';
