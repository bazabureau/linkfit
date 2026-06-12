import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  CancelSeriesRequest,
  CancelSeriesResponse,
  CreateSeriesRequest,
  SeriesDetailSchema,
} from "./recurring.schema.js";
import { type RecurringService } from "./recurring.service.js";

export interface RecurringRouteDeps {
  service: RecurringService;
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

export function registerRecurringRoutes(
  app: LinkfitServer,
  deps: RecurringRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // POST /api/v1/game-series — create & materialize.
  app.post(
    "/api/v1/game-series",
    {
      preHandler: authenticate,
      schema: {
        body: CreateSeriesRequest,
        response: {
          201: SeriesDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["recurring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const series = await deps.service.create(userId, req.body);
      return reply.status(201).send(series);
    },
  );

  // GET /api/v1/game-series/:id — series detail with embedded games.
  app.get(
    "/api/v1/game-series/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: SeriesDetailSchema,
          404: ErrorEnvelope,
        },
        tags: ["recurring"],
      },
    },
    async (req, reply) => {
      const series = await deps.service.getDetail(req.params.id);
      return reply.status(200).send(series);
    },
  );

  // POST /api/v1/game-series/:id/cancel — host-only, cancel from N forward.
  app.post(
    "/api/v1/game-series/:id/cancel",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CancelSeriesRequest,
        response: {
          200: CancelSeriesResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["recurring"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.cancel(
        req.params.id,
        userId,
        req.body.from_occurrence,
      );
      return reply.status(200).send(result);
    },
  );
}
