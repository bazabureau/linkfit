import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import { requireUserId } from "../../shared/auth/guard.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { type AdminModerationService } from "./admin.moderation.service.js";

export interface AdminModerationRouteDeps {
  service: AdminModerationService;
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
const Empty = z.object({}).strict();

// ─── Schemas ──────────────────────────────────────────────────────────────

const ReportStatusEnum = z.enum(["pending", "reviewed", "dismissed"]);

const ListQuery = z.object({
  status: ReportStatusEnum.optional(),
  cursor: z.string().min(1).max(400).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const ReporterSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  photo_url: z.string().nullable(),
});

const TargetUserSchema = z.object({
  kind: z.literal("user"),
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  photo_url: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string().nullable(),
});

const TargetGameSchema = z.object({
  kind: z.literal("game"),
  game_id: z.string().uuid(),
  host_user_id: z.string().uuid().nullable(),
  host_display_name: z.string().nullable(),
  sport_slug: z.string().nullable(),
  starts_at: z.string().nullable(),
  status: z.string().nullable(),
  deleted_at: z.string().nullable(),
});

const TargetMessageSchema = z.object({
  kind: z.literal("message"),
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  sender_user_id: z.string().uuid().nullable(),
  sender_display_name: z.string().nullable(),
  body_preview: z.string().nullable(),
  created_at: z.string().nullable(),
});

/**
 * Report target kind enum — kept in sync with the DB type
 * (`shared/db/types.ts → ReportTargetKind`). Wider than the user-facing
 * report-creation enum because legacy / cross-module rows can reference
 * stories or feed comments.
 */
const TargetKindEnum = z.enum([
  "user",
  "game",
  "message",
  "story",
  "feed_comment",
]);

const TargetMissingSchema = z.object({
  kind: z.literal("missing"),
  claimed_kind: TargetKindEnum,
  claimed_id: z.string(),
});

const EnrichedTargetSchema = z.discriminatedUnion("kind", [
  TargetUserSchema,
  TargetGameSchema,
  TargetMessageSchema,
  TargetMissingSchema,
]);

const EnrichedReportSchema = z.object({
  id: z.string().uuid(),
  reporter: ReporterSchema,
  target_kind: TargetKindEnum,
  target_id: z.string(),
  target: EnrichedTargetSchema,
  reason: z.enum([
    "spam",
    "harassment",
    "no_show",
    "fake_profile",
    "inappropriate_content",
    "other",
  ]),
  status: ReportStatusEnum,
  notes: z.string().nullable(),
  reviewed_by_user_id: z.string().uuid().nullable(),
  reviewer_display_name: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});

const ListResponse = z.object({
  reports: z.array(EnrichedReportSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});

const ReviewActionEnum = z.enum([
  "dismiss",
  "warn",
  "deactivate_target",
  "delete_target",
]);

const ReviewRequest = z.object({
  action: ReviewActionEnum,
  notes: z.string().max(2000).optional(),
});

const UserDetailResponse = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  admin_role: z.enum(["admin", "moderator"]).nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  games_played_total: z.number().int().nonnegative(),
  games_hosted_total: z.number().int().nonnegative(),
  reports_filed_count: z.number().int().nonnegative(),
  reports_received_count: z.number().int().nonnegative(),
  recent_reports_filed: z.array(EnrichedReportSchema),
  recent_reports_received: z.array(EnrichedReportSchema),
});

const DeactivateRequest = z.object({
  reason: z.string().min(1).max(500),
  duration_days: z.number().int().positive().max(365).optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * Admin moderation queue routes. Mounted under `/api/v1/admin/moderation`
 * to keep them separate from the lower-level reports module surface
 * (`/api/v1/admin/reports`) — the latter is feature-frozen, the former is
 * the rich UI-facing view + action endpoint.
 *
 * Auth: all routes require admin or moderator role via the shared admin
 * guard (which hits the DB on every request to honour live role
 * revocation).
 */
export function registerAdminModerationRoutes(
  app: LinkfitServer,
  deps: AdminModerationRouteDeps,
): void {
  const adminGuard = buildAdminGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db: deps.db,
  });

  app.get(
    "/api/v1/admin/moderation/reports",
    {
      preHandler: adminGuard,
      schema: {
        querystring: ListQuery,
        response: {
          200: ListResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "moderation"],
      },
    },
    async (req, reply) => {
      // exactOptionalPropertyTypes: don't spread `status: undefined`, omit
      // the key entirely so the service signature stays strict.
      const page = await deps.service.listReports({
        ...(req.query.status ? { status: req.query.status } : {}),
        limit: req.query.limit ?? 25,
        cursor: req.query.cursor ?? null,
      });
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/api/v1/admin/moderation/reports/:id/review",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ReviewRequest,
        response: {
          200: EnrichedReportSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin", "moderation"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const out = await deps.service.reviewWithAction(adminId, req.params.id, {
        action: req.body.action,
        notes: req.body.notes ?? null,
      });
      return reply.status(200).send(out);
    },
  );

  app.get(
    "/api/v1/admin/moderation/users/:id",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: UserDetailResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
        },
        tags: ["admin", "moderation"],
      },
    },
    async (req, reply) => {
      const detail = await deps.service.getUserDetail(req.params.id);
      return reply.status(200).send(detail);
    },
  );

  app.post(
    "/api/v1/admin/moderation/users/:id/deactivate",
    {
      preHandler: adminGuard,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: DeactivateRequest,
        response: {
          204: Empty,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          409: ErrorEnvelope,
        },
        tags: ["admin", "moderation"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      await deps.service.deactivateUser(adminId, req.params.id, {
        reason: req.body.reason,
        duration_days: req.body.duration_days ?? null,
      });
      return reply.status(204).send({});
    },
  );
}
