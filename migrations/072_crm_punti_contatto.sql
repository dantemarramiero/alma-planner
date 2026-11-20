-- Punti di contatto (canvas v9 «Collegamenti e punti di contatto», Dante 19/11/2026): i segnali «Non c'entra» non si
-- ripropongono per quella gara, opportunità o progetto. target = 'signal:12' | 'project:3' | 'subject:5'.
CREATE TABLE crm_touch_dismissed (
  target      TEXT NOT NULL,
  key         TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target, key)
);
