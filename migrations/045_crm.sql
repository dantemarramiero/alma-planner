-- CRM di Alma Planet (canvas «CRM Alma Planet – anagrafiche», decisioni di Dante del 12/11/2026).
-- Un soggetto (azienda o ente con P.IVA) è una sola scheda con più ruoli: Lead o Cliente, Fornitore, Partner, Concorrente.
-- Le persone esterne sono contatti collegati ai soggetti (N:N con la qualifica e le date).
-- Ogni soggetto appartiene a una o più ASA: chi è di un'ASA vede solo i soggetti della sua, la direzione (amministratori) tutti.
-- L'anagrafica resta in Alma Planet: BOSS e il suo futuro CRM la useranno tramite l'ID.

-- ASA: le 9 di BOSS più Energy. Si possono aggiungere dalla pagina «ASA e accessi».
CREATE TABLE crm_asa (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,30}$'),
  label       TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  boss_label  TEXT NOT NULL DEFAULT '',  -- come si chiama in BOSS, per l'integrazione
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO crm_asa (key, label, boss_label, sort) VALUES
  ('edilizia', 'Edilizia', 'Edilizia', 10),
  ('restauro', 'Restauro', 'Restauro', 20),
  ('impianti', 'Impianti', 'Impianti', 30),
  ('reti_mp_bp', 'Reti MP/BP', 'RETI MP/BP', 40),
  ('reti_ap', 'Reti AP', 'RETI AP', 50),
  ('esco', 'ESCO', 'ESCO', 60),
  ('facility', 'Facility', 'FACILITY', 70),
  ('progettazione', 'Progettazione', 'Progettazione', 80),
  ('altri_servizi', 'Altri servizi', 'Altri servizi', 90),
  ('energy', 'Energy', '', 100);

-- Chi lavora in quale ASA. I membri di Alma Energy sono dell'ASA Energy anche senza stare qui.
CREATE TABLE crm_asa_members (
  asa_key     TEXT NOT NULL REFERENCES crm_asa(key) ON DELETE CASCADE ON UPDATE CASCADE,
  email       TEXT NOT NULL CHECK (email = lower(email)),
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asa_key, email)
);
CREATE INDEX crm_asa_members_email ON crm_asa_members (email);

CREATE TABLE crm_subjects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  short_name      TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'impresa' CHECK (kind IN ('impresa', 'ente_pubblico', 'partecipata', 'consorzio', 'professionista', 'condominio', 'altro')),
  legal_form      TEXT NOT NULL DEFAULT '',
  vat             TEXT NOT NULL DEFAULT '',   -- P.IVA: chiave contro i doppioni
  tax_code        TEXT NOT NULL DEFAULT '',
  ipa_code        TEXT NOT NULL DEFAULT '',   -- solo enti pubblici
  sdi_code        TEXT NOT NULL DEFAULT '',
  pec             TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  website         TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  province        TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',
  ateco           TEXT NOT NULL DEFAULT '',
  group_id        INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  roles           TEXT[] NOT NULL DEFAULT '{}' CHECK (roles <@ ARRAY['lead', 'cliente', 'fornitore', 'partner', 'concorrente']::text[]),
  asa             TEXT[] NOT NULL DEFAULT '{}',
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- responsabile Almacis
  status          TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'inattivo', 'bloccato')),
  block_reason    TEXT NOT NULL DEFAULT '',
  segment         TEXT NOT NULL DEFAULT '',   -- Comune, ASL, industria, immobiliare…
  -- lead: azienda che vorremmo come cliente
  lead_stage      TEXT NOT NULL DEFAULT 'da_contattare' CHECK (lead_stage IN ('da_contattare', 'contattato', 'incontro', 'opportunita', 'non_interessato')),
  lead_why        TEXT NOT NULL DEFAULT '',
  potential_value NUMERIC(16,2),
  priority        TEXT NOT NULL DEFAULT '' CHECK (priority IN ('', 'alta', 'media', 'bassa')),
  origin          TEXT NOT NULL DEFAULT '',
  referred_by     TEXT NOT NULL DEFAULT '',
  lost_reason     TEXT NOT NULL DEFAULT '',
  retry_date      DATE,
  client_since    DATE,                       -- quando è diventato cliente (prima commessa in BOSS)
  -- prossimo passo, sempre in alto nella scheda
  next_step       TEXT NOT NULL DEFAULT '',
  next_step_date  DATE,
  -- fornitore: categorie e zone; la qualifica arriva da Vittoria (secondo passo)
  supplier_categories TEXT[] NOT NULL DEFAULT '{}',
  supplier_subcategories TEXT[] NOT NULL DEFAULT '{}',
  supplier_zones  TEXT[] NOT NULL DEFAULT '{}',   -- sigle delle province servite
  soa             JSONB NOT NULL DEFAULT '[]',    -- [{ cat: 'OG1', cls: 'III', expires: 'YYYY-MM-DD' }] per subappaltatori e partner
  -- codici di altri sistemi
  boss_code       TEXT NOT NULL DEFAULT '',
  accounting_code TEXT NOT NULL DEFAULT '',   -- Target
  zoho_id         TEXT NOT NULL DEFAULT '',
  vittoria_id     TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  merged_into     INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL, -- doppione unito: rimanda alla scheda buona
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_subjects_vat ON crm_subjects (vat) WHERE vat <> '' AND merged_into IS NULL;
CREATE UNIQUE INDEX crm_subjects_tax ON crm_subjects (tax_code) WHERE tax_code <> '' AND merged_into IS NULL;
CREATE INDEX crm_subjects_roles ON crm_subjects USING gin (roles);
CREATE INDEX crm_subjects_asa ON crm_subjects USING gin (asa);
CREATE INDEX crm_subjects_name ON crm_subjects (lower(name));

-- Persone esterne (i colleghi Almacis stanno in Persone, da Microsoft).
CREATE TABLE crm_contacts (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',   -- Ing., Arch., Geom., Dott.
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 120),
  email         TEXT NOT NULL DEFAULT '',
  mobile        TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  linkedin      TEXT NOT NULL DEFAULT '',
  language      TEXT NOT NULL DEFAULT '',
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'non_raggiungibile')),
  legal_basis   TEXT NOT NULL DEFAULT 'legittimo_interesse' CHECK (legal_basis IN ('contratto', 'legittimo_interesse', 'consenso')),
  newsletter    BOOLEAN NOT NULL DEFAULT false,  -- consenso alle comunicazioni
  notes         TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_contacts_name ON crm_contacts (lower(last_name), lower(first_name));
CREATE INDEX crm_contacts_email ON crm_contacts (lower(email)) WHERE email <> '';

-- Dove lavora un contatto: più soggetti, con la qualifica e le date (chi cambia azienda non perde la storia).
CREATE TABLE crm_contact_links (
  id          SERIAL PRIMARY KEY,
  contact_id  INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  job         TEXT NOT NULL DEFAULT '',    -- direttore tecnico, ufficio acquisti, RUP…
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  date_from   DATE,
  date_to     DATE,
  UNIQUE (contact_id, subject_id)
);
CREATE INDEX crm_contact_links_subject ON crm_contact_links (subject_id);

-- Storico dei cambi di stato del lead (anche Lead → Cliente).
CREATE TABLE crm_stage_history (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_stage_history_subject ON crm_stage_history (subject_id, at);
