-- Offerenti contati dai partecipanti (ALM2-49, 21/11/2026): se la stazione appaltante non dichiara quanti hanno fatto
-- offerta, si contano i partecipanti di crm_anac_bidders (un'ATI vale una: la mandataria, non le mandanti).
ALTER TABLE crm_anac_awards ADD COLUMN bidders_counted BOOLEAN NOT NULL DEFAULT false;
