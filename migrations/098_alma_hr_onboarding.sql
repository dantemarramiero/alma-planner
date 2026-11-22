-- Alma HR, Fase 4: onboarding (ALM2-54; canvas «Alma HR», pagina «Fase 4 · onboarding», tavole F4 e AA–AG). Numero 098: 095–097 sono di altre sessioni.
-- Decisioni di Dante (22/11/2026): piano di 90 giorni (compiti + incontri 30/60/90), poi la sola decisione di fine prova;
-- formazione obbligatoria in Alma per ora (in BOSS non c'è); buddy per tutti, lo sceglie il responsabile; fine prova:
-- responsabile + visto HR, anche la Direzione da G6. Persone, incarichi e contratti restano su BOSS.

-- ruolo «QHSE» (Impostazioni › Ruoli): vede e aggiorna la formazione obbligatoria, non gli incontri
INSERT INTO roles (key, label, rule, rule_value, position, system) VALUES ('qhse', 'QHSE', 'manual', NULL, 7, true) ON CONFLICT (key) DO NOTHING;

-- Modelli di inserimento (tavola AF): base, famiglia del mansionario, sede, responsabili. Una riga per versione.
CREATE TABLE hr_onb_templates (
  id          SERIAL PRIMARY KEY,
  chiave      TEXT NOT NULL,                 -- base · fam:gestione · fam:field · … · sede:cantiere · resp
  nome        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  items       JSONB NOT NULL DEFAULT '[]',   -- [{ giorno, titolo, chi, collegato }]
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chiave, version)
);

