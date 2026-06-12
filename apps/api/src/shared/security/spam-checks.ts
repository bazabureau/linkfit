import { sql } from "kysely";
import { type Logger } from "pino";
import { type DbHandle } from "../db/pool.js";

/**
 * Trust & safety primitives — three layers of defense around registration
 * and high-frequency social actions. Owned by the auth + follows services;
 * nothing in here writes user-visible state on its own.
 *
 *   1. `checkSignupAllowed(ip, email)` — rejects either when the IP has
 *      already burned its 24h signup budget OR when the email domain is
 *      on the disposable-provider blacklist.
 *   2. `recordSignupAttempt(ip)` — append-only audit row consumed by the
 *      IP check above. Called from the auth route hook BEFORE the
 *      signup actually runs so even rejected/duplicate requests count
 *      against the attacker's daily budget.
 *   3. `recordSuspiciousActivity(userId, kind)` — flips
 *      `users.flagged_for_review` when a user crosses the burst threshold.
 *      Today only `follow_burst` is wired; the `kind` discriminator is
 *      a deliberate seam so we can add `unfollow_burst`, `message_burst`,
 *      etc. without churning the service signatures.
 *
 * The thresholds (and the disposable list itself) live in this module —
 * call sites stay declarative.
 */

export interface SpamChecksConfig {
  /** Hard ceiling on registrations per IP in the trailing 24h. The
   *  N-th attempt (where N === this value + 1) is rejected with
   *  `RATE_LIMITED`. */
  signupRateLimitPerDay: number;
  /** Number of social actions inside `followBurstWindowSec` that flips
   *  the user's `flagged_for_review` bit. */
  followBurstThreshold: number;
  /** Sliding-window length for the burst tripwire. */
  followBurstWindowSec: number;
}

export interface SpamChecksDeps {
  db: DbHandle;
  logger: Logger;
  config: SpamChecksConfig;
}

export type SignupRejectReason =
  /** IP exceeded its 24h registration budget. HTTP 429 at the route. */
  | "ip_rate_limited"
  /** Email domain matches the disposable-provider blacklist. HTTP 400
   *  at the route with the public code `domain.invalid`. */
  | "disposable_email";

export interface SignupCheckResult {
  ok: boolean;
  /** Set only when `ok === false`. */
  reason?: SignupRejectReason;
}

/**
 * Curated list of well-known disposable / throwaway email providers. Kept
 * in code (not env) because:
 *   - the list is largely static — entries trickle in via security advisories
 *     a few times a year, easily handled as a code patch;
 *   - shipping it via env risks a runtime-empty list during misconfiguration,
 *     which would silently disable the layer.
 *
 * Matching is case-insensitive on the part after `@`. Subdomains of these
 * providers (e.g. `foo.mailinator.com`) are intentionally NOT matched —
 * we never want a false positive on a self-hosted MX. Add the exact
 * domain a provider actually uses.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "tempmail.net",
  "temp-mail.org",
  "temp-mail.io",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "mailnesia.com",
  "fakeinbox.com",
  "maildrop.cc",
  "getairmail.com",
  "dispostable.com",
  "tempinbox.com",
  "mintemail.com",
  "spambox.us",
  "spam4.me",
  "burnermail.io",
  "moakt.com",
  "mohmal.com",
  "emailondeck.com",
]);

/**
 * Extract the lowercased domain after `@`. Returns `null` for shapes that
 * don't survive the strip (no `@`, trailing `@`, or whitespace-only). The
 * canonical signup schema already trims/lowercases via Zod, so this is
 * defense-in-depth.
 */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length === 0 ? null : domain;
}

export interface SpamChecks {
  /**
   * Composite gate — returns `{ ok: false }` on first layer hit. Caller is
   * expected to map the reason onto the right HTTP code (see route wiring).
   * Does NOT mutate state; use `recordSignupAttempt` for the audit row.
   */
  checkSignupAllowed(ip: string, email: string): Promise<SignupCheckResult>;

  /**
   * Append-only row consumed by `checkSignupAllowed`. Idempotency is not
   * needed — duplicate appends only inflate the attacker's count, never
   * a legitimate user's (legit users hit register once on a successful
   * path). Always-on; no-op for empty IPs (test injections without a
   * remote address).
   */
  recordSignupAttempt(ip: string): Promise<void>;

