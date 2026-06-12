import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import {
  LeaderboardEloQuery,
  LeaderboardEloResponse,
} from "./leaderboards.schema.js";
import { type LeaderboardsService } from "./leaderboards.service.js";

export interface LeaderboardsRouteDeps {
  service: LeaderboardsService;
  jwtAccessSecret: string;
}

/**
 * Soft-auth: extract the bearer token and decode it without throwing on
 * absence / invalidity. Anonymous callers — and callers with an expired
 * or malformed token — resolve to `null` so the public leaderboard still
 * renders. When a viewer id IS resolved we feed it to the service so the
 * bidirectional block filter can drop hidden users. Mirrors
 * `extractOptionalViewer` in `feed.routes.ts` / `ratings.routes.ts`.
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

/**
 * Mounts `GET /api/v1/leaderboards/elo`. The route is public (no auth
 * required) so anyone can see the top-N ladder, but if the caller is
 * signed in we use their viewer id to apply the bidirectional block
 * filter and hide users they don't want to see in the list.
 */
export function registerLeaderboardsRoutes(
  app: LinkfitServer,
  deps: LeaderboardsRouteDeps,
): void {
  app.get(
    "/api/v1/leaderboards/elo",
    {
      schema: {
        querystring: LeaderboardEloQuery,
        response: {
          200: LeaderboardEloResponse,
          400: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["leaderboards"],
      },
    },
    async (req, reply) => {
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const payload = await deps.service.listEloLeaderboard(viewerId, {
        sport: req.query.sport,
        limit: req.query.limit,
        offset: req.query.offset,
        region: req.query.region,
        scope: req.query.scope,
        skill: req.query.skill,
        period: req.query.period,
      });
      return reply.status(200).send(payload);
    },
  );
}
