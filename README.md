# Cinemate 🎬

**Tinder for movies & TV shows.** Two users join a room with an invite code, get a
shared deck of titles, swipe, and when both like the same title → **match** = the
winning title (dedicated screen, live over WebSocket, no refresh). Works **solo**
too (any like = personal watchlist).

Runs entirely on **Cloudflare free tier**.

## Stack

| Piece      | Service                        | Role                                       |
| ---------- | ------------------------------ | ------------------------------------------ |
| Frontend   | Workers Static Assets (`public/`) | swipe UI (vanilla HTML/CSS/JS)          |
| API        | Cloudflare Workers (Hono/TS)   | routing, logic, simple auth                |
| Database   | D1 (SQLite)                    | users, profiles, rooms, swipes, matches    |
| Live state | Durable Objects + WebSocket    | swipe session, instant match broadcast     |
| Cache      | Workers KV                     | TMDb responses (avoids rate limiting)      |
| Movie data | TMDb API                       | posters, titles, genres, overview, providers |

The Worker serves both the static frontend and `/api/*` on the **same origin**, so
there is no CORS and a single `wrangler deploy` ships everything.

## Project layout

```
cinemate/
├── PLAN.md               # roadmap
├── wrangler.toml         # Workers + D1 + DO + KV + Static Assets config
├── schema.sql            # D1 schema
├── src/
│   ├── index.ts          # Worker entry, mounts Hono routes
│   ├── types.ts          # shared types (Env, Profile, Room, DeckCard…)
│   ├── routes/           # users, profile, rooms
│   ├── services/tmdb.ts  # TMDb integration + KV cache
│   ├── lib/              # ids, db helpers, mappers, deck
│   └── durable-objects/room.ts  # live room state (WebSocket, broadcast)
└── public/               # static frontend (index.html, style.css, app.js)
```

## Local setup

### 1. Prerequisites
`node` (18+), `npm`, `git`. `wrangler` comes as a dev dependency.

### 2. Install
```bash
npm install
```

### 3. TMDb key (local)
Get a free key at <https://www.themoviedb.org/settings/api>, then:
```bash
cp .dev.vars.example .dev.vars   # then put your key in TMDB_API_KEY
```
`.dev.vars` is gitignored — **the key never lands in the repo or the frontend**.

### 4. Cloudflare resources (create once)
```bash
npx wrangler d1 create cinemate-db            # copy database_id into wrangler.toml
npx wrangler kv:namespace create TMDB_CACHE   # copy id into wrangler.toml
npm run db:migrate:remote                     # apply schema.sql to remote D1
npx wrangler secret put TMDB_API_KEY          # production secret
```

### 5. Run locally
One server serves both the frontend and the API (same origin):
```bash
npm run db:migrate:local   # apply schema to the local D1 (once)
npx wrangler dev           # open http://localhost:8787
```

## npm scripts

| Script                     | What it does                          |
| -------------------------- | ------------------------------------- |
| `npm run dev`              | run the Worker + frontend locally     |
| `npm run typecheck`        | `tsc --noEmit`                        |
| `npm run lint`             | ESLint                                |
| `npm run build`            | bundling dry-run (build validation)   |
| `npm run deploy`           | deploy Worker + static assets         |
| `npm run db:migrate:local` | apply `schema.sql` to the local D1    |
| `npm run db:migrate:remote`| apply `schema.sql` to the remote D1   |

## CI/CD
- **PR → main**: lint + typecheck + build (`.github/workflows/ci.yml`).
- **push → main**: a single `wrangler deploy` (Worker + static frontend)
  (`.github/workflows/deploy.yml`). Needs repo secrets `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`.

## Status
See [PLAN.md](./PLAN.md). V1 and V2.1–V2.2 are done; more on the roadmap.

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB.
<https://www.themoviedb.org>
