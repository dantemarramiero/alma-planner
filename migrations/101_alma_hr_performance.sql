-- Alma HR, Fase 5: performance annuale e revisione retributiva (ALM2-59; canvas «Alma HR», pagina «Fase 5 · performance»,
-- tavole F5 e AH–AO). Decisioni di Dante (22/11/2026): un solo check a luglio (le revisioni trimestrali di Strategy
-- spariscono); voto finale 60% obiettivi e 40% competenze, dal G6 70/30, modificabile nel pannello grade per grade;
-- aumenti proposti dal responsabile nel budget dell'area, HR controlla, la Direzione approva, il CFO se si sfora;
-- voti 1–5 già dati convertiti ×2 (si vedono con il valore originale accanto). RAL nuove registrate su BOSS.

-- Calendario del ciclo, uno per anno di valutazione (tavola AO)
CREATE TABLE hr_cycles (
  year        INTEGER PRIMARY KEY,
  fasi        JSONB NOT NULL DEFAULT '{}',   -- { obiettivi:{apre,chiude}, semestre, valutazione, calibrazione, revisione }
  decorrenza  DATE,                           -- decorrenza delle nuove RAL
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La valutazione annuale resta in pm_reviews (Alma Strategy), con la scala e i campi del voto finale.
-- scale = 5 per i voti dati prima della Fase 5 (si mostrano ×2), 10 da qui in avanti.
ALTER TABLE pm_reviews ADD COLUMN scale        INTEGER NOT NULL DEFAULT 5 CHECK (scale IN (5, 10));
ALTER TABLE pm_reviews ADD COLUMN comment      TEXT NOT NULL DEFAULT '';
ALTER TABLE pm_reviews ADD COLUMN crescita     BOOLEAN NOT NULL DEFAULT false;   -- criterio «come si cresce» del mansionario raggiunto
ALTER TABLE pm_reviews ADD COLUMN final        NUMERIC(3,1);                     -- voto finale proposto (media pesata)
ALTER TABLE pm_reviews ADD COLUMN calibrated   NUMERIC(3,1);                     -- voto dopo la calibrazione
ALTER TABLE pm_reviews ADD COLUMN calib_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE pm_reviews ADD COLUMN piano        TEXT NOT NULL DEFAULT '';         -- piano di miglioramento (voto sotto 4)
ALTER TABLE pm_reviews ADD COLUMN calib_by     INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pm_reviews ADD COLUMN calib_at     TIMESTAMPTZ;

-- Check di metà anno (tavola AI): prende il posto delle revisioni trimestrali
CREATE TABLE hr_midyear (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
  "values"    JSONB NOT NULL DEFAULT '{}',   -- { objId: { valore, previsione, voto } }
  azioni      TEXT NOT NULL DEFAULT '',
  serve       TEXT NOT NULL DEFAULT '',
  quando      TIMESTAMPTZ,
  outlook_id  TEXT,
  join_url    TEXT,
  closed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);

-- Revisione retributiva (tavole AK–AM): una riga per persona e anno
CREATE TABLE hr_pay_reviews (
  id            SERIAL PRIMARY KEY,
  year          INTEGER NOT NULL,
  person_key    TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  area_id       INTEGER REFERENCES org_aree(id) ON DELETE SET NULL,
  role_id       INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,
  voto          NUMERIC(3,1),
  zona          TEXT,
  ral           INTEGER NOT NULL,
  merito_pct    NUMERIC(4,1) NOT NULL DEFAULT 0,      -- dalla matrice del pannello
  al_minimo     INTEGER NOT NULL DEFAULT 0,           -- euro per portare al minimo di fascia, prima del merito
  tipo          TEXT NOT NULL DEFAULT 'merito' CHECK (tipo IN ('merito', 'promozione', 'una_tantum', 'nessuno')),
  proposta_pct  NUMERIC(4,1) NOT NULL DEFAULT 0,
  nuovo_role_id INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL,
  nuova_ral     INTEGER NOT NULL,
  una_tantum    INTEGER NOT NULL DEFAULT 0,
  motivo        TEXT NOT NULL DEFAULT '',
  proposed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  colloquio_at  TIMESTAMPTZ,                          -- lettera consegnata dal responsabile
  boss_at       TIMESTAMPTZ,                          -- la RAL nuova trovata su BOSS
  boss_ral      INTEGER,                              -- quella trovata, se diversa
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, person_key)
);
CREATE TABLE hr_pay_areas (
  year      INTEGER NOT NULL,
  area_id   INTEGER NOT NULL REFERENCES org_aree(id) ON DELETE CASCADE,
  stato     TEXT NOT NULL DEFAULT 'aperta' CHECK (stato IN ('aperta', 'inviata', 'hr', 'direzione', 'approvata')),
  inviata_by INTEGER REFERENCES users(id) ON DELETE SET NULL, inviata_at TIMESTAMPTZ,
  hr_by      INTEGER REFERENCES users(id) ON DELETE SET NULL, hr_at      TIMESTAMPTZ,
  dir_by     INTEGER REFERENCES users(id) ON DELETE SET NULL, dir_at     TIMESTAMPTZ,
  cfo_by     INTEGER REFERENCES users(id) ON DELETE SET NULL, cfo_at     TIMESTAMPTZ,
  PRIMARY KEY (year, area_id)
);
