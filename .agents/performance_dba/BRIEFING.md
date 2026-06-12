# BRIEFING — 2026-06-01T01:55:00+02:00

## Mission
Analyze Kysely types, migrations, Earthdistance queries, index strategies, Fastify memory footprint, and connection pooling to write a Database & Performance Optimization Report.

## 🔒 My Identity
- Archetype: Performance Engineer & Database Administrator (DBA)
- Roles: DBA, Performance Analyst
- Working directory: /Users/kamrannamazov/Desktop/linkfit/.agents/performance_dba
- Original parent: 5f6c0774-069c-415a-9b2e-5784688a2095
- Milestone: Database and performance optimization analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Network Restrictions: CODE_ONLY network mode. No external calls. Only local filesystem and tools.

## Current Parent
- Conversation ID: 5f6c0774-069c-415a-9b2e-5784688a2095
- Updated: 2026-06-01T02:25:00+02:00

## Investigation State
- **Explored paths**:
  - `apps/api/src/shared/db/pool.ts` (connection pooling and Kysely setup)
  - `apps/api/src/shared/db/types.ts` (database schema definitions)
  - `apps/api/src/shared/config/env.ts` (environment variables)
  - `apps/api/src/shared/http/server.ts` (Fastify server config, plugins)
  - `apps/api/src/modules/catalog/catalog.repository.ts` (venue search & earthdistance)
  - `apps/api/src/modules/matchmaking/matchmaking.service.ts` (games/players recommendation queries)
  - `apps/api/src/modules/games/games.repository.ts` (games search & earthdistance)
  - `apps/api/src/modules/social/social.service.ts` (players directory search)
  - `apps/api/src/modules/bookings/bookings.service.ts` (availability grid and overlap checks)
  - `apps/api/migrations/` (SQL schema migrations, indexes, constraints)
- **Key findings**:
  - Critical spatial index missing on `users(home_lat, home_lng)`.
  - Serious matchmaking algorithm issue: candidate selection selects the 200 newest users globally before proximity scoring.
  - Array fields for foreign keys (`player_ids` in `tournament_entries`, `team_a/b_user_ids` in `match_scores`) violating referential integrity and degrading query performance.
  - Chat row lock contention due to synchronous `bump_conversation_last_message_at` trigger on every message.
  - Booking overlap partial index invalidation due to `status::text` casting.
  - DB pool size is unconfigurable from env; defaults to 10.
  - In-memory rate limiting and Realtime SSE bus causing memory bloat and preventing horizontal pod scaling.
  - Concurrency issues with `FeedWorker` running on every pod in a multi-pod environment.
- **Unexplored areas**: None.

## Key Decisions Made
- Write a detailed and professional DBA Optimization Report outlining all performance bottlenecks, the logical rationale, concrete proposed changes (including SQL migrations and TypeScript refactorings), and verification steps.

## Artifact Index
- /Users/kamrannamazov/Desktop/linkfit/.agents/performance_dba/dba_optimization_report.md — Comprehensive Database & Performance Optimization Report
