-- Promemoria sui ticket: chi vede il ticket manda a chi ci lavora (assegnati, chi l'ha creato) un testo scritto da
-- lui; arriva nelle notifiche di Alma Planet e per email dalla sua casella Outlook. Ne resta lo storico nel ticket.
CREATE TABLE ticket_reminders (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message     TEXT NOT NULL,
  to_user_ids INTEGER[] NOT NULL,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_reminders_ticket ON ticket_reminders (ticket_id, created_at DESC);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder'));
