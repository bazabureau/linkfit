import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard } from "../../shared/auth/guard.js";
import { StreaksResponseSchema } from "./streaks.schema.js";
import { type StreaksService } from "./streaks.service.js";

export interface StreaksRouteDeps {
  service: StreaksService;
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

export function registerStreaksRoutes(
  app: LinkfitServer,
  deps: StreaksRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // GET /api/v1/users/:id/streaks — auth required; any authenticated viewer
  // can read any user's streak (the stat is public-profile material). We
  // gate behind auth anyway so the endpoint isn't a free anonymous scrape
  // surface for activity timing.
  app.get(
    "/api/v1/users/:id/streaks",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: StreaksResponseSchema,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["streaks"],
      },
    },
    async (req, reply) => {
      const result = await deps.service.computeForUser(req.params.id);
      return reply.status(200).send(result);
    },
  );
}
