-- Mezzi: i campi che arrivano da Zoho CRM (modulo «Mezzi») e servono anche qui, più il riferimento al record di Zoho
-- per poter reimportare l'esportazione e aggiornare i mezzi senza doppioni.

ALTER TABLE vehicles ADD COLUMN external_ref TEXT;                -- id del record in Zoho (zcrm_…)
CREATE UNIQUE INDEX vehicles_external_ref_uq ON vehicles (external_ref) WHERE external_ref IS NOT NULL;
ALTER TABLE vehicles ADD COLUMN env_class TEXT NOT NULL DEFAULT '';            -- classe ambientale (EURO 6D…)
ALTER TABLE vehicles ADD COLUMN purchase_value NUMERIC(12, 2) CHECK (purchase_value IS NULL OR purchase_value >= 0);
ALTER TABLE vehicles ADD COLUMN depreciation_rate NUMERIC(5, 2) CHECK (depreciation_rate IS NULL OR depreciation_rate BETWEEN 0 AND 100); -- % all'anno
ALTER TABLE vehicles ADD COLUMN hourly_cost NUMERIC(10, 4) CHECK (hourly_cost IS NULL OR hourly_cost >= 0);              -- € all'ora (da Zoho)
-- costi annui indicativi (revisione, carburanti, assicurazione, bollo), come in Zoho; i costi veri con la data restano in vehicle_costs
ALTER TABLE vehicles ADD COLUMN annual_costs JSONB NOT NULL DEFAULT '{}';
ALTER TABLE vehicles ADD COLUMN commessa TEXT NOT NULL DEFAULT '';            -- commessa a cui è assegnato (testo, da Zoho)

-- Allegati delle manutenzioni: bolle, fatture, foto del lavoro (PDF o immagini), nel database come le foto.
CREATE TABLE vehicle_maintenance_files (
  id              SERIAL PRIMARY KEY,
  maintenance_id  INTEGER NOT NULL REFERENCES vehicle_maintenance(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  data            BYTEA NOT NULL,
  uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_maintenance_files_m ON vehicle_maintenance_files (maintenance_id);
