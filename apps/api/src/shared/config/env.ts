import { z } from "zod";
import {
  isPlaceholderStripeSecretKey,
  isPlaceholderStripeWebhookSecret,
} from "./stripePlaceholders.js";

const NodeEnv = z.enum(["development", "test", "production"]);

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const OptionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);

const OptionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.string().url().optional(),
);

const csvListWithDefault = (fallback: string) =>
  z
    .preprocess(emptyStringToUndefined, z.string().default(fallback))
    .transform((s) =>
      s
        .split(",")
        .map((value) => value.trim())
        .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index),
    )
    .refine((values) => values.length > 0, {
      message: "must contain at least one value",
    });

function isHttpsUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  NODE_ENV: NodeEnv.default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),

  DATABASE_URL: z.string().url().refine((u) => u.startsWith("postgres"), {
    message: "DATABASE_URL must be a postgres:// URL",
  }),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),

  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  /** Stricter limits on register/login since each Argon2 hash is expensive
   *  and these endpoints are the most attractive enumeration targets. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // ── Trust & safety (signup + follow-burst defenses) ────────────────
  // The first three knobs are read by `shared/security/spam-checks.ts`.
  // Defaults are tuned for the AZ launch market (low organic burst, high
  // probability that 5+ signups from one IP in 24h is a fake-account farm).
  /** Hard ceiling on registrations from a single IP in a rolling 24h
   *  window. The 6th attempt returns 429 with `RATE_LIMITED`. */
  SIGNUP_RATE_LIMIT_PER_DAY: z.coerce.number().int().positive().default(5),
  /** Number of follow/unfollow actions in a `FOLLOW_BURST_WINDOW_SEC`
   *  window that flips the actor's `flagged_for_review` bit. */
  FOLLOW_BURST_THRESHOLD: z.coerce.number().int().positive().default(5),
  /** Sliding-window length (seconds) for the follow-burst tripwire. */
  FOLLOW_BURST_WINDOW_SEC: z.coerce.number().int().positive().default(60),

  // Feature flags — Phase 2/3 modules ship behind these and default OFF.
  FEATURE_BOOKINGS: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  /** Base URL used when building absolute URLs for uploaded assets.
   *  In dev/test this defaults to `http://<HOST>:<PORT>`. In production
   *  point this at the public origin (e.g. `https://api.linkfit.app`). */
  PUBLIC_BASE_URL: OptionalUrl,
  /** Public app/web origin used in password-reset links, referral links,
   *  and Stripe return URLs. Defaults to `PUBLIC_BASE_URL` at use sites
   *  when omitted. */
  PUBLIC_APP_URL: OptionalUrl,

  /** Filesystem location for uploaded message attachments. The path is
   *  served at `/uploads/*` via @fastify/static. Defaults to `/tmp` so
   *  local dev works out of the box; production should set this to a
   *  persistent path. */
  UPLOAD_DIR: z.string().min(1).default("/tmp/linkfit-uploads"),

  // ── Push (APNs) ────────────────────────────────────────────────────
  // All four must be set together to enable the real APNs sender. When
  // any are missing we fall back to the `LoggingSender` so dev/test
  // environments don't need real Apple credentials.
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  /** PEM contents of the `.p8` key downloaded from developer.apple.com.
   *  Newlines may be encoded as literal `\n` when piped through systemd
   *  / env-file layers — we restore them at load time. */
  APNS_AUTH_KEY: z
    .string()
    .min(1)
    .optional()
    .transform((s) => (s === undefined ? undefined : s.replace(/\\n/g, "\n"))),
  /** Default `false` (production gateway). Flip to `true` while testing
   *  with development-profile builds in the simulator/TestFlight. */
  APNS_USE_SANDBOX: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // ── Stripe (payments agent) ────────────────────────────────────────
  // Defaults are test-mode placeholders so dev/test can boot without
  // real credentials. The server logs a warning on boot when either
  // value falls back to the placeholder, and refuses live mode unless
  // `NODE_ENV === 'production'` (enforced inside the payments module,
  // not here — env load shouldn't depend on runtime gates).
  STRIPE_SECRET_KEY: z.string().min(1).default("sk_test_dummy"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).default("whsec_test_dummy"),
  /** Stripe recurring Price IDs for membership Checkout Sessions. Required
   *  in production when STRIPE_SECRET_KEY is real. */
  STRIPE_MEMBERSHIP_PLUS_PRICE_ID: OptionalNonEmptyString,
  STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID: OptionalNonEmptyString,

  // ── Metrics endpoint (Prometheus scraper) ──────────────────────────
  // Basic-auth credentials for `GET /metrics`. Defaults are intentionally
  // weak so local dev / test work out of the box; production must override.
  METRICS_USER: z.string().min(1).default("metrics"),
  METRICS_PASSWORD: z.string().min(1).default("change-me-in-production"),

  // ── iOS app-version gate ───────────────────────────────────────────
  // Surfaced via `GET /api/v1/app/version`. Ops can bump these without a
  // deploy; the iOS client reads them at cold-launch to decide whether to
  // show the "Update available" nudge (build < latest) or the hard
  // "Please update" gate (build < min_supported, or force_update=true).
  IOS_LATEST_BUILD: z.coerce.number().int().nonnegative().default(1),
  IOS_LATEST_VERSION: z.string().min(1).default("1.0.0"),
  IOS_MIN_SUPPORTED_BUILD: z.coerce.number().int().nonnegative().default(1),
  IOS_FORCE_UPDATE: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
  IOS_RELEASE_NOTES_URL: z
    .string()
    .url()
    .default("https://linkfit.app/releases/ios/1.0.0"),

  // ── App metadata (About screen, legal, social) ─────────────────────
  // Surfaced via `GET /api/v1/app/metadata`. Static-ish values the iOS
  // client uses to populate the About screen — support contact, legal
  // links, social handles, company info. All have sensible defaults so
  // dev/test boot without configuration; ops can override per env.
  APP_SUPPORT_EMAIL: z
    .string()
    .email()
    .default("support@linkfit.app"),
  APP_PRIVACY_POLICY_URL: z
    .string()
    .url()
    .default("https://linkfit.app/privacy"),
  APP_TERMS_URL: z
    .string()
    .url()
    .default("https://linkfit.app/terms"),
  APP_INSTAGRAM_URL: z
    .string()
    .url()
    .default("https://instagram.com/linkfit.app"),
  APP_TIKTOK_URL: z
    .string()
    .url()
    .default("https://tiktok.com/@linkfit.app"),
  APP_COMPANY_NAME: z.string().min(1).default("Linkfit"),
  APP_COMPANY_ADDRESS: z.string().min(1).default("Baku, Azerbaijan"),

  // ── Azerbaijan-market defaults ─────────────────────────────────────
  // Surfaced via `GET /api/v1/app/metadata`. The iOS client can fall back
  // to these when it has no per-user preference yet. Each one also acts
  // as a sane in-process fallback for server-side code (booking currency,
  // share-text locale) when the upstream value is missing or null. Keep
  // the defaults tied to the local market — flipping them per env is
  // possible but should be rare.
  APP_DEFAULT_CURRENCY: z
    .string()
    .length(3)
    .default("AZN")
    .transform((s) => s.toUpperCase()),
  APP_DEFAULT_TIMEZONE: z.string().min(1).default("Asia/Baku"),
  APP_DEFAULT_LOCALE: z.enum(["az", "en", "ru"]).default("az"),

  // ── Product analytics (PostHog) ────────────────────────────────────
  // Optional — when unset, the server-side analytics surface (see
  // `shared/observability/analytics.ts`) becomes a no-op. Production
  // wires the project key + host through the deployment env so funnels
  // populate without a code change. The iOS client reads matching
  // keys at build time via xcodegen substitution.
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default("https://app.posthog.com"),

  // ── Sentry crash reporting ─────────────────────────────────────────
  // Empty/unset disables the integration.
  SENTRY_DSN: OptionalNonEmptyString,
  SENTRY_RELEASE: OptionalNonEmptyString,

  // ── Email transport ────────────────────────────────────────────────
  // All of SMTP_HOST, SMTP_USER, and SMTP_PASS must be set to send real
  // email. SMTP_PORT and MAIL_FROM have safe defaults once SMTP is enabled.
  SMTP_HOST: OptionalNonEmptyString,
  SMTP_PORT: z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().max(65_535).default(587)),
  SMTP_USER: OptionalNonEmptyString,
  SMTP_PASS: OptionalNonEmptyString,
  MAIL_FROM: z.preprocess(emptyStringToUndefined, z.string().email().default("no-reply@linkfit.app")),

  // ── OAuth providers ────────────────────────────────────────────────
  // Apple native sign-in audience defaults to the iOS bundle id. Google
  // includes the shipped iOS client id by default and accepts a CSV for
  // additional web/debug client ids.
  OAUTH_APPLE_CLIENT_IDS: csvListWithDefault("az.linkfit.app"),
  OAUTH_GOOGLE_CLIENT_IDS: csvListWithDefault(
    "655337821050-pi74ppu4gjv7b0gs0v417djtndrl7nt2.apps.googleusercontent.com",
  ),

  // ── Medical profile encryption ─────────────────────────────────────
  // Base64 or hex encoded 32-byte key. Empty/unset uses the plaintext
  // fallback and logs a startup warning.
  MEDICAL_ENCRYPTION_KEY: OptionalNonEmptyString,
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  public override readonly name = "EnvValidationError";
  constructor(public readonly issues: z.ZodIssue[]) {
    const summary = issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    super(`Invalid environment variables:\n${summary}`);
  }
}

