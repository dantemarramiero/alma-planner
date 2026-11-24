-- Alma Impianti tappa 2 (ALM2-77, tavole 1, 3 e 6 del canvas approvato da Dante il 24/11/2026).
-- Numero 111: la 108 e la 110 sono di altre sessioni.
-- - Opportunità col triangolo: su ogni opportunità della BU (segnale del radar) chi finanzia (fondo), chi progetta
--   (progettista) e la fase EPC; il sito è l'azienda già collegata al segnale (crm_signals.subject_id).
-- - Energivori: l'elenco caricato da file (CSEA o altro), con consumo e tetto per il punteggio e le stime.

ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS designer_id INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL;
ALTER TABLE crm_signals ADD COLUMN IF NOT EXISTS imp_stage TEXT NOT NULL DEFAULT ''
  CHECK (imp_stage IN ('', 'origination', 'fattibilita', 'offerta', 'negoziazione', 'firmato', 'persa'));

CREATE TABLE IF NOT EXISTS crm_energivori (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  vat              TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  province         TEXT NOT NULL DEFAULT '',     -- sigla
  region           TEXT NOT NULL DEFAULT '',
  sector           TEXT NOT NULL DEFAULT '',     -- settore o ATECO come scritto nel file
  consumption_gwh  NUMERIC,                      -- consumo di energia elettrica l'anno (GWh)
  roof_m2          NUMERIC,                      -- tetto libero (m²)
  source           TEXT NOT NULL DEFAULT '',     -- nome del file caricato
  subject_id       INTEGER REFERENCES crm_subjects(id) ON DELETE SET NULL,
  signal_id        INTEGER REFERENCES crm_signals(id) ON DELETE SET NULL,
  imported_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_energivori_vat ON crm_energivori (vat) WHERE vat <> '';
CREATE UNIQUE INDEX IF NOT EXISTS crm_energivori_name ON crm_energivori (lower(name), city) WHERE vat = '';
