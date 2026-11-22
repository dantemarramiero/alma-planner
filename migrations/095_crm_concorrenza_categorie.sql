-- Riparazione (22/11/2026): fino a oggi il salvataggio di Impostazioni → Concorrenza toglieva la lettera «s» dalle
-- categorie in più (OS28 → O28) per una barra persa nel codice. Una categoria «O» + cifre può venire solo da «OS».
UPDATE crm_settings
   SET value = jsonb_set(value, '{extra_categories}',
       (SELECT COALESCE(jsonb_agg(CASE WHEN x ~ '^O[0-9]' THEN 'OS' || substr(x, 2) ELSE x END), '[]'::jsonb)
          FROM jsonb_array_elements_text(value->'extra_categories') AS x))
 WHERE key = 'concorrenza' AND jsonb_typeof(value->'extra_categories') = 'array';
