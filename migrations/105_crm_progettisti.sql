-- Progettisti da ANAC (ALM2-70, tavola O approvata da Dante il 23/11/2026): gli incarichi di servizi di architettura e
-- ingegneria (CPV 712…, 713…, 7152… direzione lavori, 71541… project management) con chi li ha vinti. Tabella a parte
-- da crm_anac_awards, così le classifiche di Concorrenza restano solo sui lavori. Si caricano ogni notte dopo ANAC
-- (lib/crm-progettisti.js); col CUP si collegano alla gara dei lavori della stessa opera.
CREATE TABLE IF NOT EXISTS crm_anac_design (
  cig TEXT PRIMARY KEY,
  object TEXT NOT NULL DEFAULT '',
  sa_cf TEXT NOT NULL DEFAULT '',
  sa_name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  cpv TEXT NOT NULL DEFAULT '',
  base_amount NUMERIC,
  amount NUMERIC,
  discount NUMERIC,
  bidders INTEGER,
  awarded_on DATE,
  published_on DATE,
  pnrr BOOLEAN NOT NULL DEFAULT false,
  winners JSONB NOT NULL DEFAULT '[]',
  parts JSONB NOT NULL DEFAULT '[]',
  cup TEXT NOT NULL DEFAULT '',
  month TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS crm_anac_design_sa ON crm_anac_design (sa_cf);
CREATE INDEX IF NOT EXISTS crm_anac_design_cup ON crm_anac_design (cup) WHERE cup <> '';
CREATE INDEX IF NOT EXISTS crm_anac_design_winners ON crm_anac_design USING gin (winners jsonb_path_ops);

CREATE TABLE IF NOT EXISTS crm_anac_design_imports (
  key TEXT PRIMARY KEY,          -- AAAAMM (file del mese), 'storico' (file unico), 'cup'
  kept INTEGER,
  error TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- il tipo «Progettista» nel CRM (studio o professionista che progetta le opere degli enti)
ALTER TABLE crm_subjects DROP CONSTRAINT IF EXISTS crm_subjects_roles_check;
ALTER TABLE crm_subjects ADD CONSTRAINT crm_subjects_roles_check CHECK (roles <@ ARRAY['lead', 'cliente', 'fornitore', 'partner', 'concorrente', 'progettista']::text[]);
