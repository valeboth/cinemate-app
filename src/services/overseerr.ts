// Overseerr integration — enrichment only, best-effort.
//  - exclude titles already requested/available in Overseerr from the deck
//  - create a request on match ("Add to Overseerr")
// URL + API key come ONLY from env (secrets); if unset, the feature is inert.

import type { Env, MediaType } from "../types";

const REQUESTED_CACHE_KEY = "overseerr:requested";
const REQUESTED_TTL = 60 * 60; // 1h — a newly requested title drops out within the hour
const MEDIA_PAGES = 5; // up to 5 × 100 = 500 titles scanned

export function overseerrConfigured(env: Env): boolean {
  return !!(env.OVERSEERR_URL && env.OVERSEERR_API_KEY);
}

function baseUrl(env: Env): string {
  return env.OVERSEERR_URL.replace(/\/+$/, ""); // trim trailing slash
}

// Overseerr API key + (optional) Cloudflare Access service token headers.
function authHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "X-Api-Key": env.OVERSEERR_API_KEY,
    accept: "application/json",
    ...extra,
  };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    h["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    h["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  return h;
}

interface OverseerrMediaItem {
  tmdbId?: number;
  status?: number; // 2 pending, 3 processing, 4 partially available, 5 available
}
interface OverseerrMediaResponse {
  results?: OverseerrMediaItem[];
}

/**
 * Set of tmdbIds already in the Overseerr pipeline (pending/processing/available).
 * Cached in KV. Best-effort: returns an empty set on any issue.
 */
export async function getRequestedTmdbIds(env: Env): Promise<Set<number>> {
  if (!overseerrConfigured(env)) return new Set();

  const cached = await env.TMDB_CACHE.get(REQUESTED_CACHE_KEY);
  if (cached) return new Set(JSON.parse(cached) as number[]);

  const ids = new Set<number>();
  try {
    for (let page = 1; page <= MEDIA_PAGES; page++) {
      const url = `${baseUrl(env)}/api/v1/media?take=100&skip=${(page - 1) * 100}&filter=allavailable`;
      const res = await fetch(url, { headers: authHeaders(env) });
      if (!res.ok) break;
      const data = (await res.json()) as OverseerrMediaResponse;
      const results = data.results ?? [];
      for (const m of results) {
        if (typeof m.tmdbId === "number" && (m.status ?? 0) >= 2) ids.add(m.tmdbId);
      }
      if (results.length < 100) break;
    }
    await env.TMDB_CACHE.put(REQUESTED_CACHE_KEY, JSON.stringify([...ids]), {
      expirationTtl: REQUESTED_TTL,
    });
  } catch {
    // best-effort
  }
  return ids;
}

export interface RequestResult {
  ok: boolean;
  error?: string;
}

/** Create an Overseerr request for a title. Best-effort. */
export async function createRequest(
  env: Env,
  mediaType: MediaType,
  tmdbId: number,
): Promise<RequestResult> {
  if (!overseerrConfigured(env)) return { ok: false, error: "not_configured" };
  try {
    const body: Record<string, unknown> = { mediaType, mediaId: tmdbId };
    if (mediaType === "tv") body.seasons = "all";
    const res = await fetch(`${baseUrl(env)}/api/v1/request`, {
      method: "POST",
      headers: authHeaders(env, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `overseerr_${res.status}: ${text.slice(0, 120)}` };
    }
    // Invalidate the requested-set cache so it disappears from decks quickly.
    await env.TMDB_CACHE.delete(REQUESTED_CACHE_KEY);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request_failed" };
  }
}
