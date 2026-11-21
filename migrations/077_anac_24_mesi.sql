-- Concorrenza: 24 mesi di gare ANAC invece di 12 (Dante 21/11/2026, con lo storico dal file unico di ANAC)
UPDATE crm_settings SET value = jsonb_set(value, '{months}', '24') WHERE key = 'concorrenza';
