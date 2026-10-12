-- Prospetto dei software per categoria di Dante (13/10/2026, «Prospetto sw per categoria.xlsx»): software, licenze
-- e pacchetti per ruolo di partenza del censimento. Si caricano solo nell'ambiente vero (con l'organigramma di
-- Microsoft già letto), non nei database vuoti dei test. Non sovrascrive niente di già inserito.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_people) THEN
    RETURN;
  END IF;

  -- Microsoft 365: stesso software e stesse licenze che poi l'«Aggiorna» da Microsoft riconosce (per codice SKU)
  INSERT INTO software (name, vendor, category, source, external_id)
  VALUES ('Microsoft 365', 'Microsoft', 'Produttività e posta', 'microsoft', 'microsoft-365')
  ON CONFLICT DO NOTHING;

  INSERT INTO software_plans (software_id, name, external_id)
  SELECT s.id, x.name, x.sku
    FROM software s,
         (VALUES ('Exchange Online (Plan 1)', 'EXCHANGESTANDARD'),
                 ('Microsoft 365 Business Standard', 'O365_BUSINESS_PREMIUM'),
                 ('Power BI Pro', 'POWER_BI_PRO'),
                 ('Project Plan 3', 'PROJECTPROFESSIONAL')) AS x(name, sku)
   WHERE lower(s.name) = 'microsoft 365'
     AND NOT EXISTS (SELECT 1 FROM software_plans p WHERE p.software_id = s.id AND (p.external_id = x.sku OR lower(p.name) = lower(x.name)));

  UPDATE software_plans p SET notes =
    'Cosa contiene: Word, Excel, PowerPoint, Outlook e OneNote (desktop, web e telefono); Exchange Online, posta con il dominio aziendale; '
    || 'OneDrive con 1 TB per persona; SharePoint per archivi, siti e cartelle condivise; Microsoft Teams (nella versione «con Teams»); '
    || 'Planner, To Do e Lists; Forms; Bookings; Loop; Clipchamp; Access (solo PC).'
    FROM software s
   WHERE p.software_id = s.id AND lower(s.name) = 'microsoft 365' AND p.external_id = 'O365_BUSINESS_PREMIUM' AND p.notes = '';

  -- software inseriti a mano, uno per prodotto, con il fornitore (si raggruppano per fornitore nel censimento)
  INSERT INTO software (name, vendor, category, notes)
  VALUES ('ABBYY FineReader', 'ABBYY', 'Documenti e firma', 'Su richiesta: impiegati amministrativi, impiegati tecnici, progettisti.'),
         ('AutoCAD', 'Autodesk', 'Progettazione e disegno', 'Su richiesta: impiegati tecnici, progettisti.'),
         ('progeCAD', 'ProgeSOFT', 'Progettazione e disegno', 'Su richiesta: impiegati tecnici, progettisti; a volte serve anche agli operai.'),
         ('Primus Power Pack', 'ACCA software', 'Computi e contabilità lavori', 'Su richiesta: impiegati tecnici, progettisti.'),
         ('Architecture Engineering & Construction Collection', 'Autodesk', 'Progettazione e disegno', 'Programma specifico della progettazione (3 licenze).'),
         ('AutoCAD Revit LT Suite', 'Autodesk', 'Progettazione e disegno', 'Programma specifico degli impiegati tecnici (2 licenze).'),
         ('Photoshop', 'Adobe', 'Grafica', 'Programma specifico della progettazione (1 licenza).')
  ON CONFLICT DO NOTHING;

  INSERT INTO software_plans (software_id, name, seats)
  SELECT s.id, 'Licenza', x.seats
    FROM software s
    JOIN (VALUES ('ABBYY FineReader', NULL::int), ('AutoCAD', NULL), ('progeCAD', NULL), ('Primus Power Pack', NULL),
                 ('Architecture Engineering & Construction Collection', 3), ('AutoCAD Revit LT Suite', 2), ('Photoshop', 1)) AS x(sw, seats)
      ON lower(s.name) = lower(x.sw)
   WHERE NOT EXISTS (SELECT 1 FROM software_plans p WHERE p.software_id = s.id);

  -- pacchetti per categoria; i ruoli di Microsoft si scelgono poi nel pacchetto (agli operai: «Worker»)
  INSERT INTO software_packages (name, description, job_titles)
  VALUES ('Impiegati amministrativi', 'Di base Microsoft 365 Business Standard; su richiesta Power BI Pro e ABBYY FineReader.', '{}'),
         ('Impiegati tecnici', 'Di base Microsoft 365 Business Standard; su richiesta Project Plan 3, ABBYY FineReader, AutoCAD, progeCAD, Primus Power Pack e AutoCAD Revit LT Suite.', '{}'),
         ('Progettisti', 'Di base Microsoft 365 Business Standard; su richiesta ABBYY FineReader, AutoCAD, progeCAD, Primus Power Pack, AEC Collection e Photoshop.', '{}'),
         ('Operai', 'Di base Exchange Online (Plan 1) per la posta; su richiesta progeCAD.', '{Worker}')
  ON CONFLICT DO NOTHING;

  INSERT INTO software_package_plans (package_id, plan_id, on_request)
  SELECT k.id, p.id, x.req
    FROM (VALUES
      ('Impiegati amministrativi', 'Microsoft 365', 'O365_BUSINESS_PREMIUM', false),
      ('Impiegati amministrativi', 'Microsoft 365', 'POWER_BI_PRO', true),
      ('Impiegati amministrativi', 'ABBYY FineReader', 'Licenza', true),
      ('Impiegati tecnici', 'Microsoft 365', 'O365_BUSINESS_PREMIUM', false),
      ('Impiegati tecnici', 'Microsoft 365', 'PROJECTPROFESSIONAL', true),
      ('Impiegati tecnici', 'ABBYY FineReader', 'Licenza', true),
      ('Impiegati tecnici', 'AutoCAD', 'Licenza', true),
      ('Impiegati tecnici', 'progeCAD', 'Licenza', true),
      ('Impiegati tecnici', 'Primus Power Pack', 'Licenza', true),
      ('Impiegati tecnici', 'AutoCAD Revit LT Suite', 'Licenza', true),
      ('Progettisti', 'Microsoft 365', 'O365_BUSINESS_PREMIUM', false),
      ('Progettisti', 'ABBYY FineReader', 'Licenza', true),
      ('Progettisti', 'AutoCAD', 'Licenza', true),
      ('Progettisti', 'progeCAD', 'Licenza', true),
      ('Progettisti', 'Primus Power Pack', 'Licenza', true),
      ('Progettisti', 'Architecture Engineering & Construction Collection', 'Licenza', true),
      ('Progettisti', 'Photoshop', 'Licenza', true),
      ('Operai', 'Microsoft 365', 'EXCHANGESTANDARD', false),
      ('Operai', 'progeCAD', 'Licenza', true)
    ) AS x(pkg, sw, plan, req)
    JOIN software_packages k ON lower(k.name) = lower(x.pkg)
    JOIN software s ON lower(s.name) = lower(x.sw)
    JOIN software_plans p ON p.software_id = s.id AND (p.external_id = x.plan OR (p.external_id IS NULL AND lower(p.name) = lower(x.plan)))
  ON CONFLICT DO NOTHING;
END $$;
