import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  MatchmakingQuery,
  RecommendedGamesResponse,
  RecommendedPlayersResponse,
} from "./matchmaking.schema.js";
import { type MatchmakingService } from "./matchmaking.service.js";

export interface MatchmakingRouteDeps {
  service: MatchmakingService;
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
 * Two `me`-scoped read endpoints powering the iOS "For You" carousels.
 * Both require auth — the recommendations are personalized to the
 * caller's ELO + follow graph + home location.
 */
export function registerMatchmakingRoutes(
  app: LinkfitServer,
  deps: MatchmakingRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/matchmaking/games",
    {
      preHandler: authenticate,
      schema: {
        querystring: MatchmakingQuery,
        response: {
          200: RecommendedGamesResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["matchmaking"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.recommendGames(userId, req.query.limit);
      return reply.status(200).send(payload);
    },
  );

  app.get(
    "/api/v1/me/matchmaking/players",
    {
      preHandler: authenticate,
      schema: {
        querystring: MatchmakingQuery,
        response: {
          200: RecommendedPlayersResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["matchmaking"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.recommendPlayers(userId, req.query.limit);
      return reply.status(200).send(payload);
    },
  );

  /**
   * "Sənə uyğun oyunçular" — strict matchmaker variant. Same response
   * shape as `/players`, but the candidate pool is hard-filtered to the
   * viewer's ELO ±200 bracket and reason_codes are populated.
   * iOS `PlayersView` calls this from the "Sənə uyğun" segment.
   */
  app.get(
    "/api/v1/me/matchmaking/players/for-me",
    {
      preHandler: authenticate,
      schema: {
        querystring: MatchmakingQuery,
        response: {
          200: RecommendedPlayersResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["matchmaking"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const payload = await deps.service.recommendPlayersForMe(userId, req.query.limit);
      return reply.status(200).send(payload);
    },
  );
}
