-- @menzioni nelle note: chi viene taggato in una nota riceve una notifica nell'app (tipo 'note_mention'),
-- che porta alla nota (nel tab Note del progetto o nella scheda del ticket).

ALTER TABLE notifications ADD COLUMN note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention'));
