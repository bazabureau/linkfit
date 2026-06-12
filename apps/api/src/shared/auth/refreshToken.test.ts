import { describe, expect, it } from "vitest";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenHashEquals,
} from "./refreshToken.js";

describe("generateRefreshToken", () => {
  it("returns a token and matching sha256 hash", () => {
    const { token, hash } = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hash.length).toBe(32);
    expect(hash.equals(hashRefreshToken(token))).toBe(true);
  });

  it("produces high-entropy unique tokens across many invocations", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateRefreshToken().token);
    }
    expect(tokens.size).toBe(1000);
  });
});

describe("hashRefreshToken", () => {
  it("is deterministic for the same input", () => {
    const t = "fake-token-xyz";
    expect(hashRefreshToken(t).equals(hashRefreshToken(t))).toBe(true);
  });

  it("differs for different inputs", () => {
    expect(hashRefreshToken("a").equals(hashRefreshToken("b"))).toBe(false);
  });
});

describe("refreshTokenHashEquals", () => {
  it("returns true for identical buffers", () => {
    const a = hashRefreshToken("x");
    const b = hashRefreshToken("x");
    expect(refreshTokenHashEquals(a, b)).toBe(true);
  });

  it("returns false for different buffers", () => {
    const a = hashRefreshToken("x");
    const b = hashRefreshToken("y");
    expect(refreshTokenHashEquals(a, b)).toBe(false);
  });

  it("returns false for buffers of different length", () => {
    expect(refreshTokenHashEquals(Buffer.from([1]), Buffer.from([1, 2]))).toBe(false);
  });
});
