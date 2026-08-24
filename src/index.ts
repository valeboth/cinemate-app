import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { users } from "./routes/users";
import { profile } from "./routes/profile";
import { rooms } from "./routes/rooms";

// Durable Object — stare live per cameră (implementat în Faza 4).
export { Room } from "./durable-objects/room";

const app = new Hono<{ Bindings: Env }>();

// CORS pentru toate rutele /api/* — frontend-ul (Pages) rulează pe alt origin în dev.
// V1: permisiv. TODO: restrânge originile în prod dacă e nevoie.
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, service: "cinemate", phase: 4 }));

// Rute Faza 2
app.route("/api/users", users);
app.route("/api/profile", profile);
app.route("/api/rooms", rooms);

// TODO(V2/V3): import CSV Letterboxd, Plex-check, auto-queue Radarr/Sonarr, mod grup.

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
