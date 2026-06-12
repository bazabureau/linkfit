import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type NotificationPreferencesService } from "./notification-preferences.service.js";

export interface NotificationPreferencesRouteDeps {
  service: NotificationPreferencesService;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
  }),
});

const NotificationTypeSchema = z.enum([
  "game_joined",
  "game_cancelled",
  "game_reminder",
  "no_show_marked",
  "rating_received",
  "tournament_invite",
  "message_received",
  "system",
]);

const PreferenceViewSchema = z.object({
  type: NotificationTypeSchema,
  push_enabled: z.boolean(),
  email_enabled: z.boolean(),
  in_app_enabled: z.boolean(),
});

const PreferencesResponseSchema = z.object({
  preferences: z.array(PreferenceViewSchema),
  quiet_hours_start: z.number().int().min(0).max(23).nullable(),
  quiet_hours_end: z.number().int().min(0).max(23).nullable(),
  // Wave-10: opt-out toggle + IANA time zone for the daily-digest sweeper.
  // Surfaced alongside quiet hours because both gate the same out-of-band
  // push fan-out and iOS renders them under the same settings section.
  daily_digest_enabled: z.boolean(),
  time_zone: z.string(),
});

const UpdatePreferenceRequest = z.object({
  type: NotificationTypeSchema,
  push_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
});

const UpdateQuietHoursRequest = z.object({
  quiet_hours_start: z.number().int().min(0).max(23).nullable(),
  quiet_hours_end: z.number().int().min(0).max(23).nullable(),
});

// Wave-10: daily-digest opt-out + IANA tz. Both fields optional so iOS
// can flip the toggle without resubmitting a redundant `time_zone`. The
// service rejects unknown tz strings (RangeError → 400) so we don't need
// a static allow-list on the wire.
const UpdateDailyDigestRequest = z.object({
  daily_digest_enabled: z.boolean().optional(),
  time_zone: z.string().min(1).max(64).optional(),
});

export function registerNotificationPreferencesRoutes(
  app: LinkfitServer,
  deps: NotificationPreferencesRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/notification-preferences",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: PreferencesResponseSchema,
          401: ErrorEnvelope,
        },
        tags: ["notification-preferences"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const result = await deps.service.getPreferences(userId);
      return reply.status(200).send(result);
    },
  );

  app.patch(
    "/api/v1/me/notification-preferences",
    {
      preHandler: authenticate,
      schema: {
        body: UpdatePreferenceRequest,
        response: {
          204: z.null(),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["notification-preferences"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.updatePreference(userId, req.body);
      return reply.status(204).send(null);
    },
  );

  app.put(
    "/api/v1/me/notification-preferences/quiet-hours",
    {
      preHandler: authenticate,
      schema: {
        body: UpdateQuietHoursRequest,
        response: {
          204: z.null(),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["notification-preferences"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.updateQuietHours(userId, req.body);
      return reply.status(204).send(null);
    },
  );

  // Wave-10: daily-digest opt-out + time-zone patch. PUT semantics: an
  // empty body is a no-op; passing one field leaves the other untouched.
  app.put(
    "/api/v1/me/notification-preferences/daily-digest",
    {
      preHandler: authenticate,
      schema: {
        body: UpdateDailyDigestRequest,
        response: {
          204: z.null(),
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["notification-preferences"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.updateDailyDigest(userId, req.body);
      return reply.status(204).send(null);
    },
  );
}
