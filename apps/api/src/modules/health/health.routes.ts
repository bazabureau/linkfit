import { z } from "zod";
import { type LinkfitServer } from "../../shared/http/server.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { HealthService } from "./health.service.js";
import { DeepHealthService, type Probe } from "./health-deep.service.js";

const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  uptime_seconds: z.number().int().nonnegative(),
  version: z.string(),
  db: z.enum(["ok", "down"]),
});

const CheckResultSchema = z.object({
  status: z.enum(["ok", "fail", "skipped"]),
  latency_ms: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});

const ReadyResponse = z.object({
  status: z.enum(["ok", "degraded", "fail"]),
  version: z.string(),
  checks: z.record(z.string(), CheckResultSchema),
});

export interface HealthRouteDeps {
  db: DbHandle;
  version?: string;
  /** Optional non-critical readiness probes (Stripe, SMTP, APNs).
   *  When omitted, /health/ready only checks the database. */
  readinessProbes?: Record<string, Probe>;
}

export function registerHealthRoutes(
  app: LinkfitServer,
  deps: HealthRouteDeps,
): void {
  const version = deps.version ?? "0.1.0";
  const service = new HealthService(deps.db, version);
  const deep = new DeepHealthService({
    db: deps.db,
    version,
    ...(deps.readinessProbes !== undefined ? { probes: deps.readinessProbes } : {}),
  });

  app.get(
    "/health",
    {
      config: {
        rateLimit: false, // observability endpoint — never throttled
      },
      schema: {
        response: {
          200: HealthResponse,
          503: HealthResponse,
        },
        tags: ["health"],
      },
    },
    async (_req, reply) => {
      const report = await service.report();
      const statusCode = report.db === "ok" ? 200 : 503;
      return reply.status(statusCode).send(report);
    },
  );

  app.get(
    "/health/ready",
    {
      config: { rateLimit: false },
      schema: {
        response: {
          200: ReadyResponse,
          503: ReadyResponse,
        },
        tags: ["health"],
      },
    },
    async (_req, reply) => {
      const report = await deep.check();
      // DB failure → 503 (orchestrator should drain). Degraded (non-critical
      // dependency down) → still 200 (third-party outage shouldn't take us
      // out of rotation; we degrade gracefully).
      const statusCode = report.status === "fail" ? 503 : 200;
      return reply.status(statusCode).send(report);
    },
  );
}
