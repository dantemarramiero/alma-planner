-- Attestazioni SOA (ALM2-49, canvas CRM v13 · V13-SOA, via di Dante 21/11/2026): chi è qualificato in quali categorie
-- e con che classifica, dagli open data ANAC «Attestazioni SOA v2». Una riga per impresa (l'attestazione valida più
-- recente); si ricarica tutta ogni settimana. Serve per «Chi è qualificato in zona» nel Mercato e nella scheda impresa.
CREATE TABLE IF NOT EXISTS crm_soa (
  cf             TEXT PRIMARY KEY,               -- codice fiscale dell'impresa
  name           TEXT NOT NULL DEFAULT '',
  province       TEXT NOT NULL DEFAULT '',       -- sede (provincia scritta nell'attestato)
  region         TEXT NOT NULL DEFAULT '',
  soa_name       TEXT NOT NULL DEFAULT '',       -- organismo che l'ha rilasciata
  issued_on      DATE,
  mid_check_on   DATE,                           -- verifica triennale
  expires_on     DATE,                           -- scadenza quinquennale
  cats           JSONB NOT NULL DEFAULT '{}'     -- { "OG10": "IV", "OS30": "III-BIS", … }
);
CREATE INDEX IF NOT EXISTS crm_soa_cats ON crm_soa USING gin (cats);
CREATE INDEX IF NOT EXISTS crm_soa_region ON crm_soa (lower(region));

CREATE TABLE IF NOT EXISTS crm_soa_imports (
  id      SERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows    INT NOT NULL DEFAULT 0,
  error   TEXT NOT NULL DEFAULT ''
);
