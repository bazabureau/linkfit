import { describe, it, expect } from "vitest";
import {
  checkPasswordPolicy,
  hashPassword,
  performDummyVerify,
  verifyPassword,
} from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery 42");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery 42")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery 42");
    expect(await verifyPassword(hash, "correct horse battery 43")).toBe(false);
  });

  it("never throws on malformed stored hash — returns false", async () => {
    expect(await verifyPassword("not-a-real-argon2-hash", "anything")).toBe(false);
  });

  it("performDummyVerify completes without throwing", async () => {
    await expect(performDummyVerify()).resolves.toBeUndefined();
  });
});

describe("password policy", () => {
  it.each([
    ["short1xxxxx", "must be at least 12 characters"],
    ["aaaaaaaaaaaa", "must contain at least one number"],
    ["111111111111", "must contain at least one letter"],
    ["abc 123 with space", "must not contain whitespace"],
  ])("rejects %j", (pw, expected) => {
    const result = checkPasswordPolicy(pw);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expected]));
  });

  it("accepts a compliant password", () => {
    expect(checkPasswordPolicy("CorrectHorse42").ok).toBe(true);
  });
});
