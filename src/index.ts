import { Hono } from "hono";
import type { Env } from "./types";

// Durable Object — stare live per cameră (implementat în Faza 4).
export { Room } from "./durable-objects/room";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "cinemate", phase: 0 }));

// --- Rute implementate în fazele următoare ---
// Faza 2: POST /api/users, POST /api/profile/quiz, POST /api/rooms, POST /api/rooms/join
// Faza 3: GET  /api/rooms/:id/deck
// Faza 4: POST /api/rooms/:id/swipe, GET /api/rooms/:id/matches, GET /api/rooms/:id/ws
// TODO(V2/V3): import CSV Letterboxd, Plex-check, auto-queue Radarr/Sonarr, mod grup.

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
