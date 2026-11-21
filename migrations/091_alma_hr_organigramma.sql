-- Alma HR, Fase 2: organigramma (canvas «Alma HR», pagina «Fase 2 · organigramma», 21/11/2026).
-- Regola di Dante: in Alma organigramma e persone sono solo da vedere, il data entry si fa su BOSS.
-- - Incarichi, aree e livelli si legano agli id di BOSS (sincronizzazione), con il link per «Modifica su BOSS ↗».
-- - Scenari: simulazioni salvate in Alma HR che non toccano l'organigramma vero.
-- - Eventi: cosa è cambiato da BOSS (incarico nuovo, riporto cambiato, persona entrata/uscita, nuova RAL…).
-- - Mansionario unico con Alma Strategy: i ruoli di Strategy si collegano a quelli HR e poi si ritirano.

ALTER TABLE org_incarichi ADD COLUMN boss_id TEXT;
ALTER TABLE org_incarichi ADD COLUMN boss_url TEXT;
CREATE UNIQUE INDEX org_incarichi_boss_idx ON org_incarichi(boss_id) WHERE boss_id IS NOT NULL;
ALTER TABLE org_aree ADD COLUMN boss_id TEXT;
ALTER TABLE org_livelli ADD COLUMN boss_id TEXT;
ALTER TABLE hr_people ADD COLUMN boss_url TEXT;

-- Da quando l'incarico è vacante (per «vacante da N giorni»).
ALTER TABLE org_incarichi ADD COLUMN vacante_dal DATE;

CREATE TABLE hr_scenarios (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  -- changes: [{ tipo: 'nuovo'|'riporto'|'ruolo'|'disattiva', … }] applicate in ordine sulla copia dell'organigramma
  changes     JSONB NOT NULL DEFAULT '[]',
  stato       TEXT NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto', 'realizzato', 'archiviato')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hr_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo        TEXT NOT NULL,          -- incarico_nuovo, incarico_disattivato, riporto, ricoperto, vacante, persona_entrata, persona_uscita, ral, livello
  oggetto     TEXT NOT NULL,          -- testo leggibile («Capo zona Basilicata · Reti BP/MP»)
  incarico_id INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL,
  person_key  TEXT,
  azione      TEXT,                   -- cosa serve in Alma, se serve (scegliere il ruolo…)
  fatto       BOOLEAN NOT NULL DEFAULT false,
  dettagli    JSONB
);
CREATE INDEX hr_events_at_idx ON hr_events(at);

-- Ruoli di Strategy collegati a un ruolo HR: si ritirano (restano per la storia, non si mostrano più).
ALTER TABLE pm_roles ADD COLUMN merged_into INTEGER REFERENCES pm_roles(id) ON DELETE SET NULL;
