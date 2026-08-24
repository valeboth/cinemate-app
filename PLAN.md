# Cinemate — Plan

Tinder for movies & TV shows. Two users join a room via a 6-char invite code, get a
shared deck, swipe, and when both like the same title → **match** (dedicated screen,
live over WebSocket). Works solo too (any like = personal watchlist).

## Stack (Cloudflare free tier)
- **Frontend:** Workers Static Assets (`public/`), vanilla HTML/CSS/JS — same origin as the API.
- **API:** Cloudflare Workers + Hono (TypeScript)
- **DB:** D1 (SQLite)
- **Live state:** Durable Objects + WebSocket (Hibernation API)
- **Cache:** Workers KV (TMDb responses)
- **Movie data:** TMDb API (language en-US, region/providers RO)

## D1 schema
- **users** — id, username, created_at
- **profiles** — user_id, genre_scores (JSON), era_pref, mood_pref, media_type_pref
- **rooms** — id, join_code, user_a_id, user_b_id (null = solo), platform_filter, media_type, deck (JSON), status, created_at
- **swipes** — (room_id, user_id, tmdb_id) PK, media_type, direction, created_at
- **matches** — (room_id, tmdb_id) PK, media_type, matched_at

## API routes
- `POST /api/users` — create user
- `GET /api/users/:id/watchlist` — persistent solo watchlist
- `POST /api/profile/quiz` · `GET /api/profile/:id` — taste profile
- `POST /api/rooms` · `POST /api/rooms/join` · `GET /api/rooms/:id`
- `PATCH /api/rooms/:id` — live movie/TV toggle (resets the pool)
- `GET /api/rooms/:id/deck` — shared pool (generated once)
- `POST /api/rooms/:id/swipe` — record swipe + detect match + broadcast
- `GET /api/rooms/:id/matches` · `GET /api/rooms/:id/providers/:tmdbId`
- `GET /api/rooms/:id/ws` — live WebSocket

## Hard requirements (locked decisions)
1. Durable Objects on the **SQLite** backend (`new_sqlite_classes` migration).
2. The candidate pool is generated **once** per room and saved (`rooms.deck`); both users draw from the same pool.
3. Durable Object uses the **WebSocket Hibernation API**.
4. `/swipe` and `/rooms PATCH` enforce **auth gating** (user must belong to the room).
5. The TMDb key is **never** in code or the frontend (`.dev.vars` locally, `wrangler secret` in prod).
6. **TMDb attribution** in the footer.

## Status
- [x] **V1** — schema, Worker routes, TMDb + shared pool, Durable Object + live WS, swipe UI, solo, movie/TV toggle. Deployed.
- [x] **V2.1** — live movie/TV toggle, full watch-provider filtering + "where to watch", match transparency.
- [x] **V2.2** — real quiz scoring (like/love genre weights + era), persistent solo watchlist.

## Roadmap
**V2.3** — Letterboxd CSV import (parse export → map to TMDb in batches → build genre_scores).
**V3** — Plex check, auto-queue in Radarr/Sonarr/Overseerr on match, group mode (3–5 users),
collaborative filtering, real auth. Polish: swipe gestures/animations (stay vanilla, no framework).
