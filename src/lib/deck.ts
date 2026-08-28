// Building the shared candidate pool (deck) per room.
//
// HARD: the pool is generated ONCE per room and saved (rooms.deck = list of tmdb_id).
// Both users draw from the SAME pool → this guarantees the overlap needed for a match.
// The order may be shuffled per user; what matters is the shared pool, not the order.

import type { DeckCard, Env, MediaType, Profile, Room, SeedTitle } from "../types";
import { discoverTitles, getGenreMap, getRecommendations, getTitleCard } from "../services/tmdb";
import { getRequestedTmdbIds } from "../services/overseerr";
import { mapProfile } from "./mappers";

const MAX_SEEDS_PER_USER = 3;

const TOP_GENRES = 3;
const MIN_DECK = 5;
// Hard cap on the shared pool. The deck tops up on demand (extendDeck) but never
// past this — keeps TMDb calls, KV writes and D1 row size bounded on the free tier.
// ~300 → ~15 TMDb pages, ~7 KV writes/room, a ~90KB deck-cards value: all well
// within the free tier (tightest limit is KV writes, 1k/day).
const MAX_DECK = 300;
// Pages pulled per top-up call (20 titles/page). Small → cheap, cache-friendly.
const TOPUP_PAGES = 2;
// Rotated across generation slices + top-up rounds so the pool isn't all "popular".
const SORTS = ["popularity.desc", "vote_average.desc", "primary_release_date.desc"];
const DECK_CARDS_KV_PREFIX = "deck-cards:";
const DECK_CARDS_TTL = 60 * 60 * 24 * 7; // 7 days

/**
 * Where the next top-up should read from. Derived from the current pool size
 * (~20 titles/TMDb page) so we don't re-fetch pages we already have, and the
 * sort rotates each round for variety. Pure → unit-tested.
 */
export function topupCursor(poolSize: number): { startPage: number; sortBy: string } {
  const startPage = Math.floor(poolSize / 20) + 1;
  return { startPage, sortBy: SORTS[startPage % SORTS.length] };
}

async function loadProfile(env: Env, userId: string | null): Promise<Profile | null> {
  if (!userId) return null;
  const row = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? mapProfile(row) : null;
}

/** Combine both users' genre_scores (average) → top genre ids. */
function combineTopGenres(a: Profile | null, b: Profile | null): number[] {
  const totals = new Map<number, { sum: number; count: number }>();
  for (const p of [a, b]) {
    if (!p) continue;
    for (const [gid, score] of Object.entries(p.genre_scores)) {
      const id = Number(gid);
      if (!Number.isFinite(id)) continue;
      const cur = totals.get(id) ?? { sum: 0, count: 0 };
      cur.sum += Number(score) || 0;
      cur.count += 1;
      totals.set(id, cur);
    }
  }
  return [...totals.entries()]
    .map(([id, { sum, count }]) => ({ id, avg: sum / count }))
    .sort((x, y) => y.avg - x.avg)
    .slice(0, TOP_GENRES)
    .map((g) => g.id);
}

/** Avoid genres: strict union — if either user avoids a genre, it's excluded for both. */
function unionAvoidGenres(a: Profile | null, b: Profile | null): number[] {
  const set = new Set<number>();
  for (const p of [a, b]) for (const g of p?.prefs.avoid_genres ?? []) set.add(g);
  return [...set];
}

/** Top genres of a single profile (highest scores first). */
function topGenresOf(p: Profile | null, n = TOP_GENRES): number[] {
  if (!p) return [];
  return Object.entries(p.genre_scores)
    .map(([id, s]) => ({ id: Number(id), s: Number(s) || 0 }))
    .filter((x) => Number.isFinite(x.id) && x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.id);
}

