-- Nuovi business · Mappa del mercato (Dante 20/11/2026, canvas «Nuovi business · Mappa del mercato»):
-- «Avvisami quando è pronto» quando le categorie SOA di un'iniziativa non sono ancora tra le gare ANAC caricate.
CREATE TABLE crm_initiative_market_watch (
  initiative_id  INTEGER NOT NULL REFERENCES crm_initiatives(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categories     TEXT[] NOT NULL DEFAULT '{}',      -- categorie che mancavano quando l'ha chiesto
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at    TIMESTAMPTZ,
  PRIMARY KEY (initiative_id, user_id)
);
