-- Aziende create al volo (18/11/2026, canvas «v8 · Contatto nuovo con un vocale»): con il solo nome, da Alma o dal campo
-- «Azienda» del nuovo contatto. Diventano lead con owner e ASA di chi le crea e restano segnate «da completare» (il «!»
-- rosso nelle liste e nella scheda) finché mancano P.IVA o città.
ALTER TABLE crm_subjects ADD COLUMN created_quick BOOLEAN NOT NULL DEFAULT false;
