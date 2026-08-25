import { Hono } from "hono";
import type { Env } from "../types";
import { searchTitles } from "../services/tmdb";

export const search = new Hono<{ Bindings: Env }>();

// GET /api/search?q=...&media_type=movie|tv — autocomplete hits (KV-cached via tmdbFetch).
search.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  const mt = c.req.query("media_type");
  const mediaType = mt === "movie" ? "movie" : mt === "tv" ? "tv" : undefined;
  try {
    const results = await searchTitles(c.env, q, mediaType);
    return c.json({ results }, 200);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ error: "search_failed", detail }, 502);
  }
});
