import { Hono } from "hono";
import type { Env, MediaType } from "../types";
import { genId } from "../lib/ids";
import { getTitleCard } from "../services/tmdb";

export const users = new Hono<{ Bindings: Env }>();

// POST /api/users — create a user.
// Body: { username: string }
users.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  if (username.length < 1 || username.length > 40) {
    return c.json({ error: "username_invalid" }, 400);
  }

  const id = genId();
  const row = await c.env.DB.prepare(
    "INSERT INTO users (id, username) VALUES (?, ?) RETURNING id, username, created_at",
  )
    .bind(id, username)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: "insert_failed" }, 500);
  return c.json(row, 201);
});

// GET /api/users/:userId/watchlist — persistent solo watchlist.
// Aggregates matches from the user's solo rooms (user_b_id IS NULL).
users.get("/:userId/watchlist", async (c) => {
  const userId = c.req.param("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT m.tmdb_id, m.media_type, MAX(m.matched_at) AS added_at
     FROM matches m
     JOIN rooms r ON m.room_id = r.id
     WHERE r.user_a_id = ? AND r.user_b_id IS NULL
     GROUP BY m.tmdb_id, m.media_type
     ORDER BY added_at DESC
     LIMIT 100`,
  )
    .bind(userId)
    .all<{ tmdb_id: number; media_type: string; added_at: string }>();

  const watchlist = await Promise.all(
    (results ?? []).map(async (m) => {
      const mediaType: MediaType = m.media_type === "tv" ? "tv" : "movie";
      return {
        tmdb_id: m.tmdb_id,
        media_type: mediaType,
        added_at: m.added_at,
        card: await getTitleCard(c.env, mediaType, m.tmdb_id),
      };
    }),
  );

  return c.json({ user_id: userId, watchlist }, 200);
});
