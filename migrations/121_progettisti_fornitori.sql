-- ALM2-80 (Dante 24/11/2026): i progettisti sono anche fornitori, nella categoria Professionisti › Progettista.
UPDATE crm_subjects SET
  roles = ARRAY(SELECT DISTINCT unnest(roles || '{fornitore}'::text[])),
  supplier_categories = ARRAY(SELECT DISTINCT unnest(supplier_categories || '{professionisti}'::text[])),
  supplier_subcategories = ARRAY(SELECT DISTINCT unnest(supplier_subcategories || '{Progettista}'::text[]))
WHERE 'progettista' = ANY(roles) AND merged_into IS NULL;
