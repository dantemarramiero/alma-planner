-- Alma Strategy: la scheda personale si modifica e va al responsabile, che accetta o rifiuta modifica per modifica;
-- revisione trimestrale degli obiettivi con il responsabile; notifiche nell'app con testo e link già pronti.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy'));

-- changes: [{ field, index?, before, after, decision: null|'ok'|'no', reason }]
CREATE TABLE pm_change_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      INTEGER REFERENCES pm_roles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'withdrawn')),
  changes      JSONB NOT NULL DEFAULT '[]',
  approver_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ
);
CREATE INDEX pm_change_requests_user ON pm_change_requests(user_id, status);

-- values: { <id obiettivo>: { value, achievement } }
CREATE TABLE pm_quarter_reviews (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,
  quarter    INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
  "values"   JSONB NOT NULL DEFAULT '{}',
  note       TEXT NOT NULL DEFAULT '',
  actions    TEXT NOT NULL DEFAULT '',
  closed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at  TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year, quarter)
);
