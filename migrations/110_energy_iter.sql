-- Alma Energy · Progetti selezionati (ALM2-74, canvas approvato da Dante il 24/11/2026).
-- Pipeline a tre colonne (valutazione, avviato = DD tecnica partita, scartato) e iter a fasi per progetto, partito dal
-- modello del tipo (energy_iter_templates, vuota = modelli scritti in lib/energy-iter.js) e modificabile.
ALTER TABLE energy_opportunities ADD COLUMN IF NOT EXISTS project_type TEXT CHECK (project_type IN ('fv_nuovo', 'acquisizione', 'revamping', 'ppa_onsite'));
ALTER TABLE energy_opportunities ADD COLUMN IF NOT EXISTS selection TEXT CHECK (selection IN ('valutazione', 'avviato', 'scartato'));
ALTER TABLE energy_opportunities ADD COLUMN IF NOT EXISTS selection_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE energy_opportunities ADD COLUMN IF NOT EXISTS selection_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS energy_iter_templates (
  project_type TEXT PRIMARY KEY CHECK (project_type IN ('fv_nuovo', 'acquisizione', 'revamping', 'ppa_onsite')),
  phases       JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS energy_iter_phases (
  id             SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES energy_opportunities(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  key            TEXT NOT NULL DEFAULT '',
  label          TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  days           INTEGER NOT NULL DEFAULT 10,
  owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date       DATE,
  done_at        TIMESTAMPTZ,
  added          BOOLEAN NOT NULL DEFAULT false,      -- aggiunta a mano sul progetto, fuori dal modello
  items          JSONB NOT NULL DEFAULT '[]',          -- [{ key, label, done, due_date, added }]
  ticket_id      INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS energy_iter_phases_opp ON energy_iter_phases (opportunity_id, position);

-- I target di prima: tipo dal tipo di opportunità (chi li aveva scelti comprava l'impianto), colonna dallo step
-- (contatto del venditore = ancora in valutazione) e dall'esito (perso = scartato, col motivo dello storico).
UPDATE energy_opportunities o SET
  project_type = CASE o.kind WHEN 'revamping' THEN 'revamping' WHEN 'ppa_onsite' THEN 'ppa_onsite' ELSE 'acquisizione' END,
  selection = CASE WHEN o.target_outcome = 'perso' THEN 'scartato'
                   WHEN o.target_step = 'contatto_venditore' AND o.target_outcome IS NULL THEN 'valutazione' ELSE 'avviato' END,
  selection_reason = CASE WHEN o.target_outcome = 'perso' THEN COALESCE((SELECT h.note FROM energy_stage_history h
                       WHERE h.opportunity_id = o.id AND h.to_stage = 'esito:perso' ORDER BY h.at DESC, h.id DESC LIMIT 1), '') ELSE '' END,
  selection_changed_at = COALESCE(o.target_step_changed_at, o.updated_at)
WHERE o.target_step IS NOT NULL AND o.selection IS NULL;
