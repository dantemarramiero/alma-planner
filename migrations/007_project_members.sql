-- Membri dei progetti: un progetto lo vedono solo il responsabile (owner), i membri e gli amministratori.
-- I ticket del progetto seguono il progetto (più chi ne è assegnatario); i ticket senza progetto restano di tutti.

CREATE TABLE project_members (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members(user_id);

-- Nei progetti che esistono già nessuno perde l'accesso: diventano membri gli assegnatari e gli autori dei loro ticket.
INSERT INTO project_members (project_id, user_id)
SELECT DISTINCT t.project_id, a.user_id FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id
 WHERE t.project_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO project_members (project_id, user_id)
SELECT DISTINCT t.project_id, t.created_by FROM tickets t
 WHERE t.project_id IS NOT NULL AND t.created_by IS NOT NULL
ON CONFLICT DO NOTHING;
