-- Riepilogo del mattino (email dalla propria casella a sé stessi) e solleciti nell'app.

-- Preferenze: acceso per tutti, alle 8:00 (minuti dalla mezzanotte, ora italiana); ognuno lo cambia dal profilo.
ALTER TABLE users ADD COLUMN digest_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN digest_minute SMALLINT NOT NULL DEFAULT 480 CHECK (digest_minute BETWEEN 360 AND 720);

-- Quando una persona è stata assegnata a un ticket (per «assegnati a te da ieri»).
-- Per le assegnazioni già esistenti vale la data del ticket, così il primo riepilogo non le conta tutte come nuove.
ALTER TABLE ticket_assignees ADD COLUMN assigned_at TIMESTAMPTZ;
UPDATE ticket_assignees a SET assigned_at = t.created_at FROM tickets t WHERE t.id = a.ticket_id;
ALTER TABLE ticket_assignees ALTER COLUMN assigned_at SET DEFAULT now();
ALTER TABLE ticket_assignees ALTER COLUMN assigned_at SET NOT NULL;

-- Registro degli invii: uno per persona e giorno. La riga si scrive PRIMA di mandare (prenotazione),
-- così né due istanze né un riavvio possono mandarlo due volte.
CREATE TABLE digest_log (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  status    TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'empty', 'failed', 'no_token')),
  items     INTEGER,
  error     TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- Solleciti nell'app: uno solo per ticket, persona, tipo e scadenza (se la scadenza cambia, si sollecita di nuovo).
CREATE TABLE reminder_log (
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  due_date   DATE NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id, kind, due_date)
);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project'));
