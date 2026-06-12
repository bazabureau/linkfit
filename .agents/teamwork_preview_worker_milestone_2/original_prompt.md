## 2026-06-01T01:26:58Z
You are teamwork_preview_worker_milestone_2. Your working directory is /Users/kamrannamazov/Desktop/linkfit/.agents/teamwork_preview_worker_milestone_2.

You are tasked with optimizing the configurations for Milestone 2:
1. Fix `apps/api/Dockerfile`:
   - Remove redundant `nodeapp` user and group creation.
   - Pre-create `/data/uploads` directory in the runtime stage.
   - Set ownership of `/app` and `/data/uploads` to the running unprivileged `node` user (UID 1000):
     `RUN mkdir -p /data/uploads && chown -R node:node /app /data/uploads`
   - Add `--chown=node:node` to the COPY commands in the runtime stage to guarantee correct permissions for compiled files, manifests, and migrations.
2. Fix `apps/api/package.json`:
   - Add production migration scripts:
     `"migrate:up:prod": "node-pg-migrate up -m migrations -j sql"`
     `"migrate:down:prod": "node-pg-migrate down -m migrations -j sql"`
3. Fix `docker-compose.prod.yml`:
   - Update comments to point to `npm run migrate:up:prod` for running production migrations on first boot:
     `docker compose -f docker-compose.prod.yml exec api npm run migrate:up:prod`
4. Verification:
   - Navigate to `apps/api` and execute:
     - `npm run lint` to ensure no linting warnings/errors.
     - `npm run typecheck` to ensure no TypeScript compilation issues.
     - `npm run test` to run all existing environment and logging tests.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Please document all executed commands and their results, and create a report at `/Users/kamrannamazov/Desktop/linkfit/.agents/teamwork_preview_worker_milestone_2/handoff.md`. Report back once completed.
