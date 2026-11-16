-- Win ratio (Dante 16/11/2026, canvas «v3 · Win ratio e facilità»): esiti delle offerte (vinta, persa, non
-- partecipato), scritti a mano finché non c'è l'integrazione con BOSS, che li porterà da sola (vincitore, ribasso,
-- offerenti) aggiornando le stesse righe con boss_ref. Dagli esiti il CRM impara la probabilità di vittoria.

CREATE TABLE crm_outcomes (
  id                SERIAL PRIMARY KEY,
  source            TEXT NOT NULL DEFAULT 'manuale' CHECK (source IN ('manuale', 'boss')),
  boss_ref          TEXT NOT NULL DEFAULT '',          -- id dell'opportunità in BOSS: niente doppioni
  subject_id        INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,   -- ente o azienda committente
  signal_id         INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL,
  plan_id           INTEGER REFERENCES crm_plans(id) ON DELETE SET NULL,
  initiative_id     INTEGER REFERENCES crm_initiatives(id) ON DELETE SET NULL,
  bu                TEXT REFERENCES crm_asa(key) ON DELETE SET NULL ON UPDATE CASCADE,
  title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  cig               TEXT NOT NULL DEFAULT '',
  origin            TEXT NOT NULL DEFAULT 'altro' CHECK (origin IN ('radar', 'gare', 'cliente', 'relazione', 'business', 'altro')),
  result            TEXT NOT NULL CHECK (result IN ('vinta', 'persa', 'non_partecipato')),
  reason            TEXT NOT NULL DEFAULT '',
  amount            NUMERIC,
  our_discount      NUMERIC,                           -- ribasso in %
  winner_discount   NUMERIC,
  winner_subject_id INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  winner_name       TEXT NOT NULL DEFAULT '',
  bidders           INTEGER,
  warm              BOOLEAN,                           -- c'era un contatto caldo (calcolato quando si registra)
  entity_kind       TEXT NOT NULL DEFAULT '',          -- kind del committente: ente_pubblico, partecipata, impresa…
  decided_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  lesson            TEXT NOT NULL DEFAULT '',
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_outcomes_boss ON crm_outcomes (boss_ref) WHERE boss_ref <> '';
CREATE UNIQUE INDEX crm_outcomes_signal ON crm_outcomes (signal_id) WHERE signal_id IS NOT NULL;
CREATE UNIQUE INDEX crm_outcomes_plan ON crm_outcomes (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX crm_outcomes_bu ON crm_outcomes (bu, decided_on);
CREATE INDEX crm_outcomes_winner ON crm_outcomes (winner_subject_id);

-- «Primo passo pronto»: chi chiama chi, quando e l'email già scritta, preparato quando si apre il segnale
ALTER TABLE crm_signals ADD COLUMN first_move JSONB;