  /**
   * Flips `users.flagged_for_review` when the actor has produced
   * `>= followBurstThreshold` events of `kind` inside the sliding window.
   * The lookback source is `kind`-specific (today: `feed_events` for
   * follow/unfollow signals); call sites must produce the matching event
   * upstream for the tripwire to fire.
   *
   * Returns `true` when the flag was newly raised so the caller can
   * branch on "first burst" if needed (e.g. for telemetry).
   */
  recordSuspiciousActivity(
    userId: string,
    kind: "follow_burst",
  ): Promise<boolean>;

  /**
   * Predicate the follows service consults to decide whether to silently
   * rate-limit a flagged actor. Reads the column directly so an admin who
   * unflags an account immediately gets normal throughput back.
   */
  isFlaggedForReview(userId: string): Promise<boolean>;
}

export function createSpamChecks(deps: SpamChecksDeps): SpamChecks {
  return {
    async checkSignupAllowed(ip, email) {
      // Layer 1 — disposable email blacklist. Cheap; check first so we
      // don't even hit the DB for an obviously bogus signup.
      const domain = emailDomain(email);
      if (domain !== null && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
        deps.logger.warn(
          { email_domain: domain, ip },
          "signup rejected: disposable email domain",
        );
        return { ok: false, reason: "disposable_email" };
      }

      // Layer 2 — per-IP daily budget. Empty IPs (test harness without a
      // remote addr) cannot be rate-limited; skip rather than reject so
      // the test suite doesn't need to fake a client IP everywhere.
      if (ip.length === 0) {
        return { ok: true };
      }

      const row = await deps.db.db
        .selectFrom("signup_attempts")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("ip", "=", ip)
        .where(sql<boolean>`attempted_at > NOW() - INTERVAL '24 hours'`)
        .executeTakeFirst();
      const count = Number(row?.c ?? 0);
      if (count >= deps.config.signupRateLimitPerDay) {
        deps.logger.warn(
          { ip, count, limit: deps.config.signupRateLimitPerDay },
          "signup rejected: IP exceeded daily limit",
        );
        return { ok: false, reason: "ip_rate_limited" };
      }
      return { ok: true };
    },

    async recordSignupAttempt(ip) {
      if (ip.length === 0) return;
      await deps.db.db
        .insertInto("signup_attempts")
        .values({ ip })
        .execute();
    },

    async recordSuspiciousActivity(userId, kind) {
      if ((kind as string) !== "follow_burst") {
        // Compile-time exhaustiveness — future kinds must opt in here.
        return false;
      }
      const windowSec = deps.config.followBurstWindowSec;
      const threshold = deps.config.followBurstThreshold;

      // Source-of-truth for the count is the `feed_events` log: every
      // successful follow emits a `followed_user` event, and the log is
      // already indexed by actor + created_at for the activity feed. No
      // separate counter to keep in sync.
      const row = await deps.db.db
          .selectFrom("feed_events")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("actor_user_id", "=", userId)
          .where("type", "=", "followed_user")
          .where(sql<boolean>`created_at > NOW() - (${windowSec}::int * INTERVAL '1 second')`)
          .executeTakeFirst();
      const count = Number(row?.c ?? 0);
      if (count < threshold) return false;

      // Only update when the bit is still false so the WHERE filter
      // short-circuits and the row stays out of the WAL for a no-op.
      const updated = await deps.db.db
          .updateTable("users")
          .set({ flagged_for_review: true })
          .where("id", "=", userId)
          .where("flagged_for_review", "=", false)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
      const newlyRaised = Number(updated.numUpdatedRows) > 0;
      if (newlyRaised) {
        deps.logger.warn(
          { user_id: userId, kind, count, threshold, window_sec: windowSec },
          "user flagged for review — follow burst",
        );
      }
      return newlyRaised;
    },

    async isFlaggedForReview(userId) {
      const row = await deps.db.db
        .selectFrom("users")
        .select("flagged_for_review")
        .where("id", "=", userId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      return row?.flagged_for_review === true;
    },
  };
}

/**
 * Maps a `SignupRejectReason` to the user-facing error payload. Pulled
 * out so the route layer can stay declarative and the test suite can
 * assert against the exact codes without re-implementing the mapping.
 */
export function signupRejectToHttp(reason: SignupRejectReason): {
  status: 400 | 429;
  code: string;
  message: string;
} {
  if (reason === "disposable_email") {
    return {
      status: 400,
      code: "domain.invalid",
      message: "Email domain is not allowed for registration",
    };
  }
  return {
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many signup attempts from this network. Try again later.",
  };
}
