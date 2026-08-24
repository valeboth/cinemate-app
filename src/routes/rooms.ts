import { Hono } from "hono";
import type { Env } from "../types";
import { genId } from "../lib/ids";
import { uniqueJoinCode, userExists } from "../lib/db";
import { mapRoom } from "../lib/mappers";
import { getOrCreateDeck, getCardFromDeck, resetDeck, buildMatchReason } from "../lib/deck";
import { getWatchProviders, getImdbId } from "../services/tmdb";
import { getOmdbRatings } from "../services/omdb";

export const rooms = new Hono<{ Bindings: Env }>();

// POST /api/rooms — create a room + invite code. The user becomes user_a.
// Body: { user_id, media_type?='movie', platform_filter?, solo?=false }
rooms.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  if (!userId) return c.json({ error: "user_id_required" }, 400);

  const mediaType = body?.media_type ?? "movie";
  if (mediaType !== "movie" && mediaType !== "tv") {
    return c.json({ error: "media_type_invalid" }, 400);
  }
  const platform = typeof body?.platform_filter === "string" ? body.platform_filter : null;
  const solo = body?.solo === true;

  if (!(await userExists(c.env.DB, userId))) {
    return c.json({ error: "user_not_found" }, 404);
  }

  const id = genId();
  const joinCode = await uniqueJoinCode(c.env.DB);
  // Solo = no user_b, active immediately. Otherwise wait for the second user.
  const status = solo ? "active" : "waiting";

  const row = await c.env.DB.prepare(
    `INSERT INTO rooms (id, join_code, user_a_id, user_b_id, platform_filter, media_type, status)
     VALUES (?, ?, ?, NULL, ?, ?, ?)
     RETURNING *`,
  )
    .bind(id, joinCode, userId, platform, mediaType, status)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: "insert_failed" }, 500);
  return c.json(mapRoom(row), 201);
});

// POST /api/rooms/join — second user joins with the code → becomes user_b, room active.
// Body: { user_id, join_code }
rooms.post("/join", async (c) => {
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const joinCode = typeof body?.join_code === "string" ? body.join_code.trim().toUpperCase() : "";
  if (!userId || !joinCode) {
    return c.json({ error: "user_id_and_join_code_required" }, 400);
  }

  if (!(await userExists(c.env.DB, userId))) {
    return c.json({ error: "user_not_found" }, 404);
  }

  const existing = await c.env.DB.prepare("SELECT * FROM rooms WHERE join_code = ?")
    .bind(joinCode)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: "room_not_found" }, 404);

  const room = mapRoom(existing);
  if (room.status === "closed") return c.json({ error: "room_closed" }, 409);
  // The creator "joins" their own room → just return the room.
  if (room.user_a_id === userId) return c.json(room, 200);
  // Room already full with another user.
  if (room.user_b_id && room.user_b_id !== userId) {
    return c.json({ error: "room_full" }, 409);
  }

  const updated = await c.env.DB.prepare(
    "UPDATE rooms SET user_b_id = ?, status = 'active' WHERE id = ? RETURNING *",
  )
    .bind(userId, room.id)
    .first<Record<string, unknown>>();
  if (!updated) return c.json({ error: "update_failed" }, 500);
  return c.json(mapRoom(updated), 200);
});

// GET /api/rooms/:id — read room state.
rooms.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  return c.json(mapRoom(row), 200);
});

// GET /api/rooms/:id/deck?user_id=... — shared pool from TMDb (generated once).
// The stored pool never changes (both users draw from the same pool). When user_id
// is given, already-swiped titles are excluded from what THIS user is served.
rooms.get("/:id/deck", async (c) => {
  const id = c.req.param("id");
  const userId = c.req.query("user_id");
  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);

  const room = mapRoom(row);
  // AUTH GATING (when a user is provided): must belong to the room.
  if (userId && userId !== room.user_a_id && userId !== room.user_b_id) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const deck = await getOrCreateDeck(c.env, room);
    let cards = deck.cards;
    if (userId) {
      const { results } = await c.env.DB.prepare(
        "SELECT tmdb_id FROM swipes WHERE room_id = ? AND user_id = ?",
      )
        .bind(id, userId)
        .all<{ tmdb_id: number }>();
      const seen = new Set((results ?? []).map((r) => r.tmdb_id));
      cards = cards.filter((card) => !seen.has(card.tmdb_id));
    }
    return c.json({ ...deck, cards }, 200);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ error: "deck_generation_failed", detail }, 502);
  }
});

