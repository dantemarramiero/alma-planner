-- Impostazioni uniche (Dante, 19/11/2026; canvas «Alma Planet · Impostazioni»): ruoli legati all'organigramma di
-- Entra, utenti sospesi, privacy per ruolo con eccezioni personali, registro con prima/dopo.
-- Numero 070 e non 062: lascia spazio alle migrazioni dei branch del CRM aperti in parallelo.

-- ── utenti: primo accesso e sospensione ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN first_login TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN suspended_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE users u SET first_login = COALESCE(
  (SELECT MIN(a.created_at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login'),
  CASE WHEN u.last_login IS NOT NULL THEN u.created_at END);

-- ── ruoli di Alma Planet ────────────────────────────────────────────────────────────────────────────
-- Ogni persona ha un ruolo: quello dato a mano (role_assignments) oppure il primo ruolo, in ordine di
-- «position», la cui regola vale per lei. rule: manual (solo a mano), job_title / department (il testo è
-- contenuto nella qualifica o nel reparto di Entra), manager (responsabile di qualcuno in Entra),
-- guest (non è nell'organigramma), default (tutti gli altri).
CREATE TABLE roles (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  rule       TEXT NOT NULL CHECK (rule IN ('manual', 'job_title', 'department', 'manager', 'guest', 'default')),
  rule_value TEXT,
  position   INTEGER NOT NULL DEFAULT 100,
  system     BOOLEAN NOT NULL DEFAULT false,    -- i ruoli di sistema non si cancellano
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO roles (key, label, rule, rule_value, position, system) VALUES
  ('admin', 'Amministratore', 'manual', NULL, 0, true),
  ('direzione', 'Direzione', 'job_title', 'Direttore', 10, false),
  ('responsabile', 'Responsabile di BU', 'manager', NULL, 20, false),
  ('amministrazione', 'Amministrazione', 'department', 'Amministrazione', 30, false),
  ('ospite', 'Ospite', 'guest', NULL, 90, true),
  ('collaboratore', 'Collaboratore', 'default', NULL, 100, true);

CREATE TABLE role_assignments (
  email       TEXT PRIMARY KEY,                  -- in minuscolo: vale anche per chi non è ancora entrato
  role_key    TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── privacy: la matrice ruolo × area sta in settings («planet.privacy»); qui le eccezioni personali ─────
CREATE TABLE privacy_exceptions (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  area        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('all', 'bu', 'own', 'none')),
  until       DATE,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (email, area)
);

-- ── registro: dettaglio (prima/dopo, su cosa) per le azioni che lo scrivono ─────────────────────────────
ALTER TABLE audit_log ADD COLUMN detail JSONB;
CREATE INDEX audit_log_action_idx ON audit_log(action, created_at);
