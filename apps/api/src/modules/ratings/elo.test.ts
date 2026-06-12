import { describe, expect, it } from "vitest";
import { applyRatingBatch, eloUpdate, expectedScore, kFactor } from "./elo.js";

describe("ELO primitives", () => {
  it("kFactor: 32 while provisional, 16 once established", () => {
    expect(kFactor(0)).toBe(32);
    expect(kFactor(29)).toBe(32);
    expect(kFactor(30)).toBe(16);
    expect(kFactor(1000)).toBe(16);
  });

  it("expectedScore: equal ratings → 0.5", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5);
  });

  it("expectedScore: +400 rating gap → ~0.909 favour for the stronger", () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(0.9091, 3);
  });
});

describe("eloUpdate", () => {
  it("equal ratings, win → +K/2 (8 established, 16 provisional)", () => {
    // K=16 (established): 16 * (1 - 0.5) = 8
    const established = eloUpdate(
      { rating: 1500, gamesPlayed: 30 },
      { rating: 1500, gamesPlayed: 30 },
      "win",
    );
    expect(established.delta).toBe(8);
    expect(established.newRating).toBe(1508);
    // K=32 (provisional): 32 * (1 - 0.5) = 16
    const provisional = eloUpdate(
      { rating: 1500, gamesPlayed: 0 },
      { rating: 1500, gamesPlayed: 30 },
      "win",
    );
    expect(provisional.delta).toBe(16);
  });

  it("provisional player gains more from upsets", () => {
    // Provisional player (k=32) beats a stronger opponent: bigger swing.
    const u = eloUpdate({ rating: 1500, gamesPlayed: 5 }, { rating: 1800, gamesPlayed: 100 }, "win");
    expect(u.delta).toBeGreaterThan(24);
  });

  it("losing to a much weaker opponent costs many points", () => {
    const u = eloUpdate({ rating: 1800, gamesPlayed: 100 }, { rating: 1500, gamesPlayed: 100 }, "loss");
    expect(u.delta).toBeLessThan(-10);
  });

  it("draw between equal opponents → 0 delta", () => {
    const u = eloUpdate({ rating: 1500, gamesPlayed: 100 }, { rating: 1500, gamesPlayed: 100 }, "draw");
    expect(u.delta).toBe(0);
  });

  it("clamps rating to [0, 4000]", () => {
    const u = eloUpdate(
      { rating: 3995, gamesPlayed: 100 },
      { rating: 1500, gamesPlayed: 100 },
      "win",
    );
    expect(u.newRating).toBeLessThanOrEqual(4000);
  });
});

describe("applyRatingBatch idempotency surface", () => {
  it("does not mutate the input map", () => {
    const initial = new Map([
      ["a", { user_id: "a", rating: 1500, games_played: 30, games_won: 10 }],
      ["b", { user_id: "b", rating: 1500, games_played: 30, games_won: 10 }],
    ]);
    const snapshot = JSON.parse(JSON.stringify([...initial])) as unknown;
    applyRatingBatch(initial, [
      { rated_user_id: "a", rater_user_id: "b", outcome: "win" },
    ]);
    expect(JSON.parse(JSON.stringify([...initial]))).toEqual(snapshot);
  });

  it("running the same batch twice on fresh inputs yields the same outputs", () => {
    const build = () =>
      new Map([
        ["a", { user_id: "a", rating: 1500, games_played: 30, games_won: 10 }],
        ["b", { user_id: "b", rating: 1500, games_played: 30, games_won: 10 }],
      ]);
    const rows = [
      { rated_user_id: "a" as const, rater_user_id: "b" as const, outcome: "win" as const },
    ];
    const r1 = applyRatingBatch(build(), rows);
    const r2 = applyRatingBatch(build(), rows);
    expect([...r1.updated.entries()]).toEqual([...r2.updated.entries()]);
  });

  it("increments games_played and games_won correctly", () => {
    const initial = new Map([
      ["a", { user_id: "a", rating: 1500, games_played: 10, games_won: 4 }],
      ["b", { user_id: "b", rating: 1500, games_played: 10, games_won: 4 }],
    ]);
    const out = applyRatingBatch(initial, [
      { rated_user_id: "a", rater_user_id: "b", outcome: "win" },
    ]);
    expect(out.updated.get("a")!.games_played).toBe(11);
    expect(out.updated.get("a")!.games_won).toBe(5);
    expect(out.updated.get("b")!.games_played).toBe(10); // rater unchanged here
  });
});
