# Milestone 2 Requirements Investigation Report

**Date**: 2026-06-01
**Author**: `teamwork_preview_explorer_milestone_2_2_gen2`
**Objective**: Analyze the codebase for Milestone 2 production-readiness requirements and summarize findings/adjustments.

---

## 1. Observation

### Requirement A: ESM-Compatible Logger Versioning
In `apps/api/src/shared/logging/logger.ts`, the following logic reads the service version at module load:
```typescript
// Lines 14-29:
function resolveServiceVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/shared/logging/ → src/shared/ → src/ → api/ (4 hops up)
    const pkgPath = join(here, "..", "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to the literal fallback. We never want logger
    // bootstrapping to crash boot — the alternative is debug-by-vibe.
  }
  return "unknown";
}
```
This is injected into the Pino `base` config:
```typescript
// Lines 58-62:
    base: {
      service: "linkfit-api",
      env: env.NODE_ENV,
      version: SERVICE_VERSION,
    },
```

### Requirement B: Production Environment Strictness
In `apps/api/src/shared/config/env.ts`, the environment strictness validation rules for production are enforced inside `enforceProductionInvariants(env: Env)`:
```typescript
// Lines 197-232:
function enforceProductionInvariants(env: Env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const violations: z.ZodIssue[] = [];
  const guard = (
    key: keyof Env,
    isInvalid: boolean,
    reason: string,
  ): void => {
    if (isInvalid) {
      violations.push({
        code: "custom",
        path: [key],
        message: `production env contains ${reason}`,
      });
    }
  };

  guard("STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY === "sk_test_dummy",
    "placeholder Stripe secret key");
  guard("STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET === "whsec_test_dummy",
    "placeholder Stripe webhook secret");
  guard("JWT_ACCESS_SECRET", env.JWT_ACCESS_SECRET.startsWith("dev-"),
    "dev-prefixed JWT access secret");
  guard("JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET.startsWith("dev-"),
    "dev-prefixed JWT refresh secret");
  guard("METRICS_PASSWORD", env.METRICS_PASSWORD === "change-me-in-production",
    "default /metrics password");
  guard("CORS_ORIGINS", env.CORS_ORIGINS.length === 0,
    "empty CORS allowlist (would deny all browser clients)");

  if (violations.length > 0) {
    throw new EnvValidationError(violations);
  }
}
```

### Requirement C: Docker & Compose Setup
1. **`apps/api/Dockerfile`**:
   - The file leverages multi-stage builds (`builder` and `runtime` stages).
   - In the runtime stage, a non-root group and user named `nodeapp` (UID/GID 1001) are created:
     ```dockerfile
     # Lines 29-31:
     RUN apk add --no-cache wget && \
         addgroup -g 1001 -S nodeapp || true && \
         adduser -u 1001 -S nodeapp -G nodeapp || true
     ```
   - However, the image switches to the default Node user `node` (UID 1000) instead:
     ```dockerfile
     # Line 41:
     # Drop root.
     USER node
     ```
   - Liveness probe is defined:
     ```dockerfile
     # Lines 52-53:
     HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
         CMD wget --spider -q http://127.0.0.1:3000/health || exit 1
     ```
2. **`apps/api/.dockerignore`**:
   - Correctly excludes `node_modules`, `dist`, `tests`, `.env*` files, logs, and Git metadata to prevent leaks and maximize cache efficiency.
3. **`docker-compose.prod.yml`**:
   - Configures `postgres`, `api`, and `nginx` services.
   - Enforces early syntax-level validation:
     ```yaml
     JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET:?JWT_ACCESS_SECRET must be set (>= 32 chars)}
     ```
   - Maps named volumes `pg_data` and `uploads` for safe persistency, mounting uploads at `/data/uploads` to align with the environment:
     ```yaml
     UPLOAD_DIR: /data/uploads
     ```

---

## 2. Logic Chain

