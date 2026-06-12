/**
 * Server-side product analytics facade.
 *
 * Wraps `posthog-node` behind a tiny surface so the rest of the API never
 * imports the vendor SDK directly. Three contracts the rest of the codebase
 * relies on:
 *
 * 1. **Safe with no API key.** `initAnalytics({ apiKey: undefined | "" })` is
 *    a no-op — every subsequent `track(...)` call short-circuits. This lets
 *    dev/CI environments boot without configuring PostHog.
 * 2. **PII boundary.** Email and phone are NEVER sent in cleartext. The
 *    {@link hashEmail} helper produces a stable SHA-256 of the lowercased
 *    + trimmed email so funnels can be joined to other systems without
 *    leaking the raw identifier. Call sites are responsible for hashing
 *    BEFORE handing the value to `track(...)` — this module does not
 *    rummage through `properties` looking for emails.
 * 3. **Fire-and-forget.** `track(...)` never throws and never blocks the
 *    request hot path. Failures are swallowed with a single `console.warn`.
 *    Backpressure is handled by the SDK's internal batching (every 20
 *    events or 30 seconds, whichever first).
 *
 * Server-side events fire at three call sites today (see the comment block
 * at the bottom of this file for the taxonomy):
 *   - `account_created` — in the auth signup handler.
 *   - `game_created`    — in `games.service.ts` `create()`.
 *   - `match_scored_finalized` — in `scoring.service.ts` `complete()`.
 *
 * Each call site looks up the distinct_id (the user UUID) and passes the
 * minimum set of properties needed to draw the funnel. Avoid free-form
 * properties — they make PostHog dashboards painful to query and the
 * audit surface for PII regressions explodes.
 */
import { PostHog } from "posthog-node";
import crypto from "node:crypto";

/** Sentinel that flips true on the first successful `initAnalytics(...)`. */
let client: PostHog | null = null;

export interface InitAnalyticsOptions {
  /**
   * PostHog project API key. Undefined or empty disables the integration
   * entirely. The Linkfit dev/CI environment leaves this unset; production
   * sets it via `POSTHOG_API_KEY` (see `shared/config/env.ts`).
   */
  apiKey: string | undefined;
  /**
   * PostHog host. Defaults to `https://app.posthog.com` (PostHog Cloud).
   * EU customers should point at `https://eu.posthog.com`; self-hosted
   * deployments at their own URL.
   */
  host?: string;
  /**
   * Optional logger for init/teardown notices. Defaults to no-op so the
   * module stays usable from tests without wiring a pino instance.
   */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void };
}

/**
 * Initialize the PostHog client. Idempotent — a second call with the same
 * key returns immediately. Passing an empty / undefined `apiKey` keeps the
 * module in no-op mode for the lifetime of the process.
 */
export function initAnalytics(options: InitAnalyticsOptions): void {
  if (client !== null) {
    return;
  }
  const apiKey = options.apiKey?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    options.logger?.info("PostHog disabled — POSTHOG_API_KEY not set");
    return;
  }
  const trimmedHost = options.host?.trim() ?? "";
  const host = trimmedHost.length > 0 ? trimmedHost : "https://app.posthog.com";
  client = new PostHog(apiKey, {
    host,
    // Batch settings — match the SDK defaults but pin them here so a
    // future minor version can't silently change throughput.
    flushAt: 20,
    flushInterval: 30_000,
  });
  options.logger?.info("PostHog initialized");
}

