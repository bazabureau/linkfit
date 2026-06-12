# Production-Readiness Design — FAZA 1

**Date**: 2026-05-20
**Scope**: `apps/api` (Linkfit backend)
**Status**: Approved, in implementation

## Background

The Linkfit backend (`apps/api`) is feature-complete: 29 modules, 105 endpoints, 35 migrations, 42 tests. iOS, admin, and web clients are aligned with backend routes. However, several production-readiness gaps remain:

- `src/shared/telemetry/` directory is empty — no metrics, no tracing.
- `/health` returns a basic OK; no readiness probe distinguishes liveness from "ready to accept traffic".
- No `Dockerfile` or production deployment artifacts.
- `.env` placeholders (`sk_test_dummy`, `whsec_test_dummy`, `dev-*-secret-*`) are accepted in production by the loader.
- Logger context lacks `version` field for log correlation across deployments.

This spec covers FAZA 1 of a 4-phase plan:
1. **FAZA 1** (this spec): Production-readiness — telemetry, deep health, Docker, env strictness.
2. FAZA 2: Feature gaps — DELETE /api/v1/me, DELETE /api/v1/games/:id, feed reactions.
3. FAZA 3: Test coverage expansion.
4. FAZA 4: WebSocket / real-time.

## Goals

- Operators can scrape Prometheus metrics from the running API.
- Kubernetes / orchestrator can distinguish liveness from readiness.
- The API runs as a non-root container with a healthcheck.
- A `NODE_ENV=production` boot with placeholder secrets refuses to start.
- Every log line carries `service`, `env`, `version`, `request_id`, and (when authenticated) `user_id`.

## Non-Goals

- Distributed tracing (OpenTelemetry) — deferred.
- Log aggregation / shipping setup (operator concern).
- Multi-region deployment topology.
- Migrating off Pino / changing log format.

## Architecture

### Module layout

```
apps/api/src/shared/telemetry/
├── metrics.ts            # Registry + all metric definitions
├── fastifyPlugin.ts      # Fastify plugin: onRequest/onResponse hooks
├── metricsRoute.ts       # GET /metrics (basic auth, text/plain)
└── metrics.test.ts       # Unit tests
```

```
apps/api/
├── Dockerfile
├── .dockerignore
└── (existing files)
```

```
linkfit/ (repo root)
└── docker-compose.prod.yml
```

### Data flow

```
HTTP Request
   ↓
[Fastify onRequest hook]  → start timer, increment in-flight gauge
   ↓
[Route handler]
   ↓
[Service layer]           → may emit business metrics (auth attempt, game created)
   ↓
[Fastify onResponse hook] → observe duration histogram, increment requests_total
   ↓
HTTP Response
```

`/metrics` endpoint serializes the shared `Registry` to Prometheus text format. Scrapes do **not** count toward `http_requests_total` (excluded by route prefix).

### Metric catalog

| Name | Type | Labels | Source |
|------|------|--------|--------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | fastifyPlugin |
| `http_request_duration_seconds` | Histogram | `method`, `route` | fastifyPlugin |
| `http_requests_in_flight` | Gauge | — | fastifyPlugin |
| `linkfit_auth_attempts_total` | Counter | `method`, `result` | users.service / oauth.service |
| `linkfit_games_created_total` | Counter | `sport` | games.service |
| `linkfit_games_completed_total` | Counter | `sport` | scoring.service |
| `linkfit_payment_intents_total` | Counter | `kind`, `result` | payments.service |
| `linkfit_db_pool_size` | Gauge | `state` (`idle` / `total`) | pg pool snapshot |

Labels are bounded (route is the registered Fastify pattern, not raw URL — prevents cardinality explosion from `/games/<uuid>`).

### Deep health-check shape

`GET /health` (unchanged):
```json
{ "status": "ok", "uptime_seconds": 42, "version": "0.1.0", "db": "ok" }
```

`GET /health/ready` (new):
```json
{
  "status": "ok",
  "version": "0.1.0",
  "checks": {
    "db":     { "status": "ok",      "latency_ms": 3 },
    "stripe": { "status": "skipped", "reason": "dummy_key" },
    "smtp":   { "status": "skipped", "reason": "not_configured" },
    "apns":   { "status": "ok",      "latency_ms": 12 }
  }
}
```

- DB check: `SELECT 1` with 1s timeout. **Critical** — failure returns 503.
- Stripe: skipped when key is `sk_test_dummy`; otherwise a 1s `account.retrieve()` GET.
- SMTP: skipped when no `SMTP_*` env; otherwise `transporter.verify()`.
- APNs: skipped when no `APNS_*` env; otherwise read APNs provider state (no real push sent).

Non-critical check failures yield `status: "degraded"` but still 200. Only DB failure → 503.

### Env strictness rules

In `env.ts`, after Zod parse, when `NODE_ENV === "production"`:

