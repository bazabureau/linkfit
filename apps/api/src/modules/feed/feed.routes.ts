import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import { type FeedService } from "./feed.service.js";

export interface FeedRouteDeps {
  feed: FeedService;
  jwtAccessSecret: string;
}

/**
 * Soft-auth for the public feed list — extracts the viewer id when a
 * valid bearer token is present, silently ignoring missing / expired /
 * malformed tokens. Used to (a) personalize visibility (self + followed)
 * and (b) drop events from blocked users without breaking the
 * anonymous-access contract. Mirrors the helper in `games.routes.ts` and
 * `ratings.routes.ts`.
 */
function extractOptionalViewer(
  req: { headers: { authorization?: string | undefined } },
  secret: string,
): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) return null;
  try {
    return verifyAccessToken(token, secret).sub;
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) return null;
    throw err;
  }
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const FeedEventTypeSchema = z.enum([
  "joined_game",
  "won_match",
  "registered_tournament",
  "elo_milestone",
  "followed_user",
  "new_partnership",
]);

const FeedVisibilitySchema = z.enum(["public", "followers", "private"]);

const FeedActorSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
});

const FeedEventSchema = z.object({
  id: z.string().uuid(),
  type: FeedEventTypeSchema,
  actor: FeedActorSchema,
  // Free-form. iOS treats `type` as a discriminator and reads named keys.
  payload: z.record(z.unknown()),
  visibility: FeedVisibilitySchema,
  created_at: z.string(),
  likes_count: z.number().int().nonnegative(),
  liked_by_me: z.boolean(),
});

const LikeResponseSchema = z.object({
  likes_count: z.number().int().nonnegative(),
});

const FeedPageSchema = z.object({
  items: z.array(FeedEventSchema),
  next_cursor: z.string().nullable(),
});

const FeedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * Mounts `GET /api/v1/feed`. The list route uses soft-auth so authenticated
 * callers get the personalized timeline (self + follows + public, with
 * blocked users' events filtered out) and anonymous callers get the
 * public-only view. The like / unlike routes still require auth — you
 * can't react without an identity. The service does the heavy lifting;
 * the route just validates the envelope and forwards.
 */
export function registerFeedRoutes(app: LinkfitServer, deps: FeedRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/feed",
    {
      schema: {
        querystring: FeedQuerySchema,
        response: {
          200: FeedPageSchema,
          400: ErrorEnvelope,
        },
        tags: ["feed"],
      },
    },
    async (req, reply) => {
      // Soft-auth: signed-in callers get the personalized + block-filtered
      // feed; anonymous callers fall through to the public-only view.
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const page = await deps.feed.list(viewerId, {
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      return reply.status(200).send(page);
    },
  );

  // POST /api/v1/feed/:id/like — idempotent. The composite PK on
  // (feed_event_id, user_id) means double-tap is a single row, and a
  // missing event yields a 400 from the service via ValidationError.
  app.post(
    "/api/v1/feed/:id/like",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: LikeResponseSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["feed"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.feed.like(userId, req.params.id);
      return reply.status(200).send(result);
    },
  );

  // DELETE /api/v1/feed/:id/like — also idempotent.
  app.delete(
    "/api/v1/feed/:id/like",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: LikeResponseSchema,
          401: ErrorEnvelope,
        },
        tags: ["feed"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.feed.unlike(userId, req.params.id);
      return reply.status(200).send(result);
    },
  );
}
