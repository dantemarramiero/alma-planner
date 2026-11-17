-- Alma, l'assistente di Alma Planet (porting di «Bacco», l'assistente della cantina, 17/11/2026).
-- Conversazioni di ognuno (le vede solo chi le ha fatte), messaggi così come vanno a Claude (content) e come si
-- mostrano (display, meta), proposte da confermare, uso e costo per giorno e modello, una traccia per ogni risposta
-- (con 👍/👎) e le regole che la direzione aggiunge alle istruzioni di Alma.

CREATE TABLE assistant_conversations (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user ON assistant_conversations (user_id, updated_at DESC);

-- content: i blocchi del messaggio come li legge Claude (testo, tool_use, tool_result…); display: il testo da
-- mostrare (NULL = messaggio interno, es. i risultati delle ricerche); meta: passi, ricevute, blocchi, proposte, traccia.
CREATE TABLE assistant_messages (
  id               SERIAL PRIMARY KEY,
  conversation_id  INT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          JSONB NOT NULL,
  display          TEXT,
  meta             JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_conv ON assistant_messages (conversation_id, id);

-- Proposte (ticket, nota CRM, passo, contatto): niente si salva finché chi chiede non preme Conferma.
-- status: proposta · fatta · annullata · superata · errore; undone_at = tolta con «Annulla» entro 10 minuti.
CREATE TABLE assistant_actions (
  id               SERIAL PRIMARY KEY,
  conversation_id  INT REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  input            JSONB NOT NULL DEFAULT '{}',
  request          JSONB,
  preview          JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'proposta',
  result           JSONB,
  error            TEXT,
  batch_id         INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at          TIMESTAMPTZ,
  undone_at        TIMESTAMPTZ,
  undo_error       TEXT
);
CREATE INDEX assistant_actions_conv ON assistant_actions (conversation_id, status);

-- Uso: una riga per ogni chiamata a Claude (anche il classificatore), con il costo stimato in dollari.
CREATE TABLE assistant_usage (
  id               SERIAL PRIMARY KEY,
  user_id          INT REFERENCES users(id) ON DELETE SET NULL,
  conversation_id  INT,
  model            TEXT NOT NULL,
  input_tokens     INT NOT NULL DEFAULT 0,
  output_tokens    INT NOT NULL DEFAULT 0,
  cache_read       INT NOT NULL DEFAULT 0,
  cache_write      INT NOT NULL DEFAULT 0,
  cost_usd         DOUBLE PRECISION NOT NULL DEFAULT 0,
  day              DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_usage_day ON assistant_usage (day, user_id);

-- Tracce: una per risposta (modelli, passi, ricerche, token, costo, tempo, numeri controllati) e il voto di chi l'ha
-- ricevuta. Restano anche se la conversazione si cancella (per le statistiche), senza il collegamento.
CREATE TABLE assistant_traces (
  id                  SERIAL PRIMARY KEY,
  conversation_id     INT REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  user_id             INT REFERENCES users(id) ON DELETE SET NULL,
  message_id          INT,
  question            TEXT NOT NULL DEFAULT '',
  model               TEXT,
  models              JSONB NOT NULL DEFAULT '[]',
  steps               JSONB NOT NULL DEFAULT '[]',
  steps_count         INT NOT NULL DEFAULT 0,
  tool_count          INT NOT NULL DEFAULT 0,
  tool_errors         INT NOT NULL DEFAULT 0,
  input_tokens        INT NOT NULL DEFAULT 0,
  output_tokens       INT NOT NULL DEFAULT 0,
  cache_read          INT NOT NULL DEFAULT 0,
  cache_write         INT NOT NULL DEFAULT 0,
  cost_usd            DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms          INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'ok',
  error               TEXT,
  numbers_checked     INT NOT NULL DEFAULT 0,
  numbers_unverified  INT NOT NULL DEFAULT 0,
  unverified_numbers  JSONB,
  rating              SMALLINT,
  rating_comment      TEXT,
  rated_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_traces_created ON assistant_traces (created_at DESC);

-- Regole: frasi che Alma segue sempre («le ore sono in giorni da 8 ore»), per tutti.
CREATE TABLE assistant_rules (
  id          SERIAL PRIMARY KEY,
  text        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
