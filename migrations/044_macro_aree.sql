-- Hoshin Kanri: macro aree e sotto aree (canvas approvato da Dante l'11/11/2026).
-- Un'area senza parent_id è una macro area; con parent_id è una sotto area della sua macro area (stessa BU o funzione).
-- I progetti stanno su una sotto area oppure, se la macro area non ne ha, direttamente sulla macro area.
-- Le aree di oggi restano macro aree senza sotto aree: non si sposta niente.
ALTER TABLE hk_areas ADD COLUMN parent_id INTEGER REFERENCES hk_areas(id) ON DELETE CASCADE;
CREATE INDEX hk_areas_parent ON hk_areas (parent_id) WHERE parent_id IS NOT NULL;
