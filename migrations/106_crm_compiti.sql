-- Compiti, Condividi e Persone da aggiungere nelle schede del CRM (ALM2-71, canvas CRM v18, via di Dante 23/11/2026).

-- Compiti = i «prossimi passi» (crm_steps), con le note per chi lo fa e più persone sullo stesso compito
-- («Uno per tutti»: basta che uno lo chiuda). owner_id resta la prima persona; le altre stanno qui.
ALTER TABLE crm_steps ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS crm_step_people (
  step_id  INTEGER NOT NULL REFERENCES crm_steps(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (step_id, user_id)
);
CREATE INDEX IF NOT EXISTS crm_step_people_user ON crm_step_people (user_id);

-- «Condividi»: una scheda (azienda o contatto) mandata a un collega, con il messaggio; opened_at quando la apre
CREATE TABLE IF NOT EXISTS crm_shares (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE CASCADE,
  from_user   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at   TIMESTAMPTZ,
  CHECK (num_nonnulls(subject_id, contact_id) = 1)
);
CREATE INDEX IF NOT EXISTS crm_shares_subject ON crm_shares (subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_shares_contact ON crm_shares (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_shares_to ON crm_shares (to_user, opened_at);

-- «Persone da aggiungere» trovate da Alma su sito, LinkedIn e nei bandi delle gare (ANAC dà il CIG, il nome del RUP sta
-- negli atti pubblicati). Quelle della propria posta non stanno qui: vengono da crm_mail_people di ognuno.
CREATE TABLE IF NOT EXISTS crm_people_suggestions (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('sito', 'linkedin', 'anac')),
  name        TEXT NOT NULL,
  job         TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  linkedin    TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'nuova' CHECK (status IN ('nuova', 'aggiunta', 'ignorata')),
  found_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_people_suggestions_name ON crm_people_suggestions (subject_id, lower(name));
CREATE TABLE IF NOT EXISTS crm_people_searches (
  subject_id  INTEGER PRIMARY KEY REFERENCES crm_subjects(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  found       INTEGER NOT NULL DEFAULT 0,
  cost_eur    NUMERIC NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT ''
);
