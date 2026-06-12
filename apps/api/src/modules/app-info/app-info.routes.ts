import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type Env } from "../../shared/config/env.js";

/**
 * Tiny public endpoint the iOS client calls at launch to discover the
 * latest TestFlight/App Store build + the minimum build it must be on.
 * If the running build is below `min_supported_build` the client renders
 * a hard "Please update" gate; if it's below `latest_build` it shows a
 * soft "Update available" nudge.
 *
 * Values are sourced from env so ops can bump them without a deploy.
 * No DB, no auth — this endpoint must work even for unauthenticated
 * users (signup flow runs on the latest build too).
 */
const PlatformInfo = z.object({
  latest_build: z.number().int().nonnegative(),
  latest_version: z.string(),
  min_supported_build: z.number().int().nonnegative(),
  force_update: z.boolean(),
  release_notes_url: z.string().url(),
});

const AppVersionResponse = z.object({
  ios: PlatformInfo,
});

/**
 * Static-ish metadata the iOS client renders on the About screen — legal
 * links, support contact, social handles, company info. Sourced from env
 * so ops can update copy without a deploy. Anonymous endpoint — the About
 * screen renders pre-login too.
 */
const AppMetadataResponse = z.object({
  support_email: z.string().email(),
  privacy_policy_url: z.string().url(),
  terms_url: z.string().url(),
  instagram_url: z.string().url(),
  tiktok_url: z.string().url(),
  company_name: z.string(),
  company_address: z.string(),
  /**
   * Azerbaijan-market defaults the iOS client can fall back to when it has
   * no per-user preference yet. `default_currency` is an ISO-4217 code,
   * `default_timezone` is an IANA name, `default_locale` is a two-letter
   * code constrained to the share-text locales the server actually
   * supports. Ops can override per env without a deploy.
   */
  default_currency: z.string().length(3),
  default_timezone: z.string(),
  default_locale: z.enum(["az", "en", "ru"]),
});

export interface AppInfoRouteDeps {
  env: Env;
}

export function registerAppInfoRoutes(
  app: LinkfitServer,
  deps: AppInfoRouteDeps,
): void {
  app.get(
    "/api/v1/app/version",
    {
      config: {
        // Called on every cold-launch by every client — exclude from the
        // shared rate limit so a TestFlight rollout doesn't trip throttling.
        rateLimit: false,
      },
      schema: {
        response: {
          200: AppVersionResponse,
        },
        tags: ["app-info"],
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        ios: {
          latest_build: deps.env.IOS_LATEST_BUILD,
          latest_version: deps.env.IOS_LATEST_VERSION,
          min_supported_build: deps.env.IOS_MIN_SUPPORTED_BUILD,
          force_update: deps.env.IOS_FORCE_UPDATE,
          release_notes_url: deps.env.IOS_RELEASE_NOTES_URL,
        },
      });
    },
  );

  app.get(
    "/api/v1/app/metadata",
    {
      config: {
        // Hit on About-screen render and occasionally on launch — same
        // reasoning as `/app/version`: don't let a popular screen trip
        // the shared rate limit for unauthenticated traffic.
        rateLimit: false,
      },
      schema: {
        response: {
          200: AppMetadataResponse,
        },
        tags: ["app-info"],
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        support_email: deps.env.APP_SUPPORT_EMAIL,
        privacy_policy_url: deps.env.APP_PRIVACY_POLICY_URL,
        terms_url: deps.env.APP_TERMS_URL,
        instagram_url: deps.env.APP_INSTAGRAM_URL,
        tiktok_url: deps.env.APP_TIKTOK_URL,
        company_name: deps.env.APP_COMPANY_NAME,
        company_address: deps.env.APP_COMPANY_ADDRESS,
        default_currency: deps.env.APP_DEFAULT_CURRENCY,
        default_timezone: deps.env.APP_DEFAULT_TIMEZONE,
        default_locale: deps.env.APP_DEFAULT_LOCALE,
      });
    },
  );
}
