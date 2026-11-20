-- Nuovi business (20/11/2026): i quattro avvisi delle iniziative si scelgono in Profilo → Notifiche come gli altri
-- (campanella, telefono, email). Si allarga l'elenco dei tipi ammessi nelle preferenze.
ALTER TABLE notification_prefs DROP CONSTRAINT IF EXISTS notification_prefs_kind_check;
ALTER TABLE notification_prefs ADD CONSTRAINT notification_prefs_kind_check
  CHECK (kind IN ('new_post', 'ticket_assigned', 'a3_update', 'nb_gate_due', 'nb_gate_late', 'nb_quiet', 'nb_task_late'));
