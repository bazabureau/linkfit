import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type BlocksService } from "./blocks.service.js";

export interface BlocksRouteDeps {
  blocks: BlocksService;
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

const BlockedUserSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  blocked_at: z.string(),
});

const BlocksListResponse = z.object({
  items: z.array(BlockedUserSchema),
});

/**
 * Block management endpoints. Parallels follow:
 *   POST   /api/v1/users/:id/block   — idempotent block
 *   DELETE /api/v1/users/:id/block   — idempotent unblock
 *
 * Both return 204 on success. Validation, not-found and self-block errors
 * surface via the shared envelope so the iOS APIError layer renders them
 * uniformly.
 */
export function registerBlocksRoutes(app: LinkfitServer, deps: BlocksRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/users/:id/block",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["blocks"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.blocks.block(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/users/:id/block",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["blocks"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.blocks.unblock(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  // Lists users the caller has blocked, newest first. Backs the iOS
  // Privacy → "Blocked users" screen so users can unblock from the list.
  // No pagination — a single user rarely blocks 100+ people; if it ever
  // matters, add limit/offset later.
  app.get(
    "/api/v1/me/blocks",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: BlocksListResponse,
          401: ErrorEnvelope,
        },
        tags: ["blocks"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const items = await deps.blocks.listFor(userId);
      return reply.status(200).send({ items });
    },
  );
}
