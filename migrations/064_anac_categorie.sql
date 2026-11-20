-- ANAC (20/11/2026, «Mappa del mercato» di Nuovi business): per ogni mese caricato, con quali categorie SOA.
-- Se compare una categoria nuova (profilo BU, categorie in più o iniziativa aperta) i mesi della finestra si ricaricano.
-- NULL = mese caricato prima di questa colonna: vale per le categorie dei profili BU e quelle in più di allora.
ALTER TABLE crm_anac_imports ADD COLUMN cats TEXT[];
