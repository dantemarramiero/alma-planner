-- Collegamenti tra attività come in Microsoft Project: tipo (FS fine-inizio, SS inizio-inizio, FF fine-fine,
-- SF inizio-fine) e scarto (lag) in giorni lavorativi, anche negativo (anticipo).
-- I collegamenti già esistenti restano con lag NULL: all'avvio lib/schedule.js lo calcola dalle date attuali,
-- così nessuna attività si sposta con la pubblicazione e ogni collegamento conserva lo scarto che ha oggi.
ALTER TABLE ticket_deps ADD COLUMN type TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF'));
ALTER TABLE ticket_deps ADD COLUMN lag INTEGER CHECK (lag BETWEEN -999 AND 999);
