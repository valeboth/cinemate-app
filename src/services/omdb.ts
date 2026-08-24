// OMDb integration — enrichment only (IMDb / Rotten Tomatoes / Metacritic ratings).
// TMDb stays the primary source; OMDb is best-effort: if it fails or is missing,
// the card still works without a rating. Responses are cached in KV (free tier = 1000/day).
// The key comes ONLY from env (secret), never from code or the frontend.

import type { Env } from "../types";

const OMDB_URL = "https://www.omdbapi.com/";
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days — ratings change slowly

export interface Ratings {
  imdb_rating: string | null;
  imdb_votes: string | null;
  rotten_tomatoes: string | null;
  metacritic: string | null;
}

const EMPTY: Ratings = {
  imdb_rating: null,
  imdb_votes: null,
  rotten_tomatoes: null,
  metacritic: null,
};

interface OmdbResponse {
  Response?: string;
  imdbRating?: string;
  imdbVotes?: string;
  Ratings?: { Source: string; Value: string }[];
}

const clean = (v?: string): string | null => (v && v !== "N/A" ? v : null);

/** OMDb ratings by imdbID. Best-effort + KV cache; returns empty ratings on any issue. */
export async function getOmdbRatings(env: Env, imdbId: string): Promise<Ratings> {
  if (!imdbId || !env.OMDB_API_KEY) return EMPTY;

  const cacheKey = `omdb:${imdbId}`;
  const cached = await env.TMDB_CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached) as Ratings;

  try {
    const url = new URL(OMDB_URL);
    url.searchParams.set("apikey", env.OMDB_API_KEY);
    url.searchParams.set("i", imdbId);
    const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) return EMPTY;

    const data = (await res.json()) as OmdbResponse;
    const find = (src: string) => data.Ratings?.find((r) => r.Source === src)?.Value ?? null;

    const ratings: Ratings =
      data.Response === "False"
        ? EMPTY
        : {
            imdb_rating: clean(data.imdbRating),
            imdb_votes: clean(data.imdbVotes),
            rotten_tomatoes: find("Rotten Tomatoes"),
            metacritic: find("Metacritic"),
          };

    // Cache even empty results to avoid re-hitting the daily quota.
    await env.TMDB_CACHE.put(cacheKey, JSON.stringify(ratings), { expirationTtl: CACHE_TTL });
    return ratings;
  } catch {
    return EMPTY;
  }
}
