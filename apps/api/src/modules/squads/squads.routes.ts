import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  CreateSquadRequest,
  InviteSquadRequest,
  MeSquadsResponse,
  SquadDetailSchema,
  SquadGamesQuery,
  SquadGamesResponse,
  UpdateSquadRequest,
} from "./squads.schema.js";
import { type SquadsService } from "./squads.service.js";

export interface SquadsRouteDeps {
  service: SquadsService;
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

export function registerSquadsRoutes(app: LinkfitServer, deps: SquadsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/squads",
    {
      preHandler: authenticate,
      schema: {
        body: CreateSquadRequest,
        response: {
          201: SquadDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const squad = await deps.service.create(userId, req.body);
      return reply.status(201).send(squad);
    },
  );

  app.get(
    "/api/v1/squads/me",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: MeSquadsResponse, 401: ErrorEnvelope },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const squads = await deps.service.listForUser(userId);
      return reply.status(200).send({ squads });
    },
  );

  app.get(
    "/api/v1/squads/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: SquadDetailSchema,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const detail = await deps.service.getDetail(req.params.id);
      return reply.status(200).send(detail);
    },
  );

  app.patch(
    "/api/v1/squads/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateSquadRequest,
        response: {
          200: SquadDetailSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const detail = await deps.service.update(req.params.id, userId, req.body);
      return reply.status(200).send(detail);
    },
  );

  app.post(
    "/api/v1/squads/:id/invite",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: InviteSquadRequest,
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.invite(req.params.id, userId, req.body.user_id);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/squads/:id/accept",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.accept(req.params.id, userId);
      return reply.status(204).send({});
    },
  );

  app.post(
    "/api/v1/squads/:id/leave",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.leave(req.params.id, userId);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/squads/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.delete(req.params.id, userId);
      return reply.status(204).send({});
    },
  );

  app.get(
    "/api/v1/squads/:id/games",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: SquadGamesQuery,
        response: {
          200: SquadGamesResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["squads"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const since = req.query.since !== undefined ? new Date(req.query.since) : new Date();
      const games = await deps.service.listGames(req.params.id, userId, since);
      return reply.status(200).send({ games });
    },
  );
}
