-- (099: la 097 è crm_doppioni, la 098 alma_hr_onboarding)
-- Opere finanziate da OpenCUP (ALM2-49, canvas CRM v14 · V14-OpenCUP): lavori pubblici attivi degli ultimi anni per
-- i tipi di lavoro delle categorie SOA in uso, nelle regioni in uso. Si caricano una volta al mese (lib/crm-cup.js).
CREATE TABLE IF NOT EXISTS crm_cup_works (
  cup TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  year INTEGER,                              -- anno della decisione
  cost NUMERIC,
  funding NUMERIC,
  region TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',         -- sigla
  comune TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',            -- soggetto titolare (la stazione appaltante)
  owner_cf TEXT NOT NULL DEFAULT '',
  type_key TEXT NOT NULL DEFAULT '',         -- settore.sottosettore.categoria del CUP, es. 03.16.065
  type_label TEXT NOT NULL DEFAULT '',
  coverage TEXT NOT NULL DEFAULT '',         -- copertura finanziaria: Statale, Comunitaria, Regionale…
  program TEXT NOT NULL DEFAULT '',          -- strumento di programmazione
  created_on DATE,
  oc_link TEXT NOT NULL DEFAULT '',          -- progetto su OpenCoesione, quando c'è
  places INTEGER NOT NULL DEFAULT 1,         -- in quanti comuni
  signal_id INTEGER                          -- «Segnala al radar»
);
CREATE INDEX IF NOT EXISTS crm_cup_works_region ON crm_cup_works (region, year);
CREATE INDEX IF NOT EXISTS crm_cup_works_owner ON crm_cup_works (owner_cf) WHERE owner_cf <> '';

CREATE TABLE IF NOT EXISTS crm_cup_imports (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows INTEGER NOT NULL DEFAULT 0,
  areas TEXT[] NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT ''
);
