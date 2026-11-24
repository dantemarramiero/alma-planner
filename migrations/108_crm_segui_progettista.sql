-- Dalla gara di progettazione alla gara dei lavori (ALM2-76, canvas «Radar · dalla progettazione ai lavori» approvato da
-- Dante il 24/11/2026): quando si trova una gara di progettazione, l'opportunità dei lavori va in «Prima del bando»
-- collegata alla gara di progettazione; Alma segue l'aggiudicazione (ANAC ogni notte col CIG, web ogni settimana),
-- censisce il progettista nel CRM e avvisa.
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS design_signal_id INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_designer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_cig TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_until DATE;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_checked_at TIMESTAMPTZ;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_web_at TIMESTAMPTZ;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS watch_note TEXT NOT NULL DEFAULT '';
-- il progettista trovato: { found_at, source: anac|web, confirmed, url, awarded_on, amount, team: [{ name, cf, role, subject_id }],
--   people: [{ name, role, company, source }], web: { subject_id, fields: [...] }, step_id, steps: { esecutivo_on, gara_on, gara_url } }
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS designer JSONB;
CREATE INDEX IF NOT EXISTS crm_signals_watch ON crm_signals (id) WHERE watch_designer;
CREATE INDEX IF NOT EXISTS crm_signals_design ON crm_signals (design_signal_id) WHERE design_signal_id IS NOT NULL;