function enforceConfigInvariants(env: Env): void {
  const violations: z.ZodIssue[] = [];
  const smtpFields = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS];
  const hasPartialSmtp = smtpFields.some((value) => value !== undefined);
  const hasCompleteSmtp = smtpFields.every((value) => value !== undefined);
  const apnsFields = [
    env.APNS_KEY_ID,
    env.APNS_TEAM_ID,
    env.APNS_BUNDLE_ID,
    env.APNS_AUTH_KEY,
  ];
  const hasPartialApns = apnsFields.some((value) => value !== undefined);
  const hasCompleteApns = apnsFields.every((value) => value !== undefined);

  if (hasPartialSmtp && !hasCompleteSmtp) {
    violations.push({
      code: "custom",
      path: ["SMTP_HOST"],
      message: "SMTP_HOST, SMTP_USER, and SMTP_PASS must be set together",
    });
  }

  if (hasPartialApns && !hasCompleteApns) {
    violations.push({
      code: "custom",
      path: ["APNS_KEY_ID"],
      message: "APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, and APNS_AUTH_KEY must be set together",
    });
  }

  if (violations.length > 0) {
    throw new EnvValidationError(violations);
  }
}

/**
 * Production-only sanity checks beyond Zod's structural validation. We
 * accept placeholder secrets in dev/test so the server boots without real
 * Stripe/JWT credentials, but a `NODE_ENV=production` boot with those same
 * placeholders is almost certainly a misconfiguration — fail fast at load
 * time instead of letting the API serve traffic with `dev-*` JWTs.
 */
