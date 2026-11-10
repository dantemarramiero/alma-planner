-- Pulizia del database (Dante, 10/11/2026): via la chat interna mai usata (i messaggi passano da Teams), una sola
-- tabella di impostazioni al posto di tre, un solo registro «già mandato» al posto di tre. 91 → 84 tabelle.

-- ── chat interna: tre tabelle vuote e la colonna che legava le foto a una chat ──────────────────────
ALTER TABLE media DROP COLUMN IF EXISTS conversation_id;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;

-- ── impostazioni: chiavi con il modulo davanti («software.», «energy.», «planet.») ───────────────────
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) SELECT 'software.' || key, to_jsonb(value) FROM software_settings;
INSERT INTO settings (key, value, updated_by, updated_at) SELECT 'energy.' || key, value, updated_by, updated_at FROM energy_settings;
INSERT INTO settings (key, value, updated_by, updated_at) SELECT 'planet.' || key, value, updated_by, updated_at FROM planet_settings;
DROP TABLE software_settings;
DROP TABLE energy_settings;
DROP TABLE planet_settings;

-- ── registro «già mandato»: solleciti dei ticket, promemoria dei mezzi e di Alma Energy ─────────────
-- (il registro del riepilogo del mattino, digest_log, resta a parte: tiene lo stato di ogni invio)
CREATE TABLE send_log (
  key TEXT PRIMARY KEY,
  at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO send_log (key, at) SELECT 'ticket:' || ticket_id || ':' || user_id || ':' || kind || ':' || due_date::text, at FROM reminder_log;
INSERT INTO send_log (key, at) SELECT 'fleet:' || key, sent_at FROM fleet_reminder_log;
INSERT INTO send_log (key, at) SELECT 'energy:' || key, at FROM energy_reminder_log;
DROP TABLE reminder_log;
DROP TABLE fleet_reminder_log;
DROP TABLE energy_reminder_log;
