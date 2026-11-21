-- «Persone con cui mi scrivo» (ALM2-46, canvas CRM v10 · V10-Scrivo): chi mi scrive o a cui scrivo, dalla mia casella
-- Outlook (ricevute e inviate, ultimi 12 mesi). Ognuno vede solo la sua posta. Nulla si crea da solo: da qui si crea
-- il contatto (e l'azienda) oppure si ignora; le ignorate non tornano.
CREATE TABLE IF NOT EXISTS crm_mail_people (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,                 -- sempre minuscolo
  name             TEXT NOT NULL DEFAULT '',      -- nome visto nell'intestazione
  received         INTEGER NOT NULL DEFAULT 0,
  sent             INTEGER NOT NULL DEFAULT 0,
  replied          BOOLEAN NOT NULL DEFAULT false, -- ci siamo scritti in tutte e due le direzioni
  last_at          TIMESTAMPTZ,
  ignored_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, email)
);
CREATE INDEX IF NOT EXISTS crm_mail_people_user ON crm_mail_people (user_id, last_at DESC);

CREATE TABLE IF NOT EXISTS crm_mail_scans (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scanned_at  TIMESTAMPTZ,
  messages    INTEGER NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT ''
);
