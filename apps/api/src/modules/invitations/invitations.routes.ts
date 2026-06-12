import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import {
  AcceptInvitationResponse,
  BatchInviteRequest,
  BatchInviteResponse,
  CreateInvitationRequest,
  DeclineInvitationResponse,
  InvitationSchema,
  InvitationsListQuery,
  InvitationsListResponse,
} from "./invitations.schema.js";
import { type InvitationsService } from "./invitations.service.js";

export interface InvitationsRouteDeps {
  service: InvitationsService;
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

export function registerInvitationsRoutes(
  app: LinkfitServer,
  deps: InvitationsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // POST /api/v1/games/:id/invitations — host invites a player
  app.post(
    "/api/v1/games/:id/invitations",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CreateInvitationRequest,
        response: {
          201: InvitationSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["invitations"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.create(
        req.params.id,
        userId,
        req.body.invitee_user_id,
      );
      return reply.status(201).send(out);
    },
  );

  // POST /api/v1/games/:id/invite — host batch-invites multiple players in
  // a single call. Used by the post-create-game "invite your followers"
  // sheet on iOS. Per-row failures are swallowed so the user gets a clean
  // {sent, blocked} count instead of being forced back to the picker.
  app.post(
    "/api/v1/games/:id/invite",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: BatchInviteRequest,
        response: {
          200: BatchInviteResponse,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["invitations"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.batchInvite(
        req.params.id,
        userId,
        req.body.user_ids,
      );
      return reply.status(200).send(out);
    },
  );

  // GET /api/v1/me/invitations — invitee lists their invites
  app.get(
    "/api/v1/me/invitations",
    {
      preHandler: authenticate,
      schema: {
        querystring: InvitationsListQuery,
        response: {
          200: InvitationsListResponse,
          401: ErrorEnvelope,
        },
        tags: ["invitations"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const items = await deps.service.listForUser(userId, req.query.status);
      return reply.status(200).send({ items });
    },
  );

  // POST /api/v1/invitations/:id/accept
  app.post(
    "/api/v1/invitations/:id/accept",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: AcceptInvitationResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["invitations"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.accept(req.params.id, userId);
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/invitations/:id/decline
  app.post(
    "/api/v1/invitations/:id/decline",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: DeclineInvitationResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["invitations"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const invitation = await deps.service.decline(req.params.id, userId);
      return reply.status(200).send({ invitation });
    },
  );
}