-- Catalogo della formazione obbligatoria e corsi per ruolo (tavola AC)
CREATE TABLE hr_courses (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  ore             NUMERIC(5,1),
  validita_mesi   INTEGER,                    -- NULL = non scade
  blocca_cantiere BOOLEAN NOT NULL DEFAULT false,
  giorno          INTEGER NOT NULL DEFAULT 30, -- entro quanti giorni dall'ingresso, nel piano
  ordine          INTEGER NOT NULL DEFAULT 100,
  attivo          BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE hr_role_courses (
  role_id    INTEGER NOT NULL REFERENCES pm_roles(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES hr_courses(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, course_id)
);
CREATE TABLE hr_certificates (
  id          SERIAL PRIMARY KEY,
  person_key  TEXT NOT NULL,
  course_id   INTEGER NOT NULL REFERENCES hr_courses(id) ON DELETE CASCADE,
  data        DATE NOT NULL,
  scade       DATE,                          -- calcolata dalla validità del corso
  ente        TEXT NOT NULL DEFAULT '',
  file_nome   TEXT,
  file_mime   TEXT,
  file        BYTEA,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hr_certificates_person_idx ON hr_certificates(person_key, course_id, data DESC);

-- Documenti da leggere nel piano (oltre al mansionario del ruolo, che usa hr_role_acks)
CREATE TABLE hr_documents (
  id         SERIAL PRIMARY KEY,
  titolo     TEXT NOT NULL,
  url        TEXT,
  file_nome  TEXT,
  file_mime  TEXT,
  file       BYTEA,
  version    INTEGER NOT NULL DEFAULT 1,
  attivo     BOOLEAN NOT NULL DEFAULT true,
  ordine     INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un inserimento per persona (tavola AA). Nasce dal pre-boarding arrivato o lo avvia HR.
CREATE TABLE hr_onboardings (
  id             SERIAL PRIMARY KEY,
  person_key     TEXT NOT NULL,
  email          TEXT,
  nome           TEXT NOT NULL,
  incarico_id    INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL,
  role_id        INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,
  inizio         DATE NOT NULL,
  sede           TEXT NOT NULL DEFAULT 'ufficio' CHECK (sede IN ('ufficio', 'cantiere')),
  resp_email     TEXT,
  buddy_email    TEXT,
  fine_prova     DATE,
  prova_fonte    TEXT NOT NULL DEFAULT 'offerta',   -- offerta · ccnl · boss · hr
  preboarding_id INTEGER REFERENCES hr_preboarding(id) ON DELETE SET NULL,
  modelli        JSONB NOT NULL DEFAULT '{}',        -- { chiave: version } usati
  stato          TEXT NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto', 'chiuso', 'annullato')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX hr_onboardings_open_idx ON hr_onboardings(person_key) WHERE stato = 'aperto';

CREATE TABLE hr_onb_tasks (
  id          SERIAL PRIMARY KEY,
  onb_id      INTEGER NOT NULL REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  ordine      INTEGER NOT NULL,
  giorno      INTEGER NOT NULL,              -- 0 = primo giorno
  titolo      TEXT NOT NULL,
  chi         TEXT NOT NULL,                 -- nuovo · responsabile · buddy · hr · it · qhse · magazzino · mezzi
  tipo        TEXT NOT NULL DEFAULT 'compito' CHECK (tipo IN ('compito', 'corso', 'documento', 'incontro', 'prova', 'obiettivi')),
  ref         TEXT,                          -- course id, doc id, tappa
  fatto       BOOLEAN NOT NULL DEFAULT false,
  fatto_at    TIMESTAMPTZ,
  fatto_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reminded_at TIMESTAMPTZ
);
CREATE INDEX hr_onb_tasks_onb_idx ON hr_onb_tasks(onb_id, ordine);

CREATE TABLE hr_onb_goals (
  id      SERIAL PRIMARY KEY,
  onb_id  INTEGER NOT NULL REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  ordine  INTEGER NOT NULL,
  titolo  TEXT NOT NULL,
  stato   TEXT NOT NULL DEFAULT 'da_fare' CHECK (stato IN ('da_fare', 'meta', 'fatto'))
);

CREATE TABLE hr_doc_reads (
  onb_id   INTEGER NOT NULL REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  doc_key  TEXT NOT NULL,                    -- doc:<id> · mansionario:<role_id>
  version  INTEGER NOT NULL DEFAULT 1,
  domanda  TEXT NOT NULL DEFAULT '',
  read_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (onb_id, doc_key)
);

-- Incontri 30/60/90 (tavola AD): voti 1–10 come la valutazione annuale; pulse 1–5 del nuovo assunto
CREATE TABLE hr_onb_meetings (
  id          SERIAL PRIMARY KEY,
  onb_id      INTEGER NOT NULL REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  tappa       INTEGER NOT NULL CHECK (tappa IN (30, 60, 90)),
  quando      TIMESTAMPTZ,
  outlook_id  TEXT,
  join_url    TEXT,
  voto_obiettivi INTEGER CHECK (voto_obiettivi BETWEEN 1 AND 10),
  voto_squadra   INTEGER CHECK (voto_squadra BETWEEN 1 AND 10),
  serve       TEXT NOT NULL DEFAULT '',
  prossimo    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  fatto_at    TIMESTAMPTZ,
  fatto_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (onb_id, tappa)
);
CREATE TABLE hr_onb_pulse (
  onb_id  INTEGER NOT NULL REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  tappa   INTEGER NOT NULL CHECK (tappa IN (30, 60, 90)),
  q1      INTEGER NOT NULL CHECK (q1 BETWEEN 1 AND 5),   -- ha quello che serve
  q2      INTEGER NOT NULL CHECK (q2 BETWEEN 1 AND 5),   -- sa cosa ci si aspetta
  q3      INTEGER NOT NULL CHECK (q3 BETWEEN 1 AND 5),   -- si sente accolto
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (onb_id, tappa)
);

-- Fine del periodo di prova (tavola AE): un promemoria firmato per il consulente; il contratto resta su BOSS
CREATE TABLE hr_probation (
  onb_id        INTEGER PRIMARY KEY REFERENCES hr_onboardings(id) ON DELETE CASCADE,
  decisione     TEXT CHECK (decisione IN ('conferma', 'non_superata')),
  motivo        TEXT NOT NULL DEFAULT '',
  deciso_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deciso_at     TIMESTAMPTZ,
  hr_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hr_at         TIMESTAMPTZ,
  dir_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dir_at        TIMESTAMPTZ,
  revisione_ral INTEGER,                     -- solo HR: revisione promessa nell'offerta
  reminded      JSONB NOT NULL DEFAULT '{}'
);
