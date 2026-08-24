import { Hono } from "hono";
import type { Env } from "../types";
import { userExists } from "../lib/db";
import { mapProfile } from "../lib/mappers";

export const profile = new Hono<{ Bindings: Env }>();

// POST /api/profile/quiz — salvează (upsert) profilul simplu de gusturi.
// Body: { user_id, genre_scores?, era_pref?, mood_pref?, media_type_pref? }
// TODO(V2): quiz real cu scoring propriu-zis (înlocuiește profilul default).
profile.post("/quiz", async (c) => {
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  if (!userId) return c.json({ error: "user_id_required" }, 400);

  const mediaPref = body?.media_type_pref ?? null;
  if (mediaPref !== null && mediaPref !== "movie" && mediaPref !== "tv") {
    return c.json({ error: "media_type_pref_invalid" }, 400);
  }

  const genreScores =
    body?.genre_scores && typeof body.genre_scores === "object" && !Array.isArray(body.genre_scores)
      ? JSON.stringify(body.genre_scores)
      : "{}";
  const eraPref = typeof body?.era_pref === "string" ? body.era_pref : null;
  const moodPref = typeof body?.mood_pref === "string" ? body.mood_pref : null;

  if (!(await userExists(c.env.DB, userId))) {
    return c.json({ error: "user_not_found" }, 404);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO profiles (user_id, genre_scores, era_pref, mood_pref, media_type_pref)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       genre_scores    = excluded.genre_scores,
       era_pref        = excluded.era_pref,
       mood_pref       = excluded.mood_pref,
       media_type_pref = excluded.media_type_pref
     RETURNING *`,
  )
    .bind(userId, genreScores, eraPref, moodPref, mediaPref)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: "upsert_failed" }, 500);
  return c.json(mapProfile(row), 200);
});

// GET /api/profile/:userId — citește profilul (util la testare / onboarding).
profile.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const row = await c.env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "profile_not_found" }, 404);
  return c.json(mapProfile(row), 200);
});
