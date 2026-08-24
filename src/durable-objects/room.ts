// Durable Object — stare live per cameră (swipe, detecție match, WebSocket).
//
// HARD REQUIREMENTS (vezi wrangler.toml + brief):
//  - SQLite storage backend (migrations `new_sqlite_classes`).
//  - WebSocket Hibernation API (fără compute cât camera e idle).
//  - detecție match: dacă ambii au dat like pe același tmdb_id → match live.
//
// Implementare completă în Faza 4. Momentan schelet minimal ca build-ul
// și binding-ul DO să fie valide.

import type { Env } from "../types";

export class Room {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(_request: Request): Promise<Response> {
    // TODO(Faza 4): upgrade WebSocket cu Hibernation API, gestionează swipe-uri,
    // ține pool-ul comun + like-urile, calculează match, broadcast la ambii clienți.
    // state/env sunt stocate acum și folosite în Faza 4.
    void this.state;
    void this.env;
    return new Response("Room DO — not implemented until Faza 4", { status: 501 });
  }
}
