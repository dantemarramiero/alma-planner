-- Alma IT: ticket IT. Chiunque segnala un problema al team IT da «I miei strumenti»; Alma propone priorità e
-- tipo. Il team IT lo prende in carico e lo chiude qui, oppure lo manda a Linear (team IT): lo stato dell'issue
-- torna qui da solo e chi ha segnalato riceve una notifica.
CREATE TABLE it_tickets (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_name       TEXT NOT NULL,
  person_email      TEXT NOT NULL DEFAULT '',
  department        TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',            -- Rete, Stampanti, Account e accessi…: proposto da Alma, si cambia
  priority          TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('bassa', 'media', 'alta', 'urgente')),
  status            TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'in_corso', 'linear', 'chiuso', 'annullato')),
  answer            TEXT NOT NULL DEFAULT '',
  handled_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  linear_id         TEXT,                                -- issue su Linear (quando è stato mandato)
  linear_identifier TEXT,                                -- IT-41
  linear_url        TEXT,
  linear_state      TEXT,                                -- nome dello stato su Linear
  linear_state_type TEXT,                                -- backlog, unstarted, started, completed, canceled
  linear_assignee   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ
);
CREATE INDEX it_tickets_status ON it_tickets (status);
CREATE INDEX it_tickets_user ON it_tickets (user_id);
