-- ALM2-85: via i ticket nati da soli (contromisure degli A3, passi di Nuovi business, piano del lancio dal CRM,
-- fasi dell'iter e vecchi «Step N» di Alma Energy). Le contromisure, i passi e le fasi restano nelle loro pagine:
-- prima si stacca il collegamento (crm_initiative_tasks.ticket_id è ON DELETE CASCADE), poi si cancella il ticket.
-- Restano RDA, segnalazioni dei mezzi e ogni ticket creato a mano o con un clic.
CREATE TEMP TABLE auto_tickets ON COMMIT DROP AS
SELECT t.id FROM tickets t
 WHERE t.rda_state IS NULL AND t.vehicle_id IS NULL AND (
       t.id IN (SELECT ticket_id FROM hk_tasks WHERE ticket_id IS NOT NULL)
    OR t.id IN (SELECT ticket_id FROM crm_initiative_tasks WHERE ticket_id IS NOT NULL)
    OR t.id IN (SELECT ticket_id FROM energy_iter_phases WHERE ticket_id IS NOT NULL)
    OR t.crm_phase IS NOT NULL
    OR (t.title ~ '^Step [0-9]+ · ' AND t.project_id IN (SELECT id FROM projects WHERE energy)));

UPDATE hk_tasks SET ticket_id = NULL WHERE ticket_id IN (SELECT id FROM auto_tickets);
UPDATE crm_initiative_tasks SET ticket_id = NULL WHERE ticket_id IN (SELECT id FROM auto_tickets);
UPDATE energy_iter_phases SET ticket_id = NULL WHERE ticket_id IN (SELECT id FROM auto_tickets);
DELETE FROM tickets WHERE id IN (SELECT id FROM auto_tickets);
