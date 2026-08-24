import { Hono } from "hono";
import type { Env } from "../types";
import { genId } from "../lib/ids";
import { uniqueJoinCode, userExists } from "../lib/db";
import { mapRoom } from "../lib/mappers";
import { getOrCreateDeck, getCardFromDeck, resetDeck, buildMatchReason } from "../lib/deck";
import { getWatchProviders } from "../services/tmdb";

export const rooms = new Hono<{ Bindings: Env }>();

// POST /api/rooms — creează cameră + cod de invite. Userul devine user_a.
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
  // Solo = fără user_b, activă imediat. Altfel așteaptă al doilea user.
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

// POST /api/rooms/join — al doilea user intră cu codul → devine user_b, camera active.
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
  // Creatorul „intră" în propria cameră → doar întoarcem camera.
  if (room.user_a_id === userId) return c.json(room, 200);
  // Cameră deja plină cu alt user.
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

// GET /api/rooms/:id — citește starea camerei.
rooms.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);
  return c.json(mapRoom(row), 200);
});

// GET /api/rooms/:id/deck — pool comun din TMDb (generat o singură dată).
rooms.get("/:id/deck", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM rooms WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "room_not_found" }, 404);

  const room = mapRoom(row);
  try {
    const deck = await getOrCreateDeck(c.env, room);
    return c.json(deck, 200);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ error: "deck_generation_failed", detail }, 502);
  }
});

// POST /api/rooms/:id/swipe — înregistrează swipe + detectează match (D1) + broadcast (DO).
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

  // AUTH GATING (HARD): user-ul trebuie să aparțină camerei.
  if (userId !== room.user_a_id && userId !== room.user_b_id) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (room.status === "closed") return c.json({ error: "room_closed" }, 409);

  // Persistă swipe-ul (idempotent: re-swipe pe același titlu actualizează direcția).
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
    // Solo → orice like = match. Pereche → match dacă și celălalt a dat like.
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

      // Broadcast live către clienții WS DOAR la match nou.
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
          await stub.fetch(
            new Request("https://do/broadcast", { method: "POST", body: event }),
          );
        } catch {
          // broadcast best-effort; match-ul e deja persistat în D1
        }
      }
    }
  }

  return c.json(
    { ok: true, matched, is_new_match: isNewMatch, tmdb_id: tmdbId, direction, match_reason: matchReason },
    200,
  );
});

// GET /api/rooms/:id/matches — lista de match-uri (cu card din cache, dacă există).
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

// GET /api/rooms/:id/ws — conexiune WebSocket live (forward către Durable Object).
rooms.get("/:id/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "expected_websocket_upgrade" }, 426);
  }
  const id = c.req.param("id");
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(id));
  return stub.fetch(c.req.raw);
});

// PATCH /api/rooms/:id — toggle film/serial live: schimbă media_type + resetează pool-ul.
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

  // AUTH GATING: doar membrii camerei pot schimba tipul.
  if (userId !== room.user_a_id && userId !== room.user_b_id) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (room.media_type === mediaType) {
    return c.json(room, 200); // no-op
  }

  await c.env.DB.prepare("UPDATE rooms SET media_type = ? WHERE id = ?")
    .bind(mediaType, room.id)
    .run();
  await resetDeck(c.env, room.id); // pool-ul se regenerează la următorul /deck

  // Anunță live celălalt client să reîncarce deck-ul.
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

// GET /api/rooms/:id/providers/:tmdbId — unde poate fi văzut titlul (RO).
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
