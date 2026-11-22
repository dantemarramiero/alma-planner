-- Alma HR, Fase 3: recruitment (ALM2-53; canvas «Alma HR», pagina «Fase 3 · recruitment», tavole 3 e S–Z).
-- Decisioni di Dante (22/11/2026): candidature da una pagina pubblica «Lavora con noi» per ogni annuncio; approvano
-- sempre HR + Direzione, il CFO solo per posizioni nuove, fuori dal piano o sopra G6; CV dei non assunti conservati
-- 24 mesi con il consenso, poi cancellati da soli. Persone e organigramma restano su BOSS: Alma non crea persone.

-- ruolo «CFO» (Impostazioni › Ruoli): approva le richieste che lo chiedono
INSERT INTO roles (key, label, rule, rule_value, position, system) VALUES ('cfo', 'CFO', 'manual', NULL, 6, true) ON CONFLICT (key) DO NOTHING;

-- notifiche di Alma HR (approvazioni, colloqui, pre-boarding)
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin', 'note_mention', 'rda_new', 'rda_accepted', 'rda_rejected',
                  'due_tomorrow', 'overdue_project', 'software_proposal', 'mezzi', 'ticket_reminder', 'energy', 'strategy', 'it',
                  'new_post', 'ticket_assigned', 'a3_update', 'crm', 'hr'));

