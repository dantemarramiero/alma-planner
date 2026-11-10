-- Alma Planet: Laboratorio delle idee e pagina di benvenuto.
-- Ognuno propone innovazioni e miglioramenti; i colleghi le sostengono e le commentano; a fine anno un comitato
-- (scelto dagli amministratori) le vota da 1 a 5 e premia le migliori.

CREATE TABLE ideas (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  year        INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'miglioramento' CHECK (category IN ('innovazione', 'miglioramento', 'processi', 'sicurezza', 'persone', 'sostenibilita')),
  problem     TEXT NOT NULL DEFAULT '',  -- cosa non va oggi
  proposal    TEXT NOT NULL DEFAULT '',  -- cosa propongo
  benefits    TEXT NOT NULL DEFAULT '',  -- cosa ci guadagniamo
  status      TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta', 'in_valutazione', 'premiata', 'realizzata', 'archiviata')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ideas_year ON ideas (year, id DESC);

-- «Sostengo»: il mi piace delle idee.
CREATE TABLE idea_supports (
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);

CREATE TABLE idea_comments (
  id         SERIAL PRIMARY KEY,
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idea_comments_idea ON idea_comments (idea_id, id);

-- Comitato di valutazione (impostato dagli amministratori) e i suoi voti.
CREATE TABLE idea_committee (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idea_votes (
  idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  note       TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);

-- Impostazioni di Alma Planet (votazione aperta, scorciatoie della pagina di benvenuto…): chiave → valore.
CREATE TABLE planet_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
