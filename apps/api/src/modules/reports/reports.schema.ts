import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────

/** Target table the report points at. Free-form `target_id` is validated in
 * service.create — see assertTargetExists.
 *
 * Wave-10 added `story` and `feed_comment` so iOS can surface a "Şikayət et"
 * action on the story viewer and feed-comment rows. The underlying DB enum
 * is extended by migration 1700000380000_reports.sql. */
export const ReportTargetKindEnum = z.enum([
  "user",
  "game",
  "message",
  "story",
  "feed_comment",
]);
export type ReportTargetKindZod = z.infer<typeof ReportTargetKindEnum>;

/** Lifecycle states. `pending` is the only state a user can land a report in.
 * `reviewed` / `dismissed` are admin-only terminal states. */
export const ReportStatusEnum = z.enum(["pending", "reviewed", "dismissed"]);

/** Fixed set of reasons shown on the iOS report sheet. Adding a new one is
 * a 3-file change: this enum, the SQL migration, the localization
 * `xcstrings`. The iOS layer renders the labels — the server only persists
 * the symbol. */
export const ReportReasonEnum = z.enum([
  "spam",
  "harassment",
  "no_show",
  "fake_profile",
  "inappropriate_content",
  "other",
]);
export type ReportReasonZod = z.infer<typeof ReportReasonEnum>;

// ─── Response shape ───────────────────────────────────────────────────────

export const ReportSchema = z.object({
  id: z.string().uuid(),
  reporter_user_id: z.string().uuid(),
  reporter_display_name: z.string().nullable(),
  target_kind: ReportTargetKindEnum,
  target_id: z.string().uuid(),
  reason: ReportReasonEnum,
  status: ReportStatusEnum,
  notes: z.string().nullable(),
  reviewed_by_user_id: z.string().uuid().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});
export type ReportOut = z.infer<typeof ReportSchema>;

// ─── Request bodies ───────────────────────────────────────────────────────

/** User-facing create request. `notes` is optional free-text context — we
 * cap it hard at 2000 chars so a single bad actor can't bloat the table. */
export const CreateReportRequest = z.object({
  target_kind: ReportTargetKindEnum,
  target_id: z.string().uuid(),
  reason: ReportReasonEnum,
  notes: z.string().min(1).max(2000).optional(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequest>;

/** Admin review action. Status must move OFF pending — we reject the
 * no-op `pending` transition to keep the audit trail honest. */
export const ReviewReportRequest = z.object({
  status: z.enum(["reviewed", "dismissed"]),
  notes: z.string().max(2000).optional(),
});
export type ReviewReportRequest = z.infer<typeof ReviewReportRequest>;

// ─── List query / response ────────────────────────────────────────────────

export const ReportsListQuery = z.object({
  status: ReportStatusEnum.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type ReportsListQuery = z.infer<typeof ReportsListQuery>;

export const ReportsListResponse = z.object({
  items: z.array(ReportSchema),
  total: z.number().int().nonnegative(),
});

// ─── User-facing "my reports" list ───────────────────────────────────────

/** Trimmed shape for `GET /api/v1/me/reports`. The reporter doesn't need to
 * see moderator notes, the reviewer's id, or their own display name — just
 * what they reported and the current state. Sent down with an opaque cursor
 * so the iOS history screen can paginate forwards in time without a total. */
export const MyReportItem = z.object({
  id: z.string().uuid(),
  target_kind: ReportTargetKindEnum,
  target_id: z.string().uuid(),
  status: ReportStatusEnum,
  created_at: z.string(),
});
export type MyReportItem = z.infer<typeof MyReportItem>;

export const MyReportsQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type MyReportsQuery = z.infer<typeof MyReportsQuery>;

export const MyReportsResponse = z.object({
  reports: z.array(MyReportItem),
  next_cursor: z.string().nullable(),
});
export type MyReportsResponse = z.infer<typeof MyReportsResponse>;