-- Richiesta di personale: nasce da un incarico (vacante) dell'organigramma di BOSS, o dice che l'incarico va creato su BOSS.
CREATE TABLE hr_requisitions (
  id            SERIAL PRIMARY KEY,
  incarico_id   INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL,
  posizione     TEXT NOT NULL,
  role_id       INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,
  area_id       INTEGER REFERENCES org_aree(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL DEFAULT 'sostituzione' CHECK (tipo IN ('sostituzione', 'nuova', 'temporanea')),
  motivo        TEXT NOT NULL DEFAULT '',
  da_quando     TEXT NOT NULL DEFAULT '',
  contratto     TEXT NOT NULL DEFAULT 'TI',
  sede          TEXT NOT NULL DEFAULT '',
  nel_piano     BOOLEAN NOT NULL DEFAULT true,
  stato         TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza', 'approvazione', 'modifica', 'approvata', 'rifiutata', 'coperta', 'chiusa')),
  requested_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ
);

-- Catena di approvazione, per richieste e offerte: un passo per riga, in ordine.
CREATE TABLE hr_approvals (
  id          SERIAL PRIMARY KEY,
  oggetto     TEXT NOT NULL CHECK (oggetto IN ('richiesta', 'offerta')),
  oggetto_id  INTEGER NOT NULL,
  ordine      INTEGER NOT NULL,
  ruolo       TEXT NOT NULL CHECK (ruolo IN ('hr', 'direzione', 'cfo', 'bu')),
  decisione   TEXT CHECK (decisione IN ('ok', 'modifica', 'no')),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  commento    TEXT NOT NULL DEFAULT '',
  decided_at  TIMESTAMPTZ
);
CREATE INDEX hr_approvals_obj_idx ON hr_approvals(oggetto, oggetto_id, ordine);

-- Annuncio (uno per richiesta), con la pagina pubblica «Lavora con noi».
CREATE TABLE hr_postings (
  id            SERIAL PRIMARY KEY,
  req_id        INTEGER NOT NULL UNIQUE REFERENCES hr_requisitions(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  titolo        TEXT NOT NULL,
  testo         JSONB NOT NULL DEFAULT '{}',     -- { scopo, cosa, requisiti, crescita }
  ral_min       INTEGER,
  ral_max       INTEGER,
  variabile     TEXT NOT NULL DEFAULT '',
  pubblicato    BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidati: una scheda per persona, anche se si candida a più posizioni. conservare_fino = cancellazione automatica.
CREATE TABLE hr_candidates (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  cognome         TEXT NOT NULL DEFAULT '',
  email           TEXT,
  telefono        TEXT,
  sesso           TEXT CHECK (sesso IN ('F', 'M')),   -- facoltativo, solo per le statistiche di equità delle offerte
  consenso        BOOLEAN NOT NULL DEFAULT false,      -- trattamento per questa selezione (obbligatorio per candidarsi)
  conserva        BOOLEAN NOT NULL DEFAULT false,      -- conservare il CV 24 mesi per altre posizioni
  consenso_at     TIMESTAMPTZ,
  conservare_fino DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hr_candidates_email_idx ON hr_candidates(lower(email));

-- File dei candidati (CV, lettere, documenti del pre-boarding): li vede solo il team HR.
CREATE TABLE hr_files (
  id            SERIAL PRIMARY KEY,
  candidate_id  INTEGER NOT NULL REFERENCES hr_candidates(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'cv',     -- cv, lettera, documento
  nome          TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL DEFAULT 0,
  data          BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidatura = un candidato su una posizione, con il passo della pipeline.
CREATE TABLE hr_applications (
  id            SERIAL PRIMARY KEY,
  candidate_id  INTEGER NOT NULL REFERENCES hr_candidates(id) ON DELETE CASCADE,
  req_id        INTEGER NOT NULL REFERENCES hr_requisitions(id) ON DELETE CASCADE,
  fonte         TEXT NOT NULL DEFAULT 'hr' CHECK (fonte IN ('pagina', 'linkedin', 'indeed', 'referral', 'hr', 'altro')),
  passi         TEXT[] NOT NULL DEFAULT '{nuovi}',   -- i passi raggiunti (per l'imbuto dei numeri)
  stage         TEXT NOT NULL DEFAULT 'nuovi' CHECK (stage IN ('nuovi', 'screening', 'colloquio_hr', 'colloquio_tecnico', 'offerta', 'accettata', 'scartata')),
  motivo_scarto TEXT NOT NULL DEFAULT '',
  match_pct     INTEGER,
  match_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, req_id)
);

CREATE TABLE hr_app_events (
  id       BIGSERIAL PRIMARY KEY,
  app_id   INTEGER NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  testo    TEXT NOT NULL
);

-- Colloqui: chi intervista vede solo il candidato e il colloquio assegnato.
CREATE TABLE hr_interviews (
  id                SERIAL PRIMARY KEY,
  app_id            INTEGER NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL DEFAULT 'hr' CHECK (tipo IN ('hr', 'tecnico')),
  interviewer_email TEXT NOT NULL,
  quando            TIMESTAMPTZ,
  outlook_id        TEXT,
  join_url          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Voti della scorecard (1–5): ognuno vota da solo; gli altri voti si vedono quando hanno votato tutti.
CREATE TABLE hr_scores (
  app_id      INTEGER NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  competenza  TEXT NOT NULL,
  voto        INTEGER NOT NULL CHECK (voto BETWEEN 1 AND 5),
  nota        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, email, competenza)
);

-- Offerta: dentro la fascia, con la sua catena di approvazione (hr_approvals, oggetto «offerta»).
CREATE TABLE hr_offers (
  id             SERIAL PRIMARY KEY,
  app_id         INTEGER NOT NULL REFERENCES hr_applications(id) ON DELETE CASCADE,
  ral            INTEGER NOT NULL,
  ingresso       DATE,
  contratto      TEXT NOT NULL DEFAULT 'TI',
  ccnl_livello   TEXT NOT NULL DEFAULT '',
  benefit        TEXT NOT NULL DEFAULT '',
  prova_mesi     INTEGER NOT NULL DEFAULT 6,
  motivo         TEXT NOT NULL DEFAULT '',     -- obbligatorio fuori fascia
  stato          TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza', 'approvazione', 'approvata', 'inviata', 'accettata', 'rifiutata', 'respinta')),
  motivo_rifiuto TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-boarding: dal «sì» al primo giorno. La pagina del candidato è un link riservato che scade al primo giorno.
CREATE TABLE hr_preboarding (
  id           SERIAL PRIMARY KEY,
  app_id       INTEGER NOT NULL UNIQUE REFERENCES hr_applications(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  ingresso     DATE NOT NULL,
  taglie       JSONB NOT NULL DEFAULT '{}',
  stato        TEXT NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto', 'arrivato', 'annullato')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrived_at   TIMESTAMPTZ
);
CREATE TABLE hr_pre_tasks (
  id         SERIAL PRIMARY KEY,
  pre_id     INTEGER NOT NULL REFERENCES hr_preboarding(id) ON DELETE CASCADE,
  ordine     INTEGER NOT NULL,
  titolo     TEXT NOT NULL,
  chi        TEXT NOT NULL,             -- candidato, hr, consulente, it, magazzino, mezzi, responsabile, boss
  giorni     INTEGER NOT NULL,          -- rispetto all'ingresso (−20 … 1)
  fatto      BOOLEAN NOT NULL DEFAULT false,
  fatto_at   TIMESTAMPTZ,
  fatto_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
