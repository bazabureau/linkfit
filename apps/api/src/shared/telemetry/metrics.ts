import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export interface TelemetryHandle {
  readonly registry: Registry;
  readonly http: {
    readonly requestsTotal: Counter<"method" | "route" | "status_code">;
    readonly requestDurationSeconds: Histogram<"method" | "route">;
    readonly requestsInFlight: Gauge;
  };
  readonly business: {
    readonly authAttempts: Counter<"method" | "result">;
    readonly gamesCreated: Counter<"sport">;
    readonly gamesCompleted: Counter<"sport">;
    readonly paymentIntents: Counter<"kind" | "result">;
  };
  readonly db: {
    readonly poolSize: Gauge<"state">;
  };
}

export function createTelemetry(): TelemetryHandle {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "linkfit-api" });

  collectDefaultMetrics({ register: registry, prefix: "nodejs_" });

  const requestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests handled, partitioned by route and status code",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [registry],
  });

  const requestDurationSeconds = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const requestsInFlight = new Gauge({
    name: "http_requests_in_flight",
    help: "Number of HTTP requests currently being processed",
    registers: [registry],
  });

  const authAttempts = new Counter({
    name: "linkfit_auth_attempts_total",
    help: "Authentication attempts, partitioned by method and result",
    labelNames: ["method", "result"] as const,
    registers: [registry],
  });

  const gamesCreated = new Counter({
    name: "linkfit_games_created_total",
    help: "Games created, partitioned by sport",
    labelNames: ["sport"] as const,
    registers: [registry],
  });

  const gamesCompleted = new Counter({
    name: "linkfit_games_completed_total",
    help: "Games marked completed, partitioned by sport",
    labelNames: ["sport"] as const,
    registers: [registry],
  });

  const paymentIntents = new Counter({
    name: "linkfit_payment_intents_total",
    help: "Stripe payment intent attempts, partitioned by kind and result",
    labelNames: ["kind", "result"] as const,
    registers: [registry],
  });

  const poolSize = new Gauge({
    name: "linkfit_db_pool_size",
    help: "PostgreSQL connection pool size, partitioned by state",
    labelNames: ["state"] as const,
    registers: [registry],
  });

  return {
    registry,
    http: { requestsTotal, requestDurationSeconds, requestsInFlight },
    business: { authAttempts, gamesCreated, gamesCompleted, paymentIntents },
    db: { poolSize },
  };
}
