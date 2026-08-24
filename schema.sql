-- Cinemate — schema D1 (SQLite)
-- Aplică cu:  npx wrangler d1 execute cinemate-db --local --file=schema.sql
--        sau: npx wrangler d1 execute cinemate-db --remote --file=schema.sql
--
-- Idempotent: folosește IF NOT EXISTS, deci se poate rula de mai multe ori
-- fără să piardă date. (Pentru schimbări de schemă în viitor adăugăm fișiere
-- de migrare separate.)

PRAGMA foreign_keys = ON;

-- ── users ───────────────────────────────────────────────────────────────────
-- id: UUID generat în Worker (crypto.randomUUID()).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── profiles ─────────────────────────────────────────────────────────────────
-- Profil de gusturi (1:1 cu users).
-- genre_scores: JSON, ex. {"28": 0.8, "35": 0.6} (genreId -> scor 0..1).
-- media_type_pref: 'movie' | 'tv' | NULL.
CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY,
  genre_scores    TEXT NOT NULL DEFAULT '{}',
  era_pref        TEXT,
  mood_pref       TEXT,
  media_type_pref TEXT CHECK (media_type_pref IN ('movie', 'tv')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ── rooms ────────────────────────────────────────────────────────────────────
-- user_b_id NULL  => cameră solo.
-- deck: JSON cu pool-ul comun de tmdb_id (generat O SINGURĂ DATĂ per cameră).
--       Ambii useri trag din același pool => garantează suprapunerea pt. match.
-- media_type: tipul curent al camerei ('movie' | 'tv') — toggle-ul îl schimbă.
-- status: 'waiting' (creată, așteaptă user_b) | 'active' | 'closed'.
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

-- ── swipes ───────────────────────────────────────────────────────────────────
-- Un user nu poate face swipe de două ori pe același titlu în aceeași cameră
-- => cheie primară compusă (idempotență la re-swipe).
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

-- ── matches ──────────────────────────────────────────────────────────────────
-- Un titlu poate fi match o singură dată per cameră.
CREATE TABLE IF NOT EXISTS matches (
  room_id    TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  matched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, tmdb_id),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

-- ── indexuri ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_swipes_room       ON swipes (room_id);
CREATE INDEX IF NOT EXISTS idx_swipes_room_user  ON swipes (room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_matches_room      ON matches (room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_user_a      ON rooms (user_a_id);
CREATE INDEX IF NOT EXISTS idx_rooms_user_b      ON rooms (user_b_id);
