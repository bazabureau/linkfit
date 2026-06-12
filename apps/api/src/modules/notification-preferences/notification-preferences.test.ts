import { describe, it, expect } from "vitest";
import { isInQuietHours } from "./notification-preferences.service.js";

/**
 * Pure unit tests for the quiet-hours decision. Building a clock is
 * trivial — `new Date(Date.UTC(...))` lets us pin the hour without
 * worrying about test runner timezone. We test all three windows:
 *   - non-wrapping (start < end), e.g. 08–22
 *   - wrapping (start > end), e.g. 22–08
 *   - degenerate (start === end), which we define as 24-hour mute
 */
describe("isInQuietHours", () => {
  function at(hour: number): Date {
    return new Date(Date.UTC(2024, 0, 1, hour, 0, 0));
  }

  describe("non-wrapping window 08..22", () => {
    it("is silent at 08:00 (inclusive start)", () => {
      expect(isInQuietHours(at(8), 8, 22)).toBe(true);
    });
    it("is silent at 12:00", () => {
      expect(isInQuietHours(at(12), 8, 22)).toBe(true);
    });
    it("is loud at 22:00 (exclusive end)", () => {
      expect(isInQuietHours(at(22), 8, 22)).toBe(false);
    });
    it("is loud at 07:00 (before start)", () => {
      expect(isInQuietHours(at(7), 8, 22)).toBe(false);
    });
    it("is loud at 23:00 (after end)", () => {
      expect(isInQuietHours(at(23), 8, 22)).toBe(false);
    });
  });

  describe("wrapping window 22..08 (overnight silence)", () => {
    it("is silent at 22:00 (start)", () => {
      expect(isInQuietHours(at(22), 22, 8)).toBe(true);
    });
    it("is silent at 23:00", () => {
      expect(isInQuietHours(at(23), 22, 8)).toBe(true);
    });
    it("is silent at 00:00", () => {
      expect(isInQuietHours(at(0), 22, 8)).toBe(true);
    });
    it("is silent at 07:00", () => {
      expect(isInQuietHours(at(7), 22, 8)).toBe(true);
    });
    it("is loud at 08:00 (exclusive end)", () => {
      expect(isInQuietHours(at(8), 22, 8)).toBe(false);
    });
    it("is loud at 14:00 (mid-day)", () => {
      expect(isInQuietHours(at(14), 22, 8)).toBe(false);
    });
    it("is loud at 21:00 (one hour before start)", () => {
      expect(isInQuietHours(at(21), 22, 8)).toBe(false);
    });
  });

  describe("degenerate window start === end", () => {
    it("treats 0..0 as 24-hour mute", () => {
      for (let h = 0; h < 24; h++) {
        expect(isInQuietHours(at(h), 0, 0)).toBe(true);
      }
    });
    it("treats 13..13 as 24-hour mute (any value, same semantics)", () => {
      expect(isInQuietHours(at(0), 13, 13)).toBe(true);
      expect(isInQuietHours(at(13), 13, 13)).toBe(true);
      expect(isInQuietHours(at(20), 13, 13)).toBe(true);
    });
  });
});
