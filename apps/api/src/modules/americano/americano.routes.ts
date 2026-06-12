import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type AmericanoService } from "./americano.service.js";
import { CreateAmericanoRequest, RecordScoreRequest } from "./americano.schema.js";

export interface AmericanoRouteDeps {
  service: AmericanoService;
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

export function registerAmericanoRoutes(
  app: LinkfitServer,
  deps: AmericanoRouteDeps
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // 1. POST /api/v1/americano/tournaments — Create tournament
  app.post(
    "/api/v1/americano/tournaments",
    {
      preHandler: authenticate,
      schema: {
        body: CreateAmericanoRequest,
        response: {
          201: z.object({ id: z.string().uuid() }),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["americano"],
      },
    },
    async (req, reply) => {
      const hostId = requireUserId(req);
      const tournamentId = await deps.service.createTournament(hostId, req.body);
      return reply.status(201).send({ id: tournamentId });
    }
  );

  // 2. GET /api/v1/americano/tournaments/my — Get host's tournaments
  app.get(
    "/api/v1/americano/tournaments/my",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                format: z.enum(["solo", "team"]),
                host_id: z.string().uuid(),
                court_count: z.number(),
                scoring_system: z.string(),
                status: z.enum(["open", "playing", "completed"]),
                created_at: z.date(),
              })
            ),
          }),
          401: ErrorEnvelope,
        },
        tags: ["americano"],
      },
    },
    async (req, reply) => {
      const hostId = requireUserId(req);
      const items = await deps.service.getTournamentsByHost(hostId);
      return reply.status(200).send({ items });
    }
  );

  // 3. GET /api/v1/americano/tournaments/:id — Get tournament details & dynamic leaderboard
  app.get(
    "/api/v1/americano/tournaments/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            tournament: z.object({
              id: z.string().uuid(),
              name: z.string(),
              format: z.enum(["solo", "team"]),
              host_id: z.string().uuid(),
              court_count: z.number(),
              scoring_system: z.string(),
              status: z.enum(["open", "playing", "completed"]),
              created_at: z.date(),
            }),
            teams: z.array(
              z.object({
                id: z.string().uuid(),
                tournament_id: z.string().uuid(),
                display_name: z.string(),
                wins: z.number(),
                draws: z.number(),
                losses: z.number(),
                score: z.number(),
              })
            ),
            matches: z.array(
              z.object({
                id: z.string().uuid(),
                tournament_id: z.string().uuid(),
                court_name: z.string(),
                round_number: z.number(),
                team_a_id: z.string().uuid(),
                team_b_id: z.string().uuid(),
                score_a: z.number().nullable(),
                score_b: z.number().nullable(),
                status: z.enum(["pending", "completed"]),
              })
            ),
            leaderboard: z.array(
              z.object({
                id: z.string().uuid(),
                display_name: z.string(),
                wins: z.number(),
                draws: z.number(),
                losses: z.number(),
                score: z.number(),
                pointsScored: z.number(),
                pointsConceded: z.number(),
                pointsDifference: z.number(),
              })
            ),
            reward: z
              .object({
                id: z.string().uuid(),
                tournament_id: z.string().uuid(),
                winner_team_id: z.string().uuid(),
                sponsor_coupon_code: z.string(),
                prize_name: z.string(),
              })
              .nullable(),
          }),
          404: ErrorEnvelope,
        },
        tags: ["americano"],
      },
    },
    async (req, reply) => {
      const details = await deps.service.getTournamentDetails(req.params.id);
      return reply.status(200).send(details);
    }
  );

  // 4. POST /api/v1/americano/matches/:id/score — Record score
  app.post(
    "/api/v1/americano/matches/:id/score",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RecordScoreRequest,
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["americano"],
      },
    },
    async (req, reply) => {
      const hostId = requireUserId(req);
      await deps.service.recordMatchScore(hostId, req.params.id, req.body);
      return reply.status(204).send({});
    }
  );
}
