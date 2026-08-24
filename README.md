# Cinemate 🎬

**Tinder pentru filme/seriale.** Doi useri intră într-o cameră printr-un cod de
invite, primesc împreună un deck de titluri, fac swipe, iar când amândoi dau like
pe același titlu → **match** = filmul câștigător (ecran dedicat, live prin
WebSocket, fără refresh). Merge și **solo** (orice like = watchlist personal).

Totul pe **free tier Cloudflare**.

## Stack

| Piesă         | Serviciu                     | Rol                                     |
| ------------- | ---------------------------- | --------------------------------------- |
| Frontend      | Cloudflare Pages (static)    | UI de swipe (vanilla HTML/CSS/JS în V1) |
| API           | Cloudflare Workers (Hono/TS) | rutare, logică, auth simplu             |
| DB relațională| D1 (SQLite)                  | users, profiles, rooms, swipes, matches |
| Stare live    | Durable Objects + WebSocket  | sesiune de swipe, match instant         |
| Cache         | Workers KV                   | răspunsuri TMDb (evită rate-limit)      |
| Date filme    | TMDb API                     | postere, titlu, gen, descriere, providers |

## Structura proiectului

```
cinemate/
├── PLAN.md                 # planul complet, pe faze
├── wrangler.toml           # config Workers + D1 + DO + KV bindings
├── package.json
├── schema.sql              # schema D1 (Faza 1)
├── eslint.config.js
├── tsconfig.json
├── .dev.vars.example       # șablon pentru secretul TMDb local
├── src/
│   ├── index.ts            # Worker principal, rute Hono
│   ├── types.ts            # tipuri comune (Env, Profile, Room, DeckCard...)
│   ├── services/
│   │   └── tmdb.ts         # integrare TMDb + cache KV
│   └── durable-objects/
│       └── room.ts         # stare live cameră (swipe, match, WebSocket)
└── public/                 # frontend static (Pages)
    ├── index.html
    ├── style.css
    └── app.js
```

## Setup local

### 1. Prerechizite

`node` (18+), `npm`, `git`, `gh` (opțional), și `wrangler` (vine ca devDependency).

### 2. Instalare

```bash
npm install
```

### 3. Secretul TMDb (local)

Obține o cheie gratuită de la <https://www.themoviedb.org/settings/api>, apoi:

```bash
cp .dev.vars.example .dev.vars
# editează .dev.vars și pune cheia reală în TMDB_API_KEY
```

`.dev.vars` e gitignored — **cheia nu ajunge niciodată în repo sau în frontend**.

### 4. Resurse Cloudflare (le creezi TU, o singură dată)

> Nu le creează asistentul. Rulează comenzile, apoi copiază ID-urile în `wrangler.toml`.

```bash
# D1 — copiază database_id în wrangler.toml
npx wrangler d1 create cinemate-db

# KV — copiază id în wrangler.toml
npx wrangler kv:namespace create TMDB_CACHE

# aplică schema (după Faza 1, când există schema.sql)
npx wrangler d1 execute cinemate-db --local --file=schema.sql

# secret pentru prod (local folosește .dev.vars)
npx wrangler secret put TMDB_API_KEY
```

### 5. Rulare dev

```bash
# Worker (API)
npx wrangler dev

# Frontend (Pages), în alt terminal
npx wrangler pages dev public
```

## Scripturi npm

| Script               | Ce face                                    |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | rulează Worker-ul local (`wrangler dev`)   |
| `npm run pages:dev`  | rulează frontend-ul static local           |
| `npm run typecheck`  | `tsc --noEmit`                             |
| `npm run lint`       | ESLint                                      |
| `npm run build`      | bundling dry-run (validare build)          |
| `npm run db:migrate:local` | aplică `schema.sql` pe D1 local      |

## CI/CD

- **PR → main**: lint + typecheck + build (`.github/workflows/ci.yml`).
- **push → main**: deploy Workers + Pages (`.github/workflows/deploy.yml`).
  Necesită secretele de repo `CLOUDFLARE_API_TOKEN` și `CLOUDFLARE_ACCOUNT_ID`.

## Status

Vezi [PLAN.md](./PLAN.md). În lucru pe faze — V1 (schelet funcțional).

## Atribuire

This product uses the TMDB API but is not endorsed or certified by TMDB.
<https://www.themoviedb.org>
