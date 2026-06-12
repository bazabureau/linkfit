import { describe, expect, it } from "vitest";
import { normalizeAzPhone, normalizeAzPhoneOrNull } from "./phone.js";

describe("normalizeAzPhone", () => {
  it("prefixes a 994-prefixed string with +", () => {
    expect(normalizeAzPhone("994551234567")).toBe("+994551234567");
  });

  it("accepts the canonical +994 form unchanged in spirit", () => {
    expect(normalizeAzPhone("+994551234567")).toBe("+994551234567");
  });

  it("converts 0-prefixed national form (10 digits) to +994", () => {
    expect(normalizeAzPhone("0551234567")).toBe("+994551234567");
  });

  it("expands a bare 9-digit operator+subscriber to +994", () => {
    expect(normalizeAzPhone("551234567")).toBe("+994551234567");
  });

  it("strips non-digits before deciding", () => {
    expect(normalizeAzPhone("+994 55 123 45 67")).toBe("+994551234567");
    expect(normalizeAzPhone("055-123-45-67")).toBe("+994551234567");
  });

  it("returns non-AZ shapes unchanged", () => {
    expect(normalizeAzPhone("+15551234567")).toBe("+15551234567");
    expect(normalizeAzPhone("abc")).toBe("abc");
  });

  it("normalizeAzPhoneOrNull passes null/empty through", () => {
    expect(normalizeAzPhoneOrNull(null)).toBeNull();
    expect(normalizeAzPhoneOrNull(undefined)).toBeNull();
    expect(normalizeAzPhoneOrNull("")).toBeNull();
    expect(normalizeAzPhoneOrNull("   ")).toBeNull();
    expect(normalizeAzPhoneOrNull("0551234567")).toBe("+994551234567");
  });
});
