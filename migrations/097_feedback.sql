-- Feedback su Alma Space (ALM2-56; numero 097: 095 e 096 sono già usate da altri branch): problemi tecnici e suggerimenti sulla procedura mandati da chiunque usi Alma.
-- Ogni feedback diventa un'issue nel team Linear dei feedback (LINEAR_FEEDBACK_TEAM); l'esito torna da Linear
-- (Da valutare, Approvato, Risolto, Non accolto con il motivo, Doppione) e chi l'ha scritto riceve una notifica.
-- Se Linear non risponde il feedback resta qui (linear_* vuoti) e si rimanda al giro successivo.

CREATE TABLE feedback (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('tecnico', 'procedura')),
  body               TEXT NOT NULL,
  page               TEXT NOT NULL DEFAULT '',
  user_agent         TEXT NOT NULL DEFAULT '',
  linear_id          TEXT,
  linear_identifier  TEXT,
  linear_url         TEXT,
  outcome            TEXT NOT NULL DEFAULT 'da_valutare' CHECK (outcome IN ('da_valutare', 'approvato', 'risolto', 'non_accolto', 'doppione')),
  outcome_reason     TEXT,
  notified_outcome   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user_idx ON feedback (user_id, created_at DESC);
CREATE INDEX feedback_open_idx ON feedback (outcome) WHERE outcome IN ('da_valutare', 'approvato');

-- foto dello schermo (al massimo 3 per feedback): restano qui finché non sono caricate su Linear, poi si cancellano
CREATE TABLE feedback_images (
  id           SERIAL PRIMARY KEY,
  feedback_id  INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_images_fb_idx ON feedback_images (feedback_id);

-- notifica dell'esito a chi ha scritto il feedback
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy', 'it',
                  'new_post', 'ticket_assigned', 'a3_update', 'crm', 'hr', 'feedback'));
