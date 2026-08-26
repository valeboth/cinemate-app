// TMDb integration + KV cache.
// HARD: the TMDb key comes ONLY from env (secret), never from code or the frontend.
// The frontend calls the Worker, the Worker calls TMDb.
// Auth is auto-detected: v4 (Read Access Token = JWT "eyJ...") vs v3 (api_key).

import type { DeckCard, Env, MediaType } from "../types";

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h for TMDb responses
const TMDB_REGION = "RO"; // watch providers + release region
const TMDB_LANG = "en-US";


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

/** Fetch TMDb with a KV cache in front. The cache key excludes api_key. */
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

// Streaming providers for the RO region (watch_region=RO). Best-effort.
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
  avoidGenres?: number[];
  platform?: string | null;
  pages?: number;
}

/** discover /discover/{movie|tv} for RO; returns deduplicated cards. */
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
      params.with_genres = opts.genreIds.join("|"); // OR across liked genres
    }
    if (opts.avoidGenres && opts.avoidGenres.length > 0) {
      params.without_genres = opts.avoidGenres.join(","); // exclude any of these
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

/** Title details → card. Used as a fallback when rebuilding a deck or a watchlist. */
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

interface TmdbCredits {
  cast?: { name: string; character?: string; profile_path?: string | null }[];
  crew?: { name: string; job?: string; department?: string }[];
}
interface TmdbDetailFull extends TmdbDetail {
  tagline?: string;
  runtime?: number; // movie
  episode_run_time?: number[]; // tv
  number_of_seasons?: number; // tv
  created_by?: { name: string }[]; // tv
  credits?: TmdbCredits;
}

export interface CastMember {
  name: string;
  character: string | null;
  profile_path: string | null;
}
export interface TitleDetails {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  tagline: string | null;
  overview: string;
  poster_path: string | null;
  release_year: number | null;
  genres: string[];
  runtime: number | null; // minutes (movie) or per-episode (tv)
  seasons: number | null; // tv only
  vote_average: number | null;
  directors: string[]; // Director(s) for movies, Creator(s) for tv
  cast: CastMember[];
}

/** Full metadata for the details view: cast, director/creator, runtime, genres. One cached call. */
export async function getTitleDetails(
  env: Env,
  mediaType: MediaType,
  id: number,
): Promise<TitleDetails | null> {
  try {
    const d = await tmdbFetch<TmdbDetailFull>(env, `/${mediaType}/${id}`, {
      language: TMDB_LANG,
      append_to_response: "credits",
    });
    const directors =
      mediaType === "movie"
        ? (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name)
        : (d.created_by ?? []).map((c) => c.name);
    const runtime =
      mediaType === "movie"
        ? typeof d.runtime === "number"
          ? d.runtime
          : null
        : Array.isArray(d.episode_run_time) && d.episode_run_time.length
          ? d.episode_run_time[0]
          : null;
    return {
      tmdb_id: d.id,
      media_type: mediaType,
      title: (mediaType === "movie" ? d.title : d.name) ?? "",
      tagline: d.tagline?.trim() || null,
      overview: d.overview ?? "",
      poster_path: d.poster_path ?? null,
      release_year: dateToYear(mediaType === "movie" ? d.release_date : d.first_air_date),
      genres: (d.genres ?? []).map((g) => g.name),
      runtime,
      seasons:
        mediaType === "tv" && typeof d.number_of_seasons === "number" ? d.number_of_seasons : null,
      vote_average: typeof d.vote_average === "number" ? d.vote_average : null,
      directors: [...new Set(directors)].slice(0, 3),
      cast: (d.credits?.cast ?? []).slice(0, 12).map((c) => ({
        name: c.name,
        character: c.character?.trim() || null,
        profile_path: c.profile_path ?? null,
      })),
    };
  } catch {
    return null;
  }
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

/** Watch providers for a title, in the given region (default RO). */
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

interface TmdbVideosResponse {
  results?: { site?: string; type?: string; key?: string; official?: boolean }[];
}

/** YouTube trailer key for a title (Trailer preferred, else Teaser), or null. */
export async function getTrailerKey(env: Env, mediaType: MediaType, id: number): Promise<string | null> {
  try {
    const data = await tmdbFetch<TmdbVideosResponse>(env, `/${mediaType}/${id}/videos`, {
      language: TMDB_LANG,
    });
    const yt = (data.results ?? []).filter((v) => v.site === "YouTube" && v.key);
    const trailer =
      yt.find((v) => v.type === "Trailer" && v.official) ||
      yt.find((v) => v.type === "Trailer") ||
      yt.find((v) => v.type === "Teaser") ||
      yt[0];
    return trailer?.key ?? null;
  } catch {
    return null;
  }
}

interface TmdbExternalIds {
  imdb_id?: string | null;
}

/** IMDb id for a title (works for movie and tv), used to query OMDb. */
export async function getImdbId(env: Env, mediaType: MediaType, id: number): Promise<string | null> {
  try {
    const d = await tmdbFetch<TmdbExternalIds>(env, `/${mediaType}/${id}/external_ids`);
    return d.imdb_id || null;
  } catch {
    return null;
  }
}

interface TmdbGenreList {
  genres?: { id: number; name: string }[];
}

/** id → genre name map, used for the match explanation. */
export async function getGenreMap(env: Env, mediaType: MediaType): Promise<Record<number, string>> {
  const data = await tmdbFetch<TmdbGenreList>(env, `/genre/${mediaType}/list`, { language: TMDB_LANG });
  const map: Record<number, string> = {};
  for (const g of data.genres ?? []) map[g.id] = g.name;
  return map;
}

interface TmdbSearchResult {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}
interface TmdbSearchResponse {
  results?: TmdbSearchResult[];
}

export interface SearchHit {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  year: number | null;
  poster_path: string | null;
}

/** Autocomplete search (cached via tmdbFetch's KV). media_type omitted → /search/multi. */
export async function searchTitles(
  env: Env,
  query: string,
  mediaType?: MediaType,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const path =
    mediaType === "movie" ? "/search/movie" : mediaType === "tv" ? "/search/tv" : "/search/multi";
  const data = await tmdbFetch<TmdbSearchResponse>(env, path, {
    language: TMDB_LANG,
    query: q,
    include_adult: "false",
    page: "1",
  });
  const hits: SearchHit[] = [];
  for (const r of data.results ?? []) {
    const mt: MediaType | null =
      mediaType ?? (r.media_type === "movie" ? "movie" : r.media_type === "tv" ? "tv" : null);
    if (!mt) continue; // skip people/other from /search/multi
    const title = (mt === "movie" ? r.title : r.name) ?? "";
    if (!title) continue;
    hits.push({
      tmdb_id: r.id,
      media_type: mt,
      title,
      year: dateToYear(mt === "movie" ? r.release_date : r.first_air_date),
      poster_path: r.poster_path ?? null,
    });
    if (hits.length >= 8) break;
  }
  return hits;
}

/** Recommendations for a seed title (falls back to /similar if few). Best-effort. */
export async function getRecommendations(
  env: Env,
  mediaType: MediaType,
  id: number,
): Promise<DeckCard[]> {
  const cards: DeckCard[] = [];
  const seen = new Set<number>();
  const add = (data: TmdbDiscoverResponse) => {
    for (const r of data.results ?? []) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        cards.push(discoverResultToCard(r, mediaType));
      }
    }
  };
  try {
    add(await tmdbFetch<TmdbDiscoverResponse>(env, `/${mediaType}/${id}/recommendations`, {
      language: TMDB_LANG,
      page: "1",
    }));
    if (cards.length < 10) {
      add(await tmdbFetch<TmdbDiscoverResponse>(env, `/${mediaType}/${id}/similar`, {
        language: TMDB_LANG,
        page: "1",
      }));
    }
  } catch {
    // best-effort
  }
  return cards;
}
