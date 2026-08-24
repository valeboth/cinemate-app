# Cinemate — Plan

> Generat din brief-ul proiectului. **Scope curent: DOAR V1.** Feature-urile V2/V3
> apar aici doar ca roadmap; unde se leagă, în cod există comentarii `TODO`.

## Ce construim

Cinemate = „Tinder pentru filme/seriale". Doi useri intră într-o cameră printr-un
cod de invite (6 caractere), primesc un deck de titluri, fac swipe, iar când
amândoi dau like pe același titlu → **match** = filmul câștigător (ecran dedicat,
live prin WebSocket, fără refresh). Merge și **solo** (orice like = watchlist
personal).

## Stack (100% free tier Cloudflare)

- **Frontend:** Cloudflare Pages, vanilla HTML/CSS/JS (fără framework în V1)
- **API:** Cloudflare Workers cu Hono, TypeScript
- **DB relațională:** D1 (SQLite)
- **Stare live per cameră:** Durable Objects + WebSocket
- **Cache:** Workers KV (răspunsuri TMDb, ca să evităm rate-limit)
- **Date filme:** TMDb API

## Schema D1 (orientativ)

- **users** — `id`, `username`, `created_at`
- **profiles** — `user_id`, `genre_scores` (JSON), `era_pref`, `mood_pref`, `media_type_pref`
- **rooms** — `id`, `join_code`, `user_a_id`, `user_b_id` (null = solo), `platform_filter`, `media_type`, `deck` (JSON), `status`
- **swipes** — `room_id`, `user_id`, `tmdb_id`, `media_type`, `direction`
- **matches** — `room_id`, `tmdb_id`, `media_type`, `matched_at`

## Rute API (Worker)

- `POST /api/users` — creează user
- `POST /api/profile/quiz` — salvează profil simplu de gusturi
- `POST /api/rooms` — creează cameră + cod de invite
- `POST /api/rooms/join` — intri într-o cameră cu cod
- `GET /api/rooms/:id/deck` — deck de titluri (pool comun), filtrat pe profil + platformă
- `POST /api/rooms/:id/swipe` — înregistrează swipe, calculează match live prin DO
- `GET /api/rooms/:id/matches` — lista de match-uri + unde poate fi văzut
- `GET /api/rooms/:id/ws` — conexiune WebSocket pentru notificări live de match

## Cerințe HARD (decizii luate / bug-uri deja identificate)

1. **Durable Objects DOAR cu SQLite storage backend** (free tier). În wrangler
   config, migrations cu `new_sqlite_classes`, **NU** `new_classes`.
2. **Pool-ul de candidați (deck-ul) se generează O SINGURĂ DATĂ per cameră** și se
   salvează (listă de `tmdb_id` pe `rooms` sau în DO). Ambii useri trag din
   **ACELAȘI pool** — asta garantează suprapunerea necesară pentru match. Ordinea
   poate diferi/shuffle per user; contează pool-ul comun, nu ordinea.
3. **Durable Object folosește WebSocket Hibernation API** (fără compute cât camera
   e idle).
4. **Auth gating:** la fiecare `/swipe` se verifică server-side că `user_id`
   aparține camerei.
5. **Secrets:** cheia TMDb **niciodată** în cod și niciodată expusă în frontend.
   Frontend → Worker → TMDb. Local în `.dev.vars` (gitignored), în prod prin
   `wrangler secret put`.
6. **Atribuire TMDb în footer:** „This product uses the TMDB API but is not
   endorsed or certified by TMDB" + link către themoviedb.org.

## Standarde de repo

- **GitHub Actions:** pe PR → lint + typecheck + build; pe merge în main → deploy
  Workers + Pages.
- **Conventional commits.**
- `.gitignore` corect: `node_modules`, `.dev.vars`, `.wrangler`, `dist`.
- **IaC în repo:** wrangler config + `schema.sql` versionate.
- **README** clar cu pași de setup local.
- **Branch protection:** lucrăm prin PR pe branch-uri de feature, nu direct pe main.

## Faze

- [ ] **Faza 0 — Schelet + tooling.** Structura de foldere, `package.json`,
      wrangler config, tsconfig, ESLint, GitHub Actions, `.gitignore`, README,
      PLAN.md. *(în lucru / PR curent)*
- [ ] **Faza 1 — D1.** `schema.sql` + migrare.
- [ ] **Faza 2 — Worker + rute Hono.** users, profil simplu, rooms create/join.
- [ ] **Faza 3 — TMDb service.** cache KV + generarea pool-ului de deck per cameră.
- [ ] **Faza 4 — Durable Object.** stare live, WebSocket hibernation, detecție match.
- [ ] **Faza 5 — Frontend.** swipe pe Pages + match screen + solo mode + toggle
      film/serial.

## Roadmap (NU în scope acum)

### V2

- Quiz real cu scoring (înlocuiește profilul default hardcodat)
- Import CSV Letterboxd ca alternativă la quiz
- Watch-provider filtering complet funcțional
- Toggle film/serial funcțional (schimbă `media_type` real în DB)
- WebSocket live testat end-to-end
- UI mai finisat (posibil migrare pe React/Svelte pe Pages)

### V3

- Integrare Plex (verifică ce ai deja pe server)
- Auto-queue în Radarr/Sonarr la match
- Mod grup (3–5 useri)
- Collaborative filtering pe istoricul de swipe-uri
- Watchlist persistent pentru solo mode
- Autentificare reală (momentan doar cod de invite + username)
