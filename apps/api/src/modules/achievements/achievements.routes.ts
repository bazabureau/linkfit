import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type AchievementsService } from "./achievements.service.js";
import { UserAchievementsResponse } from "./achievements.schema.js";

export interface AchievementsRouteDeps {
  service: AchievementsService;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export function registerAchievementsRoutes(
  app: LinkfitServer,
  deps: AchievementsRouteDeps,
): void {
  // GET /api/v1/users/:id/achievements — public read.
  //
  // Returns the full catalog tagged unlocked/locked with a structured
  // `progress` payload toward each locked badge. We don't gate behind
  // authentication because badges are part of the public profile.
  app.get(
    "/api/v1/users/:id/achievements",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: UserAchievementsResponse,
          404: ErrorEnvelope,
        },
        tags: ["achievements"],
      },
    },
    async (req, reply) => {
      const result = await deps.service.listForUser(req.params.id);
      return reply.status(200).send(result);
    },
  );
}
