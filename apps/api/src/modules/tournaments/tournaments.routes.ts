import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../../shared/auth/jwt.js";
import { type TournamentsService } from "./tournaments.service.js";
import {
  MyTournamentsQuery,
  RegisterSquadRequest,
  TournamentDetailSchema,
  TournamentEntrySchema,
  TournamentsListQuery,
  TournamentsListResponse,
} from "./tournaments.schema.js";

export interface TournamentsRouteDeps {
  service: TournamentsService;
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

/** Optional auth — detail endpoint personalizes (my_entry, can_register)
 *  when a token is supplied, but stays publicly browsable. */
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

export function registerTournamentsRoutes(
  app: LinkfitServer,
  deps: TournamentsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // GET /api/v1/tournaments — list with filters
  app.get(
    "/api/v1/tournaments",
    {
      schema: {
        querystring: TournamentsListQuery,
        response: { 200: TournamentsListResponse, 400: ErrorEnvelope },
        tags: ["tournaments"],
      },
    },
    async (req, reply) => {
      const items = await deps.service.list(req.query);
      return reply.status(200).send({ items });
    },
  );

  // GET /api/v1/me/tournaments — tournaments the caller has entered
  app.get(
    "/api/v1/me/tournaments",
    {
      preHandler: authenticate,
      schema: {
        querystring: MyTournamentsQuery,
        response: { 200: TournamentsListResponse, 401: ErrorEnvelope },
        tags: ["tournaments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const items = await deps.service.listForUser(userId, req.query);
      return reply.status(200).send({ items });
    },
  );

  // GET /api/v1/tournaments/:id — detail (optional auth personalizes)
  app.get(
    "/api/v1/tournaments/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: TournamentDetailSchema,
          404: ErrorEnvelope,
        },
        tags: ["tournaments"],
      },
    },
    async (req, reply) => {
      const viewerId = extractOptionalViewer(req, deps.jwtAccessSecret);
      const detail = await deps.service.detail(req.params.id, viewerId);
      return reply.status(200).send(detail);
    },
  );

  // POST /api/v1/tournaments/:id/entries — register squad
  app.post(
    "/api/v1/tournaments/:id/entries",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RegisterSquadRequest,
        response: {
          201: TournamentEntrySchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["tournaments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const entry = await deps.service.register(req.params.id, userId, req.body);
      return reply.status(201).send(entry);
    },
  );

  // DELETE /api/v1/tournaments/:id/entries/:entryId — captain withdraws
  app.delete(
    "/api/v1/tournaments/:id/entries/:entryId",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          entryId: z.string().uuid(),
        }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["tournaments"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.withdraw(req.params.id, req.params.entryId, userId);
      return reply.status(204).send({});
    },
  );
}
