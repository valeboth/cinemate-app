// Minimal fixed-window rate limiter backed by KV. Best-effort (fails open on KV errors),
// good enough to stop casual spam of the public write endpoints (create user / room).
// For serious abuse, Cloudflare WAF rate-limiting rules are the proper tool.

import type { Env } from "../types";

/** Returns true if the action is allowed, false if over the limit for this window. */
export async function rateLimit(
  env: Env,
  id: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${id}:${bucket}`;
  try {
    const current = await env.TMDB_CACHE.get(key);
    const count = current ? Number(current) : 0;
    if (count >= limit) return false; // over limit → no write, so writes stay bounded
    await env.TMDB_CACHE.put(key, String(count + 1), { expirationTtl: windowSec * 2 });
    return true;
  } catch {
    return true; // fail open — never block real users on a KV hiccup
  }
}

/** Client IP (Cloudflare-provided), for keying the limiter. */
export function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") || "anon";
}
