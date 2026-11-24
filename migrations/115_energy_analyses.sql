-- Alma Energy · Analisi economico-finanziarie (ALM2-74 tappa 2, tavole «Analisi» e «Scheda analisi» approvate da Dante
-- il 24/11/2026). Un'analisi nasce libera; si allega a un'opportunità o a un progetto selezionato e una per progetto è
-- «di riferimento» (i suoi numeri vanno in testa all'iter e sulle schede). Ha versioni (v1 preliminare, v2 dopo la DD…):
-- ognuna è uno scenario del simulatore (i numeri si leggono dallo scenario) o un file esterno con i numeri scritti a mano.
CREATE TABLE IF NOT EXISTS energy_analyses (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  project_type       TEXT NOT NULL CHECK (project_type IN ('fv_nuovo', 'acquisizione', 'revamping', 'ppa_onsite')),
  opportunity_id     INTEGER REFERENCES energy_opportunities(id) ON DELETE SET NULL,
  reference          BOOLEAN NOT NULL DEFAULT false,
  from_scenario_id   INTEGER,                              -- scenario da cui è nata nella migrazione
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS energy_analyses_reference ON energy_analyses (opportunity_id) WHERE reference;
CREATE INDEX IF NOT EXISTS energy_analyses_opp ON energy_analyses (opportunity_id);

CREATE TABLE IF NOT EXISTS energy_analysis_versions (
  id            SERIAL PRIMARY KEY,
  analysis_id   INTEGER NOT NULL REFERENCES energy_analyses(id) ON DELETE CASCADE,
  n             INTEGER NOT NULL,
  label         TEXT NOT NULL DEFAULT '',                 -- «preliminare», «dopo la DD»…
  note          TEXT NOT NULL DEFAULT '',                 -- cosa è cambiato rispetto alla versione prima
  source        TEXT NOT NULL CHECK (source IN ('simulatore', 'file')),
  scenario_id   INTEGER REFERENCES energy_scenarios(id) ON DELETE SET NULL,
  file_name     TEXT,
  content_type  TEXT,
  file_size     INTEGER,
  file_data     BYTEA,
  kpi           JSONB NOT NULL DEFAULT '{}',              -- solo per i file: irr, irrProject, npv, payback, dscrMin, capex, mw
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, n)
);

-- Gli scenari salvati finora diventano analisi con una versione; lo scenario scelto è l'analisi di riferimento.
INSERT INTO energy_analyses (title, project_type, opportunity_id, reference, from_scenario_id, created_by, created_at, updated_at)
SELECT s.name,
       COALESCE(o.project_type, CASE s.model WHEN 'revamping' THEN 'revamping' WHEN 'ppa_onsite' THEN 'ppa_onsite' ELSE 'fv_nuovo' END),
       s.opportunity_id, s.chosen AND s.opportunity_id IS NOT NULL, s.id, s.created_by, s.created_at, s.updated_at
  FROM energy_scenarios s LEFT JOIN energy_opportunities o ON o.id = s.opportunity_id
 WHERE NOT EXISTS (SELECT 1 FROM energy_analyses a WHERE a.from_scenario_id = s.id)
 ORDER BY s.id;
INSERT INTO energy_analysis_versions (analysis_id, n, label, source, scenario_id, created_by, created_at)
SELECT a.id, 1, '', 'simulatore', a.from_scenario_id, a.created_by, a.created_at
  FROM energy_analyses a
 WHERE a.from_scenario_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM energy_analysis_versions x WHERE x.analysis_id = a.id);
