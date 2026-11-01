-- Alma Energy: promemoria delle scadenze delle opportunità (FV classico: opzione sul terreno, STMG, integrazioni,
-- validità del titolo…). Notifiche nell'app con testo e link già pronti, come quelle del parco mezzi.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy'));

-- Un promemoria si manda una volta sola per scadenza e soglia (30, 7, 1, 0 giorni, scaduta).
CREATE TABLE energy_reminder_log (
  key   TEXT PRIMARY KEY,
  at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
