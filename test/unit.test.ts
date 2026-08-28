import { describe, expect, it } from "vitest";
import { genJoinCode, genId } from "../src/lib/ids";
import { mapProfile, mapRoom } from "../src/lib/mappers";
import { topupCursor } from "../src/lib/deck";

describe("ids", () => {
  it("genJoinCode is 6 chars from the safe alphabet", () => {
    const code = genJoinCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/); // no O/0, I/1
  });
  it("genId is a UUID", () => {
    expect(genId()).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("mappers", () => {
  it("mapRoom parses deck JSON + null user_b", () => {
    const room = mapRoom({
      id: "r1", join_code: "ABC123", user_a_id: "a", user_b_id: null,
      platform_filter: null, media_type: "movie", deck: "[1,2,3]", status: "waiting", created_at: "x",
    });
    expect(room.user_b_id).toBeNull();
    expect(room.deck).toEqual([1, 2, 3]);
  });

  it("mapProfile parses prefs (avoid_genres + seeds) and bad JSON safely", () => {
    const p = mapProfile({
      user_id: "u1",
      genre_scores: '{"28":1}',
      prefs: '{"avoid_genres":[27],"seeds":[{"tmdb_id":550,"media_type":"movie","title":"Fight Club"}]}',
    });
    expect(p.genre_scores).toEqual({ "28": 1 });
    expect(p.prefs.avoid_genres).toEqual([27]);
    expect(p.prefs.seeds?.[0]).toMatchObject({ tmdb_id: 550, media_type: "movie" });

    const bad = mapProfile({ user_id: "u2", genre_scores: "not json", prefs: "{" });
    expect(bad.genre_scores).toEqual({});
    expect(bad.prefs).toEqual({});
  });
});

describe("deck top-up cursor", () => {
  it("advances the start page with the pool size (~20/TMDb page)", () => {
    expect(topupCursor(0).startPage).toBe(1);
    expect(topupCursor(19).startPage).toBe(1);
    expect(topupCursor(20).startPage).toBe(2);
    expect(topupCursor(45).startPage).toBe(3);
  });
  it("rotates sort_by across rounds for a varied pool", () => {
    const sorts = [0, 20, 40, 60].map((n) => topupCursor(n).sortBy);
    expect(new Set(sorts).size).toBeGreaterThan(1); // not always popularity.desc
    expect(sorts.every((s) => typeof s === "string" && s.includes("."))).toBe(true);
  });
});
