# Milestone 2 Analysis Handoff Report

## 1. Observation
We analyzed the following codebase files and configurations under `/Users/kamrannamazov/Desktop/linkfit`:
- **Logger**: `apps/api/src/shared/logging/logger.ts` and `apps/api/package.json`
- **Environment**: `apps/api/src/shared/config/env.ts`, `apps/api/.env`, and `apps/api/.env.example`
- **Docker/Production Config**: `apps/api/Dockerfile`, `apps/api/.dockerignore`, and `docker-compose.prod.yml`

### Verbatim Evidence
1. **Logger version resolution in ESM** (`apps/api/src/shared/logging/logger.ts` lines 14-29):
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
   And `createLogger` incorporates this in pino's base options (lines 58-62):
   ```typescript
   base: {
     service: "linkfit-api",
     env: env.NODE_ENV,
     version: SERVICE_VERSION,
   },
   ```

2. **Environment Strictness Checks for Production** (`apps/api/src/shared/config/env.ts` lines 197-232):
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

3. **Dockerfile User Redundancy** (`apps/api/Dockerfile` lines 29-31 and line 41):
   ```dockerfile
   RUN apk add --no-cache wget && \
       addgroup -g 1001 -S nodeapp || true && \
       adduser -u 1001 -S nodeapp -G nodeapp || true
   ```
   And then:
   ```dockerfile
   # Drop root.
   USER node
   ```

4. **Production Database Migrations Script** (`apps/api/package.json` line 18):
   ```json
   "migrate:up": "node --env-file=.env node_modules/.bin/node-pg-migrate up -m migrations -j sql",
   ```
   Combined with Docker Compose instructions (`docker-compose.prod.yml` lines 6-7):
   ```yaml
   #   3. Run migrations on first boot:
   #        docker compose -f docker-compose.prod.yml exec api npm run migrate:up
   ```
   And the `.dockerignore` file which excludes `.env` from the runtime image (`apps/api/.dockerignore` line 8):
   ```
   .env
   ```

---

## 2. Logic Chain

### A. Logger Version Format Verification
1. We traced the compilation step of `apps/api` via `tsconfig.build.json` which excludes `tests/` and outputs all compiled files directly to `dist/` preserving the source files' folder hierarchy (e.g. `src/shared/logging/logger.ts` compiles to `dist/shared/logging/logger.js`).
2. At runtime, the directory of `logger.ts`/`logger.js` (retrieved via `dirname(fileURLToPath(import.meta.url))`) is at depth 3 relative to the app root in both environments:
   - In dev: `apps/api/src/shared/logging` → 3 levels up is `apps/api/`
   - In prod (dist): `apps/api/dist/shared/logging` → 3 levels up is `apps/api/` (since `dist/` acts as the root of compiled files, and the files in `dist/` mirror `src/` directly without a nested `src/` folder).
3. Thus, `join(here, "..", "..", "..", "package.json")` correctly and safely resolves `apps/api/package.json` in both development and production.
4. Using `import.meta.url` is fully ESM-compatible, which is required as the package uses `"type": "module"`.
5. The `createLogger` function successfully assigns this version to the `version` field in `base` context, ensuring that every log message emitted includes the correct app version field.

### B. Environment Strictness Checks
1. Under Zod Schema structural validation, some optional/placeholder fields have sensible defaults so the server runs out-of-the-box in development.
2. In production, however, running with placeholders is highly insecure (e.g., weak JWT secrets, placeholder Stripe credentials, or weak metrics passwords).
3. The custom `enforceProductionInvariants` method acts as a secondary strict check triggered ONLY when `NODE_ENV === "production"`.
4. It correctly asserts that:
   - Dummy Stripe secrets (`sk_test_dummy`, `whsec_test_dummy`) are rejected.
   - JWT Secrets that start with `"dev-"` (the local default template prefix) are rejected.
   - Metrics scraper password (`change-me-in-production`) is rejected.
   - `CORS_ORIGINS` has length > 0 (ensures that browser API access is explicitly whitelist-configured instead of left blank, which would default to blocking all browsers).
5. If any check fails, it throws a clear `EnvValidationError` containing all failures, preventing server bootstrap completely.

### C. Docker and Docker-Compose Correctness & Gotchas
We identified three operational gotchas/inefficiencies in the Docker files:
1. **Docker User Redundancy**:
   - The `Dockerfile` creates a new alpine system group and user called `nodeapp` with UID/GID `1001`.
   - However, later in the `Dockerfile` it drops root privileges using `USER node`.
   - The user `node` (UID `1000`) is pre-packaged inside the official `node:alpine` base image.
   - Creating `nodeapp` is redundant because it is never switched to or utilized.
