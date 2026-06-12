import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type FollowsService } from "./follows.service.js";
import { verifyAccessToken } from "../../shared/auth/jwt.js";

export interface FollowsRouteDeps {
  follows: FollowsService;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});
const Empty = z.object({}).strict();

const FollowEdgeUserSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  followed_at: z.string(),
  is_following: z.boolean(),
});

const FollowsPageSchema = z.object({
  items: z.array(FollowEdgeUserSchema),
  next_offset: z.number().int().nonnegative().nullable(),
});

const FollowsPageQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export function registerFollowsRoutes(app: LinkfitServer, deps: FollowsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/users/:id/follow",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["follows"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.follows.follow(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/users/:id/follow",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["follows"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.follows.unfollow(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/users/:id/followers/:followerId",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          followerId: z.string().uuid(),
        }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["follows"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.follows.removeFollower(userId, req.params.id, req.params.followerId);
      return reply.status(204).send({});
    },
  );

  app.get(
    "/api/v1/users/:id/followers",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: FollowsPageQuery,
        response: { 200: FollowsPageSchema, 404: ErrorEnvelope },
        tags: ["follows"],
      },
    },
    async (req, reply) => {
      let viewerUserId = "00000000-0000-0000-0000-000000000000";
      const header = req.headers.authorization;
      if (typeof header === "string" && header.startsWith("Bearer ")) {
        const token = header.slice("Bearer ".length).trim();
        if (token.length > 0) {
          try {
            const claims = verifyAccessToken(token, deps.jwtAccessSecret);
            viewerUserId = claims.sub;
          } catch {
            // ignore token errors for public page views
          }
        }
      }
      const page = await deps.follows.followers(req.params.id, viewerUserId, {
        limit: req.query.limit ?? 30,
        offset: req.query.offset ?? 0,
      });
      return reply.status(200).send(page);
    },
  );

  app.get(
    "/api/v1/users/:id/following",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: FollowsPageQuery,
        response: { 200: FollowsPageSchema, 404: ErrorEnvelope },
        tags: ["follows"],
      },
    },
    async (req, reply) => {
      let viewerUserId = "00000000-0000-0000-0000-000000000000";
      const header = req.headers.authorization;
      if (typeof header === "string" && header.startsWith("Bearer ")) {
        const token = header.slice("Bearer ".length).trim();
        if (token.length > 0) {
          try {
            const claims = verifyAccessToken(token, deps.jwtAccessSecret);
            viewerUserId = claims.sub;
          } catch {
            // ignore token errors for public page views
          }
        }
      }
      const page = await deps.follows.following(req.params.id, viewerUserId, {
        limit: req.query.limit ?? 30,
        offset: req.query.offset ?? 0,
      });
      return reply.status(200).send(page);
    },
  );
}
