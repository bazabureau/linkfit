import argon2 from "argon2";

/**
 * Argon2id parameters tuned to OWASP 2024 minimum recommendations:
 *  - memoryCost: 64 MiB
 *  - timeCost:   3
 *  - parallelism: 4
 *
 * `verify` returns false on any mismatch — never throw — so the caller can
 * treat every "no" the same (timing-safe, no info leak).
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * A pre-computed hash of a long random string we use during failed-login
 * lookups so the response time is identical whether or not the email exists.
 * Computed lazily on first use, cached for the lifetime of the process.
 */
let dummyHashPromise: Promise<string> | null = null;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Burn the same CPU/memory that a real Argon2 verify would, so an email
 * existence probe via response timing isn't viable.
 */
export async function performDummyVerify(): Promise<void> {
  dummyHashPromise ??= argon2.hash(
    "dummy-timing-token-" + Math.random().toString(36),
    ARGON2_OPTIONS,
  );
  const hash = await dummyHashPromise;
  await argon2.verify(hash, "anything-the-attacker-supplied").catch(() => false);
}

/**
 * Password policy. Lives here (not just in Zod) so it's reusable from the
 * service layer when re-hashing on profile updates, etc.
 */
export interface PasswordPolicyResult {
  ok: boolean;
  issues: string[];
}

export function checkPasswordPolicy(plain: string): PasswordPolicyResult {
  const issues: string[] = [];
  if (plain.length < 12) issues.push("must be at least 12 characters");
  if (!/[A-Za-z]/.test(plain)) issues.push("must contain at least one letter");
  if (!/\d/.test(plain)) issues.push("must contain at least one number");
  if (/\s/.test(plain)) issues.push("must not contain whitespace");
  return { ok: issues.length === 0, issues };
}
