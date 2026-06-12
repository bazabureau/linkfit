import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { SuggestedFollowsResponse } from "./schema.js";
import { type SuggestedFollowsService } from "./service.js";

export interface SuggestedFollowsRouteDeps {
  service: SuggestedFollowsService;
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

/**
 * Mounts `GET /api/v1/me/suggested-follows`. Auth-required. Returns a
 * ranked carousel of users the viewer should consider following — currently
 * scored by shared confirmed-game history. The iOS PlayersView consumes
 * this on cold-load and after each follow/unfollow toggle.
 */
export function registerSuggestedFollowsRoutes(
  app: LinkfitServer,
  deps: SuggestedFollowsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/suggested-follows",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: SuggestedFollowsResponse,
          401: ErrorEnvelope,
        },
        tags: ["suggested-follows"],
      },
    },
    async (req, reply) => {
      const viewerId = requireUserId(req);
      const payload = await deps.service.listForViewer(viewerId);
      return reply.status(200).send(payload);
    },
  );
}