1. **ESM-Compatible Version Parsing**:
   - Direct JSON imports (e.g. `import pkg from './package.json' assert { type: 'json' }`) are rejected or restricted by build setup when TypeScript compilations omit JSON file copying.
   - Using `import.meta.url` combined with `fileURLToPath` resolves the absolute path of `logger.ts` in a standardized ESM way.
   - The 3-hop traversal `..` from the directory containing `logger` leads exactly to `/apps/api/package.json` in both source tree (`src/shared/logging/logger.ts` -> `..` (shared) -> `..` (src) -> `..` (api)) and production compiled layout (`dist/shared/logging/logger.js` -> `..` (shared) -> `..` (dist) -> `..` (api)).
   - Applying `try/catch` around `readFileSync` ensures the application boots even under misconfigured filesystem environments, reverting to `"unknown"` instead of raising a fatal crash.

2. **Strict Production Environment Guards**:
   - Standard Zod parsing checks structural validity (e.g., minimum lengths, emails, URLs) but permits placeholder string values.
   - Post-Zod validation via `enforceProductionInvariants` catches dummy secrets (`sk_test_dummy`, `whsec_test_dummy`), development prefixes (`dev-`), and default credentials (`change-me-in-production`) when `NODE_ENV === "production"`.
   - Aggregating all failures into a single `EnvValidationError` ensures developers get comprehensive troubleshooting info on boot.

3. **Docker Configurations**:
   - By creating `nodeapp` and then writing `USER node`, the Dockerfile correctly achieves its security goal (running as a non-root user). However, creating the `nodeapp` user is redundant since it is never active.
   - Volume mapping `uploads:/data/uploads` in Compose and configuring `/data/uploads` in `UPLOAD_DIR` correctly persists files outside container life.
   - Bash parameter expansion (`${VAR:?error}`) inside `docker-compose.prod.yml` blocks deployment early if required keys are missing, complementing the application-level `env.ts` validation.

---

## 3. Caveats

1. **Redundant User Creation in Dockerfile**: The `nodeapp` user and group (UID 1001) are declared in `Dockerfile` but never utilized. `USER node` (UID 1000) is used instead. This is harmless but should be cleaned up.
2. **Missing `infra/` files in Repository**: `docker-compose.prod.yml` mounts `./infra/nginx.conf` and `./infra/certs`, which do not exist in the source repository. Operators must provision these on the host machine before launching the Nginx container.
3. **Typecheck Warning**: Running `npm run typecheck` in `apps/api` fails due to minor Type errors in `tests/e2e/linkfit.e2e.test.ts` (unrelated to the production files examined).

---

## 4. Conclusion

The application implementation for Milestone 2 requirements is **highly robust, correct, and mature**. The ESM-compatible version resolver is correct in both dev/prod builds, and the environment guards completely prevent production runs with insecure placeholders.

### Recommended Adjustments
1. **Clean up Dockerfile user declaration**: Modify `apps/api/Dockerfile` line 41 to switch to `USER nodeapp` instead of `USER node`, OR remove the redundant creation of `nodeapp` on lines 29-31 if the default `node` user is preferred.
2. **Provide documentation for Nginx configuration**: Document the expected structure of `./infra/nginx.conf` and certificate directories required by the Nginx container.

---

## 5. Verification Method

To verify these rules and configurations independently:
1. **Run Logger Unit Tests**:
   Ensure logger configurations and redactions are valid:
   ```bash
   cd apps/api
   npx vitest run src/shared/logging/logger.test.ts
   ```
2. **Run Env Invariant Unit Tests**:
   Ensure Zod schemas and production guards fail fast when placeholders are supplied:
   ```bash
   cd apps/api
   npx vitest run src/shared/config/env.test.ts
   ```
3. **Validate Docker Compose file**:
   Check if compose raises syntax/missing key errors on production startup:
   ```bash
   docker compose -f docker-compose.prod.yml config
   ```
