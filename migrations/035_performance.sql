-- Alma Strategy: performance management. Mansionario generale (ruoli con le 5 responsabilità, confermati dall'admin),
-- profilo di ognuno (ruolo, responsabile, team), valutazione annuale (hard e soft skills, autovalutazione e responsabile)
-- e obiettivi individuali (KPI di livello 1, con peso; la fonte «Hoshin Kanri» legge l'avanzamento dei progetti).

-- Mansionario: la versione in vigore e, se c'è, la proposta in attesa di conferma.
CREATE TABLE pm_roles (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT '',
  area             TEXT NOT NULL DEFAULT '',
  reports_to       TEXT NOT NULL DEFAULT '',
  interfaces       JSONB NOT NULL DEFAULT '[]',
  coordinates      INTEGER NOT NULL DEFAULT 0,
  description      TEXT NOT NULL DEFAULT '',
  responsibilities JSONB NOT NULL DEFAULT '[]',
  hard_skills      JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('missing', 'review', 'confirmed')),
  proposal         JSONB,
  proposed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  proposed_at      TIMESTAMPTZ,
  confirmed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pm_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id     INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,
  manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team        TEXT NOT NULL DEFAULT ''
);

-- Valutazione dell'anno: { skill: 1..5 } per l'autovalutazione e per il responsabile.
CREATE TABLE pm_reviews (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'self' CHECK (status IN ('self', 'manager', 'closed')),
  self_scores    JSONB NOT NULL DEFAULT '{}',
  manager_scores JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);

CREATE TABLE pm_objectives (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  responsibility TEXT NOT NULL DEFAULT '',
  pillar         TEXT NOT NULL DEFAULT '',
  objective      TEXT NOT NULL DEFAULT '',
  kpi            TEXT NOT NULL DEFAULT '',
  formula        TEXT NOT NULL DEFAULT '',
  unit           TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT '',
  frequency      TEXT NOT NULL DEFAULT '',
  target         TEXT NOT NULL DEFAULT '',
  weight         INTEGER NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  notes          TEXT NOT NULL DEFAULT '',
  obstacles      TEXT NOT NULL DEFAULT '',
  hk_kpi_id      INTEGER REFERENCES hk_kpis(id) ON DELETE SET NULL,
  last_value     TEXT NOT NULL DEFAULT '',
  achievement    INTEGER CHECK (achievement BETWEEN 0 AND 100),
  approved       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX pm_objectives_user ON pm_objectives(user_id, year, position);
