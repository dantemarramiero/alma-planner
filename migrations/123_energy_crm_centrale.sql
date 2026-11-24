-- Alma Energy sul CRM centrale (ALM2-83 tappa 1, tavole approvate da Dante il 24/11/2026: «le informazioni anche se
-- decentralizzate convergono tutte sul CRM centrale; qui è come se fossero solo filtrate»).
-- Ogni azienda di Energy è una scheda del CRM centrale (crm_subjects, BU «energy») e ogni persona un contatto
-- (crm_contacts). Le tabelle di Energy restano come estensione della scheda (tipi, campi del tipo, convenzioni,
-- opportunità). I trigger tengono tutto allineato da qualunque pagina si scriva:
--   - un'azienda o una persona nuova o cambiata in Energy aggiorna (o crea) la sua scheda centrale;
--   - una scheda centrale cambiata (nome, città, contatti…) aggiorna Energy; un doppione unito passa alla scheda buona;
--   - chi lavora dove (energy_person_companies) diventa un collegamento del contatto (crm_contact_links).

ALTER TABLE energy_companies ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS energy_companies_subject ON energy_companies (subject_id) WHERE subject_id IS NOT NULL;
ALTER TABLE energy_people ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS energy_people_contact ON energy_people (contact_id) WHERE contact_id IS NOT NULL;

-- La scheda centrale di un'azienda di Energy: stessa P.IVA, stesso codice fiscale o stesso nome; se no, nuova.
-- Non sovrascrive i dati già scritti nel CRM centrale, completa solo quelli vuoti e aggiunge la BU Energy.
CREATE OR REPLACE FUNCTION energy_subject_for(e energy_companies) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE sid integer;
DECLARE seg text := CASE WHEN 'investitore' = ANY(e.types) THEN 'Fondo o investitore' ELSE 'Energia' END;
DECLARE rol text := CASE WHEN 'progettista' = ANY(e.types) THEN 'progettista'
                         WHEN e.types && ARRAY['epc', 'om', 'consulente', 'banca']::text[] AND NOT e.types && ARRAY['proprietario', 'sviluppatore', 'cliente', 'investitore']::text[] THEN 'fornitore'
                         ELSE 'lead' END;
BEGIN
  IF e.vat <> '' THEN SELECT id INTO sid FROM crm_subjects WHERE vat = e.vat AND merged_into IS NULL LIMIT 1; END IF;
  IF sid IS NULL AND e.tax_code <> '' THEN SELECT id INTO sid FROM crm_subjects WHERE tax_code = e.tax_code AND merged_into IS NULL LIMIT 1; END IF;
  IF sid IS NULL THEN SELECT id INTO sid FROM crm_subjects WHERE lower(name) = lower(e.name) AND merged_into IS NULL ORDER BY id LIMIT 1; END IF;
  IF sid IS NULL THEN
    INSERT INTO crm_subjects (name, vat, tax_code, legal_form, ateco, pec, phone, website, address, city, province, region,
                              roles, asa, segment, owner_id, origin, notes, created_by)
    VALUES (e.name, e.vat,
            CASE WHEN e.tax_code <> '' AND NOT EXISTS (SELECT 1 FROM crm_subjects WHERE tax_code = e.tax_code AND merged_into IS NULL) THEN e.tax_code ELSE '' END,
            e.legal_form, e.ateco, e.pec, e.phone, e.website, e.address, e.city, e.province, e.region,
            ARRAY[rol], ARRAY['energy'], seg, e.owner_id, 'Alma Energy', '', e.created_by)
    RETURNING id INTO sid;
  ELSE
    UPDATE crm_subjects SET
      asa = CASE WHEN 'energy' = ANY(asa) THEN asa ELSE array_append(asa, 'energy') END,
      roles = CASE WHEN roles = '{}' THEN ARRAY[rol] WHEN rol = 'progettista' AND NOT 'progettista' = ANY(roles) THEN array_append(roles, 'progettista') ELSE roles END,
      segment = CASE WHEN segment = '' THEN seg ELSE segment END,
      city = CASE WHEN city = '' THEN e.city ELSE city END, province = CASE WHEN province = '' THEN e.province ELSE province END,
      region = CASE WHEN region = '' THEN e.region ELSE region END, address = CASE WHEN address = '' THEN e.address ELSE address END,
      phone = CASE WHEN phone = '' THEN e.phone ELSE phone END, website = CASE WHEN website = '' THEN e.website ELSE website END,
      pec = CASE WHEN pec = '' THEN e.pec ELSE pec END, ateco = CASE WHEN ateco = '' THEN e.ateco ELSE ateco END,
      vat = CASE WHEN vat = '' AND e.vat <> '' AND NOT EXISTS (SELECT 1 FROM crm_subjects x WHERE x.vat = e.vat AND x.merged_into IS NULL) THEN e.vat ELSE vat END,
      updated_at = now()
    WHERE id = sid;
  END IF;
  RETURN sid;
