import { Hono } from "hono";
import type { Env } from "../types";
import { genId } from "../lib/ids";

export const users = new Hono<{ Bindings: Env }>();

// POST /api/users — creează user.
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
