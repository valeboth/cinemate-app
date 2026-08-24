// Generarea pool-ului comun de deck per cameră.
//
// HARD: pool-ul se generează O SINGURĂ DATĂ per cameră și se salvează (rooms.deck
// = listă de tmdb_id). Ambii useri trag din ACELAȘI pool → garantează suprapunerea
// necesară pentru match. Ordinea poate diferi/shuffle per user; contează pool-ul.

import type { DeckCard, Env, MediaType, Profile, Room } from "../types";
import { discoverTitles, getTitleCard } from "../services/tmdb";
import { mapProfile } from "./mappers";

const TOP_GENRES = 3;
const MIN_DECK = 5;
const DECK_CARDS_KV_PREFIX = "deck-cards:";
const DECK_CARDS_TTL = 60 * 60 * 24 * 7; // 7 zile

async function loadProfile(env: Env, userId: string | null): Promise<Profile | null> {
  if (!userId) return null;
  const row = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? mapProfile(row) : null;
}

/** Combină genre_scores ale ambilor useri (medie) → top genre ids. */
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

async function rebuildCardsForPool(env: Env, room: Room): Promise<DeckCard[]> {
  const results = await Promise.all(
    room.deck.map((id) => getTitleCard(env, room.media_type, id)),
  );
  return results.filter((c): c is DeckCard => c !== null);
}

export interface DeckResult {
  room_id: string;
  media_type: MediaType;
  /** true dacă pool-ul tocmai a fost generat la acest apel. */
  generated: boolean;
  cards: DeckCard[];
}

/**
 * Servește deck-ul camerei: dacă pool-ul există deja (rooms.deck) îl întoarce,
 * altfel îl generează O SINGURĂ DATĂ (combină profiluri → discover → salvează).
 */
export async function getOrCreateDeck(env: Env, room: Room): Promise<DeckResult> {
  const cardsKey = DECK_CARDS_KV_PREFIX + room.id;

  // Deja generat.
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

  // Prima generare.
  const [profileA, profileB] = await Promise.all([
    loadProfile(env, room.user_a_id),
    loadProfile(env, room.user_b_id),
  ]);
  const genreIds = combineTopGenres(profileA, profileB);

  let cards = await discoverTitles(env, {
    mediaType: room.media_type,
    genreIds,
    platform: room.platform_filter,
    pages: 2,
  });

  // Fallback: filtrele au dat prea puține → reia fără platformă/genuri.
  if (cards.length < MIN_DECK) {
    cards = await discoverTitles(env, { mediaType: room.media_type, pages: 2 });
  }

  const ids = cards.map((c) => c.tmdb_id);
  await env.DB.prepare("UPDATE rooms SET deck = ? WHERE id = ?")
    .bind(JSON.stringify(ids), room.id)
    .run();
  await env.TMDB_CACHE.put(cardsKey, JSON.stringify(cards), { expirationTtl: DECK_CARDS_TTL });

  return { room_id: room.id, media_type: room.media_type, generated: true, cards };
}
