-- Firma Almacis nelle email mandate da Alma (ALM2-64, tavola H del canvas «Progetto da email», Dante 22/11/2026).
-- Uguale per tutti (logo, indirizzo, sito: in lib/firma.js), con nome, ruolo e telefono di ognuno. Una riga c'è solo
-- se la persona ha salvato qualcosa: senza riga i dati vengono dal profilo Microsoft e dal biglietto da visita.
CREATE TABLE IF NOT EXISTS user_signatures (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  name        TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  role        TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 120),
  phone       TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  phone2      TEXT NOT NULL DEFAULT '' CHECK (length(phone2) <= 40),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
