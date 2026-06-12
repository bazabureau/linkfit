import { describe, expect, it } from "vitest";
import {
  applyReliabilityDelta,
  classifyCancel,
  deltaForEvent,
  LATE_CANCEL_THRESHOLD_HOURS,
  PENALTY_LATE_CANCEL,
  PENALTY_NO_SHOW,
} from "./reliability.js";

describe("reliability event deltas", () => {
  it("late cancel → -10", () => {
    expect(deltaForEvent({ type: "late_cancel", hours_before_start: 4 })).toBe(-PENALTY_LATE_CANCEL);
  });
  it("no_show → -20", () => {
    expect(deltaForEvent({ type: "no_show" })).toBe(-PENALTY_NO_SHOW);
  });
  it("early cancel → 0", () => {
    expect(deltaForEvent({ type: "early_cancel", hours_before_start: 48 })).toBe(0);
  });
  it("played → +1", () => {
    expect(deltaForEvent({ type: "played" })).toBe(1);
  });
});

describe("applyReliabilityDelta", () => {
  it("clamps at 0 floor", () => {
    expect(applyReliabilityDelta(5, -30)).toBe(0);
  });
  it("clamps at 100 ceiling", () => {
    expect(applyReliabilityDelta(99, 5)).toBe(100);
  });
  it("normal addition in range", () => {
    expect(applyReliabilityDelta(80, -10)).toBe(70);
  });
});

describe("classifyCancel", () => {
  const start = new Date("2026-06-01T18:00:00Z");
  it(`< ${String(LATE_CANCEL_THRESHOLD_HOURS)} h before start → late_cancel`, () => {
    const at = new Date("2026-06-01T15:00:00Z");
    expect(classifyCancel(start, at).type).toBe("late_cancel");
  });
  it(`>= ${String(LATE_CANCEL_THRESHOLD_HOURS)} h before start → early_cancel`, () => {
    const at = new Date("2026-05-31T12:00:00Z");
    expect(classifyCancel(start, at).type).toBe("early_cancel");
  });
});
