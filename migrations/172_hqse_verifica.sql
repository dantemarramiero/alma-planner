-- HQSE fase 3 (ALM2-103, tavole 5 e 16–20 approvate da Dante il 27/11/2026): la verifica dei documenti con l'AI.
-- L'AI legge il documento e propone (approvabile, da respingere, incerto); decide sempre una persona HQSE.

-- «integrazione»: il documento va bene ma manca un pezzo; il fornitore lo completa e resta in verifica
ALTER TABLE hqse_documents DROP CONSTRAINT IF EXISTS hqse_documents_status_check;
ALTER TABLE hqse_documents ADD CONSTRAINT hqse_documents_status_check CHECK (status IN ('in_verifica', 'approvato', 'respinto', 'integrazione', 'superato'));

ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'attesa' CHECK (ai_status IN ('attesa', 'fatto', 'errore', 'spento'));
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS ai_proposal TEXT CHECK (ai_proposal IS NULL OR ai_proposal IN ('approvabile', 'respingere', 'incerto'));
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS ai_at TIMESTAMPTZ;
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS motivi TEXT[] NOT NULL DEFAULT '{}';     -- motivi scelti da HQSE (statistiche)
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS ai_agreed BOOLEAN;                        -- HQSE ha confermato la proposta?
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS quick BOOLEAN NOT NULL DEFAULT false;     -- approvato con l'approvazione rapida
ALTER TABLE hqse_documents ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;                 -- segnalato alla direzione (conflitto d'interessi)
CREATE INDEX IF NOT EXISTS hqse_documents_queue ON hqse_documents (created_at) WHERE status = 'in_verifica';

-- approvazione rapida per tipo di documento (si accende solo sopra il 95% di conferme e con almeno 30 verificati)
ALTER TABLE hqse_doc_types ADD COLUMN IF NOT EXISTS quick_approve BOOLEAN NOT NULL DEFAULT false;
