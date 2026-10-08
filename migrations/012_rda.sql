-- RDA interna: richiesta di lavoro a un'altra funzione aziendale (reparto dell'organigramma Microsoft).
-- Una RDA è un ticket con in più la funzione a cui è chiesta, lo stato della richiesta e le ore:
--   stimate da chi chiede → confermate (o cambiate) dal responsabile della funzione quando accetta → effettive a ticket fatto.
-- Finché è da accettare o se è rifiutata non conta come lavoro: non compare tra i ticket, nel Gantt, nel calendario
-- e nell'avanzamento del progetto. Accettata, è un ticket come gli altri.

ALTER TABLE tickets ADD COLUMN rda_function TEXT;                -- reparto a cui è chiesta (NULL = ticket normale)
ALTER TABLE tickets ADD COLUMN rda_state TEXT CHECK (rda_state IN ('pending', 'accepted', 'rejected'));
ALTER TABLE tickets ADD COLUMN rda_head_oid TEXT;                -- responsabile della funzione quando è stata chiesta
ALTER TABLE tickets ADD COLUMN hours_estimated NUMERIC(6,2) CHECK (hours_estimated > 0);
ALTER TABLE tickets ADD COLUMN hours_approved NUMERIC(6,2) CHECK (hours_approved > 0);
ALTER TABLE tickets ADD COLUMN hours_actual NUMERIC(6,2) CHECK (hours_actual >= 0);
ALTER TABLE tickets ADD COLUMN rda_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN rda_decided_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN rda_reject_reason TEXT;
ALTER TABLE tickets ADD CONSTRAINT tickets_rda_check CHECK ((rda_function IS NULL) = (rda_state IS NULL));
CREATE INDEX tickets_rda_idx ON tickets(rda_state, rda_function) WHERE rda_function IS NOT NULL;

-- Responsabile di una funzione scelto a mano da un amministratore, quando quello ricavato dall'organigramma non è giusto.
CREATE TABLE function_heads (
  department  TEXT PRIMARY KEY,
  head_oid    TEXT NOT NULL,
  set_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifiche delle RDA: nuova richiesta (al responsabile), accettata (con le ore), rifiutata (a chi l'ha chiesta).
ALTER TABLE notifications ADD COLUMN ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected'));
