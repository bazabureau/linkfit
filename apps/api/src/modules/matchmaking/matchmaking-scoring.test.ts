import { describe, expect, it } from "vitest";
import { startTimeScore } from "./matchmaking.service.js";

describe("startTimeScore", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const hoursFromNow = (hours: number): Date =>
    new Date(now.getTime() + hours * 60 * 60 * 1000);

  it("rejects games that already started", () => {
    expect(startTimeScore(hoursFromNow(-1), now)).toBe(0);
    expect(startTimeScore(now, now)).toBe(0);
  });

  it("gives a partial boost to games that start too soon", () => {
    expect(startTimeScore(hoursFromNow(1), now)).toBe(0.5);
  });

  it("gives full boost to actionable near-future games", () => {
    expect(startTimeScore(hoursFromNow(2), now)).toBe(1);
    expect(startTimeScore(hoursFromNow(24), now)).toBe(1);
    expect(startTimeScore(hoursFromNow(48), now)).toBe(1);
  });

  it("tapers week-out and later games without dropping them entirely", () => {
    expect(startTimeScore(hoursFromNow(168), now)).toBe(0.3);
    expect(startTimeScore(hoursFromNow(336), now)).toBe(0.1);
    expect(startTimeScore(hoursFromNow(400), now)).toBe(0.05);
  });
});