/**
 * Shut down the PostHog client and flush any pending events. Call this
 * from the server shutdown handler so events queued in the last 30s are
 * not lost when the process exits.
 *
 * Safe to call when the client was never initialized — returns immediately.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (client === null) {
    return;
  }
  try {
    await client.shutdown();
  } catch {
    // Swallow — we're shutting down anyway.
  }
  client = null;
}

export interface TrackInput {
  /**
   * Stable user id. For authenticated events this is the user UUID; for
   * pre-auth events (e.g. waitlist signup) it is the email hash. Required
   * — PostHog rejects events with an empty distinct_id.
   */
  distinctId: string;
  /** Event name in snake_case. Stable wire identifier. */
  event: string;
  /** Property bag. Scalars only (string/number/boolean). NO emails or phones. */
  properties?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Buffer an event for later flush. Non-throwing — failures are swallowed
 * with a single `console.warn`. No-op when the client was never
 * initialized (dev/CI without a configured PostHog project).
 *
 * The call site MUST NOT pass raw email or phone in `properties`. Use
 * {@link hashEmail} to derive an `email_hash` field instead.
 */
export function track(input: TrackInput): void {
  if (client === null) {
    return;
  }
  if (input.distinctId.length === 0) {
    return;
  }
  try {
    // `exactOptionalPropertyTypes` rejects `properties: undefined`; PostHog
    // expects either a populated record or the key to be absent. Defaulting
    // to `{}` keeps the call site signature optional while satisfying the
    // SDK's typed interface.
    client.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: input.properties ?? {},
    });
  } catch (error) {
    // Vendor SDK errors are never allowed to break the request path.
    console.warn("analytics capture failed:", error);
  }
}

/**
 * Associate user properties with a distinct id. Use this once on
 * registration to seed PostHog's person profile with locale, signup
 * method, and other audit-safe traits. NEVER pass email or phone in
 * `traits` — hash them through {@link hashEmail} first if needed.
 */
export function identify(
  distinctId: string,
  traits: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (client === null || distinctId.length === 0) {
    return;
  }
  try {
    client.identify({ distinctId, properties: traits });
  } catch (error) {
    console.warn("analytics identify failed:", error);
  }
}

/**
 * Stable SHA-256 hash of an email address, suitable as an `email_hash`
 * property in analytics events. Lowercases and trims first so casing /
 * whitespace differences across signup methods (manual, Apple, Google)
 * produce the same hash.
 *
 * Returns the hex digest. Empty input returns an empty string so callers
 * can pass it through without an extra null-check (the consumer's PostHog
 * column will be NULL rather than the hash of an empty string).
 */
export function hashEmail(email: string | null | undefined): string {
  if (email === undefined || email === null) {
    return "";
  }
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    return "";
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Extract the domain part of an email for low-cardinality bucketing in
 * dashboards. Returns an empty string for malformed inputs. Lowercased
 * so `Gmail.COM` and `gmail.com` bucket together.
 *
 * This is intentionally lossy — the domain is fine to ship in cleartext
 * since it identifies an email provider, not an individual user.
 */
export function emailDomain(email: string | null | undefined): string {
  if (email === undefined || email === null) {
    return "";
  }
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at === -1 || at === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(at + 1);
}

/** Returns true when initAnalytics has run successfully with a non-empty key. */
export function isAnalyticsEnabled(): boolean {
  return client !== null;
}

/**
 * Test-only reset. Vitest spins multiple `buildServer` calls per file and
 * the client is a process-wide singleton — call this in test setup so a
 * fresh `initAnalytics` per test is possible. NOT for production use.
 */
export function _resetForTesting(): void {
  client = null;
}

// ─────────────────────────────────────────────────────────────────────────
// Event taxonomy — server-side
// ─────────────────────────────────────────────────────────────────────────
//
// The wave-10 launch ships three server-side events. Keep this list in
// sync with the iOS taxonomy in `Core/Analytics/AnalyticsEvent.swift` and
// the PostHog dashboard's "events" reference page.
//
//   account_created          { email_domain, locale, email_hash }
//   game_created             { visibility, capacity, sport_slug? }
//   match_scored_finalized   { duration_min, winner_team?, sets_played? }
//
// Each event MUST carry the actor's user UUID as `distinctId`. The
// `email_hash` property is optional on `account_created` and intentionally
// omitted on the other two (we only need the join key at signup time —
// later events tie themselves to the same distinct_id PostHog already
// resolved).
