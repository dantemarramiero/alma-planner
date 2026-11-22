-- Gare europee da TED (ALM2-49, canvas CRM v14 · V14-TED): avvisi di gara (bandi) ed esiti italiani per i codici CPV
-- delle categorie SOA in uso. Si caricano ogni notte dalla API pubblica di TED (lib/crm-ted.js).
CREATE TABLE IF NOT EXISTS crm_ted_notices (
  pub TEXT PRIMARY KEY,                      -- numero di pubblicazione TED, es. 382839-2026
  kind TEXT NOT NULL,                        -- bando | esito
  title TEXT NOT NULL DEFAULT '',
  buyer TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  nuts TEXT[] NOT NULL DEFAULT '{}',         -- luogo del cantiere (NUTS 3)
  regions TEXT[] NOT NULL DEFAULT '{}',
  cpv TEXT[] NOT NULL DEFAULT '{}',
  value NUMERIC,
  lots INTEGER NOT NULL DEFAULT 1,
  published_on DATE,
  deadline DATE,                             -- bandi: termine per le offerte
  offers INTEGER,                            -- esiti: offerte ricevute
  winners JSONB NOT NULL DEFAULT '[]',       -- esiti: [{ name, cf }]
  signal_id INTEGER                          -- «Porta avanti»: il segnale del radar creato dal bando
);
CREATE INDEX IF NOT EXISTS crm_ted_notices_kind ON crm_ted_notices (kind, deadline);
CREATE INDEX IF NOT EXISTS crm_ted_notices_pub_on ON crm_ted_notices (published_on);

CREATE TABLE IF NOT EXISTS crm_ted_imports (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows INTEGER NOT NULL DEFAULT 0,
  codes INTEGER NOT NULL DEFAULT 0,
  codes_list TEXT[] NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT ''
);
