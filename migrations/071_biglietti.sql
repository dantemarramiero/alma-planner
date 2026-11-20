-- Biglietti da visita (ALM2-47): «Il mio biglietto» digitale con QR e i contatti che lascia chi lo inquadra.

-- Un biglietto per persona. Il link pubblico usa un codice casuale (token), non il nome: «Rigenera» lo cambia
-- e il vecchio QR smette di funzionare. Nome, email, ruolo e foto arrivano dal profilo; qui solo il resto.
CREATE TABLE business_cards (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{8,40}$'),
  role           TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 120),      -- vuoto = il ruolo del profilo
  mobile         TEXT NOT NULL DEFAULT '' CHECK (length(mobile) <= 40),
  phone          TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  linkedin       TEXT NOT NULL DEFAULT '' CHECK (length(linkedin) <= 200),
  address        TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 200),
  show_mobile    BOOLEAN NOT NULL DEFAULT true,
  show_phone     BOOLEAN NOT NULL DEFAULT true,
  show_linkedin  BOOLEAN NOT NULL DEFAULT true,
  show_address   BOOLEAN NOT NULL DEFAULT false,
  accept_leads   BOOLEAN NOT NULL DEFAULT true,                              -- «Lasciami i tuoi contatti»
  scans          INTEGER NOT NULL DEFAULT 0,                                  -- aperture della pagina
  saves          INTEGER NOT NULL DEFAULT 0,                                  -- «Salva nella rubrica»
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chi ha inquadrato il QR e ha lasciato i suoi dati. Diventa contatto del CRM solo con «Conferma» del proprietario.
CREATE TABLE business_card_leads (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 120),
  last_name    TEXT NOT NULL DEFAULT '' CHECK (length(last_name) <= 120),
  email        TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 200),
  company      TEXT NOT NULL DEFAULT '' CHECK (length(company) <= 200),
  mobile       TEXT NOT NULL DEFAULT '' CHECK (length(mobile) <= 40),
  job          TEXT NOT NULL DEFAULT '' CHECK (length(job) <= 120),
  message      TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 1000),
  consent_at   TIMESTAMPTZ NOT NULL,                                        -- consenso privacy, con data e ora
  status       TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'confermato', 'saltato')),
  contact_id   INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  undo         JSONB,                                                       -- per «Annulla» nei 10 minuti dopo la conferma
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX business_card_leads_user ON business_card_leads (user_id, status, created_at DESC);
