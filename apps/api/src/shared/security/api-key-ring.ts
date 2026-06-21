import { createHash, timingSafeEqual } from "node:crypto";

export function apiKeyFingerprint(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  if (key.length === 0) return null;
  return sha256Hex(key).slice(0, 16);
}

export function apiKeyMatches(
  provided: string | undefined,
  plainKeys: readonly string[],
  keyHashes: readonly string[],
): boolean {
  const key = provided?.trim() ?? "";
  if (key.length === 0) return false;

  for (const expected of plainKeys) {
    if (constantTimeEquals(key, expected.trim())) return true;
  }

  const providedHash = sha256Hex(key);
  for (const expectedHash of keyHashes) {
    const normalized = expectedHash.trim().toLowerCase();
    if (isSha256Hex(normalized) && constantTimeEquals(providedHash, normalized)) {
      return true;
    }
  }

  return false;
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function isWeakPlainApiKey(value: string): boolean {
  const key = value.trim();
  return key.length < 32
    || key.startsWith("dev-")
    || key.includes("change-in-prod")
    || key.includes("example");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
