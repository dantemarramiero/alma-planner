-- Alma Planet: la nuova pagina di benvenuto (proposta E).
-- Compleanni e anniversari: la data di nascita la mette la persona (si mostrano solo giorno e mese), la data di
-- assunzione un amministratore. «Grazie a…»: un post di ringraziamento verso un collega, legato a un pillar.
-- Eventi aziendali e sondaggi: li pubblicano gli amministratori. L'organigramma è un PDF (media + impostazione).

ALTER TABLE users ADD COLUMN birthday DATE;
ALTER TABLE users ADD COLUMN hired_on DATE;

ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'grazie'));
ALTER TABLE posts ADD COLUMN thanked_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN pillar TEXT NOT NULL DEFAULT '';
CREATE INDEX posts_kind_idx ON posts(kind, id DESC);

CREATE TABLE company_events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  starts_on   DATE NOT NULL,
  place       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_events_day_idx ON company_events(starts_on);

CREATE TABLE polls (
  id          SERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,              -- ["Pescara", "In collina", …], da 2 a 6
  closes_on   DATE,
  closed_at   TIMESTAMPTZ,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE poll_votes (
  poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice      INTEGER NOT NULL CHECK (choice BETWEEN 0 AND 5),
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);
