-- Mezzi: una piccola icona per categoria (auto, autocarro, furgone, escavatore…), scelta dai gestori.
-- Le categorie concordate con Dante il 13/10/2026 la ricevono subito; le altre la prendono dal nome nell'app.

ALTER TABLE vehicle_categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';

UPDATE vehicle_categories SET icon = CASE lower(name)
  WHEN 'autovetture' THEN 'auto'
  WHEN 'autocarri' THEN 'autocarro'
  WHEN 'furgoni con cassone aperto' THEN 'cassone-aperto'
  WHEN 'furgoni senza cassone' THEN 'furgone'
  WHEN 'furgoni con cassone chiuso' THEN 'cassone-chiuso'
  WHEN 'escavatori' THEN 'escavatore'
  WHEN 'escavatori con gru' THEN 'gru'
  WHEN 'motocicli' THEN 'moto'
  ELSE icon END
WHERE icon = '';
