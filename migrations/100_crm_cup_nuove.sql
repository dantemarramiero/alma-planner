-- Opere finanziate per BU e segnali automatici (ALM2-49, canvas CRM v16): quando un'opera è arrivata la prima volta,
-- per fare segnali solo dalle opere nuove del mese. Le opere già caricate valgono come arrivate oggi.
ALTER TABLE crm_cup_works ADD COLUMN IF NOT EXISTS first_seen DATE NOT NULL DEFAULT CURRENT_DATE;
CREATE INDEX IF NOT EXISTS crm_cup_works_type ON crm_cup_works (type_key);
-- quanti segnali ha creato ogni caricamento (NULL = segnali non ancora fatti: la prima volta solo opere dell'ultimo anno)
ALTER TABLE crm_cup_imports ADD COLUMN IF NOT EXISTS signals INTEGER;