2. **Missing Volume Directory Permissions**:
   - The production container runs under the unprivileged `node` user (UID `1000`).
   - `docker-compose.prod.yml` mounts a volume to `/data/uploads` for message attachments:
     ```yaml
     volumes:
       - uploads:/data/uploads
     ```
   - In typical Docker setups, a newly initialized named volume (like `uploads`) is mounted as root-owned. Since `/data/uploads` is not pre-created or chowned to UID `1000` (`node`) inside the Docker image, the application will crash with `EACCES: permission denied` when trying to write uploaded attachments in production.
3. **Production Migration Execution Crash**:
   - `docker-compose.prod.yml` documentation directs operators to run migrations in production via:
     `docker compose -f docker-compose.prod.yml exec api npm run migrate:up`
   - However, in `package.json`, `npm run migrate:up` is defined as:
     `node --env-file=.env node_modules/.bin/node-pg-migrate ...`
   - The `.dockerignore` file correctly excludes `.env` from the production runtime image to prevent embedding local secrets.
   - Since `.env` does not exist in the production container, Node's CLI will throw a fatal error because the specified `--env-file=.env` is missing, failing to run migrations at all!

---

## 3. Caveats
- We did not execute the production container directly in a production orchestrator cluster (e.g. Swarm/Kubernetes).
- Nginx configuration (`./infra/nginx.conf` and certificates in `./infra/certs`) referenced in `docker-compose.prod.yml` are not checked into the repository (noted as an operator-provided requirement in the comments, which is standard, but must be created prior to compose boot).

---

## 4. Conclusion
The Logger ESM version checks and Environment strictness validation are beautifully designed and fully correct. However, the Docker build and compose configs contain three minor operational and security issues that should be addressed before deploying to production:
1. Redundant user creation (`nodeapp` created but `node` is used).
2. Permission denial risk on `/data/uploads` volume mount.
3. Node `--env-file=.env` crash during migration in production.

### Recommended Adjustments (Diff Patches)

#### 1. Fix `apps/api/Dockerfile`
Remove redundant `nodeapp` user creation and pre-create/chown `/data/uploads` to the running unprivileged `node` user (UID 1000):

```diff
<<<<
RUN apk add --no-cache wget && \
    addgroup -g 1001 -S nodeapp || true && \
    adduser -u 1001 -S nodeapp -G nodeapp || true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Drop root.
USER node
====
RUN apk add --no-cache wget

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Create uploads directory and set permissions for node user (uid 1000)
RUN mkdir -p /data/uploads && \
    chown -R node:node /app /data/uploads

# Drop root.
USER node
>>>>
```

#### 2. Fix Production Migration Commands in `apps/api/package.json`
Add a production-friendly migration script that doesn't attempt to load the local `.env` file (since database URL is already in the container environment via Docker Compose):

```diff
<<<<
    "migrate:up": "node --env-file=.env node_modules/.bin/node-pg-migrate up -m migrations -j sql",
    "migrate:down": "node --env-file=.env node_modules/.bin/node-pg-migrate down -m migrations -j sql",
====
    "migrate:up": "node --env-file=.env node_modules/.bin/node-pg-migrate up -m migrations -j sql",
    "migrate:up:prod": "node-pg-migrate up -m migrations -j sql",
    "migrate:down": "node --env-file=.env node_modules/.bin/node-pg-migrate down -m migrations -j sql",
    "migrate:down:prod": "node-pg-migrate down -m migrations -j sql",
>>>>
```
Then update `docker-compose.prod.yml` comments to recommend:
`docker compose -f docker-compose.prod.yml exec api npm run migrate:up:prod`

---

## 5. Verification Method

### 1. Verification of Logger and Env Tests
Run the existing suite using the local test command to verify all config, environment validation, and logger assertions pass cleanly:
```bash
cd apps/api
npm run test -- --run
```
- Verify `env.test.ts` passes.
- Verify `health.test.ts` passes.

### 2. Validation of Node `--env-file` missing behaviour
You can run this command to verify that Node 22 indeed crashes when the `--env-file` target is missing:
```bash
node --env-file=.nonexistent-env -e "console.log('booted')"
```
Result: Node will throw `Error: ENOENT: no such file or directory, open '.nonexistent-env'` and exit. This proves the production migration runner would crash.