/** Collect both users' seed titles (capped per user, deduped). */
function collectSeeds(a: Profile | null, b: Profile | null): SeedTitle[] {
  const out: SeedTitle[] = [];
  const seen = new Set<string>();
  for (const p of [a, b]) {
    let n = 0;
    for (const s of p?.prefs.seeds ?? []) {
      if (n >= MAX_SEEDS_PER_USER) break;
      const key = `${s.media_type}:${s.tmdb_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      n++;
    }
  }
  return out;
}

/**
 * Build the shared pool.
 *  - With seeds (strongest signal): recommendations of both users' seeds drive the pool
 *    + a common-ground genre slice; avoid_genres always applied.
 *  - Without seeds: union of each user's top-genre slice + a common-ground slice.
 * One shared pool → matches stay possible; per-user weighted shuffle at serve time.
 */
async function generatePool(
  env: Env,
  room: Room,
  a: Profile | null,
  b: Profile | null,
  avoidGenres: number[],
): Promise<DeckCard[]> {
  const seen = new Set<number>();
  const cards: DeckCard[] = [];
  const addAll = (arr: DeckCard[]) => {
    for (const c of arr) if (!seen.has(c.tmdb_id)) { seen.add(c.tmdb_id); cards.push(c); }
  };

  // Seeds only apply to titles of the room's media type (recs of a movie are movies).
  const seeds = collectSeeds(a, b).filter((s) => s.media_type === room.media_type);

  if (seeds.length > 0) {
    for (const s of seeds) addAll(await getRecommendations(env, room.media_type, s.tmdb_id));
    // Common ground so overlap exists even if the two users' seeds diverge.
    addAll(
      await discoverTitles(env, {
        mediaType: room.media_type,
        genreIds: combineTopGenres(a, b),
        avoidGenres,
        platform: room.platform_filter,
        pages: 2,
      }),
    );
    // Recommendations aren't genre-filtered by the API → enforce avoid_genres here.
    if (avoidGenres.length > 0) {
      const av = new Set(avoidGenres);
      return cards.filter((c) => !c.genres.some((g) => av.has(g)));
    }
    return cards;
  }

  // No applicable seeds → union of genre slices (per-user tastes + common ground).
  // Each slice uses a different sort so the pool spans popular / acclaimed / recent.
  const slices: number[][] = [topGenresOf(a)];
  if (b) slices.push(topGenresOf(b));
  slices.push(combineTopGenres(a, b));
  for (let i = 0; i < slices.length; i++) {
    addAll(
      await discoverTitles(env, {
        mediaType: room.media_type,
        genreIds: slices[i],
        avoidGenres,
        platform: room.platform_filter,
        pages: 2,
        sortBy: SORTS[i % SORTS.length],
      }),
    );
  }
  return cards;
}

/**
 * Weighted random order: taste-biased but shuffled, so it differs each time and
 * between the two users (they still converge — same pool). Base weight 1 keeps
 * every title reachable; taste lifts a user's favourites toward the top.
 */
function weightedShuffle(cards: DeckCard[], profile: Profile | null): DeckCard[] {
  const scores = profile?.genre_scores ?? {};
  return cards
    .map((c) => {
      const taste = c.genres.reduce((sum, g) => sum + (Number(scores[g]) || 0), 0);
      const weight = 1 + taste;
      // Efraimidis–Spirakis weighted sampling key: random^(1/weight).
      return { c, key: Math.pow(Math.random(), 1 / weight) };
    })
    .sort((x, y) => y.key - x.key)
    .map((x) => x.c);
}

async function rebuildCardsForPool(env: Env, room: Room): Promise<DeckCard[]> {
  const results = await Promise.all(
    room.deck.map((id) => getTitleCard(env, room.media_type, id)),
  );
  return results.filter((c): c is DeckCard => c !== null);
}

export interface DeckResult {
  room_id: string;
  media_type: MediaType;
  /** true if the pool was just generated on this call. */
  generated: boolean;
  cards: DeckCard[];
}

/**
 * Serve the room deck: if the pool already exists (rooms.deck) return it,
 * otherwise generate it ONCE (combine profiles → discover → save).
 */
export async function getOrCreateDeck(env: Env, room: Room): Promise<DeckResult> {
  const cardsKey = DECK_CARDS_KV_PREFIX + room.id;

  // Already generated.
  if (room.deck.length > 0) {
    const cached = await env.TMDB_CACHE.get(cardsKey);
    const cards = cached
      ? (JSON.parse(cached) as DeckCard[])
      : await rebuildCardsForPool(env, room);
    if (!cached && cards.length > 0) {
      await env.TMDB_CACHE.put(cardsKey, JSON.stringify(cards), { expirationTtl: DECK_CARDS_TTL });
    }
    return { room_id: room.id, media_type: room.media_type, generated: false, cards };
  }

  // First generation: union pool from both users' tastes + common ground.
  const [profileA, profileB] = await Promise.all([
    loadProfile(env, room.user_a_id),
    loadProfile(env, room.user_b_id),
  ]);
  const avoidGenres = unionAvoidGenres(profileA, profileB);

  let cards = await generatePool(env, room, profileA, profileB, avoidGenres);

  // Too few → broad fallback (keep only avoid_genres, a "no" must always hold).
  if (cards.length < MIN_DECK) {
    cards = await discoverTitles(env, { mediaType: room.media_type, avoidGenres, pages: 2 });
  }

  const ids = cards.map((c) => c.tmdb_id);
  await env.DB.prepare("UPDATE rooms SET deck = ? WHERE id = ?")
    .bind(JSON.stringify(ids), room.id)
    .run();
  await env.TMDB_CACHE.put(cardsKey, JSON.stringify(cards), { expirationTtl: DECK_CARDS_TTL });

  return { room_id: room.id, media_type: room.media_type, generated: true, cards };
}

/**
 * Serve the deck to a specific user: same shared pool, but ordered by THIS user's
 * taste (their films first) and with their already-swiped titles excluded.
 */
export async function getDeckForUser(
  env: Env,
  room: Room,
  userId: string | null,
): Promise<DeckResult> {
  const deck = await getOrCreateDeck(env, room);
  if (!userId) return deck;

  const profile = await loadProfile(env, userId);
  let cards = weightedShuffle(deck.cards, profile);

  const [{ results }, requested] = await Promise.all([
    env.DB.prepare("SELECT tmdb_id FROM swipes WHERE room_id = ? AND user_id = ?")
      .bind(room.id, userId)
      .all<{ tmdb_id: number }>(),
    getRequestedTmdbIds(env), // already requested/available in Overseerr (best-effort)
  ]);
  const seen = new Set((results ?? []).map((r) => r.tmdb_id));
  cards = cards.filter((c) => !seen.has(c.tmdb_id) && !requested.has(c.tmdb_id));

  return { ...deck, cards };
}

/**
 * Top up the shared pool on demand: fetch the next TMDb page(s) of the common-ground
 * slice, dedupe against the existing pool, persist the extended pool (D1 + KV), and
 * return ONLY the new cards for THIS user (their swipes + Overseerr ids excluded).
 * Capped at MAX_DECK so the pool — and TMDb/KV/D1 usage — stays bounded on the free tier.
 * Both users share the same extended pool, so matches remain possible.
 */
export async function extendDeck(
  env: Env,
  room: Room,
  userId: string | null,
): Promise<DeckResult> {
  const base = await getOrCreateDeck(env, room);
  const existingIds = new Set(base.cards.map((c) => c.tmdb_id));

  const empty: DeckResult = {
    room_id: room.id,
    media_type: room.media_type,
    generated: false,
    cards: [],
  };
  if (existingIds.size >= MAX_DECK) return empty; // pool already at the cap

  const [profileA, profileB] = await Promise.all([
    loadProfile(env, room.user_a_id),
    loadProfile(env, room.user_b_id),
  ]);
  const avoidGenres = unionAvoidGenres(profileA, profileB);
  const { startPage, sortBy } = topupCursor(existingIds.size);

  const fresh = await discoverTitles(env, {
    mediaType: room.media_type,
    genreIds: combineTopGenres(profileA, profileB),
    avoidGenres,
    platform: room.platform_filter,
    pages: TOPUP_PAGES,
    startPage,
    sortBy,
  });

  const added: DeckCard[] = [];
  for (const c of fresh) {
    if (existingIds.size >= MAX_DECK) break;
    if (existingIds.has(c.tmdb_id)) continue;
    existingIds.add(c.tmdb_id);
    added.push(c);
  }
  if (added.length === 0) return empty; // deep pages exhausted or all duplicates

  const allCards = [...base.cards, ...added];
  const ids = allCards.map((c) => c.tmdb_id);
  await env.DB.prepare("UPDATE rooms SET deck = ? WHERE id = ?")
    .bind(JSON.stringify(ids), room.id)
    .run();
  await env.TMDB_CACHE.put(DECK_CARDS_KV_PREFIX + room.id, JSON.stringify(allCards), {
    expirationTtl: DECK_CARDS_TTL,
  });

  // Serve the new cards to this user, excluding anything they've already swiped/requested.
  let cards = added;
  if (userId) {
    const [{ results }, requested] = await Promise.all([
      env.DB.prepare("SELECT tmdb_id FROM swipes WHERE room_id = ? AND user_id = ?")
        .bind(room.id, userId)
        .all<{ tmdb_id: number }>(),
      getRequestedTmdbIds(env),
    ]);
    const seenByUser = new Set((results ?? []).map((r) => r.tmdb_id));
    cards = added.filter((c) => !seenByUser.has(c.tmdb_id) && !requested.has(c.tmdb_id));
  }

  return { room_id: room.id, media_type: room.media_type, generated: false, cards };
}

/** Find a card in the room's deck cache (for the match screen). */
export async function getCardFromDeck(
  env: Env,
  roomId: string,
  tmdbId: number,
): Promise<DeckCard | null> {
  const cached = await env.TMDB_CACHE.get(DECK_CARDS_KV_PREFIX + roomId);
  if (!cached) return null;
  const cards = JSON.parse(cached) as DeckCard[];
  return cards.find((c) => c.tmdb_id === tmdbId) ?? null;
}

/** Reset the room pool (rooms.deck=[] + card cache) → regenerated on the next /deck. */
export async function resetDeck(env: Env, roomId: string): Promise<void> {
  await env.DB.prepare("UPDATE rooms SET deck = '[]' WHERE id = ?").bind(roomId).run();
  await env.TMDB_CACHE.delete(DECK_CARDS_KV_PREFIX + roomId);
}

/**
 * "Why did this match" explanation: shared taste (genres) + rating.
 * Algorithm transparency — the differentiator from the brief.
 */
export async function buildMatchReason(env: Env, room: Room, card: DeckCard | null): Promise<string> {
  const parts: string[] = [];
  if (card && card.genres.length > 0) {
    const [profileA, profileB] = await Promise.all([
      loadProfile(env, room.user_a_id),
      loadProfile(env, room.user_b_id),
    ]);
    const top = combineTopGenres(profileA, profileB);
    const shared = card.genres.filter((g) => top.includes(g));
    if (shared.length > 0) {
      const gmap = await getGenreMap(env, room.media_type);
      const names = shared.map((id) => gmap[id]).filter(Boolean);
      if (names.length > 0) parts.push("shared taste: " + names.join(", "));
    }
  }
  if (card?.vote_average) parts.push(`rating ${card.vote_average.toFixed(1)}`);
  return parts.join(" · ") || "you both liked it";
}
