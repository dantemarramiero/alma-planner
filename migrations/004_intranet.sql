-- Intranet: bacheca con post, commenti e «mi piace», storie di 24 ore, profili, messaggi diretti e notifiche.
-- Le immagini stanno nel database (ridotte dal browser a 1600 px), così valgono uguali in locale e su Railway.

ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';

CREATE TABLE conversations (
  id               SERIAL PRIMARY KEY,
  title            TEXT,                         -- solo per i gruppi
  is_group         BOOLEAN NOT NULL DEFAULT false,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ
);

CREATE TABLE media (
  id               SERIAL PRIMARY KEY,
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime             TEXT NOT NULL,
  data             BYTEA NOT NULL,
  width            INTEGER,
  height           INTEGER,
  conversation_id  INTEGER REFERENCES conversations(id) ON DELETE CASCADE,  -- foto di una chat: la vedono solo i membri
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN avatar_id INTEGER REFERENCES media(id) ON DELETE SET NULL;

CREATE TABLE posts (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  pinned_at   TIMESTAMPTZ,                       -- post in evidenza, in cima alla bacheca
  pinned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX posts_author_idx ON posts(author_id, id DESC);

CREATE TABLE post_media (
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id  INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (post_id, position)
);
CREATE INDEX post_media_media_idx ON post_media(media_id);

CREATE TABLE post_likes (
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Le risposte hanno un solo livello, come su Instagram: parent_id è sempre un commento principale.
CREATE TABLE post_comments (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_id   INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_post_idx ON post_comments(post_id, id);

CREATE TABLE comment_likes (
  comment_id  INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE stories (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  caption     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX stories_expires_idx ON stories(expires_at);

CREATE TABLE story_views (
  story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE conversation_members (
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id     INTEGER NOT NULL DEFAULT 0,  -- ultimo messaggio letto: dà i non letti e il «Visto»
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members(user_id);

CREATE TABLE messages (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL DEFAULT '',
  media_id         INTEGER REFERENCES media(id) ON DELETE SET NULL,
  post_id          INTEGER REFERENCES posts(id) ON DELETE SET NULL,   -- post della bacheca condiviso in chat
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, id DESC);

CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- chi la riceve
  actor_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,            -- chi l'ha causata
  kind        TEXT NOT NULL CHECK (kind IN ('like', 'comment', 'reply', 'mention', 'comment_like', 'pin')),
  post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id  INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, id DESC);
