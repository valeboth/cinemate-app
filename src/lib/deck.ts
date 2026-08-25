// Building the shared candidate pool (deck) per room.
//
// HARD: the pool is generated ONCE per room and saved (rooms.deck = list of tmdb_id).
// Both users draw from the SAME pool → this guarantees the overlap needed for a match.
// The order may be shuffled per user; what matters is the shared pool, not the order.

import type { DeckCard, Env, MediaType, Profile, Room } from "../types";
import { discoverTitles, getGenreMap, getTitleCard } from "../services/tmdb";
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

/**
 * Union pool: each user's own slice (their top genres) + a "common ground" slice
 * (both users' averaged top genres). It's ONE shared pool → matches stay possible;
 * per-user ordering (rankByProfile) makes each user see their own taste first.
 */
async function generatePool(
  env: Env,
  room: Room,
  a: Profile | null,
  b: Profile | null,
  avoidGenres: number[],
): Promise<DeckCard[]> {
  const slices: number[][] = [topGenresOf(a)];
  if (b) slices.push(topGenresOf(b));
  slices.push(combineTopGenres(a, b)); // common ground

  const seen = new Set<number>();
  const cards: DeckCard[] = [];
  for (const genreIds of slices) {
    const part = await discoverTitles(env, {
      mediaType: room.media_type,
      genreIds,
      avoidGenres,
      platform: room.platform_filter,
      pages: 2,
    });
    for (const c of part) if (!seen.has(c.tmdb_id)) { seen.add(c.tmdb_id); cards.push(c); }
  }
  return cards;
}

/** Order cards by how well they match a user's genre_scores (their taste first). */
function rankByProfile(cards: DeckCard[], profile: Profile | null): DeckCard[] {
  const scores = profile?.genre_scores;
  if (!scores || Object.keys(scores).length === 0) return cards;
  const scoreOf = (c: DeckCard) => c.genres.reduce((sum, g) => sum + (Number(scores[g]) || 0), 0);
  return cards
    .map((c, i) => ({ c, i, s: scoreOf(c) }))
    .sort((x, y) => y.s - x.s || x.i - y.i) // stable: taste desc, then original (popularity)
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
  let cards = rankByProfile(deck.cards, profile);

  const { results } = await env.DB.prepare(
    "SELECT tmdb_id FROM swipes WHERE room_id = ? AND user_id = ?",
  )
    .bind(room.id, userId)
    .all<{ tmdb_id: number }>();
  const seen = new Set((results ?? []).map((r) => r.tmdb_id));
  cards = cards.filter((c) => !seen.has(c.tmdb_id));

  return { ...deck, cards };
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
