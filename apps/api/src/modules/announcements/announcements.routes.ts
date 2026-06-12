import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import {
  Announcement,
  CreateAnnouncementRequest,
  Empty,
  ErrorEnvelope,
  MeAnnouncementResponse,
} from "./announcements.schema.js";
import { type AnnouncementsService } from "./announcements.service.js";

export interface AnnouncementsRouteDeps {
  service: AnnouncementsService;
  jwtAccessSecret: string;
}

/**
 * Mounts the `/api/v1/me/announcements*` and `/api/v1/admin/announcements`
 * surfaces. The user-facing GET is auth-gated (announcements are scoped
 * to authenticated users so we can per-user dismiss); the admin POST goes
 * through `adminGuard` which also enforces a fresh role check on every
 * request.
 *
 * Endpoints:
 *   GET    /api/v1/me/announcements              — current banner for caller
 *   POST   /api/v1/me/announcements/:id/dismiss  — record dismissal (204)
 *   POST   /api/v1/admin/announcements           — create a new broadcast
 */
export function registerAnnouncementsRoutes(
  app: LinkfitServer,
  deps: AnnouncementsRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });
  const adminGuard = buildAdminGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db: deps.service.db,
  });

  // ─── User-facing GET ─────────────────────────────────────────────────
  // Returns the highest-priority active announcement the caller has not
  // dismissed, in the caller's locale. The locale comes from the standard
  // `Accept-Language` header — we don't store per-user locale on `users`
  // yet, and the iOS client always sends a header that mirrors its
  // current language selection (see `LocaleManager`).
  app.get(
    "/api/v1/me/announcements",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: MeAnnouncementResponse,
          401: ErrorEnvelope,
        },
        tags: ["announcements"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const acceptLanguage = req.headers["accept-language"];
      const localeHint = typeof acceptLanguage === "string" ? acceptLanguage : null;
      const announcement = await deps.service.fetchForUser(userId, localeHint);
      return reply.status(200).send({ announcement });
    },
  );

  // ─── User-facing dismiss POST ───────────────────────────────────────
  // 204 always — the dismissal is idempotent (the service uses ON CONFLICT
  // DO NOTHING) and tolerant of unknown ids (a stale client should never
  // surface this as an error to the user).
  app.post(
    "/api/v1/me/announcements/:id/dismiss",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
        },
        tags: ["announcements"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.dismiss(userId, req.params.id);
      return reply.status(204).send({});
    },
  );

  // ─── Admin create ────────────────────────────────────────────────────
  // Mints a new broadcast. `audience`/`priority`/`starts_at` default
  // server-side when omitted so the admin form can submit a minimal
  // payload (title + body in three locales + optional CTA).
  app.post(
    "/api/v1/admin/announcements",
    {
      preHandler: adminGuard,
      schema: {
        body: CreateAnnouncementRequest,
        response: {
          201: Announcement,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "announcements"],
      },
    },
    async (req, reply) => {
      const adminId = requireUserId(req);
      const created = await deps.service.create(adminId, req.body);
      return reply.status(201).send(created);
    },
  );
}
