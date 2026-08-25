// Shared Cinemate types (Env, DB entities, deck).

/** Bindings injected by Cloudflare into the Worker. See wrangler.toml. */
export interface Env {
  /** D1 — the relational database. */
  DB: D1Database;
  /** KV — cache for TMDb responses (avoids rate limiting). */
  TMDB_CACHE: KVNamespace;
  /** Durable Object namespace — live per-room state. */
  ROOM: DurableObjectNamespace;
  /** Static assets fetcher (used to serve index.html on SPA paths like /join). */
  ASSETS: Fetcher;
  /** Secret — the TMDb key. Never in code; comes from .dev.vars / wrangler secret. */
  TMDB_API_KEY: string;
  /** Secret — the OMDb key (enrichment: IMDb/RT/Metacritic ratings). Best-effort. */
  OMDB_API_KEY: string;
  /** Secret — Overseerr base URL (e.g. https://overseerr.example.com). Optional. */
  OVERSEERR_URL: string;
  /** Secret — Overseerr API key (X-Api-Key). Optional; feature inert if unset. */
  OVERSEERR_API_KEY: string;
  /** Secret — Cloudflare Access service token (optional; if the Overseerr hostname is behind Access). */
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
  /** Secret — shared PIN required to request in Overseerr. If unset, requests are disabled. */
  REQUEST_PIN: string;
}

export type MediaType = "movie" | "tv";
export type SwipeDirection = "like" | "dislike";
export type RoomStatus = "waiting" | "active" | "closed";

export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface SeedTitle {
  tmdb_id: number;
  media_type: MediaType;
  title?: string; // kept for display when editing preferences
}

/** Quiz preferences stored as JSON in profiles.prefs. Each is optional (empty = no filter). */
export interface ProfilePrefs {
  avoid_genres?: number[]; // TMDb genre ids → without_genres
  seeds?: SeedTitle[]; // liked titles → recommendations (added in a later step)
}

/** Taste profile. genre_scores is JSON: { [genreId]: score 0..1 }. */
export interface Profile {
  user_id: string;
  genre_scores: Record<string, number>;
  prefs: ProfilePrefs;
}

export interface Room {
  id: string;
  join_code: string;
  user_a_id: string;
  user_b_id: string | null; // null = solo
  platform_filter: string | null;
  media_type: MediaType;
  /** Shared pool of tmdb_id, generated once per room (see lib/deck.ts). */
  deck: number[];
  status: RoomStatus;
  created_at: string;
}

export interface Swipe {
  room_id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  direction: SwipeDirection;
  created_at: string;
}

export interface Match {
  room_id: string;
  tmdb_id: number;
  media_type: MediaType;
  matched_at: string;
}

/** A card in the swipe deck (a TMDb projection for the frontend). */
export interface DeckCard {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  overview: string;
  poster_path: string | null;
  genres: number[];
  release_year: number | null;
  vote_average: number | null;
}
