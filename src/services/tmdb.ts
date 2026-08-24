// Integrare TMDb + cache KV.
// HARD: cheia TMDb vine DOAR din env (secret), niciodată din cod sau frontend.
// Frontend-ul lovește Worker-ul, Worker-ul lovește TMDb.
//
// Implementare completă în Faza 3 (discover, detalii, watch providers, cache KV).
// Atribuire obligatorie TMDb — vezi footer-ul din public/index.html.

import type { Env } from "../types";

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * Fetch cu cache KV în față (Faza 3).
 * Momentan stub — semnătura e stabilă ca s-o folosim în rutele de deck.
 */
export async function tmdbFetch<T>(
  _env: Env,
  _path: string,
  _params: Record<string, string> = {},
): Promise<T> {
  // TODO(Faza 3): construiește URL cu params + api_key, verifică KV, fetch, cache.
  throw new Error("tmdbFetch: not implemented until Faza 3");
}
