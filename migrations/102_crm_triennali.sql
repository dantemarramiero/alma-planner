-- Programmi triennali dei lavori pubblici nel Radar (canvas v17 · Le fonti del Radar, Dante 22/11/2026): gli interventi
-- pubblicati dagli enti sul Servizio Contratti Pubblici del MIT, con categoria CUP, CUP, importi, comune e mese di avvio
-- della gara. Si caricano ogni settimana per le regioni delle BU (lib/crm-triennali.js).
CREATE TABLE IF NOT EXISTS crm_prog_interventi (
  cui TEXT PRIMARY KEY,                      -- codice unico dell'intervento (es. L80005970670201800003)
  prog_id INTEGER NOT NULL,                  -- programma (l'ultima versione pubblicata che lo contiene)
  prog_year INTEGER NOT NULL,                -- primo anno del programma (2026 = 2026/2028)
  sa_cf TEXT NOT NULL DEFAULT '',
  sa_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  annualita INTEGER,                         -- 1, 2 o 3: in quale anno del programma
  year INTEGER,                              -- anno previsto della gara (prog_year + annualita - 1)
  month INTEGER,                             -- mese previsto di avvio della procedura, se c'è
  cup TEXT NOT NULL DEFAULT '',
  istat TEXT NOT NULL DEFAULT '',
  nuts TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  type_key TEXT NOT NULL DEFAULT '',         -- categoria CUP (settore.sottosettore), come in OpenCUP
  priority INTEGER,
  design_stage TEXT NOT NULL DEFAULT '',     -- stato della progettazione
  amount NUMERIC,
  published_on DATE,
  act_url TEXT NOT NULL DEFAULT '',
  first_seen DATE NOT NULL DEFAULT CURRENT_DATE,
  signal_id INTEGER
);
CREATE INDEX IF NOT EXISTS crm_prog_interventi_region ON crm_prog_interventi (region, year);
CREATE INDEX IF NOT EXISTS crm_prog_interventi_cup ON crm_prog_interventi (cup) WHERE cup <> '';

CREATE TABLE IF NOT EXISTS crm_prog_imports (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  programmes INTEGER NOT NULL DEFAULT 0,
  rows INTEGER NOT NULL DEFAULT 0,
  regions TEXT[] NOT NULL DEFAULT '{}',
  signals INTEGER,
  error TEXT NOT NULL DEFAULT ''
);

-- «storia dell'opera»: il CUP sul segnale, così la stessa opera trovata da più fonti (OpenCUP, programma triennale)
-- resta una scheda sola e la fase va avanti da sola
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS cup TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS crm_signals_cup ON crm_signals (cup) WHERE cup <> '';
-- i segnali di OpenCUP già creati hanno il CUP come codice esterno
UPDATE crm_signals SET cup = external_id WHERE source = 'opencup' AND cup = '';
