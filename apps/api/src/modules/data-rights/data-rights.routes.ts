import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type DataRightsService } from "./data-rights.service.js";

export interface DataRightsRouteDeps {
  service: DataRightsService;
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

// Response shape — both `id`/`scheduled_at` (iOS-friendly) and
// `user_id`/`requested_at` (legacy backend names) are emitted so a single
// payload deserializes cleanly in every client. See
// `data-rights.service.ts#mapDeletionRow` for the rationale.
const AccountDeletionResponse = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(["scheduled", "cancelled", "completed"]),
  requested_at: z.string(),
  scheduled_at: z.string(),
  hard_delete_at: z.string(),
  cancelled_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

const DataExportResponse = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  status: z.enum(["queued", "processing", "ready", "failed"]),
  download_url: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export function registerDataRightsRoutes(
  app: LinkfitServer,
  deps: DataRightsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  // ── Account deletion ──────────────────────────────────────────────

  app.delete(
    "/api/v1/me",
    {
      preHandler: authenticate,
      schema: {
        response: {
          202: AccountDeletionResponse,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.requestDeletion(userId);
      // 202 Accepted — deletion is queued, not immediate. The 30-day grace
      // window is the canonical contract; we return the schedule so the
      // client can show "Your account will be permanently deleted on …".
      return reply.status(202).send(result);
    },
  );

  // iOS calls `POST /api/v1/me/delete` (mirror of the GET status endpoint
  // below). Mobile clients dislike `DELETE` with no body and many proxies
  // strip it, so we expose the same operation via POST. Both routes share
  // a single service method — the alias never goes out of sync.
  app.post(
    "/api/v1/me/delete",
    {
      preHandler: authenticate,
      schema: {
        response: {
          202: AccountDeletionResponse,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.requestDeletion(userId);
      return reply.status(202).send(result);
    },
  );

  app.post(
    "/api/v1/me/delete/cancel",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: AccountDeletionResponse,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.cancelDeletion(userId);
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/api/v1/me/delete",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: AccountDeletionResponse.nullable(),
          401: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.getDeletionStatus(userId);
      return reply.status(200).send(result);
    },
  );

  // ── Data export ────────────────────────────────────────────────────

  app.post(
    "/api/v1/me/data-export",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: DataExportResponse,
          401: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.requestExport(userId);
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/api/v1/me/data-export",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: DataExportResponse.nullable(),
          401: ErrorEnvelope,
        },
        tags: ["data-rights"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.getLatestExport(userId);
      return reply.status(200).send(result);
    },
  );
}
