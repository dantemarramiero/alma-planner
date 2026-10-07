-- Ogni attività del Gantt è un ticket del progetto: «Fatto» sul ticket = attività completata.
-- Le attività create a mano con la 002 diventano ticket (stesse date, responsabili e file).

ALTER TABLE ticket_files ADD COLUMN size BIGINT;
ALTER TABLE tickets ADD COLUMN legacy_activity_id INTEGER;

INSERT INTO tickets (project_id, title, description, status, start_date, due_date, progress, position, created_by, created_at, updated_at, legacy_activity_id)
SELECT a.project_id, a.title, a.description,
       CASE WHEN a.progress >= 100 THEN 'done' ELSE 'todo' END,
       a.start_date, a.end_date, a.progress,
       (SELECT COALESCE(MAX(position), 0) FROM tickets) + a.id,
       a.created_by, a.created_at, a.updated_at, a.id
  FROM activities a;

INSERT INTO ticket_assignees (ticket_id, user_id)
SELECT t.id, x.user_id FROM activity_assignees x JOIN tickets t ON t.legacy_activity_id = x.activity_id;

INSERT INTO ticket_files (ticket_id, drive_id, item_id, name, web_url, size, added_by, created_at)
SELECT t.id, f.drive_id, f.item_id, f.name, f.web_url, f.size, f.added_by, f.created_at
  FROM project_files f JOIN tickets t ON t.legacy_activity_id = f.activity_id
ON CONFLICT (ticket_id, drive_id, item_id) DO NOTHING;

DELETE FROM project_files WHERE activity_id IS NOT NULL;
DROP INDEX project_files_unique_idx;
ALTER TABLE project_files DROP COLUMN activity_id;
CREATE UNIQUE INDEX project_files_unique_idx ON project_files(project_id, drive_id, item_id);

DROP TABLE activity_assignees;
DROP TABLE activities;
ALTER TABLE tickets DROP COLUMN legacy_activity_id;
