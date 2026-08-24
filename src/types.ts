// Shared Cinemate types (Env, DB entities, deck).

/** Bindings injected by Cloudflare into the Worker. See wrangler.toml. */
export interface Env {
  /** D1 — the relational database. */
  DB: D1Database;
  /** KV — cache for TMDb responses (avoids rate limiting). */
  TMDB_CACHE: KVNamespace;
  /** Durable Object namespace — live per-room state. */
  ROOM: DurableObjectNamespace;
  /** Secret — the TMDb key. Never in code; comes from .dev.vars / wrangler secret. */
  TMDB_API_KEY: string;
}

export type MediaType = "movie" | "tv";
export type SwipeDirection = "like" | "dislike";
export type RoomStatus = "waiting" | "active" | "closed";

export interface User {
  id: string;
  username: string;
  created_at: string;
}

/** Taste profile. genre_scores is JSON: { [genreId]: score 0..1 }. */
export interface Profile {
  user_id: string;
  genre_scores: Record<string, number>;
  era_pref: string | null;
  mood_pref: string | null;
  media_type_pref: MediaType | null;
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
