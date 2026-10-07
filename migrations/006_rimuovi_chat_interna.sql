-- La chat interna dell'intranet (004) è sostituita dalle chat di Microsoft Teams: via messaggi, membri e conversazioni.
-- Le foto mandate solo in chat restano senza riferimenti e le cancella la pulizia periodica (lib/media.js).

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
ALTER TABLE media DROP COLUMN IF EXISTS conversation_id;
DROP TABLE IF EXISTS conversations;
