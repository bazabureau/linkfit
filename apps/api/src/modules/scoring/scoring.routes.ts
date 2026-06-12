// === Scoring agent — routes ===
//
//   POST   /api/v1/games/:id/scoring/start      (host)
//   POST   /api/v1/games/:id/scoring/point      (confirmed participant)
//   POST   /api/v1/games/:id/scoring/undo       (confirmed participant)
//   POST   /api/v1/games/:id/scoring/complete   (confirmed participant)
//   GET    /api/v1/games/:id/scoring            (public)

import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  MatchScoreSchema,
  PointRequest,
  StartScoringRequest,
} from "./scoring.schema.js";
import { type ScoringService } from "./scoring.service.js";

export interface ScoringRouteDeps {
  service: ScoringService;
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

const GameIdParam = z.object({ id: z.string().uuid() });

export function registerScoringRoutes(app: LinkfitServer, deps: ScoringRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/games/:id/scoring/start",
    {
      preHandler: authenticate,
      schema: {
        params: GameIdParam,
        body: StartScoringRequest,
        response: {
          201: MatchScoreSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["scoring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const view = await deps.service.start(req.params.id, userId, req.body);
      return reply.status(201).send(view);
    },
  );

  app.post(
    "/api/v1/games/:id/scoring/point",
    {
      preHandler: authenticate,
      schema: {
        params: GameIdParam,
        body: PointRequest,
        response: {
          200: MatchScoreSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["scoring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const view = await deps.service.point(req.params.id, userId, req.body.team);
      return reply.status(200).send(view);
    },
  );

  app.post(
    "/api/v1/games/:id/scoring/undo",
    {
      preHandler: authenticate,
      schema: {
        params: GameIdParam,
        response: {
          200: MatchScoreSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["scoring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const view = await deps.service.undo(req.params.id, userId);
      return reply.status(200).send(view);
    },
  );

  app.post(
    "/api/v1/games/:id/scoring/complete",
    {
      preHandler: authenticate,
      schema: {
        params: GameIdParam,
        response: {
          200: MatchScoreSchema,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["scoring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const view = await deps.service.complete(req.params.id, userId);
      return reply.status(200).send(view);
    },
  );

  app.get(
    "/api/v1/games/:id/scoring",
    {
      schema: {
        params: GameIdParam,
        response: {
          200: MatchScoreSchema,
          404: ErrorEnvelope,
        },
        tags: ["scoring"],
      },
    },
    async (req, reply) => {
      const view = await deps.service.get(req.params.id);
      return reply.status(200).send(view);
    },
  );
}
