-- Alma HR, completamento Fase 1 (tavola G «Mappatura e anomalie», 21/11/2026): piano di rientro di chi è sotto il
-- minimo di fascia, persona per persona (anno, tutto o metà), così il costo si divide per anno e va nel budget.
CREATE TABLE hr_rientro (
  person_key  TEXT PRIMARY KEY REFERENCES hr_people(key) ON DELETE CASCADE,
  anno        INTEGER NOT NULL CHECK (anno BETWEEN 2026 AND 2035),
  quota       TEXT NOT NULL DEFAULT 'tutto' CHECK (quota IN ('tutto', 'meta')),  -- 'meta' = metà quest'anno, metà l'anno dopo
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
