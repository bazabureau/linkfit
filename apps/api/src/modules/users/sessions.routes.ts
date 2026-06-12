/**
 * /api/v1/me/sessions — "Logged-in devices" surface.
 *
 *   GET    /api/v1/me/sessions       — list active sessions
 *   DELETE /api/v1/me/sessions/:id   — revoke one (not the current one)
 *   DELETE /api/v1/me/sessions       — revoke every session except current
 *
 * `is_current` is derived from the access token's `sid` claim (the refresh-
 * token family id), surfaced on the request as `req.authSessionId` by the
 * shared auth guard. Tokens minted before the sessions-metadata migration
 * carry no claim — endpoints still work, but `is_current` is always false.
 */
import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type SessionsService } from "./sessions.service.js";

export interface SessionsRouteDeps {
  service: SessionsService;
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

const SessionItemSchema = z.object({
  id: z.string().uuid(),
  user_agent: z.string().nullable(),
  // We accept any non-empty string here rather than `datetime()` so the
  // schema is robust against Postgres' microsecond precision on `created_at`.
  // The service always produces ISO 8601 via `toISOString()`.
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  is_current: z.boolean(),
});

const SessionListSchema = z.object({
  items: z.array(SessionItemSchema),
});

export function registerSessionsRoutes(app: LinkfitServer, deps: SessionsRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get(
    "/api/v1/me/sessions",
    {
      preHandler: authenticate,
      schema: {
        response: { 200: SessionListSchema, 401: ErrorEnvelope },
        tags: ["users"],
        summary: "List the caller's active refresh-token sessions",
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.listForUser(userId, req.authSessionId);
      return reply.status(200).send(out);
    },
  );

  app.delete(
    "/api/v1/me/sessions/:id",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: Empty,
          401: ErrorEnvelope,
          403: ErrorEnvelope,
          404: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["users"],
        summary: "Revoke a single non-current session",
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.revokeById(userId, req.authSessionId, req.params.id);
      return reply.status(204).send({});
    },
  );

  app.delete(
    "/api/v1/me/sessions",
    {
      preHandler: authenticate,
      schema: {
        response: {
          204: Empty,
          401: ErrorEnvelope,
          422: ErrorEnvelope,
        },
        tags: ["users"],
        summary: "Sign out of every session except the current one",
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.revokeAllExceptCurrent(userId, req.authSessionId);
      return reply.status(204).send({});
    },
  );
}
