-- ALM2-78 (canvas «Assegnare le opportunità», approvato da Dante il 24/11/2026)
-- Dalla email alla pipeline di Alma Energy: la conversazione resta collegata all'opportunità.

-- Conversazione collegata: si legge solo la casella di chi l'ha collegata (come crm_mail_threads).
CREATE TABLE IF NOT EXISTS energy_mail_threads (
  id               SERIAL PRIMARY KEY,
  opportunity_id   INTEGER NOT NULL REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  new_mode         TEXT NOT NULL DEFAULT 'approva' CHECK (new_mode IN ('approva', 'auto')),
  checked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS energy_mail_threads_owner ON energy_mail_threads (owner_id, conversation_id);
CREATE INDEX IF NOT EXISTS energy_mail_threads_opp ON energy_mail_threads (opportunity_id);

-- Email dell'opportunità: «in» (dentro), «da_approvare» (risposta nuova, la vede solo chi ha collegato la
-- conversazione), «scartata» (non torna più).
CREATE TABLE IF NOT EXISTS energy_opportunity_emails (
  id                   SERIAL PRIMARY KEY,
  opportunity_id       INTEGER NOT NULL REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  owner_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  internet_message_id  TEXT NOT NULL,
  outlook_id           TEXT NOT NULL DEFAULT '',
  subject              TEXT NOT NULL DEFAULT '',
  from_name            TEXT NOT NULL DEFAULT '',
  from_address         TEXT NOT NULL DEFAULT '',
  sent_at              TIMESTAMPTZ,
  body_text            TEXT NOT NULL DEFAULT '',
  web_link             TEXT,
  status               TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in', 'da_approvare', 'scartata')),
  auto_added           BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS energy_opportunity_emails_msg ON energy_opportunity_emails (opportunity_id, internet_message_id);
