// Integrare TMDb + cache KV.
// HARD: cheia TMDb vine DOAR din env (secret), niciodată din cod sau frontend.
// Frontend-ul lovește Worker-ul, Worker-ul lovește TMDb.
// Auth: detectăm automat v4 (Read Access Token = JWT „eyJ...") vs v3 (api_key).

import type { DeckCard, Env, MediaType } from "../types";

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h pentru răspunsurile TMDb
const TMDB_REGION = "RO";
const TMDB_LANG = "ro-RO";

interface TmdbDiscoverResult {
  id: number;
  title?: string; // movie
  name?: string; // tv
  overview?: string;
  poster_path?: string | null;
  genre_ids?: number[];
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average?: number;
}

interface TmdbDiscoverResponse {
  page: number;
  total_pages: number;
  results: TmdbDiscoverResult[];
}

interface TmdbDetail {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  genres?: { id: number; name: string }[];
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

function isV4Token(key: string): boolean {
  return key.startsWith("eyJ"); // JWT
}

/** Fetch TMDb cu cache KV. Cheia de cache exclude api_key. */
export async function tmdbFetch<T>(
  env: Env,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const key = env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY missing");
  const v4 = isV4Token(key);

  const url = new URL(TMDB_BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!v4) url.searchParams.set("api_key", key);

  // Cheia de cache: path + params sortate, FĂRĂ api_key.
  const cacheParams = [...url.searchParams.entries()]
    .filter(([k]) => k !== "api_key")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const cacheKey = `tmdb:${path}?${cacheParams}`;

  const cached = await env.TMDB_CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached) as T;

  const res = await fetch(url.toString(), {
    headers: v4
      ? { Authorization: `Bearer ${key}`, accept: "application/json" }
      : { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDb ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as T;
  await env.TMDB_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
  return data;
}

// Provideri de streaming pentru RO (watch_region=RO). Best-effort.
// TODO: validare per regiune via /watch/providers/{movie|tv}?watch_region=RO.
const PROVIDER_IDS: Record<string, number> = {
  netflix: 8,
  prime: 119,
  amazon: 119,
  "amazon prime": 119,
  disney: 337,
  "disney+": 337,
  "disney plus": 337,
  hbo: 1899,
  "hbo max": 1899,
  max: 1899,
  apple: 350,
  "apple tv": 350,
};

function dateToYear(date?: string): number | null {
  if (!date || date.length < 4) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function discoverResultToCard(r: TmdbDiscoverResult, mediaType: MediaType): DeckCard {
  return {
    tmdb_id: r.id,
    media_type: mediaType,
    title: (mediaType === "movie" ? r.title : r.name) ?? "",
    overview: r.overview ?? "",
    poster_path: r.poster_path ?? null,
    genres: r.genre_ids ?? [],
    release_year: dateToYear(mediaType === "movie" ? r.release_date : r.first_air_date),
    vote_average: typeof r.vote_average === "number" ? r.vote_average : null,
  };
}

export interface DiscoverOptions {
  mediaType: MediaType;
  genreIds?: number[];
  platform?: string | null;
  pages?: number;
}

/** discover /discover/{movie|tv} pe RO; întoarce carduri deduplicate. */
export async function discoverTitles(env: Env, opts: DiscoverOptions): Promise<DeckCard[]> {
  const pages = Math.max(1, Math.min(opts.pages ?? 2, 5));
  const cards: DeckCard[] = [];
  const seen = new Set<number>();

  for (let page = 1; page <= pages; page++) {
    const params: Record<string, string> = {
      language: TMDB_LANG,
      region: TMDB_REGION,
      sort_by: "popularity.desc",
      include_adult: "false",
      "vote_count.gte": "50",
      page: String(page),
    };
    if (opts.genreIds && opts.genreIds.length > 0) {
      params.with_genres = opts.genreIds.join("|"); // OR între genuri
    }
    const providerId = opts.platform ? PROVIDER_IDS[opts.platform.toLowerCase()] : undefined;
    if (providerId) {
      params.with_watch_providers = String(providerId);
      params.watch_region = TMDB_REGION;
    }

    const path = opts.mediaType === "movie" ? "/discover/movie" : "/discover/tv";
    const data = await tmdbFetch<TmdbDiscoverResponse>(env, path, params);

    for (const r of data.results ?? []) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        cards.push(discoverResultToCard(r, opts.mediaType));
      }
    }
    if (page >= (data.total_pages ?? 1)) break;
  }
  return cards;
}

interface TmdbProviderEntry {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
}
interface TmdbProvidersResponse {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
    }
  >;
}

export interface WatchProvider {
  name: string;
  logo_path: string | null;
}
export interface WatchProviders {
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

/** Watch providers pentru un titlu, în regiunea dată (default RO). */
export async function getWatchProviders(
  env: Env,
  mediaType: MediaType,
  id: number,
  region = TMDB_REGION,
): Promise<WatchProviders> {
  const data = await tmdbFetch<TmdbProvidersResponse>(env, `/${mediaType}/${id}/watch/providers`);
  const r = data.results?.[region];
  const map = (arr?: TmdbProviderEntry[]): WatchProvider[] =>
    (arr ?? []).map((p) => ({ name: p.provider_name, logo_path: p.logo_path ?? null }));
  return {
    link: r?.link ?? null,
    flatrate: map(r?.flatrate),
    rent: map(r?.rent),
    buy: map(r?.buy),
  };
}

interface TmdbGenreList {
  genres?: { id: number; name: string }[];
}

/** Mapare id → nume gen (ro-RO), pentru explicația match-ului. */
export async function getGenreMap(env: Env, mediaType: MediaType): Promise<Record<number, string>> {
  const data = await tmdbFetch<TmdbGenreList>(env, `/genre/${mediaType}/list`, { language: TMDB_LANG });
  const map: Record<number, string> = {};
  for (const g of data.genres ?? []) map[g.id] = g.name;
  return map;
}

/** Detaliile unui titlu → card. Folosit ca fallback la reconstruirea deck-ului. */
export async function getTitleCard(
  env: Env,
  mediaType: MediaType,
  id: number,
): Promise<DeckCard | null> {
  try {
    const d = await tmdbFetch<TmdbDetail>(env, `/${mediaType}/${id}`, { language: TMDB_LANG });
    return {
      tmdb_id: d.id,
      media_type: mediaType,
      title: (mediaType === "movie" ? d.title : d.name) ?? "",
      overview: d.overview ?? "",
      poster_path: d.poster_path ?? null,
      genres: (d.genres ?? []).map((g) => g.id),
      release_year: dateToYear(mediaType === "movie" ? d.release_date : d.first_air_date),
      vote_average: typeof d.vote_average === "number" ? d.vote_average : null,
    };
  } catch {
    return null;
  }
}
