# Project: Linkfit Premium Integration & Production Readiness

## Product Leadership & Enterprise Governance
- **CTO / Tech Lead**: The Project Orchestrator, directing implementation, enforcing strict compilation gates, type safety, linting rules, and forensic integrity compliance audits.
- **Product Owner (PO)**: A dedicated product validation role that audits the platform feature inventory, validates user requirements against specs, and formally signs off on the Azerbaijani and English localizations.

## Architecture
Linkfit is a modern, modular sports community platform comprised of:
- **Swift iOS Application (`apps/ios`)**: A premium-quality mobile app built with Swift 6 and SwiftUI, featuring MVVM clean architecture, Dynamic Island match tracking (`LinkfitLiveActivity`), lock/home screen widgets (`LinkfitWidgets`), and native feature flows (Feed, Matches discovery, Tournaments detail pages, Squad management, Referrals, and Chat).
- **TypeScript Node API Backend (`apps/api`)**: An enterprise Fastify REST server built with PostgreSQL (accessed via type-safe Kysely query builder), Kysely Kysely-based SQL migrations, Zod for schema validation, Pino for structured logging, and Vitest for testing.
- **Production Infrastructure**: Envisioned with an Nginx TLS/rate-limiting reverse proxy, prometheus metrics export, containerization via Docker, and production-env validation strictness.

## Code Layout
- `apps/ios/Linkfit/`: Source code of the host iOS application.
- `apps/ios/LinkfitWidgets/`: Widget extension source code.
- `apps/ios/LinkfitLiveActivity/`: Dynamic Island widget extension source code.
- `apps/api/src/modules/`: Domain modules containing routes, services, schemas, and unit tests.
- `apps/api/src/shared/`: Shared infrastructure modules (auth, config, db, errors, logging).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | ESLint Styling Clean-up | Resolve the 48 ESLint errors across the 4 backend files to restore strict linting compliance. | None | DONE |
| M2 | Logging, Env Strictness & Docker | Add logger versioning context, enforce production env secrets validation, and add multi-stage Dockerfile/Compose configs. | M1 | DONE |
| M3 | Telemetry & Deep Health-check | Implement prometheus metrics collection plugin, GET /metrics, and `/health/ready` deep multi-dependency probes with full unit tests. | M2 | DONE |
| M4 | Final Integration & Dual-Track E2E | Run E2E verification of client-server integration, verify all tests pass, and conduct Forensic Integrity Audits. | M3, M8, M9 | PLANNED |
| M5 | Marketing & ASO Localization | Launch Marketing Track, design localized Store Copy (ASO in AZ & EN), referral campaigns, and write `MARKETING.md`. | None | DONE |
| M6 | CEO & Founder Strategy | Establish monetization framework, scaling roadmap, and write `STRATEGY.md`. | None | DONE |
| M8 | iOS Premium Layouts & Concurrency | Polish layouts, spacing tokens, dynamic dark mode, unblock image caches, and sync iOS widgets. | None | IN_PROGRESS |
| M9 | Next.js B2B Partner Dashboard | Audit, simplify, and integrate Next.js B2B App Router with slot management, pricing, and Playwright E2E. | M2 | IN_PROGRESS |

## Interface Contracts
### Client ↔ Server Communications
- **Base Endpoint**: Evaluated at runtime using the `APIBaseURL` configuration in plist (defaulting to droplet IP `http://142.93.100.82` or localhost).
- **Response Format**: All REST endpoints respond with strict JSON objects conformant to Zod models.
- **Authorization**: Secured via Bearer JWT (Access Token and Refresh Token).

### Deep Health Checks (`GET /health/ready`)
- **Response Type**: `application/json`
- **Output Schema**:
  ```json
  {
    "status": "ok" | "degraded",
    "version": "string",
    "checks": {
      "db": { "status": "ok" | "failed", "latency_ms": 3 },
      "stripe": { "status": "ok" | "skipped" | "failed", "reason": "string", "latency_ms": 12 },
      "smtp": { "status": "ok" | "skipped" | "failed", "reason": "string", "latency_ms": 12 },
      "apns": { "status": "ok" | "skipped" | "failed", "reason": "string", "latency_ms": 12 }
    }
  }
  ```
- **Error Behavior**: Database ping failure throws HTTP 503 Service Unavailable. Other non-critical dependency checks downgrade status to degraded but return HTTP 200 OK.
