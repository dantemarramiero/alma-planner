-- Organigramma a incarichi, come in BOSS (Dante 20/11/2026; canvas «Alma Planet · Organigramma a incarichi»;
-- fonte: ADR-0015 di BOSS, emendamento «organigramma a incarichi» del 23/10, e la spec boss/docs/product/organigramma.md).
-- Le frecce uniscono gli incarichi, non le persone. Nomi dei campi nell'API uguali a BOSS per l'integrazione:
--   Area (BusinessUnit): nome, tipo, ordine, attiva · Livello: nome, ordine, approva, attivo
--   Incarico: nome, businessUnitId, livelloOrganigrammaId, riportaAIncaricoId, ricopertoDaPersonaleId, attivo
--   Persona: incaricoPrincipaleId, riportaAIncaricoId, esterno
-- Le persone sono quelle di Entra (org_people) più gli esterni; la chiave è l'email in minuscolo.
-- Numero 075: 072–074 restano ai branch aperti in parallelo.

CREATE TABLE org_aree (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE,
  tipo       TEXT NOT NULL DEFAULT 'funzionale' CHECK (tipo IN ('funzionale', 'operativa', 'altro')),
  ordine     INTEGER NOT NULL DEFAULT 100,
  attiva     BOOLEAN NOT NULL DEFAULT true,
  centro_costo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Le aree di Almacis come in BOSS (ADR-0015 §1): 7 funzionali, 8 operative («Area Lavori» è solo un'etichetta), Altro.
INSERT INTO org_aree (nome, tipo, ordine) VALUES
  ('Amministrazione', 'funzionale', 10), ('IT', 'funzionale', 20), ('HR', 'funzionale', 30), ('Progettazione', 'funzionale', 40),
  ('Procurement', 'funzionale', 50), ('QHSE', 'funzionale', 60), ('Gare', 'funzionale', 70),
  ('Reti BP/MP', 'operativa', 110), ('Reti AP', 'operativa', 120), ('Edilizia', 'operativa', 130), ('Impianti', 'operativa', 140),
  ('Facility Management', 'operativa', 150), ('Restauro', 'operativa', 160), ('ISA', 'operativa', 170), ('ESCO', 'operativa', 180),
  ('Altro', 'altro', 900);

CREATE TABLE org_livelli (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  ordine     INTEGER NOT NULL,                 -- 1 = in cima
  approva    BOOLEAN NOT NULL DEFAULT false,   -- «approva le richieste»
  attivo     BOOLEAN NOT NULL DEFAULT true,    -- non si cancella: si disattiva
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- L'esempio della spec di BOSS: si cambia in Livelli e aree.
INSERT INTO org_livelli (nome, ordine, approva) VALUES
  ('Direzione', 1, true), ('Direttori', 2, true), ('Responsabili', 3, true), ('Capi cantiere', 4, false);

CREATE TABLE org_incarichi (
  id                SERIAL PRIMARY KEY,
  nome              TEXT NOT NULL,
  area_id           INTEGER REFERENCES org_aree(id) ON DELETE SET NULL,
  livello_id        INTEGER REFERENCES org_livelli(id) ON DELETE SET NULL,
  riporta_a_id      INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL,  -- assente solo per il vertice
  ricoperto_da      TEXT,                                                      -- email della persona; assente = vacante
  responsabile_area BOOLEAN NOT NULL DEFAULT false,                            -- «è il responsabile dell'area»
  attivo            BOOLEAN NOT NULL DEFAULT true,                             -- disattivato = per l'organigramma non esiste
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ
);
CREATE INDEX org_incarichi_riporta_idx ON org_incarichi(riporta_a_id);
CREATE INDEX org_incarichi_ricoperto_idx ON org_incarichi(ricoperto_da);

-- Le scelte sulla persona (chi è in Entra ha qui solo ciò che Entra non sa; gli esterni ci sono per intero).
CREATE TABLE org_persone (
  email                 TEXT PRIMARY KEY,                       -- in minuscolo
  nome                  TEXT,                                   -- solo per gli esterni (gli altri da Entra)
  esterno               BOOLEAN NOT NULL DEFAULT false,
  riporta_a_incarico_id INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL,  -- per chi non ricopre incarichi
  incarico_principale_id INTEGER REFERENCES org_incarichi(id) ON DELETE SET NULL, -- per chi ne ricopre più d'uno
  area_id               INTEGER REFERENCES org_aree(id) ON DELETE SET NULL,       -- appartenenza: costo e commesse
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Storia dei cambi: ogni modifica con prima e dopo.
CREATE TABLE org_cambi (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  azione     TEXT NOT NULL,
  oggetto    TEXT,
  prima      JSONB,
  dopo       JSONB,
  persone_cambiate INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX org_cambi_at_idx ON org_cambi(at);
