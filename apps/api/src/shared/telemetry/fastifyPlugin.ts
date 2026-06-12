import { type FastifyRequest } from "fastify";
import { type LinkfitServer } from "../http/server.js";
import { type TelemetryHandle } from "./metrics.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the telemetry plugin's onRequest hook so onResponse can
     *  compute the elapsed duration without consulting the system clock
     *  twice. Hooks are guaranteed to fire in registration order, so
     *  onResponse always sees the value set here. */
    telemetryStartHrTime?: bigint;
  }
}

/**
 * Pull the registered route pattern (e.g. "/api/v1/games/:id") instead of
 * the raw URL ("/api/v1/games/abc-123-..."). Prometheus label cardinality
 * explodes if we use raw URLs because every UUID becomes a unique series.
 *
 * Fastify exposes the matched pattern on `request.routeOptions.url` (v5+).
 * Falls back to "unknown" for the rare case where no route matched
 * (404s before the matcher resolved), capped to avoid runaway cardinality
 * from 404 floods.
 */
function routeLabel(req: FastifyRequest): string {
  const url = req.routeOptions.url;
  if (url === undefined || url.length === 0) {
    return "unknown";
  }
  return url;
}

export function registerTelemetryPlugin(
  app: LinkfitServer,
  telemetry: TelemetryHandle,
): void {
  app.addHook("onRequest", (req, _reply, done) => {
    req.telemetryStartHrTime = process.hrtime.bigint();
    telemetry.http.requestsInFlight.inc();
    done();
  });

  app.addHook("onResponse", (req, reply, done) => {
    const start = req.telemetryStartHrTime;
    const route = routeLabel(req);
    const method = req.method;
    const statusCode = String(reply.statusCode);

    telemetry.http.requestsInFlight.dec();
    telemetry.http.requestsTotal.inc({ method, route, status_code: statusCode });

    if (start !== undefined) {
      const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      telemetry.http.requestDurationSeconds.observe({ method, route }, elapsedSeconds);
    }
    done();
  });
}
