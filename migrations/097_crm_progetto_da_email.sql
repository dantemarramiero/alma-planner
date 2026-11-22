-- Progetto commerciale da una email (ALM2-55, canvas «Progetto da email» approvato da Dante il 22/11/2026).
-- Dall'email Alma legge la conversazione, propone concetto, azienda, persone e legami nel CRM; il progetto nasce
-- dalla sala di lancio come gli altri «Porta avanti». Le risposte nuove della stessa conversazione entrano da sole,
-- le altre email delle persone collegate che parlano del progetto restano suggerite.

-- D1: terzo tipo di progetto commerciale, la trattativa privata (Seguo · Primo incontro · Sopralluogo e richiesta · Offerta · Esito)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_crm_kind_check;
ALTER TABLE projects ADD CONSTRAINT projects_crm_kind_check CHECK (crm_kind IN ('', 'gara', 'settore', 'trattativa'));
-- stato della trattativa calcolato da Alma: { summary, next_move, commitments[], stakeholders[], client, updated_at, … }
ALTER TABLE projects ADD COLUMN crm_deal JSONB NOT NULL DEFAULT '{}';

-- il concetto letto nell'email: { cosa, dove, per_chi, importo_testo, tempi, prossimo_passo, tipo, temi[], committente }
ALTER TABLE crm_signals ADD COLUMN concept JSONB NOT NULL DEFAULT '{}';

-- la conversazione di Outlook da cui nasce l'opportunità (e poi il progetto). D3: si legge solo la casella di chi la
-- collega; un collega in squadra può collegare la stessa conversazione dalla sua (riga sua, stessa conversation_id).
CREATE TABLE crm_mail_threads (
  id               SERIAL PRIMARY KEY,
  signal_id        INTEGER REFERENCES crm_signals(id) ON DELETE CASCADE,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- di chi è la casella che si legge
  conversation_id  TEXT NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  colleague_ids    INTEGER[] NOT NULL DEFAULT '{}',                       -- colleghi in copia: entrano in squadra
  themes           TEXT[] NOT NULL DEFAULT '{}',                          -- parole del tema, per suggerire altre email
  checked_at       TIMESTAMPTZ,                                            -- ultimo controllo delle email nuove
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (signal_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE UNIQUE INDEX crm_mail_threads_owner ON crm_mail_threads (owner_id, conversation_id);
CREATE INDEX crm_mail_threads_project ON crm_mail_threads (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX crm_mail_threads_signal ON crm_mail_threads (signal_id) WHERE signal_id IS NOT NULL;

-- D2: email di altre conversazioni con le persone collegate che parlano del progetto: «Aggiungi» o «Non c'entra»
CREATE TABLE crm_mail_suggestions (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  internet_message_id  TEXT NOT NULL,
  outlook_id           TEXT NOT NULL,
  subject              TEXT NOT NULL DEFAULT '',
  from_name            TEXT NOT NULL DEFAULT '',
  from_address         TEXT NOT NULL DEFAULT '',
  sent_at              TIMESTAMPTZ,
  preview              TEXT NOT NULL DEFAULT '',
  why                  TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'nuova' CHECK (status IN ('nuova', 'aggiunta', 'scartata')),
  decided_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, internet_message_id)
);

-- spesa dell'AI per la lettura delle email (Impostazioni → Costi AI, voce CRM)
CREATE TABLE crm_mail_spend (
  month  TEXT PRIMARY KEY,           -- AAAA-MM
  eur    NUMERIC NOT NULL DEFAULT 0
);

-- email entrate da sole nel progetto (risposte nuove della conversazione collegata), per «entrata da sola»
ALTER TABLE project_emails ADD COLUMN auto_added BOOLEAN NOT NULL DEFAULT false;
