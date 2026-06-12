import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type FeedCommentsService } from "./feed-comments.service.js";
import {
  CommentIdParamSchema,
  CommentOutSchema,
  CommentsPageSchema,
  CommentsQuerySchema,
  ErrorEnvelope,
  EventIdParamSchema,
  PostCommentBodySchema,
} from "./feed-comments.schema.js";

// Empty-response body for 204 endpoints. Fastify-zod requires every response
// status to have a serializer-compatible Zod schema; an empty strict object
// matches what `reply.send({})` produces (i.e. no body bytes on the wire).
const EmptyResponse = z.object({}).strict();

export interface FeedCommentsRouteDeps {
  service: FeedCommentsService;
  jwtAccessSecret: string;
}

/**
 * Routes mounted by this module:
 *
 *   POST   /api/v1/feed/:eventId/comments
 *   GET    /api/v1/feed/:eventId/comments?cursor=&limit=
 *   DELETE /api/v1/feed/comments/:commentId
 *
 * Auth model:
 *   - POST and DELETE require Bearer auth (`authenticate` preHandler).
 *   - GET is currently authenticated too — the feed itself is mixed
 *     (anon/auth) but the comments surface only matters for users who can
 *     see the card, and 100% of those callers have a token. Keeping GET
 *     authed lets us trivially add per-viewer block-filtering later
 *     without a wire-format break.
 */
export function registerFeedCommentsRoutes(
  app: LinkfitServer,
  deps: FeedCommentsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // POST /api/v1/feed/:eventId/comments
  // Body: { body: string }   Response: CommentOut
  // Pushes APNs to the event actor (unless the commenter IS the actor) and
  // publishes a `feed:comment` SSE event for live UI updates.
  app.post(
    "/api/v1/feed/:eventId/comments",
    {
      preHandler: authenticate,
      schema: {
        params: EventIdParamSchema,
        body: PostCommentBodySchema,
        response: {
          201: CommentOutSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["feed-comments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.create(
        userId,
        req.params.eventId,
        req.body.body,
      );
      return reply.status(201).send(result);
    },
  );

  // GET /api/v1/feed/:eventId/comments?cursor=&limit=
  // Newest-first, keyset paginated. Default limit 20, max 100.
  app.get(
    "/api/v1/feed/:eventId/comments",
    {
      preHandler: authenticate,
      schema: {
        params: EventIdParamSchema,
        querystring: CommentsQuerySchema,
        response: {
          200: CommentsPageSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["feed-comments"],
      },
    },
    async (req, reply) => {
      const page = await deps.service.list(req.params.eventId, {
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      return reply.status(200).send(page);
    },
  );

  // DELETE /api/v1/feed/comments/:commentId
  // Allowed for the comment's author OR the event's actor (the actor can
  // moderate their own card). Returns 204 on success.
  app.delete(
    "/api/v1/feed/comments/:commentId",
    {
      preHandler: authenticate,
      schema: {
        params: CommentIdParamSchema,
        response: {
          204: EmptyResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["feed-comments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.delete(userId, req.params.commentId);
      return reply.status(204).send({});
    },
  );
}
