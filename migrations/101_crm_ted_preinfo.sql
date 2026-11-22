-- Avvisi di preinformazione TED nel Radar (canvas v17 · Le fonti del Radar, Dante 22/11): la data prevista del bando
-- e se un caricamento ha già preso anche gli avvisi di preinformazione (la prima volta si riprendono 24 mesi).
ALTER TABLE crm_ted_notices ADD COLUMN IF NOT EXISTS future_on DATE;
ALTER TABLE crm_ted_imports ADD COLUMN IF NOT EXISTS pin BOOLEAN NOT NULL DEFAULT false;
