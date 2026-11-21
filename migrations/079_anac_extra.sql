-- ANAC: altri dati aperti sulle stesse gare (ALM2-49, Dante 21/11/2026, «tutte le fonti gratuite»):
-- categorie scorporabili (categorie-opera tipo S), tipo di lavoro (lavorazioni), CUP (cup), chi ha partecipato
-- (partecipanti, anche chi ha perso) e i subappalti autorizzati (subappalti, arrivano mesi dopo l'aggiudicazione).
ALTER TABLE crm_anac_awards ADD COLUMN cats_sec TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE crm_anac_awards ADD COLUMN work_type TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_anac_awards ADD COLUMN cup TEXT NOT NULL DEFAULT '';
CREATE INDEX crm_anac_awards_cup ON crm_anac_awards (cup) WHERE cup <> '';

CREATE TABLE crm_anac_bidders (
  cig    TEXT NOT NULL,
  cf     TEXT NOT NULL,
  name   TEXT NOT NULL DEFAULT '',
  role   TEXT NOT NULL DEFAULT '',          -- mandataria · mandante · consorzio · '' (da sola)
  PRIMARY KEY (cig, cf)
);
CREATE INDEX crm_anac_bidders_cf ON crm_anac_bidders (cf);

CREATE TABLE crm_anac_subcontracts (
  id             TEXT PRIMARY KEY,          -- id_subappalto di ANAC
  cig            TEXT NOT NULL,
  cf             TEXT NOT NULL DEFAULT '',  -- subappaltatore
  name           TEXT NOT NULL DEFAULT '',
  by_cf          TEXT NOT NULL DEFAULT '',  -- chi affida il subappalto (l'aggiudicatario)
  category       TEXT NOT NULL DEFAULT '',
  cat_type       TEXT NOT NULL DEFAULT '',  -- prevalente · scorporabile
  cpv            TEXT NOT NULL DEFAULT '',
  object         TEXT NOT NULL DEFAULT '',
  authorized_on  DATE
);
CREATE INDEX crm_anac_subcontracts_cig ON crm_anac_subcontracts (cig);
CREATE INDEX crm_anac_subcontracts_cf ON crm_anac_subcontracts (cf);

-- versione dei dati di un mese: 2 = con i dati in più qui sopra (i mesi caricati prima si ricaricano una volta)
ALTER TABLE crm_anac_imports ADD COLUMN ver INT NOT NULL DEFAULT 1;
-- file letti una volta sola o ogni mese: subappalti mensili e completo, cup
CREATE TABLE crm_anac_extra_imports (
  key    TEXT PRIMARY KEY,                  -- 'subappalti:202604' · 'subappalti:storico' · 'cup'
  rows   INT NOT NULL DEFAULT 0,
  error  TEXT NOT NULL DEFAULT '',
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
