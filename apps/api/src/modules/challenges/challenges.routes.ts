import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard } from "../../shared/auth/guard.js";
import {
  ChallengeCodeSchema,
  CheckChallengeResponseSchema,
  TodayChallengesResponseSchema,
} from "./challenges.schema.js";
import { type ChallengesService } from "./challenges.service.js";

export interface ChallengesRouteDeps {
  service: ChallengesService;
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
 * Registers the daily-challenges surface:
 *
 *   GET  /api/v1/me/challenges/today
 *        → today's three challenges for the authenticated user.
 *
 *   POST /api/v1/me/challenges/:code/check
 *        → polling fallback: server peeks at the source tables and
 *          stamps `completed_at` if the underlying action has been
 *          performed since midnight UTC. The canonical completion
 *          path is the per-action hook fired from FollowsService,
 *          GamesService, StoriesService, etc.
 *
 * The per-action hooks are wired at construction time in
 * `shared/http/server.ts` — see the Wave-10 challenges block in
 * buildServer for the exact callsites. The hooks are fire-and-forget
 * (`void challenges.markCompleted(...)`) so a challenges-table failure
 * never blocks the underlying action.
 */
export function registerChallengesRoutes(
  app: LinkfitServer,
  deps: ChallengesRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/challenges/today",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: TodayChallengesResponseSchema,
          401: ErrorEnvelope,
        },
        tags: ["challenges"],
      },
    },
    async (req, reply) => {
      // requireUserId would also work here, but the preHandler guarantees
      // `authUserId` is set (or it would have already thrown 401).
      const userId = req.authUserId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "User is not authenticated" }
        });
      }
      const result = await deps.service.todayForUser(userId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/api/v1/me/challenges/:code/check",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ code: ChallengeCodeSchema }),
        response: {
          200: CheckChallengeResponseSchema,
          401: ErrorEnvelope,
        },
        tags: ["challenges"],
      },
    },
    async (req, reply) => {
      const userId = req.authUserId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "User is not authenticated" }
        });
      }
      const completed = await deps.service.checkAndMaybeComplete(
        userId,
        req.params.code,
      );
      return reply.status(200).send({ completed });
    },
  );
}
