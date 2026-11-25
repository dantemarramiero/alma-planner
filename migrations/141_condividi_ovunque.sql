-- ALM2-87 (canvas «Condividi ovunque», via di Dante 24/11/2026): «Condividi» su progetti e su ogni scheda del CRM,
-- con Teams ed email oltre all'avviso in Alma. Le condivisioni restano in crm_shares (azienda e contatto tengono le
-- loro colonne, che cancellano la riga con la scheda); ogni riga ha ora il tipo di scheda (kind) e il suo id (ref_id).
--   kind: subjects | contacts | projects | business | energy | impianti
--   teams / mail: '' = non scelto · 'ok' = partito · 'errore' = non partito (il motivo in error)
ALTER TABLE crm_shares ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE crm_shares ADD COLUMN IF NOT EXISTS ref_id INTEGER;
ALTER TABLE crm_shares ADD COLUMN IF NOT EXISTS teams TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_shares ADD COLUMN IF NOT EXISTS mail TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_shares ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';

UPDATE crm_shares SET kind = 'subjects', ref_id = subject_id WHERE kind IS NULL AND subject_id IS NOT NULL;
UPDATE crm_shares SET kind = 'contacts', ref_id = contact_id WHERE kind IS NULL AND contact_id IS NOT NULL;

ALTER TABLE crm_shares DROP CONSTRAINT IF EXISTS crm_shares_check;
ALTER TABLE crm_shares ALTER COLUMN kind SET NOT NULL;
ALTER TABLE crm_shares ALTER COLUMN ref_id SET NOT NULL;
ALTER TABLE crm_shares ADD CONSTRAINT crm_shares_kind CHECK (kind IN ('subjects', 'contacts', 'projects', 'business', 'energy', 'impianti'));

CREATE INDEX IF NOT EXISTS crm_shares_ref ON crm_shares (kind, ref_id, created_at DESC);
