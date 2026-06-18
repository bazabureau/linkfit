import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Magic-link tokens are 256 bits of CSPRNG entropy, base64url-encoded for
 * transport. We never store the raw token — only its sha256 digest in
 * `email_tokens.token_hash`. A leaked DB snapshot can't be replayed.
 *
 * Mirrors `shared/auth/refreshToken.ts` exactly so the two modules stay
 * comprehensible side-by-side.
 */
const TOKEN_BYTES = 32;

export interface NewEmailToken {
  /** Opaque token included in the magic-link URL. Never log this. */
  token: string;
  /** sha256 digest stored in DB; re-derived on submit. */
  hash: Buffer;
}

export function generateEmailToken(): NewEmailToken {
  const raw = randomBytes(TOKEN_BYTES);
  const token = raw.toString("base64url");
  return { token, hash: hashEmailToken(token) };
}

export function hashEmailToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export interface NewVerificationCode {
  /** Six decimal digits sent to the user. Never log this. */
  code: string;
  /** HMAC-SHA256 digest stored in DB; safe against offline 6-digit brute force. */
  hash: Buffer;
}

export function generateVerificationCode(secret: string): NewVerificationCode {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return { code, hash: hashVerificationCode(code, secret) };
}

export function hashVerificationCode(code: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(code, "utf8").digest();
}
