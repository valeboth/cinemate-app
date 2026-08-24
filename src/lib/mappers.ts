// Map D1 rows (Record<string, unknown>) → application types.

import type { MediaType, Profile, Room, RoomStatus } from "../types";

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

export function mapProfile(row: Record<string, unknown>): Profile {
  return {
    user_id: String(row.user_id),
    genre_scores: parseJsonObject(row.genre_scores),
    era_pref: row.era_pref == null ? null : String(row.era_pref),
    mood_pref: row.mood_pref == null ? null : String(row.mood_pref),
    media_type_pref: row.media_type_pref == null ? null : (String(row.media_type_pref) as MediaType),
  };
}
