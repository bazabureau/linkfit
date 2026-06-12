import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import { requireUserId } from "../../shared/auth/guard.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { type AdminGdprService } from "./admin.gdpr.service.js";

export interface AdminGdprRouteDeps {
  service: AdminGdprService;
  db: DbHandle;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
  }),
});

const DeletionViewSchema = z.object({
  user_id: z.string().uuid(),
  requested_at: z.string(),
  hard_delete_at: z.string(),
  days_remaining: z.number().int().nonnegative(),
  user: z
    .object({
      email: z.string().nullable(),
      display_name: z.string().nullable(),
    })
    .nullable(),
});

const ExportViewSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(["queued", "processing", "ready", "failed"]),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  expires_at: z.string(),
  is_downloadable: z.boolean(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function registerAdminGdprRoutes(
  app: LinkfitServer,
  deps: AdminGdprRouteDeps,
): void {
  const requireAdmin = buildAdminGuard({
    db: deps.db,
    jwtAccessSecret: deps.jwtAccessSecret,
  });

  app.get(
    "/api/v1/admin/data-rights/deletions",
    {
      preHandler: requireAdmin,
      schema: {
        querystring: ListQuerySchema,
        response: {
          200: z.object({ items: z.array(DeletionViewSchema) }),
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "data-rights"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const items = await deps.service.listPendingDeletions(adminId, req.query.limit);
      return reply.status(200).send({ items });
    },
  );

  app.post(
    "/api/v1/admin/data-rights/deletions/:userId/cancel",
    {
      preHandler: requireAdmin,
      schema: {
        params: z.object({ userId: z.string().uuid() }),
        response: {
          204: z.null(),
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin", "data-rights"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.forceCancelDeletion(adminId, req.params.userId);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/api/v1/admin/data-rights/exports",
    {
      preHandler: requireAdmin,
      schema: {
        querystring: ListQuerySchema,
        response: {
          200: z.object({ items: z.array(ExportViewSchema) }),
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "data-rights"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const items = await deps.service.listExports(adminId, req.query.limit);
      return reply.status(200).send({ items });
    },
  );
}
