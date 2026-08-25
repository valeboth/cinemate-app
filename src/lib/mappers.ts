// Map D1 rows (Record<string, unknown>) → application types.

import type { MediaType, Profile, ProfilePrefs, Room, RoomStatus } from "../types";

function parseJsonObject(value: unknown): Record<string, number> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

export function mapRoom(row: Record<string, unknown>): Room {
  return {
    id: String(row.id),
    join_code: String(row.join_code),
    user_a_id: String(row.user_a_id),
    user_b_id: row.user_b_id == null ? null : String(row.user_b_id),
    platform_filter: row.platform_filter == null ? null : String(row.platform_filter),
    media_type: String(row.media_type) as MediaType,
    deck: parseJsonArray(row.deck),
    status: String(row.status) as RoomStatus,
    created_at: String(row.created_at),
  };
}

function parsePrefs(value: unknown): ProfilePrefs {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const p = parsed as Record<string, unknown>;
    const out: ProfilePrefs = {};
    if (Array.isArray(p.avoid_genres)) {
      out.avoid_genres = p.avoid_genres.map(Number).filter((n) => Number.isFinite(n));
    }
    if (Array.isArray(p.seeds)) {
      out.seeds = p.seeds
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          tmdb_id: Number(s.tmdb_id),
          media_type: s.media_type === "tv" ? ("tv" as const) : ("movie" as const),
          title: typeof s.title === "string" ? s.title : undefined,
        }))
        .filter((s) => Number.isFinite(s.tmdb_id) && s.tmdb_id > 0);
    }
    return out;
  } catch {
    return {};
  }
}

export function mapProfile(row: Record<string, unknown>): Profile {
  return {
    user_id: String(row.user_id),
    genre_scores: parseJsonObject(row.genre_scores),
    prefs: parsePrefs(row.prefs),
  };
}
