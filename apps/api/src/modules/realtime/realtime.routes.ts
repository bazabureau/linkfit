import { z } from "zod";
import jwt from "jsonwebtoken";
import { type LinkfitServer } from "../../shared/http/server.js";
import { buildAuthGuard, requireUserId } from "../../shared/auth/guard.js";
import { type RealtimeBus, type RealtimeEvent } from "./realtime.bus.js";

export interface RealtimeRouteDeps {
  bus: RealtimeBus;
  jwtAccessSecret: string;
}

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
  }),
});

/**
 * Heartbeat interval — sent as an SSE comment line (`:keepalive`). 25s is
 * inside the typical 30s idle timeout for both nginx and AWS ALB, so the
 * connection stays warm without producing noticeable traffic.
 */
const HEARTBEAT_MS = 25_000;

function formatEvent(event: RealtimeEvent): string {
  // SSE wire format: `event: <kind>\ndata: <json>\n\n`. The `event:` line
  // is technically optional but lets the iOS client filter without parsing
  // each payload. Newlines inside `data` must be escaped per the spec —
  // JSON.stringify already does that.
  return `event: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

interface SseAuthQuery {
  /** Fallback when iOS EventSource can't set an Authorization header.
   *  The query token is still validated against `jwtAccessSecret`, so
   *  passing it in the URL doesn't change the trust boundary — just
   *  watch your access logs. */
  token?: string;
}

export function registerRealtimeRoutes(
  app: LinkfitServer,
  deps: RealtimeRouteDeps,
): void {
  const authenticate = buildAuthGuard({ jwtAccessSecret: deps.jwtAccessSecret });

  app.get<{ Querystring: SseAuthQuery }>(
    "/api/v1/realtime/sse",
    {
      config: {
        // SSE connections are long-lived — never rate-limit them and never
        // 30s-timeout the response. Fastify's default 5min timeout would
        // disconnect every quarter hour without this.
        rateLimit: false,
      },
      schema: {
        // Hide from generated docs — the endpoint is operational and the
        // iOS client doesn't need a generated TypeScript binding for it.
        hide: true,
      },
      preHandler: async (req, reply) => {
        // EventSource (browser + iOS URLSession) doesn't let callers set
        // arbitrary headers, so we accept the JWT in `?token=…` as a
        // fallback. When both are provided, the header wins; when only
        // the query is set, we hydrate the auth context manually.
        if (req.headers.authorization !== undefined) {
          return authenticate(req, reply);
        }
        const q = req.query;
        if (q.token === undefined || q.token.length === 0) {
          return reply.status(401).send({
            error: { code: "UNAUTHORIZED", message: "Missing token" },
          });
        }
        try {
          const claims = jwt.verify(q.token, deps.jwtAccessSecret) as { sub: string };
          (req as unknown as { user_id: string }).user_id = claims.sub;
          return;
        } catch {
          return reply.status(401).send({
            error: { code: "UNAUTHORIZED", message: "Invalid token" },
          });
        }
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);

      // Hijack the raw socket so we can write SSE frames directly. Fastify's
      // reply.raw is the underlying ServerResponse; once we set headers and
      // write the preamble, the framework no longer manages this response.
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // nginx: disable response buffering.
      });
      // Opening comment line — nudges some proxies to flush the headers.
      reply.raw.write(":connected\n\n");

      const unsubscribe = deps.bus.subscribe(userId, (event) => {
        reply.raw.write(formatEvent(event));
      });

      const heartbeat = setInterval(() => {
        reply.raw.write(":keepalive\n\n");
      }, HEARTBEAT_MS);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      // Client disconnect / network drop — both surface as 'close'.
      reply.raw.on("close", cleanup);
      reply.raw.on("error", cleanup);

      // Suppress Fastify's "did you forget to send a response?" warning —
      // we manage the response stream ourselves now.
      return reply.hijack();
    },
  );

  // Lightweight introspection — useful for ops to verify a user has an
  // active SSE connection. Returns 200 with a count; never 4xx.
  app.get(
    "/api/v1/realtime/health",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: z.object({
            user_id: z.string().uuid(),
            subscribers: z.number().int().nonnegative(),
            total: z.number().int().nonnegative(),
          }),
          401: ErrorEnvelope,
        },
        tags: ["realtime"],
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      return reply.status(200).send({
        user_id: userId,
        subscribers: deps.bus.subscriberCount(userId),
        total: deps.bus.totalSubscriberCount(),
      });
    },
  );
}
