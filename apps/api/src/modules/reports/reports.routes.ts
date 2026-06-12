import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type DbHandle } from "../../shared/db/pool.js";
import {
  CreateReportRequest,
  MyReportsQuery,
  MyReportsResponse,
  ReportSchema,
  ReportsListQuery,
  ReportsListResponse,
  ReviewReportRequest,
} from "./reports.schema.js";
import { ReportsService } from "./reports.service.js";

export interface ReportsRouteDeps {
  db: DbHandle;
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
 * Reports + moderation HTTP surface.
 *
 * The user-facing `POST /api/v1/reports` is auth-only (any signed-in user).
 * Everything under `/api/v1/admin/reports*` is admin-only and goes through
 * the shared admin guard so a downgraded admin loses access immediately.
 *
 * Why this module owns its routes (rather than nesting under admin.routes):
 *  - The create endpoint is a regular user surface, not an admin one — it
 *    doesn't belong under the admin folder.
 *  - Keeps the reports service single-owner. Admin module no longer
 *    imports the reports service.
 */
export function registerReportsRoutes(app: LinkfitServer, deps: ReportsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });
  const adminGuard = buildAdminGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db: deps.db,
  });
  const service = new ReportsService({ db: deps.db });

  // ─── User-facing ────────────────────────────────────────────────────────

  app.post(
    "/api/v1/reports",
    {
      preHandler: authenticate,
      schema: {
        body: CreateReportRequest,
        response: {
          201: ReportSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          404: ErrorEnvelope,
          429: ErrorEnvelope,
        },
        tags: ["reports"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await service.create(userId, req.body);
      return reply.status(201).send(out);
    },
  );

  /**
   * User-facing "my reports" history (Wave-10). Returns the caller's
   * submitted reports newest-first with an opaque cursor for forward
   * pagination. Reviewer metadata is stripped — see `MyReportItem` in
   * reports.schema.ts for why this is a distinct shape from `ReportSchema`.
   */
  app.get(
    "/api/v1/me/reports",
    {
      preHandler: authenticate,
      schema: {
        querystring: MyReportsQuery,
        response: {
          200: MyReportsResponse,
          401: ErrorEnvelope,
        },
        tags: ["reports"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const page = await service.listMy(userId, req.query);
      return reply.status(200).send(page);
    },
  );

  // ─── Admin moderation queue ─────────────────────────────────────────────

  app.get(
    "/api/v1/admin/reports",
    {
      preHandler: adminGuard,
      schema: {
        querystring: ReportsListQuery,
        response: {
          200: ReportsListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "reports"],
      },
    },
    async (req, reply) => {
      const page = await service.list(req.query);
      return reply.status(200).send(page);
    },
  );

  /**
   * PATCH semantics: target the resource directly, body carries the new
   * state. This replaces the older POST /:id/review surface — the spec
   * asked for PATCH so the iOS / web admin can use a single shape.
   */
  app.patch(
    "/api/v1/admin/reports/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ReviewReportRequest,
        response: {
          200: ReportSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin", "reports"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const out = await service.review(adminId, req.params.id, req.body);
      return reply.status(200).send(out);
    },
  );
}
