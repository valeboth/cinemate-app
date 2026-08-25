import { Hono } from "hono";
import type { Env } from "../types";
import { userExists } from "../lib/db";
import { mapProfile } from "../lib/mappers";

export const profile = new Hono<{ Bindings: Env }>();

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((n) => Number.isFinite(n));
}

// POST /api/profile/quiz — upsert the taste profile.
// Body: { user_id, genre_scores?, avoid_genres?: number[] }
// Every field is optional (empty = no filter). Seeds are added in a later step.
profile.post("/quiz", async (c) => {
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  if (!userId) return c.json({ error: "user_id_required" }, 400);

  const genreScores =
    body?.genre_scores && typeof body.genre_scores === "object" && !Array.isArray(body.genre_scores)
      ? JSON.stringify(body.genre_scores)
      : "{}";

  const prefs: Record<string, unknown> = {};
  const avoidGenres = toNumberArray(body?.avoid_genres);
  if (avoidGenres.length) prefs.avoid_genres = avoidGenres;
  // seeds are preserved when present (set by the seeds step).
  if (Array.isArray(body?.seeds)) prefs.seeds = body.seeds;
  const prefsJson = JSON.stringify(prefs);

  if (!(await userExists(c.env.DB, userId))) {
    return c.json({ error: "user_not_found" }, 404);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO profiles (user_id, genre_scores, prefs)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       genre_scores = excluded.genre_scores,
       prefs        = excluded.prefs
     RETURNING *`,
  )
    .bind(userId, genreScores, prefsJson)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: "upsert_failed" }, 500);
  return c.json(mapProfile(row), 200);
});

// GET /api/profile/:userId — read the profile.
profile.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const row = await c.env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "profile_not_found" }, 404);
  return c.json(mapProfile(row), 200);
});