// GET /api/rooms/:id/rating/:tmdbId — OMDb ratings (IMDb/RT/Metacritic). Best-effort.
rooms.get("/:id/rating/:tmdbId", async (c) => {
  const id = c.req.param("id");
  const tmdbId = Number(c.req.param("tmdbId"));
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return c.json({ error: "tmdb_id_invalid" }, 400);

  const row = await c.env.DB.prepare("SELECT media_type FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  const mediaType = String(row.media_type) === "tv" ? "tv" : "movie";

  const imdbId = await getImdbId(c.env, mediaType, tmdbId);
  const ratings = imdbId
    ? await getOmdbRatings(c.env, imdbId)
    : { imdb_rating: null, imdb_votes: null, rotten_tomatoes: null, metacritic: null };
  return c.json({ tmdb_id: tmdbId, imdb_id: imdbId, ratings }, 200);
});

// POST /api/rooms/:id/swipe — record a swipe + detect a match (D1) + broadcast (DO).
// Body: { user_id, tmdb_id, direction: 'like'|'dislike' }
rooms.post("/:id/swipe", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const tmdbId = Number(body?.tmdb_id);
  const direction = body?.direction;

  if (!userId) return c.json({ error: "user_id_required" }, 400);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return c.json({ error: "tmdb_id_invalid" }, 400);
  if (direction !== "like" && direction !== "dislike") {
    return c.json({ error: "direction_invalid" }, 400);
  }

  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  const room = mapRoom(row);

  // AUTH GATING (HARD): the user must belong to the room.
  if (userId !== room.user_a_id && userId !== room.user_b_id) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (room.status === "closed") return c.json({ error: "room_closed" }, 409);

  // Persist the swipe (idempotent: re-swiping a title updates the direction).
  await c.env.DB.prepare(
    `INSERT INTO swipes (room_id, user_id, tmdb_id, media_type, direction)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id, user_id, tmdb_id) DO UPDATE SET
       direction = excluded.direction, created_at = datetime('now')`,
  )
    .bind(room.id, userId, tmdbId, room.media_type, direction)
    .run();

  let matched = false;
  let isNewMatch = false;
  let matchReason: string | null = null;

  if (direction === "like") {
    const isSolo = room.user_b_id === null;
    // Solo → any like is a match. Pair → match if the other user also liked it.
    let bothLiked = isSolo;
    if (!isSolo) {
      const other = await c.env.DB.prepare(
        `SELECT 1 AS ok FROM swipes
         WHERE room_id = ? AND tmdb_id = ? AND direction = 'like' AND user_id <> ?
         LIMIT 1`,
      )
        .bind(room.id, tmdbId, userId)
        .first();
      bothLiked = other != null;
    }

    if (bothLiked) {
      matched = true;
      const res = await c.env.DB.prepare(
        `INSERT INTO matches (room_id, tmdb_id, media_type) VALUES (?, ?, ?)
         ON CONFLICT(room_id, tmdb_id) DO NOTHING`,
      )
        .bind(room.id, tmdbId, room.media_type)
        .run();
      isNewMatch = (res.meta.changes ?? 0) > 0;

      // Broadcast live to WS clients ONLY on a new match.
      if (isNewMatch) {
        const card = await getCardFromDeck(c.env, room.id, tmdbId);
        matchReason = await buildMatchReason(c.env, room, card);
        const event = JSON.stringify({
          type: "match",
          tmdb_id: tmdbId,
          media_type: room.media_type,
          card,
          reason: matchReason,
        });
        const stub = c.env.ROOM.get(c.env.ROOM.idFromName(room.id));
        try {
          await stub.fetch(new Request("https://do/broadcast", { method: "POST", body: event }));
        } catch {
          // broadcast is best-effort; the match is already persisted in D1
        }
      }
    }
  }

  return c.json(
    { ok: true, matched, is_new_match: isNewMatch, tmdb_id: tmdbId, direction, match_reason: matchReason },
    200,
  );
});

// GET /api/rooms/:id/matches — list of matches (with card from cache when available).
rooms.get("/:id/matches", async (c) => {
  const id = c.req.param("id");
  const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(id).first();
  if (!room) return c.json({ error: "room_not_found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT tmdb_id, media_type, matched_at FROM matches WHERE room_id = ? ORDER BY matched_at DESC",
  )
    .bind(id)
    .all<{ tmdb_id: number; media_type: string; matched_at: string }>();

  const matches = await Promise.all(
    (results ?? []).map(async (m) => ({
      tmdb_id: m.tmdb_id,
      media_type: m.media_type,
      matched_at: m.matched_at,
      card: await getCardFromDeck(c.env, id, m.tmdb_id),
    })),
  );

  return c.json({ room_id: id, matches }, 200);
});

// GET /api/rooms/:id/ws — live WebSocket connection (forwarded to the Durable Object).
rooms.get("/:id/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "expected_websocket_upgrade" }, 426);
  }
  const id = c.req.param("id");
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(id));
  return stub.fetch(c.req.raw);
});

// PATCH /api/rooms/:id — live movie/tv toggle: change media_type + reset the pool.
// Body: { user_id, media_type }
rooms.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const mediaType = body?.media_type;
  if (!userId) return c.json({ error: "user_id_required" }, 400);
  if (mediaType !== "movie" && mediaType !== "tv") {
    return c.json({ error: "media_type_invalid" }, 400);
  }

  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  const room = mapRoom(row);

  // AUTH GATING: only room members can change the type.
  if (userId !== room.user_a_id && userId !== room.user_b_id) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (room.media_type === mediaType) {
    return c.json(room, 200); // no-op
  }

  await c.env.DB.prepare("UPDATE rooms SET media_type = ? WHERE id = ?")
    .bind(mediaType, room.id)
    .run();
  await resetDeck(c.env, room.id); // pool regenerates on the next /deck

  // Notify the other client live to reload the deck.
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(room.id));
  try {
    await stub.fetch(
      new Request("https://do/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "deck_reset", media_type: mediaType }),
      }),
    );
  } catch {
    // best-effort
  }

  return c.json({ ...room, media_type: mediaType, deck: [] }, 200);
});

// GET /api/rooms/:id/providers/:tmdbId — where a title can be watched (RO).
rooms.get("/:id/providers/:tmdbId", async (c) => {
  const id = c.req.param("id");
  const tmdbId = Number(c.req.param("tmdbId"));
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return c.json({ error: "tmdb_id_invalid" }, 400);

  const row = await c.env.DB.prepare("SELECT media_type FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  const mediaType = String(row.media_type) === "tv" ? "tv" : "movie";

  try {
    const providers = await getWatchProviders(c.env, mediaType, tmdbId);
    return c.json({ tmdb_id: tmdbId, media_type: mediaType, providers }, 200);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ error: "providers_fetch_failed", detail }, 502);
  }
});
