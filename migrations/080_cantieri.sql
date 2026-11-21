-- Storie dai cantieri (Dante 21/11/2026, canvas app 3.0 righe C1–C5; BOSS: BSAL-1725).
-- I cantieri sono le commesse di BOSS: qui una copia in sola lettura (source 'boss'); finché BOSS non la manda,
-- la direzione li inserisce a mano (source 'manuale') e alla prima sincronizzazione si uniscono per codice.
CREATE TABLE cantieri (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,                 -- codice commessa BOSS
  name          TEXT NOT NULL,
  client        TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  chief_email   TEXT NOT NULL DEFAULT '',             -- capo cantiere (può nascondere le foto)
  member_emails TEXT[] NOT NULL DEFAULT '{}',         -- chi ci lavora: il telefono propone prima i suoi cantieri
  status        TEXT NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto', 'chiuso')),
  starts_on     DATE,
  ends_on       DATE,
  source        TEXT NOT NULL DEFAULT 'manuale' CHECK (source IN ('boss', 'manuale')),
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- una riga per foto: resta per sempre (il diario); la storia è solo la vista delle ultime 24 ore
CREATE TABLE cantiere_foto (
  id           SERIAL PRIMARY KEY,
  cantiere_id  INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  media_id     INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  caption      TEXT NOT NULL DEFAULT '',
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  day          DATE NOT NULL,                          -- giorno in Italia, per il diario e il post del giorno
  post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  hidden_at    TIMESTAMPTZ,
  hidden_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cantiere_foto_diario_idx ON cantiere_foto(cantiere_id, day DESC, id DESC);
CREATE INDEX cantiere_foto_recenti_idx ON cantiere_foto(created_at DESC);

-- «Dai cantieri»: un post al giorno per cantiere, con tutte le foto del giorno
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_kind_check;
ALTER TABLE posts ADD CONSTRAINT posts_kind_check CHECK (kind IN ('post', 'grazie', 'cantiere'));
ALTER TABLE posts ADD COLUMN cantiere_id INTEGER REFERENCES cantieri(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN cantiere_day DATE;
CREATE UNIQUE INDEX posts_cantiere_giorno_idx ON posts(cantiere_id, cantiere_day) WHERE cantiere_id IS NOT NULL;
