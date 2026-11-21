-- Alma HR, Fase 1: fondamenta (Dante 21/11/2026; canvas «Alma HR», tavole A–J + H2).
-- Decisioni: BOSS è la fonte di anagrafica, incarichi, CCNL e RAL (oggi import dell'export mensile, domani API);
-- le RAL le vede solo il team HR; la griglia salary grade (senza nomi) la vedono tutti; griglia G1–G8 con una fascia
-- per grade, sovrapposte; un solo pannello di controllo da cui tutte le pagine leggono i numeri.
-- Il mansionario è quello di Alma Strategy (pm_roles): Alma HR aggiunge famiglia, livello, grade, autonomia C1–C5,
-- criteri per salire e versioni, così il mansionario resta uno solo.
-- Numero 090: 081–089 restano ai branch aperti in parallelo.

-- Ruolo «Team HR» (Impostazioni › Ruoli): solo chi ce l'ha vede RAL, posizioni in fascia, mappatura e pannello.
INSERT INTO roles (key, label, rule, rule_value, position, system) VALUES ('hr', 'Team HR', 'manual', NULL, 5, true)
  ON CONFLICT (key) DO NOTHING;

-- Mansionario: un ruolo di Alma HR è una riga di pm_roles con famiglia e livello (es. «Project Manager · Junior»).
ALTER TABLE pm_roles ADD COLUMN hr_family TEXT;                                  -- gestione, field, engineering, staff, direzione
ALTER TABLE pm_roles ADD COLUMN hr_name TEXT;                                    -- «Project Manager»
ALTER TABLE pm_roles ADD COLUMN hr_level TEXT NOT NULL DEFAULT '';               -- «Junior», «Intermedio», «Senior», ''
ALTER TABLE pm_roles ADD COLUMN grade INTEGER CHECK (grade BETWEEN 1 AND 8);
ALTER TABLE pm_roles ADD COLUMN autonomy JSONB NOT NULL DEFAULT '{}';            -- { C1: 'auto'|'sup'|'support'|'none', … }
ALTER TABLE pm_roles ADD COLUMN next_criteria TEXT NOT NULL DEFAULT '';          -- cosa serve per il livello dopo
ALTER TABLE pm_roles ADD COLUMN requirements JSONB NOT NULL DEFAULT '[]';        -- formazione e sicurezza
ALTER TABLE pm_roles ADD COLUMN hr_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE pm_roles ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pm_roles ADD COLUMN version_at TIMESTAMPTZ;
CREATE INDEX pm_roles_hr_idx ON pm_roles(hr_family, hr_order) WHERE hr_family IS NOT NULL;

-- Presa visione della scheda del ruolo, versione per versione.
CREATE TABLE hr_role_acks (
  role_id   INTEGER NOT NULL REFERENCES pm_roles(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,
  version   INTEGER NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, email, version)
);

-- Il ruolo sta sull'incarico (organigramma a incarichi), non sulla persona.
CREATE TABLE hr_incarico_roles (
  incarico_id  INTEGER PRIMARY KEY REFERENCES org_incarichi(id) ON DELETE CASCADE,
  role_id      INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,     -- confermato da HR
  proposed_id  INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,     -- proposta (import v11 o somiglianza)
  proposed_why TEXT,
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ
);

-- Persone come le dà BOSS (copia in sola lettura). Chiave: id di BOSS, altrimenti l'email, altrimenti cognome+nome.
CREATE TABLE hr_people (
  key              TEXT PRIMARY KEY,
  boss_id          TEXT,
  nome             TEXT NOT NULL DEFAULT '',
  cognome          TEXT NOT NULL DEFAULT '',
  email            TEXT,                       -- in minuscolo
  societa          TEXT,
  bu               TEXT,
  qualifica        TEXT,                       -- incarico/qualifica scritta su BOSS
  ccnl             TEXT,
  livello          TEXT,
  contratto        TEXT,                       -- TI, TD, APPR, STAFF_LEASING, TIROCINIO
  part_time_pct    NUMERIC NOT NULL DEFAULT 100,
  data_assunzione  DATE,
  scadenza         DATE,
  sesso            TEXT,
  attivo           BOOLEAN NOT NULL DEFAULT true,
  esclusione       TEXT,                       -- operaio, apprendista, tirocinio, staff_leasing, organo: fuori dalla griglia
  role_id          INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,  -- ruolo di chi non ricopre un incarico
  source           TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'boss')),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hr_people_email_idx ON hr_people(email);

-- Retribuzioni da BOSS (RetribuzioneIndividuale): storico con le date di validità. Le legge solo il team HR.
CREATE TABLE hr_pay (
  id           BIGSERIAL PRIMARY KEY,
  person_key   TEXT NOT NULL REFERENCES hr_people(key) ON DELETE CASCADE,
  ral          NUMERIC NOT NULL,
  ad_personam  NUMERIC NOT NULL DEFAULT 0,
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  source       TEXT NOT NULL DEFAULT 'import',
  UNIQUE (person_key, valid_from)
);

-- Il pannello di controllo: una griglia per versione. bands: [{ grade, min, mid, max }] in migliaia di euro;
-- rules: zone, soglie, offerte, merito, promozioni, CCNL, mercato, budget; params: le leve della vista d'insieme.
-- La griglia in vigore è l'ultima applicata con valid_from <= oggi; le bozze non hanno applied_at.
CREATE TABLE hr_grids (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  bands       JSONB NOT NULL,
  rules       JSONB NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}',
  valid_from  DATE,
  applied_at  TIMESTAMPTZ,
  applied_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro: chi ha aperto una retribuzione o un export, e ogni modifica del pannello (prima e dopo).
CREATE TABLE hr_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('accesso', 'modifica')),
  action      TEXT NOT NULL,
  person_key  TEXT,
  before      JSONB,
  after       JSONB
);
CREATE INDEX hr_log_at_idx ON hr_log(at);
