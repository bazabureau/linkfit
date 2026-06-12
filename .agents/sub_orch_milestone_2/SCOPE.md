# Scope: Milestone 2 - Logging, Env Strictness & Docker

## Architecture
- `apps/api/src/shared/logging/logger.ts`: Needs to read version from `package.json` and add it to base context.
- `apps/api/src/shared/config/env.ts`: Needs strict validation in production against specific mock/dev secrets.
- `apps/api/Dockerfile`: Multi-stage Dockerfile using node:22-alpine.
- `apps/api/.dockerignore`: Ignore node_modules, dist, test files, env files, etc.
- `docker-compose.prod.yml`: Skeleton production compose setup.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| 1 | Logger Version Expansion | In `apps/api/src/shared/logging/logger.ts`, add `version` field to pino logger context using `node:fs` reading from `package.json`. | None | DONE |
| 2 | Env Strictness Rules | In `apps/api/src/shared/config/env.ts`, throw `EnvValidationError` if production contains placeholders. | None | DONE |
| 3 | Docker & Compose | Dockerfile, .dockerignore, docker-compose.prod.yml | None | DONE |

## Interface Contracts
- Node: fs ESM-compatible package.json loading.
- Env validation: productionGuards throwing `EnvValidationError`.
