-- Documenti del progetto: si possono collegare anche cartelle di OneDrive (non solo file), più d'una alla volta.
-- Nella scheda una cartella collegata si apre e mostra il suo contenuto, letto da OneDrive.
ALTER TABLE project_files ADD COLUMN is_folder BOOLEAN NOT NULL DEFAULT false;
