-- Alma, modalità voce in tempo reale (18/11/2026, canvas «v5 · Alma da ogni pagina, telefono e voce»; porting di Bacco
-- CAN-176/202). Una riga per chiamata: il tempo lo misura il server (started_at, battiti in last_seen_at, ended_at) e il
-- costo va in assistant_usage una volta sola alla chiusura. Le frasi trascritte servono a controllare il «sì» delle
-- conferme a voce; pending tiene numeri e proposte della risposta in corso, fonti le ricerche fatte a voce.

CREATE TABLE assistant_voice_sessions (
  id               SERIAL PRIMARY KEY,
  conversation_id  INT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model            TEXT NOT NULL,
  call_id          TEXT,
  max_seconds      INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT,
  seconds          NUMERIC,
  cost_usd         NUMERIC,
  pending          JSONB,
  fonti            JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX assistant_voice_sessions_open ON assistant_voice_sessions (ended_at) WHERE ended_at IS NULL;
CREATE INDEX assistant_voice_sessions_conv ON assistant_voice_sessions (conversation_id, id DESC);

CREATE TABLE assistant_voice_lines (
  id               SERIAL PRIMARY KEY,
  session_id       INT NOT NULL REFERENCES assistant_voice_sessions(id) ON DELETE CASCADE,
  conversation_id  INT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX assistant_voice_lines_session ON assistant_voice_lines (session_id, id);

-- Conferma detta a voce: { via: 'voce', text, at } sulla proposta salvata.
ALTER TABLE assistant_actions ADD COLUMN confirmed_via JSONB;
