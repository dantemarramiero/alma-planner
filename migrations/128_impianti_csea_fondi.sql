-- Alma Impianti (ALM2-73): elenco ufficiale CSEA delle imprese energivore.
-- Il file CSEA dà P.IVA, ragione sociale e classe di agevolazione (ASOS1/2/3, VALR1/2/3), senza comune né consumi:
-- la classe si tiene per mostrarla e filtrare. Numero 128 concordato con la sessione di Alma Energy (che usa la 125).
ALTER TABLE crm_energivori ADD COLUMN IF NOT EXISTS csea_class TEXT NOT NULL DEFAULT '';
