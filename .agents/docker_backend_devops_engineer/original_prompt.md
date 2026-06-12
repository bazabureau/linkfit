## 2026-06-01T02:16:26Z
You are the Specialized Docker & Backend DevOps Engineer. Your task is to resolve container build discrepancies and configure production-ready deployment assets for the Linkfit API.

# Workspace & Files
- `apps/api/Dockerfile`
- `apps/api/package.json`
- `docker-compose.prod.yml`
- Any scripts or configs relating to container initialization and startup.

# Objective & Discrepancies to Fix
1. **Unprivileged Permissions & User Redundancy**:
   - Audit the `Dockerfile` to ensure there are no redundant users (e.g., `nodeapp` UID 1001 vs default `node` UID 1000). Ensure the container runs securely as the unprivileged default `node` user.
   - All runtime files, dependencies, and caches under `/app` must be owned by the `node` user.

2. **Uploads Folder Mounts**:
   - Ensure the uploads folder `/data/uploads` (or an alternative like `/app/uploads` under the application workdir) is fully writable by the unprivileged `node` user.
   - If `/data/uploads` is mounted as a named volume or host path, configure the Dockerfile and docker-compose to guarantee write permissions for `node` (UID 1000) under all environments. Using an uploads directory under `/app/uploads` is recommended if `/data/uploads` causes mounting permissions friction.

3. **Production Migration & Startup (Entrypoint-based auto-migrations)**:
   - The production container should automatically run migrations on startup before spawning the main application server, but it MUST be entirely `--env-file`-free (relying on actual environment variables passed via docker-compose).
   - Create a lightweight shell script `entrypoint.sh` or configure a secure container `CMD` / `ENTRYPOINT` pattern to run `npm run migrate:up:prod` and then start the Fastify server (`node dist/index.js`). Ensure it exits cleanly or handles db readiness.
   - In `package.json`, ensure there are no hardcoded `--env-file=.env` references in production scripts (like `migrate:up:prod` or a custom `start:prod` script).

# Verification
- Validate that the Dockerfile builds successfully.
- Verify that `npm run lint` and `npm run typecheck` both exit with 0.
- Ensure that the container starts up cleanly, executes migrations automatically without `.env` errors, and listens on port 3000.

# MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## 2026-06-01T00:27:43Z
From: parent agent (2315e8d8-3848-4e36-a4a8-3d7d282ff12c)
Content:
**Context**: Docker track discontinued.
**Content**: Stop all work on Docker immediately. We have received a critical high-priority directive from the user stating that Docker is NOT needed and MUST NOT be used (no docker compose, no Docker containers). All services, database connections, and test executions must run directly LOCALLY on the host machine.
**Action**: Cease all Docker/DevOps container adjustments immediately and standby for new instructions.

