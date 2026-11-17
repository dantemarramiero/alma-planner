-- Alma: email ai contatti del CRM (17/11/2026, canvas «v7 · Alma: email ai clienti dal CRM», strada A scelta da Dante).
-- Una riga per destinatario. Nasce solo dopo la conferma di chi scrive (proposta «proponi_email»); parte dalla sua
-- casella Outlook (Mail.Send) subito o all'ora programmata, una volta sola: la riga passa da «programmata» a «invio»
-- con un UPDATE condizionato prima di chiamare Microsoft. batch_id raggruppa le email di una stessa conferma.

CREATE TABLE assistant_emails (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id   INT REFERENCES assistant_actions(id) ON DELETE SET NULL,
  batch_id    INT,
  contact_id  INT REFERENCES crm_contacts(id) ON DELETE SET NULL,
  subject_id  INT REFERENCES crm_subjects(id) ON DELETE SET NULL,
  to_name     TEXT NOT NULL DEFAULT '',
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  criterio    TEXT NOT NULL DEFAULT '',
  send_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'programmata' CHECK (status IN ('programmata', 'invio', 'inviata', 'annullata', 'errore')),
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_emails_due ON assistant_emails (status, send_at);
CREATE INDEX assistant_emails_user ON assistant_emails (user_id, created_at DESC);
