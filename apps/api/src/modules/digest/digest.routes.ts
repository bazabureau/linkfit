import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAdminGuard } from "../../shared/auth/adminGuard.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { type DigestService } from "./digest.service.js";

export interface DigestRouteDeps {
  service: DigestService;
  jwtAccessSecret: string;
  db: DbHandle;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

const RunWeeklyResponse = z.object({
  attempted: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  skipped_empty: z.number().int().nonnegative(),
  skipped_already_sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export function registerDigestRoutes(
  app: LinkfitServer,
  deps: DigestRouteDeps,
): void {
  const adminGuard = buildAdminGuard({
    jwtAccessSecret: deps.jwtAccessSecret,
    db: deps.db,
  });

  /**
   * Manually trigger the weekly digest run. Admin-only — exposed so ops can
   * verify wiring end-to-end without waiting for the Monday 09:00 UTC tick.
   * Idempotent: a re-run within the same UTC day will only re-send to users
   * who weren't covered by the prior run (the `email_digest_log` composite
   * PK does the dedupe at the DB layer).
   */
  app.post(
    "/api/v1/admin/digest/run-weekly",
    {
      preHandler: adminGuard,
      schema: {
        response: {
          200: RunWeeklyResponse,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
        },
        tags: ["admin", "digest"],
      },
    },
    async (_req, reply) => {
      const result = await deps.service.runWeeklyDigest();
      return reply.status(200).send(result);
    },
  );
}