```typescript
const productionGuards: Array<[keyof Env, (v: string) => boolean, string]> = [
  ["STRIPE_SECRET_KEY",    v => v === "sk_test_dummy",       "placeholder Stripe key"],
  ["STRIPE_WEBHOOK_SECRET", v => v === "whsec_test_dummy",    "placeholder Stripe webhook secret"],
  ["JWT_ACCESS_SECRET",    v => v.startsWith("dev-"),        "dev-prefixed JWT access secret"],
  ["JWT_REFRESH_SECRET",   v => v.startsWith("dev-"),        "dev-prefixed JWT refresh secret"],
];

for (const [key, isPlaceholder, reason] of productionGuards) {
  if (isPlaceholder(parsed.data[key] as string)) {
    throw new EnvValidationError([{
      path: [key],
      message: `production env contains ${reason}`,
      code: "custom",
    }]);
  }
}
```

This runs alongside Zod — Zod ensures structural correctness, this enforces production sanity. Both throw `EnvValidationError` so boot fails fast.

### Logger context expansion

`createLogger` already sets `service: "linkfit-api"` and `env: NODE_ENV` on the base context. Add:
- `version`: read from `apps/api/package.json` `version` field at module load (using `node:fs/readFileSync` against a path resolved via `import.meta.url`).

Request-scoped fields (`request_id`, `user_id`) are populated by Fastify and the auth middleware respectively — already working. No change needed there.

### Dockerfile design

Multi-stage:
- **Stage 1 (`builder`)**: `node:22-alpine`. Install all deps (`npm ci`), run `npm run build` to produce `dist/`. Discarded after stage 2.
- **Stage 2 (final)**: `node:22-alpine`. Install only production deps (`npm ci --omit=dev`). Copy `dist/` and `migrations/` from builder. Run as `node` (built-in non-root user). `EXPOSE 3000`. `HEALTHCHECK` via wget against `/health` (alpine includes wget by default in `node:22-alpine`; if not, add `apk add --no-cache wget`).

`.dockerignore` excludes: `node_modules/`, `dist/`, `build/`, `*.log`, `.env*`, `.git/`, `tests/`, `*.test.ts`, `.DS_Store`.

### docker-compose.prod.yml shape

Three services:
1. `postgres`: `postgres:17-alpine`, persistent volume `pg_data`, env from `.env.production`.
2. `api`: built from `apps/api/Dockerfile`, env from `.env.production`, `depends_on: postgres (condition: service_healthy)`.
3. `nginx`: `nginx:alpine` with `nginx.conf` mounted as volume; terminates TLS via Let's Encrypt certs mounted from host; proxies `/` → `api:3000`; sets rate limit at edge (per-IP burst); blocks `/metrics` from public (only allow Prometheus scraper IP).

For phase 1, we ship only the `Dockerfile` + `.dockerignore` + a documented `docker-compose.prod.yml` skeleton; operator configures TLS / DNS.

## File-by-file changes

### New files

| File | Lines (approx) | Purpose |
|------|---------------|---------|
| `apps/api/src/shared/telemetry/metrics.ts` | ~60 | Registry + metric definitions |
| `apps/api/src/shared/telemetry/fastifyPlugin.ts` | ~50 | Hook-based HTTP instrumentation |
| `apps/api/src/shared/telemetry/metricsRoute.ts` | ~40 | GET /metrics with basic auth |
| `apps/api/src/shared/telemetry/metrics.test.ts` | ~80 | Unit tests |
| `apps/api/src/modules/health/health-deep.service.ts` | ~120 | Multi-dependency probe |
| `apps/api/src/modules/health/health-deep.test.ts` | ~80 | Unit tests |
| `apps/api/Dockerfile` | ~25 | Multi-stage container |
| `apps/api/.dockerignore` | ~10 | Build context exclusions |
| `docker-compose.prod.yml` | ~60 | Production compose skeleton |

### Modified files

| File | Change |
|------|--------|
| `apps/api/package.json` | Add `prom-client` dep |
| `apps/api/.env.example` | Add `METRICS_USER`, `METRICS_PASSWORD` |
| `apps/api/src/shared/config/env.ts` | Add `METRICS_USER`, `METRICS_PASSWORD` schema fields + production guards |
| `apps/api/src/shared/logging/logger.ts` | Include `version` in base context |
| `apps/api/src/shared/http/server.ts` | Register telemetry plugin + /metrics route + /health/ready route |
| `apps/api/src/modules/health/health.routes.ts` | Add /health/ready route delegating to deep service |

## Error handling

- `/metrics` returns 401 on missing/wrong basic auth (no rate limit applied — Prometheus retries quickly).
- `/health/ready` returns 503 when DB ping fails; 200 otherwise (degraded status still 200, since the orchestrator should only drain on hard fail).
- Telemetry plugin failures (e.g., metric registration errors during boot) bubble up and crash boot — this is intentional, metrics misconfiguration shouldn't run silently in production.

## Testing strategy

- `metrics.test.ts`: assert counters increment, histogram observes, labels bounded.
- `health-deep.test.ts`: stub each dependency, verify status aggregation and HTTP code mapping.
- Existing tests should pass unchanged (telemetry plugin is additive).
- Manual smoke: `curl -u metrics:pass http://localhost:3000/metrics | grep linkfit_` after one auth and game creation.

## Open questions for implementation

None — all decisions made during brainstorming.
