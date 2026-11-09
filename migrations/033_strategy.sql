-- Alma Strategy: Hoshin Kanri (X-Matrix e A3). Tutto per anno: True North, pillar, BU e funzioni, aree, KPI di
-- livello 0, progetti (ognuno è un A3) e le loro contromisure, da cui si calcola l'avanzamento.

CREATE TABLE hk_years (
  year        INTEGER PRIMARY KEY,
  true_north  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE hk_pillars (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL REFERENCES hk_years(year) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#BEBEBC'
);

-- BU e funzioni di staff: hanno lo sponsor e il colore della famiglia di fasce nella X-Matrix.
CREATE TABLE hk_functions (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL REFERENCES hk_years(year) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'bu')),
  name        TEXT NOT NULL DEFAULT '',
  sponsor     TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#8A8A8A'
);

-- Aree: le colonne a L della X-Matrix, nell'ordine di position.
CREATE TABLE hk_areas (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL REFERENCES hk_years(year) ON DELETE CASCADE,
  function_id INTEGER NOT NULL REFERENCES hk_functions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL DEFAULT '',
  sponsor     TEXT NOT NULL DEFAULT ''
);

-- KPI di livello 0: lettera, pillar, owner, target e i 12 valori mensili scritti a mano.
CREATE TABLE hk_kpis (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL REFERENCES hk_years(year) ON DELETE CASCADE,
  pillar_id   INTEGER REFERENCES hk_pillars(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  letter      TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  owner       TEXT NOT NULL DEFAULT '',
  target      TEXT NOT NULL DEFAULT '',
  monthly     JSONB NOT NULL DEFAULT '[]'
);

-- Progetti Hoshin = A3, con i campi del format Almacis.
CREATE TABLE hk_projects (
  id                 SERIAL PRIMARY KEY,
  year               INTEGER NOT NULL REFERENCES hk_years(year) ON DELETE CASCADE,
  area_id            INTEGER REFERENCES hk_areas(id) ON DELETE SET NULL,
  position           INTEGER NOT NULL DEFAULT 0,
  name               TEXT NOT NULL DEFAULT '',
  owner              TEXT NOT NULL DEFAULT '',
  team               TEXT NOT NULL DEFAULT '',
  target             TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'attivo',
  start_year         INTEGER,
  tags               TEXT NOT NULL DEFAULT '',
  kpi_ids            JSONB NOT NULL DEFAULT '[]',
  background         TEXT NOT NULL DEFAULT '',
  current_conditions TEXT NOT NULL DEFAULT '',
  target_conditions  TEXT NOT NULL DEFAULT '',
  effect             TEXT NOT NULL DEFAULT '',
  causes             JSONB NOT NULL DEFAULT '{}',
  follow_up_quality  TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contromisure dell'A3: peso sul 100%, scadenza e chiusura reale. Avanzamento = pesi chiusi.
CREATE TABLE hk_tasks (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES hk_projects(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  area        TEXT NOT NULL DEFAULT '',
  activity    TEXT NOT NULL DEFAULT '',
  weight      INTEGER NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  owner       TEXT NOT NULL DEFAULT '',
  due_date    DATE,
  closed_date DATE
);

CREATE INDEX hk_tasks_project ON hk_tasks(project_id, position);
CREATE INDEX hk_projects_year ON hk_projects(year, position);
