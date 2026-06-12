# Milestone 2 Read-Only Investigation Report

This handoff report summarizes the read-only investigation of the Milestone 2 requirements for the Linkfit API codebase. It covers logger version resolution, production environment strictness, and Docker configuration files.

---

## 1. Observation

### A. Logger Version Resolution
* **File Path**: `apps/api/src/shared/logging/logger.ts`
* **File URL & ESM Imports** (Lines 1-4):
  ```typescript
  import pino, { type Logger, type LoggerOptions } from "pino";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import { dirname, join } from "node:path";
  ```
* **Version Extraction** (Lines 14-29):
  ```typescript
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
* **Pino Base Context Config** (Lines 58-62):
  ```typescript
      base: {
    service: "linkfit-api",
    env: env.NODE_ENV,
    version: SERVICE_VERSION,
  },
  ```
* **Comment Discrepancy**: The code uses `join(here, "..", "..", "..", "package.json")` which is exactly 3 directory hops (from `apps/api/src/shared/logging` up to `apps/api`). The comment `# src/shared/logging/ → src/shared/ → src/ → api/ (4 hops up)` states "4 hops up".

### B. Environment Strictness Validation
* **File Path**: `apps/api/src/shared/config/env.ts`
* **Production Invariants Guard** (Lines 197-232):
  ```typescript
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
* **Test Coverage**: Fully validated in `apps/api/src/shared/config/env.test.ts` (lines 104-170), asserting that these placeholders are accepted in development/testing but fail under `NODE_ENV=production`.

### C. Docker Configurations
* **File Path**: `apps/api/Dockerfile`
* **Redundant User Creation** (Lines 29-31 vs Line 41):
  ```dockerfile
  RUN apk add --no-cache wget && \
      addgroup -g 1001 -S nodeapp || true && \
      adduser -u 1001 -S nodeapp -G nodeapp || true
  ...
  # Drop root.
  USER node
  ```
  The image creates a custom user/group `nodeapp` (UID/GID 1001) but switches execution privilege to the official `node` user (UID/GID 1000) of the alpine image.
* **Volume Permission Mismatch** (Lines 43-47 & `docker-compose.prod.yml` Line 60 & 84):
  `Dockerfile` drops privileges to `USER node` but does not pre-create or `chown` the `/data/uploads` directory. In `docker-compose.prod.yml`, the `uploads` volume mounts at `/data/uploads`. Docker mounts new named volumes as `root:root` by default, meaning the running `node` user will lack permission to write to this directory.
* **File Path**: `apps/api/.dockerignore`
  The ignore file correctly excludes all development/testing/OS artifacts (e.g. `node_modules`, `dist`, `tests`, `vitest.config.ts`, `.env`).
* **File Path**: `docker-compose.prod.yml`
* **Missing In-Repo Nginx Configs** (Lines 89-107):
  ```yaml
    nginx:
      image: nginx:1.27-alpine
      container_name: linkfit-nginx
      restart: unless-stopped
      depends_on:
        - api
      ports:
        - "80:80"
        - "443:443"
      volumes:
        - ./infra/nginx.conf:/etc/nginx/nginx.conf:ro
        - ./infra/certs:/etc/nginx/certs:ro
  ```
  The repository contains no `./infra/` directory, meaning there are no `nginx.conf` or TLS cert directories available. Starting this compose file out-of-the-box will fail.
* **Database Version Discrepancy**:
  `docker-compose.yml` (dev) uses `postgres:16-alpine` while `docker-compose.prod.yml` (prod) uses `postgres:17-alpine`.

---

## 2. Logic Chain

1. **Logger Version**:
   - *Premise*: ESM compatibility prevents standard commonJS `require` statements, and reading JSON requires proper file path URL resolution since `"resolveJsonModule"` is off.
   - *Inference*: Using `import.meta.url` combined with `fileURLToPath`, `dirname`, `join`, and `readFileSync` provides a fully robust runtime resolution of `package.json` that works under both typescript runtime compilers (tsx) and compiled build layouts (`dist/`).
   - *Verification*: Pino's `base` context config explicitly maps the version field to `SERVICE_VERSION`.

2. **Environment Strictness**:
   - *Premise*: Real deployments must not accidentally run on default credentials or placeholders.
   - *Inference*: Safe parsing with `EnvSchema.safeParse` followed by custom production-only assertion rules in `enforceProductionInvariants` catches dev placeholders (`sk_test_dummy`, `whsec_test_dummy`, `change-me-in-production`, `dev-*`) and aborts the application boot sequence safely before HTTP requests can be served.

3. **Docker Configurations**:
   - *Premise*: Containers should be secure, slim, and deployable.
   - *Inference 1*: Creating `nodeapp` (UID 1001) but switching to `USER node` (UID 1000) creates unused entities.
   - *Inference 2*: Running as `USER node` while using a host or named volume `/data/uploads` without pre-creating `/data/uploads` and running `chown` causes an `EACCES` write permission violation at runtime.
   - *Inference 3*: Mounting `./infra/nginx.conf` and `./infra/certs` when `./infra/` is entirely missing from the repository prevents `docker compose` from succeeding.
   - *Inference 4*: Discrepancies between Postgres version 16 (development) and version 17 (production) can lead to subtle runtime differences.

---

## 3. Caveats

- **No Active Run Permissions**: This was a read-only code analysis investigation. The Docker and Compose behaviors are reasoned from configurations and standard Docker Engine mounting mechanics. We did not build the images or run the containers.
- **Nginx configuration**: We assume Nginx is expected to be configured by the user/operator as indicated in the file comments, but the complete absence of a base template or empty directories inside the repo makes immediate local testing of `docker-compose.prod.yml` impossible.

---

## 4. Conclusion

- **Logger and Env**: Extremely solid. The logger resolution is elegant and ESM-compatible. The environment validator protects production deployments perfectly.
- **Docker/Compose Adjustments Needed**:
  1. Fix `Dockerfile` redundant user creation: switch the `Dockerfile` to either use `USER nodeapp` (matching the user it creates) or remove the redundant `nodeapp` creation and simply use the built-in `node` user.
  2. Fix volume write permissions: Add a command in `Dockerfile` runtime stage to pre-create `/data/uploads` and set its owner:
     ```dockerfile
     RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
     ```
  3. Resolve missing `infra` directory: Provide a basic/example `./infra/nginx.conf` to avoid mount failures on boot, or document the folder setup clearly in the README.
  4. Align Postgres major versions: Standardize on `postgres:17-alpine` across both compose files or vice-versa.

---

## 5. Verification Method

### Test Suite Execution
Run the unit test suite inside `apps/api` to verify environment checks:
```bash
cd apps/api
npm run test
```
*(Verify that the tests in `src/shared/config/env.test.ts` execute and pass).*

### Docker Build Verification
Inspect the built image's filesystem ownership to confirm permission adjustments:
```bash
docker build -t linkfit-api -f apps/api/Dockerfile apps/api
docker run --rm linkfit-api ls -ld /data/uploads
```
*(Should return ownership matching the user the container is running under).*
