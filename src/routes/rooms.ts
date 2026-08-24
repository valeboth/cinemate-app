import { Hono } from "hono";
import type { Env } from "../types";
import { genId } from "../lib/ids";
import { uniqueJoinCode, userExists } from "../lib/db";
import { mapRoom } from "../lib/mappers";
import { getOrCreateDeck } from "../lib/deck";

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

// TODO(Faza 4): POST /api/rooms/:id/swipe, GET /api/rooms/:id/matches, GET /api/rooms/:id/ws.
// TODO(V2): la toggle film/serial, resetează rooms.deck (=[]) ca pool-ul să se regenereze.
