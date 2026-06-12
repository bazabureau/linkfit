import { timingSafeEqual } from "node:crypto";
import { type LinkfitServer } from "../http/server.js";
import { type TelemetryHandle } from "./metrics.js";

export interface MetricsRouteDeps {
  readonly telemetry: TelemetryHandle;
  readonly username: string;
  readonly password: string;
}

/**
 * Constant-time string comparison. `timingSafeEqual` requires equal-length
 * buffers — we pad both sides to the max length so an attacker can't learn
 * the secret length from response timing.
 */
function safeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  const ab = Buffer.alloc(max);
  const bb = Buffer.alloc(max);
  ab.write(a);
  bb.write(b);
  return timingSafeEqual(ab, bb) && a.length === b.length;
}

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep === -1) {
    return null;
  }
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

export function registerMetricsRoute(
  app: LinkfitServer,
  deps: MetricsRouteDeps,
): void {
  app.get(
    "/metrics",
    {
      config: {
        rateLimit: false, // Prometheus scrapes every 15s — never throttle.
      },
      schema: {
        hide: true, // Keep Swagger docs free of operator-only endpoints.
      },
    },
    async (req, reply) => {
      const creds = parseBasicAuth(req.headers.authorization);
      if (
        creds === null ||
        !safeEqual(creds.user, deps.username) ||
        !safeEqual(creds.pass, deps.password)
      ) {
        return reply
          .status(401)
          .header("WWW-Authenticate", 'Basic realm="metrics"')
          .send("unauthorized");
      }
      const body = await deps.telemetry.registry.metrics();
      return reply
        .header("Content-Type", deps.telemetry.registry.contentType)
        .status(200)
        .send(body);
    },
  );
}