END $$;

-- Azienda nuova o cambiata in Energy → scheda centrale (i trigger chiamati da un altro trigger non rimbalzano).
CREATE OR REPLACE FUNCTION energy_companies_to_crm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.subject_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm_subjects WHERE id = NEW.subject_id) THEN
    NEW.subject_id := energy_subject_for(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE crm_subjects SET name = NEW.name, legal_form = NEW.legal_form, ateco = NEW.ateco, pec = NEW.pec, phone = NEW.phone,
           website = NEW.website, address = NEW.address, city = NEW.city, province = NEW.province, region = NEW.region,
           asa = CASE WHEN 'energy' = ANY(asa) THEN asa ELSE array_append(asa, 'energy') END, updated_at = now()
     WHERE id = NEW.subject_id
       AND (name, legal_form, ateco, pec, phone, website, address, city, province, region)
           IS DISTINCT FROM (NEW.name, NEW.legal_form, NEW.ateco, NEW.pec, NEW.phone, NEW.website, NEW.address, NEW.city, NEW.province, NEW.region);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS energy_companies_to_crm ON energy_companies;
CREATE TRIGGER energy_companies_to_crm BEFORE INSERT OR UPDATE ON energy_companies FOR EACH ROW EXECUTE FUNCTION energy_companies_to_crm();

-- Scheda centrale cambiata → Energy; doppione unito → Energy passa alla scheda buona (se non ce l'ha già un'altra azienda).
CREATE OR REPLACE FUNCTION crm_subjects_to_energy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.merged_into IS NOT NULL AND OLD.merged_into IS NULL THEN
    UPDATE energy_companies SET subject_id = NEW.merged_into
     WHERE subject_id = NEW.id AND NOT EXISTS (SELECT 1 FROM energy_companies x WHERE x.subject_id = NEW.merged_into);
    RETURN NEW;
  END IF;
  UPDATE energy_companies SET name = NEW.name, vat = CASE WHEN NEW.vat <> '' AND NOT EXISTS (SELECT 1 FROM energy_companies x WHERE x.vat = NEW.vat AND x.subject_id <> NEW.id) THEN NEW.vat ELSE vat END,
         legal_form = NEW.legal_form, ateco = NEW.ateco, pec = NEW.pec, phone = NEW.phone, website = NEW.website,
         address = NEW.address, city = NEW.city, province = NEW.province, region = NEW.region, updated_at = now()
   WHERE subject_id = NEW.id
     AND (name, vat, legal_form, ateco, pec, phone, website, address, city, province, region)
         IS DISTINCT FROM (NEW.name, NEW.vat, NEW.legal_form, NEW.ateco, NEW.pec, NEW.phone, NEW.website, NEW.address, NEW.city, NEW.province, NEW.region);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_subjects_to_energy ON crm_subjects;
CREATE TRIGGER crm_subjects_to_energy AFTER UPDATE ON crm_subjects FOR EACH ROW EXECUTE FUNCTION crm_subjects_to_energy();

-- Il contatto centrale di una persona di Energy: stessa email, se no nuovo.
CREATE OR REPLACE FUNCTION energy_contact_for(p energy_people) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE cid integer;
BEGIN
  IF p.email <> '' THEN SELECT id INTO cid FROM crm_contacts WHERE lower(email) = lower(p.email) ORDER BY id LIMIT 1; END IF;
  IF cid IS NULL THEN
    INSERT INTO crm_contacts (title, first_name, last_name, email, mobile, phone, linkedin, owner_id, legal_basis, notes, created_by)
    VALUES (p.title, p.first_name, p.last_name, p.email, p.mobile, p.phone, p.linkedin, p.owner_id, p.legal_basis, '', p.created_by)
    RETURNING id INTO cid;
  END IF;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION energy_people_to_crm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.contact_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = NEW.contact_id) THEN
    NEW.contact_id := energy_contact_for(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE crm_contacts SET title = NEW.title, first_name = NEW.first_name, last_name = NEW.last_name, email = NEW.email,
           mobile = NEW.mobile, phone = NEW.phone, linkedin = NEW.linkedin, updated_at = now()
     WHERE id = NEW.contact_id
       AND (title, first_name, last_name, email, mobile, phone, linkedin) IS DISTINCT FROM (NEW.title, NEW.first_name, NEW.last_name, NEW.email, NEW.mobile, NEW.phone, NEW.linkedin);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS energy_people_to_crm ON energy_people;
CREATE TRIGGER energy_people_to_crm BEFORE INSERT OR UPDATE ON energy_people FOR EACH ROW EXECUTE FUNCTION energy_people_to_crm();

CREATE OR REPLACE FUNCTION crm_contacts_to_energy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  UPDATE energy_people SET title = NEW.title, first_name = NEW.first_name, last_name = NEW.last_name, email = NEW.email,
         mobile = NEW.mobile, phone = NEW.phone, linkedin = NEW.linkedin, updated_at = now()
   WHERE contact_id = NEW.id
     AND (title, first_name, last_name, email, mobile, phone, linkedin) IS DISTINCT FROM (NEW.title, NEW.first_name, NEW.last_name, NEW.email, NEW.mobile, NEW.phone, NEW.linkedin);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_contacts_to_energy ON crm_contacts;
CREATE TRIGGER crm_contacts_to_energy AFTER UPDATE ON crm_contacts FOR EACH ROW EXECUTE FUNCTION crm_contacts_to_energy();

-- Chi lavora dove: anche nel CRM centrale.
CREATE OR REPLACE FUNCTION energy_person_companies_to_crm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO crm_contact_links (contact_id, subject_id, job)
  SELECT p.contact_id, c.subject_id, NEW.role FROM energy_people p, energy_companies c
   WHERE p.id = NEW.person_id AND c.id = NEW.company_id AND p.contact_id IS NOT NULL AND c.subject_id IS NOT NULL
  ON CONFLICT (contact_id, subject_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS energy_person_companies_to_crm ON energy_person_companies;
CREATE TRIGGER energy_person_companies_to_crm AFTER INSERT OR UPDATE ON energy_person_companies FOR EACH ROW EXECUTE FUNCTION energy_person_companies_to_crm();

-- Quelle che ci sono già: ogni azienda e persona riceve la sua scheda (il trigger fa il lavoro), poi i collegamenti.
UPDATE energy_companies SET updated_at = updated_at WHERE subject_id IS NULL;
UPDATE energy_people SET updated_at = updated_at WHERE contact_id IS NULL;
INSERT INTO crm_contact_links (contact_id, subject_id, job)
SELECT p.contact_id, c.subject_id, pc.role FROM energy_person_companies pc
  JOIN energy_people p ON p.id = pc.person_id JOIN energy_companies c ON c.id = pc.company_id
 WHERE p.contact_id IS NOT NULL AND c.subject_id IS NOT NULL
ON CONFLICT (contact_id, subject_id) DO NOTHING;
