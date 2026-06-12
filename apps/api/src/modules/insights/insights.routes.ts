import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InsightsQuery, InsightsResponse } from "./insights.schema.js";
import { type InsightsService } from "./insights.service.js";

export interface InsightsRouteDeps {
  service: InsightsService;
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

export function registerInsightsRoutes(app: LinkfitServer, deps: InsightsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/insights",
    {
      preHandler: authenticate,
      schema: {
        querystring: InsightsQuery,
        response: {
          200: InsightsResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["insights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.getForUser(userId, req.query);
      return reply.status(200).send(payload);
    },
  );
}
