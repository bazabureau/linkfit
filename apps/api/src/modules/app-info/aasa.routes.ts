import { type LinkfitServer } from "../../shared/http/server.js";

/**
 * Apple App Site Association (AASA).
 *
 * Apple's Universal Links system fetches this file from
 * `https://linkfit.app/.well-known/apple-app-site-association` to learn
 * which URL paths route into the iOS app. The iOS deep-link router is
 * already wired for /games/:id, /users/:id, /venues/:id, /r/:code and
 * /threads/:id — this endpoint is the server-side piece.
 *
 * Apple's fetcher is strict:
 *   - Path MUST be exactly `/.well-known/apple-app-site-association`
 *     (no redirects, no query string).
 *   - Content-Type MUST be `application/json` (not `text/json`).
 *   - The response MUST NOT require any authentication.
 *
 * We bypass Zod response serialization (`schema.response`) on purpose —
 * the AASA shape is a fixed Apple spec, not a Zod-validated payload, and
 * adding a Zod schema would risk Apple's parser rejecting a stray key.
 * We do exclude it from Swagger via the absent `tags` + send the body
 * with an explicit `.type()` call so helmet / fastify can't override
 * the Content-Type.
 */

const AASA_PAYLOAD = {
  applinks: {
    details: [
      {
        appIDs: ["93QUDM26D5.az.linkfit.app"],
        components: [
          { "/": "/games/*", comment: "Game detail deep link" },
          { "/": "/users/*", comment: "User profile deep link" },
          { "/": "/venues/*", comment: "Venue detail deep link" },
          { "/": "/r/*", comment: "Referral code deep link" },
          { "/": "/threads/*", comment: "Conversation thread deep link" },
        ],
      },
    ],
  },
} as const;

export function registerAasaRoutes(app: LinkfitServer): void {
  app.get(
    "/.well-known/apple-app-site-association",
    {
      config: {
        // Apple's CDN polls this on a schedule; don't trip the shared
        // rate limit during a TestFlight rollout.
        rateLimit: false,
      },
    },
    async (_req, reply) => {
      return reply
        .status(200)
        .type("application/json")
        .send(AASA_PAYLOAD);
    },
  );
}
