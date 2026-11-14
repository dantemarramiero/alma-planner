-- Lavoro commerciale del CRM (Dante 14/11/2026, doc «Approccio commerciale Almacis», canvas «Lavoro commerciale»):
-- prossimi passi (più d'uno per azienda, con owner e data; il primo aperto resta in crm_subjects.next_step per le liste),
-- key account con il ritmo di contatto, impostazioni del lavoro commerciale modificabili dall'app.

CREATE TABLE crm_steps (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES crm_subjects(id) ON DELETE CASCADE,
  contact_id  INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT '',            -- telefonata, email, incontro, sopralluogo, altro
  due_date    DATE NOT NULL,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  draft       TEXT NOT NULL DEFAULT '',            -- bozza del messaggio (dai piani d'azione)
  plan_id     INTEGER,                             -- piano d'azione da cui viene (radar, in arrivo)
  sort        INTEGER NOT NULL DEFAULT 0,
  done_at     TIMESTAMPTZ,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome     TEXT NOT NULL DEFAULT '',
  alerted_at  TIMESTAMPTZ,                         -- avviso «scaduto» già mandato
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_steps_subject ON crm_steps (subject_id);
CREATE INDEX crm_steps_open ON crm_steps (owner_id, due_date) WHERE done_at IS NULL;

ALTER TABLE crm_subjects ADD COLUMN key_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_subjects ADD COLUMN key_rhythm_days INTEGER;   -- vuoto = quello delle impostazioni

CREATE TABLE crm_settings (
  key         TEXT PRIMARY KEY,                    -- radar, scoring, profiles, sources, playbooks, rules
  value       JSONB NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- i prossimi passi scritti finora diventano il primo passo della loro azienda
INSERT INTO crm_steps (subject_id, title, due_date, owner_id, created_by)
SELECT id, next_step, next_step_date, owner_id, owner_id FROM crm_subjects
 WHERE next_step <> '' AND next_step_date IS NOT NULL AND merged_into IS NULL;
