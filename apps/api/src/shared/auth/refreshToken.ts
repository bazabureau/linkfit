import { createHash, randomBytes } from "node:crypto";

/**
 * Refresh tokens are 256 bits of CSPRNG entropy, base64url-encoded for
 * transport. We never store the token itself in the DB — only its sha256
 * digest. This means a DB leak does not yield usable tokens.
 *
 * Why sha256, not Argon2? Refresh tokens already have full random entropy
 * (256 bits). Brute force on a 256-bit secret is not the threat model;
 * post-leak preimage attacks are, and sha256 defeats those just fine while
 * being thousands of times cheaper at refresh time.
 */
const TOKEN_BYTES = 32;

export interface NewRefreshToken {
  /** Opaque string returned to the client. Never log this. */
  token: string;
  /** sha256 digest. Stored in DB. Re-derived on verify. */
  hash: Buffer;
}

export function generateRefreshToken(): NewRefreshToken {
  const raw = randomBytes(TOKEN_BYTES);
  const token = raw.toString("base64url");
  const hash = hashRefreshToken(token);
  return { token, hash };
}

export function hashRefreshToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Constant-time comparison wrapper. We compare Buffer-to-Buffer so length
 * is fixed; sha256 always produces 32 bytes.
 */
export function refreshTokenHashEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
