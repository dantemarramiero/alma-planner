-- Alma HR, correzioni al recruitment (ALM2-63, Dante 22/11):
-- la posizione della richiesta si può creare in Alma (resta in Alma); all'assunzione Alma manda a BOSS via API
-- solo la persona per creare l'anagrafica del personale; candidati aggiunti allegando il CV (chi li ha caricati).
-- a chi riporta la posizione (email): per un incarico vacante è chi ricopre l'incarico sopra, per una posizione nuova si sceglie
ALTER TABLE hr_requisitions ADD COLUMN IF NOT EXISTS riporta_a TEXT;
ALTER TABLE hr_applications ADD COLUMN IF NOT EXISTS added_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- invio della persona a BOSS: da_inviare → inviata, oppure errore (si riprova) o non_collegato (si copiano i dati)
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_stato TEXT NOT NULL DEFAULT 'da_inviare';
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_id TEXT;
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_url TEXT;
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_errore TEXT;
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_tentativi INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_preboarding ADD COLUMN IF NOT EXISTS boss_inviata_at TIMESTAMPTZ;

UPDATE hr_pre_tasks SET titolo = 'Anagrafica del personale a BOSS (via API)'
  WHERE chi = 'boss' AND NOT fatto;
