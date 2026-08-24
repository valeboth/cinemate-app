-- Cinemate — D1 schema (SQLite)
-- Apply with:  npx wrangler d1 execute cinemate-db --local  --file=schema.sql
--         or:  npx wrangler d1 execute cinemate-db --remote --file=schema.sql
-- Idempotent (IF NOT EXISTS), so it can be run multiple times without data loss.

PRAGMA foreign_keys = ON;

-- users — id is a UUID generated in the Worker (crypto.randomUUID()).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- profiles — taste profile (1:1 with users).
-- genre_scores: JSON, e.g. {"28": 0.8, "35": 0.6} (genreId -> score 0..1).
CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY,
  genre_scores    TEXT NOT NULL DEFAULT '{}',
  era_pref        TEXT,
  mood_pref       TEXT,
  media_type_pref TEXT CHECK (media_type_pref IN ('movie', 'tv')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- rooms — user_b_id NULL = solo.
-- deck: JSON with the shared pool of tmdb_id (generated ONCE per room).
CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  join_code       TEXT NOT NULL UNIQUE,
  user_a_id       TEXT NOT NULL,
  user_b_id       TEXT,
  platform_filter TEXT,
  media_type      TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
  deck            TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_a_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users (id) ON DELETE SET NULL
);

-- swipes — composite PK prevents duplicate swipes (idempotent re-swipe).
CREATE TABLE IF NOT EXISTS swipes (
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  direction  TEXT NOT NULL CHECK (direction IN ('like', 'dislike')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id, tmdb_id),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- matches — a title can match only once per room.
CREATE TABLE IF NOT EXISTS matches (
  room_id    TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  matched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, tmdb_id),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_swipes_room       ON swipes (room_id);
CREATE INDEX IF NOT EXISTS idx_swipes_room_user  ON swipes (room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_matches_room      ON matches (room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_user_a      ON rooms (user_a_id);
CREATE INDEX IF NOT EXISTS idx_rooms_user_b      ON rooms (user_b_id);
