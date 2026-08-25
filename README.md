# Cinemate 🎬

**Tinder for movies & TV shows.** Two people join a room with an invite code, get a
shared-but-personalised deck of titles, swipe, and when both like the same title →
**match** (dedicated screen, live over WebSocket, no refresh). Works **solo** too
(any like = personal watchlist).

Live: **https://cinemate.valegboth.win** · runs entirely on **Cloudflare free tier**.

## Features
- **Quiz profile** — liked genres (tap = like, double-tap = love), genres to avoid,
  and **seed titles** ("movies you loved", with live autocomplete). Editable anytime
  (Profile → Edit preferences); nothing is required (empty profile = popular titles).
- **Per-user decks** — one shared pool (both users' tastes + seed recommendations +
  common ground) served in a **weighted-random order per user**, so each sees their
  own taste first while both can still match.
- **Swipe UX** — drag with rotation + LIKE/NOPE stamps, buttons, **undo**, **trailer**
  (YouTube), movie/TV toggle, "New session" for a fresh deck.
- **Ratings** — IMDb / Rotten Tomatoes / Metacritic (via OMDb) on the card and match.
- **Live match** — instant match screen over WebSocket (Durable Object, hibernation).
- **Invite** — 6-char code + one-tap shareable link (`/join?code=…`).
- **Solo mode** + persistent watchlist.
- **Overseerr** (optional) — excludes already requested/available titles from the deck
  and adds an **"Add to Overseerr"** button on match (auto-request → Radarr/Sonarr).
- Watch providers (where to watch, RO) on the match screen. TMDb attribution in the footer.

## Stack
| Piece      | Service                          | Role                                    |
| ---------- | -------------------------------- | --------------------------------------- |
| Frontend   | Workers Static Assets (`public/`)| swipe UI (vanilla HTML/CSS/JS)          |
| API        | Cloudflare Workers (Hono/TS)     | routing, logic, simple auth             |
| Database   | D1 (SQLite)                      | users, profiles, rooms, swipes, matches |
| Live state | Durable Objects + WebSocket      | swipe session, instant match broadcast  |
| Cache      | Workers KV                       | TMDb / OMDb / Overseerr responses       |
| Movie data | TMDb (primary) + OMDb (ratings)  | posters, genres, recommendations, ratings |
| Requests   | Overseerr (optional)             | exclude requested + request on match    |

The Worker serves both the static frontend and `/api/*` on the **same origin** (no CORS,
one `wrangler deploy`). Overseerr is reached over a **Cloudflare Tunnel + Access** service
token, so it stays private (never publicly exposed).

## Project layout
```
cinemate/
├── PLAN.md · schema.sql · wrangler.toml
├── src/
│   ├── index.ts            # Worker entry, mounts routes
│   ├── types.ts            # shared types
│   ├── routes/             # users, profile, rooms, search
│   ├── services/           # tmdb, omdb, overseerr
│   ├── lib/                # ids, db, mappers, deck
│   └── durable-objects/room.ts   # live room state (WebSocket)
└── public/                 # index.html, style.css, app.js
```

## Local setup
```bash
npm install
cp .dev.vars.example .dev.vars     # fill in TMDB_API_KEY (see below)
npx wrangler d1 create cinemate-db          # copy database_id into wrangler.toml
npx wrangler kv:namespace create TMDB_CACHE # copy id into wrangler.toml
npm run db:migrate:local            # apply schema.sql to the local D1
npx wrangler dev                    # http://localhost:8787 (UI + API, same origin)
```

### Secrets / env (`.dev.vars` locally, `wrangler secret put` in prod)
| Var | Required | Purpose |
| --- | --- | --- |
| `TMDB_API_KEY` | ✅ | TMDb (v3 key or v4 token — auto-detected) |
| `OMDB_API_KEY` | optional | IMDb/RT/Metacritic ratings (best-effort) |
| `OVERSEERR_URL` / `OVERSEERR_API_KEY` | optional | Overseerr integration |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | optional | if Overseerr is behind Cloudflare Access |

The keys never reach the frontend — the browser calls the Worker, the Worker calls the APIs.

## npm scripts
| Script | Does |
| --- | --- |
| `npm run dev` | run the Worker + frontend locally |
| `npm run lint` / `typecheck` / `build` | ESLint / `tsc --noEmit` / bundling dry-run |
| `npm run deploy` | deploy Worker + static assets |
| `npm run db:migrate:local` / `:remote` | apply `schema.sql` to local / remote D1 |

## API routes (all under `/api`)
`POST /users` · `GET /users/:id/watchlist` · `POST /profile/quiz` · `GET /profile/:id`
· `GET /search` · `POST /rooms` · `POST /rooms/join` · `GET /rooms/:id`
· `PATCH /rooms/:id` (movie/TV toggle) · `POST /rooms/:id/new-session`
· `GET /rooms/:id/deck` · `POST /rooms/:id/swipe` · `DELETE /rooms/:id/swipe` (undo)
· `GET /rooms/:id/matches` · `GET /rooms/:id/ws` · `GET /rooms/:id/providers/:tmdbId`
· `GET /rooms/:id/rating/:tmdbId` · `GET /rooms/:id/trailer/:tmdbId`
· `POST /rooms/:id/request` (Add to Overseerr)

## CI/CD
- **PR → main**: lint + typecheck + build.
- **push → main**: a single `wrangler deploy` (Worker + static frontend). Needs repo
  secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

## Status
V1 + V2 shipped (quiz, per-user decks, ratings, invite link, gestures/trailer/undo,
solo watchlist, edit preferences, Overseerr). See [PLAN.md](./PLAN.md) for the roadmap
(Letterboxd import, group mode).

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB.
<https://www.themoviedb.org>
