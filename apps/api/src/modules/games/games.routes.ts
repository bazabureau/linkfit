import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import {
  CancelGameRequest,
  CreateGameRequest,
  GameDetailSchema,
  GamesListQuery,
  GamesListResponse,
  RescheduleGameRequest,
  UpdateGameRequest,
} from "./games.schema.js";
import { type GamesService } from "./games.service.js";

export interface GamesRouteDeps {
  service: GamesService;
  jwtAccessSecret: string;
}

/**
 * Soft-auth for the public games list — extracts the viewer id when a
 * valid bearer token is present, silently ignoring missing / expired /
 * malformed tokens. Used to filter games hosted by blocked users without
 * breaking the anonymous-access contract.
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

export function registerGamesRoutes(app: LinkfitServer, deps: GamesRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/games",
    {
      schema: {
        querystring: GamesListQuery,
        response: { 200: GamesListResponse, 400: ErrorEnvelope },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      // Soft-auth so we can hide games hosted by users in a mutual block
      // relationship with the viewer. Anonymous callers see the unfiltered
      // public list, same as before.
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const page = await deps.service.list(req.query, viewerId);
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/api/v1/games",
    {
      preHandler: authenticate,
      schema: {
        body: CreateGameRequest,
        response: { 201: GameDetailSchema, 400: ErrorEnvelope, 401: ErrorEnvelope },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const game = await deps.service.create(userId, req.body);
      return reply.status(201).send(game);
    },
  );

  app.get(
    "/api/v1/games/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: GameDetailSchema, 404: ErrorEnvelope },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const game = await deps.service.getDetail(req.params.id);
      return reply.status(200).send(game);
    },
  );

  app.patch(
    "/api/v1/games/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateGameRequest,
        response: {
          200: GameDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const game = await deps.service.update(req.params.id, userId, req.body);
      return reply.status(200).send(game);
    },
  );

  app.delete(
    "/api/v1/games/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: z.null(),
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.softDelete(req.params.id, userId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/api/v1/games/:id/join",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: GameDetailSchema,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const game = await deps.service.join(req.params.id, userId);
      return reply.status(200).send(game);
    },
  );

  app.post(
    "/api/v1/games/:id/leave",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: GameDetailSchema,
          401: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const game = await deps.service.leave(req.params.id, userId);
      return reply.status(200).send(game);
    },
  );

  // Wave-10 dedicated cancel endpoint. Hosts use this instead of the
  // legacy `PATCH /api/v1/games/:id { cancel: true }` so they can attach a
  // free-text reason that fans out into participant push notifications.
  // 204 No Content — the iOS flow pops back to the games list on success.
  app.post(
    "/api/v1/games/:id/cancel",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CancelGameRequest,
        response: {
          204: z.null(),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.cancelGame(req.params.id, userId, req.body.reason);
      return reply.status(204).send(null);
    },
  );

  // Wave-10 dedicated reschedule endpoint. Returns the refreshed game
  // detail so the iOS sheet can dismiss + the detail screen can re-paint
  // without an extra GET. Push fan-out to confirmed participants is
  // handled by the service.
  app.patch(
    "/api/v1/games/:id/reschedule",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RescheduleGameRequest,
        response: {
          200: GameDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const startsAt = new Date(req.body.starts_at);
      const game = await deps.service.rescheduleGame(
        req.params.id,
        userId,
        startsAt,
        req.body.duration_minutes,
      );
      return reply.status(200).send(game);
    },
  );

  app.post(
    "/api/v1/games/:id/participants/:uid/no-show",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid(), uid: z.string().uuid() }),
        response: {
          200: GameDetailSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["games"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const game = await deps.service.markNoShow(req.params.id, userId, req.params.uid);
      return reply.status(200).send(game);
    },
  );
}