function enforceProductionInvariants(env: Env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const violations: z.ZodIssue[] = [];
  const guard = (
    key: keyof Env,
    isInvalid: boolean,
    reason: string,
  ): void => {
    if (isInvalid) {
      violations.push({
        code: "custom",
        path: [key],
        message: `production env contains ${reason}`,
      });
    }
  };

  guard("STRIPE_SECRET_KEY", isPlaceholderStripeSecretKey(env.STRIPE_SECRET_KEY),
    "placeholder Stripe secret key");
  guard("STRIPE_WEBHOOK_SECRET", isPlaceholderStripeWebhookSecret(env.STRIPE_WEBHOOK_SECRET),
    "placeholder Stripe webhook secret");
  const stripeKeyIsPlaceholder = isPlaceholderStripeSecretKey(env.STRIPE_SECRET_KEY);
  guard("STRIPE_SECRET_KEY", !stripeKeyIsPlaceholder && !env.STRIPE_SECRET_KEY.startsWith("sk_live_"),
    "non-live Stripe secret key");
  guard("STRIPE_MEMBERSHIP_PLUS_PRICE_ID",
    !stripeKeyIsPlaceholder && env.STRIPE_MEMBERSHIP_PLUS_PRICE_ID === undefined,
    "missing Stripe Plus membership price id");
  guard("STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID",
    !stripeKeyIsPlaceholder && env.STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID === undefined,
    "missing Stripe Premium membership price id");
  guard("JWT_ACCESS_SECRET", env.JWT_ACCESS_SECRET.startsWith("dev-"),
    "dev-prefixed JWT access secret");
  guard("JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET.startsWith("dev-"),
    "dev-prefixed JWT refresh secret");
  guard("METRICS_PASSWORD", env.METRICS_PASSWORD === "change-me-in-production",
    "default /metrics password");
  guard("CORS_ORIGINS", env.CORS_ORIGINS.length === 0,
    "empty CORS allowlist (would deny all browser clients)");
  guard("SMTP_HOST", env.SMTP_HOST === undefined,
    "missing SMTP credentials");
  guard("PUBLIC_BASE_URL", env.PUBLIC_BASE_URL === undefined,
    "missing public API base URL");
  guard("PUBLIC_APP_URL", env.PUBLIC_APP_URL === undefined,
    "missing public app URL");
  guard("PUBLIC_BASE_URL", env.PUBLIC_BASE_URL !== undefined && !isHttpsUrl(env.PUBLIC_BASE_URL),
    "non-HTTPS public API base URL");
  guard("PUBLIC_APP_URL", env.PUBLIC_APP_URL !== undefined && !isHttpsUrl(env.PUBLIC_APP_URL),
    "non-HTTPS public app URL");
  guard("APNS_KEY_ID", env.APNS_KEY_ID === undefined,
    "missing APNs credentials");
  guard("APNS_USE_SANDBOX", env.APNS_USE_SANDBOX,
    "APNs sandbox enabled");
  guard("MEDICAL_ENCRYPTION_KEY", env.MEDICAL_ENCRYPTION_KEY === undefined,
    "missing medical encryption key");

  if (violations.length > 0) {
    throw new EnvValidationError(violations);
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues);
  }
  enforceConfigInvariants(parsed.data);
  enforceProductionInvariants(parsed.data);
  return parsed.data;
}
