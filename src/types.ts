// Tipuri comune Cinemate (Env, entități DB, deck).

/** Bindings injectate de Cloudflare în Worker. Vezi wrangler.toml. */
export interface Env {
  /** D1 — baza de date relațională. */
  DB: D1Database;
  /** KV — cache pentru răspunsurile TMDb (evită rate-limit). */
  TMDB_CACHE: KVNamespace;
  /** Durable Object namespace — stare live per cameră. */
  ROOM: DurableObjectNamespace;
  /** Secret — cheia TMDb. NU e în cod; vine din .dev.vars / wrangler secret. */
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

/** Profil de gusturi. genre_scores e JSON: { [genreId]: score 0..1 }. */
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
  /** Pool-ul comun de tmdb_id, generat o singură dată per cameră (Faza 3). */
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

/** Un card în deck-ul de swipe (proiecție din TMDb pentru frontend). */
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
