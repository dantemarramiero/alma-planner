-- App sul telefono e notifiche (proposta approvata da Dante l'11/11/2026).
-- Tre avvisi: nuovo post in bacheca, ticket assegnato a me, aggiornamento su un mio A3. Ognuno sceglie dove riceverli:
-- campanella (in Alma), telefono (notifica push dell'app aggiunta alla schermata Home) ed email.
-- Senza una riga qui valgono i valori di partenza (tutto acceso, tranne l'email dei nuovi post).
CREATE TABLE notification_prefs (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('new_post', 'ticket_assigned', 'a3_update')),
  bell     BOOLEAN NOT NULL DEFAULT true,
  push     BOOLEAN NOT NULL DEFAULT true,
  email    BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, kind)
);

-- un telefono (o computer) che riceve le notifiche push
CREATE TABLE push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  keys        JSONB NOT NULL,
  device      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at  TIMESTAMPTZ
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy', 'it',
                  'new_post', 'ticket_assigned', 'a3_update'));
