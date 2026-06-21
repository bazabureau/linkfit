/**
 * Sentry crash + error reporting facade for the API.
 *
 * Wraps `@sentry/node` behind a tiny surface so the rest of the server never
 * imports `@sentry/node` directly. Three contracts the rest of the codebase
 * relies on:
 *
 * 1. **Safe with no DSN.** `initSentry({ dsn: undefined | "" })` is a no-op —
 *    every subsequent `captureError` / `setupFastify` call short-circuits.
 *    This lets dev/CI environments boot without configuring Sentry, and
 *    keeps the SDK from spamming "no DSN" log lines.
 * 2. **PII scrubbing.** We strip `email`, `phone`, and `Authorization` /
 *    `Cookie` / `Set-Cookie` headers from every captured event via a
 *    `beforeSend` hook. The server must never leak account identifiers
 *    or session tokens to a third party.
 * 3. **Fastify integration.** `setupFastify(app)` registers an `onError`
 *    hook so unhandled 5xx errors get reported automatically. The
 *    `request_id` (Pino's `req.id`) is attached as a Sentry tag for
 *    cross-system correlation.
 *
 * The server passes environment and release from typed config during boot.
 */
import * as Sentry from "@sentry/node";
import { type FastifyInstance } from "fastify";

/** Header names that should never appear in Sentry events as cleartext. */
const PII_HEADER_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

/** Body / query / params keys that should never appear in Sentry events. */
const PII_FIELD_KEYS: ReadonlySet<string> = new Set([
  "email",
  "user_email",
  "userEmail",
  "phone",
  "phone_number",
  "phoneNumber",
  "password",
  "newPassword",
  "oldPassword",
  "token",
  "access_token",
  "refresh_token",
]);

/** Sentinel that flips true on the first successful `initSentry({dsn: …})`. */
let isEnabled = false;

export interface InitSentryOptions {
  /** Sentry DSN. Undefined or empty disables the integration entirely. */
  dsn: string | undefined;
  /** Defaults to `"development"` when omitted. */
  environment?: string;
  /** Release tag attached to Sentry events. */
  release?: string;
  /**
   * Traces sample rate (0..1). Defaults to 0 — performance monitoring is
   * opt-in. Crash + error capture is unaffected; turning this up only
   * controls the volume of `transaction` events.
   */
  tracesSampleRate?: number;
}

/**
 * Initialize Sentry. Safe to call multiple times — only the first call with a
 * non-empty DSN takes effect; subsequent invocations log and short-circuit.
 * Passing an empty / undefined DSN disables capture for the lifetime of the
 * process.
 */
export function initSentry(options: InitSentryOptions): void {
  if (isEnabled) {
    return;
  }
  const dsn = options.dsn?.trim();
  if (dsn === undefined || dsn.length === 0) {
    return;
  }

  const environment = options.environment ?? "development";
  const release = options.release;

  // `exactOptionalPropertyTypes: true` (set in our tsconfig) rejects
  // `release: undefined` — only include the key when we actually have a
  // value to send.
  const initOptions: Sentry.NodeOptions = {
    dsn,
    environment,
    // Performance monitoring is opt-in — most teams enable it once the cost
    // model is understood. Crash + error capture is always on.
    tracesSampleRate: options.tracesSampleRate ?? 0,
    // Strip auto-collected PII before it leaves the process. The SDK
    // defaults to `false` here in v8+ but we set it explicitly so a future
    // version bump can't silently flip the contract.
    sendDefaultPii: false,
    integrations: [
      // Default integrations: HTTP, console, node-uncaught-exception, etc.
      // We don't customize this list — Sentry's defaults are correct for a
      // standard Fastify HTTP server.
    ],
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
  if (release !== undefined && release.length > 0) {
    initOptions.release = release;
  }
  Sentry.init(initOptions);

  isEnabled = true;
}

/** Capture an explicit Error. No-op when Sentry isn't initialized. */
export function captureError(
  error: unknown,
  context: Record<string, string> = {},
): void {
  if (!isEnabled) {
    return;
  }
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setTag(key, value);
    }
    Sentry.captureException(error);
  });
}

/** Capture a string message at `warning` level. No-op when not initialized. */
export function captureMessage(
  message: string,
  context: Record<string, string> = {},
): void {
  if (!isEnabled) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    for (const [key, value] of Object.entries(context)) {
      scope.setTag(key, value);
    }
    Sentry.captureMessage(message);
  });
}

/**
 * Register the Fastify error-reporting hook. Unhandled 5xx errors get sent to
 * Sentry along with the request id and route template (no path parameters —
 * those can carry user ids).
 *
 * Idempotent in practice: registering twice would double-fire, but Fastify
 * tracks plugin registration so callers should only invoke this once during
 * `buildServer`.
 */
