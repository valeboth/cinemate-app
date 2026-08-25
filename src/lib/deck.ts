// Building the shared candidate pool (deck) per room.
//
// HARD: the pool is generated ONCE per room and saved (rooms.deck = list of tmdb_id).
// Both users draw from the SAME pool → this guarantees the overlap needed for a match.
// The order may be shuffled per user; what matters is the shared pool, not the order.

import type { DeckCard, Env, MediaType, Profile, Room } from "../types";
import { discoverTitles, getGenreMap, getTitleCard, PERIOD_RANGES } from "../services/tmdb";
import { mapProfile } from "./mappers";

const TOP_GENRES = 3;
const MIN_DECK = 5;
const DECK_CARDS_KV_PREFIX = "deck-cards:";
const DECK_CARDS_TTL = 60 * 60 * 24 * 7; // 7 days

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

/** Periods: union of both users' selected intervals (kept only if known). */
function unionPeriods(a: Profile | null, b: Profile | null): string[] {
  const set = new Set<string>();
  for (const p of [a, b]) for (const k of p?.prefs.periods ?? []) if (PERIOD_RANGES[k]) set.add(k);
  return [...set];
}

/** Build the pool: one discover per selected period (union), or a single discover if none. */
async function generatePool(
  env: Env,
  room: Room,
  genreIds: number[],
  avoidGenres: number[],
  periods: string[],
): Promise<DeckCard[]> {
  if (periods.length === 0) {
    return discoverTitles(env, {
      mediaType: room.media_type,
      genreIds,
      avoidGenres,
      platform: room.platform_filter,
      pages: 2,
    });
  }
  // Cap pages/interval so many intervals don't blow the subrequest budget.
  const pagesPer = periods.length > 4 ? 1 : 2;
  const bounds = periods.map((key): [number, number] => {
    const r = PERIOD_RANGES[key];
    return [r?.gte ? Number(r.gte.slice(0, 4)) : 0, r?.lte ? Number(r.lte.slice(0, 4)) : 9999];
  });
  const seen = new Set<number>();
  const cards: DeckCard[] = [];
  for (const key of periods) {
    const range = PERIOD_RANGES[key];
    if (!range) continue;
    const part = await discoverTitles(env, {
      mediaType: room.media_type,
      genreIds,
      avoidGenres,
      platform: room.platform_filter,
      dateGte: range.gte ?? null,
      dateLte: range.lte ?? null,
      pages: pagesPer,
    });
    for (const c of part) if (!seen.has(c.tmdb_id)) { seen.add(c.tmdb_id); cards.push(c); }
  }
  // Post-filter on the displayed year: the TMDb filter is on primary_release_date,
  // but release_year comes from the RO-localized release_date (they can differ).
  return cards.filter((c) => {
    const y = c.release_year;
    return y != null && bounds.some(([mn, mx]) => y >= mn && y <= mx);
  });
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

  // First generation.
  const [profileA, profileB] = await Promise.all([
    loadProfile(env, room.user_a_id),
    loadProfile(env, room.user_b_id),
  ]);
  const genreIds = combineTopGenres(profileA, profileB);
  const avoidGenres = unionAvoidGenres(profileA, profileB);
  const periods = unionPeriods(profileA, profileB);

  let cards = await generatePool(env, room, genreIds, avoidGenres, periods);

  // Too few → first relax liked-genres/platform but KEEP the periods (never show
  // out-of-period years) and avoid_genres (a "no" must always hold).
  if (cards.length < MIN_DECK && genreIds.length > 0) {
    cards = await generatePool(env, room, [], avoidGenres, periods);
  }
  // Only when no period is set do the broad fallback (drop everything except avoid).
  if (cards.length < MIN_DECK && periods.length === 0) {
    cards = await discoverTitles(env, { mediaType: room.media_type, avoidGenres, pages: 2 });
  }

  const ids = cards.map((c) => c.tmdb_id);
  await env.DB.prepare("UPDATE rooms SET deck = ? WHERE id = ?")
    .bind(JSON.stringify(ids), room.id)
    .run();
  await env.TMDB_CACHE.put(cardsKey, JSON.stringify(cards), { expirationTtl: DECK_CARDS_TTL });

  return { room_id: room.id, media_type: room.media_type, generated: true, cards };
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
