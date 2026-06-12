import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type PushService } from "./push.service.js";

export interface PushRouteDeps {
  service: PushService;
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

const RegisterDeviceRequest = z.object({
  /** APNs hex token (or FCM token). 8..512 chars; trimming happens server-side. */
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android"]),
});

const DeviceTokenSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  platform: z.enum(["ios", "android"]),
  last_seen: z.string(),
  created_at: z.string(),
});

export function registerPushRoutes(app: LinkfitServer, deps: PushRouteDeps): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.post(
    "/api/v1/me/devices",
    {
      preHandler: authenticate,
      schema: {
        body: RegisterDeviceRequest,
        response: {
          201: DeviceTokenSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
        },
        tags: ["push"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const out = await deps.service.register(userId, req.body);
      return reply.status(201).send(out);
    },
  );

  app.delete(
    "/api/v1/me/devices/:token",
    {
      preHandler: authenticate,
      schema: {
        params: z.object({ token: z.string().min(8).max(512) }),
        response: { 204: Empty, 401: ErrorEnvelope },
        tags: ["push"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      await deps.service.revoke(userId, req.params.token);
      return reply.status(204).send({});
    },
  );
}