// Accept any `FastifyInstance` variant — the production server uses a
// custom type-provider (zod), and the default `FastifyInstance` type
// argument list doesn't match. We only call `addHook`, which exists on
// every variant, so a wide generic is correct here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupFastify(app: FastifyInstance<any, any, any, any, any>): void {
  if (!isEnabled) {
    return;
  }
  app.addHook("onError", (request, _reply, error, done) => {
    // 4xx errors are typically user-input problems — not worth paging on.
    // We only forward 5xx and uncategorized errors.
    const statusCode = (error).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      done();
      return;
    }
    Sentry.withScope((scope) => {
      scope.setTag("request_id", request.id);
      // routerPath is the unparameterized route template, e.g.
      // `/api/v1/users/:id` — safe to tag without leaking ids.
      const routerPath = (request as unknown as { routerPath?: string }).routerPath;
      if (typeof routerPath === "string" && routerPath.length > 0) {
        scope.setTag("route", routerPath);
      }
      scope.setTag("method", request.method);
      Sentry.captureException(error);
    });
    done();
  });
}

/** Returns true when initSentry has run successfully with a non-empty DSN. */
export function isSentryEnabled(): boolean {
  return isEnabled;
}

/**
 * Test-only reset. Vitest spins multiple `buildServer` calls per file and
 * the SDK is a process-wide singleton — call this in test setup to allow a
 * fresh `initSentry` per test if the test needs it. NOT for production use.
 */
export function _resetForTesting(): void {
  isEnabled = false;
}

// ─────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────

type SentryEvent = Parameters<NonNullable<Sentry.NodeOptions["beforeSend"]>>[0];
type SentryBreadcrumb = Parameters<
  NonNullable<Sentry.NodeOptions["beforeBreadcrumb"]>
>[0];

/**
 * Mutate the Sentry event in place to strip PII fields before transmission.
 * Returns the event so it can be sent, or `null` to drop it (we never drop
 * — scrubbing is sufficient).
 */
function scrubEvent(event: SentryEvent): SentryEvent {
  // Strip identity beyond Sentry's auto-generated install id.
  if (event.user !== undefined) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
    if (event.user.data !== undefined && event.user.data !== null) {
      // `User.data` is typed as `{[k:string]: string}` but Sentry permits
      // arbitrary JSON-serializable values at runtime. We scrub and keep
      // the existing shape — the cast suppresses a stricter-than-runtime
      // typing constraint.
      event.user.data = redactRecord(event.user.data as Record<string, unknown>) as Record<string, string>;
    }
  }

  // HTTP request headers (auto-captured by Sentry's request integration).
  if (event.request !== undefined) {
    if (event.request.headers !== undefined) {
      event.request.headers = redactHeaders(
        event.request.headers,
      );
    }
    // `Event.Request.cookies` is `{[k:string]: string}` — replace each
    // cookie value with the redacted sentinel rather than the whole map.
    if (event.request.cookies !== undefined) {
      const cookies = event.request.cookies;
      for (const key of Object.keys(cookies)) {
        cookies[key] = "[REDACTED]";
      }
    }
    if (
      typeof event.request.data === "object" &&
      event.request.data !== null
    ) {
      event.request.data = redactRecord(
        event.request.data as Record<string, unknown>,
      );
    }
  }

  if (event.tags !== undefined) {
    // Sentry's `Primitive` includes number / boolean / null / undefined /
    // bigint / symbol / string — superset of our redacted output values.
    event.tags = redactTags(event.tags) as typeof event.tags;
  }
  if (event.extra !== undefined) {
    event.extra = redactRecord(event.extra);
  }

  return event;
}

/** Strip PII from a single breadcrumb. Return null to drop it entirely. */
function scrubBreadcrumb(crumb: SentryBreadcrumb): SentryBreadcrumb | null {
  if (crumb.data !== undefined) {
    crumb.data = redactRecord(crumb.data);
  }
  if (typeof crumb.message === "string" && looksLikeEmail(crumb.message)) {
    crumb.message = "[REDACTED]";
  }
  return crumb;
}

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    copy[key] = PII_HEADER_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return copy;
}

function redactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (PII_FIELD_KEYS.has(key)) {
      copy[key] = "[REDACTED]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      copy[key] = redactRecord(value as Record<string, unknown>);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

function redactTags(
  tags: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tags)) {
    copy[key] = PII_FIELD_KEYS.has(key) ? "[REDACTED]" : value;
  }
  return copy;
}

/**
 * Cheap email heuristic. We don't need RFC 5322 — just enough to catch
 * strings like "fetched profile for alice@example.com" before they hit a
 * Sentry event payload.
 */
function looksLikeEmail(s: string): boolean {
  if (!s.includes("@")) return false;
  const parts = s.split("@");
  if (parts.length !== 2) return false;
  const last = parts[1];
  return last !== undefined && last.includes(".") && last.length >= 3;
}
