import { Hono } from "hono";
import type { Env } from "./types";
import { users } from "./routes/users";
import { profile } from "./routes/profile";
import { rooms } from "./routes/rooms";

// Durable Object — live per-room state (WebSocket + match broadcast).
export { Room } from "./durable-objects/room";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "cinemate", version: "v2.6" }));

app.route("/api/users", users);
app.route("/api/profile", profile);
app.route("/api/rooms", rooms);

// Invite link path: serve the SPA shell so ?code= is picked up by the frontend.
app.get("/join", (c) => c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url))));

// TODO(V3): Letterboxd CSV import, Plex check, auto-queue Radarr/Sonarr, group mode.

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
