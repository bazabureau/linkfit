import { type FastifyReply, type FastifyRequest } from "fastify";
import { sql } from "kysely";
import { type DbHandle } from "../db/pool.js";
import { UnauthenticatedError } from "../errors/AppError.js";
import { InvalidAccessTokenError, verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authenticate` preHandler. Throws if accessed without auth. */
    authUserId?: string;
    /**
     * Refresh-token family id the bearer was minted under ("session id").
     * Populated when the access token's `sid` claim is present — i.e. for
     * tokens issued after the sessions-metadata migration. Used by the
     * `/me/sessions` surface to flag the row representing this request.
     * `undefined` is a legitimate state (legacy tokens issued before the
     * migration); callers must tolerate it gracefully.
     */
    authSessionId?: string;
  }
}

export interface AuthGuardDeps {
  jwtAccessSecret: string;
  /**
   * Optional — when present, the guard fires a debounced
   * `UPDATE users SET last_seen_at = NOW()` after every successful auth.
   * Absent in tests and in route modules that haven't been wired through yet;
   * absence simply skips the presence tracking, so existing call sites
   * (notably `guard.test.ts` and `adminGuard.ts`) keep working unchanged.
   */
  db?: DbHandle;
}

/**
 * Debounce window for `last_seen_at` updates. We only refresh the column
 * when the existing value is older than this — keeps the write rate to at
 * most one row update per active user per minute, regardless of request
 * volume. The WHERE clause does the debounce in SQL so we don't need an
 * in-process cache (avoids cache invalidation hazards across instances).
 */
const LAST_SEEN_DEBOUNCE_SECONDS = 60;

/**
 * Fastify preHandler factory. Verifies Bearer JWT and stores the user id on
 * the request. Routes that need auth attach this preHandler in their schema.
 *
 * The guard intentionally does NOT load the user from DB on every request.
 * That round-trip is wasted for the 99% of endpoints that only need the id.
 * Endpoints that actually need fresh user state fetch it themselves.
 *
 * Side-effect: when `deps.db` is provided, the guard also stamps
 * `users.last_seen_at = NOW()` on a fire-and-forget basis so we can render
 * "Active now" presence chips in the iOS UI. The update is debounced in SQL
 * (only writes if the existing value is > 60s old) and is NEVER awaited —
 * a slow / failed write must not block the request or surface as a 5xx.
 */
export function buildAuthGuard(deps: AuthGuardDeps) {
  // Fastify v5 distinguishes async (return Promise) from callback (done param)
  // preHandlers based on arity; a 2-arg sync function would hang waiting for
  // a third `done`. Async is the modern path — we accept the lint flag.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthenticatedError("Missing Bearer token");
    }
    const token = header.slice("Bearer ".length).trim();
    if (token.length === 0) {
      throw new UnauthenticatedError("Empty Bearer token");
    }

    try {
      const claims = verifyAccessToken(token, deps.jwtAccessSecret);
      req.authUserId = claims.sub;
      if (claims.sid !== undefined) {
        req.authSessionId = claims.sid;
      }

      // Fire-and-forget presence refresh. Intentionally NOT awaited so the
      // request keeps moving even on a slow DB; rejection is swallowed via
      // .catch() to avoid an unhandled promise rejection. The WHERE-debounce
      // means a logged-in user spamming the API only writes once per minute.
      if (deps.db) {
        const userId = claims.sub;
        const db = deps.db.db;
        void db
          .updateTable("users")
          .set({ last_seen_at: sql`now()` })
          .where("id", "=", userId)
          .where((eb) =>
            eb.or([
              eb("last_seen_at", "is", null),
              eb(
                "last_seen_at",
                "<",
                sql<Date>`now() - make_interval(secs => ${LAST_SEEN_DEBOUNCE_SECONDS})`,
              ),
            ]),
          )
          .execute()
          .catch(() => {
            // intentionally swallowed — presence tracking is non-critical.
          });
      }
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) {
        throw new UnauthenticatedError(
          err.reason === "expired" ? "Access token expired" : "Invalid access token",
        );
      }
      throw err;
    }
  };
}

/**
 * Helper for service / route handlers — pulls the id off the request and
 * throws a typed error if absent (defensive: this should never trigger if
 * the route correctly attached the preHandler).
 */
export function requireUserId(req: FastifyRequest): string {
  if (!req.authUserId) {
    throw new UnauthenticatedError("Authentication required");
  }
  return req.authUserId;
}
