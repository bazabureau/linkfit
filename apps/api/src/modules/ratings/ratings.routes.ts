import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import {
  PublicProfileSchema,
  SubmitRatingsRequest,
  SubmitRatingsResponse,
} from "./ratings.schema.js";
import { type RatingsService } from "./ratings.service.js";

export interface RatingsRouteDeps {
  service: RatingsService;
  jwtAccessSecret: string;
}

/**
 * Soft-auth: extract the bearer token and decode it without throwing on
 * absence / invalidity. Anonymous callers — and callers with an expired
 * or malformed token — resolve to `null` so the public route still serves
 * the unpersonalized view. Mirrors `extractOptionalViewer` in
 * `social.routes.ts` but kept local so the ratings module stays
 * dependency-free of social internals.
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

export function registerRatingsRoutes(app: LinkfitServer, deps: RatingsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/games/:id/ratings",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: SubmitRatingsRequest,
        response: {
          200: SubmitRatingsResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["ratings"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.submit(req.params.id, userId, req.body);
      return reply.status(200).send(out);
    },
  );

  app.get(
    "/api/v1/users/:id/profile",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: PublicProfileSchema, 404: ErrorEnvelope },
        tags: ["ratings"],
      },
    },
    async (req, reply) => {
      // Optional auth — anonymous callers still get the same payload but
      // with `is_following: false`. Self-view also resolves to false.
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const profile = await deps.service.getPublicProfile(req.params.id, viewerId);
      return reply.status(200).send(profile);
    },
  );
}
