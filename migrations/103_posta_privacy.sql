-- Privacy della posta nel CRM (ALM2-67, tavole J–M del canvas «Progetto da email», via di Dante 23/11/2026).
-- Le email di una persona le vede l'azienda solo dopo il suo sì: le risposte nuove di una conversazione collegata
-- entrano da sole solo se il proprietario l'ha scelto, altrimenti aspettano in «Da approvare» come le suggerite;
-- «chi di noi conosce queste persone» mostra un collega solo se ha acceso la condivisione.

-- per conversazione: 'approva' = le risposte nuove aspettano il sì del proprietario, 'auto' = entrano da sole.
-- Le conversazioni che ci sono già passano ad 'approva' (scelta P3 di Dante).
ALTER TABLE crm_mail_threads ADD COLUMN IF NOT EXISTS new_mode TEXT NOT NULL DEFAULT 'approva' CHECK (new_mode IN ('approva', 'auto'));

-- nelle email da approvare: 'suggerita' (altra conversazione che parla del progetto) o 'risposta' (della conversazione)
ALTER TABLE crm_mail_suggestions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'suggerita' CHECK (kind IN ('suggerita', 'risposta'));
ALTER TABLE crm_mail_suggestions ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS crm_mail_suggestions_owner ON crm_mail_suggestions (owner_id, status);

-- scelte personali (Il mio profilo › La mia posta nel CRM); senza riga: condivisione spenta, risposte da approvare
CREATE TABLE IF NOT EXISTS user_mail_prefs (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  share_people  BOOLEAN NOT NULL DEFAULT false,
  new_mode      TEXT NOT NULL DEFAULT 'approva' CHECK (new_mode IN ('approva', 'auto')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
