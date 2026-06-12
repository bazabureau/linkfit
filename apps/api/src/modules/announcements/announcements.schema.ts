import { z } from "zod";

/**
 * Wire schemas for the Announcements agent (Wave-10).
 *
 * Two surfaces:
 *
 *   * `/api/v1/me/announcements`           — user-facing GET + dismiss POST.
 *                                            Returns the highest-priority
 *                                            active announcement not yet
 *                                            dismissed by the caller, in
 *                                            the caller's locale (already
 *                                            collapsed to one title/body/
 *                                            cta_label trio).
 *
 *   * `/api/v1/admin/announcements`        — admin POST that creates a new
 *                                            broadcast with AZ/EN/RU copy.
 *
 * `fastify-type-provider-zod` lifts these into the OpenAPI doc.
 */

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export const Empty = z.object({}).strict();

/**
 * Audience filter. `all` reaches every authenticated user; the three locale
 * values scope the broadcast to readers whose effective locale matches.
 * Mirrors the CHECK constraint in migration 1700000384000.
 */
export const AnnouncementAudience = z.enum(["all", "az", "en", "ru"]);
export type AnnouncementAudience = z.infer<typeof AnnouncementAudience>;

/**
 * Locale-collapsed wire shape returned to the iOS client. The service picks
 * the right trio (title/body/cta_label) for the caller's locale before
 * sending so the client renders a single string — no per-row locale logic
 * on the device.
 *
 * `cta_url` is either a `linkfit://` custom-scheme deep link (routed through
 * `URLDeepLinkRouter`) or an external `https://` URL (opened with the system
 * browser). The client decides via the scheme.
 */
export const AnnouncementForUser = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string().nullable(),
  cta_label: z.string().nullable(),
  cta_url: z.string().nullable(),
});
export type AnnouncementForUser = z.infer<typeof AnnouncementForUser>;

/**
 * `GET /api/v1/me/announcements` response. `announcement` is `null` when
 * there is no active, non-dismissed broadcast for the caller — the client
 * collapses the banner slot in that case.
 */
export const MeAnnouncementResponse = z.object({
  announcement: AnnouncementForUser.nullable(),
});
export type MeAnnouncementResponse = z.infer<typeof MeAnnouncementResponse>;

/**
 * Admin-facing shape returned by `POST /api/v1/admin/announcements`. Keeps
 * the full multi-locale trio + window + audience so the admin UI can echo
 * back exactly what was stored. `created_by_user_id` is denormalized for
 * audit; the admin client may render it as "created by …".
 */
export const Announcement = z.object({
  id: z.string().uuid(),
  title_az: z.string(),
  title_en: z.string(),
  title_ru: z.string(),
  body_az: z.string().nullable(),
  body_en: z.string().nullable(),
  body_ru: z.string().nullable(),
  cta_label_az: z.string().nullable(),
  cta_label_en: z.string().nullable(),
  cta_label_ru: z.string().nullable(),
  cta_url: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  audience: AnnouncementAudience,
  priority: z.number().int(),
  created_at: z.string(),
  created_by_user_id: z.string().uuid().nullable(),
});
export type Announcement = z.infer<typeof Announcement>;

/**
 * `POST /api/v1/admin/announcements` request body. Title is required in all
 * three locales (we never want a missing-fallback experience on the
 * banner). Body + CTA label are optional per locale. `cta_url` may be a
 * `linkfit://` custom scheme URL or any `https?://` URL.
 *
 * Note: we accept any non-empty string for `cta_url` so admins can stage
 * `linkfit://games`, `linkfit://r/CODE`, or external links without us
 * pinning to `z.string().url()` (which rejects custom schemes).
 */
export const CreateAnnouncementRequest = z.object({
  title_az: z.string().trim().min(1).max(160),
  title_en: z.string().trim().min(1).max(160),
  title_ru: z.string().trim().min(1).max(160),
  body_az: z.string().trim().max(1000).nullable().optional(),
  body_en: z.string().trim().max(1000).nullable().optional(),
  body_ru: z.string().trim().max(1000).nullable().optional(),
  cta_label_az: z.string().trim().max(60).nullable().optional(),
  cta_label_en: z.string().trim().max(60).nullable().optional(),
  cta_label_ru: z.string().trim().max(60).nullable().optional(),
  cta_url: z.string().trim().min(1).max(2048).nullable().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  audience: AnnouncementAudience.optional(),
  priority: z.number().int().optional(),
});
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementRequest>;
